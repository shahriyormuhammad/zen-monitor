import { toNumber } from '../helpers';
import type { UnitTemplateRow } from '../types';

const COLOR_TOKEN_HINTS = [
  'бел', 'черн', 'красн', 'син', 'голуб', 'зел', 'желт', 'розов', 'фиолет',
  'оранж', 'коричн', 'беж', 'сер', 'молоч', 'пудр', 'хаки', 'бордо', 'бургунд',
  'лилов', 'сирен', 'mint', 'graphite', 'sand', 'white', 'black', 'red', 'blue',
  'green', 'yellow', 'pink', 'purple', 'brown', 'beige', 'gray', 'grey',
];

export function normalizeFamilyToken(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-zа-яё0-9]/g, '');
}

function extractModelStemFromVendorCode(vendorCode: string | null | undefined): string | null {
  const normalized = normalizeFamilyToken(vendorCode);
  if (!normalized) return null;

  for (const hint of COLOR_TOKEN_HINTS) {
    if (normalized.endsWith(hint)) {
      const parts = (vendorCode ?? '').split(/[-_\s]/);
      if (parts.length > 1) {
        return parts.slice(0, -1).join(' ');
      }
    }
  }

  const parts = (vendorCode ?? '').split(/[-_\s]/);
  if (parts.length > 1) {
    return parts.slice(0, -1).join(' ');
  }

  return normalized;
}

export function buildVariantFamilyKey(row: UnitTemplateRow): string {
  const imtId = toNumber(row.imtId);
  if (imtId > 0) return `imt:${imtId}`;

  const brand = normalizeFamilyToken(row.brand);
  const category = normalizeFamilyToken(row.category);
  const modelStem = extractModelStemFromVendorCode(row.vendorCode);

  if (modelStem) return `${brand}|${category}|${modelStem}`;

  const fallbackNm = toNumber(row.nmId);
  return `${brand}|${category}|nm:${fallbackNm > 0 ? fallbackNm : 'unknown'}`;
}

const SELLER_ARTICLE_COLLATOR = new Intl.Collator('ru-RU', { numeric: true, sensitivity: 'base' });

export function compareBySellerArticle(a: UnitTemplateRow, b: UnitTemplateRow): number {
  const familyCmp = SELLER_ARTICLE_COLLATOR.compare(buildVariantFamilyKey(a), buildVariantFamilyKey(b));
  if (familyCmp !== 0) return familyCmp;

  const sellerA = normalizeFamilyToken(a.vendorCode) || `nm-${toNumber(a.nmId)}`;
  const sellerB = normalizeFamilyToken(b.vendorCode) || `nm-${toNumber(b.nmId)}`;
  const sellerCmp = SELLER_ARTICLE_COLLATOR.compare(sellerA, sellerB);
  if (sellerCmp !== 0) return sellerCmp;

  const soldDiff = toNumber(b?.soldQuantity) - toNumber(a?.soldQuantity);
  if (Math.abs(soldDiff) > 0.0001) return soldDiff;

  return toNumber(a?.nmId) - toNumber(b?.nmId);
}

export function createEconomicsExportFileName(prefix: string): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const time = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  return `${prefix}_${date}_${time}.xlsx`;
}

/**
 * Strict: only WB-side fact volume. No card-side fallback. Used for the
 * «Литраж факт. WB» column display and Excel export — empty cell («—») if WB
 * hasn't reported a measurement yet.
 */
export function resolveWbVolumeLiters(row: UnitTemplateRow): number {
  const wbVol = toNumber(row.wbVolumeLiters);
  return wbVol > 0 ? wbVol : 0;
}
