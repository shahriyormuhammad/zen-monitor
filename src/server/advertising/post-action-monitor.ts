import { and, asc, eq, gt, gte, inArray, isNotNull, lt, lte, ne, sql } from 'drizzle-orm';

import { db, withAdminContext, withTenantContext } from '@/lib/db';
import {
  advertisingBidChanges,
  advertisingHourlyStats,
  productGroupMembers,
  productGroups,
  tenants,
} from '@/lib/db/schema';
import { logger } from '@/lib/logger';
import {
  evaluateAdvertisingPostAction,
  normalizeAdvertisingPostActionStats,
  readAdvertisingPostActionMonitor,
  type AdvertisingPostActionMonitorReport,
  type AdvertisingPostActionScopeType,
  type AdvertisingPostActionStats,
} from '@/lib/advertising/post-action-monitor';
import {
  executeBulkBidUpdate,
  executeCampaignCardBidUpdate,
  type AdvertisingBidBulkMode,
} from '@/server/advertising/workspace';

const MONITOR_SOURCE = 'post_action';
const LOOKBACK_DAYS = 14;
const MIN_HORIZON_HOURS = 2;
const MID_HORIZON_HOURS = 6;
const FINAL_HORIZON_HOURS = 24;

type TenantAdvertisingAutopilotMode = 'advisor' | 'semi_auto' | 'auto';

type BidChangeCandidate = {
  id: string;
  tenantId: string;
  advertId: number;
  nmId: number;
  cluster: string;
  previousBid: number | null;
  nextBid: number | null;
  source: string;
  metrics: Record<string, unknown>;
  createdAt: Date;
  advertisingAutopilotEnabled: boolean;
  advertisingAutopilotMode: string;
};

type ProductScope = {
  type: AdvertisingPostActionScopeType;
  nmIds: number[];
  groupId: string | null;
  groupName: string | null;
};

export type AdvertisingPostActionMonitorRunResult = {
  checked: number;
  processed: number;
  updated: number;
  skipped: number;
  rollbackApplied: number;
  rollbackFailed: number;
  errors: number;
};

function normalizeAutopilotMode(value: unknown): TenantAdvertisingAutopilotMode {
  return value === 'semi_auto' || value === 'auto' ? value : 'advisor';
}

function toNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function addHours(value: Date, hours: number) {
  return new Date(value.getTime() + hours * 60 * 60 * 1000);
}

function pickEligibleHorizon(createdAt: Date, now: Date) {
  const elapsedHours = Math.floor((now.getTime() - createdAt.getTime()) / 3_600_000);
  if (elapsedHours >= FINAL_HORIZON_HOURS) {
    return FINAL_HORIZON_HOURS;
  }
  if (elapsedHours >= MID_HORIZON_HOURS) {
    return MID_HORIZON_HOURS;
  }
  if (elapsedHours >= MIN_HORIZON_HOURS) {
    return MIN_HORIZON_HOURS;
  }
  return null;
}

function numberFromMetrics(metrics: Record<string, unknown>, key: string) {
  const parsed = Number(metrics[key]);
  return Number.isFinite(parsed) ? Math.round(parsed) : undefined;
}

function stringFromMetrics(metrics: Record<string, unknown>, key: string) {
  const value = metrics[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

async function listCandidates(now: Date, limit: number): Promise<BidChangeCandidate[]> {
  const cutoff = addHours(now, -MIN_HORIZON_HOURS);
  const oldest = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const rows = await withAdminContext(db, async (tx) => tx
    .select({
      id: advertisingBidChanges.id,
      tenantId: advertisingBidChanges.tenantId,
      advertId: advertisingBidChanges.advertId,
      nmId: advertisingBidChanges.nmId,
      cluster: advertisingBidChanges.cluster,
      previousBid: advertisingBidChanges.previousBid,
      nextBid: advertisingBidChanges.nextBid,
      source: advertisingBidChanges.source,
      metrics: advertisingBidChanges.metrics,
      createdAt: advertisingBidChanges.createdAt,
      advertisingAutopilotEnabled: tenants.advertisingAutopilotEnabled,
      advertisingAutopilotMode: tenants.advertisingAutopilotMode,
    })
    .from(advertisingBidChanges)
    .innerJoin(tenants, eq(tenants.id, advertisingBidChanges.tenantId))
    .where(and(
      eq(advertisingBidChanges.status, 'applied'),
      isNotNull(advertisingBidChanges.previousBid),
      isNotNull(advertisingBidChanges.nextBid),
      ne(advertisingBidChanges.previousBid, advertisingBidChanges.nextBid),
      gte(advertisingBidChanges.createdAt, oldest),
      lte(advertisingBidChanges.createdAt, cutoff),
    ))
    .orderBy(asc(advertisingBidChanges.createdAt))
    .limit(limit));

  return rows
    .filter((row) => row.source !== MONITOR_SOURCE)
    .map((row) => ({
      ...row,
      advertId: Number(row.advertId),
      nmId: Number(row.nmId),
      metrics: row.metrics ?? {},
    }));
}

async function resolveProductScope(tenantId: string, nmId: number): Promise<ProductScope> {
  const [group] = await withTenantContext(db, tenantId, async (tx) => tx
    .select({
      groupId: productGroups.id,
      groupName: productGroups.name,
    })
    .from(productGroupMembers)
    .innerJoin(productGroups, eq(productGroups.id, productGroupMembers.groupId))
    .where(and(
      eq(productGroups.tenantId, tenantId),
      eq(productGroupMembers.nmId, nmId),
    ))
    .limit(1));

  if (!group) {
    return {
      type: 'sku',
      nmIds: [nmId],
      groupId: null,
      groupName: null,
    };
  }

  const members = await withTenantContext(db, tenantId, async (tx) => tx
    .select({ nmId: productGroupMembers.nmId })
    .from(productGroupMembers)
    .where(eq(productGroupMembers.groupId, group.groupId)));

  const nmIds = Array.from(new Set([
    nmId,
    ...members.map((row) => Number(row.nmId)).filter((value) => Number.isFinite(value) && value > 0),
  ])).sort((left, right) => left - right);

  return {
    type: 'group',
    nmIds,
    groupId: group.groupId,
    groupName: group.groupName,
  };
}

async function aggregateHourlyStats(
  tenantId: string,
  scope: ProductScope,
  from: Date,
  to: Date,
): Promise<AdvertisingPostActionStats> {
  const nmCondition = scope.nmIds.length === 1
    ? eq(advertisingHourlyStats.nmId, scope.nmIds[0]!)
    : inArray(advertisingHourlyStats.nmId, scope.nmIds);

  const [row] = await withTenantContext(db, tenantId, async (tx) => tx
    .select({
      adSpend: sql<string>`COALESCE(SUM(${advertisingHourlyStats.adSpend}), 0)::numeric`,
      revenue: sql<string>`COALESCE(SUM(${advertisingHourlyStats.orderSum}), 0)::numeric`,
      orders: sql<number>`COALESCE(SUM(${advertisingHourlyStats.orderCount}), 0)::int`,
      clicks: sql<number>`COALESCE(SUM(${advertisingHourlyStats.clicks}), 0)::int`,
      views: sql<number>`COALESCE(SUM(${advertisingHourlyStats.views}), 0)::int`,
      rows: sql<number>`COUNT(*)::int`,
    })
    .from(advertisingHourlyStats)
    .where(and(
      eq(advertisingHourlyStats.tenantId, tenantId),
      gte(advertisingHourlyStats.statHour, from),
      lt(advertisingHourlyStats.statHour, to),
      nmCondition,
    )));

  return normalizeAdvertisingPostActionStats({
    adSpend: toNumber(row?.adSpend),
    revenue: toNumber(row?.revenue),
    orders: toNumber(row?.orders),
    clicks: toNumber(row?.clicks),
    views: toNumber(row?.views),
    rows: toNumber(row?.rows),
  });
}

async function hasNewerBidChange(row: BidChangeCandidate) {
  const newer = await withTenantContext(db, row.tenantId, async (tx) => tx
    .select({ id: advertisingBidChanges.id })
    .from(advertisingBidChanges)
    .where(and(
      eq(advertisingBidChanges.tenantId, row.tenantId),
      eq(advertisingBidChanges.advertId, row.advertId),
      eq(advertisingBidChanges.nmId, row.nmId),
      eq(advertisingBidChanges.cluster, row.cluster),
      eq(advertisingBidChanges.status, 'applied'),
      gt(advertisingBidChanges.createdAt, row.createdAt),
    ))
    .limit(1));

  return newer.length > 0;
}

async function saveMonitorReport(row: BidChangeCandidate, report: AdvertisingPostActionMonitorReport) {
  await withTenantContext(db, row.tenantId, async (tx) => {
    await tx
      .update(advertisingBidChanges)
      .set({
        metrics: sql`jsonb_set(COALESCE(${advertisingBidChanges.metrics}, '{}'::jsonb), '{postActionMonitor}', ${JSON.stringify(report)}::jsonb, true)`,
      })
      .where(and(
        eq(advertisingBidChanges.tenantId, row.tenantId),
        eq(advertisingBidChanges.id, row.id),
      ));
  });
}

function withRollback(
  report: AdvertisingPostActionMonitorReport,
  rollback: AdvertisingPostActionMonitorReport['rollback'],
  attempted: boolean,
): AdvertisingPostActionMonitorReport {
  return {
    ...report,
    autoRollbackAttempted: attempted,
    rollback,
  };
}

async function applyRollback(
  row: BidChangeCandidate,
  report: AdvertisingPostActionMonitorReport,
  previousReport: AdvertisingPostActionMonitorReport | null,
) {
  if (previousReport?.rollback.status === 'applied') {
    return withRollback(report, previousReport.rollback, previousReport.autoRollbackAttempted);
  }
  if (!row.previousBid || !row.nextBid) {
    return withRollback(report, {
      status: 'skipped',
      reason: 'missing_previous_or_next_bid',
    }, false);
  }
  if (!report.autoRollbackEligible) {
    return withRollback(report, {
      status: 'skipped',
      reason: 'tenant_not_in_auto_mode',
    }, false);
  }
  if (report.horizonHours < MID_HORIZON_HOURS) {
    return withRollback(report, {
      status: 'skipped',
      reason: 'waiting_for_6h_horizon',
    }, false);
  }
  if (await hasNewerBidChange(row)) {
    return withRollback(report, {
      status: 'skipped',
      reason: 'newer_bid_change_exists',
    }, false);
  }

  const dateTo = new Date();
  const dateFrom = new Date(dateTo.getTime() - 7 * 24 * 60 * 60 * 1000);
  const mode: AdvertisingBidBulkMode = 'set';

  try {
    if (row.metrics.actionSurface === 'campaign_card_bid') {
      const placement = stringFromMetrics(row.metrics, 'placement') === 'recommendations'
        ? 'recommendations'
        : 'search';
      const paymentType = stringFromMetrics(row.metrics, 'paymentType') === 'cpm' ? 'cpm' : 'cpc';
      const minBid = numberFromMetrics(row.metrics, 'minBid');
      const maxBid = Math.max(row.previousBid, row.nextBid, numberFromMetrics(row.metrics, 'maxBid') ?? 0);

      await executeCampaignCardBidUpdate(row.tenantId, {
        userId: null,
        advertId: row.advertId,
        nmId: row.nmId,
        dateFrom,
        dateTo,
        mode,
        value: row.previousBid,
        placement,
        paymentType,
        minBid,
        maxBid,
        guardrail: { enabled: false },
        dryRun: false,
        confirmed: true,
        source: MONITOR_SOURCE,
      });
    } else {
      await executeBulkBidUpdate(row.tenantId, {
        userId: null,
        advertId: row.advertId,
        nmId: row.nmId,
        dateFrom,
        dateTo,
        mode,
        value: row.previousBid,
        clusters: [row.cluster],
        guardrail: { enabled: false },
        dryRun: false,
        confirmed: true,
        source: MONITOR_SOURCE,
        fastPreview: true,
      });
    }

    return withRollback(report, {
      status: 'applied',
      reason: 'post_action_monitor',
      appliedAt: new Date().toISOString(),
    }, true);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({
      err: error,
      tenantId: row.tenantId,
      changeId: row.id,
      advertId: row.advertId,
      nmId: row.nmId,
      cluster: row.cluster,
    }, '[advertising/post-action-monitor] rollback failed');
    return withRollback(report, {
      status: 'failed',
      reason: 'rollback_error',
      error: message,
    }, true);
  }
}

async function processCandidate(row: BidChangeCandidate, now: Date) {
  const previousBid = row.previousBid ?? 0;
  const nextBid = row.nextBid ?? 0;
  const horizonHours = pickEligibleHorizon(row.createdAt, now);
  if (!horizonHours || previousBid <= 0 || nextBid <= 0 || previousBid === nextBid) {
    return { status: 'skipped' as const, rollbackApplied: false, rollbackFailed: false };
  }

  const previousReport = readAdvertisingPostActionMonitor(row.metrics);
  if (previousReport && previousReport.horizonHours >= horizonHours) {
    return { status: 'skipped' as const, rollbackApplied: false, rollbackFailed: false };
  }

  const scope = await resolveProductScope(row.tenantId, row.nmId);
  const before = await aggregateHourlyStats(row.tenantId, scope, addHours(row.createdAt, -horizonHours), row.createdAt);
  const after = await aggregateHourlyStats(row.tenantId, scope, row.createdAt, addHours(row.createdAt, horizonHours));
  const mode = normalizeAutopilotMode(row.advertisingAutopilotMode);
  const report = evaluateAdvertisingPostAction({
    changeId: row.id,
    checkedAt: now,
    horizonHours,
    source: row.source,
    previousBid,
    nextBid,
    scope,
    before,
    after,
    autoRollbackEligible: row.advertisingAutopilotEnabled && mode === 'auto',
  });

  const finalReport = previousReport?.rollback.status === 'applied'
    ? withRollback(report, previousReport.rollback, previousReport.autoRollbackAttempted)
    : report.recommendation === 'rollback'
      ? await applyRollback(row, report, previousReport)
      : report;

  await saveMonitorReport(row, finalReport);
  return {
    status: 'updated' as const,
    rollbackApplied: finalReport.rollback.status === 'applied',
    rollbackFailed: finalReport.rollback.status === 'failed',
  };
}

export async function runAdvertisingPostActionMonitor(input?: {
  now?: Date;
  limit?: number;
}): Promise<AdvertisingPostActionMonitorRunResult> {
  const now = input?.now ?? new Date();
  const limit = Math.max(1, Math.min(500, Math.round(input?.limit ?? 100)));
  const candidates = await listCandidates(now, limit);
  const result: AdvertisingPostActionMonitorRunResult = {
    checked: candidates.length,
    processed: 0,
    updated: 0,
    skipped: 0,
    rollbackApplied: 0,
    rollbackFailed: 0,
    errors: 0,
  };

  for (const row of candidates) {
    try {
      result.processed += 1;
      const outcome = await processCandidate(row, now);
      if (outcome.status === 'updated') {
        result.updated += 1;
      } else {
        result.skipped += 1;
      }
      if (outcome.rollbackApplied) {
        result.rollbackApplied += 1;
      }
      if (outcome.rollbackFailed) {
        result.rollbackFailed += 1;
      }
    } catch (error) {
      result.errors += 1;
      logger.warn({
        err: error,
        tenantId: row.tenantId,
        changeId: row.id,
      }, '[advertising/post-action-monitor] candidate failed');
    }
  }

  return result;
}
