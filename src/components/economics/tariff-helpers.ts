/**
 * WB tariff matching, scoring and per-warehouse rate computation helpers.
 *
 * Extracted verbatim from the legacy `UnitEconomicsTemplateTable.tsx`. These
 * functions implement the fuzzy matching between a user's warehouse label and
 * the WB API tariff records (which use slightly different naming), and the
 * volume-tier formulas for forward/reverse logistics + storage.
 *
 * Do not change the numeric formulas — they encode WB's published tariff math
 * and are exercised by historical user data.
 */

import {
  WAREHOUSE_LOOKUP_ALIASES,
  WB_LOGISTICS_BASE_TIERS_UP_TO_ONE_LITER,
  WB_REVERSE_BASE_ADDITIONAL_LITER,
  WB_REVERSE_BASE_FIRST_LITER,
} from './constants';
import {
  clampPercent,
  parseFirstNumber,
  toNumber,
} from './helpers';
import type { UnitTemplateRow } from './types';

/** Forward logistics base tier for parcels up to 1L (₽). */
export function getWbLogisticsBaseUpToOneLiter(volumeLiters: number): number {
  if (volumeLiters <= 0 || volumeLiters > 1) {
    return 0;
  }
  const tier = WB_LOGISTICS_BASE_TIERS_UP_TO_ONE_LITER.find((item) => volumeLiters <= item.maxVolume);
  return tier?.base ?? 0;
}

/** Reverse logistics base for an arbitrary parcel volume (₽). */
export function getWbReverseBaseForVolume(volumeLiters: number): number {
  if (volumeLiters <= 0) {
    return 0;
  }
  if (volumeLiters <= 1) {
    return getWbLogisticsBaseUpToOneLiter(volumeLiters);
  }
  const extraLiters = Math.max(volumeLiters - 1, 0);
  return WB_REVERSE_BASE_FIRST_LITER + (WB_REVERSE_BASE_ADDITIONAL_LITER * extraLiters);
}

/**
 * Expand a normalized warehouse label into a set of lookup keys via aliases.
 *
 * The trigger itself is added to the lookup set ONLY when it equals the
 * normalized label exactly. Otherwise we'd pull broader keys (e.g. «санкт­
 * петербург») into the lookup of a more specific label (e.g. «санкт­
 * петербургшушары»), which lets a generic tariff entry shadow the precise
 * one — the exact-match loop in `pickAcceptanceTariffByWarehouseLabel`
 * would return the broader hit before the specific one is tried.
 *
 * Result is sorted by length descending so longer (more specific) keys are
 * tried first by callers.
 */
export function getWarehouseLookupKeys(normalizedLabel: string): string[] {
  if (!normalizedLabel) {
    return [];
  }
  const keys = new Set<string>([normalizedLabel]);
  for (const mapping of WAREHOUSE_LOOKUP_ALIASES) {
    if (normalizedLabel.includes(mapping.trigger) || mapping.trigger.includes(normalizedLabel)) {
      if (mapping.trigger === normalizedLabel) {
        keys.add(mapping.trigger);
      }
      for (const alias of mapping.aliases) {
        keys.add(alias);
      }
    }
  }
  return Array.from(keys)
    .filter((item) => item.length > 0)
    .sort((a, b) => b.length - a.length);
}

export type AcceptanceTariffCandidate = {
  warehouseName: string;
  boxTypeId: number | null;
  allowUnload: boolean;
  coefficient: number;
  deliveryCoef: number;
  storageCoef: number;
  deliveryBaseLiter: number;
  deliveryAdditionalLiter: number;
  storageBaseLiter: number;
  storageAdditionalLiter: number;
  reverseBaseLiter?: number;
  reverseAdditionalLiter?: number;
  reverseCoef?: number;
  date: string | null;
};

export type ReturnTariffCandidate = {
  warehouseName: string;
  geoName: string | null;
  deliveryDumpKgtOfficeBase: number;
  deliveryDumpKgtOfficeLiter: number;
  deliveryDumpKgtReturnExpr: number;
  deliveryDumpSrgOfficeBase: number;
  deliveryDumpSrgOfficeLiter: number;
  deliveryDumpSrgReturnExpr: number;
  deliveryDumpSupOfficeBase: number;
  deliveryDumpSupOfficeLiter: number;
  deliveryDumpSupReturnExpr: number;
};

/** Box type priority for picking the best acceptance tariff variant. */
function getAcceptanceBoxTypePriority(boxTypeId: number | null): number {
  if (boxTypeId === 2) return 0;
  if (boxTypeId === 6) return 1;
  if (boxTypeId === 5) return 2;
  return 3;
}

/**
 * Decide whether `candidate` should replace `existing` for the same warehouse.
 * Priority: lower boxType priority > allowUnload=true > newer `date`.
 */
export function shouldReplaceAcceptanceTariff(
  existing: AcceptanceTariffCandidate,
  candidate: AcceptanceTariffCandidate,
): boolean {
  const existingPriority = getAcceptanceBoxTypePriority(existing.boxTypeId);
  const candidatePriority = getAcceptanceBoxTypePriority(candidate.boxTypeId);
  if (candidatePriority !== existingPriority) {
    return candidatePriority < existingPriority;
  }
  if (candidate.allowUnload !== existing.allowUnload) {
    return candidate.allowUnload;
  }
  const existingDate = existing.date ?? '';
  const candidateDate = candidate.date ?? '';
  if (candidateDate !== existingDate) {
    return candidateDate > existingDate;
  }
  return false;
}

/**
 * Min lookup-key length for fuzzy substring matching. Anything shorter
 * (e.g. 3-letter «спб») is too generic and would mis-match unrelated
 * warehouses through `includes()`. Only used in the fuzzy fallback —
 * exact-match loop is unaffected.
 */
const FUZZY_MIN_LOOKUP_LEN = 5;

export function pickAcceptanceTariffByWarehouseLabel(
  normalizedTariffMap: Map<string, AcceptanceTariffCandidate>,
  normalizedLabel: string,
): AcceptanceTariffCandidate | undefined {
  const lookupKeys = getWarehouseLookupKeys(normalizedLabel);
  if (lookupKeys.length === 0) {
    return undefined;
  }
  // Step 1: exact match — keys are already sorted by length DESC, so the
  // most specific lookup wins (e.g. «санктпетербургшушары» before «шушары»).
  for (const lookupKey of lookupKeys) {
    const exact = normalizedTariffMap.get(lookupKey);
    if (exact) {
      return exact;
    }
  }
  // Step 2: fuzzy substring with scoring — prefer the longest mutual
  // overlap. Skip short lookup keys (<5 chars) to avoid generic matches.
  let bestMatch: AcceptanceTariffCandidate | undefined;
  let bestScore = -Infinity;
  for (const lookupKey of lookupKeys) {
    if (lookupKey.length < FUZZY_MIN_LOOKUP_LEN) continue;
    for (const [candidateKey, candidate] of normalizedTariffMap.entries()) {
      const isExact = candidateKey === lookupKey;
      const matches = isExact || candidateKey.includes(lookupKey) || lookupKey.includes(candidateKey);
      if (!matches) continue;
      // Score: exact match wins outright, then prefer longer overlap.
      const overlapLen = isExact
        ? lookupKey.length * 2
        : Math.min(candidateKey.length, lookupKey.length);
      const score = overlapLen + (isExact ? 100_000 : 0);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = candidate;
      }
    }
  }
  return bestMatch;
}

/** Quality score of a return-tariff entry, biased to entries with real data. */
export function scoreReturnTariffForWarehouseEntry(value: ReturnTariffCandidate): number {
  return (
    (value.deliveryDumpSupOfficeBase > 0 ? 10_000 + value.deliveryDumpSupOfficeBase * 20 : 0)
    + (value.deliveryDumpSrgOfficeBase > 0 ? 8_000 + value.deliveryDumpSrgOfficeBase * 20 : 0)
    + (value.deliveryDumpKgtOfficeBase > 0 ? 6_000 + value.deliveryDumpKgtOfficeBase * 20 : 0)
    + (value.deliveryDumpSupReturnExpr > 0 ? 4_000 + value.deliveryDumpSupReturnExpr * 10 : 0)
    + (value.deliveryDumpSrgReturnExpr > 0 ? 3_000 + value.deliveryDumpSrgReturnExpr * 10 : 0)
    + (value.deliveryDumpKgtReturnExpr > 0 ? 2_000 + value.deliveryDumpKgtReturnExpr * 10 : 0)
  );
}

function scoreReturnTariffForLabelMatch(
  key: string,
  value: ReturnTariffCandidate,
  normalizedLabel: string,
): number {
  if (!normalizedLabel) {
    return Number.NEGATIVE_INFINITY;
  }
  if (!(key.includes(normalizedLabel) || normalizedLabel.includes(key))) {
    return Number.NEGATIVE_INFINITY;
  }
  const matchScore = key === normalizedLabel
    ? 80_000
    : key.startsWith(normalizedLabel)
      ? 40_000
      : normalizedLabel.startsWith(key)
        ? 30_000
        : 20_000;
  return matchScore + scoreReturnTariffForWarehouseEntry(value);
}

export function pickReturnTariffByWarehouseLabel(
  normalizedReturnTariffMap: Map<string, ReturnTariffCandidate>,
  normalizedLabel: string,
): ReturnTariffCandidate | undefined {
  const lookupKeys = getWarehouseLookupKeys(normalizedLabel);
  if (lookupKeys.length === 0) {
    return undefined;
  }
  for (const lookupKey of lookupKeys) {
    const exact = normalizedReturnTariffMap.get(lookupKey);
    if (exact) {
      return exact;
    }
  }
  let best: ReturnTariffCandidate | undefined;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const [key, value] of normalizedReturnTariffMap.entries()) {
    const score = lookupKeys.reduce((max, lookupKey) => (
      Math.max(max, scoreReturnTariffForLabelMatch(key, value, lookupKey))
    ), Number.NEGATIVE_INFINITY);
    if (score > bestScore) {
      best = value;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Pick the best return-tariff sub-variant (KGT / SRG / SUP) for a given parcel
 * volume. SUP is preferred for ≤ 1L parcels, KGT for larger ones.
 */
export function resolveReturnTariffOfficeForVolume(
  tariff: ReturnTariffCandidate | undefined,
  volumeLiters: number,
): { base: number; liter: number; returnExpr: number; source: 'sup' | 'srg' | 'kgt' | null } {
  if (!tariff) {
    return { base: 0, liter: 0, returnExpr: 0, source: null };
  }
  const preferSup = volumeLiters > 0 && volumeLiters <= 1;
  const variants: Array<{ source: 'sup' | 'srg' | 'kgt'; base: number; liter: number; returnExpr: number }> = [
    {
      source: 'sup',
      base: tariff.deliveryDumpSupOfficeBase,
      liter: tariff.deliveryDumpSupOfficeLiter,
      returnExpr: tariff.deliveryDumpSupReturnExpr,
    },
    {
      source: 'srg',
      base: tariff.deliveryDumpSrgOfficeBase,
      liter: tariff.deliveryDumpSrgOfficeLiter,
      returnExpr: tariff.deliveryDumpSrgReturnExpr,
    },
    {
      source: 'kgt',
      base: tariff.deliveryDumpKgtOfficeBase,
      liter: tariff.deliveryDumpKgtOfficeLiter,
      returnExpr: tariff.deliveryDumpKgtReturnExpr,
    },
  ];
  const order: Array<'sup' | 'srg' | 'kgt'> = preferSup ? ['sup', 'srg', 'kgt'] : ['kgt', 'srg', 'sup'];
  const pick = order
    .map((source) => variants.find((item) => item.source === source))
    .find((item) => item && (item.base > 0 || item.liter > 0))
    ?? variants.find((item) => item.base > 0 || item.liter > 0);
  if (!pick) {
    return { base: 0, liter: 0, returnExpr: 0, source: null };
  }
  return pick;
}

export function resolveReverseLogisticsForVolume(
  _tariff: AcceptanceTariffCandidate | undefined,
  volumeLiters: number,
): { base: number; liter: number; total: number; source: 'wb_volume' | null } {
  if (volumeLiters <= 0) {
    return { base: 0, liter: 0, total: 0, source: null };
  }

  return {
    base: volumeLiters <= 1 ? getWbReverseBaseForVolume(volumeLiters) : WB_REVERSE_BASE_FIRST_LITER,
    liter: volumeLiters > 1 ? WB_REVERSE_BASE_ADDITIONAL_LITER : 0,
    total: getWbReverseBaseForVolume(volumeLiters),
    source: 'wb_volume',
  };
}

/**
 * Resolve the parcel volume in liters used for WB tariff calculations.
 *
 * Priority: WB factual volume first. If WB has no factual measurement for an
 * old/idle SKU, fall back to card-side volume/dimensions so the economics table
 * still shows a tariff estimate instead of silently charging 0.
 */
export function resolveVolumeLiters(row: UnitTemplateRow): number {
  const wbVolumeLiters = toNumber(row?.wbVolumeLiters);
  if (wbVolumeLiters > 0) {
    return wbVolumeLiters;
  }

  const cardVolumeLiters = toNumber(row?.volumeLiters);
  if (cardVolumeLiters > 0) {
    return cardVolumeLiters;
  }

  const volumeFromText = parseFirstNumber(typeof row?.volume === 'string' ? row.volume : null);
  if (volumeFromText > 0) {
    return volumeFromText;
  }

  const length = parseFirstNumber(typeof row?.length === 'string' ? row.length : null);
  const width = parseFirstNumber(typeof row?.width === 'string' ? row.width : null);
  const height = parseFirstNumber(typeof row?.height === 'string' ? row.height : null);
  if (length > 0 && width > 0 && height > 0) {
    return Math.round(((length * width * height) / 1000) * 100) / 100;
  }

  return 0;
}

export const BUYOUT_AUTO_MIN_HISTORY_DAYS = 30;
export const BUYOUT_AUTO_MIN_CLOSED_ORDERS = 10;
export const BUYOUT_AUTO_MAX_OPEN_SHARE = 0.4;

export type RowBuyoutAutoDiagnostics = {
  historyDays: number;
  hasFactForPeriod: boolean;
  orderCount: number;
  buyoutCount: number;
  cancelCount: number;
  returnCount: number;
  closedCount: number;
  openCount: number;
  openShare: number;
  autoPercent: number;
  canUseAuto: boolean;
  reason: 'ok' | 'no_history' | 'no_fact' | 'low_closed_base' | 'high_open_share';
};

/** Resolve the buyout percentage from the row's actuals. */
export function resolveRowBuyoutPercent(row?: UnitTemplateRow | null): number {
  if (!row) {
    return 0;
  }
  const explicitPercent = clampPercent(toNumber(row.buyoutPercentFact));
  if (explicitPercent > 0) {
    return explicitPercent;
  }
  const buyoutCount = toNumber(row.buyoutCountFact);
  const cancelCount = toNumber(row.buyoutCancelCountFact);
  const returnCount = toNumber(row.buyoutReturnCountFact);
  const denominator = buyoutCount + cancelCount + returnCount;
  if (denominator > 0) {
    return clampPercent((buyoutCount / denominator) * 100);
  }
  const orderCount = toNumber(row.buyoutOrderCountFact);
  if (orderCount > 0 && buyoutCount >= 0) {
    return clampPercent((buyoutCount / orderCount) * 100);
  }
  return 0;
}

export function getRowBuyoutAutoDiagnostics(row?: UnitTemplateRow | null): RowBuyoutAutoDiagnostics {
  const historyDays = resolveRowBuyoutHistoryDays(row);
  const hasFactForPeriod = hasRowBuyoutFactForPeriod(row);
  const orderCount = Math.max(0, toNumber(row?.buyoutOrderCountFact));
  const buyoutCount = Math.max(0, toNumber(row?.buyoutCountFact));
  const cancelCount = Math.max(0, toNumber(row?.buyoutCancelCountFact));
  const returnCount = Math.max(0, toNumber(row?.buyoutReturnCountFact));
  const closedCount = buyoutCount + cancelCount;
  const openCount = Math.max(0, orderCount - closedCount);
  const openShare = orderCount > 0 ? openCount / orderCount : 0;
  const autoPercent = resolveRowBuyoutPercent(row);

  if (historyDays < BUYOUT_AUTO_MIN_HISTORY_DAYS) {
    return {
      historyDays,
      hasFactForPeriod,
      orderCount,
      buyoutCount,
      cancelCount,
      returnCount,
      closedCount,
      openCount,
      openShare,
      autoPercent,
      canUseAuto: false,
      reason: 'no_history',
    };
  }
  if (!hasFactForPeriod) {
    return {
      historyDays,
      hasFactForPeriod,
      orderCount,
      buyoutCount,
      cancelCount,
      returnCount,
      closedCount,
      openCount,
      openShare,
      autoPercent,
      canUseAuto: false,
      reason: 'no_fact',
    };
  }
  if (closedCount < BUYOUT_AUTO_MIN_CLOSED_ORDERS) {
    return {
      historyDays,
      hasFactForPeriod,
      orderCount,
      buyoutCount,
      cancelCount,
      returnCount,
      closedCount,
      openCount,
      openShare,
      autoPercent,
      canUseAuto: false,
      reason: 'low_closed_base',
    };
  }
  if (orderCount > 0 && openShare > BUYOUT_AUTO_MAX_OPEN_SHARE) {
    return {
      historyDays,
      hasFactForPeriod,
      orderCount,
      buyoutCount,
      cancelCount,
      returnCount,
      closedCount,
      openCount,
      openShare,
      autoPercent,
      canUseAuto: false,
      reason: 'high_open_share',
    };
  }

  return {
    historyDays,
    hasFactForPeriod,
    orderCount,
    buyoutCount,
    cancelCount,
    returnCount,
    closedCount,
    openCount,
    openShare,
    autoPercent,
    canUseAuto: true,
    reason: 'ok',
  };
}

export function resolveRowBuyoutHistoryDays(row?: UnitTemplateRow | null): number {
  return Math.max(0, Math.floor(toNumber(row?.buyoutHistoryDaysFact)));
}

export function hasRowBuyoutFactForPeriod(row?: UnitTemplateRow | null): boolean {
  if (!row) {
    return false;
  }

  if (row.buyoutPercentFact !== null && row.buyoutPercentFact !== undefined && row.buyoutPercentFact !== '') {
    return Number.isFinite(Number(row.buyoutPercentFact));
  }

  const buyoutCount = toNumber(row.buyoutCountFact);
  const cancelCount = toNumber(row.buyoutCancelCountFact);
  const returnCount = toNumber(row.buyoutReturnCountFact);
  const orderCount = toNumber(row.buyoutOrderCountFact);

  return (buyoutCount + cancelCount + returnCount) > 0 || orderCount > 0;
}

export function canUseRowAutoBuyout(row?: UnitTemplateRow | null): boolean {
  return getRowBuyoutAutoDiagnostics(row).canUseAuto;
}

/**
 * Compute the effective per-unit marketplace logistics cost given buyout %,
 * per WB's published 2026-03-20 reverse-logistics rule:
 *
 *   итог = Forward + (1 − выкуп) × Reverse
 *
 * `forwardPerUnit` should ALREADY include warehouse coef and locality
 * multiplier (ИЛ); reverse stays as base (no coef, no ИЛ) per WB rules.
 */
export function computeWbLogisticsWithBuyout(
  forwardPerUnit: number,
  reversePerUnit: number,
  buyoutPercent: number,
): number {
  const buyoutClamped = clampPercent(buyoutPercent);
  const buyoutRate = buyoutClamped / 100;
  const returnRate = 1 - buyoutRate;
  return forwardPerUnit + returnRate * reversePerUnit;
}
