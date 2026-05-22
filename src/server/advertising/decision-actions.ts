import { eq, sql } from 'drizzle-orm';

import type { AgentApiClient, ProcifryConfidence } from '@/lib/agent-api';
import { capabilityUnsupportedReason, resolveAdvertisingBidCapability } from '@/lib/advertising/ad-capabilities';
import { db, withTenantContext } from '@/lib/db';
import { tenants } from '@/lib/db/schema';
import { decryptIfNeeded } from '@/lib/encryption';
import { AppError } from '@/lib/errors';
import { wbApi } from '@/lib/wb-api';
import { executeProcifryAdvertisingAction } from '@/server/agent/procifry-advertising-actions';

export type ExecutableAdvertisingDecisionType = 'stop_now' | 'lower_bid' | 'raise_bid';

type ExecuteAdvertisingDecisionActionInput = {
  tenantId: string;
  actorId: string;
  decisionType: ExecutableAdvertisingDecisionType;
  dateFrom: Date;
  dateTo: Date;
  nmId?: number | null;
  dryRun: boolean;
  maxClusters?: number;
  manualStepPct?: number;
  source?: string;
  confidence?: ProcifryConfidence;
  extraPayload?: Record<string, unknown>;
  signal?: AbortSignal;
};

const ACTIONABLE_STATUSES = new Set([4, 9, 11]);

function datePayload(value: Date) {
  return value.toISOString();
}

async function getTenantWbToken(tenantId: string) {
  const [tenant] = await db
    .select({ wbApiToken: tenants.wbApiToken })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  const token = decryptIfNeeded(tenant?.wbApiToken ?? '').trim();
  if (!token) {
    throw new AppError('Для кабинета не сохранён WB API токен. Добавьте токен в настройках.', 400);
  }
  return token;
}

async function resolveAdvertIdFromLocalStats(tenantId: string, nmId: number) {
  const rows = await withTenantContext(db, tenantId, (tx) => tx.execute(sql`
    SELECT advert_id
    FROM advertising_hourly_stats
    WHERE tenant_id = ${tenantId}
      AND nm_id = ${nmId}
      AND advert_id > 0
    GROUP BY advert_id
    ORDER BY MAX(stat_hour) DESC, SUM(ad_spend) DESC
    LIMIT 1
  `));

  const advertId = Number((rows[0] as Record<string, unknown> | undefined)?.advert_id);
  return Number.isFinite(advertId) && advertId > 0 ? Math.trunc(advertId) : null;
}

async function resolveAdvertIdsFromLocalStats(tenantId: string, nmId: number) {
  const rows = await withTenantContext(db, tenantId, (tx) => tx.execute(sql`
    SELECT advert_id
    FROM advertising_hourly_stats
    WHERE tenant_id = ${tenantId}
      AND nm_id = ${nmId}
      AND advert_id > 0
    GROUP BY advert_id
    ORDER BY MAX(stat_hour) DESC, SUM(ad_spend) DESC
    LIMIT 20
  `));

  return rows
    .map((row) => Number((row as Record<string, unknown>).advert_id))
    .filter((value) => Number.isFinite(value) && value > 0)
    .map((value) => Math.trunc(value));
}

type ResolveCampaignOptions = {
  signal?: AbortSignal;
  allowFullScan?: boolean;
};

async function resolveCampaignForNm(tenantId: string, nmId: number, options?: ResolveCampaignOptions) {
  const token = await getTenantWbToken(tenantId);
  const localAdvertIds = await resolveAdvertIdsFromLocalStats(tenantId, nmId);
  if (localAdvertIds.length === 0 && !options?.allowFullScan) {
    return {
      advertId: 0,
      paymentType: null,
      bidSurface: null,
      supportedBidActions: false,
      unsupportedReason: 'В рекламной статистике нет связанной кампании для этого товара. Действие не применено: откройте вкладку «Ставки» или обновите синхронизацию рекламы.',
    };
  }

  const localAdvertRank = new Map(localAdvertIds.map((advertId, index) => [advertId, index]));
  const campaigns = localAdvertIds.length > 0
    ? await wbApi.getAdCampaignsByAdvertIds(token, localAdvertIds, { signal: options?.signal })
    : await wbApi.getAdCampaigns(token, { signal: options?.signal });

  const candidates = campaigns.filter((item) => (
    item.searchPlacement
    && item.nmIds.includes(nmId)
    && (item.status === undefined || ACTIONABLE_STATUSES.has(item.status))
  ));
  const sortedCandidates = [...candidates].sort((left, right) => {
    const leftStatusRank = left.status === 9 ? 0 : left.status === 4 ? 1 : left.status === 11 ? 2 : 3;
    const rightStatusRank = right.status === 9 ? 0 : right.status === 4 ? 1 : right.status === 11 ? 2 : 3;
    if (leftStatusRank !== rightStatusRank) {
      return leftStatusRank - rightStatusRank;
    }
    return (localAdvertRank.get(left.advertId) ?? 999) - (localAdvertRank.get(right.advertId) ?? 999);
  });

  const cpcCampaign = sortedCandidates.find((item) => item.paymentType === 'cpc');
  if (cpcCampaign) {
    const capability = resolveAdvertisingBidCapability({
      paymentType: cpcCampaign.paymentType,
      bidType: cpcCampaign.bidType,
      hasCurrentBid: true,
    });
    return {
      advertId: cpcCampaign.advertId,
      paymentType: 'cpc' as const,
      bidSurface: 'card' as const,
      supportedBidActions: true,
      capability,
    };
  }

  const cpmCampaign = sortedCandidates.find((item) => item.paymentType === 'cpm' && item.bidType === 'manual');
  if (cpmCampaign) {
    const capability = resolveAdvertisingBidCapability({
      paymentType: cpmCampaign.paymentType,
      bidType: cpmCampaign.bidType,
      hasCurrentBid: true,
      prefersClusterBid: true,
    });
    return {
      advertId: cpmCampaign.advertId,
      paymentType: 'cpm' as const,
      bidSurface: 'cluster' as const,
      supportedBidActions: true,
      capability,
    };
  }

  const fallbackCampaign = sortedCandidates[0] ?? null;
  if (fallbackCampaign) {
    const unsupportedReason = capabilityUnsupportedReason({
      paymentType: fallbackCampaign.paymentType,
      bidType: fallbackCampaign.bidType,
      hasCurrentBid: false,
    });
    return {
      advertId: fallbackCampaign.advertId,
      paymentType: fallbackCampaign.paymentType ?? null,
      bidSurface: null,
      supportedBidActions: false,
      unsupportedReason: unsupportedReason ?? 'WB не дал доступный тип кампании для изменения ставок. Действие не применено.',
    };
  }

  throw new AppError('Не найдена активная поисковая кампания для этого товара', 400);
}

export async function resolveAdvertIdForNm(tenantId: string, nmId: number, options?: { signal?: AbortSignal }) {
  const localAdvertId = await resolveAdvertIdFromLocalStats(tenantId, nmId);
  if (localAdvertId !== null) {
    return localAdvertId;
  }
  return (await resolveCampaignForNm(tenantId, nmId, { ...options, allowFullScan: true })).advertId;
}

function unsupportedBidActionResult(input: ExecuteAdvertisingDecisionActionInput, advertId: number, reason: string) {
  return {
    generatedAt: new Date().toISOString(),
    advertId,
    nmId: input.nmId ?? null,
    dryRun: input.dryRun,
    requiresConfirmation: false,
    unsupportedReason: reason,
    summary: {
      selectedClusters: 0,
      changedClusters: 0,
      blockedByGuardrail: 0,
      applyCount: 0,
      skippedCount: 1,
      failedCount: 0,
    },
    rows: [],
  };
}

export function getAdvertisingDecisionActionOperationCount(result: unknown) {
  const summary = result
    && typeof result === 'object'
    && 'summary' in result
    && result.summary
    && typeof result.summary === 'object'
    ? result.summary as Record<string, unknown>
    : null;

  if (!summary) {
    return 0;
  }

  const value = summary.applied
    ?? summary.queuedOperations
    ?? summary.applyCount
    ?? 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

export function isExecutableAdvertisingDecisionType(value: string): value is ExecutableAdvertisingDecisionType {
  return value === 'stop_now' || value === 'lower_bid' || value === 'raise_bid';
}

export async function executeAdvertisingDecisionAction(input: ExecuteAdvertisingDecisionActionInput) {
  const client: AgentApiClient = {
    id: input.actorId,
    key: 'dashboard-internal',
    reports: null,
    tenantIds: [input.tenantId],
    cabinetOids: null,
    workerId: 'procifry-action-executor',
    roles: ['execute_approved_actions'],
  };

  const actionType = input.decisionType === 'stop_now' ? 'ad_bulk_cluster_cleanup' : 'ad_bid_update';
  let actionPayload: Record<string, unknown>;

  if (input.decisionType === 'stop_now') {
    actionPayload = {
      from: datePayload(input.dateFrom),
      to: datePayload(input.dateTo),
      riskLevels: ['high'],
      maxClusters: input.maxClusters ?? 10,
      dryRun: input.dryRun,
    };
  } else {
    if (!input.nmId) {
      throw new AppError('nmId is required for bid actions', 400);
    }
    const campaign = await resolveCampaignForNm(input.tenantId, input.nmId, { signal: input.signal });
    if (!campaign.supportedBidActions) {
      return unsupportedBidActionResult(
        input,
        campaign.advertId,
        campaign.unsupportedReason ?? 'WB API не поддерживает автоматическое изменение ставки для этой кампании.',
      );
    }
    const manualStepPct = Number.isFinite(input.manualStepPct)
      ? Math.max(1, Math.min(80, Math.round(Math.abs(input.manualStepPct!))))
      : 10;
    const signedDeltaPct = input.decisionType === 'lower_bid' ? -manualStepPct : manualStepPct;
    actionPayload = {
      advertId: campaign.advertId,
      nmId: input.nmId,
      from: datePayload(input.dateFrom),
      to: datePayload(input.dateTo),
      mode: 'delta_pct',
      value: signedDeltaPct,
      dryRun: input.dryRun,
      bidSurface: campaign.bidSurface,
      paymentType: campaign.paymentType,
      placement: 'search',
      controlSurface: 'capability' in campaign ? campaign.capability?.controlSurface : undefined,
      guardrail: {
        enabled: true,
        preventIncreaseWithoutOrders: true,
        maxAcosPct: input.decisionType === 'raise_bid' ? 25 : 60,
      },
      fastPreview: true,
    };
  }

  const result = await executeProcifryAdvertisingAction(client, {
    workerId: 'procifry-action-executor',
    tenantId: input.tenantId,
    tenantIds: [input.tenantId],
    cabinetOid: `dashboard:${input.tenantId}`,
    multiTenant: false,
    periodFrom: input.dateFrom,
    periodTo: input.dateTo,
    source: input.source ?? 'advertising-decision-center',
    sourceUpdatedAt: new Date(),
    confidence: input.confidence ?? 'confirmed',
    actionType,
    signal: input.signal,
    payload: {
      ...actionPayload,
      decisionType: input.decisionType,
      ...input.extraPayload,
    },
  });

  return result;
}
