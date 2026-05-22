import { toNumber } from '@/components/economics/helpers';
import type { ManualFields, UnitTemplateRow } from '@/components/economics/types';

export function computeDeliveryToWb(manualFields: ManualFields): number {
  const selectedCosts = manualFields.selectedWarehouses
    .map((warehouseId) => toNumber(manualFields.warehouseCosts[warehouseId]))
    .filter((value) => value > 0);
  if (selectedCosts.length === 0) return 0;
  return selectedCosts.reduce((sum, value) => sum + value, 0) / selectedCosts.length;
}

export function resolvePurchaseCost(row: UnitTemplateRow, manualFields: ManualFields): number {
  const manualPurchase = toNumber(manualFields.costPrice);
  if (manualPurchase > 0) return manualPurchase;

  const configuredPurchase = toNumber(row.purchasePrice);
  if (configuredPurchase > 0) return configuredPurchase;

  const hasDetailedCosts = toNumber(manualFields.deliveryToFf) > 0
    || toNumber(manualFields.packagingMaterial) > 0
    || toNumber(manualFields.fulfillment) > 0
    || computeDeliveryToWb(manualFields) > 0;

  return hasDetailedCosts ? 0 : toNumber(row.costPrice);
}

export function computeCostTotal(row: UnitTemplateRow, manualFields: ManualFields): number {
  return resolvePurchaseCost(row, manualFields)
    + toNumber(manualFields.deliveryToFf)
    + toNumber(manualFields.packagingMaterial)
    + toNumber(manualFields.fulfillment)
    + computeDeliveryToWb(manualFields);
}

export function isCostComplete(row: UnitTemplateRow, manualFields: ManualFields): boolean {
  return computeCostTotal(row, manualFields) > 0 && resolvePurchaseCost(row, manualFields) > 0;
}

export function copyCostFieldsToManualFields(source: ManualFields, target: ManualFields): ManualFields {
  return {
    ...target,
    costPrice: source.costPrice,
    deliveryToFf: source.deliveryToFf,
    packagingMaterial: source.packagingMaterial,
    fulfillment: source.fulfillment,
    selectedWarehouses: [...source.selectedWarehouses],
    warehouseCosts: { ...source.warehouseCosts },
    customWarehouses: source.customWarehouses.map((warehouse) => ({ ...warehouse })),
  };
}
