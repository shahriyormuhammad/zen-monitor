import { parseManualFieldsFromUnknown } from '@/components/economics/manual-fields-io';
import type { ManualFields } from '@/components/economics/types';

export const PROCIFRY_DELIVERY_TO_WB_WAREHOUSE_ID = 'procifry_delivery_to_wb';
export const PROCIFRY_DELIVERY_TO_WB_WAREHOUSE_LABEL = 'Procifry: доставка до ВБ';

export type CostUpdateItem = {
  nmId: number;
  name: string | null;
  purchasePrice: number | null;
  deliveryToFF: number | null;
  deliveryToWB: number | null;
  packaging: number | null;
  fulfillment: number | null;
  totalCost: number | null;
};

export type CostValues = {
  purchasePrice: number | null;
  deliveryToFF: number | null;
  deliveryToWB: number | null;
  packaging: number | null;
  fulfillment: number | null;
  totalCost: number | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function pick(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== '') {
      return source[key];
    }
  }
  return null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().replace(/\s+/g, '').replace(',', '.');
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function extractNmIdFromText(value: unknown): number | null {
  const text = toText(value);
  if (!text) return null;

  const explicitMatch = text.match(/\b(?:nmId|nm_id|артикул\s*WB|sku)\D{0,12}(\d{5,12})\b/i);
  const parenthesizedMatch = text.match(/\((\d{5,12})\)/);
  const plainMatch = text.match(/\b(\d{8,12})\b/);
  const candidate = explicitMatch?.[1] ?? parenthesizedMatch?.[1] ?? plainMatch?.[1] ?? null;
  if (!candidate) return null;

  const parsed = Number(candidate);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function resolveNmId(raw: Record<string, unknown>, index: number) {
  const direct = toNumber(pick(raw, ['nmId', 'nm_id', 'nmid', 'sku', 'article', 'articleId']));
  if (direct && direct > 0 && Number.isInteger(direct)) {
    return direct;
  }

  const fromText = extractNmIdFromText(pick(raw, ['name', 'title', 'productName', 'description', 'vendorCode', 'vendor_code']));
  if (fromText) {
    return fromText;
  }

  throw new Error(`items[${index}].nmId must be a positive integer`);
}

export function formatManualDecimal(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '';
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function normalizeCostUpdateItem(raw: unknown, index: number): CostUpdateItem {
  if (!isRecord(raw)) {
    throw new Error(`items[${index}] must be an object`);
  }

  const nmId = resolveNmId(raw, index);

  return {
    nmId,
    name: toText(pick(raw, ['name', 'title', 'vendorCode', 'vendor_code'])),
    purchasePrice: toNumber(pick(raw, ['purchasePrice', 'purchase_price', 'costPrice', 'cost_price', 'baseCost'])),
    deliveryToFF: toNumber(pick(raw, ['deliveryToFF', 'deliveryToFf', 'delivery_to_ff', 'deliveryFromChina'])),
    deliveryToWB: toNumber(pick(raw, ['deliveryToWB', 'deliveryToWb', 'delivery_to_wb', 'deliveryToMarketplace'])),
    packaging: toNumber(pick(raw, ['packaging', 'packagingMaterial', 'packaging_material'])),
    fulfillment: toNumber(pick(raw, ['fulfillment', 'ff', 'fulfillmentCost'])),
    totalCost: toNumber(pick(raw, ['totalCost', 'total_cost', 'fullCost', 'full_cost'])),
  };
}

export function parseCostUpdateItems(payload: unknown): CostUpdateItem[] {
  const rawItems = isRecord(payload) && Array.isArray(payload.items)
    ? payload.items
    : [payload];

  return rawItems.map((item, index) => normalizeCostUpdateItem(item, index));
}

function sumCostParts(values: Omit<CostValues, 'totalCost'>): number | null {
  const parts = [
    values.purchasePrice,
    values.deliveryToFF,
    values.deliveryToWB,
    values.packaging,
    values.fulfillment,
  ].filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

  if (parts.length === 0) return null;
  return Math.round(parts.reduce((sum, value) => sum + value, 0) * 100) / 100;
}

function computeDeliveryToWb(manualFields: ManualFields): number | null {
  const selectedCosts = manualFields.selectedWarehouses
    .map((warehouseId) => toNumber(manualFields.warehouseCosts[warehouseId]))
    .filter((value): value is number => value !== null);

  if (selectedCosts.length === 0) return null;
  return Math.round((selectedCosts.reduce((sum, value) => sum + value, 0) / selectedCosts.length) * 100) / 100;
}

export function getCurrentCostValues(
  manualPayload: unknown,
  latestCatalogCostPrice: number | null,
): CostValues {
  const manualFields = parseManualFieldsFromUnknown(manualPayload);
  const purchasePrice = toNumber(manualFields.costPrice) ?? latestCatalogCostPrice;
  const values = {
    purchasePrice,
    deliveryToFF: toNumber(manualFields.deliveryToFf),
    deliveryToWB: computeDeliveryToWb(manualFields),
    packaging: toNumber(manualFields.packagingMaterial),
    fulfillment: toNumber(manualFields.fulfillment),
  };

  return {
    ...values,
    totalCost: sumCostParts(values),
  };
}

export function getProposedCostValues(item: CostUpdateItem): CostValues {
  const values = {
    purchasePrice: item.purchasePrice,
    deliveryToFF: item.deliveryToFF,
    deliveryToWB: item.deliveryToWB,
    packaging: item.packaging,
    fulfillment: item.fulfillment,
  };

  return {
    ...values,
    totalCost: item.totalCost ?? sumCostParts(values),
  };
}

export function applyCostUpdateToManualFields(
  manualPayload: unknown,
  item: CostUpdateItem,
): ManualFields {
  const current = parseManualFieldsFromUnknown(manualPayload);
  const next: ManualFields = {
    ...current,
    selectedWarehouses: [...current.selectedWarehouses],
    warehouseCosts: { ...current.warehouseCosts },
    customWarehouses: current.customWarehouses.map((warehouse) => ({ ...warehouse })),
    priceScenarios: {
      excellent: { ...current.priceScenarios.excellent },
      good: { ...current.priceScenarios.good },
      average: { ...current.priceScenarios.average },
      poor: { ...current.priceScenarios.poor },
    },
  };

  if (item.purchasePrice !== null) next.costPrice = formatManualDecimal(item.purchasePrice);
  if (item.deliveryToFF !== null) next.deliveryToFf = formatManualDecimal(item.deliveryToFF);
  if (item.packaging !== null) next.packagingMaterial = formatManualDecimal(item.packaging);
  if (item.fulfillment !== null) next.fulfillment = formatManualDecimal(item.fulfillment);

  if (item.deliveryToWB !== null) {
    if (!next.customWarehouses.some((warehouse) => warehouse.id === PROCIFRY_DELIVERY_TO_WB_WAREHOUSE_ID)) {
      next.customWarehouses.push({
        id: PROCIFRY_DELIVERY_TO_WB_WAREHOUSE_ID,
        label: PROCIFRY_DELIVERY_TO_WB_WAREHOUSE_LABEL,
      });
    }
    next.selectedWarehouses = [PROCIFRY_DELIVERY_TO_WB_WAREHOUSE_ID];
    next.warehouseCosts[PROCIFRY_DELIVERY_TO_WB_WAREHOUSE_ID] = formatManualDecimal(item.deliveryToWB);
  }

  return next;
}
