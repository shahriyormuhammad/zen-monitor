import { DEFAULT_WAREHOUSES, WB_STORAGE_BASE_UP_TO_ONE_LITER } from '../constants';
import { normalizeWarehouseKey, parseCoefExprToMultiplier, toNumber } from '../helpers';
import {
  getWbLogisticsBaseUpToOneLiter,
  pickAcceptanceTariffByWarehouseLabel,
  pickReturnTariffByWarehouseLabel,
  resolveReverseLogisticsForVolume,
  resolveReturnTariffOfficeForVolume,
  type AcceptanceTariffCandidate,
  type ReturnTariffCandidate,
} from '../tariff-helpers';
import type { ManualFields } from '../types';

export type WarehouseRateRow = {
  warehouseId: string;
  label: string;
  hasTariff: boolean;
  tariffWarehouseName: string | null;
  returnTariffWarehouseName: string | null;
  returnTariffGeoName: string | null;
  isUpToOneLiter: boolean;
  /** Forward delivery coef as multiplier (e.g. 1.05 for 105%). 0 if no tariff. */
  deliveryCoefMultiplier: number;
  /** Storage coef as multiplier. 0 if no tariff. */
  storageCoefMultiplier: number;
  /** Forward base for the SKU's volume tier (₽). For ≤1 л: tier base.
   * For >1 л: deliveryBaseLiter from WB (per-litre baseline). */
  forwardBase: number;
  /** Forward additional litre rate (₽) — only meaningful for >1 л. */
  forwardAdditionalLiter: number;
  /** Storage base for ≤1 л (WB_STORAGE_BASE_UP_TO_ONE_LITER) or storageBaseLiter for >1 л. */
  storageBase: number;
  /** Storage additional litre rate — only meaningful for >1 л. */
  storageAdditionalLiter: number;
  /** Reverse base for the SKU's volume (₽). 32 / 46 + 14×extra etc. */
  reverseBase: number;
  reverseAdditionalLiter: number;
  reverseSource: 'wb_volume' | null;
  /** Return-to-seller base + per-litre rate from WB tariffs/return. */
  returnToSellerBase: number;
  returnToSellerLiter: number;
  /** Extra litres beyond 1 л (used in >1 л formulas). */
  extraLiters: number;
  /** Logistics to customer per 1 unit (₽). */
  wbLogisticsPerUnit: number;
  /** Reverse logistics from customer per 1 unit (₽). */
  wbReverseLogisticsPerUnit: number;
  /** Return-to-seller cost per 1 unit (₽). */
  wbReturnToSellerPerUnit: number;
  /** Source variant of return tariff (sup / srg / kgt). */
  wbReturnToSellerSource: 'sup' | 'srg' | 'kgt' | null;
  /** Monthly storage per 1 unit (₽/day). */
  wbStoragePerUnit: number;
};

export type WarehouseRatesAggregate = {
  rates: WarehouseRateRow[];
  avgWbLogisticsPerUnit: number;
  avgWbReverseLogisticsPerUnit: number;
  avgWbReturnToSellerPerUnit: number;
  avgWbStoragePerUnit: number;
};

/**
 * Compute per-warehouse WB tariff rates for the SKU given its volume and the
 * user's selected warehouse list. Pure — no React, safe to memoize / call
 * inside render.
 *
 * Mirrors the legacy `selectedWarehouseRates` block in
 * `UnitEconomicsTemplateTable.tsx` (~lines 2257-2330).
 */
export function computeWarehouseRates(
  volumeLiters: number,
  manualFields: ManualFields,
  acceptanceTariffMap: Map<string, AcceptanceTariffCandidate>,
  returnTariffMap: Map<string, ReturnTariffCandidate>,
): WarehouseRatesAggregate {
  const labelMap = new Map<string, string>();
  for (const w of DEFAULT_WAREHOUSES) labelMap.set(w.id, w.label);
  for (const w of manualFields.customWarehouses) labelMap.set(w.id, w.label);

  const extraLiters = Math.max(volumeLiters - 1, 0);
  const isUpToOneLiter = volumeLiters > 0 && volumeLiters <= 1;
  const logisticsBaseUpToOneLiter = isUpToOneLiter
    ? getWbLogisticsBaseUpToOneLiter(volumeLiters)
    : 0;

  const rates: WarehouseRateRow[] = manualFields.selectedWarehouses.map((warehouseId) => {
    const label = labelMap.get(warehouseId) ?? warehouseId;
    const normalizedLabel = normalizeWarehouseKey(label);

    const tariff = pickAcceptanceTariffByWarehouseLabel(acceptanceTariffMap, normalizedLabel);
    const returnTariff = pickReturnTariffByWarehouseLabel(returnTariffMap, normalizedLabel);

    const deliveryCoefMultiplier = parseCoefExprToMultiplier(toNumber(tariff?.deliveryCoef));
    const storageCoefMultiplier = parseCoefExprToMultiplier(toNumber(tariff?.storageCoef));
    const deliveryBaseLiter = toNumber(tariff?.deliveryBaseLiter);
    const deliveryAdditionalLiter = toNumber(tariff?.deliveryAdditionalLiter);
    const storageBaseLiter = toNumber(tariff?.storageBaseLiter);
    const storageAdditionalLiter = toNumber(tariff?.storageAdditionalLiter);

    // Forward for ≤1 л uses local WB base tiers and applies the warehouse
    // coefficient. For >1 л WB tariff endpoints already return base/liter
    // values with the coefficient applied.
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
          ? storageBaseLiter + storageAdditionalLiter * extraLiters
          : 0))
      : 0;

    const reverseLogistics = resolveReverseLogisticsForVolume(tariff, volumeLiters);
    const wbReverseLogisticsPerUnit = reverseLogistics.total;

    const returnOffice = resolveReturnTariffOfficeForVolume(returnTariff, volumeLiters);
    const wbReturnToSellerPerUnit = returnOffice.base > 0
      ? (isUpToOneLiter
        ? returnOffice.base
        : returnOffice.base + returnOffice.liter * extraLiters)
      : 0;

    const hasTariff =
      wbLogisticsPerUnit > 0 ||
      wbStoragePerUnit > 0 ||
      wbReverseLogisticsPerUnit > 0;

    return {
      warehouseId,
      label,
      hasTariff,
      tariffWarehouseName: tariff?.warehouseName ?? null,
      returnTariffWarehouseName: returnTariff?.warehouseName ?? null,
      returnTariffGeoName: returnTariff?.geoName ?? null,
      isUpToOneLiter,
      deliveryCoefMultiplier,
      storageCoefMultiplier,
      forwardBase: isUpToOneLiter ? logisticsBaseUpToOneLiter : deliveryBaseLiter,
      forwardAdditionalLiter: deliveryAdditionalLiter,
      storageBase: isUpToOneLiter ? WB_STORAGE_BASE_UP_TO_ONE_LITER : storageBaseLiter,
      storageAdditionalLiter,
      reverseBase: reverseLogistics.base,
      reverseAdditionalLiter: reverseLogistics.liter,
      reverseSource: reverseLogistics.source,
      returnToSellerBase: returnOffice.base,
      returnToSellerLiter: returnOffice.liter,
      extraLiters,
      wbLogisticsPerUnit,
      wbReverseLogisticsPerUnit,
      wbReturnToSellerPerUnit,
      wbReturnToSellerSource: returnOffice.source,
      wbStoragePerUnit,
    };
  });

  const avg = (selector: (r: WarehouseRateRow) => number) => {
    const positives = rates.map(selector).filter((v) => v > 0);
    if (positives.length === 0) return 0;
    return positives.reduce((sum, v) => sum + v, 0) / positives.length;
  };

  return {
    rates,
    avgWbLogisticsPerUnit: avg((r) => r.wbLogisticsPerUnit),
    avgWbReverseLogisticsPerUnit: avg((r) => r.wbReverseLogisticsPerUnit),
    avgWbReturnToSellerPerUnit: avg((r) => r.wbReturnToSellerPerUnit),
    avgWbStoragePerUnit: avg((r) => r.wbStoragePerUnit),
  };
}
