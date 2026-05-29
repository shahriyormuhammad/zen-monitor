import { and, eq, inArray, lte, sql } from "drizzle-orm";

import { db, withTenantContext } from "@/lib/db";
import { products, rawApiRealizationReports, rawApiStockSizes } from "@/lib/db/schema";
import { resolveLocalityIndexMultiplierFromLocalization } from "@/components/economics/constants";

const TARGET_COVERAGE_DAYS = 14;
const FORECAST_HORIZON_DAYS = 14;
// Минимум 2 пары в перемещении (WB всё равно не даёт возить поштучно мелочь).
const MIN_TRANSFER_UNITS = 2;
// Порог «значимости» SKU+размера — понижен 5→3, чтобы покрыть длинный хвост
// размеров, которые тоже продаются и тоже создают дефицит в регионах.
const MIN_ORDERS_PER_SKU = 3;
const MAX_RECOMMENDATIONS = 500;
// Минимальный прирост локализации, чтобы маршрут попал в заявку. Понижен
// 0.1→0.03: даже небольшой прирост на дальнем округе суммарно копит ИЛ.
const MIN_LOCAL_SHARE_DELTA_PCT = 0.03;

type MatrixCellRuntime = {
  officeKey: string;
  regionName: string;
  officeId: number | null;
  officeName: string;
  ordersCount: number;
  ordersSum: number;
  stockCount: number;
  toClientCount: number;
  fromClientCount: number;
};

type SizeMatrixRuntime = {
  nmId: number;
  sizeName: string;
  chrtId: number | null;
  cells: Map<string, MatrixCellRuntime>;
};

type TransferDraft = {
  fromRegionName: string;
  fromWarehouse: string;
  fromOfficeId: number | null;
  toRegionName: string;
  toWarehouse: string;
  toOfficeId: number | null;
  transferUnits: number;
  fromStockBefore: number;
  toStockBefore: number;
  fromCoverageDaysBefore: number | null;
  toCoverageDaysBefore: number | null;
};

export type RedistributionTransferRecommendation = {
  nmId: number;
  vendorCode: string | null;
  brand: string | null;
  sizeName: string;
  chrtId: number | null;
  fromRegionName: string;
  fromWarehouse: string;
  fromOfficeId: number | null;
  toRegionName: string;
  toWarehouse: string;
  toOfficeId: number | null;
  transferUnits: number;
  priorityScore: number;
  estimatedSavingsRub: number;
  currentLocalSharePct: number;
  simulatedLocalSharePct: number;
  currentKrpPct: number;
  simulatedKrpPct: number;
  fromCoverageDaysBefore: number | null;
  toCoverageDaysBefore: number | null;
};

export type RedistributionScenario = {
  nmId: number;
  vendorCode: string | null;
  brand: string | null;
  sizeName: string;
  chrtId: number | null;
  forecastOrders: number;
  avgPriceRub: number;
  transferUnits: number;
  transferCount: number;
  currentLocalSharePct: number;
  simulatedLocalSharePct: number;
  currentKrpPct: number;
  simulatedKrpPct: number;
  estimatedExtraLogisticsRubBefore: number;
  estimatedExtraLogisticsRubAfter: number;
  /** КТР logistics coefficient (0.65–1.70) before/after the move. */
  currentKtr: number;
  simulatedKtr: number;
  /** Real per-unit delivery cost (delivery_rub) used as the anchor. */
  perUnitDeliveryRub: number;
  /** Savings split: commission (КРП) vs logistics tariff (КТР). */
  krpSavingsRub: number;
  ktrLogisticsSavingsRub: number;
  estimatedSavingsRub: number;
  transfers: TransferDraft[];
};

export type RedistributionPlan = {
  generatedAt: string;
  dataWindow: {
    requestedFrom: string;
    requestedTo: string;
    snapshotDate: string | null;
    snapshotPeriodFrom: string | null;
    snapshotPeriodTo: string | null;
    requestedDateWindowDays: number;
    effectiveDateWindowDays: number;
    windowAligned: boolean;
  };
  assumptions: {
    methodology: string;
    targetCoverageDays: number;
    forecastHorizonDays: number;
    dateWindowDays: number;
    notes: string[];
  };
  summary: {
    recommendationCount: number;
    skuCount: number;
    transferUnits: number;
    estimatedSavingsRub: number;
    krpSavingsRub: number;
    ktrLogisticsSavingsRub: number;
    currentKrpPct: number;
    simulatedKrpPct: number;
    currentLocalSharePct: number;
    simulatedLocalSharePct: number;
    currentIlIndex: number;
    simulatedIlIndex: number;
  };
  scenarios: RedistributionScenario[];
  recommendations: RedistributionTransferRecommendation[];
};

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

function toSafeNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeLabel(value: string | null | undefined, fallback: string) {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : fallback;
}

function round(value: number, precision = 2) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function toIsoDay(value: Date) {
  return toUtcDayStart(value).toISOString().slice(0, 10);
}

function getInclusiveDayWindow(from: Date, to: Date) {
  return Math.max(
    1,
    Math.floor((toUtcDayStart(to).getTime() - toUtcDayStart(from).getTime()) / 86_400_000) + 1,
  );
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(100, Math.max(0, value));
}

function resolveKrpByLocalization(localSharePct: number) {
  const share = clampPercent(localSharePct);

  if (share >= 60) return 0;
  if (share < 5) return 2.5;
  if (share < 10) return 2.45;
  if (share < 15) return 2.35;
  if (share < 20) return 2.3;
  if (share < 25) return 2.25;
  if (share < 30) return 2.2;
  if (share < 35) return 2.15;
  if (share < 45) return 2.1;
  if (share < 55) return 2.05;

  return 2;
}

/**
 * КТР — коэффициент логистики WB по индексу локализации (множитель тарифа
 * доставки, ниже = дешевле). Используем КАНОНИЧЕСКУЮ сетку из economics
 * (resolveLocalityIndexMultiplierFromLocalization, справка WB 23.03.2026,
 * 0.50…2.00) — она точнее портированной из Postal.
 *
 * Применяется НЕ для абсолютной стоимости, а для ОТНОШЕНИЯ: реальную
 * стоимость доставки берём из realization (delivery_rub), а КТР лишь
 * масштабирует её при изменении локализации.
 */
function resolveKtrByLocalization(localSharePct: number) {
  return resolveLocalityIndexMultiplierFromLocalization(clampPercent(localSharePct));
}

function coverageDays(stock: number, dailyDemand: number) {
  if (!Number.isFinite(dailyDemand) || dailyDemand <= 0) {
    return null;
  }

  return stock / dailyDemand;
}

function buildPriorityScore(input: {
  transferUnits: number;
  savingsRub: number;
  currentKrpPct: number;
  simulatedKrpPct: number;
  localShareDeltaPct: number;
  toCoverageDaysBefore: number | null;
}) {
  const krpDelta = Math.max(0, input.currentKrpPct - input.simulatedKrpPct);
  const localShareDelta = Math.max(0, input.localShareDeltaPct);
  const coveragePressure = input.toCoverageDaysBefore === null
    ? 0
    : Math.max(0, TARGET_COVERAGE_DAYS - input.toCoverageDaysBefore);

  return round(
    input.transferUnits * 1.5
      + localShareDelta * 8
      + krpDelta * 40
      + input.savingsRub / 200
      + coveragePressure * 4,
    2,
  );
}

function buildEmptyPlan(params: {
  requestedFrom: Date;
  requestedTo: Date;
  snapshotDate: Date | null;
  snapshotPeriodFrom: Date | null;
  snapshotPeriodTo: Date | null;
  requestedDateWindowDays: number;
  effectiveDateWindowDays: number;
  notes: string[];
}): RedistributionPlan {
  const windowAligned = (
    params.snapshotPeriodFrom !== null
    && params.snapshotPeriodTo !== null
    && toUtcDayStart(params.snapshotPeriodFrom).getTime() === toUtcDayStart(params.requestedFrom).getTime()
    && toUtcDayStart(params.snapshotPeriodTo).getTime() === toUtcDayStart(params.requestedTo).getTime()
  );

  return {
    generatedAt: new Date().toISOString(),
    dataWindow: {
      requestedFrom: toIsoDay(params.requestedFrom),
      requestedTo: toIsoDay(params.requestedTo),
      snapshotDate: params.snapshotDate ? toIsoDay(params.snapshotDate) : null,
      snapshotPeriodFrom: params.snapshotPeriodFrom ? toIsoDay(params.snapshotPeriodFrom) : null,
      snapshotPeriodTo: params.snapshotPeriodTo ? toIsoDay(params.snapshotPeriodTo) : null,
      requestedDateWindowDays: params.requestedDateWindowDays,
      effectiveDateWindowDays: params.effectiveDateWindowDays,
      windowAligned,
    },
    assumptions: {
      methodology: "factual_region_size_matrix_v4_localization_priority",
      targetCoverageDays: TARGET_COVERAGE_DAYS,
      forecastHorizonDays: FORECAST_HORIZON_DAYS,
      dateWindowDays: params.effectiveDateWindowDays,
      notes: params.notes,
    },
    summary: {
      recommendationCount: 0,
      skuCount: 0,
      transferUnits: 0,
      estimatedSavingsRub: 0,
      krpSavingsRub: 0,
      ktrLogisticsSavingsRub: 0,
      currentKrpPct: 0,
      simulatedKrpPct: 0,
      currentLocalSharePct: 0,
      simulatedLocalSharePct: 0,
      currentIlIndex: 1,
      simulatedIlIndex: 1,
    },
    scenarios: [],
    recommendations: [],
  };
}

export async function getRedistributionPlan(
  tenantId: string,
  dateFrom: Date,
  dateTo: Date,
): Promise<RedistributionPlan> {
  const from = toUtcDayStart(dateFrom);
  const to = toUtcDayStart(dateTo);
  const toExclusive = addUtcDays(to, 1);
  const requestedDateWindowDays = getInclusiveDayWindow(from, to);

  return withTenantContext(db, tenantId, async (tx) => {
  const [latestSnapshotRow] = await tx.select({
    snapshotDate: sql<Date | null>`MAX(${rawApiStockSizes.snapshotDate})`,
  })
    .from(rawApiStockSizes)
    .where(and(
      eq(rawApiStockSizes.tenantId, tenantId),
      lte(rawApiStockSizes.snapshotDate, toExclusive),
      eq(rawApiStockSizes.stockType, "wb"),
    ));

  const latestSnapshotDate = latestSnapshotRow?.snapshotDate ? new Date(latestSnapshotRow.snapshotDate) : null;
  if (!latestSnapshotDate) {
    return buildEmptyPlan({
      requestedFrom: from,
      requestedTo: to,
      snapshotDate: null,
      snapshotPeriodFrom: null,
      snapshotPeriodTo: null,
      requestedDateWindowDays,
      effectiveDateWindowDays: requestedDateWindowDays,
      notes: [
        "Нет фактических данных WB stocks-report/products/sizes для выбранного кабинета.",
        "Запустите синхронизацию источников stock_offices и stock_sizes, затем повторите расчёт.",
        "Прокси-локализация не применяется: план строится только на фактической матрице регион/склад/размер.",
      ],
    });
  }

  const stockSizeRows = await tx.select({
    nmId: rawApiStockSizes.nmId,
    sizeName: rawApiStockSizes.sizeName,
    chrtId: rawApiStockSizes.chrtId,
    regionName: rawApiStockSizes.regionName,
    officeId: rawApiStockSizes.officeId,
    officeName: rawApiStockSizes.officeName,
    ordersCount: rawApiStockSizes.ordersCount,
    ordersSum: rawApiStockSizes.ordersSum,
    stockCount: rawApiStockSizes.stockCount,
    toClientCount: rawApiStockSizes.toClientCount,
    fromClientCount: rawApiStockSizes.fromClientCount,
    periodStart: rawApiStockSizes.periodStart,
    periodEnd: rawApiStockSizes.periodEnd,
    createdAt: rawApiStockSizes.createdAt,
  })
    .from(rawApiStockSizes)
    .where(and(
      eq(rawApiStockSizes.tenantId, tenantId),
      eq(rawApiStockSizes.stockType, "wb"),
      eq(rawApiStockSizes.snapshotDate, latestSnapshotDate),
    ));

  if (stockSizeRows.length === 0) {
    return buildEmptyPlan({
      requestedFrom: from,
      requestedTo: to,
      snapshotDate: latestSnapshotDate,
      snapshotPeriodFrom: null,
      snapshotPeriodTo: null,
      requestedDateWindowDays,
      effectiveDateWindowDays: requestedDateWindowDays,
      notes: [
        "Снимок stock_sizes найден, но в нём нет строк для расчёта.",
        "Проверьте доступ токена Analytics и диапазон дат синхронизации.",
        "Прокси-локализация не применяется: план строится только на фактической матрице регион/склад/размер.",
      ],
    });
  }

  const dedupedStockRowsMap = new Map<string, (typeof stockSizeRows)[number]>();
  for (const row of stockSizeRows) {
    const dedupeKey = [
      row.nmId,
      row.sizeName ?? "",
      row.chrtId ?? "none",
      row.regionName ?? "",
      row.officeId ?? "none",
      row.officeName ?? "",
    ].join("::");

    const existing = dedupedStockRowsMap.get(dedupeKey);
    if (!existing) {
      dedupedStockRowsMap.set(dedupeKey, row);
      continue;
    }

    const existingCreatedAt = new Date(existing.createdAt).getTime();
    const nextCreatedAt = new Date(row.createdAt).getTime();
    if (nextCreatedAt >= existingCreatedAt) {
      dedupedStockRowsMap.set(dedupeKey, row);
    }
  }

  const dedupedStockRows = Array.from(dedupedStockRowsMap.values());
  const duplicateRowsDropped = Math.max(0, stockSizeRows.length - dedupedStockRows.length);

  const snapshotPeriodFrom = dedupedStockRows
    .map((row) => row.periodStart)
    .reduce<Date | null>((min, current) => {
      const normalized = current ? toUtcDayStart(new Date(current)) : null;
      if (!normalized) {
        return min;
      }
      if (!min || normalized.getTime() < min.getTime()) {
        return normalized;
      }
      return min;
    }, null);
  const snapshotPeriodTo = dedupedStockRows
    .map((row) => row.periodEnd)
    .reduce<Date | null>((max, current) => {
      const normalized = current ? toUtcDayStart(new Date(current)) : null;
      if (!normalized) {
        return max;
      }
      if (!max || normalized.getTime() > max.getTime()) {
        return normalized;
      }
      return max;
    }, null);

  const hasSnapshotPeriod = (
    snapshotPeriodFrom !== null
    && snapshotPeriodTo !== null
    && snapshotPeriodTo.getTime() >= snapshotPeriodFrom.getTime()
  );
  const effectiveFrom = hasSnapshotPeriod ? snapshotPeriodFrom : from;
  const effectiveTo = hasSnapshotPeriod ? snapshotPeriodTo : to;
  const effectiveDateWindowDays = getInclusiveDayWindow(effectiveFrom, effectiveTo);
  const windowAligned = (
    effectiveFrom.getTime() === from.getTime()
    && effectiveTo.getTime() === to.getTime()
  );

  const matrixBySkuSize = new Map<string, SizeMatrixRuntime>();

  for (const row of dedupedStockRows) {
    const nmId = row.nmId;
    const sizeName = normalizeLabel(row.sizeName, "Без размера");
    const chrtId = row.chrtId ?? null;
    const matrixKey = `${nmId}::${sizeName}::${chrtId ?? "none"}`;
    const regionName = normalizeLabel(row.regionName, "Маркетплейс");
    const officeName = normalizeLabel(row.officeName, "Все склады");
    const officeId = row.officeId ?? null;
    const officeKey = `${regionName}::${officeName}::${officeId ?? "none"}`;

    const matrix = matrixBySkuSize.get(matrixKey) ?? {
      nmId,
      sizeName,
      chrtId,
      cells: new Map<string, MatrixCellRuntime>(),
    };

    const currentCell = matrix.cells.get(officeKey) ?? {
      officeKey,
      regionName,
      officeId,
      officeName,
      ordersCount: 0,
      ordersSum: 0,
      stockCount: 0,
      toClientCount: 0,
      fromClientCount: 0,
    };

    currentCell.ordersCount += toSafeNumber(row.ordersCount);
    currentCell.ordersSum += toSafeNumber(row.ordersSum);
    currentCell.stockCount += toSafeNumber(row.stockCount);
    currentCell.toClientCount += toSafeNumber(row.toClientCount);
    currentCell.fromClientCount += toSafeNumber(row.fromClientCount);

    matrix.cells.set(officeKey, currentCell);
    matrixBySkuSize.set(matrixKey, matrix);
  }

  const nmIds = Array.from(new Set(Array.from(matrixBySkuSize.values()).map((matrix) => matrix.nmId)));
  const productRows = nmIds.length > 0
    ? await tx.select({
      nmId: products.nmId,
      vendorCode: products.vendorCode,
      brand: products.brand,
    })
      .from(products)
      .where(and(
        eq(products.tenantId, tenantId),
        inArray(products.nmId, nmIds),
      ))
    : [];

  const productByNm = new Map<number, { vendorCode: string | null; brand: string | null }>();
  for (const product of productRows) {
    productByNm.set(product.nmId, {
      vendorCode: product.vendorCode ?? null,
      brand: product.brand ?? null,
    });
  }

  // Real per-unit logistics cost from realization reports (delivery_rub).
  // This already embeds WB's current localization coefficient, so we use it
  // as the anchor and scale only by the КТР ratio when localization changes.
  const deliveryByNm = new Map<number, number>();
  let tenantAvgDeliveryRub = 0;
  if (nmIds.length > 0) {
    const nmIdList = sql.join(nmIds.map((id) => sql`${id}::bigint`), sql`, `);
    const deliveryRows = await tx.execute(sql`
      SELECT nm_id::text AS nm_id,
             SUM(delivery_rub)::numeric AS total_delivery,
             COUNT(*)::int AS cnt
      FROM raw_api_realization_reports
      WHERE tenant_id = ${tenantId}
        AND nm_id IN (${nmIdList})
        AND delivery_rub > 0
      GROUP BY nm_id
    `) as unknown as Array<{ nm_id: string; total_delivery: string; cnt: number }>;
    let grandTotal = 0;
    let grandCount = 0;
    for (const r of deliveryRows) {
      const total = Number(r.total_delivery) || 0;
      const cnt = Number(r.cnt) || 0;
      if (cnt > 0) {
        deliveryByNm.set(Number(r.nm_id), total / cnt);
        grandTotal += total;
        grandCount += cnt;
      }
    }
    tenantAvgDeliveryRub = grandCount > 0 ? grandTotal / grandCount : 0;
  }

  const scenarios: RedistributionScenario[] = [];
  const recommendations: RedistributionTransferRecommendation[] = [];

  for (const matrix of matrixBySkuSize.values()) {
    const cells = Array.from(matrix.cells.values());
    if (cells.length < 2) {
      continue;
    }

    const totalOrders = cells.reduce((sum, cell) => sum + cell.ordersCount, 0);
    if (totalOrders < MIN_ORDERS_PER_SKU) {
      continue;
    }

    const totalOrderSum = cells.reduce((sum, cell) => sum + cell.ordersSum, 0);
    const avgPriceRub = totalOrders > 0 ? totalOrderSum / totalOrders : 0;
    if (avgPriceRub <= 0) {
      continue;
    }

    const deficits = cells
      .map((cell) => {
        const dailyDemand = cell.ordersCount / effectiveDateWindowDays;
        const targetStock = dailyDemand * TARGET_COVERAGE_DAYS;
        const deficit = Math.max(0, targetStock - cell.stockCount);

        return {
          ...cell,
          dailyDemand,
          deficit,
        };
      })
      .filter((cell) => cell.dailyDemand > 0 && cell.deficit >= MIN_TRANSFER_UNITS)
      .sort((left, right) => right.deficit - left.deficit || right.dailyDemand - left.dailyDemand);

    const donors = cells
      .map((cell) => {
        const dailyDemand = cell.ordersCount / effectiveDateWindowDays;
        const targetStock = dailyDemand * TARGET_COVERAGE_DAYS;
        const surplus = Math.max(0, cell.stockCount - targetStock);

        return {
          ...cell,
          dailyDemand,
          surplus,
          remainingSurplus: surplus,
        };
      })
      .filter((cell) => cell.surplus >= MIN_TRANSFER_UNITS)
      .sort((left, right) => right.surplus - left.surplus || right.stockCount - left.stockCount);

    if (deficits.length === 0 || donors.length === 0) {
      continue;
    }

    const stockAfter = new Map<string, number>(cells.map((cell) => [cell.officeKey, cell.stockCount]));
    const transferDrafts: TransferDraft[] = [];

    for (const deficit of deficits) {
      let remainingDeficit = deficit.deficit;

      while (remainingDeficit >= MIN_TRANSFER_UNITS) {
        const donor = donors.find((candidate) => (
          candidate.officeKey !== deficit.officeKey
          && candidate.remainingSurplus >= MIN_TRANSFER_UNITS
        ));

        if (!donor) {
          break;
        }

        const transferUnits = Math.floor(Math.min(remainingDeficit, donor.remainingSurplus));
        if (transferUnits < MIN_TRANSFER_UNITS) {
          break;
        }

        donor.remainingSurplus -= transferUnits;
        remainingDeficit -= transferUnits;

        stockAfter.set(
          donor.officeKey,
          Math.max(0, (stockAfter.get(donor.officeKey) ?? donor.stockCount) - transferUnits),
        );
        stockAfter.set(
          deficit.officeKey,
          (stockAfter.get(deficit.officeKey) ?? deficit.stockCount) + transferUnits,
        );

        transferDrafts.push({
          fromRegionName: donor.regionName,
          fromWarehouse: donor.officeName,
          fromOfficeId: donor.officeId,
          toRegionName: deficit.regionName,
          toWarehouse: deficit.officeName,
          toOfficeId: deficit.officeId,
          transferUnits,
          fromStockBefore: donor.stockCount,
          toStockBefore: deficit.stockCount,
          fromCoverageDaysBefore: coverageDays(donor.stockCount, donor.dailyDemand),
          toCoverageDaysBefore: coverageDays(deficit.stockCount, deficit.dailyDemand),
        });
      }
    }

    if (transferDrafts.length === 0) {
      continue;
    }

    let forecastOrders = 0;
    let localForecastBefore = 0;
    let localForecastAfter = 0;

    for (const cell of cells) {
      const dailyDemand = cell.ordersCount / effectiveDateWindowDays;
      const demandForecast = dailyDemand * FORECAST_HORIZON_DAYS;
      if (demandForecast <= 0) {
        continue;
      }

      forecastOrders += demandForecast;
      localForecastBefore += Math.min(cell.stockCount, demandForecast);
      localForecastAfter += Math.min(stockAfter.get(cell.officeKey) ?? cell.stockCount, demandForecast);
    }

    if (forecastOrders < MIN_ORDERS_PER_SKU) {
      continue;
    }

    const currentLocalSharePct = clampPercent((localForecastBefore / forecastOrders) * 100);
    const simulatedLocalSharePct = clampPercent((localForecastAfter / forecastOrders) * 100);
    const localShareDeltaPct = simulatedLocalSharePct - currentLocalSharePct;
    if (localShareDeltaPct < MIN_LOCAL_SHARE_DELTA_PCT) {
      continue;
    }

    const currentKrpPct = resolveKrpByLocalization(currentLocalSharePct);
    const simulatedKrpPct = resolveKrpByLocalization(simulatedLocalSharePct);

    // КРП — экономия на региональной комиссии (% от цены).
    const estimatedExtraLogisticsRubBefore = avgPriceRub * forecastOrders * (currentKrpPct / 100);
    const estimatedExtraLogisticsRubAfter = avgPriceRub * forecastOrders * (simulatedKrpPct / 100);
    const krpSavingsRub = Math.max(0, estimatedExtraLogisticsRubBefore - estimatedExtraLogisticsRubAfter);

    // КТР — экономия на логистическом тарифе. Якорь — реальная стоимость
    // доставки из realization (delivery_rub/ед), фоллбэк — средняя по кабинету.
    // base = D / КТР(тек); экономия = (D − base×КТР(нов)) × прогноз.
    const currentKtr = resolveKtrByLocalization(currentLocalSharePct);
    const simulatedKtr = resolveKtrByLocalization(simulatedLocalSharePct);
    const perUnitDelivery = deliveryByNm.get(matrix.nmId) ?? tenantAvgDeliveryRub;
    const baseDelivery = currentKtr > 0 ? perUnitDelivery / currentKtr : 0;
    const ktrSavingsPerUnit = Math.max(0, perUnitDelivery - baseDelivery * simulatedKtr);
    const ktrLogisticsSavingsRub = ktrSavingsPerUnit * forecastOrders;

    // Полный эконом-эффект = комиссия (КРП) + логистика (КТР).
    const estimatedSavingsRub = krpSavingsRub + ktrLogisticsSavingsRub;

    const product = productByNm.get(matrix.nmId);
    const transferUnits = transferDrafts.reduce((sum, transfer) => sum + transfer.transferUnits, 0);

    const scenario: RedistributionScenario = {
      nmId: matrix.nmId,
      vendorCode: product?.vendorCode ?? null,
      brand: product?.brand ?? null,
      sizeName: matrix.sizeName,
      chrtId: matrix.chrtId,
      forecastOrders: round(forecastOrders, 1),
      avgPriceRub: round(avgPriceRub, 2),
      transferUnits,
      transferCount: transferDrafts.length,
      currentLocalSharePct: round(currentLocalSharePct, 2),
      simulatedLocalSharePct: round(simulatedLocalSharePct, 2),
      currentKrpPct: round(currentKrpPct, 2),
      simulatedKrpPct: round(simulatedKrpPct, 2),
      estimatedExtraLogisticsRubBefore: round(estimatedExtraLogisticsRubBefore, 2),
      estimatedExtraLogisticsRubAfter: round(estimatedExtraLogisticsRubAfter, 2),
      currentKtr: round(currentKtr, 2),
      simulatedKtr: round(simulatedKtr, 2),
      perUnitDeliveryRub: round(perUnitDelivery, 2),
      krpSavingsRub: round(krpSavingsRub, 2),
      ktrLogisticsSavingsRub: round(ktrLogisticsSavingsRub, 2),
      estimatedSavingsRub: round(estimatedSavingsRub, 2),
      transfers: transferDrafts,
    };
    scenarios.push(scenario);

    for (const transfer of transferDrafts) {
      const transferSavingsRub = scenario.estimatedSavingsRub * (transfer.transferUnits / transferUnits);
      recommendations.push({
        nmId: matrix.nmId,
        vendorCode: product?.vendorCode ?? null,
        brand: product?.brand ?? null,
        sizeName: matrix.sizeName,
        chrtId: matrix.chrtId,
        fromRegionName: transfer.fromRegionName,
        fromWarehouse: transfer.fromWarehouse,
        fromOfficeId: transfer.fromOfficeId,
        toRegionName: transfer.toRegionName,
        toWarehouse: transfer.toWarehouse,
        toOfficeId: transfer.toOfficeId,
        transferUnits: transfer.transferUnits,
        priorityScore: buildPriorityScore({
          transferUnits: transfer.transferUnits,
          savingsRub: transferSavingsRub,
          currentKrpPct: scenario.currentKrpPct,
          simulatedKrpPct: scenario.simulatedKrpPct,
          localShareDeltaPct: scenario.simulatedLocalSharePct - scenario.currentLocalSharePct,
          toCoverageDaysBefore: transfer.toCoverageDaysBefore,
        }),
        estimatedSavingsRub: round(transferSavingsRub, 2),
        currentLocalSharePct: scenario.currentLocalSharePct,
        simulatedLocalSharePct: scenario.simulatedLocalSharePct,
        currentKrpPct: scenario.currentKrpPct,
        simulatedKrpPct: scenario.simulatedKrpPct,
        fromCoverageDaysBefore: transfer.fromCoverageDaysBefore === null ? null : round(transfer.fromCoverageDaysBefore, 1),
        toCoverageDaysBefore: transfer.toCoverageDaysBefore === null ? null : round(transfer.toCoverageDaysBefore, 1),
      });
    }
  }

  if (scenarios.length === 0) {
    const notes = [
      "Для выбранного периода не найдено маршрутов с улучшением локализации и ИРП/КРП.",
      "Расчёт выполнен на фактической матрице WB stocks-report/products/sizes (регион/склад/размер).",
      "Прокси-локализация не применяется.",
      ...(duplicateRowsDropped > 0
        ? [`Из расчёта исключены дубли stock_sizes: ${duplicateRowsDropped} строк.`]
        : []),
    ];

    if (!windowAligned) {
      notes.push(
        `Период в интерфейсе (${toIsoDay(from)} — ${toIsoDay(to)}) не совпал с периодом последнего снимка stock_sizes (${toIsoDay(effectiveFrom)} — ${toIsoDay(effectiveTo)}). Нормировка спроса выполнена по периоду снимка.`,
      );
    }

    return buildEmptyPlan({
      requestedFrom: from,
      requestedTo: to,
      snapshotDate: latestSnapshotDate,
      snapshotPeriodFrom,
      snapshotPeriodTo,
      requestedDateWindowDays,
      effectiveDateWindowDays,
      notes,
    });
  }

  const sortedScenarios = scenarios
    .sort((left, right) => {
      const leftDelta = left.simulatedLocalSharePct - left.currentLocalSharePct;
      const rightDelta = right.simulatedLocalSharePct - right.currentLocalSharePct;
      return (
        rightDelta - leftDelta
        || (right.currentKrpPct - right.simulatedKrpPct) - (left.currentKrpPct - left.simulatedKrpPct)
        || right.estimatedSavingsRub - left.estimatedSavingsRub
        || right.transferUnits - left.transferUnits
      );
    });

  const sortedRecommendations = recommendations
    .sort((left, right) => (
      right.priorityScore - left.priorityScore
      || right.estimatedSavingsRub - left.estimatedSavingsRub
      || right.transferUnits - left.transferUnits
    ))
    .slice(0, MAX_RECOMMENDATIONS);

  const weightedDenominator = sortedScenarios.reduce((sum, scenario) => sum + scenario.forecastOrders, 0);
  const currentKrpPct = weightedDenominator > 0
    ? sortedScenarios.reduce((sum, scenario) => sum + scenario.currentKrpPct * scenario.forecastOrders, 0) / weightedDenominator
    : 0;
  const simulatedKrpPct = weightedDenominator > 0
    ? sortedScenarios.reduce((sum, scenario) => sum + scenario.simulatedKrpPct * scenario.forecastOrders, 0) / weightedDenominator
    : 0;
  const currentLocalSharePct = weightedDenominator > 0
    ? sortedScenarios.reduce((sum, scenario) => sum + scenario.currentLocalSharePct * scenario.forecastOrders, 0) / weightedDenominator
    : 0;
  const simulatedLocalSharePct = weightedDenominator > 0
    ? sortedScenarios.reduce((sum, scenario) => sum + scenario.simulatedLocalSharePct * scenario.forecastOrders, 0) / weightedDenominator
    : 0;

  const summary = {
    recommendationCount: sortedRecommendations.length,
    skuCount: sortedScenarios.length,
    transferUnits: sortedRecommendations.reduce((sum, recommendation) => sum + recommendation.transferUnits, 0),
    estimatedSavingsRub: round(sortedScenarios.reduce((sum, scenario) => sum + scenario.estimatedSavingsRub, 0), 2),
    krpSavingsRub: round(sortedScenarios.reduce((sum, scenario) => sum + scenario.krpSavingsRub, 0), 2),
    ktrLogisticsSavingsRub: round(sortedScenarios.reduce((sum, scenario) => sum + scenario.ktrLogisticsSavingsRub, 0), 2),
    currentKrpPct: round(currentKrpPct, 2),
    simulatedKrpPct: round(simulatedKrpPct, 2),
    currentLocalSharePct: round(currentLocalSharePct, 2),
    simulatedLocalSharePct: round(simulatedLocalSharePct, 2),
    // ИЛ-индекс = средневзвешенный КТР (множитель логистики).
    currentIlIndex: round(resolveKtrByLocalization(currentLocalSharePct), 3),
    simulatedIlIndex: round(resolveKtrByLocalization(simulatedLocalSharePct), 3),
  };

  return {
    generatedAt: new Date().toISOString(),
    dataWindow: {
      requestedFrom: toIsoDay(from),
      requestedTo: toIsoDay(to),
      snapshotDate: toIsoDay(latestSnapshotDate),
      snapshotPeriodFrom: snapshotPeriodFrom ? toIsoDay(snapshotPeriodFrom) : null,
      snapshotPeriodTo: snapshotPeriodTo ? toIsoDay(snapshotPeriodTo) : null,
      requestedDateWindowDays,
      effectiveDateWindowDays,
      windowAligned,
    },
    assumptions: {
      methodology: "factual_region_size_matrix_v4_localization_priority",
      targetCoverageDays: TARGET_COVERAGE_DAYS,
      forecastHorizonDays: FORECAST_HORIZON_DAYS,
      dateWindowDays: effectiveDateWindowDays,
      notes: [
        "Расчёт основан на фактической матрице спроса/остатков WB: stocks-report/products/sizes с детализацией includeOffice=true.",
        "Главный приоритет ранжирования — рост доли локальных заказов и снижение ИРП/КРП; рублёвый эффект используется как вторичный критерий.",
        "ИРП/КРП в деньгах моделируется по официальной сетке КРП и средней цене заказа для связки SKU+размер.",
        "Рекомендации формируются по маршрутам склад→склад в пределах одного SKU+размера, без прокси-локализации.",
        ...(duplicateRowsDropped > 0
          ? [`Из расчёта исключены дубли stock_sizes: ${duplicateRowsDropped} строк.`]
          : []),
        ...(!windowAligned
          ? [
            `Период в интерфейсе (${toIsoDay(from)} — ${toIsoDay(to)}) не совпал с периодом последнего снимка stock_sizes (${toIsoDay(effectiveFrom)} — ${toIsoDay(effectiveTo)}). Нормировка спроса выполнена по периоду снимка.`,
          ]
          : []),
      ],
    },
    summary,
    scenarios: sortedScenarios,
    recommendations: sortedRecommendations,
  };
  }); // withTenantContext
}
