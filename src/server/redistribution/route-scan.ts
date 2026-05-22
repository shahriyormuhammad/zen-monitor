import {
  and,
  desc,
  eq,
  gt,
  inArray,
  notInArray,
  sql,
} from "drizzle-orm";

import { db, withTenantContext, type DrizzleTransaction } from "@/lib/db";
import {
  rawApiStockSizes,
  rawApiStocks,
  redistributionRouteAvailability,
  redistributionRouteAvailabilityEvents,
  redistributionSlotMonitorRuns,
  redistributionWarehouseRegistry,
  tenants,
} from "@/lib/db/schema";
import type {
  RedistributionPlan,
  RedistributionTransferRecommendation,
} from "@/server/analytics/redistribution";

const ROUTE_LIMIT_TTL_HOURS = (() => {
  const parsed = Number.parseInt(process.env.REDISTRIBUTION_ROUTE_LIMIT_TTL_HOURS ?? "20", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 20;
  }
  return Math.min(parsed, 72);
})();

const ROUTE_UNAVAILABLE_TTL_DAYS = (() => {
  const parsed = Number.parseInt(process.env.REDISTRIBUTION_ROUTE_UNAVAILABLE_TTL_DAYS ?? "14", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 14;
  }
  return Math.min(parsed, 90);
})();

const ROUTE_AVAILABLE_TTL_DAYS = (() => {
  const parsed = Number.parseInt(process.env.REDISTRIBUTION_ROUTE_AVAILABLE_TTL_DAYS ?? "21", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 21;
  }
  return Math.min(parsed, 120);
})();

const WAREHOUSE_SCAN_LOOKBACK_DAYS = (() => {
  const parsed = Number.parseInt(process.env.REDISTRIBUTION_ROUTE_WAREHOUSE_LOOKBACK_DAYS ?? "60", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 60;
  }
  return Math.min(parsed, 180);
})();

const SLOT_MONITOR_RECENT_HOURS = (() => {
  const parsed = Number.parseInt(process.env.REDISTRIBUTION_SLOT_MONITOR_RECENT_HOURS ?? "24", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 24;
  }
  return Math.min(parsed, 168);
})();

const BLOCKING_ROUTE_STATUSES = ["limit_exhausted", "route_unavailable"] as const;
const SLOT_MONITOR_EVENT_SOURCES = [
  "slot_monitor_probe",
  "slot_monitor_auto_submit",
  "http_slot_monitor_probe",
  "http_slot_monitor_auto_submit",
  "http_quota_monitor",
  "http_slot_matrix_monitor",
] as const;
const OFFICIAL_REDISTRIBUTION_WAREHOUSE_NAMES = [
  "Электросталь",
  "Электросталь Питание",
  "Тула",
  "Коледино",
  "Шушары",
  "СПБ Шушары",
  "Санкт-Петербург Уткина Заводь",
  "Шушары Питание",
  "Казань",
  "Казань Питание",
  "Краснодар",
  "Краснодар Тихорецкая",
  "Краснодар Тихорецкая Питание",
  "Невинномысск",
  "Екатеринбург Испытателей 14г",
  "Новосибирск",
  "Белые Столбы",
  "Рязань Тюшевское",
  "Рязань Тюшевское Питание",
  "Котовск",
  "Котовск Питание",
  "Волгоград",
  "Волгоград Питание",
  "Владимир",
  "Владимир Воршинское",
  "Новосемейкино",
  "Самара Новосемейкино",
  "Новосемейкино Питание",
  "Екатеринбург Перспективная",
  "Екатеринбург Перспективная Питание",
  "Сарапул",
  "Пенза",
];

type BlockingRouteStatus = (typeof BLOCKING_ROUTE_STATUSES)[number];
type RouteStatus = "unknown" | "available" | "limit_exhausted" | "route_unavailable" | "transient_error";

type RouteStatusCountMap = {
  available: number;
  limit_exhausted: number;
  route_unavailable: number;
  transient_error: number;
  unknown: number;
};

export type RouteScanOverview = {
  generatedAt: string;
  warehouses: {
    totalKnown: number;
    active: number;
    removed: number;
    lastSeenAt: string | null;
    lastScanSource: "stock_snapshot" | "manual" | "unknown";
  };
  routes: {
    totalKnown: number;
    available: number;
    blockedLimit: number;
    blockedUnavailable: number;
    transient: number;
    unknown: number;
    lastCheckedAt: string | null;
  };
  blockedRoutes: Array<{
    fromWarehouse: string;
    toWarehouse: string;
    status: BlockingRouteStatus;
    reason: string | null;
    lastCheckedAt: string | null;
    expiresAt: string | null;
    successCount: number;
    failCount: number;
  }>;
  recentlyOpenedRoutes: Array<{
    fromWarehouse: string;
    toWarehouse: string;
    source: string;
    reason: string | null;
    openedAt: string | null;
    successCount: number;
    failCount: number;
  }>;
  recentlyRemovedWarehouses: Array<{
    warehouseName: string;
    removedAt: string | null;
    lastSeenAt: string | null;
  }>;
  monitoring: {
    timezone: "Europe/Moscow";
    windowHours: number;
    hourly: Array<{
      hourStartMsk: string;
      probes: number;
      opened: number;
      openRatePct: number;
      blockedLimit: number;
      blockedUnavailable: number;
      transient: number;
    }>;
    recentRuns: Array<{
      startedAt: string | null;
      finishedAt: string | null;
      triggerSource: string;
      mode: string;
      status: string;
      skipped: boolean;
      message: string | null;
      autoSubmit: boolean;
      maxRoutesPerTenant: number | null;
      probedItems: number;
      openedSlots: number;
    }>;
  };
};

type RouteFilterBlock = {
  status: BlockingRouteStatus;
  reason: string | null;
  expiresAt: Date | null;
};

export type RouteFilterExcludedItem = {
  recommendation: RedistributionTransferRecommendation;
  status: BlockingRouteStatus;
  reason: string | null;
  expiresAt: string | null;
};

export type RouteFilterResult = {
  plan: RedistributionPlan;
  excludedItems: RouteFilterExcludedItem[];
  excludedByStatus: Record<BlockingRouteStatus, number>;
};

function toIsoOrNull(value: Date | string | number | null) {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function withHours(value: Date, hours: number) {
  return new Date(value.getTime() + hours * 60 * 60 * 1_000);
}

function withDays(value: Date, days: number) {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1_000);
}

function normalizeWarehouseName(value: string) {
  return value
    .replace(/\s+/g, " ")
    .trim();
}

function toComparableWarehouseName(value: string) {
  return normalizeWarehouseName(value).toLowerCase();
}

function toOfficialWarehouseComparable(value: string) {
  return value
    .toLowerCase()
    .replace(/[«»"']/g, "")
    .replace(/\bwb\b/g, "")
    .replace(/[^a-zа-яё0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const OFFICIAL_REDISTRIBUTION_WAREHOUSE_KEYS = OFFICIAL_REDISTRIBUTION_WAREHOUSE_NAMES
  .map(toOfficialWarehouseComparable)
  .filter(Boolean);

export function isOfficialRedistributionWarehouse(warehouseName: string) {
  const comparable = toOfficialWarehouseComparable(warehouseName);
  if (!comparable) {
    return false;
  }
  return OFFICIAL_REDISTRIBUTION_WAREHOUSE_KEYS.some((officialWarehouse) =>
    comparable.includes(officialWarehouse) || officialWarehouse.includes(comparable),
  );
}

function toRouteKey(fromWarehouse: string, toWarehouse: string) {
  return `${toComparableWarehouseName(fromWarehouse)}::${toComparableWarehouseName(toWarehouse)}`;
}

function toSourceWarehouseKey(warehouseName: string) {
  return toComparableWarehouseName(warehouseName);
}

function toInt(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

function toFloat(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value: number, precision = 2) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function buildSummaryFromRecommendations(
  recommendations: RedistributionTransferRecommendation[],
  fallback: RedistributionPlan["summary"],
): RedistributionPlan["summary"] {
  if (!recommendations.length) {
    return {
      ...fallback,
      recommendationCount: 0,
      skuCount: 0,
      transferUnits: 0,
      estimatedSavingsRub: 0,
    };
  }

  const transferUnits = recommendations.reduce((acc, recommendation) => {
    return acc + toInt(recommendation.transferUnits);
  }, 0);

  const weightedAverage = (
    getter: (recommendation: RedistributionTransferRecommendation) => number,
    fallbackValue: number,
  ) => {
    if (transferUnits <= 0) {
      return fallbackValue;
    }
    const weighted = recommendations.reduce((acc, recommendation) => {
      return acc + getter(recommendation) * toInt(recommendation.transferUnits);
    }, 0);
    return round(weighted / transferUnits, 2);
  };

  const skuSet = new Set<string>();
  let estimatedSavingsRub = 0;
  for (const recommendation of recommendations) {
    skuSet.add(`${recommendation.nmId}:${recommendation.sizeName}`);
    estimatedSavingsRub += toFloat(recommendation.estimatedSavingsRub);
  }

  return {
    ...fallback,
    recommendationCount: recommendations.length,
    skuCount: skuSet.size,
    transferUnits,
    estimatedSavingsRub: round(estimatedSavingsRub, 2),
    currentKrpPct: weightedAverage((recommendation) => toFloat(recommendation.currentKrpPct), fallback.currentKrpPct),
    simulatedKrpPct: weightedAverage((recommendation) => toFloat(recommendation.simulatedKrpPct), fallback.simulatedKrpPct),
    currentLocalSharePct: weightedAverage(
      (recommendation) => toFloat(recommendation.currentLocalSharePct),
      fallback.currentLocalSharePct,
    ),
    simulatedLocalSharePct: weightedAverage(
      (recommendation) => toFloat(recommendation.simulatedLocalSharePct),
      fallback.simulatedLocalSharePct,
    ),
  };
}

async function loadBlockingRouteMap(tenantId: string, now = new Date()) {
  const nowIso = now.toISOString();
  const rows = await withTenantContext(db, tenantId, (tx) =>
    tx.select({
      fromWarehouse: redistributionRouteAvailability.fromWarehouse,
      toWarehouse: redistributionRouteAvailability.toWarehouse,
      status: redistributionRouteAvailability.status,
      reason: redistributionRouteAvailability.reason,
      expiresAt: redistributionRouteAvailability.expiresAt,
    })
      .from(redistributionRouteAvailability)
      .where(and(
        eq(redistributionRouteAvailability.tenantId, tenantId),
        inArray(redistributionRouteAvailability.status, [...BLOCKING_ROUTE_STATUSES]),
        sql`(${redistributionRouteAvailability.expiresAt} IS NULL OR ${redistributionRouteAvailability.expiresAt} > ${nowIso})`,
      )),
  );

  const routeMap = new Map<string, RouteFilterBlock>();
  for (const row of rows) {
    const status = row.status as BlockingRouteStatus;
    routeMap.set(toRouteKey(row.fromWarehouse, row.toWarehouse), {
      status,
      reason: row.reason,
      expiresAt: row.expiresAt,
    });
  }

  return routeMap;
}

async function loadUnavailableSourceWarehouseMap(tenantId: string, now = new Date()) {
  const nowIso = now.toISOString();
  const rows = await withTenantContext(db, tenantId, (tx) =>
    tx.select({
      fromWarehouse: redistributionRouteAvailability.fromWarehouse,
      reason: redistributionRouteAvailability.reason,
      expiresAt: redistributionRouteAvailability.expiresAt,
    })
      .from(redistributionRouteAvailability)
      .where(and(
        eq(redistributionRouteAvailability.tenantId, tenantId),
        eq(redistributionRouteAvailability.status, "route_unavailable"),
        sql`(${redistributionRouteAvailability.expiresAt} IS NULL OR ${redistributionRouteAvailability.expiresAt} > ${nowIso})`,
      )),
  );

  const sourceWarehouseMap = new Map<string, RouteFilterBlock>();
  for (const row of rows) {
    if (row.reason !== "source_warehouse_not_found") {
      continue;
    }

    sourceWarehouseMap.set(toSourceWarehouseKey(row.fromWarehouse), {
      status: "route_unavailable",
      reason: row.reason,
      expiresAt: row.expiresAt,
    });
  }

  return sourceWarehouseMap;
}

function buildRouteFilterNote(
  excludedByStatus: Record<BlockingRouteStatus, number>,
  excludedCount: number,
) {
  if (excludedCount <= 0) {
    return null;
  }

  const parts: string[] = [];
  if (excludedByStatus.limit_exhausted > 0) {
    parts.push(`лимит исчерпан: ${excludedByStatus.limit_exhausted}`);
  }
  if (excludedByStatus.route_unavailable > 0) {
    parts.push(`маршрут недоступен: ${excludedByStatus.route_unavailable}`);
  }

  return `Часть маршрутов исключена по данным скана WB (${excludedCount}): ${parts.join(", ")}.`;
}

export async function applyRouteAvailabilityFilterToPlan(
  tenantId: string,
  plan: RedistributionPlan,
): Promise<RouteFilterResult> {
  const [blockingRouteMap, unavailableSourceWarehouseMap] = await Promise.all([
    loadBlockingRouteMap(tenantId),
    loadUnavailableSourceWarehouseMap(tenantId),
  ]);

  const allowedRecommendations: RedistributionTransferRecommendation[] = [];
  const excludedItems: RouteFilterExcludedItem[] = [];
  const excludedByStatus: Record<BlockingRouteStatus, number> = {
    limit_exhausted: 0,
    route_unavailable: 0,
  };

  for (const recommendation of plan.recommendations) {
    const routeKey = toRouteKey(recommendation.fromWarehouse, recommendation.toWarehouse);
    const sourceWarehouseKey = toSourceWarehouseKey(recommendation.fromWarehouse);
    const officialWarehouseBlock: RouteFilterBlock | null = (
      isOfficialRedistributionWarehouse(recommendation.fromWarehouse)
      && isOfficialRedistributionWarehouse(recommendation.toWarehouse)
    )
      ? null
      : {
        status: "route_unavailable",
        reason: "warehouse_not_in_official_redistribution_list",
        expiresAt: null,
      };
    const block = officialWarehouseBlock
      ?? unavailableSourceWarehouseMap.get(sourceWarehouseKey)
      ?? blockingRouteMap.get(routeKey);
    if (!block) {
      allowedRecommendations.push(recommendation);
      continue;
    }

    excludedByStatus[block.status] += 1;
    excludedItems.push({
      recommendation,
      status: block.status,
      reason: block.reason,
      expiresAt: toIsoOrNull(block.expiresAt),
    });
  }

  if (!excludedItems.length) {
    return {
      plan,
      excludedItems: [],
      excludedByStatus,
    };
  }

  const note = buildRouteFilterNote(excludedByStatus, excludedItems.length);
  const assumptionsNotes = note
    ? [...plan.assumptions.notes, note]
    : plan.assumptions.notes;

  return {
    plan: {
      ...plan,
      assumptions: {
        ...plan.assumptions,
        notes: assumptionsNotes,
      },
      summary: buildSummaryFromRecommendations(allowedRecommendations, plan.summary),
      recommendations: allowedRecommendations,
    },
    excludedItems,
    excludedByStatus,
  };
}

export async function saveRouteAvailabilityResult(input: {
  tenantId: string;
  runId?: string | null;
  fromWarehouse: string;
  toWarehouse: string;
  status: RouteStatus;
  reason?: string | null;
  source?: string;
  metadata?: Record<string, unknown>;
}) {
  const fromWarehouse = normalizeWarehouseName(input.fromWarehouse);
  const toWarehouse = normalizeWarehouseName(input.toWarehouse);

  if (!fromWarehouse || !toWarehouse) {
    return;
  }

  const now = new Date();
  const status = input.status;
  let expiresAt: Date | null = null;

  if (status === "limit_exhausted") {
    expiresAt = withHours(now, ROUTE_LIMIT_TTL_HOURS);
  } else if (status === "route_unavailable") {
    expiresAt = withDays(now, ROUTE_UNAVAILABLE_TTL_DAYS);
  } else if (status === "available") {
    expiresAt = withDays(now, ROUTE_AVAILABLE_TTL_DAYS);
  }

  const successInc = status === "available" ? 1 : 0;
  const failInc = status === "available" ? 0 : 1;
  const source = input.source ?? "rpa_modal";
  const reason = input.reason?.slice(0, 2000) ?? null;

  await withTenantContext(db, input.tenantId, async (tx) => {
    await tx.insert(redistributionRouteAvailability).values({
      tenantId: input.tenantId,
      fromWarehouse,
      toWarehouse,
      status,
      reason,
      source,
      firstSeenAt: now,
      lastCheckedAt: now,
      expiresAt,
      lastRunId: input.runId ?? null,
      successCount: successInc,
      failCount: failInc,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [
        redistributionRouteAvailability.tenantId,
        redistributionRouteAvailability.fromWarehouse,
        redistributionRouteAvailability.toWarehouse,
      ],
      set: {
        status,
        reason,
        source,
        lastCheckedAt: now,
        expiresAt,
        lastRunId: input.runId ?? null,
        successCount: sql`${redistributionRouteAvailability.successCount} + ${successInc}`,
        failCount: sql`${redistributionRouteAvailability.failCount} + ${failInc}`,
        updatedAt: now,
      },
    });

    await tx.insert(redistributionRouteAvailabilityEvents).values({
      tenantId: input.tenantId,
      fromWarehouse,
      toWarehouse,
      status,
      reason,
      source,
      metadata: {
        expiresAt: expiresAt?.toISOString() ?? null,
        successIncrement: successInc,
        failIncrement: failInc,
        ...(input.metadata ?? {}),
      },
      observedAt: now,
      runId: input.runId ?? null,
      createdAt: now,
    });

    await upsertWarehouseRegistryOnTx(
      tx,
      input.tenantId,
      [
        { warehouseName: fromWarehouse, officeId: null, source: "rpa_modal" },
        { warehouseName: toWarehouse, officeId: null, source: "rpa_modal" },
      ],
      { markMissingAsRemoved: false },
    );
  });
}

export async function recordRedistributionQuotaObservations(input: {
  tenantId: string;
  source?: string;
  observations: Array<{
    warehouseName: string;
    officeId: number | null;
    quotaType: "src" | "dst";
    quota: number | null;
    metadata?: Record<string, unknown>;
  }>;
}) {
  const source = input.source ?? "http_quota_monitor";
  const now = new Date();
  const observations = input.observations
    .map((observation) => ({
      ...observation,
      warehouseName: normalizeWarehouseName(observation.warehouseName),
    }))
    .filter((observation) => observation.warehouseName.length > 0);

  if (!observations.length) {
    return;
  }

  await withTenantContext(db, input.tenantId, async (tx) => {
    await tx.insert(redistributionRouteAvailabilityEvents).values(observations.map((observation) => {
      const quota = observation.quota;
      const status: RouteStatus = quota === null
        ? "transient_error"
        : quota > 0 ? "available" : "limit_exhausted";
      const reason = quota === null
        ? `${observation.quotaType}_quota_missing`
        : `${observation.quotaType}_quota_${quota > 0 ? "available" : "zero"}`;

      return {
        tenantId: input.tenantId,
        fromWarehouse: observation.warehouseName,
        toWarehouse: `__${observation.quotaType}_quota__`,
        status,
        reason,
        source,
        metadata: {
          officeId: observation.officeId,
          quota,
          quotaType: observation.quotaType,
          ...(observation.metadata ?? {}),
        },
        observedAt: now,
        runId: null,
        createdAt: now,
      };
    }));

    await upsertWarehouseRegistryOnTx(
      tx,
      input.tenantId,
      observations.map((observation) => ({
        warehouseName: observation.warehouseName,
        officeId: observation.officeId,
        source,
      })),
      { markMissingAsRemoved: false },
    );
  });
}

export async function recordRedistributionRouteMatrixObservations(input: {
  tenantId: string;
  source?: string;
  observations: Array<{
    fromWarehouse: string;
    fromOfficeId: number | null;
    toWarehouse: string;
    toOfficeId: number | null;
    status: RouteStatus;
    reason: string;
    metadata?: Record<string, unknown>;
  }>;
}) {
  const source = input.source ?? "http_slot_matrix_monitor";
  const now = new Date();
  const observations = input.observations
    .map((observation) => ({
      ...observation,
      fromWarehouse: normalizeWarehouseName(observation.fromWarehouse),
      toWarehouse: normalizeWarehouseName(observation.toWarehouse),
    }))
    .filter((observation) =>
      observation.fromWarehouse.length > 0
      && observation.toWarehouse.length > 0
      && toRouteKey(observation.fromWarehouse, observation.toWarehouse) !== "::",
    );

  if (!observations.length) {
    return;
  }

  await withTenantContext(db, input.tenantId, async (tx) => {
    await tx.insert(redistributionRouteAvailabilityEvents).values(observations.map((observation) => ({
      tenantId: input.tenantId,
      fromWarehouse: observation.fromWarehouse,
      toWarehouse: observation.toWarehouse,
      status: observation.status,
      reason: observation.reason,
      source,
      metadata: {
        fromOfficeId: observation.fromOfficeId,
        toOfficeId: observation.toOfficeId,
        ...(observation.metadata ?? {}),
      },
      observedAt: now,
      runId: null,
      createdAt: now,
    })));

    await upsertWarehouseRegistryOnTx(
      tx,
      input.tenantId,
      observations.flatMap((observation) => [
        {
          warehouseName: observation.fromWarehouse,
          officeId: observation.fromOfficeId,
          source,
        },
        {
          warehouseName: observation.toWarehouse,
          officeId: observation.toOfficeId,
          source,
        },
      ]),
      { markMissingAsRemoved: false },
    );
  });
}

async function upsertWarehouseRegistryOnTx(
  tx: DrizzleTransaction,
  tenantId: string,
  warehouses: Array<{ warehouseName: string; officeId: number | null; source: string }>,
  options?: { markMissingAsRemoved?: boolean },
) {
  const now = new Date();
  const deduped = new Map<string, { warehouseName: string; officeId: number | null; source: string }>();

  for (const warehouse of warehouses) {
    const normalizedName = normalizeWarehouseName(warehouse.warehouseName);
    const dedupeKey = toComparableWarehouseName(normalizedName);
    if (!dedupeKey) continue;

    if (!deduped.has(dedupeKey)) {
      deduped.set(dedupeKey, {
        warehouseName: normalizedName,
        officeId: warehouse.officeId,
        source: warehouse.source,
      });
    }
  }

  const normalizedNames = Array.from(deduped.values()).map((warehouse) => warehouse.warehouseName);
  for (const warehouse of deduped.values()) {
    await tx.insert(redistributionWarehouseRegistry).values({
      tenantId,
      warehouseName: warehouse.warehouseName,
      officeId: warehouse.officeId,
      source: warehouse.source,
      status: "active",
      firstSeenAt: now,
      lastSeenAt: now,
      removedAt: null,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [
        redistributionWarehouseRegistry.tenantId,
        redistributionWarehouseRegistry.warehouseName,
      ],
      set: {
        officeId: warehouse.officeId,
        source: warehouse.source,
        status: "active",
        lastSeenAt: now,
        removedAt: null,
        updatedAt: now,
      },
    });
  }

  if (options?.markMissingAsRemoved && normalizedNames.length > 0) {
    await tx.update(redistributionWarehouseRegistry)
      .set({
        status: "removed",
        removedAt: now,
        updatedAt: now,
      })
      .where(and(
        eq(redistributionWarehouseRegistry.tenantId, tenantId),
        inArray(redistributionWarehouseRegistry.status, ["active"]),
        notInArray(redistributionWarehouseRegistry.warehouseName, normalizedNames),
      ));
  }
}

export async function refreshTenantWarehouseRegistryFromStocks(tenantId: string) {
  const lookbackFrom = withDays(new Date(), -WAREHOUSE_SCAN_LOOKBACK_DAYS);

  return withTenantContext(db, tenantId, async (tx) => {
    const stockSizeWarehouses = await tx.select({
      warehouseName: rawApiStockSizes.officeName,
      officeId: sql<number | null>`MAX(${rawApiStockSizes.officeId})`,
    })
      .from(rawApiStockSizes)
      .where(and(
        eq(rawApiStockSizes.tenantId, tenantId),
        eq(rawApiStockSizes.stockType, "wb"),
        gt(rawApiStockSizes.snapshotDate, lookbackFrom),
      ))
      .groupBy(rawApiStockSizes.officeName);

    const stockWarehouses = await tx.select({
      warehouseName: rawApiStocks.warehouseName,
      officeId: sql<number | null>`NULL`,
    })
      .from(rawApiStocks)
      .where(and(
        eq(rawApiStocks.tenantId, tenantId),
        gt(rawApiStocks.date, lookbackFrom),
      ))
      .groupBy(rawApiStocks.warehouseName);

    const merged = [
      ...stockSizeWarehouses.map((row) => ({
        warehouseName: row.warehouseName,
        officeId: row.officeId ?? null,
        source: "stock_sizes",
      })),
      ...stockWarehouses.map((row) => ({
        warehouseName: row.warehouseName,
        officeId: row.officeId ?? null,
        source: "raw_stocks",
      })),
    ];

    await upsertWarehouseRegistryOnTx(tx, tenantId, merged, { markMissingAsRemoved: true });

    return {
      discoveredWarehouses: merged.length,
      lookbackDays: WAREHOUSE_SCAN_LOOKBACK_DAYS,
    };
  });
}

function toRouteStatusCounts(
  rows: Array<{ status: string; count: number }>,
): RouteStatusCountMap {
  const counts: RouteStatusCountMap = {
    available: 0,
    limit_exhausted: 0,
    route_unavailable: 0,
    transient_error: 0,
    unknown: 0,
  };

  for (const row of rows) {
    const status = row.status as keyof RouteStatusCountMap;
    if (!(status in counts)) continue;
    counts[status] = row.count;
  }

  return counts;
}

export async function getRouteScanOverview(tenantId: string): Promise<RouteScanOverview> {
  const now = new Date();
  const nowIso = now.toISOString();
  const openedSince = withHours(now, -SLOT_MONITOR_RECENT_HOURS);
  const openedSinceIso = openedSince.toISOString();

  const [
    warehouseCountRows,
    routeCountRows,
    blockedRows,
    openedRows,
    hourlyRows,
    monitorRunRows,
    removedRows,
    [latestWarehouseRow],
    [latestRouteRow],
    [totalKnownWarehousesRow],
    [totalKnownRoutesRow],
  ] = await withTenantContext(db, tenantId, (tx) => Promise.all([
    tx.select({
      status: redistributionWarehouseRegistry.status,
      count: sql<number>`count(*)::int`,
    })
      .from(redistributionWarehouseRegistry)
      .where(eq(redistributionWarehouseRegistry.tenantId, tenantId))
      .groupBy(redistributionWarehouseRegistry.status),
    tx.select({
      status: redistributionRouteAvailability.status,
      count: sql<number>`count(*)::int`,
    })
      .from(redistributionRouteAvailability)
      .where(and(
        eq(redistributionRouteAvailability.tenantId, tenantId),
        sql`(${redistributionRouteAvailability.expiresAt} IS NULL OR ${redistributionRouteAvailability.expiresAt} > ${nowIso})`,
      ))
      .groupBy(redistributionRouteAvailability.status),
    tx.select({
      fromWarehouse: redistributionRouteAvailability.fromWarehouse,
      toWarehouse: redistributionRouteAvailability.toWarehouse,
      status: redistributionRouteAvailability.status,
      reason: redistributionRouteAvailability.reason,
      lastCheckedAt: redistributionRouteAvailability.lastCheckedAt,
      expiresAt: redistributionRouteAvailability.expiresAt,
      successCount: redistributionRouteAvailability.successCount,
      failCount: redistributionRouteAvailability.failCount,
    })
      .from(redistributionRouteAvailability)
      .where(and(
        eq(redistributionRouteAvailability.tenantId, tenantId),
        inArray(redistributionRouteAvailability.status, [...BLOCKING_ROUTE_STATUSES]),
        sql`(${redistributionRouteAvailability.expiresAt} IS NULL OR ${redistributionRouteAvailability.expiresAt} > ${nowIso})`,
      ))
      .orderBy(desc(redistributionRouteAvailability.lastCheckedAt))
      .limit(40),
    tx.select({
      fromWarehouse: redistributionRouteAvailability.fromWarehouse,
      toWarehouse: redistributionRouteAvailability.toWarehouse,
      source: redistributionRouteAvailability.source,
      reason: redistributionRouteAvailability.reason,
      lastCheckedAt: redistributionRouteAvailability.lastCheckedAt,
      successCount: redistributionRouteAvailability.successCount,
      failCount: redistributionRouteAvailability.failCount,
    })
      .from(redistributionRouteAvailability)
      .where(and(
        eq(redistributionRouteAvailability.tenantId, tenantId),
        eq(redistributionRouteAvailability.status, "available"),
        inArray(redistributionRouteAvailability.source, [...SLOT_MONITOR_EVENT_SOURCES]),
        sql`${redistributionRouteAvailability.lastCheckedAt} > ${openedSinceIso}`,
      ))
      .orderBy(desc(redistributionRouteAvailability.lastCheckedAt))
      .limit(40),
    tx.select({
      hourStartMsk: sql<string>`to_char(date_trunc('hour', ${redistributionRouteAvailabilityEvents.observedAt} AT TIME ZONE 'Europe/Moscow'), 'YYYY-MM-DD HH24:00')`,
      probes: sql<number>`count(*)::int`,
      opened: sql<number>`sum(case when ${redistributionRouteAvailabilityEvents.status} = 'available' then 1 else 0 end)::int`,
      blockedLimit: sql<number>`sum(case when ${redistributionRouteAvailabilityEvents.status} = 'limit_exhausted' then 1 else 0 end)::int`,
      blockedUnavailable: sql<number>`sum(case when ${redistributionRouteAvailabilityEvents.status} = 'route_unavailable' then 1 else 0 end)::int`,
      transient: sql<number>`sum(case when ${redistributionRouteAvailabilityEvents.status} = 'transient_error' then 1 else 0 end)::int`,
    })
      .from(redistributionRouteAvailabilityEvents)
      .where(and(
        eq(redistributionRouteAvailabilityEvents.tenantId, tenantId),
        inArray(redistributionRouteAvailabilityEvents.source, [...SLOT_MONITOR_EVENT_SOURCES]),
        sql`${redistributionRouteAvailabilityEvents.observedAt} > ${openedSinceIso}`,
      ))
      .groupBy(sql`date_trunc('hour', ${redistributionRouteAvailabilityEvents.observedAt} AT TIME ZONE 'Europe/Moscow')`)
      .orderBy(desc(sql`date_trunc('hour', ${redistributionRouteAvailabilityEvents.observedAt} AT TIME ZONE 'Europe/Moscow')`))
      .limit(Math.max(24, SLOT_MONITOR_RECENT_HOURS + 6)),
    tx.select({
      startedAt: redistributionSlotMonitorRuns.startedAt,
      finishedAt: redistributionSlotMonitorRuns.finishedAt,
      triggerSource: redistributionSlotMonitorRuns.triggerSource,
      mode: redistributionSlotMonitorRuns.mode,
      status: redistributionSlotMonitorRuns.status,
      skipped: redistributionSlotMonitorRuns.skipped,
      message: redistributionSlotMonitorRuns.message,
      autoSubmit: redistributionSlotMonitorRuns.autoSubmit,
      maxRoutesPerTenant: redistributionSlotMonitorRuns.maxRoutesPerTenant,
      probedItems: redistributionSlotMonitorRuns.probedItems,
      openedSlots: redistributionSlotMonitorRuns.openedSlots,
    })
      .from(redistributionSlotMonitorRuns)
      .where(and(
        eq(redistributionSlotMonitorRuns.tenantId, tenantId),
        sql`${redistributionSlotMonitorRuns.startedAt} > ${openedSinceIso}`,
      ))
      .orderBy(desc(redistributionSlotMonitorRuns.startedAt))
      .limit(40),
    tx.select({
      warehouseName: redistributionWarehouseRegistry.warehouseName,
      removedAt: redistributionWarehouseRegistry.removedAt,
      lastSeenAt: redistributionWarehouseRegistry.lastSeenAt,
    })
      .from(redistributionWarehouseRegistry)
      .where(and(
        eq(redistributionWarehouseRegistry.tenantId, tenantId),
        eq(redistributionWarehouseRegistry.status, "removed"),
      ))
      .orderBy(desc(redistributionWarehouseRegistry.removedAt))
      .limit(20),
    tx.select({
      value: sql<Date | null>`MAX(${redistributionWarehouseRegistry.lastSeenAt})`,
    })
      .from(redistributionWarehouseRegistry)
      .where(eq(redistributionWarehouseRegistry.tenantId, tenantId))
      .limit(1),
    tx.select({
      value: sql<Date | null>`MAX(${redistributionRouteAvailability.lastCheckedAt})`,
    })
      .from(redistributionRouteAvailability)
      .where(eq(redistributionRouteAvailability.tenantId, tenantId))
      .limit(1),
    tx.select({
      count: sql<number>`count(*)::int`,
    })
      .from(redistributionWarehouseRegistry)
      .where(eq(redistributionWarehouseRegistry.tenantId, tenantId))
      .limit(1),
    tx.select({
      count: sql<number>`count(*)::int`,
    })
      .from(redistributionRouteAvailability)
      .where(eq(redistributionRouteAvailability.tenantId, tenantId))
      .limit(1),
  ]));

  const warehouseCountMap = new Map(warehouseCountRows.map((row) => [row.status, row.count]));
  const routeCounts = toRouteStatusCounts(routeCountRows);
  const monitoringHourly = hourlyRows.map((row) => {
    const probes = toInt(row.probes);
    const opened = toInt(row.opened);
    return {
      hourStartMsk: row.hourStartMsk,
      probes,
      opened,
      openRatePct: probes > 0 ? round((opened / probes) * 100, 1) : 0,
      blockedLimit: toInt(row.blockedLimit),
      blockedUnavailable: toInt(row.blockedUnavailable),
      transient: toInt(row.transient),
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    warehouses: {
      totalKnown: totalKnownWarehousesRow?.count ?? 0,
      active: warehouseCountMap.get("active") ?? 0,
      removed: warehouseCountMap.get("removed") ?? 0,
      lastSeenAt: toIsoOrNull(latestWarehouseRow?.value ?? null),
      lastScanSource: (latestWarehouseRow?.value ?? null) ? "stock_snapshot" : "unknown",
    },
    routes: {
      totalKnown: totalKnownRoutesRow?.count ?? 0,
      available: routeCounts.available,
      blockedLimit: routeCounts.limit_exhausted,
      blockedUnavailable: routeCounts.route_unavailable,
      transient: routeCounts.transient_error,
      unknown: routeCounts.unknown,
      lastCheckedAt: toIsoOrNull(latestRouteRow?.value ?? null),
    },
    blockedRoutes: blockedRows.map((row) => ({
      fromWarehouse: row.fromWarehouse,
      toWarehouse: row.toWarehouse,
      status: row.status as BlockingRouteStatus,
      reason: row.reason,
      lastCheckedAt: toIsoOrNull(row.lastCheckedAt),
      expiresAt: toIsoOrNull(row.expiresAt),
      successCount: row.successCount,
      failCount: row.failCount,
    })),
    recentlyOpenedRoutes: openedRows.map((row) => ({
      fromWarehouse: row.fromWarehouse,
      toWarehouse: row.toWarehouse,
      source: row.source,
      reason: row.reason,
      openedAt: toIsoOrNull(row.lastCheckedAt),
      successCount: row.successCount,
      failCount: row.failCount,
    })),
    recentlyRemovedWarehouses: removedRows.map((row) => ({
      warehouseName: row.warehouseName,
      removedAt: toIsoOrNull(row.removedAt),
      lastSeenAt: toIsoOrNull(row.lastSeenAt),
    })),
    monitoring: {
      timezone: "Europe/Moscow",
      windowHours: SLOT_MONITOR_RECENT_HOURS,
      hourly: monitoringHourly,
      recentRuns: monitorRunRows.map((row) => ({
        startedAt: toIsoOrNull(row.startedAt),
        finishedAt: toIsoOrNull(row.finishedAt),
        triggerSource: row.triggerSource,
        mode: row.mode,
        status: row.status,
        skipped: row.skipped,
        message: row.message,
        autoSubmit: row.autoSubmit,
        maxRoutesPerTenant: row.maxRoutesPerTenant,
        probedItems: row.probedItems,
        openedSlots: row.openedSlots,
      })),
    },
  };
}

export async function runRouteScanForTenant(tenantId: string) {
  const refreshed = await refreshTenantWarehouseRegistryFromStocks(tenantId);
  const overview = await getRouteScanOverview(tenantId);

  return {
    tenantId,
    refreshed,
    overview,
  };
}

export async function runRouteScanForAllTenants() {
  const tenantRows = await db.select({
    id: tenants.id,
  })
    .from(tenants);

  const result: Array<{
    tenantId: string;
    ok: boolean;
    message: string;
    discoveredWarehouses: number;
  }> = [];

  for (const tenant of tenantRows) {
    try {
      const scan = await runRouteScanForTenant(tenant.id);
      result.push({
        tenantId: tenant.id,
        ok: true,
        message: "ok",
        discoveredWarehouses: scan.refreshed.discoveredWarehouses,
      });
    } catch (error) {
      result.push({
        tenantId: tenant.id,
        ok: false,
        message: error instanceof Error ? error.message : "route_scan_failed",
        discoveredWarehouses: 0,
      });
    }
  }

  return {
    scannedTenants: tenantRows.length,
    okTenants: result.filter((item) => item.ok).length,
    failedTenants: result.filter((item) => !item.ok).length,
    items: result,
  };
}
