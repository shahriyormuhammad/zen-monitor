import { eq, sql } from 'drizzle-orm';

import { db, withAdminContext, withTenantContext } from '@/lib/db';
import { procifryAgentAuditLog, tenants } from '@/lib/db/schema';
import { logger } from '@/lib/logger';
import {
  type AdvertisingDecisionCard,
  getAdvertisingDecisionCenter,
} from '@/server/analytics/advertising-decision-center';
import {
  executeAdvertisingDecisionAction,
  getAdvertisingDecisionActionOperationCount,
  isExecutableAdvertisingDecisionType,
} from '@/server/advertising/decision-actions';

export type AdvertisingDecisionAutopilotMode = 'advisor' | 'semi_auto' | 'auto';

export type AdvertisingDecisionAutopilotCardResult = {
  id: string;
  type: string;
  status: 'skipped' | 'previewed' | 'applied' | 'failed';
  reason: string;
  dryRunOperations: number;
  appliedOperations: number;
  error?: string;
};

export type AdvertisingDecisionAutopilotTenantResult = {
  tenantId: string;
  mode: AdvertisingDecisionAutopilotMode;
  status: 'skipped' | 'processed';
  reason?: string;
  cardsSeen: number;
  previewed: number;
  applied: number;
  failed: number;
  cards: AdvertisingDecisionAutopilotCardResult[];
};

const AUTOPILOT_SOURCE = 'advertising-decision-autopilot';

function defaultWindow(now = new Date()) {
  const dateTo = new Date(now);
  const dateFrom = new Date(now);
  dateFrom.setUTCDate(dateFrom.getUTCDate() - 7);
  return { dateFrom, dateTo };
}

function cooldownHours() {
  const parsed = Number(process.env.AD_DECISION_AUTOPILOT_COOLDOWN_HOURS ?? 6);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 6;
}

export function normalizeAdvertisingDecisionAutopilotMode(value: unknown): AdvertisingDecisionAutopilotMode {
  return value === 'semi_auto' || value === 'auto' ? value : 'advisor';
}

export function isDecisionCardExecutable(card: Pick<AdvertisingDecisionCard, 'type' | 'action'>) {
  return isExecutableAdvertisingDecisionType(card.type)
    && (
      card.action === 'confirm_cleanup'
      || card.action === 'confirm_lower_bid'
      || card.action === 'confirm_raise_bid'
    );
}

export function canApplyDecisionAutomatically(
  mode: AdvertisingDecisionAutopilotMode,
  card: Pick<AdvertisingDecisionCard, 'type' | 'action' | 'risk'>,
) {
  if (!isDecisionCardExecutable(card)) {
    return false;
  }

  if (mode === 'semi_auto') {
    return card.type === 'lower_bid';
  }

  if (mode === 'auto') {
    if (card.type === 'raise_bid') {
      return card.risk === 'low';
    }
    return card.type === 'stop_now' || card.type === 'lower_bid';
  }

  return false;
}

export function canPreviewDecisionAutomatically(
  mode: AdvertisingDecisionAutopilotMode,
  card: Pick<AdvertisingDecisionCard, 'type' | 'action'>,
) {
  return mode !== 'advisor' && isDecisionCardExecutable(card);
}

async function hasRecentDecisionExecution(input: {
  tenantId: string;
  decisionId: string;
  dryRun: boolean;
  since: Date;
}) {
  const rows = await withTenantContext(db, input.tenantId, async (tx) => tx.execute(sql`
    SELECT id
    FROM ${procifryAgentAuditLog}
    WHERE tenant_id = ${input.tenantId}
      AND source = ${AUTOPILOT_SOURCE}
      AND outcome = 'accepted'
      AND request_payload #>> '{payload,decisionId}' = ${input.decisionId}
      AND request_payload #>> '{payload,dryRun}' = ${String(input.dryRun)}
      AND created_at >= ${input.since}
    ORDER BY created_at DESC
    LIMIT 1
  `));

  return Array.from(rows).length > 0;
}

async function listTenantsForDecisionAutopilot() {
  return withAdminContext(db, async (tx) => tx
    .select({
      id: tenants.id,
      wbApiToken: tenants.wbApiToken,
      advertisingAutopilotEnabled: tenants.advertisingAutopilotEnabled,
      advertisingAutopilotMode: tenants.advertisingAutopilotMode,
    })
    .from(tenants)
    .where(eq(tenants.advertisingAutopilotEnabled, true)));
}

async function runCard(input: {
  tenantId: string;
  mode: AdvertisingDecisionAutopilotMode;
  card: AdvertisingDecisionCard;
  dateFrom: Date;
  dateTo: Date;
  since: Date;
}): Promise<AdvertisingDecisionAutopilotCardResult> {
  const { card } = input;

  if (!canPreviewDecisionAutomatically(input.mode, card)) {
    return {
      id: card.id,
      type: card.type,
      status: 'skipped',
      reason: 'not_actionable',
      dryRunOperations: 0,
      appliedOperations: 0,
    };
  }
  const decisionType = isExecutableAdvertisingDecisionType(card.type) ? card.type : null;
  if (!decisionType) {
    return {
      id: card.id,
      type: card.type,
      status: 'skipped',
      reason: 'not_executable',
      dryRunOperations: 0,
      appliedOperations: 0,
    };
  }

  const shouldApply = canApplyDecisionAutomatically(input.mode, card);
  const dryRunOnly = !shouldApply;
  const recent = await hasRecentDecisionExecution({
    tenantId: input.tenantId,
    decisionId: card.id,
    dryRun: dryRunOnly,
    since: input.since,
  });

  if (recent) {
    return {
      id: card.id,
      type: card.type,
      status: 'skipped',
      reason: dryRunOnly ? 'recent_preview' : 'recent_apply',
      dryRunOperations: 0,
      appliedOperations: 0,
    };
  }

  try {
    const preview = await executeAdvertisingDecisionAction({
      tenantId: input.tenantId,
      actorId: `autopilot:${input.tenantId}`,
      decisionType,
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
      nmId: card.nmId,
      dryRun: true,
      maxClusters: 10,
      source: AUTOPILOT_SOURCE,
      confidence: shouldApply ? 'confirmed' : 'partial',
      extraPayload: {
        decisionId: card.id,
        autopilotMode: input.mode,
        cardRisk: card.risk,
      },
    });
    const dryRunOperations = getAdvertisingDecisionActionOperationCount(preview);

    if (dryRunOperations <= 0) {
      return {
        id: card.id,
        type: card.type,
        status: 'previewed',
        reason: 'no_operations',
        dryRunOperations,
        appliedOperations: 0,
      };
    }

    if (!shouldApply) {
      return {
        id: card.id,
        type: card.type,
        status: 'previewed',
        reason: 'awaiting_operator',
        dryRunOperations,
        appliedOperations: 0,
      };
    }

    const applied = await executeAdvertisingDecisionAction({
      tenantId: input.tenantId,
      actorId: `autopilot:${input.tenantId}`,
      decisionType,
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
      nmId: card.nmId,
      dryRun: false,
      maxClusters: 10,
      source: AUTOPILOT_SOURCE,
      confidence: 'confirmed',
      extraPayload: {
        decisionId: card.id,
        autopilotMode: input.mode,
        cardRisk: card.risk,
      },
    });

    return {
      id: card.id,
      type: card.type,
      status: 'applied',
      reason: 'applied',
      dryRunOperations,
      appliedOperations: getAdvertisingDecisionActionOperationCount(applied),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({
      err: error,
      tenantId: input.tenantId,
      decisionId: card.id,
      decisionType: card.type,
    }, '[advertising-decision-autopilot] card failed');
    return {
      id: card.id,
      type: card.type,
      status: 'failed',
      reason: 'execution_failed',
      dryRunOperations: 0,
      appliedOperations: 0,
      error: message,
    };
  }
}

export async function runAdvertisingDecisionAutopilotForTenant(input: {
  tenantId: string;
  mode: AdvertisingDecisionAutopilotMode;
  dateFrom?: Date;
  dateTo?: Date;
  now?: Date;
}): Promise<AdvertisingDecisionAutopilotTenantResult> {
  if (input.mode === 'advisor') {
    return {
      tenantId: input.tenantId,
      mode: input.mode,
      status: 'skipped',
      reason: 'advisor_mode',
      cardsSeen: 0,
      previewed: 0,
      applied: 0,
      failed: 0,
      cards: [],
    };
  }

  const { dateFrom, dateTo } = input.dateFrom && input.dateTo
    ? { dateFrom: input.dateFrom, dateTo: input.dateTo }
    : defaultWindow(input.now);
  const since = new Date((input.now ?? new Date()).getTime() - cooldownHours() * 60 * 60 * 1000);
  const decisions = await getAdvertisingDecisionCenter(input.tenantId, dateFrom, dateTo);
  const cards = decisions.cards.filter((card) => card.type !== 'quiet');
  const results: AdvertisingDecisionAutopilotCardResult[] = [];

  for (const card of cards) {
    results.push(await runCard({
      tenantId: input.tenantId,
      mode: input.mode,
      card,
      dateFrom,
      dateTo,
      since,
    }));
  }

  return {
    tenantId: input.tenantId,
    mode: input.mode,
    status: 'processed',
    cardsSeen: cards.length,
    previewed: results.filter((row) => row.status === 'previewed').length,
    applied: results.filter((row) => row.status === 'applied').length,
    failed: results.filter((row) => row.status === 'failed').length,
    cards: results,
  };
}

export async function runAdvertisingDecisionAutopilot(input?: {
  now?: Date;
  dateFrom?: Date;
  dateTo?: Date;
}) {
  const tenantRows = await listTenantsForDecisionAutopilot();
  const results: AdvertisingDecisionAutopilotTenantResult[] = [];

  for (const tenant of tenantRows) {
    const mode = normalizeAdvertisingDecisionAutopilotMode(tenant.advertisingAutopilotMode);
    if (!tenant.wbApiToken) {
      results.push({
        tenantId: tenant.id,
        mode,
        status: 'skipped',
        reason: 'missing_wb_token',
        cardsSeen: 0,
        previewed: 0,
        applied: 0,
        failed: 0,
        cards: [],
      });
      continue;
    }

    results.push(await runAdvertisingDecisionAutopilotForTenant({
      tenantId: tenant.id,
      mode,
      now: input?.now,
      dateFrom: input?.dateFrom,
      dateTo: input?.dateTo,
    }));
  }

  return {
    checked: tenantRows.length,
    processed: results.filter((row) => row.status === 'processed').length,
    applied: results.reduce((sum, row) => sum + row.applied, 0),
    failed: results.reduce((sum, row) => sum + row.failed, 0),
    results,
  };
}
