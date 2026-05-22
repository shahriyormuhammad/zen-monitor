import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { tenants } from "@/lib/db/schema";
import { decrypt } from "@/lib/encryption";
import type { RedistributionTransferRecommendation } from "@/server/analytics/redistribution";
import {
  isOfficialRedistributionWarehouse,
  recordRedistributionRouteMatrixObservations,
  recordRedistributionQuotaObservations,
  saveRouteAvailabilityResult,
} from "@/server/redistribution/route-scan";
import {
  createWbLkReadSessionFromStorageState,
  fetchWbLkReadOnlyJson,
  type WbLkReadSession,
} from "@/server/wb/lk-refresh-flow";

const WB_SHIFTS_BASE_URL = "https://seller-weekly-report.wildberries.ru/ns/shifts/analytics-back/api/v1";
const DEFAULT_LIMIT = 20;

export type WbRedistributionNm = {
  nmID: number;
  subjectName: string;
};

export type WbRedistributionStockSize = {
  techSize: string;
  chrtID: number;
  count: number;
};

export type WbRedistributionSourceWarehouse = {
  officeID: number;
  officeName: string;
  inStock: WbRedistributionStockSize[];
};

export type WbRedistributionDestinationWarehouse = {
  officeID: number;
  officeName: string;
};

export type WbRedistributionStocksResponse = {
  data?: {
    src?: WbRedistributionSourceWarehouse[];
    dst?: WbRedistributionDestinationWarehouse[];
  };
  error?: boolean;
  errorText?: string;
};

export type WbRedistributionQuotaResponse = {
  data?: {
    officeID: number;
    quota: number;
  };
  error?: boolean;
  errorText?: string;
};

export type RedistributionHttpSlotStatus =
  | "available"
  | "limit_exhausted"
  | "route_unavailable"
  | "transient_error";

export type RedistributionHttpSlotProbeItem = {
  nmId: number;
  vendorCode: string | null;
  sizeName: string;
  fromWarehouse: string;
  toWarehouse: string;
  transferUnits: number;
  status: RedistributionHttpSlotStatus;
  reason: string;
  fromOfficeId: number | null;
  toOfficeId: number | null;
  chrtId: number | null;
  inStockUnits: number | null;
  srcQuota: number | null;
  dstQuota: number | null;
  canSubmitUnits: number;
  itemId?: string | null;
  runId?: string | null;
  submitted: boolean;
  submittedUnits: number;
  submitReason: string | null;
};

export type RedistributionHttpSlotProbeResult = {
  tenantId: string;
  checkedAt: string;
  ok: boolean;
  message: string;
  probedItems: number;
  openedSlots: number;
  submittedItems: number;
  items: RedistributionHttpSlotProbeItem[];
  matrix: RedistributionHttpSlotMatrixStats | null;
};

export type RedistributionHttpSlotMatrixStats = {
  nmIds: number[];
  probedRoutes: number;
  openedRoutes: number;
  blockedLimit: number;
  blockedUnavailable: number;
  transient: number;
  capped: boolean;
};

type ProbeInput = Pick<
  RedistributionTransferRecommendation,
  | "nmId"
  | "vendorCode"
  | "sizeName"
  | "fromWarehouse"
  | "toWarehouse"
  | "transferUnits"
  | "fromOfficeId"
  | "toOfficeId"
> & {
  id?: string | null;
  runId?: string | null;
};

function clampLimit(value: number | undefined) {
  if (!Number.isFinite(value) || (value ?? 0) <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(Math.max(1, Math.round(value as number)), 50);
}

export function normalizeWbWarehouseName(value: string) {
  return value
    .toLowerCase()
    .replace(/[«»"']/g, "")
    .replace(/\bwb\b/g, "")
    .replace(/[^a-zа-яё0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function wbWarehouseMatches(
  wbWarehouse: { officeID?: number | null; officeName: string },
  expected: { officeId?: number | null; warehouseName: string },
) {
  if (
    expected.officeId != null
    && wbWarehouse.officeID != null
    && Number(wbWarehouse.officeID) === Number(expected.officeId)
  ) {
    return true;
  }

  const actualName = normalizeWbWarehouseName(wbWarehouse.officeName);
  const expectedName = normalizeWbWarehouseName(expected.warehouseName);
  if (!actualName || !expectedName) {
    return false;
  }

  return actualName.includes(expectedName) || expectedName.includes(actualName);
}

function matchSourceWarehouse(
  stocks: WbRedistributionStocksResponse,
  recommendation: ProbeInput,
) {
  return (stocks.data?.src ?? []).find((warehouse) =>
    wbWarehouseMatches(warehouse, {
      officeId: recommendation.fromOfficeId,
      warehouseName: recommendation.fromWarehouse,
    }),
  ) ?? null;
}

function matchDestinationWarehouse(
  stocks: WbRedistributionStocksResponse,
  recommendation: ProbeInput,
) {
  return (stocks.data?.dst ?? []).find((warehouse) =>
    wbWarehouseMatches(warehouse, {
      officeId: recommendation.toOfficeId,
      warehouseName: recommendation.toWarehouse,
    }),
  ) ?? null;
}

function matchSize(
  sourceWarehouse: WbRedistributionSourceWarehouse | null,
  sizeName: string,
) {
  const expected = sizeName.trim().toLowerCase();
  return sourceWarehouse?.inStock.find((size) => size.techSize.trim().toLowerCase() === expected) ?? null;
}

function toPositiveInt(value: unknown) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.floor(parsed);
}

export function buildSlotProbeItem(input: {
  recommendation: ProbeInput;
  sourceWarehouse: WbRedistributionSourceWarehouse | null;
  destinationWarehouse: WbRedistributionDestinationWarehouse | null;
  size: WbRedistributionStockSize | null;
  srcQuota: number | null;
  dstQuota: number | null;
}): RedistributionHttpSlotProbeItem {
  const { recommendation, sourceWarehouse, destinationWarehouse, size, srcQuota, dstQuota } = input;
  const transferUnits = Math.max(1, toPositiveInt(recommendation.transferUnits));
  const inStockUnits = size ? toPositiveInt(size.count) : null;
  const safeSrcQuota = srcQuota == null ? null : toPositiveInt(srcQuota);
  const safeDstQuota = dstQuota == null ? null : toPositiveInt(dstQuota);

  let status: RedistributionHttpSlotStatus = "available";
  let reason = "http_slot_available";

  if (!sourceWarehouse) {
    status = "route_unavailable";
    reason = "source_warehouse_not_found";
  } else if (!destinationWarehouse) {
    status = "route_unavailable";
    reason = "destination_warehouse_not_found";
  } else if (!size) {
    status = "route_unavailable";
    reason = "size_not_in_source_stock";
  } else if ((inStockUnits ?? 0) <= 0) {
    status = "route_unavailable";
    reason = "source_stock_zero";
  } else if ((safeSrcQuota ?? 0) <= 0) {
    status = "limit_exhausted";
    reason = "src_quota_zero";
  } else if ((safeDstQuota ?? 0) <= 0) {
    status = "limit_exhausted";
    reason = "dst_quota_zero";
  }

  const canSubmitUnits = status === "available"
    ? Math.min(transferUnits, inStockUnits ?? 0, safeSrcQuota ?? 0, safeDstQuota ?? 0)
    : 0;

  return {
    nmId: recommendation.nmId,
    vendorCode: recommendation.vendorCode ?? null,
    sizeName: recommendation.sizeName,
    fromWarehouse: recommendation.fromWarehouse,
    toWarehouse: recommendation.toWarehouse,
    transferUnits,
    status,
    reason,
    fromOfficeId: sourceWarehouse?.officeID ?? recommendation.fromOfficeId ?? null,
    toOfficeId: destinationWarehouse?.officeID ?? recommendation.toOfficeId ?? null,
    chrtId: size?.chrtID ?? null,
    inStockUnits,
    srcQuota: safeSrcQuota,
    dstQuota: safeDstQuota,
    canSubmitUnits,
    itemId: recommendation.id ?? null,
    runId: recommendation.runId ?? null,
    submitted: false,
    submittedUnits: 0,
    submitReason: null,
  };
}

function buildTransientProbeItem(
  recommendation: ProbeInput,
  error: unknown,
): RedistributionHttpSlotProbeItem {
  const message = error instanceof Error ? error.message : "http_slot_probe_failed";
  return {
    nmId: recommendation.nmId,
    vendorCode: recommendation.vendorCode ?? null,
    sizeName: recommendation.sizeName,
    fromWarehouse: recommendation.fromWarehouse,
    toWarehouse: recommendation.toWarehouse,
    transferUnits: Math.max(1, toPositiveInt(recommendation.transferUnits)),
    status: "transient_error",
    reason: message.slice(0, 2000),
    fromOfficeId: recommendation.fromOfficeId ?? null,
    toOfficeId: recommendation.toOfficeId ?? null,
    chrtId: null,
    inStockUnits: null,
    srcQuota: null,
    dstQuota: null,
    canSubmitUnits: 0,
    itemId: recommendation.id ?? null,
    runId: recommendation.runId ?? null,
    submitted: false,
    submittedUnits: 0,
    submitReason: null,
  };
}

async function loadTenantStorageState(tenantId: string) {
  const [tenant] = await db
    .select({ storage: tenants.wbLkStorageState })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  if (!tenant?.storage) {
    throw new Error("WB ЛК storageState не сохранён.");
  }

  return decrypt(tenant.storage);
}

async function fetchStocks(
  session: WbLkReadSession,
  nmId: number,
) {
  return fetchWbLkReadOnlyJson<WbRedistributionStocksResponse>(
    session,
    `${WB_SHIFTS_BASE_URL}/stocks?nmID=${encodeURIComponent(String(nmId))}`,
    { method: "GET" },
  );
}

async function fetchQuota(
  session: WbLkReadSession,
  officeId: number,
  type: "src" | "dst",
) {
  const response = await fetchWbLkReadOnlyJson<WbRedistributionQuotaResponse>(
    session,
    `${WB_SHIFTS_BASE_URL}/quota?officeID=${encodeURIComponent(String(officeId))}&type=${type}`,
    { method: "GET" },
  );
  return response.data?.quota ?? null;
}

async function submitRedistributionOrder(
  session: WbLkReadSession,
  item: RedistributionHttpSlotProbeItem,
) {
  if (!item.fromOfficeId || !item.toOfficeId || !item.chrtId || item.canSubmitUnits <= 0) {
    throw new Error("submit_payload_incomplete");
  }

  const response = await fetchWbLkReadOnlyJson<{
    data?: unknown;
    error?: boolean;
    errorText?: string;
  }>(
    session,
    `${WB_SHIFTS_BASE_URL}/order`,
    {
      method: "POST",
      body: {
        order: {
          src: item.fromOfficeId,
          dst: item.toOfficeId,
          nmID: item.nmId,
          count: [
            {
              count: item.canSubmitUnits,
              chrtID: item.chrtId,
            },
          ],
        },
      },
    },
  );

  if (response.error) {
    throw new Error(response.errorText || "wb_order_error");
  }

  return response;
}

async function collectQuotaObservations(input: {
  tenantId: string;
  stocksByNm: Map<number, WbRedistributionStocksResponse>;
  getQuota: (officeId: number | null, type: "src" | "dst") => Promise<number | null>;
  source: string;
}) {
  const observationKeys = new Set<string>();
  const safeQuotaByKey = new Map<string, {
    quota: number | null;
    quotaError?: string;
  }>();
  const observations: Array<{
    warehouseName: string;
    officeId: number | null;
    quotaType: "src" | "dst";
    quota: number | null;
    metadata: Record<string, unknown>;
  }> = [];
  const readQuotaSafely = async (
    officeId: number | null,
    type: "src" | "dst",
  ): Promise<{ quota: number | null; quotaError?: string }> => {
    if (officeId == null) {
      return { quota: null };
    }
    const key = `${type}:${officeId}`;
    const cached = safeQuotaByKey.get(key);
    if (cached) {
      return cached;
    }
    try {
      const value: { quota: number | null; quotaError?: string } = {
        quota: await input.getQuota(officeId, type),
      };
      safeQuotaByKey.set(key, value);
      return value;
    } catch (error) {
      const value = {
        quota: null,
        quotaError: error instanceof Error ? error.message.slice(0, 500) : "quota_probe_failed",
      };
      safeQuotaByKey.set(key, value);
      return value;
    }
  };

  for (const [nmId, stocks] of input.stocksByNm.entries()) {
    for (const warehouse of stocks.data?.src ?? []) {
      const key = `${nmId}:src:${warehouse.officeID}`;
      if (observationKeys.has(key)) {
        continue;
      }
      observationKeys.add(key);
      const quotaObservation = await readQuotaSafely(warehouse.officeID, "src");
      observations.push({
        warehouseName: warehouse.officeName,
        officeId: warehouse.officeID,
        quotaType: "src",
        quota: quotaObservation.quota,
        metadata: {
          nmId,
          quotaError: quotaObservation.quotaError,
          sourceSizes: warehouse.inStock.map((size) => ({
            techSize: size.techSize,
            chrtID: size.chrtID,
            count: size.count,
          })),
        },
      });
    }

    for (const warehouse of stocks.data?.dst ?? []) {
      const key = `${nmId}:dst:${warehouse.officeID}`;
      if (observationKeys.has(key)) {
        continue;
      }
      observationKeys.add(key);
      const quotaObservation = await readQuotaSafely(warehouse.officeID, "dst");
      observations.push({
        warehouseName: warehouse.officeName,
        officeId: warehouse.officeID,
        quotaType: "dst",
        quota: quotaObservation.quota,
        metadata: { nmId, quotaError: quotaObservation.quotaError },
      });
    }
  }

  await recordRedistributionQuotaObservations({
    tenantId: input.tenantId,
    source: input.source,
    observations,
  });
}

async function collectRouteMatrixObservations(input: {
  tenantId: string;
  stocksByNm: Map<number, WbRedistributionStocksResponse>;
  getQuota: (officeId: number | null, type: "src" | "dst") => Promise<number | null>;
  source: string;
  maxRoutes: number;
}) {
  const maxRoutes = Math.max(0, Math.floor(input.maxRoutes));
  const stats: RedistributionHttpSlotMatrixStats = {
    nmIds: Array.from(input.stocksByNm.keys()),
    probedRoutes: 0,
    openedRoutes: 0,
    blockedLimit: 0,
    blockedUnavailable: 0,
    transient: 0,
    capped: false,
  };

  if (maxRoutes <= 0 || input.stocksByNm.size === 0) {
    return stats;
  }

  const safeQuotaByKey = new Map<string, {
    quota: number | null;
    quotaError?: string;
  }>();
  const readQuotaSafely = async (
    officeId: number | null,
    type: "src" | "dst",
  ): Promise<{ quota: number | null; quotaError?: string }> => {
    if (officeId == null) {
      return { quota: null };
    }
    const key = `${type}:${officeId}`;
    const cached = safeQuotaByKey.get(key);
    if (cached) {
      return cached;
    }
    try {
      const value: { quota: number | null; quotaError?: string } = {
        quota: await input.getQuota(officeId, type),
      };
      safeQuotaByKey.set(key, value);
      return value;
    } catch (error) {
      const value = {
        quota: null,
        quotaError: error instanceof Error ? error.message.slice(0, 500) : "quota_probe_failed",
      };
      safeQuotaByKey.set(key, value);
      return value;
    }
  };

  const observations: Parameters<typeof recordRedistributionRouteMatrixObservations>[0]["observations"] = [];
  const observedKeys = new Set<string>();

  for (const [nmId, stocks] of input.stocksByNm.entries()) {
    const sources = (stocks.data?.src ?? [])
      .filter((warehouse) => isOfficialRedistributionWarehouse(warehouse.officeName));
    const destinations = (stocks.data?.dst ?? [])
      .filter((warehouse) => isOfficialRedistributionWarehouse(warehouse.officeName));

    for (const sourceWarehouse of sources) {
      const positiveSizes = sourceWarehouse.inStock
        .map((size) => ({
          techSize: size.techSize,
          chrtID: size.chrtID,
          count: toPositiveInt(size.count),
        }))
        .filter((size) => size.count > 0);
      const sourceStockUnits = positiveSizes.reduce((sum, size) => sum + size.count, 0);
      const srcQuota = await readQuotaSafely(sourceWarehouse.officeID, "src");

      for (const destinationWarehouse of destinations) {
        if (
          sourceWarehouse.officeID != null
          && destinationWarehouse.officeID != null
          && Number(sourceWarehouse.officeID) === Number(destinationWarehouse.officeID)
        ) {
          continue;
        }

        const observedKey = [
          nmId,
          sourceWarehouse.officeID,
          sourceWarehouse.officeName,
          destinationWarehouse.officeID,
          destinationWarehouse.officeName,
        ].join("::");
        if (observedKeys.has(observedKey)) {
          continue;
        }
        observedKeys.add(observedKey);

        const dstQuota = await readQuotaSafely(destinationWarehouse.officeID, "dst");
        let status: RedistributionHttpSlotStatus = "available";
        let reason = "http_matrix_route_available";
        const safeSrcQuota = srcQuota.quota == null ? null : toPositiveInt(srcQuota.quota);
        const safeDstQuota = dstQuota.quota == null ? null : toPositiveInt(dstQuota.quota);

        if (sourceStockUnits <= 0) {
          status = "route_unavailable";
          reason = "source_stock_zero";
        } else if (srcQuota.quotaError) {
          status = "transient_error";
          reason = `src_quota_error: ${srcQuota.quotaError}`.slice(0, 2000);
        } else if (dstQuota.quotaError) {
          status = "transient_error";
          reason = `dst_quota_error: ${dstQuota.quotaError}`.slice(0, 2000);
        } else if (safeSrcQuota == null) {
          status = "transient_error";
          reason = "src_quota_missing";
        } else if (safeDstQuota == null) {
          status = "transient_error";
          reason = "dst_quota_missing";
        } else if (safeSrcQuota <= 0) {
          status = "limit_exhausted";
          reason = "src_quota_zero";
        } else if (safeDstQuota <= 0) {
          status = "limit_exhausted";
          reason = "dst_quota_zero";
        }

        stats.probedRoutes += 1;
        if (status === "available") {
          stats.openedRoutes += 1;
        } else if (status === "limit_exhausted") {
          stats.blockedLimit += 1;
        } else if (status === "route_unavailable") {
          stats.blockedUnavailable += 1;
        } else if (status === "transient_error") {
          stats.transient += 1;
        }

        observations.push({
          fromWarehouse: sourceWarehouse.officeName,
          fromOfficeId: sourceWarehouse.officeID,
          toWarehouse: destinationWarehouse.officeName,
          toOfficeId: destinationWarehouse.officeID,
          status,
          reason,
          metadata: {
            nmId,
            srcQuota: safeSrcQuota,
            dstQuota: safeDstQuota,
            sourceStockUnits,
            sourceSizes: positiveSizes.slice(0, 20),
          },
        });

        if (observations.length >= maxRoutes) {
          stats.capped = true;
          break;
        }
      }

      if (observations.length >= maxRoutes) {
        break;
      }
    }

    if (observations.length >= maxRoutes) {
      break;
    }
  }

  if (observations.length > 0) {
    await recordRedistributionRouteMatrixObservations({
      tenantId: input.tenantId,
      source: input.source,
      observations,
    });
  }

  return stats;
}

export async function probeRedistributionSlotsHttp(input: {
  tenantId: string;
  recommendations: ProbeInput[];
  limit?: number;
  persistAvailability?: boolean;
  submitAvailable?: boolean;
  monitorAllWarehouses?: boolean;
  monitorAllDirections?: boolean;
  matrixNmIds?: number[];
  matrixRouteLimit?: number;
  availabilitySource?: string;
  quotaSource?: string;
  matrixSource?: string;
}) {
  const limit = clampLimit(input.limit);
  const recommendations = input.recommendations.slice(0, limit);
  const matrixNmIds = Array.from(new Set((input.matrixNmIds ?? [])
    .filter((nmId) => Number.isFinite(nmId) && nmId > 0)
    .map((nmId) => Math.floor(nmId))));
  const checkedAt = new Date();
  const storageState = await loadTenantStorageState(input.tenantId);
  const session = await createWbLkReadSessionFromStorageState(storageState);
  const stocksByNm = new Map<number, WbRedistributionStocksResponse>();
  const stockFetchErrorsByNm = new Map<number, unknown>();
  const quotaByKey = new Map<string, number | null>();
  const items: RedistributionHttpSlotProbeItem[] = [];

  const getStocks = async (nmId: number) => {
    if (stocksByNm.has(nmId)) {
      return stocksByNm.get(nmId) ?? {};
    }
    if (stockFetchErrorsByNm.has(nmId)) {
      throw stockFetchErrorsByNm.get(nmId);
    }
    try {
      const stocks = await fetchStocks(session, nmId);
      stocksByNm.set(nmId, stocks);
      return stocks;
    } catch (error) {
      stockFetchErrorsByNm.set(nmId, error);
      throw error;
    }
  };

  const getQuota = async (officeId: number | null, type: "src" | "dst") => {
    if (officeId == null) {
      return null;
    }
    const key = `${type}:${officeId}`;
    if (!quotaByKey.has(key)) {
      quotaByKey.set(key, await fetchQuota(session, officeId, type));
    }
    return quotaByKey.get(key) ?? null;
  };

  for (const recommendation of recommendations) {
    let probeItem: RedistributionHttpSlotProbeItem;
    try {
      const stocks = await getStocks(recommendation.nmId);
      const sourceWarehouse = matchSourceWarehouse(stocks, recommendation);
      const destinationWarehouse = matchDestinationWarehouse(stocks, recommendation);
      const size = matchSize(sourceWarehouse, recommendation.sizeName);
      const srcQuota = await getQuota(sourceWarehouse?.officeID ?? recommendation.fromOfficeId ?? null, "src");
      const dstQuota = await getQuota(destinationWarehouse?.officeID ?? recommendation.toOfficeId ?? null, "dst");

      probeItem = buildSlotProbeItem({
        recommendation,
        sourceWarehouse,
        destinationWarehouse,
        size,
        srcQuota,
        dstQuota,
      });

      if (input.submitAvailable && probeItem.status === "available" && probeItem.canSubmitUnits > 0) {
        await submitRedistributionOrder(session, probeItem);
        probeItem = {
          ...probeItem,
          submitted: true,
          submittedUnits: probeItem.canSubmitUnits,
          submitReason: "http_order_submitted",
        };
      }
    } catch (error) {
      const transientItem = buildTransientProbeItem(recommendation, error);
      probeItem = input.submitAvailable
        ? {
          ...transientItem,
          reason: `http_submit_or_probe_failed: ${transientItem.reason}`.slice(0, 2000),
        }
        : transientItem;
    }
    items.push(probeItem);

    if (input.persistAvailability ?? true) {
      await saveRouteAvailabilityResult({
        tenantId: input.tenantId,
        fromWarehouse: recommendation.fromWarehouse,
        toWarehouse: recommendation.toWarehouse,
        status: probeItem.status,
        reason: probeItem.submitted ? "http_order_submitted" : probeItem.reason,
        source: input.availabilitySource ?? "http_slot_probe",
        metadata: {
          nmId: probeItem.nmId,
          itemId: probeItem.itemId ?? null,
          runId: probeItem.runId ?? null,
          sizeName: probeItem.sizeName,
          fromOfficeId: probeItem.fromOfficeId,
          toOfficeId: probeItem.toOfficeId,
          chrtId: probeItem.chrtId,
          inStockUnits: probeItem.inStockUnits,
          srcQuota: probeItem.srcQuota,
          dstQuota: probeItem.dstQuota,
          canSubmitUnits: probeItem.canSubmitUnits,
          submitted: probeItem.submitted,
          submittedUnits: probeItem.submittedUnits,
        },
      });
    }
  }

  for (const nmId of matrixNmIds) {
    if (stocksByNm.has(nmId)) {
      continue;
    }
    try {
      await getStocks(nmId);
    } catch {
      // Матрица мониторинга не должна ломать автосоздание заявок по целевым маршрутам.
    }
  }

  if (input.monitorAllWarehouses) {
    await collectQuotaObservations({
      tenantId: input.tenantId,
      stocksByNm,
      getQuota,
      source: input.quotaSource ?? "http_quota_monitor",
    }).catch(() => {});
  }

  const matrix = input.monitorAllDirections
    ? await collectRouteMatrixObservations({
      tenantId: input.tenantId,
      stocksByNm,
      getQuota,
      source: input.matrixSource ?? "http_slot_matrix_monitor",
      maxRoutes: input.matrixRouteLimit ?? 250,
    }).catch(() => null)
    : null;

  const openedSlots = items.filter((item) => item.status === "available" && item.canSubmitUnits > 0).length;
  const submittedItems = items.filter((item) => item.submitted).length;
  const matrixSuffix = matrix
    ? ` Матрица WB: открыто ${matrix.openedRoutes}/${matrix.probedRoutes} направлений${matrix.capped ? " (срез ограничен)" : ""}.`
    : "";
  return {
    tenantId: input.tenantId,
    checkedAt: checkedAt.toISOString(),
    ok: true,
    message: `${items.length === 0 && matrix
      ? "HTTP-проверка целевых маршрутов не запускалась."
      : submittedItems > 0
        ? `HTTP-мониторинг создал заявки: ${submittedItems}/${items.length}.`
        : openedSlots > 0
          ? `HTTP-проверка нашла свободные слоты: ${openedSlots}/${items.length}.`
          : `HTTP-проверка прошла: свободных слотов по проверенным маршрутам нет (${items.length}).`}${matrixSuffix}`,
    probedItems: items.length,
    openedSlots,
    submittedItems,
    items,
    matrix,
  } satisfies RedistributionHttpSlotProbeResult;
}
