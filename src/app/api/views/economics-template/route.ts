import { NextResponse } from 'next/server';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { AnalyticsEngine } from '@/server/analytics/engine';
import { apiRoute } from '@/lib/api-response';
import { requireActiveTenant } from '@/lib/auth/tenant-access';
import { logger } from '@/lib/logger';
import { parseApiDateParam } from '@/lib/date-range';
import { db, withTenantContext } from '@/lib/db';
import { products, tenants, unitEconomicsConfigs, unitEconomicsManualInputs, wbTariffSnapshots as wbTariffSnapshotsTable, wbCategoryCommissionSnapshots as wbCategoryCommissionSnapshotsTable } from '@/lib/db/schema';
import { resolveTaxRatePercent } from '@/lib/tax/regimes';
import { decryptIfNeeded } from '@/lib/encryption';
import { resolveCabinetEconomicsIndices } from '@/server/economics/cabinet-indices';
import {
  wbApi,
  type WbAcceptanceTariffItem,
  type WbBoxTariffItem,
  type WbCategoryCommissionItem,
  type WbMeasurementPenaltyItem,
  type WbProductCard,
  type WbReturnTariffItem,
  type WbWarehouseMeasurementItem,
} from '@/lib/wb-api';
import { MAX_WAREHOUSES } from '@/components/economics/constants';
import { parseManualFieldsFromUnknown } from '@/components/economics/manual-fields-io';
import { isDefaultWarehouseId, resolveWarehouseOptionId } from '@/components/economics/warehouse-options';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type UnitEconomicsRow = {
  nmId?: number | string;
  imtId?: number | string;
  soldQuantity?: number | string;
  category?: string | null;
  brand?: string | null;
  vendorCode?: string | null;
  barcode?: string | null;
  [key: string]: unknown;
};

type BuyoutFactRow = {
  nmId: number | string;
  orderCount: number | string;
  buyoutCount: number | string;
  cancelCount: number | string;
  returnCount: number | string;
  buyoutPercent: number | string | null;
  historyDays: number | string;
  firstActivityDate: string | null;
  lastActivityDate: string | null;
};

type CardDimensions = {
  volume: string | null;
  volumeLiters: number | null;
  wbVolumeLiters: number | null;
  length: string | null;
  width: string | null;
  height: string | null;
  categoryFromCard: string | null;
  barcodeFromCard: string | null;
};

type WbMeasuredDimensions = {
  source: 'warehouse-measurements' | 'measurement-penalties';
  dimId: number | null;
  volumeLiters: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  measuredAt: string | null;
};

type WbStockWarehouseSuggestion = {
  warehouseName: string;
  quantity: number;
  source: 'stocks' | 'stock_sizes';
};

type TemplateScope = 'all' | 'costed';

const DEFAULT_TOP_STOCK_WAREHOUSE_COUNT = 6;

const WB_CARDS_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h — cards/photos/dimensions rarely change
const wbCardsCache = new Map<string, { fetchedAt: number; cards: WbProductCard[] }>();
const WB_ACCEPTANCE_TARIFFS_CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12h — tariffs change rarely
const wbAcceptanceTariffsCache = new Map<string, { fetchedAt: number; tariffs: WbAcceptanceTariffItem[] }>();
const WB_BOX_TARIFFS_CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12h
const wbBoxTariffsCache = new Map<string, { fetchedAt: number; tariffs: WbBoxTariffItem[] }>();
const WB_RETURN_TARIFFS_CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12h
const wbReturnTariffsCache = new Map<string, { fetchedAt: number; tariffs: WbReturnTariffItem[] }>();
const WB_CATEGORY_COMMISSIONS_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h — commissions change very rarely
const wbCategoryCommissionsCache = new Map<string, { fetchedAt: number; commissions: WbCategoryCommissionItem[] }>();
const WB_MEASUREMENTS_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h — enough for daily refresh
const WB_MEASUREMENTS_ERROR_RETRY_MS = 10 * 60 * 1000; // 10 min backoff after rate-limit/network errors
const WB_OPTIONAL_ENRICHMENT_TIMEOUT_MS = 2_500;
const wbWarehouseMeasurementsCache = new Map<string, { fetchedAt: number; measurements: WbWarehouseMeasurementItem[] }>();
const wbMeasurementPenaltiesCache = new Map<string, { fetchedAt: number; penalties: WbMeasurementPenaltyItem[] }>();
const wbWarehouseMeasurementsErrorCache = new Map<string, number>();
const wbMeasurementPenaltiesErrorCache = new Map<string, number>();

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function withAutoStockWarehouses(
  manualPayload: unknown,
  suggestions: WbStockWarehouseSuggestion[],
): Record<string, unknown> {
  const manualFields = parseManualFieldsFromUnknown(manualPayload);
  if (
    manualFields.selectedWarehouses.length > 0
    || manualFields.warehouseAutoSelectionDisabled
    || suggestions.length === 0
  ) {
    return manualFields as unknown as Record<string, unknown>;
  }

  const selectedWarehouses: string[] = [];
  const customWarehouses = [...manualFields.customWarehouses];
  const customWarehouseIds = new Set(customWarehouses.map((warehouse) => warehouse.id));

  for (const suggestion of suggestions.slice(0, DEFAULT_TOP_STOCK_WAREHOUSE_COUNT)) {
    const label = suggestion.warehouseName.trim();
    if (!label) continue;

    const warehouseId = resolveWarehouseOptionId(label);
    if (selectedWarehouses.includes(warehouseId)) continue;

    selectedWarehouses.push(warehouseId);
    if (!isDefaultWarehouseId(warehouseId) && !customWarehouseIds.has(warehouseId)) {
      customWarehouses.push({ id: warehouseId, label });
      customWarehouseIds.add(warehouseId);
    }

    if (selectedWarehouses.length >= MAX_WAREHOUSES) {
      break;
    }
  }

  return {
    ...manualFields,
    selectedWarehouses,
    customWarehouses,
    warehouseAutoSelectionDisabled: false,
  } as unknown as Record<string, unknown>;
}

function parseSnapshotArray<T>(value: unknown, label: string): T[] {
  let parsed: unknown = value;

  for (let attempt = 0; attempt < 2 && typeof parsed === 'string'; attempt += 1) {
    const trimmed = parsed.trim();
    if (!trimmed) {
      return [];
    }
    try {
      parsed = JSON.parse(trimmed) as unknown;
    } catch (error) {
      logger.warn({ err: error, label }, 'WB snapshot JSON parse failed');
      return [];
    }
  }

  if (Array.isArray(parsed)) {
    return parsed as T[];
  }

  if (parsed && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>;
    const nested = record.data ?? record.items ?? record.tariffs;
    if (Array.isArray(nested)) {
      return nested as T[];
    }
  }

  return [];
}

async function withOptionalWbTimeout<T>(
  promise: Promise<T>,
  fallback: T,
  label: string,
  timeoutMs = WB_OPTIONAL_ENRICHMENT_TIMEOUT_MS,
  onTimeout?: () => void,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const guarded = promise.catch((error) => {
    logger.warn({ err: error, label }, 'Optional WB enrichment failed');
    return fallback;
  });

  try {
    return await Promise.race([
      guarded,
      new Promise<T>((resolve) => {
        timeout = setTimeout(() => {
          onTimeout?.();
          logger.warn({ label, timeoutMs }, 'Optional WB enrichment timed out');
          resolve(fallback);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function getTemplateRowActivityRank(row: UnitEconomicsRow): number {
  const soldQuantity = toNumber(row.soldQuantity);
  const grossRevenue = toNumber(row.grossRevenue);
  const currentStock = toNumber(row.currentStock);
  const views = toNumber(row.views);
  const orderCount = toNumber(row.orderCount);
  if (soldQuantity > 0 || grossRevenue > 0) return 4;
  if (currentStock > 0) return 3;
  if (orderCount > 0 || views > 0) return 2;
  return 1;
}

function compareTemplateRows(left: UnitEconomicsRow, right: UnitEconomicsRow): number {
  const rankDiff = getTemplateRowActivityRank(right) - getTemplateRowActivityRank(left);
  if (rankDiff !== 0) return rankDiff;

  const soldDiff = toNumber(right.soldQuantity) - toNumber(left.soldQuantity);
  if (soldDiff !== 0) return soldDiff;

  const stockDiff = toNumber(right.currentStock) - toNumber(left.currentStock);
  if (stockDiff !== 0) return stockDiff;

  const revenueDiff = toNumber(right.grossRevenue) - toNumber(left.grossRevenue);
  if (revenueDiff !== 0) return revenueDiff;

  return toNumber(left.nmId) - toNumber(right.nmId);
}

function buildCardOnlyEconomicsRow(card: WbProductCard): UnitEconomicsRow {
  return {
    nmId: card.nmID,
    imtId: toNumber((card as unknown as Record<string, unknown>).imtID ?? (card as unknown as Record<string, unknown>).imtId),
    brand: normalizeValue(card.brand ?? '') ?? null,
    vendorCode: normalizeValue(card.vendorCode ?? '') ?? null,
    barcode: extractBarcodeFromCard(card),
    category: normalizeValue(card.subjectName ?? '') ?? null,
    soldQuantity: 0,
    grossRevenue: 0,
    taxBaseRevenue: 0,
    payoutBeforeCost: 0,
    commission: 0,
    logistics: 0,
    otherFees: 0,
    totalCost: 0,
    costPrice: 0,
    currentStock: 0,
    daysOfStock: 999,
    lostOrdersCount: 0,
    lostOrdersSum: 0,
    stockAnalyticsDays: 0,
    stockTurnoverDays: 0,
    stockSizeAvailable: false,
    adSpend: 0,
    calculationMode: 'PLAN_TEMPLATE',
    views: 0,
    carts: 0,
    orderCount: 0,
    buyoutCount: 0,
    cancelCount: 0,
    buyoutRate: 0,
    opProfit: 0,
    netProfit: 0,
  };
}

function mergeCabinetCardRows(
  rows: UnitEconomicsRow[],
  cards: WbProductCard[],
  hiddenNmIds: Set<number>,
): UnitEconomicsRow[] {
  const byNmId = new Map<number, UnitEconomicsRow>();
  for (const row of rows) {
    const nmId = toNumber(row.nmId);
    if (nmId > 0 && !hiddenNmIds.has(nmId)) {
      byNmId.set(nmId, row);
    }
  }

  for (const card of cards) {
    const nmId = toNumber(card.nmID);
    if (nmId > 0 && !hiddenNmIds.has(nmId) && !byNmId.has(nmId)) {
      byNmId.set(nmId, buildCardOnlyEconomicsRow(card));
    }
  }

  return Array.from(byNmId.values()).sort(compareTemplateRows);
}

async function getCostedProductNmIds(tenantId: string): Promise<Set<number>> {
  const rows = await withTenantContext(db, tenantId, (tx) =>
    tx
      .select({ nmId: unitEconomicsManualInputs.nmId })
      .from(unitEconomicsManualInputs)
      .where(eq(unitEconomicsManualInputs.tenantId, tenantId))
  );

  const configRows = await withTenantContext(db, tenantId, (tx) =>
    tx
      .select({ nmId: unitEconomicsConfigs.nmId })
      .from(unitEconomicsConfigs)
      .where(eq(unitEconomicsConfigs.tenantId, tenantId))
  );

  return new Set(
    [...rows, ...configRows]
      .map((row) => toNumber(row.nmId))
      .filter((nmId) => Number.isFinite(nmId) && nmId > 0),
  );
}

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function dateOnlyMoscow(value: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

function toPositiveNumberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function measurementTimestamp(value: string | null): number {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function resolveMeasuredVolumeLiters(measured: WbMeasuredDimensions | null | undefined): number | null {
  if (!measured) {
    return null;
  }

  const explicit = toPositiveNumberOrNull(measured.volumeLiters);
  if (explicit) {
    return Math.round(explicit * 100) / 100;
  }

  const length = toPositiveNumberOrNull(measured.lengthCm);
  const width = toPositiveNumberOrNull(measured.widthCm);
  const height = toPositiveNumberOrNull(measured.heightCm);
  if (length && width && height) {
    return Math.round(((length * width * height) / 1000) * 100) / 100;
  }

  return null;
}

function getMeasurementsDateRange(referenceDate: Date): { dateFromIso: string; dateToIso: string } {
  const dateTo = new Date(referenceDate);
  dateTo.setUTCHours(23, 59, 59, 999);
  const dateFrom = new Date(dateTo);
  dateFrom.setUTCDate(dateFrom.getUTCDate() - 365);
  return {
    dateFromIso: dateFrom.toISOString(),
    dateToIso: dateTo.toISOString(),
  };
}

function buildLatestMeasuredDimensionsMap(
  source: 'warehouse-measurements' | 'measurement-penalties',
  items: Array<{
    nmId: number;
    dimId: number | null;
    volume: number | null;
    width: number | null;
    length: number | null;
    height: number | null;
    measuredAt: string | null;
  }>,
): Map<number, WbMeasuredDimensions> {
  const map = new Map<number, WbMeasuredDimensions>();

  for (const item of items) {
    const nmId = toNumber(item.nmId);
    if (nmId <= 0) {
      continue;
    }

    const candidate: WbMeasuredDimensions = {
      source,
      dimId: toPositiveNumberOrNull(item.dimId),
      volumeLiters: toPositiveNumberOrNull(item.volume),
      lengthCm: toPositiveNumberOrNull(item.length),
      widthCm: toPositiveNumberOrNull(item.width),
      heightCm: toPositiveNumberOrNull(item.height),
      measuredAt: item.measuredAt ?? null,
    };

    const existing = map.get(nmId);
    if (!existing || measurementTimestamp(candidate.measuredAt) >= measurementTimestamp(existing.measuredAt)) {
      map.set(nmId, candidate);
    }
  }

  return map;
}

function buildWbMeasuredDimensionsByNm(
  warehouseMeasurements: WbWarehouseMeasurementItem[],
  measurementPenalties: WbMeasurementPenaltyItem[],
): Map<number, WbMeasuredDimensions> {
  const merged = buildLatestMeasuredDimensionsMap('warehouse-measurements', warehouseMeasurements);
  const penalties = buildLatestMeasuredDimensionsMap('measurement-penalties', measurementPenalties);

  for (const [nmId, measured] of penalties.entries()) {
    if (!merged.has(nmId)) {
      merged.set(nmId, measured);
    }
  }

  return merged;
}

function normalizeLabel(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeCategoryKey(value: string): string {
  return normalizeLabel(value).replace(/ё/g, 'е');
}

function normalizeValue(value: string): string | null {
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized.length > 0 ? normalized : null;
}

function extractStrings(input: unknown, depth = 0): string[] {
  if (depth > 3 || input === null || input === undefined) {
    return [];
  }

  if (typeof input === 'string') {
    const value = input.trim();
    return value ? [value] : [];
  }

  if (typeof input === 'number' || typeof input === 'boolean') {
    return [String(input)];
  }

  if (Array.isArray(input)) {
    return input.flatMap((item) => extractStrings(item, depth + 1));
  }

  if (typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    const preferredKeys = [
      'name',
      'title',
      'charcName',
      'value',
      'values',
      'valueName',
      'valueNames',
      'charcValue',
      'charcValues',
      'translatedValue',
      'unitName',
    ];

    let result: string[] = [];
    for (const key of preferredKeys) {
      if (key in obj) {
        result = result.concat(extractStrings(obj[key], depth + 1));
      }
    }

    if (result.length > 0) {
      return result;
    }

    return Object.values(obj).flatMap((value) => extractStrings(value, depth + 1));
  }

  return [];
}

function getCharacteristicPairs(characteristics: unknown[]): Array<{ name: string; value: string }> {
  return characteristics
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null;
      }

      const obj = item as Record<string, unknown>;
      const nameCandidate = extractStrings(
        obj.name ?? obj.charcName ?? obj.title ?? obj.characteristicName ?? obj.label
      )[0];

      const valueCandidate = extractStrings(
        obj.value ?? obj.values ?? obj.charcValue ?? obj.charcValues ?? obj.valueName ?? obj.valueNames ?? obj
      )[0];

      if (!nameCandidate || !valueCandidate) {
        return null;
      }

      const name = normalizeLabel(nameCandidate);
      const value = normalizeValue(valueCandidate);
      if (!name || !value) {
        return null;
      }

      return { name, value };
    })
    .filter((pair): pair is { name: string; value: string } => pair !== null);
}

function pickCharacteristicValue(
  pairs: Array<{ name: string; value: string }>,
  nameKeywords: string[]
): string | null {
  for (const pair of pairs) {
    const isMatch = nameKeywords.some((keyword) => pair.name.includes(keyword));
    if (isMatch) {
      return pair.value;
    }
  }
  return null;
}

type KeyValueCandidate = {
  key: string;
  value: string;
};

function collectScalarCandidates(input: unknown, keyPath = '', depth = 0): KeyValueCandidate[] {
  if (depth > 4 || input === null || input === undefined) {
    return [];
  }

  if (typeof input === 'string' || typeof input === 'number') {
    const normalized = normalizeValue(String(input));
    if (!normalized || !keyPath) {
      return [];
    }
    return [{ key: normalizeLabel(keyPath), value: normalized }];
  }

  if (Array.isArray(input)) {
    return input.flatMap((item) => collectScalarCandidates(item, keyPath, depth + 1));
  }

  if (typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    return Object.entries(obj).flatMap(([key, value]) => collectScalarCandidates(value, key, depth + 1));
  }

  return [];
}

function pickCandidateValue(candidates: KeyValueCandidate[], keywords: string[]): string | null {
  for (const candidate of candidates) {
    const isMatch = keywords.some((keyword) => candidate.key.includes(keyword));
    if (isMatch) {
      return candidate.value;
    }
  }
  return null;
}

function normalizePotentialBarcode(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = String(value).trim().replace(/\s+/g, '');
  if (!normalized) {
    return null;
  }
  const cleaned = normalized.replace(/[^0-9A-Za-z-]/g, '');
  return cleaned.length > 0 ? cleaned : null;
}

function toLikelyBarcode(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const digits = value.replace(/\D/g, '');
  if (digits.length >= 8 && digits.length <= 32) {
    return digits;
  }
  const hasDigits = /\d/.test(value);
  if (hasDigits && value.length >= 8 && value.length <= 32) {
    return value;
  }
  return null;
}

function extractBarcodeFromCard(card: WbProductCard): string | null {
  const root = card as unknown as Record<string, unknown>;
  const barcodeCandidates: string[] = [];
  const barcodeKeys = ['barcode', 'barCode', 'barcodes', 'skus', 'sku', 'ean', 'gtin', 'shk', 'shtrihkod'];

  for (const key of barcodeKeys) {
    if (key in root) {
      barcodeCandidates.push(...extractStrings(root[key]));
    }
  }

  const sizes = Array.isArray(root.sizes) ? root.sizes : [];
  for (const size of sizes) {
    if (!size || typeof size !== 'object') {
      continue;
    }
    const sizeObj = size as Record<string, unknown>;
    for (const key of barcodeKeys) {
      if (key in sizeObj) {
        barcodeCandidates.push(...extractStrings(sizeObj[key]));
      }
    }
  }

  const characteristicPairs = getCharacteristicPairs(Array.isArray(card.characteristics) ? card.characteristics : []);
  const characteristicBarcode = pickCharacteristicValue(characteristicPairs, ['штрих', 'шк', 'barcode', 'ean', 'gtin']);
  if (characteristicBarcode) {
    barcodeCandidates.push(characteristicBarcode);
  }

  const scalarCandidates = collectScalarCandidates(card)
    .filter((candidate) => ['barcode', 'штрих', 'шк', 'ean', 'gtin', 'sku', 'skus'].some((keyword) => candidate.key.includes(keyword)))
    .map((candidate) => candidate.value);
  barcodeCandidates.push(...scalarCandidates);

  for (const candidate of barcodeCandidates) {
    const normalized = normalizePotentialBarcode(candidate);
    const likely = toLikelyBarcode(normalized);
    if (likely) {
      return likely;
    }
  }

  return null;
}

async function getTenantCards(tenantId: string, token: string): Promise<WbProductCard[]> {
  const cached = wbCardsCache.get(tenantId);
  if (cached && Date.now() - cached.fetchedAt <= WB_CARDS_CACHE_TTL_MS) {
    return cached.cards;
  }

  const mergeCards = (base: WbProductCard | undefined, overlay: WbProductCard): WbProductCard => ({
    ...base,
    ...overlay,
    nmID: overlay.nmID,
    vendorCode: overlay.vendorCode || base?.vendorCode,
    brand: overlay.brand || base?.brand,
    subjectName: overlay.subjectName || base?.subjectName,
    title: overlay.title || base?.title,
    description: overlay.description || base?.description,
    photos: Array.isArray(overlay.photos) && overlay.photos.length > 0 ? overlay.photos : base?.photos,
    video: overlay.video ?? base?.video,
    characteristics: Array.isArray(overlay.characteristics) && overlay.characteristics.length > 0
      ? overlay.characteristics
      : base?.characteristics,
  });

  // Run both card list fetches in parallel — previously sequential, this halves WB API wait time
  const [rootCards, mediaCards] = await Promise.all([
    wbApi.getAllCardsList(token, 100),
    wbApi.getAllCardsList(token, 100, { filter: { withPhoto: -1 } }),
  ]);
  const mergedMap = new Map<number, WbProductCard>();

  for (const card of rootCards) {
    if (Number.isFinite(card.nmID) && card.nmID > 0) {
      mergedMap.set(card.nmID, mergeCards(undefined, card));
    }
  }

  for (const card of mediaCards) {
    if (Number.isFinite(card.nmID) && card.nmID > 0) {
      mergedMap.set(card.nmID, mergeCards(mergedMap.get(card.nmID), card));
    }
  }

  const cards = Array.from(mergedMap.values());
  wbCardsCache.set(tenantId, { fetchedAt: Date.now(), cards });
  return cards;
}

async function getTenantToken(tenantId: string): Promise<string | null> {
  const [tenant] = await db
    .select({ wbApiToken: tenants.wbApiToken })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  const token = decryptIfNeeded(tenant?.wbApiToken ?? '');
  return token || null;
}

async function getTenantWarehouseMeasurements(
  tenantId: string,
  token: string,
  referenceDate: Date,
): Promise<WbWarehouseMeasurementItem[]> {
  const cacheKey = `${tenantId}:warehouse-measurements`;
  const cached = wbWarehouseMeasurementsCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt <= WB_MEASUREMENTS_CACHE_TTL_MS) {
    return cached.measurements;
  }
  const failedAt = wbWarehouseMeasurementsErrorCache.get(cacheKey);
  if (failedAt && Date.now() - failedAt <= WB_MEASUREMENTS_ERROR_RETRY_MS) {
    return [];
  }

  const { dateFromIso, dateToIso } = getMeasurementsDateRange(referenceDate);
  try {
    const measurements = await wbApi.getWarehouseMeasurements(token, {
      dateFrom: dateFromIso,
      dateTo: dateToIso,
      limit: 1000,
      offset: 0,
    });
    wbWarehouseMeasurementsErrorCache.delete(cacheKey);
    wbWarehouseMeasurementsCache.set(cacheKey, { fetchedAt: Date.now(), measurements });
    return measurements;
  } catch (error) {
    logger.warn({ err: error }, 'Warehouse measurements fetch failed');
    wbWarehouseMeasurementsErrorCache.set(cacheKey, Date.now());
    return [];
  }
}

async function getTenantMeasurementPenalties(
  tenantId: string,
  token: string,
  referenceDate: Date,
): Promise<WbMeasurementPenaltyItem[]> {
  const cacheKey = `${tenantId}:measurement-penalties`;
  const cached = wbMeasurementPenaltiesCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt <= WB_MEASUREMENTS_CACHE_TTL_MS) {
    return cached.penalties;
  }
  const failedAt = wbMeasurementPenaltiesErrorCache.get(cacheKey);
  if (failedAt && Date.now() - failedAt <= WB_MEASUREMENTS_ERROR_RETRY_MS) {
    return [];
  }

  const { dateFromIso, dateToIso } = getMeasurementsDateRange(referenceDate);
  try {
    const penalties = await wbApi.getMeasurementPenalties(token, {
      dateFrom: dateFromIso,
      dateTo: dateToIso,
      limit: 1000,
      offset: 0,
    });
    wbMeasurementPenaltiesErrorCache.delete(cacheKey);
    wbMeasurementPenaltiesCache.set(cacheKey, { fetchedAt: Date.now(), penalties });
    return penalties;
  } catch (error) {
    logger.warn({ err: error }, 'Measurement penalties fetch failed');
    wbMeasurementPenaltiesErrorCache.set(cacheKey, Date.now());
    return [];
  }
}

async function getTenantAcceptanceTariffs(
  tenantId: string,
  token: string,
): Promise<WbAcceptanceTariffItem[]> {
  const cacheKey = `${tenantId}:acceptance-tariffs`;
  const cached = wbAcceptanceTariffsCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt <= WB_ACCEPTANCE_TARIFFS_CACHE_TTL_MS) {
    return cached.tariffs;
  }

  try {
    const tariffs = await wbApi.getAcceptanceTariffs(token);
    wbAcceptanceTariffsCache.set(cacheKey, { fetchedAt: Date.now(), tariffs });
    return tariffs;
  } catch (error) {
    logger.warn({ err: error }, 'Acceptance tariffs fetch failed');
    return [];
  }
}

async function getTenantCategoryCommissions(
  tenantId: string,
  token: string,
): Promise<WbCategoryCommissionItem[]> {
  const cacheKey = `${tenantId}:category-commissions`;
  const cached = wbCategoryCommissionsCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt <= WB_CATEGORY_COMMISSIONS_CACHE_TTL_MS) {
    return cached.commissions;
  }

  try {
    const commissions = await wbApi.getCategoryCommissions(token, 'ru');
    wbCategoryCommissionsCache.set(cacheKey, { fetchedAt: Date.now(), commissions });
    return commissions;
  } catch (error) {
    logger.warn({ err: error }, 'Category commissions fetch failed');
    return [];
  }
}

async function getTenantBoxTariffs(
  tenantId: string,
  token: string,
  date: string,
): Promise<WbBoxTariffItem[]> {
  const cacheKey = `${tenantId}:box-tariffs:${date}`;
  const cached = wbBoxTariffsCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt <= WB_BOX_TARIFFS_CACHE_TTL_MS) {
    return cached.tariffs;
  }

  try {
    const tariffs = await wbApi.getBoxTariffs(token, date);
    wbBoxTariffsCache.set(cacheKey, { fetchedAt: Date.now(), tariffs });
    return tariffs;
  } catch (error) {
    logger.warn({ err: error }, 'Box tariffs fetch failed');
    return [];
  }
}

async function getTenantReturnTariffs(
  tenantId: string,
  token: string,
  date: string,
): Promise<WbReturnTariffItem[]> {
  const cacheKey = `${tenantId}:return-tariffs:${date}`;
  const cached = wbReturnTariffsCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt <= WB_RETURN_TARIFFS_CACHE_TTL_MS) {
    return cached.tariffs;
  }

  try {
    const tariffs = await wbApi.getReturnTariffs(token, date);
    wbReturnTariffsCache.set(cacheKey, { fetchedAt: Date.now(), tariffs });
    return tariffs;
  } catch (error) {
    logger.warn({ err: error }, 'Return tariffs fetch failed');
    return [];
  }
}

async function getBuyoutFactsByNm(
  tenantId: string,
  dateFrom: Date,
  dateTo: Date,
  nmIds: number[],
): Promise<Map<number, BuyoutFactRow>> {
  if (!Array.isArray(nmIds) || nmIds.length === 0) {
    return new Map();
  }

  const uniqueNmIds = Array.from(new Set(nmIds.filter((value) => Number.isFinite(value) && value > 0)));
  if (uniqueNmIds.length === 0) {
    return new Map();
  }

  const fromIso = dateFrom.toISOString();
  const toExclusiveIso = new Date(dateTo.getTime() + 86_400_000).toISOString();
  const lookbackFromIso = new Date(dateTo.getTime() - (89 * 86_400_000)).toISOString();
  const factFromIso = new Date(Math.min(dateFrom.getTime(), new Date(lookbackFromIso).getTime())).toISOString();
  const nmIdSql = sql.join(uniqueNmIds.map((value) => sql`${value}`), sql`, `);

  const rows = await withTenantContext(db, tenantId, (tx) => tx.execute(sql`
    WITH nm_pool AS (
      SELECT UNNEST(ARRAY[${nmIdSql}]::bigint[]) AS nm_id
    ),
    order_stats AS (
      SELECT
        nm_id,
        COUNT(*) FILTER (WHERE is_cancel = false)::numeric AS order_count,
        COUNT(*) FILTER (WHERE is_cancel = true)::numeric AS cancel_count
      FROM raw_api_orders
      WHERE tenant_id = ${tenantId}
        AND date >= ${factFromIso}::timestamp
        AND date < ${toExclusiveIso}::timestamp
        AND nm_id IN (${nmIdSql})
      GROUP BY nm_id
    ),
    sales_stats AS (
      SELECT
        nm_id,
        COUNT(*) FILTER (WHERE is_storno = false)::numeric AS buyout_count,
        COUNT(*) FILTER (WHERE is_storno = true)::numeric AS return_count
      FROM raw_api_sales
      WHERE tenant_id = ${tenantId}
        AND date >= ${factFromIso}::timestamp
        AND date < ${toExclusiveIso}::timestamp
        AND nm_id IN (${nmIdSql})
      GROUP BY nm_id
    ),
    funnel_stats AS (
      SELECT
        nm_id,
        SUM(order_count)::numeric AS order_count,
        SUM(buyout_count)::numeric AS buyout_count,
        SUM(cancel_count)::numeric AS cancel_count,
        CASE
          WHEN (SUM(buyout_count) + SUM(cancel_count)) > 0
            THEN (
              SUM(buyout_count)::numeric
              / NULLIF((SUM(buyout_count) + SUM(cancel_count))::numeric, 0)
            ) * 100
          ELSE NULL
        END::numeric AS buyout_percent
      FROM raw_api_funnel_stats
      WHERE tenant_id = ${tenantId}
        AND period_start::date = period_end::date
        AND period_start >= ${factFromIso}::timestamp
        AND period_start < ${toExclusiveIso}::timestamp
        AND nm_id IN (${nmIdSql})
      GROUP BY nm_id
    ),
    lk_funnel_stats AS (
      SELECT
        nm_id,
        SUM(order_count)::numeric AS order_count,
        SUM(buyout_count)::numeric AS buyout_count,
        SUM(cancel_count)::numeric AS cancel_count,
        CASE
          WHEN (SUM(buyout_count) + SUM(cancel_count)) > 0
            THEN (
              SUM(buyout_count)::numeric
              / NULLIF((SUM(buyout_count) + SUM(cancel_count))::numeric, 0)
            ) * 100
          ELSE NULL
        END::numeric AS buyout_percent
      FROM raw_api_sales_funnel_nm_daily
      WHERE tenant_id = ${tenantId}
        AND date >= ${factFromIso}::timestamp
        AND date < ${toExclusiveIso}::timestamp
        AND nm_id IN (${nmIdSql})
      GROUP BY nm_id
    ),
    activity_events AS (
      SELECT nm_id, date AS activity_at
      FROM raw_api_orders
      WHERE tenant_id = ${tenantId}
        AND date < ${toExclusiveIso}::timestamp
        AND nm_id IN (${nmIdSql})
      UNION ALL
      SELECT nm_id, date AS activity_at
      FROM raw_api_sales
      WHERE tenant_id = ${tenantId}
        AND date < ${toExclusiveIso}::timestamp
        AND nm_id IN (${nmIdSql})
      UNION ALL
      SELECT nm_id, period_start AS activity_at
      FROM raw_api_funnel_stats
      WHERE tenant_id = ${tenantId}
        AND period_start < ${toExclusiveIso}::timestamp
        AND nm_id IN (${nmIdSql})
      UNION ALL
      SELECT nm_id, date AS activity_at
      FROM raw_api_sales_funnel_nm_daily
      WHERE tenant_id = ${tenantId}
        AND date < ${toExclusiveIso}::timestamp
        AND nm_id IN (${nmIdSql})
    ),
    activity_stats AS (
      SELECT
        nm_id,
        MIN(activity_at)::date AS first_activity_date,
        MAX(activity_at)::date AS last_activity_date
      FROM activity_events
      GROUP BY nm_id
    )
    SELECT
      p.nm_id AS "nmId",
      CASE
        WHEN f.buyout_percent IS NOT NULL THEN COALESCE(f.order_count, 0)
        WHEN lk.buyout_percent IS NOT NULL THEN COALESCE(lk.order_count, 0)
        ELSE COALESCE(o.order_count, 0)
      END::numeric AS "orderCount",
      CASE
        WHEN f.buyout_percent IS NOT NULL THEN COALESCE(f.buyout_count, 0)
        WHEN lk.buyout_percent IS NOT NULL THEN COALESCE(lk.buyout_count, 0)
        ELSE COALESCE(s.buyout_count, 0)
      END::numeric AS "buyoutCount",
      CASE
        WHEN f.buyout_percent IS NOT NULL THEN COALESCE(f.cancel_count, 0)
        WHEN lk.buyout_percent IS NOT NULL THEN COALESCE(lk.cancel_count, 0)
        ELSE COALESCE(o.cancel_count, 0)
      END::numeric AS "cancelCount",
      COALESCE(s.return_count, 0)::numeric AS "returnCount",
      CASE
        WHEN f.buyout_percent IS NOT NULL
          THEN f.buyout_percent
        WHEN lk.buyout_percent IS NOT NULL
          THEN lk.buyout_percent
        WHEN (COALESCE(s.buyout_count, 0) + COALESCE(o.cancel_count, 0) + COALESCE(s.return_count, 0)) > 0
          THEN (
            COALESCE(s.buyout_count, 0)
            / (COALESCE(s.buyout_count, 0) + COALESCE(o.cancel_count, 0) + COALESCE(s.return_count, 0))
          ) * 100
        WHEN COALESCE(o.order_count, 0) > 0
          THEN (COALESCE(s.buyout_count, 0) / COALESCE(o.order_count, 0)) * 100
        ELSE NULL
      END::numeric AS "buyoutPercent",
      CASE
        WHEN a.first_activity_date IS NULL THEN 0
        ELSE GREATEST(0, (${toExclusiveIso}::date - a.first_activity_date))
      END::numeric AS "historyDays",
      a.first_activity_date::text AS "firstActivityDate",
      a.last_activity_date::text AS "lastActivityDate"
    FROM nm_pool p
    LEFT JOIN order_stats o ON o.nm_id = p.nm_id
    LEFT JOIN sales_stats s ON s.nm_id = p.nm_id
    LEFT JOIN funnel_stats f ON f.nm_id = p.nm_id
    LEFT JOIN lk_funnel_stats lk ON lk.nm_id = p.nm_id
    LEFT JOIN activity_stats a ON a.nm_id = p.nm_id
  `)) as BuyoutFactRow[];

  const map = new Map<number, BuyoutFactRow>();
  for (const row of rows) {
    const nmId = toNumber(row.nmId);
    if (nmId > 0) {
      map.set(nmId, row);
    }
  }
  return map;
}

/**
 * WB-side authoritative volume per nmId from products.wb_warehouse_volume_liters
 * (sourced from /api/v1/warehouse_remains by the WB sync). This is the same
 * number that appears as «Объём, л» in the cabinet's stocks xlsx export and
 * that WB charges logistics/storage on. Takes priority over warehouse-
 * measurements (which is sometimes empty for combo-pack SKUs).
 */
async function getWbWarehouseVolumeByNm(
  tenantId: string,
  nmIds: number[],
): Promise<Map<number, number>> {
  if (!Array.isArray(nmIds) || nmIds.length === 0) return new Map();
  const uniqueNmIds = Array.from(new Set(nmIds.filter((value) => Number.isFinite(value) && value > 0)));
  if (uniqueNmIds.length === 0) return new Map();

  const nmIdSql = sql.join(uniqueNmIds.map((value) => sql`${value}`), sql`, `);
  const rows = await withTenantContext(db, tenantId, (tx) => tx.execute(sql`
    SELECT nm_id, wb_warehouse_volume_liters
    FROM products
    WHERE tenant_id = ${tenantId}
      AND nm_id IN (${nmIdSql})
      AND wb_warehouse_volume_liters IS NOT NULL
  `));

  const map = new Map<number, number>();
  const typed = rows as unknown as Array<{ nm_id: unknown; wb_warehouse_volume_liters: unknown }>;
  for (const row of typed) {
    const nmId = toNumber(row.nm_id);
    const value = toNumber(row.wb_warehouse_volume_liters);
    if (nmId > 0 && Number.isFinite(value) && value > 0) {
      map.set(nmId, value);
    }
  }
  return map;
}

async function getTopWbStockWarehousesByNm(
  tenantId: string,
  nmIds: number[],
  limitPerNm = 6,
): Promise<Map<number, WbStockWarehouseSuggestion[]>> {
  if (!Array.isArray(nmIds) || nmIds.length === 0) return new Map();
  const uniqueNmIds = Array.from(new Set(nmIds.filter((value) => Number.isFinite(value) && value > 0)));
  if (uniqueNmIds.length === 0) return new Map();

  const nmIdSql = sql.join(uniqueNmIds.map((value) => sql`${value}`), sql`, `);
  const rows = await withTenantContext(db, tenantId, (tx) => tx.execute(sql`
    WITH stock_rows AS (
      SELECT
        nm_id,
        TRIM(warehouse_name)::text AS warehouse_name,
        SUM(GREATEST(amount, 0))::numeric AS quantity,
        MAX(date) AS last_seen_at
      FROM raw_api_stocks
      WHERE tenant_id = ${tenantId}
        AND nm_id IN (${nmIdSql})
        AND amount > 0
        AND NULLIF(TRIM(warehouse_name), '') IS NOT NULL
      GROUP BY nm_id, TRIM(warehouse_name)
    ),
    latest_sizes AS (
      SELECT MAX(snapshot_date) AS snapshot_date
      FROM raw_api_stock_sizes
      WHERE tenant_id = ${tenantId}
        AND stock_type = 'wb'
    ),
    size_rows AS (
      SELECT
        ss.nm_id,
        TRIM(ss.office_name)::text AS warehouse_name,
        SUM(GREATEST(ss.stock_count, 0))::numeric AS quantity,
        MAX(ss.snapshot_date) AS last_seen_at
      FROM raw_api_stock_sizes ss
      JOIN latest_sizes latest ON latest.snapshot_date = ss.snapshot_date
      WHERE ss.tenant_id = ${tenantId}
        AND ss.stock_type = 'wb'
        AND ss.nm_id IN (${nmIdSql})
        AND ss.stock_count > 0
        AND NULLIF(TRIM(ss.office_name), '') IS NOT NULL
      GROUP BY ss.nm_id, TRIM(ss.office_name)
    ),
    combined AS (
      SELECT nm_id, warehouse_name, quantity, last_seen_at, 'stocks'::text AS source
      FROM stock_rows

      UNION ALL

      SELECT nm_id, warehouse_name, quantity, last_seen_at, 'stock_sizes'::text AS source
      FROM size_rows sr
      WHERE NOT EXISTS (
        SELECT 1 FROM stock_rows st WHERE st.nm_id = sr.nm_id
      )
    ),
    ranked AS (
      SELECT
        nm_id,
        warehouse_name,
        quantity,
        source,
        ROW_NUMBER() OVER (
          PARTITION BY nm_id
          ORDER BY quantity DESC, last_seen_at DESC NULLS LAST, warehouse_name ASC
        ) AS rn
      FROM combined
    )
    SELECT nm_id, warehouse_name, quantity, source
    FROM ranked
    WHERE rn <= ${limitPerNm}
    ORDER BY nm_id, rn
  `));

  const result = new Map<number, WbStockWarehouseSuggestion[]>();
  const typed = rows as unknown as Array<{
    nm_id: unknown;
    warehouse_name: unknown;
    quantity: unknown;
    source: unknown;
  }>;
  for (const row of typed) {
    const nmId = toNumber(row.nm_id);
    const warehouseName = typeof row.warehouse_name === 'string' ? row.warehouse_name.trim() : '';
    const quantity = toNumber(row.quantity);
    if (nmId <= 0 || !warehouseName || quantity <= 0) {
      continue;
    }
    const current = result.get(nmId) ?? [];
    current.push({
      warehouseName,
      quantity,
      source: row.source === 'stock_sizes' ? 'stock_sizes' : 'stocks',
    });
    result.set(nmId, current);
  }
  return result;
}

function normalizeWarehouseNameForDedupe(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function mergeWarehouseNames(...groups: string[][]): string[] {
  const byKey = new Map<string, string>();
  for (const group of groups) {
    for (const name of group) {
      const label = name.trim();
      if (!label) {
        continue;
      }
      const key = normalizeWarehouseNameForDedupe(label);
      if (key && !byKey.has(key)) {
        byKey.set(key, label);
      }
    }
  }
  return Array.from(byKey.values());
}

function getTariffWarehouseNames(...tariffGroups: unknown[][]): string[] {
  const names: string[] = [];
  for (const group of tariffGroups) {
    for (const item of group) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        continue;
      }
      const rawName = (item as Record<string, unknown>).warehouseName;
      if (typeof rawName === 'string' && rawName.trim()) {
        names.push(rawName.trim());
      }
    }
  }
  return names;
}

async function getObservedWbWarehouseNames(tenantId: string): Promise<string[]> {
  const rows = await withTenantContext(db, tenantId, (tx) => tx.execute(sql`
    WITH candidates AS (
      SELECT
        warehouse_name::text AS warehouse_name,
        MAX(date) AS last_seen_at,
        SUM(GREATEST(amount, 0))::numeric AS weight
      FROM raw_api_stocks
      WHERE tenant_id = ${tenantId}
      GROUP BY warehouse_name

      UNION ALL

      SELECT
        office_name::text AS warehouse_name,
        MAX(snapshot_date) AS last_seen_at,
        SUM(GREATEST(stock_count, 0))::numeric AS weight
      FROM raw_api_stock_offices
      WHERE tenant_id = ${tenantId}
        AND stock_type = 'wb'
      GROUP BY office_name

      UNION ALL

      SELECT
        warehouse_name::text AS warehouse_name,
        MAX(date) AS last_seen_at,
        0::numeric AS weight
      FROM raw_api_paid_storage
      WHERE tenant_id = ${tenantId}
      GROUP BY warehouse_name
    )
    SELECT warehouse_name
    FROM (
      SELECT
        TRIM(warehouse_name) AS warehouse_name,
        MAX(last_seen_at) AS last_seen_at,
        SUM(weight) AS weight
      FROM candidates
      WHERE NULLIF(TRIM(warehouse_name), '') IS NOT NULL
      GROUP BY TRIM(warehouse_name)
    ) grouped
    ORDER BY
      COALESCE(weight, 0) DESC,
      last_seen_at DESC NULLS LAST,
      warehouse_name ASC
    LIMIT 300
  `));

  return mergeWarehouseNames(
    (rows as unknown as Array<{ warehouse_name: unknown }>)
      .map((row) => (typeof row.warehouse_name === 'string' ? row.warehouse_name : ''))
      .filter(Boolean),
  );
}

async function getHiddenProductNmIds(tenantId: string): Promise<Set<number>> {
  const rows = await withTenantContext(db, tenantId, (tx) =>
    tx
      .select({ nmId: products.nmId })
      .from(products)
      .where(and(
        eq(products.tenantId, tenantId),
        eq(products.isHidden, true),
      )),
  );

  return new Set(
    rows
      .map((row) => toNumber(row.nmId))
      .filter((nmId) => nmId > 0),
  );
}

/**
 * Latest WB-reported localizationPercent per nmId from raw_api_funnel_stats.
 * Returns the freshest non-null aggregate value (by period_end DESC). Daily
 * DETAIL_HISTORY rows do not expose localization and must not shadow the
 * aggregate WB funnel value with legacy zeroes.
 */
async function getLocalizationPercentByNm(
  tenantId: string,
  nmIds: number[],
): Promise<Map<number, number>> {
  if (!Array.isArray(nmIds) || nmIds.length === 0) return new Map();
  const uniqueNmIds = Array.from(new Set(nmIds.filter((value) => Number.isFinite(value) && value > 0)));
  if (uniqueNmIds.length === 0) return new Map();

  const nmIdSql = sql.join(uniqueNmIds.map((value) => sql`${value}`), sql`, `);
  const rows = await withTenantContext(db, tenantId, (tx) => tx.execute(sql`
    SELECT DISTINCT ON (nm_id)
      nm_id,
      localization_percent
    FROM raw_api_funnel_stats
    WHERE tenant_id = ${tenantId}
      AND nm_id IN (${nmIdSql})
      AND localization_percent IS NOT NULL
      AND period_start::date <> period_end::date
    ORDER BY nm_id, period_end DESC, period_start ASC
  `));

  const map = new Map<number, number>();
  const typed = rows as unknown as Array<{ nm_id: unknown; localization_percent: unknown }>;
  for (const row of typed) {
    const nmId = toNumber(row.nm_id);
    const value = toNumber(row.localization_percent);
    if (nmId > 0 && Number.isFinite(value)) {
      map.set(nmId, value);
    }
  }
  return map;
}

function resolveCategoryCommissionRates(
  categoryName: string | null,
  commissions: WbCategoryCommissionItem[],
): { fbw: number | null; fbs: number | null } {
  const empty = { fbw: null, fbs: null } as const;
  if (!categoryName || commissions.length === 0) {
    return { ...empty };
  }

  const normalizedCategory = normalizeCategoryKey(categoryName);
  if (!normalizedCategory) {
    return { ...empty };
  }

  const normalizeCommissionName = (value: string) => normalizeCategoryKey(value);
  const pickFinite = (...values: Array<number | null | undefined>) => {
    const found = values.find((value) => typeof value === 'number' && Number.isFinite(value));
    return typeof found === 'number' ? found : null;
  };
  const readCommission = (item: WbCategoryCommissionItem, ...keys: string[]) => {
    const raw = item as unknown as Record<string, unknown>;
    for (const key of keys) {
      const value = raw[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
    }
    return null;
  };

  const exact = commissions.find((item) =>
    normalizeCommissionName(item.subjectName) === normalizedCategory
  );
  if (exact) {
    const supplierCommission = readCommission(exact, 'supplierCommission', 'kgvpSupplier');
    const marketplaceCommission = readCommission(exact, 'marketplaceCommission', 'kgvpMarketplace');
    const paidStorageCommission = readCommission(exact, 'paidStorageCommission', 'paidStorageKgvp');
    const fbw = pickFinite(
      paidStorageCommission,
      supplierCommission,
      marketplaceCommission,
    );
    const fbs = pickFinite(
      marketplaceCommission,
      supplierCommission,
      paidStorageCommission,
    );
    return { fbw, fbs };
  }

  const inclusive = commissions.find((item) => {
    const normalizedSubject = normalizeCommissionName(item.subjectName);
    return normalizedSubject.includes(normalizedCategory) || normalizedCategory.includes(normalizedSubject);
  });

  if (!inclusive) {
    return { ...empty };
  }

  const supplierCommission = readCommission(inclusive, 'supplierCommission', 'kgvpSupplier');
  const marketplaceCommission = readCommission(inclusive, 'marketplaceCommission', 'kgvpMarketplace');
  const paidStorageCommission = readCommission(inclusive, 'paidStorageCommission', 'paidStorageKgvp');
  const fbw = pickFinite(
    paidStorageCommission,
    supplierCommission,
    marketplaceCommission,
  );
  const fbs = pickFinite(
    marketplaceCommission,
    supplierCommission,
    paidStorageCommission,
  );
  return { fbw, fbs };
}

async function getCardDimensions(
  tenantId: string,
  token: string,
  nmId: number,
  preloadedCards?: WbProductCard[],
  wbMeasuredDimensions?: WbMeasuredDimensions | null,
): Promise<CardDimensions | null> {
  if (!Number.isFinite(nmId) || nmId <= 0) {
    return null;
  }

  try {
    const cards = preloadedCards ?? await getTenantCards(tenantId, token);
    const target = cards.find((card) => Number(card.nmID) === nmId);
    const measuredWbVolumeLiters = resolveMeasuredVolumeLiters(wbMeasuredDimensions);
    if (!target) {
      if (!measuredWbVolumeLiters) {
        return null;
      }
      return {
        categoryFromCard: null,
        barcodeFromCard: null,
        volumeLiters: null,
        wbVolumeLiters: measuredWbVolumeLiters,
        volume: null,
        length: null,
        width: null,
        height: null,
      };
    }

    const pairs = getCharacteristicPairs(Array.isArray(target.characteristics) ? target.characteristics : []);
    const scalarCandidates = collectScalarCandidates(target);
    const cardDimensions = (target as unknown as Record<string, unknown>).dimensions as Record<string, unknown> | undefined;
    const dimensionLength = toNumber(cardDimensions?.length);
    const dimensionWidth = toNumber(cardDimensions?.width);
    const dimensionHeight = toNumber(cardDimensions?.height);
    const volumeFromDimensions = dimensionLength > 0 && dimensionWidth > 0 && dimensionHeight > 0
      ? normalizeValue(`${((dimensionLength * dimensionWidth * dimensionHeight) / 1000).toFixed(2)} л`)
      : null;

    const characteristicVolume = pickCharacteristicValue(pairs, ['литраж', 'объем', 'объём', 'обьем', 'обьем товара', 'volume']);
    const characteristicLength = pickCharacteristicValue(pairs, ['длина']);
    const characteristicWidth = pickCharacteristicValue(pairs, ['ширина']);
    const characteristicHeight = pickCharacteristicValue(pairs, ['высота']);

    const fallbackVolume = pickCandidateValue(scalarCandidates, ['volume', 'объем', 'объём', 'литраж']);
    const fallbackLength = pickCandidateValue(scalarCandidates, ['length', 'длина']);
    const fallbackWidth = pickCandidateValue(scalarCandidates, ['width', 'ширина']);
    const fallbackHeight = pickCandidateValue(scalarCandidates, ['height', 'высота']);

    const resolvedLength = dimensionLength > 0
      ? String(dimensionLength)
      : (characteristicLength ?? fallbackLength ?? null);
    const resolvedWidth = dimensionWidth > 0
      ? String(dimensionWidth)
      : (characteristicWidth ?? fallbackWidth ?? null);
    const resolvedHeight = dimensionHeight > 0
      ? String(dimensionHeight)
      : (characteristicHeight ?? fallbackHeight ?? null);
    const resolvedVolume = characteristicVolume ?? volumeFromDimensions ?? fallbackVolume ?? null;
    const resolvedVolumeLiters = toNumber((resolvedVolume ?? '').replace(',', '.').replace(/[^\d.]/g, '')) || null;
    const barcodeFromCard = extractBarcodeFromCard(target);

    // «Литраж факт. WB» comes only from WB API
    // (warehouse_remains → warehouse-measurements). Card-side fallback stays in
    // `volumeLiters` and is applied by the tariff calculation helper.
    const wbVolumeLiters = measuredWbVolumeLiters ?? null;

    return {
      categoryFromCard: target.subjectName?.trim() || null,
      barcodeFromCard,
      volumeLiters: resolvedVolumeLiters,
      wbVolumeLiters,
      volume: resolvedVolume,
      length: resolvedLength,
      width: resolvedWidth,
      height: resolvedHeight,
    };
  } catch (error) {
    logger.warn({ err: error }, 'Card dimensions fetch failed');
    return null;
  }
}

export const GET = apiRoute(async (request: Request) => {
    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get('from');
    const dateTo = searchParams.get('to');
    const templateScope: TemplateScope = searchParams.get('scope') === 'costed' ? 'costed' : 'all';

    if (!dateFrom || !dateTo) {
      return NextResponse.json({ error: 'Missing req parameters' }, { status: 400 });
    }

    const parsedDateFrom = parseApiDateParam(dateFrom);
    const parsedDateTo = parseApiDateParam(dateTo);
    if (!parsedDateFrom || !parsedDateTo) {
      return NextResponse.json({ error: 'Invalid date parameters' }, { status: 400 });
    }

    const { tenantId } = await requireActiveTenant(request);

    const tenantRow = await db
      .select({ taxType: tenants.taxType, taxRate: tenants.taxRate })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1)
      .then((rows) => rows[0] ?? null);
    const defaultTaxPercent = tenantRow
      ? resolveTaxRatePercent(tenantRow.taxType, tenantRow.taxRate)
      : 6;

    const tableData = (await AnalyticsEngine.getUnitEconomics(tenantId, parsedDateFrom, parsedDateTo, {
      calculationMode: 'PLAN_TEMPLATE',
    })) as UnitEconomicsRow[];
    const analyticsRows = Array.isArray(tableData)
      ? tableData.filter((row) => toNumber(row.nmId) > 0)
      : [];

    // Parallelize: token fetch + tariff DB queries + catalog visibility — all independent
    const measurementReferenceDate = parsedDateTo;
    const [
      token,
      [dbAcceptance, dbBox, dbReturn, dbCommissions],
      observedWbWarehouseNames,
      hiddenNmIds,
      costedNmIds,
    ] = await Promise.all([
      getTenantToken(tenantId),
      withTenantContext(db, tenantId, (tx) => Promise.all([
        tx.select({ data: wbTariffSnapshotsTable.data }).from(wbTariffSnapshotsTable)
          .where(and(eq(wbTariffSnapshotsTable.tenantId, tenantId), eq(wbTariffSnapshotsTable.tariffType, 'acceptance')))
          .orderBy(desc(wbTariffSnapshotsTable.createdAt)).limit(1),
        tx.select({ data: wbTariffSnapshotsTable.data }).from(wbTariffSnapshotsTable)
          .where(and(eq(wbTariffSnapshotsTable.tenantId, tenantId), eq(wbTariffSnapshotsTable.tariffType, 'box')))
          .orderBy(desc(wbTariffSnapshotsTable.createdAt)).limit(1),
        tx.select({ data: wbTariffSnapshotsTable.data }).from(wbTariffSnapshotsTable)
          .where(and(eq(wbTariffSnapshotsTable.tenantId, tenantId), eq(wbTariffSnapshotsTable.tariffType, 'return')))
          .orderBy(desc(wbTariffSnapshotsTable.createdAt)).limit(1),
        tx.select({ data: wbCategoryCommissionSnapshotsTable.data }).from(wbCategoryCommissionSnapshotsTable)
          .where(eq(wbCategoryCommissionSnapshotsTable.tenantId, tenantId))
          .orderBy(desc(wbCategoryCommissionSnapshotsTable.createdAt)).limit(1),
      ])),
      getObservedWbWarehouseNames(tenantId),
      getHiddenProductNmIds(tenantId),
      templateScope === 'costed' ? getCostedProductNmIds(tenantId) : Promise.resolve(new Set<number>()),
    ]);

    // Warehouse measurements need the token, so fetch in second batch (still parallel with each other)
    let warehouseMeasurements: WbWarehouseMeasurementItem[] = [];
    let measurementPenalties: WbMeasurementPenaltyItem[] = [];
    if (token) {
      [warehouseMeasurements, measurementPenalties] = await Promise.all([
        withOptionalWbTimeout(
          getTenantWarehouseMeasurements(tenantId, token, measurementReferenceDate),
          [],
          'warehouse-measurements',
          WB_OPTIONAL_ENRICHMENT_TIMEOUT_MS,
          () => wbWarehouseMeasurementsErrorCache.set(`${tenantId}:warehouse-measurements`, Date.now()),
        ),
        withOptionalWbTimeout(
          getTenantMeasurementPenalties(tenantId, token, measurementReferenceDate),
          [],
          'measurement-penalties',
          WB_OPTIONAL_ENRICHMENT_TIMEOUT_MS,
          () => wbMeasurementPenaltiesErrorCache.set(`${tenantId}:measurement-penalties`, Date.now()),
        ),
      ]);
    }
    const wbMeasuredDimensionsByNm = buildWbMeasuredDimensionsByNm(warehouseMeasurements, measurementPenalties);

    let acceptanceTariffs = parseSnapshotArray<WbAcceptanceTariffItem>(dbAcceptance[0]?.data, 'acceptance tariffs');
    let categoryCommissions = parseSnapshotArray<WbCategoryCommissionItem>(dbCommissions[0]?.data, 'category commissions');
    let cards: WbProductCard[] = [];

    const hasDbTariffs = acceptanceTariffs.length > 0 || categoryCommissions.length > 0;

    // If DB has no tariffs yet (first run), try WB API with timeout
    if (!hasDbTariffs && token) {
      const WB_API_TIMEOUT_MS = 15_000;
      try {
        const result = await Promise.race<[WbProductCard[], WbAcceptanceTariffItem[], WbCategoryCommissionItem[]]>([
          Promise.all([
            getTenantCards(tenantId, token),
            getTenantAcceptanceTariffs(tenantId, token),
            getTenantCategoryCommissions(tenantId, token),
          ]) as Promise<[WbProductCard[], WbAcceptanceTariffItem[], WbCategoryCommissionItem[]]>,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('WB API timeout')), WB_API_TIMEOUT_MS)
          ),
        ]);
        [cards, acceptanceTariffs, categoryCommissions] = result;
      } catch (wbError) {
        logger.warn({ err: wbError }, 'WB API fallback failed');
      }
    } else if (token) {
      // DB has tariffs — only load cards from cache (fast, no WB API if cached)
      try {
        cards = await getTenantCards(tenantId, token);
      } catch {
        // Cards will be empty, dimensions from DB products table used instead
      }
    }

    const tariffsByDate = new Map<string, WbAcceptanceTariffItem[]>();
    for (const tariff of acceptanceTariffs) {
      const tariffDate = typeof tariff.date === 'string' ? tariff.date.slice(0, 10) : '';
      if (!tariffDate) {
        continue;
      }
      const existing = tariffsByDate.get(tariffDate);
      if (existing) {
        existing.push(tariff);
      } else {
        tariffsByDate.set(tariffDate, [tariff]);
      }
    }

    const requestedDate = dateOnly(parsedDateTo);
    const todayMoscow = dateOnlyMoscow(new Date());
    const preferredDates = [todayMoscow, requestedDate];
    let targetDate = preferredDates.find((value) => tariffsByDate.has(value)) ?? null;

    if (!targetDate) {
      const availableDates = Array.from(tariffsByDate.keys()).sort();
      targetDate = availableDates.at(-1) ?? requestedDate;
    }

    const acceptanceTariffsForTargetDate = targetDate ? (tariffsByDate.get(targetDate) ?? []) : [];
    // Prefer DB snapshots; if the sync has not saved them yet, fetch live once
    // and rely on the in-memory tenant cache to avoid repeated WB calls.
    let boxTariffsForTargetDate = parseSnapshotArray<WbBoxTariffItem>(dbBox[0]?.data, 'box tariffs');
    let returnTariffsForTargetDate = parseSnapshotArray<WbReturnTariffItem>(dbReturn[0]?.data, 'return tariffs');

    if (token && (boxTariffsForTargetDate.length === 0 || returnTariffsForTargetDate.length === 0)) {
      const liveTariffDate = targetDate ?? requestedDate;
      const [liveBoxTariffs, liveReturnTariffs] = await Promise.all([
        boxTariffsForTargetDate.length === 0
          ? getTenantBoxTariffs(tenantId, token, liveTariffDate)
          : Promise.resolve(boxTariffsForTargetDate),
        returnTariffsForTargetDate.length === 0
          ? getTenantReturnTariffs(tenantId, token, liveTariffDate)
          : Promise.resolve(returnTariffsForTargetDate),
      ]);
      boxTariffsForTargetDate = liveBoxTariffs;
      returnTariffsForTargetDate = liveReturnTariffs;
    }

    const wbWarehouseNames = mergeWarehouseNames(
      observedWbWarehouseNames,
      getTariffWarehouseNames(acceptanceTariffsForTargetDate, boxTariffsForTargetDate, returnTariffsForTargetDate),
    );

    const cardsByNmId = new Map<number, WbProductCard>();
    for (const card of cards) {
      if (Number.isFinite(card.nmID) && card.nmID > 0) {
        cardsByNmId.set(card.nmID, card);
      }
    }

    const allRowsForTemplate = mergeCabinetCardRows(analyticsRows, cards, hiddenNmIds);
    const rowsForTemplate = templateScope === 'costed'
      ? allRowsForTemplate.filter((row) => costedNmIds.has(toNumber(row.nmId)))
      : allRowsForTemplate;
    if (rowsForTemplate.length === 0) {
      return NextResponse.json({ data: [], manualInputsByNm: {}, wbWarehouseNames });
    }

    const nmIds = rowsForTemplate
      .map((row) => toNumber(row.nmId))
      .filter((value) => Number.isFinite(value) && value > 0);

    const [manualInputRows, buyoutFactsByNm, localizationByNm, wbWarehouseVolumeByNm, wbStockWarehousesByNm, cabinetIndices] = await Promise.all([
      nmIds.length > 0
        ? withTenantContext(db, tenantId, (tx) =>
            tx
              .select({
                nmId: unitEconomicsManualInputs.nmId,
                manualFields: unitEconomicsManualInputs.manualFields,
              })
              .from(unitEconomicsManualInputs)
              .where(and(
                eq(unitEconomicsManualInputs.tenantId, tenantId),
                inArray(unitEconomicsManualInputs.nmId, nmIds),
              ))
          )
        : Promise.resolve([]),
      getBuyoutFactsByNm(
        tenantId,
        parsedDateFrom,
        parsedDateTo,
        nmIds,
      ),
      getLocalizationPercentByNm(
        tenantId,
        nmIds,
      ),
      getWbWarehouseVolumeByNm(
        tenantId,
        nmIds,
      ),
      getTopWbStockWarehousesByNm(
        tenantId,
        nmIds,
      ),
      resolveCabinetEconomicsIndices(tenantId, parsedDateTo),
    ]);

    const rawManualInputsByNm = new Map<number, unknown>();
    for (const row of manualInputRows) {
      const nmId = Number(row.nmId);
      if (!Number.isFinite(nmId) || nmId <= 0) {
        continue;
      }
      rawManualInputsByNm.set(nmId, row.manualFields);
    }

    const manualInputsByNm: Record<string, Record<string, unknown>> = {};
    for (const nmId of nmIds) {
      const rawPayload = rawManualInputsByNm.get(nmId);
      const stockSuggestions = wbStockWarehousesByNm.get(nmId) ?? [];
      if (templateScope === 'costed' && stockSuggestions.length > 0) {
        manualInputsByNm[String(nmId)] = withAutoStockWarehouses(rawPayload, stockSuggestions);
      } else if (rawPayload && typeof rawPayload === 'object' && !Array.isArray(rawPayload)) {
        manualInputsByNm[String(nmId)] = rawPayload as Record<string, unknown>;
      }
    }

    const enrichedRows = await Promise.all(rowsForTemplate.map(async (row) => {
      const nmId = toNumber(row.nmId);
      const card = cardsByNmId.get(nmId);
      const cardRaw = card as Record<string, unknown> | undefined;
      const resolvedImtId = toNumber(cardRaw?.imtID ?? cardRaw?.imtId);
      const buyoutFact = buyoutFactsByNm.get(nmId);
      const wbMeasuredDimensions = wbMeasuredDimensionsByNm.get(nmId) ?? null;
      const cardDimensions = token
        ? await getCardDimensions(tenantId, token, nmId, card ? [card] : cards, wbMeasuredDimensions)
        : null;

      const resolvedCategory = typeof row.category === 'string' && row.category.trim()
        ? row.category
        : (cardDimensions?.categoryFromCard ?? null);
      const resolvedBrand = typeof row.brand === 'string' && row.brand.trim()
        ? row.brand.trim()
        : (normalizeValue(card?.brand ?? '') ?? null);
      const resolvedVendorCode = typeof row.vendorCode === 'string' && row.vendorCode.trim()
        ? row.vendorCode.trim()
        : (normalizeValue(card?.vendorCode ?? '') ?? null);
      const resolvedBarcode = toLikelyBarcode(normalizePotentialBarcode(row.barcode))
        ?? cardDimensions?.barcodeFromCard
        ?? null;
      const categoryCommissionRates = resolveCategoryCommissionRates(resolvedCategory, categoryCommissions);

      return {
        ...row,
        imtId: resolvedImtId > 0 ? resolvedImtId : toNumber(row.imtId),
        brand: resolvedBrand,
        vendorCode: resolvedVendorCode,
        barcode: resolvedBarcode,
        category: resolvedCategory,
        categoryCommissionPercent: categoryCommissionRates.fbw,
        categoryCommissionPercentFbw: categoryCommissionRates.fbw,
        categoryCommissionPercentFbs: categoryCommissionRates.fbs,
        volume: cardDimensions?.volume ?? null,
        volumeLiters: cardDimensions?.volumeLiters ?? null,
        // Priority: products.wb_warehouse_volume_liters (from /warehouse_remains,
        // matches «Объём, л» in WB cabinet xlsx — covers combo-pack SKUs that
        // warehouse-measurements often misses) → cardDimensions.wbVolumeLiters
        // (from /warehouse-measurements, kept as fallback).
        wbVolumeLiters: wbWarehouseVolumeByNm.get(nmId) ?? cardDimensions?.wbVolumeLiters ?? null,
        wbStockWarehouses: wbStockWarehousesByNm.get(nmId) ?? [],
        length: cardDimensions?.length ?? null,
        width: cardDimensions?.width ?? null,
        height: cardDimensions?.height ?? null,
        buyoutPercentFact: buyoutFact?.buyoutPercent ?? null,
        buyoutOrderCountFact: buyoutFact?.orderCount ?? null,
        buyoutCountFact: buyoutFact?.buyoutCount ?? null,
        buyoutCancelCountFact: buyoutFact?.cancelCount ?? null,
        buyoutReturnCountFact: buyoutFact?.returnCount ?? null,
        buyoutHistoryDaysFact: buyoutFact?.historyDays ?? 0,
        buyoutFirstActivityDateFact: buyoutFact?.firstActivityDate ?? null,
        buyoutLastActivityDateFact: buyoutFact?.lastActivityDate ?? null,
        localizationPercent: localizationByNm.get(nmId) ?? null,
        cabinetLocalityIndex: cabinetIndices.localityIndex,
        cabinetIrpPercent: cabinetIndices.irpPercent,
        cabinetIndicesSource: cabinetIndices.source,
        cabinetIndicesEffectiveWeek: cabinetIndices.effectiveWeek,
        cabinetIndicesFetchedAt: cabinetIndices.fetchedAt,
      };
    }));

    return NextResponse.json({
      data: enrichedRows,
      cabinetIndices,
      manualInputsByNm,
      calculationMode: 'PLAN_TEMPLATE',
      defaultTaxPercent,
      acceptanceTariffs: acceptanceTariffsForTargetDate,
      acceptanceTariffsDate: targetDate,
      boxTariffs: boxTariffsForTargetDate,
      boxTariffsDate: targetDate,
      returnTariffs: returnTariffsForTargetDate,
      returnTariffsDate: targetDate,
      wbWarehouseNames,
    });
});
