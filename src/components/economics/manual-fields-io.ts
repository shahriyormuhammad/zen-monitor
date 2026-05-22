/**
 * Read/write/parse helpers for `ManualFields` — the per-nmId, per-tenant
 * payload of user-entered values in the Unit Economics screen.
 *
 * Storage tiers (in priority order):
 *   1. Server table `unit_economics_manual_inputs` (authoritative).
 *   2. Browser `localStorage` (offline cache, pre-fills before server load).
 *
 * `parseManualFieldsPayload` is the safe-by-construction parser used by both
 * tiers — it tolerates missing/extra fields and clamps the data to a known
 * shape so downstream calculations never crash on malformed inputs.
 */

import {
  DEFAULT_ACTIVE_PRICE_SCENARIO_ID,
  DEFAULT_WAREHOUSES,
  EMPTY_MANUAL_FIELDS,
  MAX_WAREHOUSES,
  PRICE_SCENARIO_IDS,
  createEmptyPriceScenarios,
} from './constants';
import { normalizeDecimalInput, toManualStorageKey } from './helpers';
import type { ManualFields, PriceScenarioDraft, PriceScenarioId } from './types';

function isPriceScenarioId(value: string): value is PriceScenarioId {
  return PRICE_SCENARIO_IDS.includes(value as PriceScenarioId);
}

/**
 * Parse a partial ManualFields payload into a complete, typed instance.
 * Unknown fields are dropped; missing fields use safe defaults; warehouse ids
 * that aren't in the user's known set (default + custom) are stripped.
 */
export function parseManualFieldsPayload(payload: Partial<ManualFields>): ManualFields {
  const parsed = payload;
  const selectedWarehouses = Array.isArray(parsed.selectedWarehouses)
    ? parsed.selectedWarehouses
      .filter((value): value is string => typeof value === 'string')
      .filter((value, index, array) => array.indexOf(value) === index)
      .slice(0, MAX_WAREHOUSES)
    : [];

  const customWarehouses = Array.isArray(parsed.customWarehouses)
    ? parsed.customWarehouses
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }
        const candidate = item as Record<string, unknown>;
        const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
        const label = typeof candidate.label === 'string' ? candidate.label.trim() : '';
        if (!id || !label) {
          return null;
        }
        return { id, label };
      })
      .filter((item): item is { id: string; label: string } => item !== null)
    : [];

  const warehouseOptionIds = new Set([
    ...DEFAULT_WAREHOUSES.map((item) => item.id),
    ...customWarehouses.map((item) => item.id),
  ]);

  const selectedWarehousesFiltered = selectedWarehouses.filter((warehouseId) => warehouseOptionIds.has(warehouseId));

  const warehouseCosts: Record<string, string> = {};
  if (parsed.warehouseCosts && typeof parsed.warehouseCosts === 'object') {
    for (const [key, value] of Object.entries(parsed.warehouseCosts)) {
      if (warehouseOptionIds.has(key) && typeof value === 'string') {
        warehouseCosts[key] = normalizeDecimalInput(value);
      }
    }
  }

  const rawPriceScenarios = parsed.priceScenarios && typeof parsed.priceScenarios === 'object'
    ? parsed.priceScenarios as Partial<Record<PriceScenarioId, Partial<PriceScenarioDraft>>>
    : undefined;
  const priceScenarios = createEmptyPriceScenarios();
  for (const scenarioId of PRICE_SCENARIO_IDS) {
    const candidate = rawPriceScenarios?.[scenarioId];
    if (!candidate || typeof candidate !== 'object') {
      continue;
    }
    priceScenarios[scenarioId] = {
      sellerPriceBeforeDiscount: typeof candidate.sellerPriceBeforeDiscount === 'string'
        ? normalizeDecimalInput(candidate.sellerPriceBeforeDiscount)
        : '',
      sellerDiscount: typeof candidate.sellerDiscount === 'string'
        ? normalizeDecimalInput(candidate.sellerDiscount)
        : '',
      wbDiscount: typeof candidate.wbDiscount === 'string'
        ? normalizeDecimalInput(candidate.wbDiscount)
        : '',
      buyoutPercent: typeof candidate.buyoutPercent === 'string'
        ? normalizeDecimalInput(candidate.buyoutPercent)
        : '',
    };
  }

  const parsedActivePriceScenarioId = typeof parsed.activePriceScenarioId === 'string'
    ? parsed.activePriceScenarioId.trim()
    : '';
  const activePriceScenarioId = isPriceScenarioId(parsedActivePriceScenarioId)
    ? parsedActivePriceScenarioId
    : DEFAULT_ACTIVE_PRICE_SCENARIO_ID;
  const tradeScheme = parsed.tradeScheme === 'fbs' ? 'fbs' : 'fbw';

  return {
    costPrice: typeof parsed.costPrice === 'string' ? normalizeDecimalInput(parsed.costPrice) : '',
    deliveryToFf: typeof parsed.deliveryToFf === 'string' ? normalizeDecimalInput(parsed.deliveryToFf) : '',
    packagingMaterial: typeof parsed.packagingMaterial === 'string' ? normalizeDecimalInput(parsed.packagingMaterial) : '',
    fulfillment: typeof parsed.fulfillment === 'string' ? normalizeDecimalInput(parsed.fulfillment) : '',
    irpPercent: typeof parsed.irpPercent === 'string' ? normalizeDecimalInput(parsed.irpPercent) : '',
    localityIndexPercent: typeof parsed.localityIndexPercent === 'string' ? normalizeDecimalInput(parsed.localityIndexPercent) : '',
    purchaseQtyTotal: typeof parsed.purchaseQtyTotal === 'string' ? normalizeDecimalInput(parsed.purchaseQtyTotal) : '',
    taxPercent: typeof parsed.taxPercent === 'string' ? normalizeDecimalInput(parsed.taxPercent) : '',
    turnoverDays: typeof parsed.turnoverDays === 'string' ? normalizeDecimalInput(parsed.turnoverDays) : '',
    drrPercent: typeof parsed.drrPercent === 'string' ? normalizeDecimalInput(parsed.drrPercent) : '',
    marketingInternal: typeof parsed.marketingInternal === 'string' ? normalizeDecimalInput(parsed.marketingInternal) : '',
    marketingExternal: typeof parsed.marketingExternal === 'string' ? normalizeDecimalInput(parsed.marketingExternal) : '',
    contentCost: typeof parsed.contentCost === 'string' ? normalizeDecimalInput(parsed.contentCost) : '',
    otherCosts: typeof parsed.otherCosts === 'string' ? normalizeDecimalInput(parsed.otherCosts) : '',
    cpoPlan: typeof parsed.cpoPlan === 'string' ? normalizeDecimalInput(parsed.cpoPlan) : '',
    cpsPlan: typeof parsed.cpsPlan === 'string' ? normalizeDecimalInput(parsed.cpsPlan) : '',
    selectedWarehouses: selectedWarehousesFiltered,
    warehouseCosts,
    customWarehouses,
    warehouseAutoSelectionDisabled: parsed.warehouseAutoSelectionDisabled === true,
    activePriceScenarioId,
    tradeScheme,
    priceScenarios,
  };
}

export function parseManualFieldsFromUnknown(value: unknown): ManualFields {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return EMPTY_MANUAL_FIELDS;
  }
  return parseManualFieldsPayload(value as Partial<ManualFields>);
}

export function hasServerManualPayload(value: unknown): value is Record<string, unknown> {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value as Record<string, unknown>).length > 0,
  );
}

/**
 * Read manual fields for an nmId from localStorage. If the current tenant key
 * is empty, falls back to the legacy `default`-tenant key (and migrates it
 * forward for stability across reloads).
 */
export function readManualFields(tenantId: string | null | undefined, nmId: number): ManualFields {
  if (typeof window === 'undefined') {
    return EMPTY_MANUAL_FIELDS;
  }
  const currentKey = toManualStorageKey(tenantId, nmId);
  let raw = window.localStorage.getItem(currentKey);
  if (!raw && tenantId && tenantId.trim().length > 0) {
    const legacyDefaultRaw = window.localStorage.getItem(toManualStorageKey('default', nmId));
    if (legacyDefaultRaw) {
      raw = legacyDefaultRaw;
      window.localStorage.setItem(currentKey, legacyDefaultRaw);
    }
  }
  if (!raw) {
    return EMPTY_MANUAL_FIELDS;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ManualFields>;
    return parseManualFieldsPayload(parsed);
  } catch {
    return EMPTY_MANUAL_FIELDS;
  }
}

export function saveManualFields(tenantId: string | null | undefined, nmId: number, value: ManualFields) {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(toManualStorageKey(tenantId, nmId), JSON.stringify(value));
}

/** Deep-clone manual fields so callers can mutate without touching the source. */
export function cloneManualFields(source: ManualFields): ManualFields {
  return {
    ...source,
    selectedWarehouses: [...source.selectedWarehouses],
    warehouseCosts: { ...source.warehouseCosts },
    customWarehouses: source.customWarehouses.map((warehouse) => ({ ...warehouse })),
    priceScenarios: {
      excellent: { ...source.priceScenarios.excellent },
      good: { ...source.priceScenarios.good },
      average: { ...source.priceScenarios.average },
      poor: { ...source.priceScenarios.poor },
    },
  };
}
