import type { AgentApiClient, ProcifryConfidence, ProcifryWorkerId } from '@/lib/agent-api';
import { assertProcifryClientAccess } from '@/lib/agent-api';
import { db, withTenantContext } from '@/lib/db';
import { procifryAgentAuditLog } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import {
  toggleAdvertisingCluster,
  type ClusterRiskLevel,
} from '@/server/advertising/clusters';
import {
  deleteAdvertisingAutoBidStrategy,
  executeBulkBidUpdate,
  executeCampaignCardBidUpdate,
  executeExcludeHighRiskClusters,
  runAdvertisingAutoBidStrategyNow,
  saveAdvertisingAutoBidStrategy,
  type AdvertisingBidBulkMode,
  type SaveAdvertisingAutoBidStrategyInput,
} from '@/server/advertising/workspace';
import {
  deleteAdvertisingPacingRule,
  deleteAdvertisingPortfolio,
  runAdvertisingPacingRuleNow,
  runAdvertisingPortfolioNow,
  saveAdvertisingPacingRule,
  saveAdvertisingPortfolio,
  type SaveAdvertisingPacingRuleInput,
  type SaveAdvertisingPortfolioInput,
} from '@/server/advertising/pacing-portfolios';
import { depositManual } from '@/server/advertising/balance';

export const PROCIFRY_ADVERTISING_ACTION_TYPES = [
  'ad_bid_update',
  'ad_cluster_exclude',
  'ad_cluster_include',
  'ad_bulk_cluster_cleanup',
  'ad_strategy_save',
  'ad_strategy_run',
  'ad_strategy_delete',
  'ad_pacing_save',
  'ad_pacing_run',
  'ad_pacing_delete',
  'ad_portfolio_save',
  'ad_portfolio_run',
  'ad_portfolio_delete',
  'ad_balance_deposit',
] as const;

export type ProcifryAdvertisingActionType = (typeof PROCIFRY_ADVERTISING_ACTION_TYPES)[number];

export type ProcifryAdvertisingActionRequest = {
  workerId: ProcifryWorkerId;
  tenantId: string;
  tenantIds: string[];
  cabinetOid: string;
  multiTenant: boolean;
  periodFrom: Date;
  periodTo: Date;
  source: string;
  sourceUpdatedAt: Date;
  confidence: ProcifryConfidence;
  actionType: ProcifryAdvertisingActionType;
  payload: Record<string, unknown>;
  signal?: AbortSignal;
};

const AUTONOMOUS_AD_WORKERS = new Set<ProcifryWorkerId>([
  'wb-ads-analyst',
  'wb-growth-manager',
  'wb-ads',
  'wb-chief',
  'procifry-action-executor',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function numberValue(payload: Record<string, unknown>, key: string, options?: { required?: boolean; min?: number }) {
  const value = Number(payload[key]);
  if (!Number.isFinite(value)) {
    if (options?.required) {
      throw new AppError(`${key} is required`, 400);
    }
    return undefined;
  }
  if (options?.min !== undefined && value < options.min) {
    throw new AppError(`${key} must be >= ${options.min}`, 400);
  }
  return value;
}

function stringValue(payload: Record<string, unknown>, key: string, options?: { required?: boolean }) {
  const value = typeof payload[key] === 'string' ? payload[key].trim() : '';
  if (!value && options?.required) {
    throw new AppError(`${key} is required`, 400);
  }
  return value || undefined;
}

function booleanValue(payload: Record<string, unknown>, key: string, fallback: boolean) {
  return typeof payload[key] === 'boolean' ? payload[key] : fallback;
}

function dateValue(payload: Record<string, unknown>, key: string, fallback: Date) {
  const raw = stringValue(payload, key);
  if (!raw) return fallback;
  const value = new Date(raw);
  if (Number.isNaN(value.getTime())) {
    throw new AppError(`${key} must be a valid date/time`, 400);
  }
  return value;
}

function stringArrayValue(payload: Record<string, unknown>, key: string) {
  return Array.isArray(payload[key])
    ? payload[key].map((item) => String(item).trim()).filter(Boolean)
    : undefined;
}

function riskLevelsValue(payload: Record<string, unknown>): ClusterRiskLevel[] {
  const raw = Array.isArray(payload.riskLevels) ? payload.riskLevels : ['high'];
  const result = raw.filter((item): item is ClusterRiskLevel => (
    item === 'high' || item === 'medium' || item === 'low' || item === 'none'
  ));
  return result.length > 0 ? result : ['high'];
}

function bidModeValue(payload: Record<string, unknown>): AdvertisingBidBulkMode {
  const mode = stringValue(payload, 'mode', { required: true });
  if (mode !== 'set' && mode !== 'delta_abs' && mode !== 'delta_pct') {
    throw new AppError('mode must be set, delta_abs or delta_pct', 400);
  }
  return mode;
}

function objectValue(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return isRecord(value) ? value : undefined;
}

function requireObjectValue<T>(payload: Record<string, unknown>, key: string): T {
  const value = payload[key];
  if (!isRecord(value)) {
    throw new AppError(`${key} is required`, 400);
  }
  return value as T;
}

function maxAutonomousDepositRub() {
  const parsed = Number(process.env.PROCIFRY_AD_AGENT_MAX_DEPOSIT_RUB ?? 10_000);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10_000;
}

async function writeAdvertisingActionAudit(
  request: ProcifryAdvertisingActionRequest,
  client: AgentApiClient,
  responsePayload: Record<string, unknown>,
  outcome: 'accepted' | 'failed',
) {
  const now = new Date();
  await withTenantContext(db, request.tenantId, async (tx) => {
    await tx.insert(procifryAgentAuditLog).values({
      tenantId: request.tenantId,
      tenantIds: request.tenantIds,
      multiTenant: request.multiTenant,
      workerId: request.workerId,
      clientId: client.id,
      cabinetOid: request.cabinetOid,
      periodFrom: request.periodFrom,
      periodTo: request.periodTo,
      source: request.source,
      sourceUpdatedAt: request.sourceUpdatedAt,
      confidence: request.confidence,
      accessMode: 'executed',
      resourceType: 'external_action',
      actionType: request.actionType,
      outcome,
      requestPayload: {
        payload: request.payload,
        autonomous: true,
      },
      responsePayload,
      createdAt: now,
    });
  });
}

async function dispatchAdvertisingAction(request: ProcifryAdvertisingActionRequest) {
  const payload = request.payload;
  const userId = null;

  switch (request.actionType) {
    case 'ad_bid_update':
      if (stringValue(payload, 'bidSurface') === 'card') {
        return executeCampaignCardBidUpdate(request.tenantId, {
          userId,
          advertId: numberValue(payload, 'advertId', { required: true, min: 1 })!,
          nmId: numberValue(payload, 'nmId', { required: true, min: 1 })!,
          dateFrom: dateValue(payload, 'from', request.periodFrom),
          dateTo: dateValue(payload, 'to', request.periodTo),
          mode: bidModeValue(payload),
          value: numberValue(payload, 'value', { required: true })!,
          placement: stringValue(payload, 'placement') === 'recommendations' ? 'recommendations' : 'search',
          paymentType: stringValue(payload, 'paymentType') === 'cpm' ? 'cpm' : 'cpc',
          minBid: numberValue(payload, 'minBid', { min: 0 }),
          maxBid: numberValue(payload, 'maxBid', { min: 0 }),
          guardrail: objectValue(payload, 'guardrail'),
          dryRun: booleanValue(payload, 'dryRun', false),
          confirmed: true,
          source: 'auto',
          signal: request.signal,
        });
      }
      return executeBulkBidUpdate(request.tenantId, {
        userId,
        advertId: numberValue(payload, 'advertId', { required: true, min: 1 })!,
        nmId: numberValue(payload, 'nmId', { required: true, min: 1 })!,
        dateFrom: dateValue(payload, 'from', request.periodFrom),
        dateTo: dateValue(payload, 'to', request.periodTo),
        mode: bidModeValue(payload),
        value: numberValue(payload, 'value', { required: true })!,
        clusters: stringArrayValue(payload, 'clusters'),
        minBid: numberValue(payload, 'minBid', { min: 0 }),
        maxBid: numberValue(payload, 'maxBid', { min: 0 }),
        guardrail: objectValue(payload, 'guardrail'),
        dryRun: booleanValue(payload, 'dryRun', false),
        confirmed: true,
        source: 'auto',
        fastPreview: booleanValue(payload, 'fastPreview', false),
        signal: request.signal,
      });

    case 'ad_cluster_exclude':
    case 'ad_cluster_include':
      return toggleAdvertisingCluster({
        tenantId: request.tenantId,
        userId,
        advertId: numberValue(payload, 'advertId', { required: true, min: 1 })!,
        nmId: numberValue(payload, 'nmId', { required: true, min: 1 })!,
        cluster: stringValue(payload, 'cluster', { required: true })!,
        mode: request.actionType === 'ad_cluster_exclude' ? 'exclude' : 'include',
      });

    case 'ad_bulk_cluster_cleanup':
      return executeExcludeHighRiskClusters(request.tenantId, {
        userId,
        dateFrom: dateValue(payload, 'from', request.periodFrom),
        dateTo: dateValue(payload, 'to', request.periodTo),
        riskLevels: riskLevelsValue(payload),
        maxClusters: numberValue(payload, 'maxClusters', { min: 1 }),
        dryRun: booleanValue(payload, 'dryRun', false),
        confirmed: true,
      });

    case 'ad_strategy_save':
      return saveAdvertisingAutoBidStrategy(
        request.tenantId,
        userId,
        requireObjectValue<SaveAdvertisingAutoBidStrategyInput>(payload, 'strategy'),
      );
    case 'ad_strategy_run':
      return runAdvertisingAutoBidStrategyNow(
        request.tenantId,
        stringValue(payload, 'strategyId', { required: true })!,
        userId,
      );
    case 'ad_strategy_delete':
      await deleteAdvertisingAutoBidStrategy(
        request.tenantId,
        stringValue(payload, 'strategyId', { required: true })!,
      );
      return { ok: true };

    case 'ad_pacing_save':
      return saveAdvertisingPacingRule(
        request.tenantId,
        userId,
        requireObjectValue<SaveAdvertisingPacingRuleInput>(payload, 'rule'),
      );
    case 'ad_pacing_run':
      return runAdvertisingPacingRuleNow(
        request.tenantId,
        stringValue(payload, 'ruleId', { required: true })!,
        userId,
      );
    case 'ad_pacing_delete':
      await deleteAdvertisingPacingRule(
        request.tenantId,
        stringValue(payload, 'ruleId', { required: true })!,
      );
      return { ok: true };

    case 'ad_portfolio_save':
      return saveAdvertisingPortfolio(
        request.tenantId,
        userId,
        requireObjectValue<SaveAdvertisingPortfolioInput>(payload, 'portfolio'),
      );
    case 'ad_portfolio_run':
      return runAdvertisingPortfolioNow(
        request.tenantId,
        stringValue(payload, 'portfolioId', { required: true })!,
        userId,
      );
    case 'ad_portfolio_delete':
      await deleteAdvertisingPortfolio(
        request.tenantId,
        stringValue(payload, 'portfolioId', { required: true })!,
      );
      return { ok: true };

    case 'ad_balance_deposit': {
      const amountRub = numberValue(payload, 'amountRub', { required: true, min: 1 })!;
      const maxDeposit = maxAutonomousDepositRub();
      if (amountRub > maxDeposit) {
        throw new AppError(`amountRub exceeds autonomous deposit limit (${maxDeposit})`, 400);
      }
      await depositManual(
        request.tenantId,
        numberValue(payload, 'campaignId', { required: true, min: 1 })!,
        amountRub,
      );
      return { ok: true, amountRub };
    }

    default: {
      const exhaustive: never = request.actionType;
      return exhaustive;
    }
  }
}

export async function executeProcifryAdvertisingAction(
  client: AgentApiClient,
  request: ProcifryAdvertisingActionRequest,
) {
  if (!AUTONOMOUS_AD_WORKERS.has(request.workerId)) {
    throw new AppError('Worker is not allowed to execute autonomous advertising actions', 403);
  }

  assertProcifryClientAccess(client, {
    workerId: request.workerId,
    tenantIds: request.tenantIds,
    cabinetOid: request.cabinetOid,
    multiTenant: request.multiTenant,
    resourceType: 'external_action',
    accessMode: 'executed',
    actionType: request.actionType,
    allowAutonomousExternalAction: true,
  });

  try {
    const result = await dispatchAdvertisingAction(request);
    await writeAdvertisingActionAudit(request, client, { result }, 'accepted');
    return result;
  } catch (error) {
    await writeAdvertisingActionAudit(
      request,
      client,
      { error: error instanceof Error ? error.message : String(error) },
      'failed',
    ).catch(() => undefined);
    throw error;
  }
}
