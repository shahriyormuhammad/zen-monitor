/**
 * Per-row financial summary for Unit Economics.
 *
 * `buildRowSummary` is a pure function — no React, no DOM, no I/O — that takes
 * a single product row, the user's manual inputs for it, the cached WB tariff
 * maps, plus a few page-level overrides, and returns every derived figure the
 * UI needs (`RowSummary`).
 *
 * Extracted **verbatim** from the legacy `UnitEconomicsTemplateTable.tsx`
 * `buildRowSummary` callback so the new UI produces numerically identical
 * output. Do NOT edit formulas here without comparing against the legacy
 * component AND running through historical user data — the values are
 * persisted across sessions and surfaced in the dashboard.
 */

import {
  DEFAULT_ACTIVE_PRICE_SCENARIO_ID,
  DEFAULT_WAREHOUSES,
  PRICE_SCENARIOS,
  WB_STORAGE_BASE_UP_TO_ONE_LITER,
  normalizeLocalityIndexMultiplier,
  resolveIrpFromLocalization,
  resolveLocalityIndexMultiplierFromLocalization,
} from './constants';
import {
  clampPercent,
  hasManualValue,
  normalizeWarehouseKey,
  parseCoefExprToMultiplier,
  roundCurrency,
  toNumber,
} from './helpers';
import {
  BUYOUT_AUTO_MAX_OPEN_SHARE,
  BUYOUT_AUTO_MIN_CLOSED_ORDERS,
  computeWbLogisticsWithBuyout,
  getRowBuyoutAutoDiagnostics,
  getWbLogisticsBaseUpToOneLiter,
  pickAcceptanceTariffByWarehouseLabel,
  pickReturnTariffByWarehouseLabel,
  resolveReverseLogisticsForVolume,
  resolveReturnTariffOfficeForVolume,
  resolveVolumeLiters,
  type AcceptanceTariffCandidate,
  type ReturnTariffCandidate,
} from './tariff-helpers';
import type {
  ManualFields,
  PriceScenarioId,
  RowSummary,
  TradeScheme,
  UnitTemplateRow,
} from './types';

export type BuildRowSummaryDeps = {
  /** Pre-normalized acceptance tariffs map (key: normalized warehouse label). */
  normalizedTariffMap: Map<string, AcceptanceTariffCandidate>;
  /** Pre-normalized return tariffs map (key: normalized warehouse label or geo). */
  normalizedReturnTariffMap: Map<string, ReturnTariffCandidate>;
  /** Optional global WB discount override applied when scenario `wbDiscount` is empty. */
  globalWbDiscount: string;
  /** Tenant default tax % (overrides the per-product `manualFields.taxPercent`). */
  defaultTaxPercent: number | null;
};

function resolveBuyoutAutoWarningText(
  reason: RowSummary['buyoutAutoReason'],
  values: { orderCount: number; closedCount: number; openCount: number; openShare: number },
): string | null {
  if (reason === 'no_history') {
    return 'Авто-выкуп отключен: истории SKU меньше 30 дней.';
  }
  if (reason === 'no_fact') {
    return 'Авто-выкуп отключен: нет факта WB за выбранный период.';
  }
  if (reason === 'low_closed_base') {
    return `Авто-выкуп отключен: мало закрытых заказов (${Math.round(values.closedCount)} из минимум ${BUYOUT_AUTO_MIN_CLOSED_ORDERS}).`;
  }
  if (reason === 'high_open_share') {
    return `Авто-выкуп отключен: много незакрытых заказов (${Math.round(values.openCount)} из ${Math.round(values.orderCount)}, ${(values.openShare * 100).toFixed(0)}% > ${(BUYOUT_AUTO_MAX_OPEN_SHARE * 100).toFixed(0)}%).`;
  }
  return null;
}

/**
 * Compute the full RowSummary for `(row, manualFields)`.
 *
 * @param scenarioOverrideId - if set, use this price scenario instead of the
 *        one stored in `manualFields.activePriceScenarioId`. Used by the table
 *        to render projections under hypothetical scenarios.
 */
export function buildRowSummary(
  targetRow: UnitTemplateRow,
  targetManualFields: ManualFields,
  deps: BuildRowSummaryDeps,
  scenarioOverrideId?: PriceScenarioId,
): RowSummary {
  const { normalizedTariffMap, normalizedReturnTariffMap, globalWbDiscount, defaultTaxPercent } = deps;

  const rowSoldQuantity = toNumber(targetRow?.soldQuantity);
  const rowGrossRevenue = toNumber(targetRow?.grossRevenue);
  const rowCommission = toNumber(targetRow?.commission);
  const rowTotalCost = toNumber(targetRow?.totalCost);
  const rowNetProfit = toNumber(targetRow?.netProfit);
  const rowVolumeLiters = resolveVolumeLiters(targetRow);

  const selectedWarehouseCosts = targetManualFields.selectedWarehouses
    .map((warehouseId) => toNumber(targetManualFields.warehouseCosts[warehouseId]))
    .filter((value) => value > 0);
  const deliveryToMarketplace = selectedWarehouseCosts.length > 0
    ? selectedWarehouseCosts.reduce((sum, value) => sum + value, 0) / selectedWarehouseCosts.length
    : 0;

  const rowCostPrice = (() => {
    const manualCost = toNumber(targetManualFields.costPrice);
    if (manualCost > 0) {
      return manualCost;
    }

    const configuredPurchase = toNumber(targetRow?.purchasePrice);
    if (configuredPurchase > 0) {
      return configuredPurchase;
    }

    const hasDetailedCosts = toNumber(targetManualFields.deliveryToFf) > 0
      || toNumber(targetManualFields.packagingMaterial) > 0
      || toNumber(targetManualFields.fulfillment) > 0
      || deliveryToMarketplace > 0;
    if (!hasDetailedCosts) {
      const legacyCost = toNumber(targetRow?.costPrice);
      if (legacyCost > 0) {
        return legacyCost;
      }
      if (rowTotalCost > 0 && rowSoldQuantity > 0) {
        return rowTotalCost / rowSoldQuantity;
      }
    }
    return 0;
  })();

  const fullCost = roundCurrency(rowCostPrice
    + toNumber(targetManualFields.deliveryToFf)
    + toNumber(targetManualFields.packagingMaterial)
    + toNumber(targetManualFields.fulfillment)
    + deliveryToMarketplace);

  const rowWarehouseLabelMap = new Map<string, string>([
    ...DEFAULT_WAREHOUSES.map((item) => [item.id, item.label] as const),
    ...targetManualFields.customWarehouses.map((item) => [item.id, item.label] as const),
  ]);

  const selectedWarehouseRates = targetManualFields.selectedWarehouses.map((warehouseId) => {
    const label = rowWarehouseLabelMap.get(warehouseId) ?? warehouseId;
    const normalizedLabel = normalizeWarehouseKey(label);
    const tariff = pickAcceptanceTariffByWarehouseLabel(normalizedTariffMap, normalizedLabel);
    const returnTariff = pickReturnTariffByWarehouseLabel(normalizedReturnTariffMap, normalizedLabel);

    const extraLiters = Math.max(rowVolumeLiters - 1, 0);
    const isUpToOneLiter = rowVolumeLiters > 0 && rowVolumeLiters <= 1;
    const logisticsBaseUpToOneLiter = isUpToOneLiter ? getWbLogisticsBaseUpToOneLiter(rowVolumeLiters) : 0;

    const deliveryCoefMultiplier = parseCoefExprToMultiplier(toNumber(tariff?.deliveryCoef));
    const storageCoefMultiplier = parseCoefExprToMultiplier(toNumber(tariff?.storageCoef));
    const deliveryBaseLiter = toNumber(tariff?.deliveryBaseLiter);
    const deliveryAdditionalLiter = toNumber(tariff?.deliveryAdditionalLiter);
    const storageBaseLiter = toNumber(tariff?.storageBaseLiter);
    const storageAdditionalLiter = toNumber(tariff?.storageAdditionalLiter);
    const reverseLogistics = resolveReverseLogisticsForVolume(tariff, rowVolumeLiters);

    // Forward for ≤1 л is built from local WB base tiers, so apply the
    // warehouse coefficient. For >1 л WB tariff endpoints already return
    // deliveryBaseLiter/deliveryAdditionalLiter with the coefficient applied.
    // ИЛ (locality multiplier) is applied later at the row-summary level
    // (per-row, not per-warehouse), see logisticsPerUnit usage below.
    const baseForward = isUpToOneLiter
      ? logisticsBaseUpToOneLiter
      : deliveryBaseLiter > 0
        ? deliveryBaseLiter + deliveryAdditionalLiter * extraLiters
        : 0;
    const wbLogisticsPerUnit = tariff && baseForward > 0 && deliveryCoefMultiplier > 0
      ? (isUpToOneLiter ? baseForward * deliveryCoefMultiplier : baseForward)
      : 0;
    const wbStoragePerUnit = tariff
      ? (isUpToOneLiter
        ? (storageCoefMultiplier > 0
          ? WB_STORAGE_BASE_UP_TO_ONE_LITER * storageCoefMultiplier
          : 0)
        : (storageBaseLiter > 0
          ? storageBaseLiter + (storageAdditionalLiter * extraLiters)
          : 0))
      : 0;
    const wbReverseLogisticsPerUnit = reverseLogistics.total;
    const returnToSellerTariff = resolveReturnTariffOfficeForVolume(returnTariff, rowVolumeLiters);
    const wbReturnToSellerPerUnit = returnToSellerTariff.base > 0
      ? (isUpToOneLiter
        ? returnToSellerTariff.base
        : returnToSellerTariff.base + (returnToSellerTariff.liter * extraLiters))
      : 0;
    const hasTariff = wbLogisticsPerUnit > 0
      || wbStoragePerUnit > 0
      || wbReverseLogisticsPerUnit > 0;

    return { hasTariff, wbLogisticsPerUnit, wbStoragePerUnit, wbReverseLogisticsPerUnit, wbReturnToSellerPerUnit };
  });

  const warehousesWithForwardLogistics = selectedWarehouseRates.filter((item) => item.wbLogisticsPerUnit > 0);
  const warehousesWithStorage = selectedWarehouseRates.filter((item) => item.wbStoragePerUnit > 0);
  const warehousesWithReverseLogistics = selectedWarehouseRates.filter((item) => item.wbReverseLogisticsPerUnit > 0);
  const warehousesWithReturnToSeller = selectedWarehouseRates.filter((item) => item.wbReturnToSellerPerUnit > 0);
  const avgWbLogisticsPerUnit = warehousesWithForwardLogistics.length > 0
    ? warehousesWithForwardLogistics.reduce((sum, item) => sum + item.wbLogisticsPerUnit, 0) / warehousesWithForwardLogistics.length
    : 0;
  const avgWbStoragePerUnit = warehousesWithStorage.length > 0
    ? warehousesWithStorage.reduce((sum, item) => sum + item.wbStoragePerUnit, 0) / warehousesWithStorage.length
    : 0;
  const avgWbReverseLogisticsPerUnit = warehousesWithReverseLogistics.length > 0
    ? warehousesWithReverseLogistics.reduce((sum, item) => sum + item.wbReverseLogisticsPerUnit, 0) / warehousesWithReverseLogistics.length
    : 0;
  const avgWbReturnToSellerPerUnit = warehousesWithReturnToSeller.length > 0
    ? warehousesWithReturnToSeller.reduce((sum, item) => sum + item.wbReturnToSellerPerUnit, 0) / warehousesWithReturnToSeller.length
    : 0;
  const rowBuyoutAutoDiagnostics = getRowBuyoutAutoDiagnostics(targetRow);
  const rowBuyoutAutoPercent = rowBuyoutAutoDiagnostics.autoPercent;
  const rowBuyoutHistoryDays = rowBuyoutAutoDiagnostics.historyDays;
  const rowCanUseAutoBuyout = rowBuyoutAutoDiagnostics.canUseAuto;
  const rowBuyoutAutoWarning = resolveBuyoutAutoWarningText(rowBuyoutAutoDiagnostics.reason, {
    orderCount: rowBuyoutAutoDiagnostics.orderCount,
    closedCount: rowBuyoutAutoDiagnostics.closedCount,
    openCount: rowBuyoutAutoDiagnostics.openCount,
    openShare: rowBuyoutAutoDiagnostics.openShare,
  });

  const scenarioMetrics = PRICE_SCENARIOS.map((scenario) => {
    const draft = targetManualFields.priceScenarios[scenario.id];
    const sellerPriceBeforeDiscount = toNumber(draft?.sellerPriceBeforeDiscount);
    const sellerDiscountPercent = clampPercent(toNumber(draft?.sellerDiscount));
    const wbDiscountPercent = clampPercent(
      toNumber(draft?.wbDiscount) || toNumber(globalWbDiscount),
    );
    const hasManualBuyout = hasManualValue(draft?.buyoutPercent);
    const buyoutManualPercent = hasManualBuyout
      ? clampPercent(toNumber(draft?.buyoutPercent))
      : 0;
    const buyoutPercent = rowCanUseAutoBuyout
      ? rowBuyoutAutoPercent
      : buyoutManualPercent;
    const buyoutSource: RowSummary['buyoutSource'] = rowCanUseAutoBuyout
      ? 'auto'
      : hasManualBuyout
        ? 'manual'
        : 'none';
    const priceBeforeWbDiscount = sellerPriceBeforeDiscount > 0
      ? sellerPriceBeforeDiscount * (1 - sellerDiscountPercent / 100)
      : 0;
    const priceAfterWb = priceBeforeWbDiscount > 0
      ? priceBeforeWbDiscount * (1 - wbDiscountPercent / 100)
      : 0;

    return {
      id: scenario.id,
      sellerPriceBeforeDiscount,
      sellerDiscountPercent,
      priceBeforeWbDiscount,
      wbDiscountPercent,
      priceAfterWb,
      buyoutManualPercent,
      buyoutAutoPercent: rowCanUseAutoBuyout ? rowBuyoutAutoPercent : 0,
      buyoutHistoryDays: rowBuyoutHistoryDays,
      buyoutSource,
      buyoutPercent,
    };
  });

  const preferredScenarioId = scenarioOverrideId ?? targetManualFields.activePriceScenarioId;
  const activeScenario = scenarioMetrics.find((item) => item.id === preferredScenarioId)
    ?? scenarioMetrics.find((item) => item.id === DEFAULT_ACTIVE_PRICE_SCENARIO_ID)
    ?? scenarioMetrics[0];

  const historicalAveragePrice = rowSoldQuantity > 0 ? rowGrossRevenue / rowSoldQuantity : 0;
  const averagePrice = (activeScenario?.priceAfterWb ?? 0) > 0
    ? (activeScenario?.priceAfterWb ?? 0)
    : historicalAveragePrice;
  const tradeScheme: TradeScheme = targetManualFields.tradeScheme === 'fbs' ? 'fbs' : 'fbw';
  const fallbackCommissionPercent = rowGrossRevenue > 0 ? (rowCommission / rowGrossRevenue) * 100 : 0;
  const rowCategoryCommissionPercentFbw = toNumber(targetRow?.categoryCommissionPercentFbw ?? targetRow?.categoryCommissionPercent);
  const rowCategoryCommissionPercentFbs = toNumber(targetRow?.categoryCommissionPercentFbs);
  const rowCategoryCommissionPercentByScheme = tradeScheme === 'fbs'
    ? rowCategoryCommissionPercentFbs
    : rowCategoryCommissionPercentFbw;
  const commissionPercent = rowCategoryCommissionPercentByScheme > 0
    ? rowCategoryCommissionPercentByScheme
    : fallbackCommissionPercent;
  const projectedRevenueRaw = (activeScenario?.priceBeforeWbDiscount ?? 0) > 0
    ? (activeScenario?.priceBeforeWbDiscount ?? 0)
    : 0;
  const projectedRevenue = roundCurrency(projectedRevenueRaw);
  const projectedCommissionTotal = projectedRevenue > 0
    ? roundCurrency(projectedRevenue * (commissionPercent / 100))
    : 0;
  // === ИЛ (Индекс Локализации, КТР) — МНОЖИТЕЛЬ к прямой логистике ===
  // WB 2026-03-23: forward = (база+extra×additional) × коэф_склада × ИЛ.
  // Auto от WB localizationPercent по официальной сетке КТР (0.5..2.0),
  // ручной override через legacy-поле `localityIndexPercent`.
  // FBS → ИЛ = 1 (не применяется).
  const localityIndexManual = normalizeLocalityIndexMultiplier(toNumber(targetManualFields.localityIndexPercent));
  const rowLocalizationPercent = targetRow?.localizationPercent != null && Number.isFinite(Number(targetRow.localizationPercent))
    ? Number(targetRow.localizationPercent)
    : null;
  const localityIndexAuto = rowLocalizationPercent != null
    ? resolveLocalityIndexMultiplierFromLocalization(rowLocalizationPercent)
    : 1;
  const hasManualLocalityIndex = hasManualValue(targetManualFields.localityIndexPercent);
  const localityMultiplierRaw = hasManualLocalityIndex ? localityIndexManual : localityIndexAuto;
  const localityMultiplier = tradeScheme === 'fbw' ? localityMultiplierRaw : 1;
  const localityIndexPercent = tradeScheme === 'fbw' ? localityMultiplier : 0;
  const localityIndexSource: 'manual' | 'auto' | 'none' =
    tradeScheme !== 'fbw'
      ? 'none'
      : hasManualLocalityIndex
        ? 'manual'
        : rowLocalizationPercent != null
          ? 'auto'
          : 'none';
  const logisticsPerUnit = avgWbLogisticsPerUnit * localityMultiplier;

  // === ИРП (Индекс Распределения Продаж) — surcharge from price ===
  // WB 2026-03-23: дополнительная надбавка `priceBeforeWbDiscount × ИРП %`.
  // Auto от WB localizationPercent по сетке ИРП/КРП, ручной ввод — override.
  // FBS → ИРП = 0.
  const irpPercentManual = clampPercent(toNumber(targetManualFields.irpPercent));
  const irpPercentAuto = rowLocalizationPercent != null
    ? resolveIrpFromLocalization(rowLocalizationPercent)
    : 0;
  const hasManualIrp = hasManualValue(targetManualFields.irpPercent) && irpPercentManual > 0;
  const irpPercentRaw = hasManualIrp ? irpPercentManual : irpPercentAuto;
  const irpPercent = tradeScheme === 'fbw' ? irpPercentRaw : 0;
  const irpSource: 'manual' | 'auto' | 'none' =
    tradeScheme !== 'fbw' || irpPercent === 0
      ? 'none'
      : hasManualIrp
        ? 'manual'
        : 'auto';
  const irpSurcharge = irpPercent > 0 && projectedRevenue > 0
    ? roundCurrency(projectedRevenue * (irpPercent / 100))
    : 0;

  const reverseLogisticsPerUnit = avgWbReverseLogisticsPerUnit;
  const storagePerUnit = avgWbStoragePerUnit;
  const turnoverDays = Math.max(toNumber(targetManualFields.turnoverDays), 0);
  const purchaseQtyTotal = toNumber(targetManualFields.purchaseQtyTotal) > 0
    ? toNumber(targetManualFields.purchaseQtyTotal)
    : rowSoldQuantity;
  // computeWbLogisticsWithBuyout: forward + (1−выкуп) × reverse.
  // ИРП-надбавка добавляется поверх (отдельная статья от цены).
  const logisticsBuyoutPercent = activeScenario?.buyoutSource === 'none'
    ? 100
    : activeScenario?.buyoutPercent ?? 100;
  const logisticsBaseWithBuyout = computeWbLogisticsWithBuyout(
    logisticsPerUnit,
    reverseLogisticsPerUnit,
    logisticsBuyoutPercent,
  );
  const logisticsTotalComputed = roundCurrency(logisticsBaseWithBuyout + irpSurcharge);
  const storageTotalComputed = roundCurrency(storagePerUnit * turnoverDays);
  const acquiringBasePerUnit = projectedRevenue;
  const acquiring = acquiringBasePerUnit > 0 ? roundCurrency(acquiringBasePerUnit * 0.03) : 0;
  const marketplacePlusStorageTotal = roundCurrency(projectedCommissionTotal + logisticsTotalComputed + storageTotalComputed + acquiring);
  const toSettlementAccount = roundCurrency(projectedRevenue - marketplacePlusStorageTotal);
  const taxPercent = defaultTaxPercent != null ? defaultTaxPercent : clampPercent(toNumber(targetManualFields.taxPercent));
  const taxBasePerUnit = (activeScenario?.priceAfterWb ?? 0) > 0
    ? roundCurrency(activeScenario?.priceAfterWb ?? 0)
    : (projectedRevenue > 0 ? projectedRevenue : 0);
  const taxRub = taxBasePerUnit > 0 ? roundCurrency(taxBasePerUnit * (taxPercent / 100)) : 0;
  const revenueAfterTax = roundCurrency(toSettlementAccount - taxRub);
  const marketingInternalManual = toNumber(targetManualFields.marketingInternal);
  const marketingExternal = toNumber(targetManualFields.marketingExternal);
  const contentCost = toNumber(targetManualFields.contentCost);
  const otherCosts = toNumber(targetManualFields.otherCosts);
  const operatingExpenses = fullCost;
  const computedProfit = roundCurrency(revenueAfterTax - operatingExpenses);
  const netProfitComputed = Number.isFinite(computedProfit) ? computedProfit : roundCurrency(rowNetProfit);
  const markupBasePrice = projectedRevenue;
  const markupFromPriceToSppRatio = fullCost > 0 && markupBasePrice > 0
    ? (markupBasePrice / fullCost)
    : 0;
  const marginPercent = markupBasePrice > 0 ? (netProfitComputed / markupBasePrice) * 100 : 0;
  const profitabilityPercent = fullCost > 0 ? (netProfitComputed / fullCost) * 100 : 0;
  const grossProfitPerUnit = netProfitComputed;
  const checkZero = roundCurrency(revenueAfterTax - (netProfitComputed + operatingExpenses));
  const marketplacePercentTotal = projectedRevenue > 0
    ? (marketplacePlusStorageTotal / projectedRevenue) * 100
    : 0;
  const plannedOrders = (activeScenario?.buyoutPercent ?? 0) > 0
    ? purchaseQtyTotal / ((activeScenario?.buyoutPercent ?? 0) / 100)
    : 0;
  const batchRevenue = purchaseQtyTotal > 0 && projectedRevenue > 0 ? roundCurrency(projectedRevenue * purchaseQtyTotal) : 0;
  const batchRevenueInOrders = plannedOrders > 0 && projectedRevenue > 0 ? roundCurrency(projectedRevenue * plannedOrders) : 0;
  const batchCostPriceTotal = purchaseQtyTotal > 0 ? roundCurrency(rowCostPrice * purchaseQtyTotal) : 0;
  const batchDeliveryToFfTotal = purchaseQtyTotal > 0 ? roundCurrency(toNumber(targetManualFields.deliveryToFf) * purchaseQtyTotal) : 0;
  const batchPackagingTotal = purchaseQtyTotal > 0 ? roundCurrency(toNumber(targetManualFields.packagingMaterial) * purchaseQtyTotal) : 0;
  const batchFulfillmentTotal = purchaseQtyTotal > 0 ? roundCurrency(toNumber(targetManualFields.fulfillment) * purchaseQtyTotal) : 0;
  const batchDeliveryToMarketplaceTotal = purchaseQtyTotal > 0 ? roundCurrency(deliveryToMarketplace * purchaseQtyTotal) : 0;
  const batchCommissionTotal = purchaseQtyTotal > 0 ? roundCurrency(projectedCommissionTotal * purchaseQtyTotal) : 0;
  const batchLogisticsTotal = purchaseQtyTotal > 0 ? roundCurrency(logisticsTotalComputed * purchaseQtyTotal) : 0;
  const batchStorageTotal = purchaseQtyTotal > 0 ? roundCurrency(storageTotalComputed * purchaseQtyTotal) : 0;
  const batchAcquiringTotal = purchaseQtyTotal > 0 ? roundCurrency(acquiringBasePerUnit * purchaseQtyTotal * 0.03) : 0;
  const batchMarketplacePlusStorageTotal = roundCurrency(batchCommissionTotal + batchLogisticsTotal + batchStorageTotal + batchAcquiringTotal);
  const batchToSettlementAccount = roundCurrency(batchRevenue - batchMarketplacePlusStorageTotal);
  const batchTaxBase = purchaseQtyTotal > 0 && taxBasePerUnit > 0
    ? roundCurrency(taxBasePerUnit * purchaseQtyTotal)
    : 0;
  const batchTaxRub = batchTaxBase > 0 ? roundCurrency(batchTaxBase * (taxPercent / 100)) : 0;
  const batchRevenueAfterTax = roundCurrency(batchToSettlementAccount - batchTaxRub);
  const batchOperatingExpensesBeforeMarketing = roundCurrency(batchCostPriceTotal
    + batchDeliveryToFfTotal
    + batchPackagingTotal
    + batchFulfillmentTotal
    + batchDeliveryToMarketplaceTotal);
  const batchMarginalProfit = roundCurrency(batchRevenueAfterTax - batchOperatingExpensesBeforeMarketing);
  const batchLogisticsToSppPercent = batchRevenue > 0 ? (batchLogisticsTotal / batchRevenue) * 100 : 0;
  const batchCostTotal = roundCurrency(fullCost * purchaseQtyTotal);
  const batchMarketplacePercentTotal = batchRevenue > 0
    ? (batchMarketplacePlusStorageTotal / batchRevenue) * 100
    : 0;
  const manualDrrPercent = clampPercent(toNumber(targetManualFields.drrPercent));
  const hasManualDrrPercent = hasManualValue(targetManualFields.drrPercent);
  const marketingInternal = hasManualDrrPercent && batchRevenueInOrders > 0
    ? roundCurrency(batchRevenueInOrders * (manualDrrPercent / 100))
    : marketingInternalManual;
  const drrPercent = hasManualDrrPercent
    ? manualDrrPercent
    : batchRevenueInOrders > 0
      ? (marketingInternal / batchRevenueInOrders) * 100
      : 0;
  // ДРР в выкупах: same ad-spend numerator, but base = batchRevenue (revenue
  // from bought-out units only). External marketing/content/other costs are
  // operational budget items, not advertising DRR.
  const drrPercentBuyouts = batchRevenue > 0
    ? (marketingInternal / batchRevenue) * 100
    : 0;
  const marketingTotal = roundCurrency(marketingInternal + marketingExternal + contentCost + otherCosts);
  const batchGrossProfit = roundCurrency(batchMarginalProfit - marketingTotal);
  const batchProfitabilityPercent = batchCostTotal > 0 ? (batchGrossProfit / batchCostTotal) * 100 : 0;
  const batchGrossProfitPerUnit = purchaseQtyTotal > 0 ? roundCurrency(batchGrossProfit / purchaseQtyTotal) : 0;
  const cpoPlan = plannedOrders > 0 ? roundCurrency(marketingInternal / plannedOrders) : 0;
  const cpsPlan = purchaseQtyTotal > 0 ? roundCurrency(marketingInternal / purchaseQtyTotal) : 0;

  return {
    soldQuantity: rowSoldQuantity,
    grossRevenue: rowGrossRevenue,
    projectedRevenue,
    commission: projectedCommissionTotal,
    netProfit: netProfitComputed,
    volumeLiters: rowVolumeLiters,
    deliveryToMarketplaceComputed: deliveryToMarketplace,
    fullCost,
    avgWbLogisticsPerUnit,
    avgWbStoragePerUnit,
    averagePrice,
    sellerPriceBeforeDiscount: activeScenario?.sellerPriceBeforeDiscount ?? 0,
    priceBeforeWbDiscount: activeScenario?.priceBeforeWbDiscount ?? 0,
    priceAfterWb: activeScenario?.priceAfterWb ?? 0,
    sellerDiscountPercent: activeScenario?.sellerDiscountPercent ?? 0,
    wbDiscountPercent: activeScenario?.wbDiscountPercent ?? 0,
    buyoutManualPercent: activeScenario?.buyoutManualPercent ?? 0,
    buyoutAutoPercent: activeScenario?.buyoutAutoPercent ?? 0,
    buyoutHistoryDays: activeScenario?.buyoutHistoryDays ?? rowBuyoutHistoryDays,
    buyoutSource: activeScenario?.buyoutSource ?? 'none',
    buyoutPercent: activeScenario?.buyoutPercent ?? 0,
    buyoutOrderCount: rowBuyoutAutoDiagnostics.orderCount,
    buyoutBuyoutCount: rowBuyoutAutoDiagnostics.buyoutCount,
    buyoutCancelCount: rowBuyoutAutoDiagnostics.cancelCount,
    buyoutReturnCount: rowBuyoutAutoDiagnostics.returnCount,
    buyoutClosedCount: rowBuyoutAutoDiagnostics.closedCount,
    buyoutOpenCount: rowBuyoutAutoDiagnostics.openCount,
    buyoutOpenShare: rowBuyoutAutoDiagnostics.openShare,
    buyoutAutoReason: rowBuyoutAutoDiagnostics.reason,
    buyoutAutoWarning: rowBuyoutAutoWarning,
    irpPercent,
    irpSource,
    irpSurcharge,
    localityIndexPercent,
    localityIndexSource,
    localizationPercent: rowLocalizationPercent,
    commissionPercent,
    tradeScheme,
    logisticsPerUnit,
    reverseLogisticsPerUnit,
    returnToSellerPerUnit: avgWbReturnToSellerPerUnit,
    logisticsTotalComputed,
    storagePerUnit,
    storageTotalComputed,
    markupFromPriceToSppRatio,
    batchRevenue,
    batchRevenueInOrders,
    batchCostPriceTotal,
    batchCostTotal,
    batchDeliveryToFfTotal,
    batchPackagingTotal,
    batchFulfillmentTotal,
    batchDeliveryToMarketplaceTotal,
    batchCommissionTotal,
    batchLogisticsTotal,
    batchStorageTotal,
    batchAcquiringTotal,
    batchLogisticsToSppPercent,
    batchMarketplacePlusStorageTotal,
    batchToSettlementAccount,
    batchTaxRub,
    batchRevenueAfterTax,
    batchMarginalProfit,
    batchGrossProfit,
    batchProfitabilityPercent,
    batchMarketplacePercentTotal,
    batchGrossProfitPerUnit,
    acquiring,
    marketplacePlusStorageTotal,
    toSettlementAccount,
    taxPercent,
    taxRub,
    revenueAfterTax,
    purchaseQtyTotal,
    marketingInternal,
    marketingExternal,
    contentCost,
    otherCosts,
    drrPercent,
    drrPercentBuyouts,
    cpoPlan,
    cpsPlan,
    turnoverDays,
    checkZero,
    marketplacePercentTotal,
    marginPercent,
    profitabilityPercent,
    grossProfitPerUnit,
  };
}
