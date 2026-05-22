import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql, sum } from 'drizzle-orm';

import { AppError } from '@/lib/auth/tenant-access';
import { db, withAdminContext, withTenantContext } from '@/lib/db';
import {
  advertisingClusterActions,
  advertisingAuditLog,
  advertisingAutoBidRuns,
  advertisingAutoBidStrategies,
  advertisingBidChanges,
  advertisingGuardrailEvents,
  products,
  rawApiStocks,
  tenants,
} from '@/lib/db/schema';
import { decryptIfNeeded } from '@/lib/encryption';
import { logger } from '@/lib/logger';
import {
  ADVERTISING_CAPABILITIES,
  type AdvertisingCapabilityItem,
} from '@/lib/advertising/ad-capabilities';
import { estimateBidSavingsRub, computeSelfLearningRunReward } from '@/lib/advertising/math';
import {
  formatAdvertisingPostActionSummary,
  readAdvertisingPostActionMonitor,
  type AdvertisingPostActionMonitorReport,
} from '@/lib/advertising/post-action-monitor';
import {
  checkGuardrails,
  isInLearningPeriod,
  normalizeGuardrailConfig,
  type GuardrailContext,
} from '@/lib/advertising/guardrails';
import {
  createEmptyLearningArm,
  isPositionInRange,
  learningArmKey,
  mergeAutopilotConfigIntoSummary,
  mergeLearningStateIntoSummary,
  normalizeAutopilotConfig,
  pickSelfLearningTarget,
  readAutopilotConfigFromSummary,
  readLearningStateFromSummary,
  type LearningArmKey,
  type StrategyAutopilotConfig,
  type StrategyControlMode,
  type StrategyLearningState,
} from '@/lib/advertising/self-learning';
import {
  computeBanditReward,
  ensureBanditStateMatches,
  pickBanditShadow,
  updateBanditPosterior,
} from '@/lib/advertising/bandits/integration';
import { WbAdActionVerificationError, wbApi, type WbCampaignBidPlacement } from '@/lib/wb-api';
import { sendAdAlert } from '@/server/advertising/send-alert';
import { mapGuardrailToAutoPauseAction } from '@/server/advertising/guardrail-to-alert';
import {
  DEFAULT_BIDDING_MODE,
  DEFAULT_TARGET_CPM_RUB,
  DEFAULT_TARGET_ROAS,
  computeBidPressure,
  normalizeBiddingMode,
  type BiddingMode,
} from '@/lib/advertising/bidding/strategies';
import {
  checkBanditWinner,
  notifyBanditWinner,
  strategyIdToSeed,
} from '@/server/advertising/bandit-winner';

import {
  getAdvertisingClusters,
  toggleAdvertisingCluster,
  type ClusterRiskLevel,
} from './clusters';

const ACTIONABLE_STATUSES = new Set([4, 9, 11]);
const MAX_BID_BATCH_SIZE = 100;
const MAX_BATCH_CLUSTER_LIMIT = 120;
const MAX_BATCH_OPERATIONS = 240;
const MAX_ALERTS = 200;

type TenantAdvertisingAutopilotMode = 'advisor' | 'semi_auto' | 'auto';

function normalizeTenantAdvertisingAutopilotMode(value: unknown): TenantAdvertisingAutopilotMode {
  return value === 'semi_auto' || value === 'auto' ? value : 'advisor';
}

const DEFAULT_BID_GUARDRAIL: AdvertisingBidGuardrail = {
  enabled: true,
  maxAcosPct: 35,
  maxCpoRub: 1200,
  minClicksWithoutOrders: 15,
  preventIncreaseWithoutOrders: true,
};

export type AdvertisingBidGuardrail = {
  enabled: boolean;
  maxAcosPct: number;
  maxCpoRub: number;
  minClicksWithoutOrders: number;
  preventIncreaseWithoutOrders: boolean;
};

export type AdvertisingBidBulkMode = 'set' | 'delta_abs' | 'delta_pct';

export type AdvertisingBidWorkspaceRow = {
  cluster: string;
  currentBid: number;
  adSpend: number;
  views: number;
  clicks: number;
  orders: number;
  ctrPct: number | null;
  cpcRub: number | null;
  cpoRub: number | null;
  avgPos: number | null;
  cvrPct: number | null;
  acosProxyPct: number | null;
};

export type AdvertisingBidWorkspaceResponse = {
  generatedAt: string;
  advertId: number;
  nmId: number;
  rows: AdvertisingBidWorkspaceRow[];
  summary: {
    clusters: number;
    adSpend: number;
    clicks: number;
    orders: number;
    avgBid: number | null;
    highRiskClusters: number;
  };
};

export type AdvertisingBidPreviewRow = {
  cluster: string;
  currentBid: number;
  nextBid: number;
  delta: number;
  changePct: number;
  apply: boolean;
  blockedReason: string | null;
  adSpend: number;
  clicks: number;
  orders: number;
  ctrPct: number | null;
  cpcRub: number | null;
  cpoRub: number | null;
  acosProxyPct: number | null;
};

export type AdvertisingBulkBidResponse = {
  generatedAt: string;
  advertId: number;
  nmId: number;
  dryRun: boolean;
  requiresConfirmation: boolean;
  summary: {
    selectedClusters: number;
    changedClusters: number;
    blockedByGuardrail: number;
    applyCount: number;
    skippedCount: number;
    failedCount: number;
  };
  rows: AdvertisingBidPreviewRow[];
};

export type AdvertisingClusterMapRow = {
  cluster: string;
  status: 'active' | 'excluded' | 'unknown';
  totals: {
    spend: number;
    views: number;
    clicks: number;
    orders: number;
    atbs: number;
    shks: number;
    ctrPct: number | null;
    cpcRub: number | null;
    cpmRub: number | null;
    cpoRub: number | null;
    avgPos: number | null;
  };
  daily: Array<{
    day: string;
    spend: number;
    views: number;
    clicks: number;
    orders: number;
    atbs: number;
    shks: number;
    ctrPct: number | null;
    cpcRub: number | null;
    cpmRub: number | null;
    avgPos: number | null;
  }>;
};

export type AdvertisingClusterMapResponse = {
  generatedAt: string;
  advertId: number;
  nmId: number;
  statsSource: 'wb_api' | 'local_fallback' | 'empty';
  activeCount: number;
  excludedCount: number;
  rows: AdvertisingClusterMapRow[];
};

export type AdvertisingBatchOperationPreview = {
  advertId: number;
  nmId: number;
  cluster: string;
  riskLevel: ClusterRiskLevel;
  riskReason: string | null;
  clicks: number;
  orders: number;
  adSpend: number;
};

export type AdvertisingBatchOperationResponse = {
  generatedAt: string;
  dryRun: boolean;
  requiresConfirmation: boolean;
  summary: {
    sourceClusters: number;
    selectedClusters: number;
    queuedOperations: number;
    applied: number;
    failed: number;
    skipped: number;
  };
  operations: AdvertisingBatchOperationPreview[];
  errors: Array<{ advertId: number; nmId: number; cluster: string; error: string }>;
};

export type AdvertisingAlertSeverity = 'critical' | 'high' | 'medium';

export type AdvertisingAlertItem = {
  id: string;
  type: 'spend_spike_without_orders' | 'ctr_cvr_degradation' | 'brand_anomaly' | 'sku_anomaly';
  severity: AdvertisingAlertSeverity;
  title: string;
  details: string;
  metric: string;
  nmId: number | null;
  cluster: string | null;
  brand: string | null;
  vendorCode: string | null;
};

export type AdvertisingAlertsResponse = {
  generatedAt: string;
  hasData: boolean;
  summary: {
    total: number;
    critical: number;
    high: number;
    medium: number;
  };
  alerts: AdvertisingAlertItem[];
};

export type AdvertisingOperationsStatus = 'ok' | 'warning' | 'critical';

export type AdvertisingOperationsIncident = {
  id: string;
  severity: Exclude<AdvertisingOperationsStatus, 'ok'>;
  title: string;
  details: string;
  count: number;
};

export type AdvertisingActionQueueItem = {
  id: string;
  kind: 'alert' | 'bid_change' | 'cluster_action' | 'campaign_action' | 'strategy_run';
  status: 'needs_attention' | 'blocked' | 'completed' | 'info';
  title: string;
  details: string;
  createdAt: string;
  advertId: number | null;
  nmId: number | null;
  cluster: string | null;
  source: string | null;
};

export type AdvertisingPostActionEffectItem = {
  id: string;
  kind: 'saving' | 'growth' | 'rollback' | 'watch' | 'rolled_back';
  title: string;
  summary: string;
  primaryMetric: string;
  secondaryMetric: string;
  direction: 'raise' | 'lower';
  outcome: 'improved' | 'worse' | 'neutral' | 'insufficient_data';
  recommendation: 'keep' | 'rollback' | 'watch';
  checkedAt: string;
  createdAt: string;
  horizonHours: number;
  bidChange: string;
  scopeLabel: string;
  rollbackStatus: 'not_needed' | 'skipped' | 'applied' | 'failed';
  nextStep: string;
  autoCorrection: string;
  advertId: number;
  nmId: number;
  cluster: string;
  impact: {
    beforeOrders: number;
    afterOrders: number;
    ordersDelta: number;
    beforeSpendRub: number;
    afterSpendRub: number;
    spendDeltaRub: number;
    savingsRub: number;
    beforeRevenueRub: number;
    afterRevenueRub: number;
    revenueDeltaRub: number;
    beforeDrrPct: number | null;
    afterDrrPct: number | null;
    drrDeltaPctPoints: number | null;
  };
};

export type AdvertisingOperationsDailyReport = {
  periodDays: number;
  spendRub: number;
  revenueRub: number;
  orders: number;
  clicks: number;
  drrPct: number | null;
  cpcRub: number | null;
  appliedBidChanges: number;
  loweredBidChanges: number;
  raisedBidChanges: number;
  postActionSavingsRub: number;
  postActionExtraOrders: number;
  postActionRollbackCount: number;
  postActionRolledBackCount: number;
  lines: string[];
};

export type AdvertisingOperationsResponse = {
  generatedAt: string;
  status: AdvertisingOperationsStatus;
  summary: {
    alertsTotal: number;
    criticalAlerts: number;
    highAlerts: number;
    failedBidChanges: number;
    guardrailBlockedBidChanges: number;
    failedClusterActions: number;
    failedStrategyRuns: number;
    campaignVerificationFailures: number;
  };
  incidents: AdvertisingOperationsIncident[];
  dailyReport: AdvertisingOperationsDailyReport;
  capabilities: AdvertisingCapabilityItem[];
  postActionEffects: AdvertisingPostActionEffectItem[];
  queue: AdvertisingActionQueueItem[];
};

export type AdvertisingAutoBidStrategyRecord = {
  id: string;
  name: string;
  advertId: number;
  nmId: number;
  mode: StrategyControlMode;
  targetPositionFrom: number;
  targetPositionTo: number;
  explorationPct: number;
  minClicksForLearning: number;
  retestCooldownHours: number;
  retestPercent: number;
  maxRetestPerRun: number;
  isEnabled: boolean;
  dryRun: boolean;
  biddingMode: BiddingMode;
  targetAcosPct: number;
  targetCpmRub: number;
  targetRoas: number;
  minOrders: number;
  maxCpcRub: number;
  minBid: number;
  maxBid: number;
  stepUpPct: number;
  stepDownPct: number;
  lookbackDays: number;
  intervalMinutes: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastStatus: string | null;
  lastSummary: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type AdvertisingAutoBidRunRecord = {
  id: string;
  strategyId: string;
  triggerSource: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  summary: Record<string, unknown>;
  errorMessage: string | null;
};

export type AdvertisingBidChangeRecord = {
  id: string;
  strategyId: string | null;
  runId: string | null;
  source: string;
  advertId: number;
  nmId: number;
  cluster: string;
  previousBid: number | null;
  nextBid: number | null;
  status: string;
  reason: string | null;
  metrics: Record<string, unknown>;
  createdAt: string;
};

export type AdvertisingAutoBidWorkspaceResponse = {
  generatedAt: string;
  strategies: AdvertisingAutoBidStrategyRecord[];
  runs: AdvertisingAutoBidRunRecord[];
  recentChanges: AdvertisingBidChangeRecord[];
};

export type SaveAdvertisingAutoBidStrategyInput = {
  id?: string;
  name: string;
  advertId: number;
  nmId: number;
  mode?: StrategyControlMode;
  targetPositionFrom?: number;
  targetPositionTo?: number;
  explorationPct?: number;
  minClicksForLearning?: number;
  retestCooldownHours?: number;
  retestPercent?: number;
  maxRetestPerRun?: number;
  isEnabled: boolean;
  dryRun: boolean;
  biddingMode?: BiddingMode;
  targetAcosPct: number;
  targetCpmRub?: number;
  targetRoas?: number;
  minOrders: number;
  maxCpcRub: number;
  minBid: number;
  maxBid: number;
  stepUpPct: number;
  stepDownPct: number;
  lookbackDays: number;
  intervalMinutes: number;
};

function toUtcDayStart(value: Date) {
  const next = new Date(value);
  next.setUTCHours(0, 0, 0, 0);
  return next;
}

function addUtcDays(value: Date, days: number) {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function formatApiDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function toNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toInt(value: unknown) {
  return Math.round(toNumber(value));
}

function round(value: number, precision = 2) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function toNullableRatio(numerator: number, denominator: number, precision = 2) {
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  return round(numerator / denominator, precision);
}

function toNullablePct(numerator: number, denominator: number, precision = 2) {
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  return round((numerator / denominator) * 100, precision);
}

function normalizeCluster(value: string) {
  return String(value ?? '').trim().toLocaleLowerCase('ru-RU');
}

function clampInt(value: number, minValue: number, maxValue: number) {
  return Math.max(minValue, Math.min(maxValue, Math.round(value)));
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function computeNextRunAt(intervalMinutes: number, baseDate = new Date()) {
  return new Date(baseDate.getTime() + intervalMinutes * 60_000);
}

async function runExcludedClusterRetest(
  strategy: typeof advertisingAutoBidStrategies.$inferSelect,
  options: { userId: string | null; dryRun: boolean; config: StrategyAutopilotConfig },
) {
  const result = {
    candidates: 0,
    selected: 0,
    included: 0,
    failed: 0,
    clusters: [] as string[],
    errors: [] as string[],
  };

  if (options.config.maxRetestPerRun <= 0 || options.config.retestPercent <= 0) {
    return result;
  }

  const token = await getTenantWbToken(strategy.tenantId);
  const [minusItem] = await wbApi.getCampaignMinusPhrases(token, [{
    advertId: Number(strategy.advertId),
    nmId: Number(strategy.nmId),
  }]);

  const minusPhrases = Array.isArray(minusItem?.normQueries)
    ? minusItem.normQueries.map((value) => String(value).trim()).filter((value) => value.length > 0)
    : [];

  if (minusPhrases.length === 0) {
    return result;
  }

  result.candidates = minusPhrases.length;
  const normalizedMinusSet = new Set(minusPhrases.map((phrase) => normalizeCluster(phrase)));

  const actions = await withTenantContext(db, strategy.tenantId, async (tx) =>
    tx.select({
      cluster: advertisingClusterActions.cluster,
      action: advertisingClusterActions.action,
      createdAt: advertisingClusterActions.createdAt,
    })
      .from(advertisingClusterActions)
      .where(and(
        eq(advertisingClusterActions.tenantId, strategy.tenantId),
        eq(advertisingClusterActions.advertId, Number(strategy.advertId)),
        eq(advertisingClusterActions.nmId, Number(strategy.nmId)),
      ))
      .orderBy(desc(advertisingClusterActions.createdAt))
      .limit(800),
  );

  const lastActionByCluster = new Map<string, { action: string; createdAt: Date }>();
  for (const row of actions) {
    const key = normalizeCluster(row.cluster);
    if (!normalizedMinusSet.has(key) || lastActionByCluster.has(key)) {
      continue;
    }
    lastActionByCluster.set(key, {
      action: String(row.action ?? ''),
      createdAt: row.createdAt,
    });
  }

  const cooldownMs = options.config.retestCooldownHours * 60 * 60 * 1000;
  const nowMs = Date.now();

  const eligible = minusPhrases.filter((cluster) => {
    const key = normalizeCluster(cluster);
    const lastAction = lastActionByCluster.get(key);
    if (!lastAction) {
      return true;
    }
    if (lastAction.action === 'include') {
      return false;
    }
    return nowMs - lastAction.createdAt.getTime() >= cooldownMs;
  });

  if (eligible.length === 0) {
    return result;
  }

  const byPercent = Math.max(1, Math.round((eligible.length * options.config.retestPercent) / 100));
  const limit = Math.max(0, Math.min(options.config.maxRetestPerRun, byPercent));
  const selected = eligible.slice(0, limit);
  result.selected = selected.length;
  if (selected.length === 0) {
    return result;
  }

  if (options.dryRun) {
    result.clusters = selected;
    return result;
  }

  const selectedSet = new Set(selected.map((item) => normalizeCluster(item)));
  const nextMinus = minusPhrases.filter((phrase) => !selectedSet.has(normalizeCluster(phrase)));

  try {
    await wbApi.setCampaignMinusPhrases(
      token,
      Number(strategy.advertId),
      Number(strategy.nmId),
      nextMinus,
    );
    result.included = selected.length;
    result.clusters = selected;

    // Transactionally insert the success audit rows as a single unit.
    await withTenantContext(db, strategy.tenantId, async (tx) => {
      await tx.insert(advertisingClusterActions).values(
        selected.map((cluster) => ({
          tenantId: strategy.tenantId,
          userId: options.userId,
          advertId: Number(strategy.advertId),
          nmId: Number(strategy.nmId),
          cluster,
          action: 'include',
          status: 'success',
          beforeMinusCount: minusPhrases.length,
          afterMinusCount: nextMinus.length,
          meta: {
            changed: true,
            reason: 'auto_retest',
          },
        })),
      );
    });
  } catch (error) {
    result.failed = selected.length;
    result.errors.push(error instanceof Error ? error.message : String(error));
    logger.warn(
      {
        err: error,
        tenantId: strategy.tenantId,
        advertId: Number(strategy.advertId),
        nmId: Number(strategy.nmId),
        selectedCount: selected.length,
      },
      '[advertising/workspace] setCampaignMinusPhrases retest failed',
    );
    await withTenantContext(db, strategy.tenantId, async (tx) => {
      await tx.insert(advertisingClusterActions).values(
        selected.map((cluster) => ({
          tenantId: strategy.tenantId,
          userId: options.userId,
          advertId: Number(strategy.advertId),
          nmId: Number(strategy.nmId),
          cluster,
          action: 'include',
          status: 'failed',
          beforeMinusCount: minusPhrases.length,
          afterMinusCount: minusPhrases.length,
          errorMessage: result.errors[0],
          meta: {
            reason: 'auto_retest_failed',
          },
        })),
      );
    });
  }

  return result;
}

function severityRank(value: AdvertisingAlertSeverity) {
  if (value === 'critical') {
    return 0;
  }
  if (value === 'high') {
    return 1;
  }
  return 2;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
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

type ClusterPerformanceMetrics = {
  cluster: string;
  adSpend: number;
  views: number;
  clicks: number;
  orders: number;
  ctrPct: number | null;
  cpcRub: number | null;
  cpoRub: number | null;
  cvrPct: number | null;
  acosProxyPct: number | null;
};

async function getClusterPerformanceByNm(
  tenantId: string,
  nmId: number,
  dateFrom: Date,
  dateTo: Date,
) {
  const from = toUtcDayStart(dateFrom);
  const to = toUtcDayStart(dateTo);
  const toExclusive = addUtcDays(to, 1);

  const rows = await withTenantContext(db, tenantId, async (tx) => tx.execute(sql`
    WITH sales_base AS (
      SELECT
        COALESCE(SUM(price_with_discount), 0)::numeric AS nm_revenue,
        COUNT(*)::bigint AS nm_sales_count
      FROM raw_api_sales
      WHERE tenant_id = ${tenantId}
        AND nm_id = ${nmId}
        AND is_storno = false
        AND date >= ${from.toISOString()}::timestamp
        AND date < ${toExclusive.toISOString()}::timestamp
    )
    SELECT
      c.cluster,
      SUM(c.amount)::numeric AS ad_spend,
      SUM(c.views)::bigint AS views,
      SUM(c.clicks)::bigint AS clicks,
      SUM(c.order_count)::bigint AS orders,
      (SELECT nm_revenue FROM sales_base) AS nm_revenue,
      (SELECT nm_sales_count FROM sales_base) AS nm_sales_count
    FROM raw_api_ad_clusters c
    WHERE c.tenant_id = ${tenantId}
      AND c.nm_id = ${nmId}
      AND c.date >= ${from.toISOString()}::timestamp
      AND c.date < ${toExclusive.toISOString()}::timestamp
    GROUP BY c.cluster
  `));

  const byCluster = new Map<string, ClusterPerformanceMetrics>();

  for (const rawRow of rows) {
    const row = rawRow as Record<string, unknown>;
    const cluster = String(row.cluster ?? '').trim();
    if (!cluster) {
      continue;
    }

    const adSpend = round(toNumber(row.ad_spend), 2);
    const views = Math.max(0, toInt(row.views));
    const clicks = Math.max(0, toInt(row.clicks));
    const orders = Math.max(0, toInt(row.orders));
    const nmRevenue = round(toNumber(row.nm_revenue), 2);
    const nmSalesCount = Math.max(0, toInt(row.nm_sales_count));
    const avgOrderValue = toNullableRatio(nmRevenue, nmSalesCount, 2);
    const revenueProxy = avgOrderValue === null ? null : round(avgOrderValue * orders, 2);

    byCluster.set(normalizeCluster(cluster), {
      cluster,
      adSpend,
      views,
      clicks,
      orders,
      ctrPct: toNullablePct(clicks, views),
      cpcRub: toNullableRatio(adSpend, clicks),
      cpoRub: toNullableRatio(adSpend, orders),
      cvrPct: toNullablePct(orders, clicks),
      acosProxyPct: revenueProxy === null ? null : toNullablePct(adSpend, revenueProxy),
    });
  }

  return byCluster;
}

async function getCardBidPerformanceMetrics(
  tenantId: string,
  advertId: number,
  nmId: number,
  dateFrom: Date,
  dateTo: Date,
): Promise<ClusterPerformanceMetrics> {
  const fromDate = formatApiDate(toUtcDayStart(dateFrom));
  const toDate = formatApiDate(toUtcDayStart(dateTo));
  const rows = await withTenantContext(db, tenantId, (tx) => tx.execute(sql`
    SELECT
      COALESCE(SUM(ad_spend), 0)::numeric AS ad_spend,
      COALESCE(SUM(views), 0)::bigint AS views,
      COALESCE(SUM(clicks), 0)::bigint AS clicks,
      COALESCE(SUM(order_count), 0)::bigint AS orders,
      COALESCE(SUM(order_sum), 0)::numeric AS revenue
    FROM advertising_hourly_stats
    WHERE tenant_id = ${tenantId}
      AND advert_id = ${advertId}
      AND nm_id = ${nmId}
      AND stat_date >= ${fromDate}::date
      AND stat_date <= ${toDate}::date
  `));
  const row = (rows[0] ?? {}) as Record<string, unknown>;
  const adSpend = round(toNumber(row.ad_spend), 2);
  const views = Math.max(0, toInt(row.views));
  const clicks = Math.max(0, toInt(row.clicks));
  const orders = Math.max(0, toInt(row.orders));
  const revenue = round(toNumber(row.revenue), 2);

  return {
    cluster: 'CPC ставка поиска',
    adSpend,
    views,
    clicks,
    orders,
    ctrPct: toNullablePct(clicks, views),
    cpcRub: toNullableRatio(adSpend, clicks),
    cpoRub: toNullableRatio(adSpend, orders),
    cvrPct: toNullablePct(orders, clicks),
    acosProxyPct: toNullablePct(adSpend, revenue),
  };
}

function getGuardrailReason(
  guardrail: AdvertisingBidGuardrail,
  metrics: ClusterPerformanceMetrics,
  currentBid: number,
  nextBid: number,
) {
  if (!guardrail.enabled || nextBid <= currentBid) {
    return null;
  }

  if (
    guardrail.preventIncreaseWithoutOrders
    && metrics.orders <= 0
    && metrics.clicks >= guardrail.minClicksWithoutOrders
  ) {
    return `Guardrail: клики есть (${metrics.clicks}), заказов нет. Повышение ставки запрещено.`;
  }

  if (metrics.acosProxyPct !== null && metrics.acosProxyPct > guardrail.maxAcosPct) {
    return `Guardrail: ДРР proxy ${metrics.acosProxyPct}% выше лимита ${guardrail.maxAcosPct}%.`;
  }

  if (metrics.cpoRub !== null && metrics.cpoRub > guardrail.maxCpoRub) {
    return `Guardrail: CPO ${metrics.cpoRub} ₽ выше лимита ${guardrail.maxCpoRub} ₽.`;
  }

  return null;
}

function calcNextBid(currentBid: number, mode: AdvertisingBidBulkMode, value: number) {
  if (mode === 'set') {
    return value;
  }
  if (mode === 'delta_abs') {
    return currentBid + value;
  }
  return currentBid * (1 + value / 100);
}

function toBidChangePct(currentBid: number, nextBid: number) {
  if (!Number.isFinite(currentBid) || currentBid <= 0) {
    return 0;
  }
  return round(((nextBid - currentBid) / currentBid) * 100, 2);
}

export async function getAdvertisingBidWorkspace(
  tenantId: string,
  params: {
    advertId: number;
    nmId: number;
    dateFrom: Date;
    dateTo: Date;
    includeRemoteStats?: boolean;
    signal?: AbortSignal;
  },
): Promise<AdvertisingBidWorkspaceResponse> {
  const advertId = Number(params.advertId);
  const nmId = Number(params.nmId);

  if (!Number.isFinite(advertId) || advertId <= 0) {
    throw new AppError('Некорректный advertId', 400);
  }
  if (!Number.isFinite(nmId) || nmId <= 0) {
    throw new AppError('Некорректный nmId', 400);
  }

  const token = await getTenantWbToken(tenantId);
  const from = formatApiDate(toUtcDayStart(params.dateFrom));
  const to = formatApiDate(toUtcDayStart(params.dateTo));
  const includeRemoteStats = params.includeRemoteStats !== false;

  const [metricsByCluster, bids, stats, normQueryLists] = await Promise.all([
    getClusterPerformanceByNm(tenantId, nmId, params.dateFrom, params.dateTo),
    wbApi.getSearchClusterBids(token, [{ advertId, nmId }], { signal: params.signal }).catch((error) => {
      logger.warn(
        { err: error, tenantId, advertId, nmId },
        '[Advertising Workspace] getSearchClusterBids failed, fallback to local cluster facts',
      );
      return [] as Awaited<ReturnType<typeof wbApi.getSearchClusterBids>>;
    }),
    includeRemoteStats
      ? wbApi.getSearchClusterStats(token, from, to, [{ advertId, nmId }], { signal: params.signal }).catch((error) => {
          logger.warn(
            { err: error, tenantId, advertId, nmId },
            '[Advertising Workspace] getSearchClusterStats failed, fallback to local cluster facts',
          );
          return [] as Awaited<ReturnType<typeof wbApi.getSearchClusterStats>>;
        })
      : Promise.resolve([] as Awaited<ReturnType<typeof wbApi.getSearchClusterStats>>),
    includeRemoteStats
      ? wbApi.getNormQueryList(token, [{ advertId, nmId }], { signal: params.signal }).catch((error) => {
          logger.warn(
            { err: error, tenantId, advertId, nmId },
            '[Advertising Workspace] getNormQueryList failed while loading bids workspace',
          );
          return [] as Awaited<ReturnType<typeof wbApi.getNormQueryList>>;
        })
      : Promise.resolve([] as Awaited<ReturnType<typeof wbApi.getNormQueryList>>),
  ]);

  const avgPosByCluster = new Map<string, { sum: number; count: number }>();
  const clusterNameByKey = new Map<string, string>();
  for (const stat of stats) {
    const cluster = String(stat.keyword ?? '').trim();
    if (!cluster || stat.avgPos === undefined || !Number.isFinite(stat.avgPos)) {
      continue;
    }
    const clusterKey = normalizeCluster(cluster);
    if (!clusterNameByKey.has(clusterKey)) {
      clusterNameByKey.set(clusterKey, cluster);
    }
    const item = avgPosByCluster.get(clusterKey) ?? { sum: 0, count: 0 };
    item.sum += toNumber(stat.avgPos);
    item.count += 1;
    avgPosByCluster.set(clusterKey, item);
  }

  const bidByCluster = new Map<string, Awaited<ReturnType<typeof wbApi.getSearchClusterBids>>[number]>();
  for (const bidRow of bids) {
    const clusterKey = normalizeCluster(bidRow.keyword);
    if (!clusterKey) {
      continue;
    }
    if (!bidByCluster.has(clusterKey)) {
      bidByCluster.set(clusterKey, bidRow);
    }
    if (!clusterNameByKey.has(clusterKey)) {
      clusterNameByKey.set(clusterKey, bidRow.keyword);
    }
  }

  const includeFallbackClusters = bids.length === 0;
  if (includeFallbackClusters) {
    for (const [clusterKey, metrics] of metricsByCluster.entries()) {
      if (!clusterNameByKey.has(clusterKey)) {
        clusterNameByKey.set(clusterKey, metrics.cluster);
      }
    }
    const listRow = normQueryLists.find((item) => item.advertId === advertId && item.nmId === nmId) ?? null;
    for (const cluster of listRow?.active ?? []) {
      const clusterKey = normalizeCluster(cluster);
      if (!clusterNameByKey.has(clusterKey)) {
        clusterNameByKey.set(clusterKey, cluster);
      }
    }
    for (const cluster of listRow?.excluded ?? []) {
      const clusterKey = normalizeCluster(cluster);
      if (!clusterNameByKey.has(clusterKey)) {
        clusterNameByKey.set(clusterKey, cluster);
      }
    }
  }

  const clusterKeys = includeFallbackClusters
    ? new Set<string>([
        ...clusterNameByKey.keys(),
        ...metricsByCluster.keys(),
        ...avgPosByCluster.keys(),
      ])
    : new Set<string>(bidByCluster.keys());

  const rows: AdvertisingBidWorkspaceRow[] = [...clusterKeys]
    .map((clusterKey) => {
      const bidRow = bidByCluster.get(clusterKey);
      const metrics = metricsByCluster.get(clusterKey);
      const avgPosAgg = avgPosByCluster.get(clusterKey);
      return {
        cluster: clusterNameByKey.get(clusterKey) ?? metrics?.cluster ?? clusterKey,
        currentBid: Math.max(0, toInt(bidRow?.bid)),
        adSpend: metrics?.adSpend ?? 0,
        views: metrics?.views ?? 0,
        clicks: metrics?.clicks ?? 0,
        orders: metrics?.orders ?? 0,
        ctrPct: metrics?.ctrPct ?? null,
        cpcRub: metrics?.cpcRub ?? null,
        cpoRub: metrics?.cpoRub ?? null,
        avgPos: avgPosAgg && avgPosAgg.count > 0 ? round(avgPosAgg.sum / avgPosAgg.count, 2) : null,
        cvrPct: metrics?.cvrPct ?? null,
        acosProxyPct: metrics?.acosProxyPct ?? null,
      };
    })
    .sort((left, right) => {
      if (right.adSpend !== left.adSpend) {
        return right.adSpend - left.adSpend;
      }
      if (right.clicks !== left.clicks) {
        return right.clicks - left.clicks;
      }
      return left.cluster.localeCompare(right.cluster, 'ru-RU');
    });

  const summary = {
    clusters: rows.length,
    adSpend: round(rows.reduce((sum, row) => sum + row.adSpend, 0), 2),
    clicks: rows.reduce((sum, row) => sum + row.clicks, 0),
    orders: rows.reduce((sum, row) => sum + row.orders, 0),
    avgBid: rows.length > 0
      ? round(rows.reduce((sum, row) => sum + row.currentBid, 0) / rows.length, 2)
      : null,
    highRiskClusters: rows.filter((row) => row.clicks >= 15 && row.orders === 0).length,
  };

  return {
    generatedAt: new Date().toISOString(),
    advertId,
    nmId,
    rows,
    summary,
  };
}

async function previewBulkBidUpdate(
  tenantId: string,
  params: {
    advertId: number;
    nmId: number;
    dateFrom: Date;
    dateTo: Date;
    mode: AdvertisingBidBulkMode;
    value: number;
    clusters?: string[];
    minBid?: number;
    maxBid?: number;
    guardrail?: Partial<AdvertisingBidGuardrail>;
    fastPreview?: boolean;
    signal?: AbortSignal;
  },
) {
  const workspace = await getAdvertisingBidWorkspace(tenantId, {
    advertId: params.advertId,
    nmId: params.nmId,
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
    includeRemoteStats: !params.fastPreview,
    signal: params.signal,
  });

  const selectedClusters = Array.isArray(params.clusters)
    ? params.clusters.map((item) => String(item).trim()).filter((item) => item.length > 0)
    : [];
  const selectedSet = new Set(selectedClusters.map((item) => normalizeCluster(item)));

  const targetRows = workspace.rows.filter((row) => (
    selectedSet.size === 0 || selectedSet.has(normalizeCluster(row.cluster))
  ));
  if (targetRows.length === 0) {
    throw new AppError('Нет кластеров для изменения ставок', 400);
  }

  if (targetRows.every((row) => row.currentBid <= 0)) {
    throw new AppError('WB не вернул текущие ставки по кластерам. Повторите позже или откройте вкладку «Ставки».', 503);
  }

  const guardrail: AdvertisingBidGuardrail = {
    ...DEFAULT_BID_GUARDRAIL,
    ...params.guardrail,
  };

  const minBid = Math.max(0, Math.round(params.minBid ?? 100));
  const maxBid = Math.max(minBid, Math.round(params.maxBid ?? 10_000));

  const rows: AdvertisingBidPreviewRow[] = targetRows.map((row) => {
    const rawNextBid = calcNextBid(row.currentBid, params.mode, params.value);
    const nextBid = clampInt(rawNextBid, minBid, maxBid);
    const delta = nextBid - row.currentBid;

    const metrics: ClusterPerformanceMetrics = {
      cluster: row.cluster,
      adSpend: row.adSpend,
      views: row.views,
      clicks: row.clicks,
      orders: row.orders,
      ctrPct: row.ctrPct,
      cpcRub: row.cpcRub,
      cpoRub: row.cpoRub,
      cvrPct: row.cvrPct,
      acosProxyPct: row.acosProxyPct,
    };

    const blockedReason = getGuardrailReason(guardrail, metrics, row.currentBid, nextBid);
    const changed = nextBid !== row.currentBid;

    return {
      cluster: row.cluster,
      currentBid: row.currentBid,
      nextBid,
      delta,
      changePct: toBidChangePct(row.currentBid, nextBid),
      apply: changed && !blockedReason,
      blockedReason,
      adSpend: row.adSpend,
      clicks: row.clicks,
      orders: row.orders,
      ctrPct: row.ctrPct,
      cpcRub: row.cpcRub,
      cpoRub: row.cpoRub,
      acosProxyPct: row.acosProxyPct,
    };
  });

  const blockedByGuardrail = rows.filter((row) => row.blockedReason !== null && row.nextBid !== row.currentBid).length;
  const changedClusters = rows.filter((row) => row.nextBid !== row.currentBid).length;
  const applyCount = rows.filter((row) => row.apply).length;

  return {
    rows,
    summary: {
      selectedClusters: rows.length,
      changedClusters,
      blockedByGuardrail,
      applyCount,
      skippedCount: rows.length - applyCount,
    },
  };
}

export async function executeBulkBidUpdate(
  tenantId: string,
  params: {
    userId: string | null;
    advertId: number;
    nmId: number;
    dateFrom: Date;
    dateTo: Date;
    mode: AdvertisingBidBulkMode;
    value: number;
    clusters?: string[];
    minBid?: number;
    maxBid?: number;
    guardrail?: Partial<AdvertisingBidGuardrail>;
    dryRun: boolean;
    confirmed: boolean;
    source?: 'manual' | 'batch' | 'auto' | 'pacing' | 'portfolio' | 'post_action';
    strategyId?: string | null;
    runId?: string | null;
    fastPreview?: boolean;
    signal?: AbortSignal;
  },
): Promise<AdvertisingBulkBidResponse> {
  const preview = await previewBulkBidUpdate(tenantId, {
    advertId: params.advertId,
    nmId: params.nmId,
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
    mode: params.mode,
    value: params.value,
    clusters: params.clusters,
    minBid: params.minBid,
    maxBid: params.maxBid,
    guardrail: params.guardrail,
    fastPreview: params.fastPreview,
    signal: params.signal,
  });

  if (params.dryRun) {
    return {
      generatedAt: new Date().toISOString(),
      advertId: params.advertId,
      nmId: params.nmId,
      dryRun: true,
      requiresConfirmation: false,
      summary: {
        ...preview.summary,
        failedCount: 0,
      },
      rows: preview.rows,
    };
  }

  if (!params.confirmed && preview.summary.applyCount > 0) {
    return {
      generatedAt: new Date().toISOString(),
      advertId: params.advertId,
      nmId: params.nmId,
      dryRun: false,
      requiresConfirmation: true,
      summary: {
        ...preview.summary,
        failedCount: 0,
      },
      rows: preview.rows,
    };
  }

  const token = await getTenantWbToken(tenantId);
  const applyRows = preview.rows.filter((row) => row.apply);
  const failedClusters = new Set<string>();

  for (const batch of chunkArray(applyRows, MAX_BID_BATCH_SIZE)) {
    try {
      await wbApi.setSearchClusterBids(
        token,
        batch.map((row) => ({
          advertId: params.advertId,
          nmId: params.nmId,
          keyword: row.cluster,
          bid: row.nextBid,
        })),
        { signal: params.signal },
      );
    } catch (error) {
      if (error instanceof WbAdActionVerificationError) {
        for (const item of error.failedItems) {
          if (item.keyword) {
            failedClusters.add(normalizeCluster(item.keyword));
          }
        }
      }
      logger.warn(
        {
          err: error,
          tenantId,
          advertId: params.advertId,
          nmId: params.nmId,
          clusters: batch.length,
          source: params.source ?? 'manual',
          runId: params.runId ?? null,
        },
        '[advertising/workspace] setSearchClusterBids batch failed',
      );
      if (!(error instanceof WbAdActionVerificationError)) {
        for (const item of batch) {
          failedClusters.add(normalizeCluster(item.cluster));
        }
      }
    }
  }

  const source = params.source ?? 'manual';
  // Idempotency base: for auto/batch runs use runId, for manual — a stable
  // combination of (user + advert + day bucket) to absorb double-click retries.
  const idempotencyBase = params.runId
    ?? `${source}:${params.userId ?? 'anon'}:${params.advertId}:${params.nmId}:${new Date().toISOString().slice(0, 10)}`;
  const logs = preview.rows
    .filter((row) => row.nextBid !== row.currentBid || row.blockedReason !== null)
    .map((row) => {
      const normalizedCluster = normalizeCluster(row.cluster);
      const isFailed = failedClusters.has(normalizedCluster);

      const status = row.blockedReason
        ? 'guardrail_blocked'
        : row.nextBid === row.currentBid
          ? 'skipped'
          : isFailed
            ? 'failed'
            : 'applied';

      return {
        tenantId,
        strategyId: params.strategyId ?? null,
        runId: params.runId ?? null,
        userId: params.userId,
        source,
        advertId: params.advertId,
        nmId: params.nmId,
        cluster: row.cluster,
        previousBid: row.currentBid,
        nextBid: row.nextBid,
        status,
        reason: row.blockedReason ?? null,
        idempotencyKey: `${idempotencyBase}:${params.nmId}:${normalizedCluster}`,
        metrics: {
          adSpend: row.adSpend,
          clicks: row.clicks,
          orders: row.orders,
          ctrPct: row.ctrPct,
          cpcRub: row.cpcRub,
          cpoRub: row.cpoRub,
          acosProxyPct: row.acosProxyPct,
          changePct: row.changePct,
          delta: row.delta,
        },
      };
    });

  // Wrap audit-log inserts in a transaction so partial writes never land in the
  // bid_changes table. WB API calls above are external and cannot be rolled back,
  // but the audit trail is guaranteed all-or-nothing.
  // onConflictDoNothing deduplicates rows when Inngest retries this step after a
  // transient error (idempotency_key is unique per (tenantId, idempotencyKey)).
  if (logs.length > 0) {
    await withTenantContext(db, tenantId, async (tx) => {
      await tx.insert(advertisingBidChanges).values(logs).onConflictDoNothing();
    });
  }

  const failedCount = logs.filter((row) => row.status === 'failed').length;
  const appliedCount = logs.filter((row) => row.status === 'applied').length;

  const rows = preview.rows.map((row) => {
    const normalizedCluster = normalizeCluster(row.cluster);
    const failed = failedClusters.has(normalizedCluster);
    if (!row.apply || !failed) {
      return row;
    }
    return {
      ...row,
      apply: false,
      blockedReason: 'WB API не подтвердил изменение ставки для этого кластера.',
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    advertId: params.advertId,
    nmId: params.nmId,
    dryRun: false,
    requiresConfirmation: false,
    summary: {
      selectedClusters: preview.summary.selectedClusters,
      changedClusters: preview.summary.changedClusters,
      blockedByGuardrail: preview.summary.blockedByGuardrail,
      applyCount: appliedCount,
      skippedCount: preview.summary.selectedClusters - appliedCount,
      failedCount,
    },
    rows,
  };
}

export async function executeCampaignCardBidUpdate(
  tenantId: string,
  params: {
    userId: string | null;
    advertId: number;
    nmId: number;
    dateFrom: Date;
    dateTo: Date;
    mode: AdvertisingBidBulkMode;
    value: number;
    placement: WbCampaignBidPlacement;
    paymentType: 'cpm' | 'cpc';
    minBid?: number;
    maxBid?: number;
    guardrail?: Partial<AdvertisingBidGuardrail>;
    dryRun: boolean;
    confirmed: boolean;
    source?: 'manual' | 'batch' | 'auto' | 'pacing' | 'portfolio' | 'post_action';
    strategyId?: string | null;
    runId?: string | null;
    signal?: AbortSignal;
  },
): Promise<AdvertisingBulkBidResponse> {
  const advertId = Number(params.advertId);
  const nmId = Number(params.nmId);
  if (!Number.isFinite(advertId) || advertId <= 0) {
    throw new AppError('Некорректный advertId', 400);
  }
  if (!Number.isFinite(nmId) || nmId <= 0) {
    throw new AppError('Некорректный nmId', 400);
  }

  const token = await getTenantWbToken(tenantId);
  const [campaign] = await wbApi.getAdCampaignsByAdvertIds(token, [advertId], { signal: params.signal });
  const nmSetting = campaign?.nmSettings.find((item) => item.nmId === nmId) ?? null;
  const currentBid = Math.max(0, Math.round(nmSetting?.bidsKopecks[params.placement] ?? 0));
  if (!campaign || !nmSetting || currentBid <= 0) {
    throw new AppError('WB не вернул текущую ставку карточки для этой CPC-кампании.', 503);
  }

  const minimumBids = await wbApi.getMinimumCampaignBids(token, {
    advertId,
    nmIds: [nmId],
    paymentType: params.paymentType,
    placementTypes: [params.placement === 'search' ? 'search' : 'recommendation'],
  }, { signal: params.signal }).catch((error) => {
    logger.warn(
      { err: error, tenantId, advertId, nmId, placement: params.placement },
      '[advertising/workspace] getMinimumCampaignBids failed, fallback to configured minBid',
    );
    return [] as Awaited<ReturnType<typeof wbApi.getMinimumCampaignBids>>;
  });
  const wbMinBid = minimumBids.find((item) => item.nmId === nmId && item.placement === params.placement)?.value ?? null;
  const minBid = Math.max(100, Math.round(params.minBid ?? 0), Math.round(wbMinBid ?? 0));
  const maxBid = Math.max(minBid, Math.round(params.maxBid ?? 100_000));
  const nextBid = clampInt(calcNextBid(currentBid, params.mode, params.value), minBid, maxBid);
  const metrics = await getCardBidPerformanceMetrics(tenantId, advertId, nmId, params.dateFrom, params.dateTo);
  const guardrail: AdvertisingBidGuardrail = {
    ...DEFAULT_BID_GUARDRAIL,
    ...params.guardrail,
  };
  const blockedReason = getGuardrailReason(guardrail, metrics, currentBid, nextBid);
  const changed = nextBid !== currentBid;
  const paymentLabel = params.paymentType.toUpperCase();
  const row: AdvertisingBidPreviewRow = {
    cluster: params.placement === 'search' ? `${paymentLabel} ставка поиска` : `${paymentLabel} ставка рекомендаций`,
    currentBid,
    nextBid,
    delta: nextBid - currentBid,
    changePct: toBidChangePct(currentBid, nextBid),
    apply: changed && !blockedReason,
    blockedReason,
    adSpend: metrics.adSpend,
    clicks: metrics.clicks,
    orders: metrics.orders,
    ctrPct: metrics.ctrPct,
    cpcRub: metrics.cpcRub,
    cpoRub: metrics.cpoRub,
    acosProxyPct: metrics.acosProxyPct,
  };
  const summary = {
    selectedClusters: 1,
    changedClusters: changed ? 1 : 0,
    blockedByGuardrail: blockedReason && changed ? 1 : 0,
    applyCount: row.apply ? 1 : 0,
    skippedCount: row.apply ? 0 : 1,
    failedCount: 0,
  };

  if (params.dryRun || (!params.confirmed && row.apply)) {
    return {
      generatedAt: new Date().toISOString(),
      advertId,
      nmId,
      dryRun: params.dryRun,
      requiresConfirmation: !params.dryRun && row.apply,
      summary,
      rows: [row],
    };
  }

  let failed = false;
  if (row.apply) {
    try {
      await wbApi.setCampaignBids(token, [{
        advertId,
        nmId,
        bidKopecks: nextBid,
        placement: params.placement,
      }], { signal: params.signal });
    } catch (error) {
      failed = true;
      logger.warn(
        { err: error, tenantId, advertId, nmId, placement: params.placement, source: params.source ?? 'manual' },
        '[advertising/workspace] setCampaignBids failed',
      );
    }
  }

  const source = params.source ?? 'manual';
  const normalizedCluster = normalizeCluster(row.cluster);
  const status = row.blockedReason
    ? 'guardrail_blocked'
    : !row.apply
      ? 'skipped'
      : failed
        ? 'failed'
        : 'applied';
  const idempotencyBase = params.runId
    ?? `${source}:${params.userId ?? 'anon'}:${advertId}:${nmId}:${new Date().toISOString().slice(0, 10)}`;

  await withTenantContext(db, tenantId, async (tx) => {
    await tx.insert(advertisingBidChanges).values({
      tenantId,
      strategyId: params.strategyId ?? null,
      runId: params.runId ?? null,
      userId: params.userId,
      source,
      advertId,
      nmId,
      cluster: row.cluster,
      previousBid: currentBid,
      nextBid,
      status,
      reason: row.blockedReason ?? (failed ? 'WB API не применил изменение CPC-ставки карточки.' : null),
      idempotencyKey: `${idempotencyBase}:${nmId}:${normalizedCluster}`,
      metrics: {
        actionSurface: 'campaign_card_bid',
        paymentType: params.paymentType,
        placement: params.placement,
        minBid,
        wbMinBid,
        adSpend: row.adSpend,
        clicks: row.clicks,
        orders: row.orders,
        ctrPct: row.ctrPct,
        cpcRub: row.cpcRub,
        cpoRub: row.cpoRub,
        acosProxyPct: row.acosProxyPct,
        changePct: row.changePct,
        delta: row.delta,
      },
    }).onConflictDoNothing();
  });

  return {
    generatedAt: new Date().toISOString(),
    advertId,
    nmId,
    dryRun: false,
    requiresConfirmation: false,
    summary: {
      ...summary,
      applyCount: row.apply && !failed ? 1 : 0,
      skippedCount: row.apply && !failed ? 0 : 1,
      failedCount: failed ? 1 : 0,
    },
    rows: failed
      ? [{ ...row, apply: false, blockedReason: 'WB API не применил изменение CPC-ставки карточки.' }]
      : [row],
  };
}

export async function getAdvertisingClusterMap(
  tenantId: string,
  params: {
    advertId: number;
    nmId: number;
    dateFrom: Date;
    dateTo: Date;
  },
): Promise<AdvertisingClusterMapResponse> {
  const advertId = Number(params.advertId);
  const nmId = Number(params.nmId);
  if (!Number.isFinite(advertId) || advertId <= 0) {
    throw new AppError('Некорректный advertId', 400);
  }
  if (!Number.isFinite(nmId) || nmId <= 0) {
    throw new AppError('Некорректный nmId', 400);
  }

  const token = await getTenantWbToken(tenantId);
  const from = formatApiDate(toUtcDayStart(params.dateFrom));
  const to = formatApiDate(toUtcDayStart(params.dateTo));
  const fromDate = toUtcDayStart(params.dateFrom);
  const toExclusiveDate = addUtcDays(toUtcDayStart(params.dateTo), 1);

  const [lists, statsFromApi] = await Promise.all([
    wbApi.getNormQueryList(token, [{ advertId, nmId }]).catch((error) => {
      logger.warn(
        { err: error, tenantId, advertId, nmId },
        '[Advertising Workspace] getNormQueryList failed, fallback to local cluster facts',
      );
      return [] as Awaited<ReturnType<typeof wbApi.getNormQueryList>>;
    }),
    wbApi.getSearchClusterStats(token, from, to, [{ advertId, nmId }]).catch((error) => {
      logger.warn(
        { err: error, tenantId, advertId, nmId },
        '[Advertising Workspace] getSearchClusterStats failed, fallback to local cluster facts',
      );
      return [] as Awaited<ReturnType<typeof wbApi.getSearchClusterStats>>;
    }),
  ]);

  const fallbackDailyRows = statsFromApi.length > 0
    ? []
    : await withTenantContext(db, tenantId, async (tx) => tx.execute(sql`
      SELECT
        c.cluster AS cluster,
        to_char(c.date AT TIME ZONE 'Europe/Moscow', 'YYYY-MM-DD') AS day,
        COALESCE(SUM(c.amount), 0)::numeric AS spend,
        COALESCE(SUM(c.views), 0)::bigint AS views,
        COALESCE(SUM(c.clicks), 0)::bigint AS clicks,
        COALESCE(SUM(c.order_count), 0)::bigint AS orders
      FROM raw_api_ad_clusters c
      WHERE c.tenant_id = ${tenantId}
        AND c.nm_id = ${nmId}
        AND c.date >= ${fromDate.toISOString()}::timestamp
        AND c.date < ${toExclusiveDate.toISOString()}::timestamp
      GROUP BY c.cluster, day
    `));

  const stats = statsFromApi.length > 0
    ? statsFromApi
    : fallbackDailyRows.map((row) => {
      const cluster = String((row as Record<string, unknown>).cluster ?? '').trim();
      const day = String((row as Record<string, unknown>).day ?? '').trim();
      const spend = toNumber((row as Record<string, unknown>).spend);
      const views = Math.max(0, toInt((row as Record<string, unknown>).views));
      const clicks = Math.max(0, toInt((row as Record<string, unknown>).clicks));
      const orders = Math.max(0, toInt((row as Record<string, unknown>).orders));
      return {
        advertId,
        nmId,
        date: day,
        keyword: cluster,
        views,
        clicks,
        ctr: toNullablePct(clicks, views) ?? undefined,
        sum: spend,
        atbs: 0,
        orders,
        cpc: toNullableRatio(spend, clicks) ?? undefined,
        cpm: undefined,
        avgPos: undefined,
        shks: 0,
      };
    });
  const statsSource: AdvertisingClusterMapResponse['statsSource'] = statsFromApi.length > 0
    ? 'wb_api'
    : fallbackDailyRows.length > 0
      ? 'local_fallback'
      : 'empty';

  const listRow = lists.find((item) => item.advertId === advertId && item.nmId === nmId) ?? null;
  const activeSet = new Set((listRow?.active ?? []).map((item) => normalizeCluster(item)));
  const excludedSet = new Set((listRow?.excluded ?? []).map((item) => normalizeCluster(item)));

  type MutableRow = {
    cluster: string;
    status: 'active' | 'excluded' | 'unknown';
    dailyMap: Map<string, {
      spend: number;
      views: number;
      clicks: number;
      orders: number;
      atbs: number;
      shks: number;
      ctrSamples: number[];
      cpcSamples: number[];
      cpmSamples: number[];
      avgPosSamples: number[];
    }>;
  };

  const byCluster = new Map<string, MutableRow>();

  const resolveStatus = (clusterKey: string): 'active' | 'excluded' | 'unknown' => {
    if (excludedSet.has(clusterKey)) {
      return 'excluded';
    }
    if (activeSet.has(clusterKey)) {
      return 'active';
    }
    return 'unknown';
  };

  for (const stat of stats) {
    const cluster = String(stat.keyword ?? '').trim();
    const day = String(stat.date ?? '').slice(0, 10);
    if (!cluster || !day) {
      continue;
    }

    const key = normalizeCluster(cluster);
    const row = byCluster.get(key) ?? {
      cluster,
      status: resolveStatus(key),
      dailyMap: new Map(),
    };

    const daily = row.dailyMap.get(day) ?? {
      spend: 0,
      views: 0,
      clicks: 0,
      orders: 0,
      atbs: 0,
      shks: 0,
      ctrSamples: [],
      cpcSamples: [],
      cpmSamples: [],
      avgPosSamples: [],
    };

    daily.spend += toNumber(stat.sum);
    daily.views += Math.max(0, toInt(stat.views));
    daily.clicks += Math.max(0, toInt(stat.clicks));
    daily.orders += Math.max(0, toInt(stat.orders));
    daily.atbs += Math.max(0, toInt(stat.atbs));
    daily.shks += Math.max(0, toInt(stat.shks));

    if (stat.ctr !== undefined && Number.isFinite(stat.ctr)) {
      daily.ctrSamples.push(toNumber(stat.ctr));
    }
    if (stat.cpc !== undefined && Number.isFinite(stat.cpc)) {
      daily.cpcSamples.push(toNumber(stat.cpc));
    }
    if (stat.cpm !== undefined && Number.isFinite(stat.cpm)) {
      daily.cpmSamples.push(toNumber(stat.cpm));
    }
    if (stat.avgPos !== undefined && Number.isFinite(stat.avgPos)) {
      daily.avgPosSamples.push(toNumber(stat.avgPos));
    }

    row.dailyMap.set(day, daily);
    byCluster.set(key, row);
  }

  for (const cluster of listRow?.active ?? []) {
    const key = normalizeCluster(cluster);
    if (!byCluster.has(key)) {
      byCluster.set(key, {
        cluster,
        status: 'active',
        dailyMap: new Map(),
      });
    }
  }
  for (const cluster of listRow?.excluded ?? []) {
    const key = normalizeCluster(cluster);
    if (!byCluster.has(key)) {
      byCluster.set(key, {
        cluster,
        status: 'excluded',
        dailyMap: new Map(),
      });
    }
  }

  const rows: AdvertisingClusterMapRow[] = [...byCluster.values()]
    .map((row) => {
      const daily = [...row.dailyMap.entries()]
        .map(([day, value]) => {
          const ctrPct = value.ctrSamples.length > 0
            ? round(value.ctrSamples.reduce((sum, item) => sum + item, 0) / value.ctrSamples.length, 2)
            : toNullablePct(value.clicks, value.views);

          const cpcRub = value.cpcSamples.length > 0
            ? round(value.cpcSamples.reduce((sum, item) => sum + item, 0) / value.cpcSamples.length, 2)
            : toNullableRatio(value.spend, value.clicks);

          const cpmRub = value.cpmSamples.length > 0
            ? round(value.cpmSamples.reduce((sum, item) => sum + item, 0) / value.cpmSamples.length, 2)
            : toNullableRatio(value.spend * 1000, value.views);

          const avgPos = value.avgPosSamples.length > 0
            ? round(value.avgPosSamples.reduce((sum, item) => sum + item, 0) / value.avgPosSamples.length, 2)
            : null;

          return {
            day,
            spend: round(value.spend, 2),
            views: value.views,
            clicks: value.clicks,
            orders: value.orders,
            atbs: value.atbs,
            shks: value.shks,
            ctrPct,
            cpcRub,
            cpmRub,
            avgPos,
          };
        })
        .sort((left, right) => left.day.localeCompare(right.day));

      const totals = daily.reduce((acc, day) => {
        acc.spend += day.spend;
        acc.views += day.views;
        acc.clicks += day.clicks;
        acc.orders += day.orders;
        return acc;
      }, { spend: 0, views: 0, clicks: 0, orders: 0 });

      const atbs = [...row.dailyMap.values()].reduce((sum, item) => sum + item.atbs, 0);
      const shks = [...row.dailyMap.values()].reduce((sum, item) => sum + item.shks, 0);

      const avgPosSamples = [...row.dailyMap.values()].flatMap((item) => item.avgPosSamples);
      const avgPos = avgPosSamples.length > 0
        ? round(avgPosSamples.reduce((sum, item) => sum + item, 0) / avgPosSamples.length, 2)
        : null;
      const cpmSamples = [...row.dailyMap.values()].flatMap((item) => item.cpmSamples);
      const cpmRub = cpmSamples.length > 0
        ? round(cpmSamples.reduce((sum, item) => sum + item, 0) / cpmSamples.length, 2)
        : toNullableRatio(totals.spend * 1000, totals.views);

      return {
        cluster: row.cluster,
        status: row.status,
        totals: {
          spend: round(totals.spend, 2),
          views: totals.views,
          clicks: totals.clicks,
          orders: totals.orders,
          atbs,
          shks,
          ctrPct: toNullablePct(totals.clicks, totals.views),
          cpcRub: toNullableRatio(totals.spend, totals.clicks),
          cpmRub,
          cpoRub: toNullableRatio(totals.spend, totals.orders),
          avgPos,
        },
        daily,
      };
    })
    .sort((left, right) => {
      if (right.totals.spend !== left.totals.spend) {
        return right.totals.spend - left.totals.spend;
      }
      if (right.totals.clicks !== left.totals.clicks) {
        return right.totals.clicks - left.totals.clicks;
      }
      return left.cluster.localeCompare(right.cluster, 'ru-RU');
    });

  return {
    generatedAt: new Date().toISOString(),
    advertId,
    nmId,
    statsSource,
    activeCount: listRow?.active.length ?? 0,
    excludedCount: listRow?.excluded.length ?? 0,
    rows,
  };
}

async function resolveBatchExcludePreview(
  tenantId: string,
  params: {
    dateFrom: Date;
    dateTo: Date;
    riskLevels: ClusterRiskLevel[];
    maxClusters?: number;
  },
) {
  const maxClusters = Math.min(Math.max(1, params.maxClusters ?? 40), MAX_BATCH_CLUSTER_LIMIT);
  const riskSet = new Set(params.riskLevels);

  const clusters = await getAdvertisingClusters(tenantId, params.dateFrom, params.dateTo, {
    limit: MAX_BATCH_CLUSTER_LIMIT,
  });

  const selected = clusters.rows
    .filter((row) => riskSet.has(row.riskLevel))
    .slice(0, maxClusters);

  if (selected.length === 0) {
    return {
      sourceClusters: clusters.rows.length,
      selected,
      operations: [] as AdvertisingBatchOperationPreview[],
    };
  }

  const token = await getTenantWbToken(tenantId);
  const campaigns = await wbApi.getAdCampaigns(token);
  const candidateCampaigns = campaigns.filter((campaign) => (
    campaign.searchPlacement
    && campaign.nmIds.length > 0
    && (campaign.status === undefined || ACTIONABLE_STATUSES.has(campaign.status))
  ));

  const nmToCampaigns = new Map<number, Array<{ advertId: number }>>();
  for (const campaign of candidateCampaigns) {
    for (const nmId of campaign.nmIds) {
      const list = nmToCampaigns.get(nmId) ?? [];
      list.push({ advertId: campaign.advertId });
      nmToCampaigns.set(nmId, list);
    }
  }

  const minusLookupItems = Array.from(new Map(
    selected.flatMap((row) => {
      const linked = nmToCampaigns.get(row.nmId) ?? [];
      return linked.map((campaign) => {
        const key = `${campaign.advertId}:${row.nmId}`;
        return [key, { advertId: campaign.advertId, nmId: row.nmId }] as const;
      });
    }),
  ).values());

  const minusByCampaign = new Map<string, Set<string>>();
  if (minusLookupItems.length > 0) {
    for (const minusChunk of chunkArray(minusLookupItems, MAX_BID_BATCH_SIZE)) {
      const minusRows = await wbApi.getCampaignMinusPhrases(token, minusChunk);
      for (const minusRow of minusRows) {
        const key = `${minusRow.advertId}:${minusRow.nmId}`;
        minusByCampaign.set(key, new Set(minusRow.normQueries.map((item) => normalizeCluster(item))));
      }
    }
  }

  const operationsMap = new Map<string, AdvertisingBatchOperationPreview>();
  for (const row of selected) {
    const campaignsForNm = nmToCampaigns.get(row.nmId) ?? [];
    const clusterKey = normalizeCluster(row.cluster);
    for (const campaign of campaignsForNm) {
      const minusKey = `${campaign.advertId}:${row.nmId}`;
      const minusSet = minusByCampaign.get(minusKey) ?? new Set<string>();
      if (minusSet.has(clusterKey)) {
        continue;
      }

      const key = `${campaign.advertId}:${row.nmId}:${clusterKey}`;
      if (operationsMap.has(key)) {
        continue;
      }

      operationsMap.set(key, {
        advertId: campaign.advertId,
        nmId: row.nmId,
        cluster: row.cluster,
        riskLevel: row.riskLevel,
        riskReason: row.riskReason,
        clicks: row.clicks,
        orders: row.orders,
        adSpend: row.adSpend,
      });

      if (operationsMap.size >= MAX_BATCH_OPERATIONS) {
        break;
      }
    }
    if (operationsMap.size >= MAX_BATCH_OPERATIONS) {
      break;
    }
  }

  return {
    sourceClusters: clusters.rows.length,
    selected,
    operations: [...operationsMap.values()],
  };
}

export async function executeExcludeHighRiskClusters(
  tenantId: string,
  params: {
    userId: string | null;
    dateFrom: Date;
    dateTo: Date;
    riskLevels: ClusterRiskLevel[];
    dryRun: boolean;
    confirmed: boolean;
    maxClusters?: number;
  },
): Promise<AdvertisingBatchOperationResponse> {
  const preview = await resolveBatchExcludePreview(tenantId, {
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
    riskLevels: params.riskLevels,
    maxClusters: params.maxClusters,
  });

  if (params.dryRun) {
    return {
      generatedAt: new Date().toISOString(),
      dryRun: true,
      requiresConfirmation: false,
      summary: {
        sourceClusters: preview.sourceClusters,
        selectedClusters: preview.selected.length,
        queuedOperations: preview.operations.length,
        applied: 0,
        failed: 0,
        skipped: preview.operations.length,
      },
      operations: preview.operations,
      errors: [],
    };
  }

  if (!params.confirmed && preview.operations.length > 0) {
    return {
      generatedAt: new Date().toISOString(),
      dryRun: false,
      requiresConfirmation: true,
      summary: {
        sourceClusters: preview.sourceClusters,
        selectedClusters: preview.selected.length,
        queuedOperations: preview.operations.length,
        applied: 0,
        failed: 0,
        skipped: preview.operations.length,
      },
      operations: preview.operations,
      errors: [],
    };
  }

  let applied = 0;
  let failed = 0;
  const errors: Array<{ advertId: number; nmId: number; cluster: string; error: string }> = [];

  for (const operation of preview.operations) {
    try {
      await toggleAdvertisingCluster({
        tenantId,
        userId: params.userId,
        advertId: operation.advertId,
        nmId: operation.nmId,
        cluster: operation.cluster,
        mode: 'exclude',
      });
      applied += 1;
    } catch (error) {
      failed += 1;
      errors.push({
        advertId: operation.advertId,
        nmId: operation.nmId,
        cluster: operation.cluster,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    dryRun: false,
    requiresConfirmation: false,
    summary: {
      sourceClusters: preview.sourceClusters,
      selectedClusters: preview.selected.length,
      queuedOperations: preview.operations.length,
      applied,
      failed,
      skipped: Math.max(0, preview.operations.length - applied - failed),
    },
    operations: preview.operations,
    errors,
  };
}

export async function getAdvertisingAlerts(
  tenantId: string,
  dateFrom: Date,
  dateTo: Date,
): Promise<AdvertisingAlertsResponse> {
  const from = toUtcDayStart(dateFrom);
  const to = toUtcDayStart(dateTo);
  const toExclusive = addUtcDays(to, 1);

  const dailyRowsRaw = await withTenantContext(db, tenantId, async (tx) => tx.execute(sql`
    SELECT
      TO_CHAR(DATE_TRUNC('day', c.date), 'YYYY-MM-DD') AS day_key,
      c.nm_id,
      c.cluster,
      SUM(c.amount)::numeric AS ad_spend,
      SUM(c.views)::bigint AS views,
      SUM(c.clicks)::bigint AS clicks,
      SUM(c.order_count)::bigint AS orders
    FROM raw_api_ad_clusters c
    WHERE c.tenant_id = ${tenantId}
      AND c.date >= ${from.toISOString()}::timestamp
      AND c.date < ${toExclusive.toISOString()}::timestamp
    GROUP BY TO_CHAR(DATE_TRUNC('day', c.date), 'YYYY-MM-DD'), c.nm_id, c.cluster
    ORDER BY TO_CHAR(DATE_TRUNC('day', c.date), 'YYYY-MM-DD') ASC
  `));

  if (dailyRowsRaw.length === 0) {
    return {
      generatedAt: new Date().toISOString(),
      hasData: false,
      summary: { total: 0, critical: 0, high: 0, medium: 0 },
      alerts: [],
    };
  }

  const dailyRows = dailyRowsRaw.map((rawRow) => {
    const row = rawRow as Record<string, unknown>;
    return {
      day: String(row.day_key ?? ''),
      nmId: toInt(row.nm_id),
      cluster: String(row.cluster ?? '').trim(),
      adSpend: round(toNumber(row.ad_spend), 2),
      views: Math.max(0, toInt(row.views)),
      clicks: Math.max(0, toInt(row.clicks)),
      orders: Math.max(0, toInt(row.orders)),
    };
  });

  const nmIds = [...new Set(dailyRows.map((row) => row.nmId))];
  const productRows = nmIds.length > 0
    ? await withTenantContext(db, tenantId, async (tx) =>
      tx.select({ nmId: products.nmId, vendorCode: products.vendorCode, brand: products.brand })
        .from(products)
        .where(and(
          eq(products.tenantId, tenantId),
          inArray(products.nmId, nmIds),
        )),
    )
    : [];

  const productByNm = new Map<number, { vendorCode: string | null; brand: string | null }>();
  for (const row of productRows) {
    productByNm.set(Number(row.nmId), {
      vendorCode: row.vendorCode ?? null,
      brand: row.brand ?? null,
    });
  }

  const latestDay = dailyRows.reduce((max, row) => (row.day > max ? row.day : max), '');
  const latestDate = new Date(`${latestDay}T00:00:00.000Z`);
  const prevDay = formatApiDate(addUtcDays(latestDate, -1));

  const keyOf = (nmId: number, cluster: string) => `${nmId}:${normalizeCluster(cluster)}`;
  const byKey = new Map<string, { nmId: number; cluster: string; byDay: Map<string, typeof dailyRows[number]> }>();
  for (const row of dailyRows) {
    const key = keyOf(row.nmId, row.cluster);
    const current = byKey.get(key) ?? {
      nmId: row.nmId,
      cluster: row.cluster,
      byDay: new Map<string, typeof dailyRows[number]>(),
    };
    current.byDay.set(row.day, row);
    byKey.set(key, current);
  }

  const alerts: AdvertisingAlertItem[] = [];

  for (const [, item] of byKey) {
    const today = item.byDay.get(latestDay);
    if (!today) {
      continue;
    }
    const previous = item.byDay.get(prevDay);

    if (
      today.adSpend >= 800
      && today.orders === 0
      && today.clicks >= 12
      && ((previous && today.adSpend >= previous.adSpend * 1.5) || (!previous && today.adSpend >= 1500))
    ) {
      const product = productByNm.get(item.nmId);
      alerts.push({
        id: `spike:${item.nmId}:${normalizeCluster(item.cluster)}`,
        type: 'spend_spike_without_orders',
        severity: today.adSpend >= 2000 ? 'high' : 'medium',
        title: 'Рост расхода без заказов',
        details: `Кластер «${item.cluster}» резко увеличил расход на ${latestDay}, но заказы отсутствуют.`,
        metric: `${Math.round(today.adSpend).toLocaleString('ru-RU')} ₽ · ${today.clicks} кликов · 0 заказов`,
        nmId: item.nmId,
        cluster: item.cluster,
        brand: product?.brand ?? null,
        vendorCode: product?.vendorCode ?? null,
      });
    }

    const sortedDays = [...item.byDay.keys()].sort();
    if (sortedDays.length < 6) {
      continue;
    }

    const recentDays = sortedDays.slice(-3);
    const prevDays = sortedDays.slice(-6, -3);

    const recentTotals = recentDays.reduce((acc, day) => {
      const row = item.byDay.get(day);
      if (!row) {
        return acc;
      }
      acc.views += row.views;
      acc.clicks += row.clicks;
      acc.orders += row.orders;
      return acc;
    }, { views: 0, clicks: 0, orders: 0 });

    const prevTotals = prevDays.reduce((acc, day) => {
      const row = item.byDay.get(day);
      if (!row) {
        return acc;
      }
      acc.views += row.views;
      acc.clicks += row.clicks;
      acc.orders += row.orders;
      return acc;
    }, { views: 0, clicks: 0, orders: 0 });

    const recentCtr = toNullablePct(recentTotals.clicks, recentTotals.views, 2);
    const prevCtr = toNullablePct(prevTotals.clicks, prevTotals.views, 2);
    const recentCvr = toNullablePct(recentTotals.orders, recentTotals.clicks, 2);
    const prevCvr = toNullablePct(prevTotals.orders, prevTotals.clicks, 2);

    if (
      prevTotals.clicks >= 25
      && recentTotals.clicks >= 25
      && prevCtr !== null
      && recentCtr !== null
      && prevCvr !== null
      && recentCvr !== null
      && (recentCtr < prevCtr * 0.65 || recentCvr < prevCvr * 0.6)
    ) {
      const product = productByNm.get(item.nmId);
      alerts.push({
        id: `deg:${item.nmId}:${normalizeCluster(item.cluster)}`,
        type: 'ctr_cvr_degradation',
        severity: 'high',
        title: 'Деградация CTR/CVR',
        details: `Кластер «${item.cluster}» просел по вовлечению/конверсии относительно предыдущих 3 дней.`,
        metric: `CTR ${prevCtr}% → ${recentCtr}% · CVR ${prevCvr}% → ${recentCvr}%`,
        nmId: item.nmId,
        cluster: item.cluster,
        brand: product?.brand ?? null,
        vendorCode: product?.vendorCode ?? null,
      });
    }
  }

  const skuRowsRaw = await withTenantContext(db, tenantId, async (tx) => tx.execute(sql`
    SELECT
      c.nm_id,
      p.brand,
      p.vendor_code,
      SUM(c.amount)::numeric AS ad_spend,
      SUM(c.clicks)::bigint AS clicks,
      SUM(c.order_count)::bigint AS orders
    FROM raw_api_ad_clusters c
    LEFT JOIN products p
      ON p.tenant_id = ${tenantId}
     AND p.nm_id = c.nm_id
     AND COALESCE(p.is_hidden, FALSE) = FALSE
    WHERE c.tenant_id = ${tenantId}
      AND c.date >= ${from.toISOString()}::timestamp
      AND c.date < ${toExclusive.toISOString()}::timestamp
    GROUP BY c.nm_id, p.brand, p.vendor_code
    ORDER BY SUM(c.amount) DESC
    LIMIT 250
  `));

  const brandAgg = new Map<string, { brand: string; spend: number; clicks: number; orders: number }>();

  for (const rawRow of skuRowsRaw) {
    const row = rawRow as Record<string, unknown>;
    const nmId = toInt(row.nm_id);
    const brand = (row.brand as string | null) ?? 'Без бренда';
    const vendorCode = (row.vendor_code as string | null) ?? null;
    const adSpend = round(toNumber(row.ad_spend), 2);
    const clicks = Math.max(0, toInt(row.clicks));
    const orders = Math.max(0, toInt(row.orders));

    if (adSpend >= 2000 && orders === 0 && clicks >= 30) {
      alerts.push({
        id: `sku:${nmId}`,
        type: 'sku_anomaly',
        severity: adSpend >= 4000 ? 'critical' : 'high',
        title: 'SKU аномалия: расход без заказов',
        details: `SKU nmId ${nmId} тратит бюджет без заказов за выбранный период.`,
        metric: `${Math.round(adSpend).toLocaleString('ru-RU')} ₽ · ${clicks} кликов · 0 заказов`,
        nmId,
        cluster: null,
        brand,
        vendorCode,
      });
    }

    const brandRow = brandAgg.get(brand) ?? { brand, spend: 0, clicks: 0, orders: 0 };
    brandRow.spend += adSpend;
    brandRow.clicks += clicks;
    brandRow.orders += orders;
    brandAgg.set(brand, brandRow);
  }

  for (const [, brandRow] of brandAgg) {
    if (brandRow.spend >= 6000 && brandRow.orders <= 1 && brandRow.clicks >= 100) {
      alerts.push({
        id: `brand:${normalizeCluster(brandRow.brand)}`,
        type: 'brand_anomaly',
        severity: brandRow.spend >= 12000 ? 'critical' : 'high',
        title: 'Аномалия по бренду',
        details: `Бренд ${brandRow.brand} показывает высокий расход с почти нулевыми заказами.`,
        metric: `${Math.round(brandRow.spend).toLocaleString('ru-RU')} ₽ · ${brandRow.clicks} кликов · ${brandRow.orders} заказов`,
        nmId: null,
        cluster: null,
        brand: brandRow.brand,
        vendorCode: null,
      });
    }
  }

  const sortedAlerts = alerts
    .sort((left, right) => {
      const rankDiff = severityRank(left.severity) - severityRank(right.severity);
      if (rankDiff !== 0) {
        return rankDiff;
      }
      return left.title.localeCompare(right.title, 'ru-RU');
    })
    .slice(0, MAX_ALERTS);

  return {
    generatedAt: new Date().toISOString(),
    hasData: sortedAlerts.length > 0,
    summary: {
      total: sortedAlerts.length,
      critical: sortedAlerts.filter((item) => item.severity === 'critical').length,
      high: sortedAlerts.filter((item) => item.severity === 'high').length,
      medium: sortedAlerts.filter((item) => item.severity === 'medium').length,
    },
    alerts: sortedAlerts,
  };
}

function formatOperationsRub(value: number) {
  return `${Math.round(value).toLocaleString('ru-RU')} ₽`;
}

function formatSignedOperationsRub(value: number) {
  const rounded = Math.round(Math.abs(value));
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${rounded.toLocaleString('ru-RU')} ₽`;
}

function formatOperationsPct(value: number | null) {
  return value === null ? 'н/д' : `${value.toFixed(1)}%`;
}

function formatOrdersDelta(value: number) {
  return `${value > 0 ? '+' : ''}${value}`;
}

function formatPostActionScope(report: AdvertisingPostActionMonitorReport) {
  if (report.scope.type === 'group') {
    return `Склейка: ${report.scope.groupName ?? 'без названия'}`;
  }
  return report.scope.nmIds[0] ? `nmId ${report.scope.nmIds[0]}` : 'SKU';
}

function getPostActionKind(report: AdvertisingPostActionMonitorReport): AdvertisingPostActionEffectItem['kind'] {
  if (report.rollback.status === 'applied') {
    return 'rolled_back';
  }
  if (report.recommendation === 'rollback') {
    return 'rollback';
  }
  if (report.outcome === 'improved' && report.direction === 'lower') {
    return 'saving';
  }
  if (report.outcome === 'improved' && report.direction === 'raise') {
    return 'growth';
  }
  return 'watch';
}

function getPostActionTitle(report: AdvertisingPostActionMonitorReport) {
  const kind = getPostActionKind(report);
  if (kind === 'rolled_back') return 'Откат уже применён';
  if (kind === 'rollback') return 'Нужен откат ставки';
  if (kind === 'saving') return 'Сэкономили без потери заказов';
  if (kind === 'growth') return 'Рост ставки окупился';
  if (report.outcome === 'insufficient_data') return 'Мало данных после изменения';
  return 'Наблюдаем после изменения';
}

function getPostActionNextStep(report: AdvertisingPostActionMonitorReport) {
  if (report.rollback.status === 'applied') {
    return 'Действие закрыто: ставка уже возвращена на предыдущий уровень.';
  }
  if (report.recommendation === 'rollback') {
    return report.autoRollbackEligible
      ? 'Автопилот откатит ставку, если нет более свежего изменения.'
      : 'Нужна ручная проверка: откатить ставку или открыть вкладку «Ставки».';
  }
  if (report.recommendation === 'keep') {
    return 'Оставляем новую ставку и продолжаем наблюдение до следующего горизонта.';
  }
  return 'Данных пока мало: ждём следующий горизонт проверки.';
}

function getPostActionAutoCorrection(report: AdvertisingPostActionMonitorReport) {
  if (report.rollback.status === 'applied') {
    return `Автооткат применён${report.rollback.appliedAt ? ` ${report.rollback.appliedAt}` : ''}.`;
  }
  if (report.rollback.status === 'failed') {
    return 'Автооткат не прошёл, нужна ручная проверка.';
  }
  if (report.recommendation === 'rollback') {
    return report.autoRollbackEligible
      ? 'Автокоррекция разрешена для режима Автопилот.'
      : 'В Советнике/Полуавтомате автокоррекция не применяет ставку без подтверждения.';
  }
  return 'Откат не требуется.';
}

function buildPostActionEffect(row: {
  id: string;
  advertId: number;
  nmId: number;
  cluster: string;
  previousBid: number | null;
  nextBid: number | null;
  metrics: Record<string, unknown>;
  createdAt: Date;
}): AdvertisingPostActionEffectItem | null {
  const report = readAdvertisingPostActionMonitor(row.metrics ?? {});
  if (!report) {
    return null;
  }

  const spendDeltaRub = Math.round(report.delta.adSpend);
  const savingsRub = report.direction === 'lower' ? Math.max(0, -spendDeltaRub) : 0;
  const beforeOrders = Math.round(report.before.orders);
  const afterOrders = Math.round(report.after.orders);
  const beforeSpendRub = Math.round(report.before.adSpend);
  const afterSpendRub = Math.round(report.after.adSpend);
  const beforeRevenueRub = Math.round(report.before.revenue);
  const afterRevenueRub = Math.round(report.after.revenue);
  const revenueDeltaRub = Math.round(report.delta.revenue);
  const ordersText = `заказы ${beforeOrders} → ${afterOrders}`;
  const spendText = `расход ${formatOperationsRub(beforeSpendRub)} → ${formatOperationsRub(afterSpendRub)}`;
  const revenueText = `выручка ${formatOperationsRub(beforeRevenueRub)} → ${formatOperationsRub(afterRevenueRub)}`;
  const drrText = `ДРР ${formatOperationsPct(report.before.drrPct)} → ${formatOperationsPct(report.after.drrPct)}`;

  let primaryMetric = ordersText;
  if (report.direction === 'lower' && savingsRub > 0) {
    primaryMetric = `экономия ${formatOperationsRub(savingsRub)} · ${ordersText}`;
  } else if (report.direction === 'raise' && report.delta.orders > 0) {
    primaryMetric = `заказы ${beforeOrders} → ${afterOrders} (${formatOrdersDelta(report.delta.orders)})`;
  } else if (report.recommendation === 'rollback') {
    primaryMetric = `расход ${formatSignedOperationsRub(spendDeltaRub)} · ${ordersText}`;
  }

  return {
    id: `post-action:${row.id}`,
    kind: getPostActionKind(report),
    title: getPostActionTitle(report),
    summary: report.summary,
    primaryMetric,
    secondaryMetric: `${spendText} · ${revenueText} · ${drrText}`,
    direction: report.direction,
    outcome: report.outcome,
    recommendation: report.recommendation,
    checkedAt: report.checkedAt,
    createdAt: row.createdAt.toISOString(),
    horizonHours: report.horizonHours,
    bidChange: `${row.previousBid ?? report.bid.previous} → ${row.nextBid ?? report.bid.next} ₽`,
    scopeLabel: formatPostActionScope(report),
    rollbackStatus: report.rollback.status,
    nextStep: getPostActionNextStep(report),
    autoCorrection: getPostActionAutoCorrection(report),
    advertId: Number(row.advertId),
    nmId: Number(row.nmId),
    cluster: row.cluster,
    impact: {
      beforeOrders,
      afterOrders,
      ordersDelta: report.delta.orders,
      beforeSpendRub,
      afterSpendRub,
      spendDeltaRub,
      savingsRub,
      beforeRevenueRub,
      afterRevenueRub,
      revenueDeltaRub,
      beforeDrrPct: report.before.drrPct,
      afterDrrPct: report.after.drrPct,
      drrDeltaPctPoints: report.delta.drrPctPoints,
    },
  };
}

function buildOperationsDailyReport(input: {
  periodDays: number;
  dailyStats: Record<string, unknown>;
  bidRows: Array<{
    status: string;
    previousBid: number | null;
    nextBid: number | null;
  }>;
  postActionEffects: AdvertisingPostActionEffectItem[];
}): AdvertisingOperationsDailyReport {
  const spendRub = Math.round(toNumber(input.dailyStats.ad_spend));
  const revenueRub = Math.round(toNumber(input.dailyStats.revenue));
  const orders = Math.max(0, toInt(input.dailyStats.orders));
  const clicks = Math.max(0, toInt(input.dailyStats.clicks));
  const appliedBidRows = input.bidRows.filter((row) => row.status === 'applied');
  const loweredBidChanges = appliedBidRows.filter((row) => (
    row.previousBid !== null && row.nextBid !== null && row.nextBid < row.previousBid
  )).length;
  const raisedBidChanges = appliedBidRows.filter((row) => (
    row.previousBid !== null && row.nextBid !== null && row.nextBid > row.previousBid
  )).length;
  const postActionSavingsRub = input.postActionEffects.reduce((sum, item) => sum + item.impact.savingsRub, 0);
  const postActionExtraOrders = input.postActionEffects.reduce((sum, item) => sum + Math.max(0, item.impact.ordersDelta), 0);
  const postActionRollbackCount = input.postActionEffects.filter((item) => item.kind === 'rollback').length;
  const postActionRolledBackCount = input.postActionEffects.filter((item) => item.kind === 'rolled_back').length;

  const lines = [
    `За период: расход ${formatOperationsRub(spendRub)}, выручка ${formatOperationsRub(revenueRub)}, заказы ${orders}.`,
  ];
  if (postActionSavingsRub > 0) {
    lines.push(`После снижений ставок подтверждена экономия ${formatOperationsRub(postActionSavingsRub)} без критичной просадки заказов.`);
  }
  if (postActionExtraOrders > 0) {
    lines.push(`После повышений ставок видно +${postActionExtraOrders} заказов на проверенных горизонтах.`);
  }
  if (postActionRollbackCount > 0) {
    lines.push(`Нужен откат по ${postActionRollbackCount} изменени${postActionRollbackCount === 1 ? 'ю' : 'ям'} ставки.`);
  } else if (input.postActionEffects.length > 0) {
    lines.push('Критичных последствий по проверенным изменениям ставок нет.');
  } else {
    lines.push('Проверенные последствия появятся после горизонта 2 / 6 / 24 часа от изменения ставки.');
  }

  return {
    periodDays: input.periodDays,
    spendRub,
    revenueRub,
    orders,
    clicks,
    drrPct: toNullablePct(spendRub, revenueRub),
    cpcRub: toNullableRatio(spendRub, clicks),
    appliedBidChanges: appliedBidRows.length,
    loweredBidChanges,
    raisedBidChanges,
    postActionSavingsRub,
    postActionExtraOrders,
    postActionRollbackCount,
    postActionRolledBackCount,
    lines,
  };
}

export async function getAdvertisingOperations(
  tenantId: string,
  dateFrom: Date,
  dateTo: Date,
): Promise<AdvertisingOperationsResponse> {
  const from = toUtcDayStart(dateFrom);
  const to = toUtcDayStart(dateTo);
  const toExclusive = addUtcDays(to, 1);
  const alerts = await getAdvertisingAlerts(tenantId, dateFrom, dateTo);

  const {
    bidRows,
    clusterRows,
    auditRows,
    runRows,
    dailyStats,
  } = await withTenantContext(db, tenantId, async (tx) => {
    const bidChanges = await tx.select({
      id: advertisingBidChanges.id,
      source: advertisingBidChanges.source,
      advertId: advertisingBidChanges.advertId,
      nmId: advertisingBidChanges.nmId,
      cluster: advertisingBidChanges.cluster,
      previousBid: advertisingBidChanges.previousBid,
      nextBid: advertisingBidChanges.nextBid,
      status: advertisingBidChanges.status,
      reason: advertisingBidChanges.reason,
      metrics: advertisingBidChanges.metrics,
      createdAt: advertisingBidChanges.createdAt,
    })
      .from(advertisingBidChanges)
      .where(and(
        eq(advertisingBidChanges.tenantId, tenantId),
        gte(advertisingBidChanges.createdAt, from),
        lte(advertisingBidChanges.createdAt, toExclusive),
      ))
      .orderBy(desc(advertisingBidChanges.createdAt))
      .limit(80);

    const clusterActions = await tx.select({
      id: advertisingClusterActions.id,
      advertId: advertisingClusterActions.advertId,
      nmId: advertisingClusterActions.nmId,
      cluster: advertisingClusterActions.cluster,
      action: advertisingClusterActions.action,
      status: advertisingClusterActions.status,
      errorMessage: advertisingClusterActions.errorMessage,
      createdAt: advertisingClusterActions.createdAt,
    })
      .from(advertisingClusterActions)
      .where(and(
        eq(advertisingClusterActions.tenantId, tenantId),
        gte(advertisingClusterActions.createdAt, from),
        lte(advertisingClusterActions.createdAt, toExclusive),
      ))
      .orderBy(desc(advertisingClusterActions.createdAt))
      .limit(80);

    const auditLog = await tx.select({
      id: advertisingAuditLog.id,
      campaignId: advertisingAuditLog.campaignId,
      nmId: advertisingAuditLog.nmId,
      actionType: advertisingAuditLog.actionType,
      objectType: advertisingAuditLog.objectType,
      valueAfter: advertisingAuditLog.valueAfter,
      reason: advertisingAuditLog.reason,
      source: advertisingAuditLog.source,
      createdAt: advertisingAuditLog.createdAt,
    })
      .from(advertisingAuditLog)
      .where(and(
        eq(advertisingAuditLog.tenantId, tenantId),
        gte(advertisingAuditLog.createdAt, from),
        lte(advertisingAuditLog.createdAt, toExclusive),
      ))
      .orderBy(desc(advertisingAuditLog.createdAt))
      .limit(80);

    const strategyRuns = await tx.select({
      id: advertisingAutoBidRuns.id,
      strategyId: advertisingAutoBidRuns.strategyId,
      triggerSource: advertisingAutoBidRuns.triggerSource,
      status: advertisingAutoBidRuns.status,
      errorMessage: advertisingAutoBidRuns.errorMessage,
      startedAt: advertisingAutoBidRuns.startedAt,
    })
      .from(advertisingAutoBidRuns)
      .where(and(
        eq(advertisingAutoBidRuns.tenantId, tenantId),
        gte(advertisingAutoBidRuns.startedAt, from),
        lte(advertisingAutoBidRuns.startedAt, toExclusive),
      ))
      .orderBy(desc(advertisingAutoBidRuns.startedAt))
      .limit(50);

    const [dailyStatsRow] = await tx.execute(sql`
      SELECT
        COALESCE(SUM(ad_spend), 0)::numeric AS ad_spend,
        COALESCE(SUM(order_sum), 0)::numeric AS revenue,
        COALESCE(SUM(order_count), 0)::int AS orders,
        COALESCE(SUM(clicks), 0)::int AS clicks
      FROM advertising_hourly_stats
      WHERE tenant_id = ${tenantId}
        AND stat_hour >= ${from}
        AND stat_hour < ${toExclusive}
    `) as Array<Record<string, unknown>>;

    return {
      bidRows: bidChanges,
      clusterRows: clusterActions,
      auditRows: auditLog,
      runRows: strategyRuns,
      dailyStats: dailyStatsRow ?? {},
    };
  });

  const failedBidChanges = bidRows.filter((row) => row.status === 'failed').length;
  const guardrailBlockedBidChanges = bidRows.filter((row) => row.status === 'guardrail_blocked').length;
  const postActionRollbackRecommendations = bidRows.filter((row) => {
    const report = readAdvertisingPostActionMonitor(row.metrics ?? {});
    return report?.recommendation === 'rollback' && report.rollback.status !== 'applied';
  }).length;
  const failedClusterActions = clusterRows.filter((row) => row.status === 'failed').length;
  const failedStrategyRuns = runRows.filter((row) => row.status === 'failed').length;
  const campaignVerificationFailures = auditRows.filter((row) => (
    readRecord(row.valueAfter).verificationStatus === 'failed'
  )).length;

  const incidents: AdvertisingOperationsIncident[] = [];
  if (alerts.summary.critical > 0) {
    incidents.push({
      id: 'critical-alerts',
      severity: 'critical',
      title: 'Критичные рекламные алерты',
      details: 'Есть SKU/бренды с высоким расходом без результата или резкой деградацией.',
      count: alerts.summary.critical,
    });
  }
  if (failedBidChanges > 0) {
    incidents.push({
      id: 'failed-bid-changes',
      severity: 'critical',
      title: 'Ставки не применились',
      details: 'WB не принял или не подтвердил часть изменений ставок.',
      count: failedBidChanges,
    });
  }
  if (failedClusterActions > 0) {
    incidents.push({
      id: 'failed-cluster-actions',
      severity: 'critical',
      title: 'Минус-фразы не применились',
      details: 'Есть неуспешные include/exclude действия по поисковым кластерам.',
      count: failedClusterActions,
    });
  }
  if (campaignVerificationFailures > 0) {
    incidents.push({
      id: 'campaign-verification-failures',
      severity: 'critical',
      title: 'Статус кампании не подтверждён',
      details: 'После pause/start WB не вернул ожидаемый статус кампании.',
      count: campaignVerificationFailures,
    });
  }
  if (failedStrategyRuns > 0) {
    incidents.push({
      id: 'failed-strategy-runs',
      severity: 'critical',
      title: 'Автостратегия завершилась ошибкой',
      details: 'Один или несколько запусков автопилота требуют проверки.',
      count: failedStrategyRuns,
    });
  }
  if (alerts.summary.high > 0) {
    incidents.push({
      id: 'high-alerts',
      severity: 'warning',
      title: 'Высокие рекламные риски',
      details: 'Есть алерты высокого уровня без статуса critical.',
      count: alerts.summary.high,
    });
  }
  if (guardrailBlockedBidChanges > 0) {
    incidents.push({
      id: 'guardrail-blocks',
      severity: 'warning',
      title: 'Guardrails заблокировали действия',
      details: 'Автопилот остановил часть изменений по защитным правилам.',
      count: guardrailBlockedBidChanges,
    });
  }
  if (postActionRollbackRecommendations > 0) {
    incidents.push({
      id: 'post-action-rollback',
      severity: 'warning',
      title: 'Изменение ставки ухудшило результат',
      details: 'Post-action monitor нашёл ставки, где после изменения вырос расход или просели заказы. Нужна проверка или откат.',
      count: postActionRollbackRecommendations,
    });
  }

  const postActionEffects = bidRows
    .map((row) => buildPostActionEffect({
      id: row.id,
      advertId: Number(row.advertId),
      nmId: Number(row.nmId),
      cluster: row.cluster,
      previousBid: row.previousBid,
      nextBid: row.nextBid,
      metrics: row.metrics ?? {},
      createdAt: row.createdAt,
    }))
    .filter((item): item is AdvertisingPostActionEffectItem => item !== null)
    .sort((left, right) => Date.parse(right.checkedAt) - Date.parse(left.checkedAt))
    .slice(0, 12);
  const dailyReport = buildOperationsDailyReport({
    periodDays: Math.max(1, Math.floor((toExclusive.getTime() - from.getTime()) / 86_400_000)),
    dailyStats,
    bidRows,
    postActionEffects,
  });

  const queue: AdvertisingActionQueueItem[] = [
    ...alerts.alerts.slice(0, 20).map((alert) => ({
      id: `alert:${alert.id}`,
      kind: 'alert' as const,
      status: alert.severity === 'medium' ? 'info' as const : 'needs_attention' as const,
      title: alert.title,
      details: `${alert.metric}. ${alert.details}`,
      createdAt: alerts.generatedAt,
      advertId: null,
      nmId: alert.nmId,
      cluster: alert.cluster,
      source: 'alerts',
    })),
    ...bidRows.map((row) => {
      const postAction = readAdvertisingPostActionMonitor(row.metrics ?? {});
      const postActionSummary = formatAdvertisingPostActionSummary(postAction);
      const needsPostActionAttention = postAction?.recommendation === 'rollback' && postAction.rollback.status !== 'applied';
      return {
        id: `bid:${row.id}`,
        kind: 'bid_change' as const,
        status: row.status === 'failed' || needsPostActionAttention
          ? 'needs_attention' as const
          : row.status === 'guardrail_blocked'
            ? 'blocked' as const
            : row.status === 'applied'
              ? 'completed' as const
              : 'info' as const,
        title: row.status === 'guardrail_blocked'
          ? 'Ставка заблокирована защитой'
          : needsPostActionAttention
            ? 'Ставка требует отката'
            : 'Изменение ставки',
        details: `${row.previousBid ?? 'н/д'} -> ${row.nextBid ?? 'н/д'} ₽. ${postActionSummary ?? row.reason ?? row.status}`,
        createdAt: row.createdAt.toISOString(),
        advertId: Number(row.advertId),
        nmId: Number(row.nmId),
        cluster: row.cluster,
        source: row.source,
      };
    }),
    ...clusterRows.map((row) => ({
      id: `cluster:${row.id}`,
      kind: 'cluster_action' as const,
      status: row.status === 'failed' ? 'needs_attention' as const : 'completed' as const,
      title: row.action === 'exclude' ? 'Кластер исключён' : 'Кластер возвращён',
      details: row.errorMessage ?? `Статус операции: ${row.status}`,
      createdAt: row.createdAt.toISOString(),
      advertId: Number(row.advertId),
      nmId: Number(row.nmId),
      cluster: row.cluster,
      source: 'cluster_actions',
    })),
    ...auditRows.map((row) => {
      const valueAfter = readRecord(row.valueAfter);
      const verificationFailed = valueAfter.verificationStatus === 'failed';
      const error = typeof valueAfter.error === 'string' ? valueAfter.error : null;
      return {
        id: `campaign:${row.id}`,
        kind: 'campaign_action' as const,
        status: verificationFailed ? 'needs_attention' as const : 'completed' as const,
        title: String(row.actionType),
        details: error ?? row.reason ?? `Объект: ${row.objectType}`,
        createdAt: row.createdAt.toISOString(),
        advertId: row.campaignId === null ? null : Number(row.campaignId),
        nmId: row.nmId === null ? null : Number(row.nmId),
        cluster: null,
        source: row.source,
      };
    }),
    ...runRows.map((row) => ({
      id: `run:${row.id}`,
      kind: 'strategy_run' as const,
      status: row.status === 'failed'
        ? 'needs_attention' as const
        : row.status === 'success'
          ? 'completed' as const
          : 'info' as const,
      title: 'Запуск автостратегии',
      details: row.errorMessage ?? `Статус: ${row.status}`,
      createdAt: row.startedAt.toISOString(),
      advertId: null,
      nmId: null,
      cluster: null,
      source: row.triggerSource,
    })),
  ];

  const statusRank: Record<AdvertisingActionQueueItem['status'], number> = {
    needs_attention: 0,
    blocked: 1,
    info: 2,
    completed: 3,
  };
  const sortedQueue = queue
    .sort((left, right) => (
      statusRank[left.status] - statusRank[right.status]
      || Date.parse(right.createdAt) - Date.parse(left.createdAt)
    ))
    .slice(0, 120);

  const criticalSignals = alerts.summary.critical
    + failedBidChanges
    + failedClusterActions
    + failedStrategyRuns
    + campaignVerificationFailures;
  const warningSignals = alerts.summary.high
    + alerts.summary.medium
    + guardrailBlockedBidChanges
    + postActionRollbackRecommendations;
  const status: AdvertisingOperationsStatus = criticalSignals > 0
    ? 'critical'
    : warningSignals > 0
      ? 'warning'
      : 'ok';

  return {
    generatedAt: new Date().toISOString(),
    status,
    summary: {
      alertsTotal: alerts.summary.total,
      criticalAlerts: alerts.summary.critical,
      highAlerts: alerts.summary.high,
      failedBidChanges,
      guardrailBlockedBidChanges,
      failedClusterActions,
      failedStrategyRuns,
      campaignVerificationFailures,
    },
    incidents,
    dailyReport,
    capabilities: ADVERTISING_CAPABILITIES,
    postActionEffects,
    queue: sortedQueue,
  };
}

function mapStrategyRecord(row: typeof advertisingAutoBidStrategies.$inferSelect): AdvertisingAutoBidStrategyRecord {
  const autopilotConfig = readAutopilotConfigFromSummary(row.lastSummary);
  return {
    id: row.id,
    name: row.name,
    advertId: Number(row.advertId),
    nmId: Number(row.nmId),
    mode: autopilotConfig.mode,
    targetPositionFrom: autopilotConfig.targetPositionFrom,
    targetPositionTo: autopilotConfig.targetPositionTo,
    explorationPct: autopilotConfig.explorationPct,
    minClicksForLearning: autopilotConfig.minClicksForLearning,
    retestCooldownHours: autopilotConfig.retestCooldownHours,
    retestPercent: autopilotConfig.retestPercent,
    maxRetestPerRun: autopilotConfig.maxRetestPerRun,
    isEnabled: row.isEnabled,
    dryRun: row.dryRun,
    biddingMode: normalizeBiddingMode(row.biddingMode),
    targetAcosPct: toNumber(row.targetAcosPct),
    targetCpmRub: toNumber(row.targetCpmRub),
    targetRoas: toNumber(row.targetRoas),
    minOrders: row.minOrders,
    maxCpcRub: toNumber(row.maxCpcRub),
    minBid: row.minBid,
    maxBid: row.maxBid,
    stepUpPct: toNumber(row.stepUpPct),
    stepDownPct: toNumber(row.stepDownPct),
    lookbackDays: row.lookbackDays,
    intervalMinutes: row.intervalMinutes,
    lastRunAt: row.lastRunAt ? row.lastRunAt.toISOString() : null,
    nextRunAt: row.nextRunAt ? row.nextRunAt.toISOString() : null,
    lastStatus: row.lastStatus,
    lastSummary: (row.lastSummary ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getAdvertisingAutoBidWorkspace(tenantId: string): Promise<AdvertisingAutoBidWorkspaceResponse> {
  const [strategies, runs, changes] = await withTenantContext(db, tenantId, async (tx) => Promise.all([
    tx.select()
      .from(advertisingAutoBidStrategies)
      .where(eq(advertisingAutoBidStrategies.tenantId, tenantId))
      .orderBy(desc(advertisingAutoBidStrategies.updatedAt))
      .limit(60),
    tx.select()
      .from(advertisingAutoBidRuns)
      .where(eq(advertisingAutoBidRuns.tenantId, tenantId))
      .orderBy(desc(advertisingAutoBidRuns.startedAt))
      .limit(80),
    tx.select()
      .from(advertisingBidChanges)
      .where(and(
        eq(advertisingBidChanges.tenantId, tenantId),
        eq(advertisingBidChanges.source, 'auto'),
      ))
      .orderBy(desc(advertisingBidChanges.createdAt))
      .limit(120),
  ]));

  return {
    generatedAt: new Date().toISOString(),
    strategies: strategies.map(mapStrategyRecord),
    runs: runs.map((row) => ({
      id: row.id,
      strategyId: row.strategyId,
      triggerSource: row.triggerSource,
      status: row.status,
      startedAt: row.startedAt.toISOString(),
      finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
      summary: (row.summary ?? {}) as Record<string, unknown>,
      errorMessage: row.errorMessage,
    })),
    recentChanges: changes.map((row) => ({
      id: row.id,
      strategyId: row.strategyId,
      runId: row.runId,
      source: row.source,
      advertId: Number(row.advertId),
      nmId: Number(row.nmId),
      cluster: row.cluster,
      previousBid: row.previousBid,
      nextBid: row.nextBid,
      status: row.status,
      reason: row.reason,
      metrics: (row.metrics ?? {}) as Record<string, unknown>,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}

function validateStrategyInput(input: SaveAdvertisingAutoBidStrategyInput) {
  const name = String(input.name ?? '').trim();
  if (!name) {
    throw new AppError('Название стратегии обязательно', 400);
  }
  if (!Number.isFinite(input.advertId) || input.advertId <= 0) {
    throw new AppError('Некорректный advertId', 400);
  }
  if (!Number.isFinite(input.nmId) || input.nmId <= 0) {
    throw new AppError('Некорректный nmId', 400);
  }
  if (!Number.isFinite(input.intervalMinutes) || input.intervalMinutes < 15) {
    throw new AppError('Интервал стратегии должен быть минимум 15 минут', 400);
  }
  if (input.maxBid < input.minBid) {
    throw new AppError('maxBid не может быть меньше minBid', 400);
  }

  const autopilotConfig = normalizeAutopilotConfig({
    mode: input.mode,
    targetPositionFrom: input.targetPositionFrom,
    targetPositionTo: input.targetPositionTo,
    explorationPct: input.explorationPct,
    minClicksForLearning: input.minClicksForLearning,
    retestCooldownHours: input.retestCooldownHours,
    retestPercent: input.retestPercent,
    maxRetestPerRun: input.maxRetestPerRun,
  });

  const biddingMode = normalizeBiddingMode(input.biddingMode ?? DEFAULT_BIDDING_MODE);
  const targetCpmRub = Math.max(
    0.01,
    round(Number.isFinite(Number(input.targetCpmRub)) && Number(input.targetCpmRub) > 0
      ? Number(input.targetCpmRub)
      : DEFAULT_TARGET_CPM_RUB, 2),
  );
  const targetRoas = Math.max(
    0.01,
    round(Number.isFinite(Number(input.targetRoas)) && Number(input.targetRoas) > 0
      ? Number(input.targetRoas)
      : DEFAULT_TARGET_ROAS, 2),
  );

  return {
    ...input,
    name,
    autopilotConfig,
    biddingMode,
    targetAcosPct: Math.max(1, round(input.targetAcosPct, 2)),
    targetCpmRub,
    targetRoas,
    minOrders: Math.max(0, Math.round(input.minOrders)),
    maxCpcRub: Math.max(0, round(input.maxCpcRub, 2)),
    minBid: Math.max(0, Math.round(input.minBid)),
    maxBid: Math.max(0, Math.round(input.maxBid)),
    stepUpPct: Math.max(0, round(input.stepUpPct, 2)),
    stepDownPct: Math.max(0, round(input.stepDownPct, 2)),
    lookbackDays: Math.min(30, Math.max(1, Math.round(input.lookbackDays))),
    intervalMinutes: Math.min(1_440, Math.max(15, Math.round(input.intervalMinutes))),
  };
}

export async function saveAdvertisingAutoBidStrategy(
  tenantId: string,
  userId: string | null,
  input: SaveAdvertisingAutoBidStrategyInput,
): Promise<AdvertisingAutoBidStrategyRecord> {
  const validated = validateStrategyInput(input);
  const now = new Date();

  if (validated.id) {
    const [existing] = await withTenantContext(db, tenantId, async (tx) =>
      tx.select({
        id: advertisingAutoBidStrategies.id,
        lastSummary: advertisingAutoBidStrategies.lastSummary,
      })
        .from(advertisingAutoBidStrategies)
        .where(and(
          eq(advertisingAutoBidStrategies.id, validated.id!),
          eq(advertisingAutoBidStrategies.tenantId, tenantId),
        ))
        .limit(1),
    );

    if (!existing) {
      throw new AppError('Стратегия не найдена', 404);
    }

    const nextSummary = mergeAutopilotConfigIntoSummary(existing.lastSummary, validated.autopilotConfig);

    const updated = (await withTenantContext(db, tenantId, async (tx) =>
      tx.update(advertisingAutoBidStrategies)
        .set({
          userId,
          name: validated.name,
          advertId: validated.advertId,
          nmId: validated.nmId,
          isEnabled: validated.isEnabled,
          dryRun: validated.dryRun,
          biddingMode: validated.biddingMode,
          targetAcosPct: String(validated.targetAcosPct),
          targetCpmRub: String(validated.targetCpmRub),
          targetRoas: String(validated.targetRoas),
          minOrders: validated.minOrders,
          maxCpcRub: String(validated.maxCpcRub),
          minBid: validated.minBid,
          maxBid: validated.maxBid,
          stepUpPct: String(validated.stepUpPct),
          stepDownPct: String(validated.stepDownPct),
          lookbackDays: validated.lookbackDays,
          intervalMinutes: validated.intervalMinutes,
          lastSummary: nextSummary,
          nextRunAt: validated.isEnabled ? computeNextRunAt(validated.intervalMinutes, now) : null,
          updatedAt: now,
        })
        .where(and(
          eq(advertisingAutoBidStrategies.id, validated.id!),
          eq(advertisingAutoBidStrategies.tenantId, tenantId),
        ))
        .returning(),
    ))[0]!;

    return mapStrategyRecord(updated);
  }

  const initialSummary = mergeAutopilotConfigIntoSummary({}, validated.autopilotConfig);

  const created = (await withTenantContext(db, tenantId, async (tx) =>
    tx.insert(advertisingAutoBidStrategies)
      .values({
        tenantId,
        userId,
        name: validated.name,
        advertId: validated.advertId,
        nmId: validated.nmId,
        isEnabled: validated.isEnabled,
        dryRun: validated.dryRun,
        biddingMode: validated.biddingMode,
        targetAcosPct: String(validated.targetAcosPct),
        targetCpmRub: String(validated.targetCpmRub),
        targetRoas: String(validated.targetRoas),
        minOrders: validated.minOrders,
        maxCpcRub: String(validated.maxCpcRub),
        minBid: validated.minBid,
        maxBid: validated.maxBid,
        stepUpPct: String(validated.stepUpPct),
        stepDownPct: String(validated.stepDownPct),
        lookbackDays: validated.lookbackDays,
        intervalMinutes: validated.intervalMinutes,
        lastSummary: initialSummary,
        nextRunAt: validated.isEnabled ? computeNextRunAt(validated.intervalMinutes, now) : null,
        updatedAt: now,
      })
      .returning(),
  ))[0]!;

  return mapStrategyRecord(created);
}

export async function deleteAdvertisingAutoBidStrategy(tenantId: string, strategyId: string): Promise<void> {
  await withTenantContext(db, tenantId, async (tx) => {
    await tx.delete(advertisingAutoBidStrategies)
      .where(and(
        eq(advertisingAutoBidStrategies.id, strategyId),
        eq(advertisingAutoBidStrategies.tenantId, tenantId),
      ));
  });
}

async function executeStrategyRun(
  strategy: typeof advertisingAutoBidStrategies.$inferSelect,
  options: { triggerSource: 'manual' | 'scheduled'; userId: string | null },
) {
  const run = (await withTenantContext(db, strategy.tenantId, async (tx) =>
    tx.insert(advertisingAutoBidRuns)
      .values({
        strategyId: strategy.id,
        tenantId: strategy.tenantId,
        triggerSource: options.triggerSource,
        status: 'running',
      })
      .returning(),
  ))[0]!;

  const lookbackDays = Math.max(1, strategy.lookbackDays);
  const rangeTo = toUtcDayStart(new Date());
  const rangeFrom = addUtcDays(rangeTo, -(lookbackDays - 1));
  const autopilotConfig = readAutopilotConfigFromSummary(strategy.lastSummary);
  const previousLearningState = readLearningStateFromSummary(strategy.lastSummary);
  const runReferenceDate = new Date();
  const learningTarget = autopilotConfig.mode === 'self_learning'
    ? pickSelfLearningTarget(autopilotConfig, previousLearningState, strategy.id, runReferenceDate)
    : {
      from: autopilotConfig.targetPositionFrom,
      to: autopilotConfig.targetPositionTo,
      key: learningArmKey(autopilotConfig.targetPositionFrom, autopilotConfig.targetPositionTo),
      exploration: false,
      reason: 'classic_mode',
    };

  // P72b: Thompson Sampling shadow-mode — считаем выбор bandit-алгоритма
  // параллельно с epsilon-greedy, применяем всё равно epsilon-greedy.
  // Для classic mode и policy='epsilon_greedy' bandit не активируется.
  const banditActive = autopilotConfig.mode === 'self_learning'
    && autopilotConfig.policy !== 'epsilon_greedy';
  const banditStateBefore = banditActive
    ? ensureBanditStateMatches(
      previousLearningState.bandit,
      autopilotConfig.policy as 'thompson_beta' | 'thompson_normal',
      autopilotConfig.rewardKind,
    )
    : null;
  const banditShadow = banditActive && banditStateBefore
    ? pickBanditShadow(banditStateBefore, strategy.id, runReferenceDate)
    : null;

  try {
    const tenantRow = await db.query.tenants.findFirst({
      columns: {
        advertisingAutopilotEnabled: true,
        advertisingAutopilotMode: true,
      },
      where: eq(tenants.id, strategy.tenantId),
    });
    const tenantAutopilotMode = normalizeTenantAdvertisingAutopilotMode(tenantRow?.advertisingAutopilotMode);
    const effectiveDryRun = strategy.dryRun || tenantAutopilotMode !== 'auto';

    let retestResult = {
      candidates: 0,
      selected: 0,
      included: 0,
      failed: 0,
      clusters: [] as string[],
      errors: [] as string[],
    };

    if (autopilotConfig.mode === 'self_learning') {
      try {
        retestResult = await runExcludedClusterRetest(strategy, {
          userId: options.userId,
          dryRun: effectiveDryRun,
          config: autopilotConfig,
        });
      } catch (error) {
        retestResult = {
          ...retestResult,
          errors: [error instanceof Error ? error.message : String(error)],
        };
      }
    }

    const workspace = await getAdvertisingBidWorkspace(strategy.tenantId, {
      advertId: Number(strategy.advertId),
      nmId: Number(strategy.nmId),
      dateFrom: rangeFrom,
      dateTo: rangeTo,
    });
    const todayMetricsByCluster = await getClusterPerformanceByNm(
      strategy.tenantId,
      Number(strategy.nmId),
      rangeTo,
      rangeTo,
    );

    const targetAcosPct = toNumber(strategy.targetAcosPct);
    const maxCpcRub = toNumber(strategy.maxCpcRub);
    const stepUpPct = toNumber(strategy.stepUpPct);
    const stepDownPct = toNumber(strategy.stepDownPct);
    const biddingMode = normalizeBiddingMode(strategy.biddingMode);
    const biddingTargets = {
      targetDrrPct: targetAcosPct,
      targetCpmRub: toNumber(strategy.targetCpmRub) || DEFAULT_TARGET_CPM_RUB,
      targetRoas: toNumber(strategy.targetRoas) || DEFAULT_TARGET_ROAS,
    };

    // ── Guardrails ──────────────────────────────────────────────────────────
    const guardrailConfig = normalizeGuardrailConfig(strategy.guardrailConfig);

    const [stockRow] = await Promise.all([
      withTenantContext(db, strategy.tenantId, async (tx) =>
        tx.select({ total: sum(rawApiStocks.amount) })
          .from(rawApiStocks)
          .where(and(
            eq(rawApiStocks.tenantId, strategy.tenantId),
            eq(rawApiStocks.nmId, Number(strategy.nmId)),
          ))
          .then((rows) => rows[0]),
      ),
    ]);

    const spendTodayRubTotal = round(
      [...todayMetricsByCluster.values()].reduce((s, m) => s + m.adSpend, 0),
      2,
    );
    const acosSamples = workspace.rows
      .map((r) => r.acosProxyPct)
      .filter((v): v is number => v !== null && Number.isFinite(v));
    const avgDRRPct = acosSamples.length > 0
      ? round(acosSamples.reduce((a, b) => a + b, 0) / acosSamples.length, 2)
      : null;

    const sharedGuardrailCtx: GuardrailContext = {
      autopilotEnabled: tenantRow?.advertisingAutopilotEnabled ?? true,
      strategyStartedAt: strategy.strategyStartedAt ?? new Date(strategy.createdAt),
      lastBidChangedAt: strategy.lastBidChangedAt ?? null,
      stockQty: stockRow?.total != null ? Math.round(Number(stockRow.total)) : null,
      drrLookbackPct: avgDRRPct,
      spendRub24h: [...todayMetricsByCluster.values()].reduce((s, m) => s + m.adSpend, 0),
      orders24h: [...todayMetricsByCluster.values()].reduce((s, m) => s + m.orders, 0),
      crPct7d: workspace.rows.find((r) => r.cvrPct !== null)?.cvrPct ?? null,
      spendTodayRubTotal,
      currentBid: 0,   // 0 → max_bid_delta / max_bid skipped at strategy level
      proposedBid: 0,
      wbRecommendedBid: null,
      targetAcosPct,
    };

    const strategyGuardrail = checkGuardrails(sharedGuardrailCtx, guardrailConfig);

    // P70: learning_period_ended — детект транзиции «был в learning period → вышел из него».
    // Используем strategy.lastRunAt как маркер прошлого состояния, без новой колонки в schema.
    // Throttle-subkey = strategy.id с окном 365д (из ALERT_THROTTLE_MS) защищает от повторов
    // даже при рестарте сервера внутри окна.
    const effectiveStartedAt = strategy.strategyStartedAt ?? new Date(strategy.createdAt);
    const learnDays = guardrailConfig.learningPeriodDays;
    const wasInLearning = strategy.lastRunAt != null
      && isInLearningPeriod(effectiveStartedAt, learnDays, strategy.lastRunAt);
    const stillInLearning = isInLearningPeriod(effectiveStartedAt, learnDays, new Date());
    if (wasInLearning && !stillInLearning) {
      void sendAdAlert(
        strategy.tenantId,
        {
          type: 'learning_period_ended',
          strategyName: strategy.name,
          switchedAt: new Date(),
        },
        { subkey: strategy.id },
      ).catch((error: unknown) => {
        logger.error({ err: error, tenantId: strategy.tenantId, strategyId: strategy.id }, '[executeStrategyRun] learning_period_ended alert failed');
      });
    }

    if (!strategyGuardrail.passed) {
      await withTenantContext(db, strategy.tenantId, async (tx) => {
        await tx.insert(advertisingGuardrailEvents).values({
          tenantId: strategy.tenantId,
          strategyId: strategy.id,
          runId: run.id,
          trigger: strategyGuardrail.blockedBy!,
          cluster: null,
          context: {
            reason: strategyGuardrail.reason,
            advisorOnly: strategyGuardrail.advisorOnly,
            spendTodayRubTotal,
            stockQty: sharedGuardrailCtx.stockQty,
            drrLookbackPct: avgDRRPct,
          } satisfies Record<string, unknown>,
        });
      });

      const guardrailSummary: Record<string, unknown> = {
        changedCount: 0,
        appliedCount: 0,
        failedCount: 0,
        dryRun: effectiveDryRun,
        configuredDryRun: strategy.dryRun,
        tenantAutopilotMode,
        lookbackDays,
        mode: autopilotConfig.mode,
        targetAcosPct,
        guardrailBlocked: true,
        guardrailTrigger: strategyGuardrail.blockedBy,
        guardrailReason: strategyGuardrail.reason,
        advisorOnly: strategyGuardrail.advisorOnly,
      };

      await withTenantContext(db, strategy.tenantId, async (tx) => {
        await tx.update(advertisingAutoBidRuns)
          .set({ status: 'skipped', finishedAt: new Date(), summary: guardrailSummary })
          .where(eq(advertisingAutoBidRuns.id, run.id));

        await tx.update(advertisingAutoBidStrategies)
          .set({
            lastRunAt: new Date(),
            nextRunAt: strategy.isEnabled ? computeNextRunAt(strategy.intervalMinutes) : null,
            lastStatus: 'skipped',
            lastSummary: guardrailSummary,
            updatedAt: new Date(),
          })
          .where(eq(advertisingAutoBidStrategies.id, strategy.id));
      });

      // P70: TG-алерты на strategy-level guardrail-блок.
      // Не алертим в learning/advisor режиме. Throttle subkey per-strategy+trigger защищает от
      // спама при повторных срабатываниях на каждом run (стратегия обычно крутится раз в час).
      if (strategyGuardrail.blockedBy && !strategyGuardrail.advisorOnly) {
        const trigger = strategyGuardrail.blockedBy;
        const throttleKey = { subkey: `${strategy.id}-${trigger}`, windowMs: 60 * 60 * 1000 };

        if (trigger === 'daily_cap' && guardrailConfig.dailySpendCapRub !== null) {
          // Специальный тип алерта: дневной лимит достигнут
          void sendAdAlert(
            strategy.tenantId,
            {
              type: 'daily_cap_reached',
              capRub: guardrailConfig.dailySpendCapRub,
              spentRub: spendTodayRubTotal,
              campaignsPaused: 1,
            },
            { subkey: `${strategy.id}-daily_cap`, windowMs: 6 * 60 * 60 * 1000 },
          ).catch((error: unknown) => {
            logger.error({ err: error, tenantId: strategy.tenantId, strategyId: strategy.id }, '[executeStrategyRun] daily_cap_reached alert failed');
          });
        } else {
          const autoPauseAction = mapGuardrailToAutoPauseAction(
            trigger,
            sharedGuardrailCtx,
            guardrailConfig,
          );
          if (autoPauseAction) {
            void sendAdAlert(
              strategy.tenantId,
              {
                type: 'auto_pause',
                action: autoPauseAction,
                campaignName: strategy.name,
                campaignId: Number(strategy.advertId),
              },
              throttleKey,
            ).catch((error: unknown) => {
              logger.error({ err: error, tenantId: strategy.tenantId, strategyId: strategy.id }, '[executeStrategyRun] auto_pause alert failed');
            });
          }
        }
      }

      return {
        strategyId: strategy.id,
        runId: run.id,
        status: 'skipped' as const,
        changedCount: 0,
        guardrailBlocked: true,
        guardrailTrigger: strategyGuardrail.blockedBy,
      };
    }
    // ── /Guardrails ─────────────────────────────────────────────────────────

    const proposals = workspace.rows
      .map((row) => {
        let nextBid = row.currentBid;
        let reason: string | null = null;
        const hasAcosPressure = row.acosProxyPct !== null && row.acosProxyPct > targetAcosPct;
        const hasCpcPressure = row.cpcRub !== null && row.cpcRub > maxCpcRub;
        const hasCostPressure = hasAcosPressure || hasCpcPressure;
        const inTargetPosition = isPositionInRange(row.avgPos, learningTarget.from, learningTarget.to);
        const clusterKey = normalizeCluster(row.cluster);
        const todayMetrics = todayMetricsByCluster.get(clusterKey);

        if (autopilotConfig.mode === 'self_learning') {
          if (row.orders < strategy.minOrders && row.clicks >= autopilotConfig.minClicksForLearning) {
            nextBid = row.currentBid * (1 - stepDownPct / 100);
            reason = 'orders_below_min';
          } else if (row.avgPos !== null && row.avgPos < learningTarget.from) {
            const distance = Math.max(0, learningTarget.from - row.avgPos);
            const stepFactor = 1 + Math.min(1.2, distance * 0.6);
            nextBid = row.currentBid * (1 - (stepDownPct * stepFactor) / 100);
            reason = 'position_above_target_probe_down';
          } else if (row.avgPos !== null && row.avgPos > learningTarget.to) {
            if (hasCostPressure) {
              reason = hasAcosPressure ? 'acos_above_target' : 'cpc_above_max';
            } else {
              const distance = Math.max(0, row.avgPos - learningTarget.to);
              const stepFactor = 1 + Math.min(1.5, distance * 0.5);
              nextBid = row.currentBid * (1 + (stepUpPct * stepFactor) / 100);
              reason = 'position_below_target_raise';
            }
          } else if (inTargetPosition) {
            const probeDownPct = Math.max(1, stepDownPct * 0.45);
            nextBid = row.currentBid * (1 - probeDownPct / 100);
            reason = 'position_in_target_probe_down';
          } else if (
            row.avgPos === null
            && row.clicks < autopilotConfig.minClicksForLearning
            && !hasCostPressure
          ) {
            const probeUpPct = Math.max(1, stepUpPct * 0.35);
            nextBid = row.currentBid * (1 + probeUpPct / 100);
            reason = 'insufficient_position_data_probe_up';
          }

          if (hasCostPressure && nextBid > row.currentBid) {
            nextBid = row.currentBid;
            reason = hasAcosPressure ? 'acos_above_target' : 'cpc_above_max';
          }
        } else if (row.orders < strategy.minOrders) {
          nextBid = row.currentBid * (1 - stepDownPct / 100);
          reason = 'orders_below_min';
        } else if (hasCpcPressure) {
          nextBid = row.currentBid * (1 - stepDownPct / 100);
          reason = 'cpc_above_max';
        } else {
          const pressure = computeBidPressure({
            mode: biddingMode,
            metrics: {
              adSpend: row.adSpend,
              views: row.views,
              clicks: row.clicks,
              orders: row.orders,
              cpcRub: row.cpcRub,
              acosProxyPct: row.acosProxyPct,
            },
            targets: biddingTargets,
          });

          if (pressure.direction === 'down' && pressure.magnitude > 0) {
            const scaledStep = Math.max(stepDownPct * 0.5, stepDownPct * pressure.magnitude);
            nextBid = row.currentBid * (1 - scaledStep / 100);
            reason = pressure.reason;
          } else if (
            pressure.direction === 'up'
            && pressure.magnitude > 0
            && row.orders >= strategy.minOrders
            && (row.cpcRub === null || row.cpcRub <= maxCpcRub * 0.9)
          ) {
            const scaledStep = Math.max(stepUpPct * 0.5, stepUpPct * pressure.magnitude);
            nextBid = row.currentBid * (1 + scaledStep / 100);
            reason = biddingMode === 'drr' ? 'performance_above_target' : pressure.reason;
          }
        }

        const boundedNextBid = clampInt(nextBid, strategy.minBid, strategy.maxBid);
        const bidDeltaPct = toBidChangePct(row.currentBid, boundedNextBid);
        const guardrailCode = hasAcosPressure
          ? 'drr_above_target'
          : hasCpcPressure
            ? 'cpc_above_max'
            : row.orders < strategy.minOrders
              ? 'orders_below_min'
              : null;
        const estimatedSavingsRub = estimateBidSavingsRub(row.currentBid, boundedNextBid, row.clicks, {
          lookbackDays,
          intervalMinutes: strategy.intervalMinutes,
        });
        return {
          cluster: row.cluster,
          previousBid: row.currentBid,
          nextBid: boundedNextBid,
          reason,
          changed: boundedNextBid !== row.currentBid && reason !== null,
          metrics: {
            mode: autopilotConfig.mode,
            targetPositionFrom: learningTarget.from,
            targetPositionTo: learningTarget.to,
            avgPos: row.avgPos,
            inTargetPosition,
            bidDeltaPct,
            guardrailCode,
            adSpend: row.adSpend,
            clicks: row.clicks,
            orders: row.orders,
            adSpendWindow: row.adSpend,
            clicksWindow: row.clicks,
            ordersWindow: row.orders,
            drrWindowPct: row.acosProxyPct,
            ctrPct: row.ctrPct,
            cpcRub: row.cpcRub,
            cpoRub: row.cpoRub,
            acosProxyPct: row.acosProxyPct,
            adSpendToday: todayMetrics?.adSpend ?? 0,
            clicksToday: todayMetrics?.clicks ?? 0,
            ordersToday: todayMetrics?.orders ?? 0,
            drrTodayPct: todayMetrics?.acosProxyPct ?? null,
            estimatedSavingsRub,
            estimatedSavingsModel: 'interval_window',
            estimatedSavingsIntervalMinutes: strategy.intervalMinutes,
            estimatedSavingsLookbackDays: lookbackDays,
          },
        };
      })
      .filter((row) => {
        if (!row.changed) return false;
        // Per-cluster hard limits (max_bid_delta, max_bid)
        const clusterGuardrail = checkGuardrails(
          { ...sharedGuardrailCtx, currentBid: row.previousBid, proposedBid: row.nextBid },
          guardrailConfig,
        );
        if (!clusterGuardrail.passed) {
          // Fire-and-forget — guardrail event for skipped cluster
          withTenantContext(db, strategy.tenantId, async (tx) => {
            await tx.insert(advertisingGuardrailEvents).values({
              tenantId: strategy.tenantId,
              strategyId: strategy.id,
              runId: run.id,
              trigger: clusterGuardrail.blockedBy!,
              cluster: row.cluster,
              context: {
                reason: clusterGuardrail.reason,
                currentBid: row.previousBid,
                proposedBid: row.nextBid,
              } satisfies Record<string, unknown>,
            });
          }).catch(() => undefined);
          return false;
        }
        return true;
      });

    const avgPosSamples = workspace.rows
      .map((row) => row.avgPos)
      .filter((value): value is number => value !== null && Number.isFinite(value));
    const observedAvgPos = avgPosSamples.length > 0
      ? round(avgPosSamples.reduce((sum, value) => sum + value, 0) / avgPosSamples.length, 2)
      : null;
    const runReward = autopilotConfig.mode === 'self_learning'
      ? computeSelfLearningRunReward(
        workspace.rows,
        { from: learningTarget.from, to: learningTarget.to },
        targetAcosPct,
        maxCpcRub,
        autopilotConfig.minClicksForLearning,
      )
      : null;
    const estimatedSavingsRub = round(
      proposals.reduce((sum, proposal) => sum + toNumber(proposal.metrics.estimatedSavingsRub), 0),
      2,
    );

    // P72b: observed ACOS за окно — переиспользуем avgDRRPct, уже посчитанный
    // выше для guardrail-контекста (среднее acosProxyPct по кластерам).
    const observedAcosPct = avgDRRPct;

    const nextBanditState = (() => {
      if (!banditActive || !banditStateBefore || !banditShadow) {
        return banditStateBefore ?? undefined;
      }
      const reward = computeBanditReward({
        rewardKind: autopilotConfig.rewardKind,
        observedAvgPos,
        targetFrom: learningTarget.from,
        targetTo: learningTarget.to,
        observedAcosPct,
        targetAcosPct,
      });
      const matchedApplied = banditShadow.key === (learningTarget.key as LearningArmKey);
      // Обновление posterior делается для arm, который **реально отработал**
      // (learningTarget — epsilon-greedy выбор), а не для arm, который
      // выбрал бы bandit. Так мы честно обновляем «что случилось на этом arm»
      // без самовнушения — bandit учится на наблюдённых данных всех arm-ов.
      return updateBanditPosterior(
        banditStateBefore,
        learningTarget.key as LearningArmKey,
        reward,
        learningTarget.from,
        learningTarget.to,
        matchedApplied,
        runReferenceDate,
      );
    })();

    const nextLearningState = (() => {
      if (autopilotConfig.mode !== 'self_learning') {
        return previousLearningState;
      }

      const nextState = {
        ...previousLearningState,
        totalRuns: previousLearningState.totalRuns + 1,
        totalEstimatedSavingsRub: round(previousLearningState.totalEstimatedSavingsRub + estimatedSavingsRub, 2),
        totalRetestedClusters: previousLearningState.totalRetestedClusters + retestResult.included,
        lastTarget: { from: learningTarget.from, to: learningTarget.to },
        updatedAt: runReferenceDate.toISOString(),
        arms: {
          ...previousLearningState.arms,
        },
        ...(nextBanditState ? { bandit: nextBanditState } : {}),
      } satisfies StrategyLearningState;

      const armKey = learningTarget.key as LearningArmKey;
      const currentArm = nextState.arms[armKey] ?? createEmptyLearningArm();
      nextState.arms[armKey] = {
        runs: currentArm.runs + 1,
        rewardSum: round(currentArm.rewardSum + (runReward ?? 0), 6),
        spendSum: round(currentArm.spendSum + workspace.summary.adSpend, 2),
        ordersSum: currentArm.ordersSum + workspace.summary.orders,
        savingsSum: round(currentArm.savingsSum + estimatedSavingsRub, 2),
        avgPosSum: round(currentArm.avgPosSum + (observedAvgPos ?? 0), 6),
        avgPosSamples: currentArm.avgPosSamples + (observedAvgPos === null ? 0 : 1),
      };
      return nextState;
    })();

    // P72d: A/B авто-выбор победителя.
    // Если thompson posterior набрал >= 95% confidence vs epsilon-greedy baseline,
    // переключаем policy на thompson (только если bandit был активен в этом запуске).
    const banditWinner =
      banditActive && nextBanditState
        ? checkBanditWinner(nextBanditState, nextLearningState, strategyIdToSeed(strategy.id))
        : ({ shouldSwitch: false } as const);
    const effectiveAutopilotConfig: StrategyAutopilotConfig = banditWinner.shouldSwitch
      ? { ...autopilotConfig, policy: banditWinner.winnerPolicy }
      : autopilotConfig;

    const buildRunSummary = (status: string) => {
      const baseSummary: Record<string, unknown> = {
        changedCount: proposals.length,
        appliedCount: 0,
        failedCount: 0,
        dryRun: effectiveDryRun,
        configuredDryRun: strategy.dryRun,
        tenantAutopilotMode,
        lookbackDays,
        mode: autopilotConfig.mode,
        targetAcosPct,
        maxCpcRub,
        targetPositionFrom: learningTarget.from,
        targetPositionTo: learningTarget.to,
        targetSelectionReason: learningTarget.reason,
        explorationRun: learningTarget.exploration,
        observedAvgPos,
        runReward,
        estimatedSavingsRub,
        estimatedSavingsModel: 'interval_window',
        estimatedSavingsIntervalMinutes: strategy.intervalMinutes,
        estimatedSavingsLookbackDays: lookbackDays,
        retest: retestResult,
        runStatus: status,
        ...(banditShadow && banditStateBefore
          ? {
            banditShadow: {
              policy: banditShadow.policy,
              rewardKind: autopilotConfig.rewardKind,
              pickedFrom: banditShadow.from,
              pickedTo: banditShadow.to,
              pickedKey: banditShadow.key,
              appliedKey: learningTarget.key,
              matchedApplied: banditShadow.key === learningTarget.key,
              observedAcosPct,
              samples: banditShadow.samples,
            },
          }
          : {}),
      };
      return mergeLearningStateIntoSummary(
        mergeAutopilotConfigIntoSummary(baseSummary, effectiveAutopilotConfig),
        nextLearningState,
      );
    };

    if (proposals.length === 0) {
      const summary = buildRunSummary('skipped');

      await withTenantContext(db, strategy.tenantId, async (tx) => {
        await tx.update(advertisingAutoBidRuns)
          .set({ status: 'skipped', finishedAt: new Date(), summary })
          .where(eq(advertisingAutoBidRuns.id, run.id));

        await tx.update(advertisingAutoBidStrategies)
          .set({
            lastRunAt: new Date(),
            nextRunAt: strategy.isEnabled ? computeNextRunAt(strategy.intervalMinutes) : null,
            lastStatus: 'skipped',
            lastSummary: summary,
            updatedAt: new Date(),
          })
          .where(eq(advertisingAutoBidStrategies.id, strategy.id));
      });

      // P72d: fire-and-forget алерт об A/B победителе
      if (banditWinner.shouldSwitch) {
        void notifyBanditWinner(
          strategy.tenantId,
          strategy.id,
          strategy.name,
          banditWinner.winnerPolicy,
          banditWinner.confidence,
          banditWinner.thompsonObsTotal,
        );
      }

      return { strategyId: strategy.id, runId: run.id, status: 'skipped', changedCount: 0 };
    }

    const failedClusters = new Set<string>();
    let appliedCount = effectiveDryRun ? 0 : proposals.length;

    if (!effectiveDryRun) {
      const token = await getTenantWbToken(strategy.tenantId);
      for (const batch of chunkArray(proposals, MAX_BID_BATCH_SIZE)) {
        try {
          await wbApi.setSearchClusterBids(token, batch.map((item) => ({
            advertId: Number(strategy.advertId),
            nmId: Number(strategy.nmId),
            keyword: item.cluster,
            bid: item.nextBid,
          })));
        } catch (error) {
          if (error instanceof WbAdActionVerificationError) {
            for (const item of error.failedItems) {
              if (item.keyword) {
                failedClusters.add(normalizeCluster(item.keyword));
              }
            }
          } else {
            for (const item of batch) {
              failedClusters.add(normalizeCluster(item.cluster));
            }
          }
        }
      }

      appliedCount = proposals.filter((proposal) => !failedClusters.has(normalizeCluster(proposal.cluster))).length;
    }

    const failedCount = effectiveDryRun ? 0 : proposals.length - appliedCount;
    const status = failedCount > 0 && !effectiveDryRun ? 'failed' : 'success';
    const summary = {
      ...buildRunSummary(status),
      appliedCount: effectiveDryRun ? 0 : appliedCount,
      failedCount,
    } satisfies Record<string, unknown>;

    // onConflictDoNothing on (tenantId, idempotencyKey) protects against
    // duplicate audit rows if Inngest retries this step after a transient error.
    await withTenantContext(db, strategy.tenantId, async (tx) => {
      await tx.insert(advertisingBidChanges).values(
        proposals.map((proposal) => ({
          tenantId: strategy.tenantId,
          strategyId: strategy.id,
          runId: run.id,
          userId: options.userId,
          source: 'auto',
          advertId: Number(strategy.advertId),
          nmId: Number(strategy.nmId),
          cluster: proposal.cluster,
          previousBid: proposal.previousBid,
          nextBid: proposal.nextBid,
          status: effectiveDryRun
            ? 'preview'
            : failedClusters.has(normalizeCluster(proposal.cluster))
              ? 'failed'
              : 'applied',
          reason: proposal.reason,
          idempotencyKey: `${run.id}:${Number(strategy.nmId)}:${normalizeCluster(proposal.cluster)}`,
          metrics: proposal.metrics,
        })),
      ).onConflictDoNothing();

      await tx.update(advertisingAutoBidRuns)
        .set({ status, finishedAt: new Date(), summary })
        .where(eq(advertisingAutoBidRuns.id, run.id));
    });

    await withTenantContext(db, strategy.tenantId, async (tx) => {
      await tx.update(advertisingAutoBidStrategies)
        .set({
          lastRunAt: new Date(),
          nextRunAt: strategy.isEnabled ? computeNextRunAt(strategy.intervalMinutes) : null,
          lastStatus: status,
          lastSummary: summary,
          lastBidChangedAt: !effectiveDryRun && appliedCount > 0 ? new Date() : strategy.lastBidChangedAt,
          updatedAt: new Date(),
        })
        .where(eq(advertisingAutoBidStrategies.id, strategy.id));
    });

    // P72d: fire-and-forget алерт об A/B победителе
    if (banditWinner.shouldSwitch) {
      void notifyBanditWinner(
        strategy.tenantId,
        strategy.id,
        strategy.name,
        banditWinner.winnerPolicy,
        banditWinner.confidence,
        banditWinner.thompsonObsTotal,
      );
    }

    return {
      strategyId: strategy.id,
      runId: run.id,
      status,
      changedCount: proposals.length,
      appliedCount,
      failedCount,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failedSummary = mergeLearningStateIntoSummary(
      mergeAutopilotConfigIntoSummary({
        error: message,
        mode: autopilotConfig.mode,
      }, autopilotConfig),
      previousLearningState,
    );

    await withTenantContext(db, strategy.tenantId, async (tx) => {
      await tx.update(advertisingAutoBidRuns)
        .set({ status: 'failed', finishedAt: new Date(), errorMessage: message, summary: failedSummary })
        .where(eq(advertisingAutoBidRuns.id, run.id));

      await tx.update(advertisingAutoBidStrategies)
        .set({
          lastRunAt: new Date(),
          nextRunAt: strategy.isEnabled ? computeNextRunAt(strategy.intervalMinutes) : null,
          lastStatus: 'failed',
          lastSummary: failedSummary,
          updatedAt: new Date(),
        })
        .where(eq(advertisingAutoBidStrategies.id, strategy.id));
    });

    return { strategyId: strategy.id, runId: run.id, status: 'failed', error: message };
  }
}

export async function runAdvertisingAutoBidStrategyNow(
  tenantId: string,
  strategyId: string,
  userId: string | null,
) {
  const [strategy] = await withTenantContext(db, tenantId, async (tx) =>
    tx.select()
      .from(advertisingAutoBidStrategies)
      .where(and(
        eq(advertisingAutoBidStrategies.id, strategyId),
        eq(advertisingAutoBidStrategies.tenantId, tenantId),
      ))
      .limit(1),
  );

  if (!strategy) {
    throw new AppError('Стратегия не найдена', 404);
  }

  return executeStrategyRun(strategy, {
    triggerSource: 'manual',
    userId,
  });
}

export async function runDueAdvertisingAutoBidStrategies() {
  const now = new Date();
  // Admin-path: scheduler scans strategies across all tenants. Per-strategy
  // execution uses per-tenant context inside executeStrategyRun.
  const dueStrategies = await withAdminContext(db, (tx) =>
    tx
      .select()
      .from(advertisingAutoBidStrategies)
      .where(and(
        eq(advertisingAutoBidStrategies.isEnabled, true),
        or(
          isNull(advertisingAutoBidStrategies.nextRunAt),
          lte(advertisingAutoBidStrategies.nextRunAt, now),
        ),
      ))
      .orderBy(asc(advertisingAutoBidStrategies.nextRunAt))
      .limit(40),
  );

  const results: Array<Record<string, unknown>> = [];
  for (const strategy of dueStrategies) {
    results.push(await executeStrategyRun(strategy, {
      triggerSource: 'scheduled',
      userId: null,
    }));
  }

  return {
    checked: dueStrategies.length,
    results,
  };
}
