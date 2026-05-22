/**
 * Constants for the Unit Economics module.
 *
 * Extracted verbatim from the legacy `UnitEconomicsTemplateTable.tsx` so all
 * downstream calculations stay numerically identical to the previous UI.
 * Do NOT change the numeric values without checking that they still match
 * the WB tariff documentation referenced in the original component.
 */

import type { ManualFields, PriceScenarioId } from './types';

export const MAX_WAREHOUSES = 12;

/** WB monthly storage base for parcels up to 1 liter (₽/day). */
export const WB_STORAGE_BASE_UP_TO_ONE_LITER = 0.08;

/** WB reverse logistics base for the first liter (₽). */
export const WB_REVERSE_BASE_FIRST_LITER = 46;
/** WB reverse logistics base for each additional liter beyond the first (₽). */
export const WB_REVERSE_BASE_ADDITIONAL_LITER = 14;

/** Forward logistics base tiers for parcels up to 1 liter (₽). */
export const WB_LOGISTICS_BASE_TIERS_UP_TO_ONE_LITER: Array<{ maxVolume: number; base: number }> = [
  { maxVolume: 0.2, base: 23 },
  { maxVolume: 0.4, base: 26 },
  { maxVolume: 0.6, base: 29 },
  { maxVolume: 0.8, base: 30 },
  { maxVolume: 1.0, base: 32 },
];

/** Default warehouse roster shown to users (extendable via custom warehouses). */
export const DEFAULT_WAREHOUSES: Array<{ id: string; label: string }> = [
  { id: 'koledino', label: 'Коледино' },
  { id: 'ryazan', label: 'Рязань' },
  { id: 'nevinnomyssk', label: 'Невинномысск' },
  { id: 'novosemeykino', label: 'Новосемейкино' },
  { id: 'ekaterinburg', label: 'Екатеринбург (Перспективная 14)' },
  { id: 'podolsk', label: 'Подольск' },
  { id: 'kazan', label: 'Казань' },
  { id: 'krasnodar', label: 'Краснодар' },
  { id: 'spb', label: 'Санкт-Петербург (Шушары)' },
  { id: 'habarovsk', label: 'Хабаровск' },
  { id: 'tula', label: 'Тула' },
  { id: 'voronezh', label: 'Воронеж' },
];

/**
 * Price scenario presets used to seed an empty scenario table from the
 * historical average price (avg = revenue / units). Each scenario gets:
 *   sellerPriceBeforeDiscount = historicalAvg * multiplier
 */
export const PRICE_SCENARIOS: Array<{
  id: PriceScenarioId;
  label: string;
  multiplier: number;
}> = [
  { id: 'excellent', label: 'Отличная', multiplier: 1.15 },
  { id: 'good', label: 'Хорошая', multiplier: 1.05 },
  { id: 'average', label: 'Средняя', multiplier: 1 },
  { id: 'poor', label: 'Плохая', multiplier: 0.9 },
];
export const PRICE_SCENARIO_IDS = PRICE_SCENARIOS.map((item) => item.id);

export const DEFAULT_ACTIVE_PRICE_SCENARIO_ID: PriceScenarioId = 'average';

/**
 * Aliases for warehouse name → tariff lookup.
 * Used because the user-visible warehouse labels do not always match the
 * WB API `warehouseName` field exactly (e.g., "Санкт-Петербург (Шушары)" vs
 * "СПБ Шушары" in WB acceptance tariffs).
 */
export const WAREHOUSE_LOOKUP_ALIASES: Array<{ trigger: string; aliases: string[] }> = [
  {
    trigger: 'екатеринбург',
    aliases: ['екатеринбургперспективная14', 'екатеринбургперспективный14', 'перспективная14', 'екатеринбургсгт'],
  },
  {
    // For the «Санкт-Петербург (Шушары)» default warehouse. We deliberately
    // omit a bare «спб» alias — it's too short and would fuzzy-match other
    // SPB warehouses like «Санкт-Петербург (Уткина Заводь)», pulling the
    // wrong tariff. The trigger itself is no longer used as a lookup key
    // unless it equals the normalized label (see getWarehouseLookupKeys).
    //
    // WB API («Тарифы на поставку», acceptance/coefficients) returns this
    // warehouse under the name «Склад Шушары» — hence the «складшушары» alias
    // for the exact-match lookup loop, plus older variants kept for safety.
    trigger: 'санктпетербург',
    aliases: ['санктпетербургшушары', 'спбшушары', 'шушары', 'складшушары'],
  },
  {
    trigger: 'уткиназаводь',
    aliases: ['санктпетербургуткиназаводь', 'спбуткиназаводь', 'складуткиназаводь'],
  },
  {
    trigger: 'хабаровск',
    aliases: ['сцхабаровск'],
  },
  {
    trigger: 'рязань',
    aliases: ['рязаньтюшевское', 'тюшевское'],
  },
];

/**
 * Tokens hinting that a vendor-code suffix is a color, used for grouping
 * SKU variants under the same model family in `buildVariantFamilyKey`.
 */
export const COLOR_TOKEN_HINTS = [
  'бел', 'черн', 'красн', 'син', 'голуб', 'зел', 'желт', 'розов', 'фиолет',
  'оранж', 'коричн', 'беж', 'сер', 'молоч', 'пудр', 'хаки', 'бордо', 'бургунд',
  'лилов', 'сирен', 'mint', 'graphite', 'sand', 'white', 'black', 'red', 'blue',
  'green', 'yellow', 'pink', 'purple', 'brown', 'beige', 'gray', 'grey',
];

/** Empty scenario slot used when seeding manual fields for a new SKU. */
export function createEmptyPriceScenarios(): ManualFields['priceScenarios'] {
  return {
    excellent: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
    good: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
    average: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
    poor: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
  };
}

/** All-empty manual fields (used as initial state and as parse fallback). */
export const EMPTY_MANUAL_FIELDS: ManualFields = {
  costPrice: '',
  deliveryToFf: '',
  packagingMaterial: '',
  fulfillment: '',
  irpPercent: '',
  localityIndexPercent: '',
  purchaseQtyTotal: '',
  taxPercent: '',
  turnoverDays: '',
  drrPercent: '',
  marketingInternal: '',
  marketingExternal: '',
  contentCost: '',
  otherCosts: '',
  cpoPlan: '',
  cpsPlan: '',
  selectedWarehouses: [],
  warehouseCosts: {},
  customWarehouses: [],
  warehouseAutoSelectionDisabled: false,
  activePriceScenarioId: DEFAULT_ACTIVE_PRICE_SCENARIO_ID,
  tradeScheme: 'fbw',
  priceScenarios: createEmptyPriceScenarios(),
};

/**
 * Trade scheme labels (FBW = склад WB, FBS = склад продавца). Used in the
 * trade-scheme selector and tooltips. The internal id (`fbw`/`fbs`) is the
 * persisted value in `ManualFields.tradeScheme`.
 */
export function getTradeSchemeLabel(value: 'fbw' | 'fbs'): string {
  return value === 'fbs' ? 'FBS (склад продавца)' : 'FBW (склад WB)';
}

/** Prettier label for return-tariff variant codes (KGT/SRG/SUP). */
export function getReturnTariffSourceLabel(source: 'sup' | 'srg' | 'kgt' | null): string {
  if (source === 'sup') return 'SUP';
  if (source === 'srg') return 'SRG';
  if (source === 'kgt') return 'KGT';
  return '—';
}

/**
 * Официальная сетка ИРП/КРП (Индекс Распределения Продаж) WB по доле локальных
 * заказов. Это НАДБАВКА ОТ ЦЕНЫ (отдельная статья): итог += priceBeforeWbDiscount × ИРП%.
 * Возвращает % в диапазоне 0..2.5; при локализации >=60% ИРП = 0.
 * Серверный двойник: redistribution.ts:resolveKrpByLocalization — синхронизировать.
 *
 * NB: НЕ путать с Индексом Локализации (ИЛ) — тот является МНОЖИТЕЛЕМ к прямой
 * логистике (см. resolveLocalityIndexMultiplierFromLocalization). Это два разных показателя.
 *
 * Источник: справка WB — Тарифы складов, формула с 23 марта 2026:
 *   forward = (база + extra×additional) × коэф_склада × ИЛ
 *   итог  += priceBeforeWbDiscount × ИРП  (отдельно)
 *
 * @param localizationPercent — 0..100; >=60 даёт ИРП=0 (без надбавки).
 */
export function resolveIrpFromLocalization(localizationPercent: number): number {
  if (!Number.isFinite(localizationPercent)) return 0;
  const share = Math.min(100, Math.max(0, localizationPercent));
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
 * Официальная сетка ИЛ (Индекс Локализации, КТР) WB — МНОЖИТЕЛЬ к прямой
 * логистике: forward = (база + extra×additional) × коэф_склада × ИЛ.
 * Коэффициент КТР по сетке WB лежит в диапазоне 0.5..2.0.
 *
 * Источник: справка WB «Тарифы складов», сетка КТР с 23.03.2026.
 * @param localizationPercent — 0..100; >=95% даёт ИЛ=0.5 (логистика дешевле вдвое).
 */
export function resolveLocalityIndexMultiplierFromLocalization(localizationPercent: number): number {
  if (!Number.isFinite(localizationPercent)) return 1;
  const share = Math.min(100, Math.max(0, localizationPercent));
  if (share >= 95) return 0.50;
  if (share >= 90) return 0.60;
  if (share >= 85) return 0.70;
  if (share >= 80) return 0.80;
  if (share >= 75) return 0.90;
  if (share >= 60) return 1.00;
  if (share >= 55) return 1.05;
  if (share >= 50) return 1.10;
  if (share >= 45) return 1.20;
  if (share >= 40) return 1.30;
  if (share >= 35) return 1.40;
  if (share >= 30) return 1.50;
  if (share >= 25) return 1.55;
  if (share >= 20) return 1.60;
  if (share >= 15) return 1.70;
  if (share >= 10) return 1.75;
  if (share >= 5) return 1.80;
  return 2.00;
}

/**
 * Backward-compatible converter for legacy stored UI values:
 * - official/manual ИЛ coefficient is 0.5..2.0 and is used as-is;
 * - old UI stored a percent delta (e.g. 55 meant multiplier 1.55).
 */
export function normalizeLocalityIndexMultiplier(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  if (value <= 2) return Math.min(2, Math.max(0.5, value));
  return Math.min(2, Math.max(0.5, 1 + value / 100));
}

/** Legacy helper kept for older call sites/docs: returns delta percent from multiplier. */
export function resolveLocalityIndexSurchargePercent(localizationPercent: number): number {
  return (resolveLocalityIndexMultiplierFromLocalization(localizationPercent) - 1) * 100;
}
