import { and, desc, eq, gte, inArray, or, sql } from "drizzle-orm";

import { db, withTenantContext } from "@/lib/db";
import {
  rawApiStockSizes,
  redistributionItems,
  redistributionRouteAvailability,
  redistributionRouteAvailabilityEvents,
  redistributionRuns,
  redistributionSlotMonitorRuns,
  tenants,
} from "@/lib/db/schema";
import {
  probeRedistributionSlotsHttp,
  type RedistributionHttpSlotProbeResult,
} from "@/server/redistribution/wb-lk-http";
import {
  getRedistributionPlan,
  type RedistributionPlan,
  type RedistributionTransferRecommendation,
} from "@/server/analytics/redistribution";
import { isOfficialRedistributionWarehouse } from "@/server/redistribution/route-scan";

const SLOT_MONITOR_MAX_ROUTES_PER_TENANT = (() => {
  const parsed = Number.parseInt(process.env.REDISTRIBUTION_SLOT_MONITOR_MAX_ROUTES_PER_TENANT ?? "8", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 8;
  }
  return Math.min(parsed, 30);
})();

const SLOT_MONITOR_AUTO_SUBMIT = process.env.REDISTRIBUTION_SLOT_MONITOR_AUTO_SUBMIT !== "false";
const SLOT_MONITOR_LIVE_PLAN_ENABLED = process.env.REDISTRIBUTION_SLOT_MONITOR_LIVE_PLAN !== "false";
const SLOT_MONITOR_LIVE_PLAN_TRIGGER_SOURCE = "slot_monitor_live_plan";
const SLOT_MONITOR_MATRIX_ENABLED = process.env.REDISTRIBUTION_SLOT_MONITOR_MATRIX !== "false";
function parseBoundedInt(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, min), max);
}

const SLOT_MONITOR_LIVE_PLAN_WINDOW_DAYS = (() => {
  const parsed = Number.parseInt(
    process.env.REDISTRIBUTION_SLOT_MONITOR_PLAN_WINDOW_DAYS
      ?? process.env.REDISTRIBUTION_WINDOW_DAYS
      ?? "91",
    10,
  );
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 91;
  }
  return Math.min(parsed, 180);
})();
const SLOT_MONITOR_LIVE_PLAN_DUPLICATE_HOURS = (() => {
  const parsed = Number.parseInt(process.env.REDISTRIBUTION_SLOT_MONITOR_DUPLICATE_HOURS ?? "72", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 72;
  }
  return Math.min(parsed, 168);
})();
const SLOT_MONITOR_MATRIX_MAX_NM_PER_TENANT = (() => {
  const parsed = Number.parseInt(process.env.REDISTRIBUTION_SLOT_MONITOR_MATRIX_MAX_NM_PER_TENANT ?? "1", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 1;
  }
  return Math.min(parsed, 25);
})();
const SLOT_MONITOR_MATRIX_MAX_ROUTES_PER_TENANT = (() => {
  const parsed = Number.parseInt(process.env.REDISTRIBUTION_SLOT_MONITOR_MATRIX_MAX_ROUTES_PER_TENANT ?? "50", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 50;
  }
  return Math.min(parsed, 1500);
})();
const SLOT_MONITOR_TARGET_HTTP_429_BACKOFF_MIN = parseBoundedInt(
  process.env.REDISTRIBUTION_SLOT_MONITOR_TARGET_429_BACKOFF_MIN
    ?? process.env.REDISTRIBUTION_SLOT_MONITOR_HTTP_429_BACKOFF_MIN,
  6,
  0,
  60,
);
const SLOT_MONITOR_MATRIX_HTTP_429_BACKOFF_MIN = parseBoundedInt(
  process.env.REDISTRIBUTION_SLOT_MONITOR_MATRIX_429_BACKOFF_MIN,
  15,
  0,
  180,
);
const SLOT_MONITOR_FORBIDDEN_BACKOFF_HOURS = parseBoundedInt(
  process.env.REDISTRIBUTION_SLOT_MONITOR_FORBIDDEN_BACKOFF_HOURS,
  72,
  0,
  24 * 14,
);

const BLOCKING_ROUTE_STATUSES = ["limit_exhausted", "route_unavailable"] as const;
const MONITORED_ITEM_STATUSES = ["planned", "rpa_queued", "rpa_failed"] as const;
const LIVE_PLAN_DEDUP_ITEM_STATUSES = [...MONITORED_ITEM_STATUSES, "rpa_running"] as const;
const TARGET_SLOT_MONITOR_EVENT_SOURCES = [
  "stock_control_slot_probe",
  "stock_control_auto_submit",
  "http_slot_monitor_probe",
  "http_slot_monitor_auto_submit",
] as const;
const MATRIX_SLOT_MONITOR_EVENT_SOURCES = [
  "stock_control_quota_monitor",
  "stock_control_slot_matrix_monitor",
  "http_quota_monitor",
  "http_slot_matrix_monitor",
] as const;
const REDISTRIBUTION_HTTP_EVENT_SOURCES = [
  ...TARGET_SLOT_MONITOR_EVENT_SOURCES,
  ...MATRIX_SLOT_MONITOR_EVENT_SOURCES,
] as const;

type BlockingRouteStatus = (typeof BLOCKING_ROUTE_STATUSES)[number];
type SlotMonitorEventSource = (typeof REDISTRIBUTION_HTTP_EVENT_SOURCES)[number];

export type SlotMonitorCandidate = {
  id: string;
  runId: string;
  nmId: number;
  vendorCode: string | null;
  sizeName: string;
  fromWarehouse: string;
  fromOfficeId: number | null;
  toWarehouse: string;
  toOfficeId: number | null;
  transferUnits: number;
  routeStatus: BlockingRouteStatus | null;
  reason: string | null;
  lastCheckedAt: Date | null;
};

function resolveMaxRoutesPerTenant(value: number | undefined) {
  if (!Number.isFinite(value) || (value ?? 0) <= 0) {
    return SLOT_MONITOR_MAX_ROUTES_PER_TENANT;
  }
  return Math.min(Math.max(1, Math.round(value as number)), 50);
}

function resolveMatrixMaxNmPerTenant(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) {
    return SLOT_MONITOR_MATRIX_MAX_NM_PER_TENANT;
  }
  return Math.min(Math.max(0, Math.round(value as number)), 25);
}

function resolveMatrixMaxRoutesPerTenant(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) {
    return SLOT_MONITOR_MATRIX_MAX_ROUTES_PER_TENANT;
  }
  return Math.min(Math.max(0, Math.round(value as number)), 1500);
}

function toUtcDayStart(value: Date) {
  const day = new Date(value);
  day.setUTCHours(0, 0, 0, 0);
  return day;
}

function addUtcDays(value: Date, days: number) {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function parseIsoDay(value: string | null | undefined, fallback: Date) {
  if (!value) {
    return fallback;
  }
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function toNumericString(value: number | null | undefined, fractionDigits = 2) {
  if (!Number.isFinite(value ?? NaN)) {
    return "0.00";
  }
  return (value as number).toFixed(fractionDigits);
}

function toTransferApplicationComment(item: RedistributionTransferRecommendation) {
  return `Переместить ${item.transferUnits} шт размера ${item.sizeName} с ${item.fromWarehouse} (${item.fromRegionName}) на ${item.toWarehouse} (${item.toRegionName})`;
}

function toCandidateKey(input: {
  nmId: number;
  sizeName: string;
  fromWarehouse: string;
  toWarehouse: string;
}) {
  return [
    input.nmId,
    input.sizeName.trim().toLowerCase(),
    input.fromWarehouse.trim().toLowerCase(),
    input.toWarehouse.trim().toLowerCase(),
  ].join("::");
}

function isCandidateWarehouseAllowed(input: { fromWarehouse: string; toWarehouse: string }) {
  return isOfficialRedistributionWarehouse(input.fromWarehouse)
    && isOfficialRedistributionWarehouse(input.toWarehouse);
}

function selectLivePlanRecommendations(plan: RedistributionPlan, limit: number) {
  const selected: RedistributionTransferRecommendation[] = [];
  const candidateKeys = new Set<string>();
  const materializeLimit = Math.min(Math.max(limit * 4, limit, 20), 120);

  for (const recommendation of [...plan.recommendations].sort((a, b) => b.priorityScore - a.priorityScore)) {
    if (selected.length >= materializeLimit || !isCandidateWarehouseAllowed(recommendation)) {
      continue;
    }

    const candidateKey = toCandidateKey(recommendation);
    if (candidateKeys.has(candidateKey)) {
      continue;
    }

    candidateKeys.add(candidateKey);
    selected.push(recommendation);
  }

  return selected;
}

async function materializeLivePlanCandidates(tenantId: string, limit: number) {
  if (!SLOT_MONITOR_LIVE_PLAN_ENABLED) {
    return { inserted: 0, considered: 0 };
  }

  const today = toUtcDayStart(new Date());
  const from = addUtcDays(today, -SLOT_MONITOR_LIVE_PLAN_WINDOW_DAYS);
  const to = today;
  const plan = await getRedistributionPlan(tenantId, from, to);
  const recommendations = selectLivePlanRecommendations(plan, limit);
  if (!recommendations.length) {
    return { inserted: 0, considered: 0 };
  }

  const requestedFrom = parseIsoDay(plan.dataWindow.requestedFrom, from);
  const requestedTo = parseIsoDay(plan.dataWindow.requestedTo, to);
  const submittedCutoff = new Date(
    Date.now() - SLOT_MONITOR_LIVE_PLAN_DUPLICATE_HOURS * 60 * 60 * 1_000,
  );

  return withTenantContext(db, tenantId, async (tx) => {
    const existingRows = await tx.select({
      nmId: redistributionItems.nmId,
      sizeName: redistributionItems.sizeName,
      fromWarehouse: redistributionItems.fromWarehouse,
      toWarehouse: redistributionItems.toWarehouse,
    })
      .from(redistributionItems)
      .where(and(
        eq(redistributionItems.tenantId, tenantId),
        or(
          inArray(redistributionItems.status, [...LIVE_PLAN_DEDUP_ITEM_STATUSES]),
          and(
            eq(redistributionItems.status, "rpa_submitted"),
            gte(redistributionItems.executedAt, submittedCutoff),
          ),
        ),
      ));

    const existingKeys = new Set(existingRows.map(toCandidateKey));
    const missingRecommendations = recommendations.filter((recommendation) => {
      const candidateKey = toCandidateKey(recommendation);
      if (existingKeys.has(candidateKey)) {
        return false;
      }
      existingKeys.add(candidateKey);
      return true;
    });

    if (!missingRecommendations.length) {
      return { inserted: 0, considered: recommendations.length };
    }

    const [existingRun] = await tx.select({ id: redistributionRuns.id })
      .from(redistributionRuns)
      .where(and(
        eq(redistributionRuns.tenantId, tenantId),
        eq(redistributionRuns.triggerSource, SLOT_MONITOR_LIVE_PLAN_TRIGGER_SOURCE),
        eq(redistributionRuns.requestedFrom, requestedFrom),
        eq(redistributionRuns.requestedTo, requestedTo),
      ))
      .orderBy(desc(redistributionRuns.createdAt))
      .limit(1);

    const runId = existingRun?.id ?? (await tx.insert(redistributionRuns).values({
      tenantId,
      triggerSource: SLOT_MONITOR_LIVE_PLAN_TRIGGER_SOURCE,
      status: "planned",
      requestedFrom,
      requestedTo,
      snapshotDate: parseIsoDay(plan.dataWindow.snapshotDate, to),
      snapshotPeriodFrom: parseIsoDay(plan.dataWindow.snapshotPeriodFrom, from),
      snapshotPeriodTo: parseIsoDay(plan.dataWindow.snapshotPeriodTo, to),
      requestedDateWindowDays: plan.dataWindow.requestedDateWindowDays,
      effectiveDateWindowDays: plan.dataWindow.effectiveDateWindowDays,
      windowAligned: plan.dataWindow.windowAligned,
      methodology: plan.assumptions.methodology,
      recommendationCount: plan.summary.recommendationCount,
      skuCount: plan.summary.skuCount,
      transferUnits: plan.summary.transferUnits,
      estimatedSavingsRub: toNumericString(plan.summary.estimatedSavingsRub),
      currentKrpPct: toNumericString(plan.summary.currentKrpPct),
      simulatedKrpPct: toNumericString(plan.summary.simulatedKrpPct),
      currentLocalSharePct: toNumericString(plan.summary.currentLocalSharePct),
      simulatedLocalSharePct: toNumericString(plan.summary.simulatedLocalSharePct),
      assumptions: plan.assumptions,
      notes: plan.assumptions.notes,
      updatedAt: new Date(),
    }).returning({ id: redistributionRuns.id }))[0]?.id;

    if (!runId) {
      return { inserted: 0, considered: recommendations.length };
    }

    await tx.insert(redistributionItems).values(missingRecommendations.map((item) => ({
      runId,
      tenantId,
      status: "planned",
      nmId: item.nmId,
      vendorCode: item.vendorCode,
      brand: item.brand,
      sizeName: item.sizeName,
      chrtId: item.chrtId,
      fromRegionName: item.fromRegionName,
      fromWarehouse: item.fromWarehouse,
      fromOfficeId: item.fromOfficeId,
      toRegionName: item.toRegionName,
      toWarehouse: item.toWarehouse,
      toOfficeId: item.toOfficeId,
      transferUnits: item.transferUnits,
      priorityScore: toNumericString(item.priorityScore),
      estimatedSavingsRub: toNumericString(item.estimatedSavingsRub),
      currentLocalSharePct: toNumericString(item.currentLocalSharePct),
      simulatedLocalSharePct: toNumericString(item.simulatedLocalSharePct),
      currentKrpPct: toNumericString(item.currentKrpPct),
      simulatedKrpPct: toNumericString(item.simulatedKrpPct),
      fromCoverageDaysBefore: item.fromCoverageDaysBefore === null
        ? null
        : toNumericString(item.fromCoverageDaysBefore),
      toCoverageDaysBefore: item.toCoverageDaysBefore === null
        ? null
        : toNumericString(item.toCoverageDaysBefore),
      applicationComment: toTransferApplicationComment(item),
      updatedAt: new Date(),
    })));

    await tx.update(redistributionRuns)
      .set({
        status: "planned",
        recommendationCount: plan.summary.recommendationCount,
        skuCount: plan.summary.skuCount,
        transferUnits: plan.summary.transferUnits,
        estimatedSavingsRub: toNumericString(plan.summary.estimatedSavingsRub),
        currentKrpPct: toNumericString(plan.summary.currentKrpPct),
        simulatedKrpPct: toNumericString(plan.summary.simulatedKrpPct),
        currentLocalSharePct: toNumericString(plan.summary.currentLocalSharePct),
        simulatedLocalSharePct: toNumericString(plan.summary.simulatedLocalSharePct),
        assumptions: plan.assumptions,
        notes: plan.assumptions.notes,
        updatedAt: new Date(),
      })
      .where(and(
        eq(redistributionRuns.tenantId, tenantId),
        eq(redistributionRuns.id, runId),
      ));

    return { inserted: missingRecommendations.length, considered: recommendations.length };
  });
}

async function loadSlotMonitorCandidates(
  tenantId: string,
  limit: number,
): Promise<SlotMonitorCandidate[]> {
  const now = new Date();
  const nowIso = now.toISOString();

  return withTenantContext(db, tenantId, async (tx) => {
    const itemRows = await tx.select({
      id: redistributionItems.id,
      runId: redistributionItems.runId,
      nmId: redistributionItems.nmId,
      vendorCode: redistributionItems.vendorCode,
      sizeName: redistributionItems.sizeName,
      transferUnits: redistributionItems.transferUnits,
      fromWarehouse: redistributionItems.fromWarehouse,
      fromOfficeId: redistributionItems.fromOfficeId,
      toWarehouse: redistributionItems.toWarehouse,
      toOfficeId: redistributionItems.toOfficeId,
    })
      .from(redistributionItems)
      .where(and(
        eq(redistributionItems.tenantId, tenantId),
        inArray(redistributionItems.status, [...MONITORED_ITEM_STATUSES]),
      ))
      .orderBy(desc(sql<number>`${redistributionItems.priorityScore}`), desc(redistributionItems.updatedAt))
      .limit(Math.max(limit * 4, limit));

    const candidates: SlotMonitorCandidate[] = [];
    const candidateIds = new Set(candidates.map((candidate) => candidate.id));
    const candidateKeys = new Set<string>();
    for (const item of itemRows) {
      if (candidates.length >= limit || !isCandidateWarehouseAllowed(item)) {
        continue;
      }
      const candidateKey = toCandidateKey(item);
      if (candidateKeys.has(candidateKey)) {
        continue;
      }
      candidateKeys.add(candidateKey);
      candidateIds.add(item.id);
      candidates.push({
        id: item.id,
        runId: item.runId,
        nmId: item.nmId,
        vendorCode: item.vendorCode,
        sizeName: item.sizeName,
        transferUnits: Math.max(1, item.transferUnits),
        fromWarehouse: item.fromWarehouse,
        fromOfficeId: item.fromOfficeId,
        toWarehouse: item.toWarehouse,
        toOfficeId: item.toOfficeId,
        routeStatus: null,
        reason: null,
        lastCheckedAt: null,
      });
    }

    if (candidates.length >= limit) {
      return candidates;
    }

    const blockedRoutes = await tx.select({
      fromWarehouse: redistributionRouteAvailability.fromWarehouse,
      toWarehouse: redistributionRouteAvailability.toWarehouse,
      status: redistributionRouteAvailability.status,
      reason: redistributionRouteAvailability.reason,
      lastCheckedAt: redistributionRouteAvailability.lastCheckedAt,
    })
      .from(redistributionRouteAvailability)
      .where(and(
        eq(redistributionRouteAvailability.tenantId, tenantId),
        inArray(redistributionRouteAvailability.status, [...BLOCKING_ROUTE_STATUSES]),
        sql`(${redistributionRouteAvailability.expiresAt} IS NULL OR ${redistributionRouteAvailability.expiresAt} > ${nowIso})`,
      ))
      .orderBy(desc(redistributionRouteAvailability.lastCheckedAt))
      .limit(Math.max(limit * 2, limit));

    for (const route of blockedRoutes) {
      if (candidates.length >= limit) {
        break;
      }

      const [item] = await tx.select({
        nmId: redistributionItems.nmId,
        id: redistributionItems.id,
        runId: redistributionItems.runId,
        vendorCode: redistributionItems.vendorCode,
        sizeName: redistributionItems.sizeName,
        transferUnits: redistributionItems.transferUnits,
        fromWarehouse: redistributionItems.fromWarehouse,
        fromOfficeId: redistributionItems.fromOfficeId,
        toWarehouse: redistributionItems.toWarehouse,
        toOfficeId: redistributionItems.toOfficeId,
      })
        .from(redistributionItems)
        .where(and(
          eq(redistributionItems.tenantId, tenantId),
          eq(redistributionItems.fromWarehouse, route.fromWarehouse),
          eq(redistributionItems.toWarehouse, route.toWarehouse),
          inArray(redistributionItems.status, [...MONITORED_ITEM_STATUSES]),
        ))
        .orderBy(desc(redistributionItems.updatedAt))
        .limit(1);

      if (!item || candidateIds.has(item.id) || !isCandidateWarehouseAllowed(item)) {
        continue;
      }
      const candidateKey = toCandidateKey(item);
      if (candidateKeys.has(candidateKey)) {
        continue;
      }
      candidateKeys.add(candidateKey);
      candidateIds.add(item.id);

      candidates.push({
        id: item.id,
        runId: item.runId,
        nmId: item.nmId,
        vendorCode: item.vendorCode,
        sizeName: item.sizeName,
        transferUnits: Math.max(1, item.transferUnits),
        fromWarehouse: item.fromWarehouse,
        fromOfficeId: item.fromOfficeId,
        toWarehouse: item.toWarehouse,
        toOfficeId: item.toOfficeId,
        routeStatus: route.status as BlockingRouteStatus,
        reason: route.reason,
        lastCheckedAt: route.lastCheckedAt,
      });
    }

    return candidates;
  });
}

async function loadSlotMatrixNmSamples(
  tenantId: string,
  candidates: SlotMonitorCandidate[],
  limit: number,
) {
  const selected: number[] = [];
  const seen = new Set<number>();
  const addNmId = (value: number | null | undefined) => {
    const nmId = Number(value ?? NaN);
    if (!Number.isFinite(nmId) || nmId <= 0 || seen.has(nmId) || selected.length >= limit) {
      return;
    }
    seen.add(nmId);
    selected.push(Math.floor(nmId));
  };

  for (const candidate of candidates) {
    addNmId(candidate.nmId);
  }
  if (selected.length >= limit) {
    return selected;
  }

  const latestRows = await withTenantContext(db, tenantId, (tx) =>
    tx.select({
      snapshotDate: sql<Date | null>`MAX(${rawApiStockSizes.snapshotDate})`,
    })
      .from(rawApiStockSizes)
      .where(and(
        eq(rawApiStockSizes.tenantId, tenantId),
        eq(rawApiStockSizes.stockType, "wb"),
      ))
      .limit(1),
  );
  const latestSnapshotDateRaw = latestRows[0]?.snapshotDate ?? null;
  const latestSnapshotDate = latestSnapshotDateRaw ? new Date(latestSnapshotDateRaw) : null;
  if (!latestSnapshotDate || Number.isNaN(latestSnapshotDate.getTime())) {
    return selected;
  }

  const stockRows = await withTenantContext(db, tenantId, (tx) =>
    tx.select({
      nmId: rawApiStockSizes.nmId,
      stockUnits: sql<number>`sum(${rawApiStockSizes.stockCount})::int`,
    })
      .from(rawApiStockSizes)
      .where(and(
        eq(rawApiStockSizes.tenantId, tenantId),
        eq(rawApiStockSizes.stockType, "wb"),
        eq(rawApiStockSizes.snapshotDate, latestSnapshotDate),
        sql`${rawApiStockSizes.stockCount} > 0`,
      ))
      .groupBy(rawApiStockSizes.nmId)
      .orderBy(desc(sql`sum(${rawApiStockSizes.stockCount})`))
      .limit(Math.max(limit * 3, limit)),
  );

  for (const row of stockRows) {
    addNmId(row.nmId);
  }

  return selected;
}

async function hasRecentWbRateLimit(
  tenantId: string,
  now: Date,
  sources: readonly SlotMonitorEventSource[],
  backoffMin: number,
) {
  if (backoffMin <= 0 || sources.length === 0) {
    return false;
  }

  const cutoff = new Date(now.getTime() - backoffMin * 60 * 1_000);
  const cutoffIso = cutoff.toISOString();
  const [row] = await withTenantContext(db, tenantId, (tx) =>
    tx.select({
      count: sql<number>`count(*)::int`,
    })
      .from(redistributionRouteAvailabilityEvents)
      .where(and(
        eq(redistributionRouteAvailabilityEvents.tenantId, tenantId),
        inArray(redistributionRouteAvailabilityEvents.source, [...sources]),
        sql`${redistributionRouteAvailabilityEvents.observedAt} > ${cutoffIso}`,
        sql`${redistributionRouteAvailabilityEvents.reason} ilike '%429%'`,
      ))
      .limit(1),
  );

  return Number(row?.count ?? 0) > 0;
}

async function hasRecentRedistributionAccessBlock(tenantId: string, now: Date) {
  if (SLOT_MONITOR_FORBIDDEN_BACKOFF_HOURS <= 0) {
    return false;
  }

  const cutoff = new Date(now.getTime() - SLOT_MONITOR_FORBIDDEN_BACKOFF_HOURS * 60 * 60 * 1_000);
  const cutoffIso = cutoff.toISOString();
  const [row] = await withTenantContext(db, tenantId, (tx) =>
    tx.select({
      count: sql<number>`count(*)::int`,
    })
      .from(redistributionRouteAvailabilityEvents)
      .where(and(
        eq(redistributionRouteAvailabilityEvents.tenantId, tenantId),
        inArray(redistributionRouteAvailabilityEvents.source, [...REDISTRIBUTION_HTTP_EVENT_SOURCES]),
        sql`${redistributionRouteAvailabilityEvents.observedAt} > ${cutoffIso}`,
        sql`(
          ${redistributionRouteAvailabilityEvents.reason} ilike '%401%'
          OR ${redistributionRouteAvailabilityEvents.reason} ilike '%403%'
        )`,
      ))
      .limit(1),
  );

  return Number(row?.count ?? 0) > 0;
}

async function updateMonitorItemStatuses(tenantId: string, result: RedistributionHttpSlotProbeResult) {
  const finishedAt = new Date();
  await withTenantContext(db, tenantId, async (tx) => {
    const affectedRunIds = new Set<string>();
    for (const item of result.items) {
      if (item.runId) {
        affectedRunIds.add(item.runId);
      }
      if (!item.itemId) {
        continue;
      }

      if (item.submitted) {
        await tx.update(redistributionItems)
          .set({
            status: "rpa_submitted",
            executionNote: `${item.submitReason ?? "http_order_submitted"}: ${item.submittedUnits} шт; srcQuota=${item.srcQuota ?? "-"}; dstQuota=${item.dstQuota ?? "-"}`,
            executedAt: finishedAt,
            updatedAt: finishedAt,
          })
          .where(and(
            eq(redistributionItems.tenantId, tenantId),
            eq(redistributionItems.id, item.itemId),
          ));
        continue;
      }

      if (["limit_exhausted", "route_unavailable", "transient_error"].includes(item.status)) {
        await tx.update(redistributionItems)
          .set({
            status: "rpa_failed",
            executionNote: `${item.contour ?? "http"}_slot_monitor_${item.status}: ${item.reason}; srcQuota=${item.srcQuota ?? "-"}; dstQuota=${item.dstQuota ?? "-"}`,
            updatedAt: finishedAt,
          })
          .where(and(
            eq(redistributionItems.tenantId, tenantId),
            eq(redistributionItems.id, item.itemId),
          ));
      }
    }

    for (const runId of affectedRunIds) {
      const [remaining] = await tx.select({
        value: sql<number>`count(*)::int`,
      })
        .from(redistributionItems)
        .where(and(
          eq(redistributionItems.tenantId, tenantId),
          eq(redistributionItems.runId, runId),
          inArray(redistributionItems.status, [...MONITORED_ITEM_STATUSES]),
        ));

      if (Number(remaining?.value ?? 0) === 0) {
        await tx.update(redistributionRuns)
          .set({
            status: "rpa_completed",
            rpaFinishedAt: finishedAt,
            errorMessage: null,
            updatedAt: finishedAt,
          })
          .where(and(
            eq(redistributionRuns.tenantId, tenantId),
            eq(redistributionRuns.id, runId),
          ));
      }
    }
  });
}

export async function runSlotMonitorForTenant(
  tenantId: string,
  options?: {
    maxRoutesPerTenant?: number;
    matrixMaxNmPerTenant?: number;
    matrixMaxRoutesPerTenant?: number;
    autoSubmit?: boolean;
    source?: string;
    triggerSource?: string;
    monitorMode?: string;
  },
) {
  const startedAt = new Date();
  const autoSubmit = options?.autoSubmit ?? SLOT_MONITOR_AUTO_SUBMIT;
  const maxRoutesPerTenant = resolveMaxRoutesPerTenant(options?.maxRoutesPerTenant);
  const matrixMaxNmPerTenant = resolveMatrixMaxNmPerTenant(options?.matrixMaxNmPerTenant);
  const matrixMaxRoutesPerTenant = resolveMatrixMaxRoutesPerTenant(options?.matrixMaxRoutesPerTenant);
  const monitorSource = options?.source ?? (autoSubmit ? "stock_control_auto_submit" : "stock_control_slot_probe");
  const triggerSource = options?.triggerSource ?? "scheduler";
  const monitorMode = options?.monitorMode ?? "unknown";

  const recordRun = async (input: {
    status: "completed" | "skipped" | "failed";
    skipped: boolean;
    message: string;
    probedItems: number;
    openedSlots: number;
  }) => {
    await withTenantContext(db, tenantId, (tx) =>
      tx.insert(redistributionSlotMonitorRuns).values({
        tenantId,
        triggerSource,
        mode: monitorMode,
        status: input.status,
        skipped: input.skipped,
        message: input.message.slice(0, 2000),
        autoSubmit,
        maxRoutesPerTenant,
        probedItems: input.probedItems,
        openedSlots: input.openedSlots,
        startedAt,
        finishedAt: new Date(),
        updatedAt: new Date(),
      }),
    );
  };

  try {
    const [tenant] = await db.select({
      wbLkStorageState: tenants.wbLkStorageState,
      wbLkStorageStateRefreshedAt: tenants.wbLkStorageStateRefreshedAt,
    })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    const hasSession = Boolean(tenant?.wbLkStorageState);
    if (!hasSession) {
      await recordRun({
        status: "skipped",
        skipped: true,
        message: "wb_lk_http_storage_state_missing",
        probedItems: 0,
        openedSlots: 0,
      });
      return {
        tenantId,
        skipped: true,
        message: "wb_lk_http_storage_state_missing",
        probedItems: 0,
        openedSlots: 0,
        autoSubmit,
        candidates: [] as SlotMonitorCandidate[],
        matrix: null,
      };
    }

    if (await hasRecentRedistributionAccessBlock(tenantId, startedAt)) {
      const message = `wb_redistribution_feature_disabled_or_forbidden_${SLOT_MONITOR_FORBIDDEN_BACKOFF_HOURS}h: WB перераспределение отключено или недоступно для кабинета (HTTP 401/403). Монитор слотов остановлен.`;
      await recordRun({
        status: "skipped",
        skipped: true,
        message,
        probedItems: 0,
        openedSlots: 0,
      });
      return {
        tenantId,
        skipped: true,
        message,
        probedItems: 0,
        openedSlots: 0,
        autoSubmit,
        candidates: [] as SlotMonitorCandidate[],
        matrix: null,
      };
    }

    const targetRateLimited = triggerSource === "scheduler"
      && await hasRecentWbRateLimit(
        tenantId,
        startedAt,
        TARGET_SLOT_MONITOR_EVENT_SOURCES,
        SLOT_MONITOR_TARGET_HTTP_429_BACKOFF_MIN,
      );
    const matrixRequested = SLOT_MONITOR_MATRIX_ENABLED
      && matrixMaxNmPerTenant > 0
      && matrixMaxRoutesPerTenant > 0;
    const matrixRateLimited = triggerSource === "scheduler"
      && matrixRequested
      && await hasRecentWbRateLimit(
        tenantId,
        startedAt,
        MATRIX_SLOT_MONITOR_EVENT_SOURCES,
        SLOT_MONITOR_MATRIX_HTTP_429_BACKOFF_MIN,
      );
    const matrixCanRun = matrixRequested && !matrixRateLimited;

    if (!targetRateLimited) {
      await materializeLivePlanCandidates(tenantId, maxRoutesPerTenant);
    }

    const candidates = targetRateLimited
      ? []
      : await loadSlotMonitorCandidates(tenantId, maxRoutesPerTenant);
    const matrixNmIds = matrixCanRun
      ? await loadSlotMatrixNmSamples(tenantId, candidates, matrixMaxNmPerTenant)
      : [];
    if (!candidates.length && !matrixNmIds.length) {
      const backoffMessages = [
        targetRateLimited ? `wb_lk_http_target_429_backoff_${SLOT_MONITOR_TARGET_HTTP_429_BACKOFF_MIN}m` : null,
        matrixRateLimited ? `wb_lk_http_matrix_429_backoff_${SLOT_MONITOR_MATRIX_HTTP_429_BACKOFF_MIN}m` : null,
      ].filter((message): message is string => Boolean(message));
      const message = backoffMessages.length > 0
        ? backoffMessages.join("; ")
        : "no_blocked_routes_to_probe";
      await recordRun({
        status: "skipped",
        skipped: true,
        message,
        probedItems: 0,
        openedSlots: 0,
      });
      return {
        tenantId,
        skipped: true,
        message,
        probedItems: 0,
        openedSlots: 0,
        autoSubmit,
        candidates,
        matrix: null,
      };
    }

    const probeResult = await probeRedistributionSlotsHttp({
      tenantId,
      recommendations: candidates.map((candidate) => ({
        id: candidate.id,
        runId: candidate.runId,
        nmId: candidate.nmId,
        vendorCode: candidate.vendorCode,
        sizeName: candidate.sizeName,
        transferUnits: candidate.transferUnits,
        fromWarehouse: candidate.fromWarehouse,
        fromOfficeId: candidate.fromOfficeId,
        toWarehouse: candidate.toWarehouse,
        toOfficeId: candidate.toOfficeId,
      })),
      limit: maxRoutesPerTenant,
      persistAvailability: true,
      submitAvailable: autoSubmit && !targetRateLimited,
      monitorAllWarehouses: matrixCanRun,
      monitorAllDirections: matrixCanRun && matrixNmIds.length > 0,
      matrixNmIds,
      matrixRouteLimit: matrixMaxRoutesPerTenant,
      availabilitySource: monitorSource,
      quotaSource: "stock_control_quota_monitor",
      matrixSource: "stock_control_slot_matrix_monitor",
    });
    await updateMonitorItemStatuses(tenantId, probeResult);
    const resultMessage = targetRateLimited
      ? `${probeResult.message} Целевые заявки: wb_lk_http_target_429_backoff_${SLOT_MONITOR_TARGET_HTTP_429_BACKOFF_MIN}m.`
      : probeResult.message;

    await recordRun({
      status: "completed",
      skipped: false,
      message: resultMessage,
      probedItems: probeResult.probedItems,
      openedSlots: probeResult.openedSlots,
    });

    return {
      tenantId,
      skipped: false,
      message: resultMessage,
      probedItems: probeResult.probedItems,
      openedSlots: probeResult.openedSlots,
      autoSubmit,
      candidates,
      matrix: probeResult.matrix,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "slot_monitor_failed";
    await recordRun({
      status: "failed",
      skipped: false,
      message,
      probedItems: 0,
      openedSlots: 0,
    });
    throw error;
  }
}

export async function runSlotMonitorForAllTenants(options?: {
  maxRoutesPerTenant?: number;
  matrixMaxNmPerTenant?: number;
  matrixMaxRoutesPerTenant?: number;
  autoSubmit?: boolean;
  source?: string;
  triggerSource?: string;
  monitorMode?: string;
}) {
  const autoSubmit = options?.autoSubmit ?? SLOT_MONITOR_AUTO_SUBMIT;

  const tenantRows = await db.select({
    id: tenants.id,
  })
    .from(tenants);

  let okTenants = 0;
  let failedTenants = 0;
  let totalProbedItems = 0;
  let totalOpenedSlots = 0;

  const items: Array<{
    tenantId: string;
    ok: boolean;
    skipped: boolean;
    message: string;
    probedItems: number;
    openedSlots: number;
    autoSubmit: boolean;
    matrix: RedistributionHttpSlotProbeResult["matrix"] | null;
  }> = [];

  for (const tenant of tenantRows) {
    try {
      const result = await runSlotMonitorForTenant(tenant.id, options);
      okTenants += 1;
      totalProbedItems += result.probedItems;
      totalOpenedSlots += result.openedSlots;

      items.push({
        tenantId: tenant.id,
        ok: true,
        skipped: result.skipped,
        message: result.message,
        probedItems: result.probedItems,
        openedSlots: result.openedSlots,
        autoSubmit: result.autoSubmit,
        matrix: result.matrix ?? null,
      });
    } catch (error) {
      failedTenants += 1;
      items.push({
        tenantId: tenant.id,
        ok: false,
        skipped: false,
        message: error instanceof Error ? error.message : "slot_monitor_failed",
        probedItems: 0,
        openedSlots: 0,
        autoSubmit,
        matrix: null,
      });
    }
  }

  return {
    scannedTenants: tenantRows.length,
    okTenants,
    failedTenants,
    totalProbedItems,
    totalOpenedSlots,
    items,
  };
}
