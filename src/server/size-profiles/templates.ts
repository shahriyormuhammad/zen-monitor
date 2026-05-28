/**
 * Built-in size templates — direct port from Postal index.html:6007-6012.
 *
 * Only four templates exist. They are matched against an article's detected
 * sizes by subset / exact match (see `findApplicableTemplates`,
 * `findExactTemplate` below). The rule:
 *   • exact match (template sizes equal article sizes by set) → ONE profile
 *     named «Стандарт <range>» using template's perBox map
 *   • no exact match but applicable templates exist (e.g. article 37-45 is
 *     wider than any single template) → SEPARATE profile per applicable
 *     template (37-41 + 41-45), plus a fallback «Стандарт» with perBox=1
 *
 * Keep the four entries identical to Postal — they're the contract for
 * `sourceTemplate` matching.
 */

export type SizeTemplate = {
  /** Stable id stored in size_profiles.source_template (matches `name`). */
  id: string;
  name: string;
  /** Human group label for the auto-split case (Подростковая / Взрослая). */
  group: 'teen' | 'adult';
  /** Sizes ordered canonically. */
  sizes: string[];
  /** size → pairs-per-box. Sum is the standard 8 pairs/коробка. */
  map: Record<string, number>;
};

export const SIZE_TEMPLATES: SizeTemplate[] = [
  {
    id: '41-46',
    name: '41-46',
    group: 'adult',
    sizes: ['41', '42', '43', '44', '45', '46'],
    map: { '41': 1, '42': 1, '43': 2, '44': 2, '45': 1, '46': 1 },
  },
  {
    id: '41-45',
    name: '41-45',
    group: 'adult',
    sizes: ['41', '42', '43', '44', '45'],
    map: { '41': 1, '42': 2, '43': 2, '44': 2, '45': 1 },
  },
  {
    id: '37-41',
    name: '37-41',
    group: 'teen',
    sizes: ['37', '38', '39', '40', '41'],
    map: { '37': 1, '38': 2, '39': 2, '40': 2, '41': 1 },
  },
  {
    id: '36-41',
    name: '36-41',
    group: 'teen',
    sizes: ['36', '37', '38', '39', '40', '41'],
    map: { '36': 1, '37': 1, '38': 2, '39': 2, '40': 1, '41': 1 },
  },
];

export const GROUP_LABEL: Record<SizeTemplate['group'], string> = {
  teen: 'Подростковая',
  adult: 'Взрослая',
};

/** Sort sizes numerically, with lexical fallback (matches Postal spSortSizes). */
export function sortSizesByValue(sizes: string[]): string[] {
  return sizes.slice().sort((a, b) => {
    const an = parseFloat(a);
    const bn = parseFloat(b);
    if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
    return String(a).localeCompare(String(b), 'ru');
  });
}

/** Templates whose sizes are a subset of the article's size set. */
export function findApplicableTemplates(articleSizes: string[]): SizeTemplate[] {
  const set = new Set(articleSizes.map((s) => String(s).trim()));
  return SIZE_TEMPLATES.filter((tpl) => tpl.sizes.every((s) => set.has(s)));
}

/** Template that has exactly the article's sizes (by set equality). */
export function findExactTemplate(articleSizes: string[]): SizeTemplate | null {
  const set = new Set(articleSizes.map((s) => String(s).trim()));
  for (const tpl of SIZE_TEMPLATES) {
    if (tpl.sizes.length !== set.size) continue;
    if (tpl.sizes.every((s) => set.has(s))) return tpl;
  }
  return null;
}

/**
 * Wide range detection: find a {teen, adult} pair of templates whose union
 * is EXACTLY the article's size set (with the overlap point — usually 41 —
 * appearing in both). This is the "Подростковая + Взрослая" auto-split:
 * the article ships in two physical boxes, each with its own 8-pair
 * ростовка, sharing the size 41 barcode.
 *
 * Returns null if no clean two-template cover exists.
 */
export function findTwoTemplateSplit(
  articleSizes: string[],
): { teen: SizeTemplate; adult: SizeTemplate } | null {
  const articleSet = new Set(articleSizes.map((s) => String(s).trim()));
  if (articleSet.size < 7) return null; // a single template can fit anything ≤ 6 sizes

  const teens = SIZE_TEMPLATES.filter((t) => t.group === 'teen');
  const adults = SIZE_TEMPLATES.filter((t) => t.group === 'adult');

  for (const teen of teens) {
    for (const adult of adults) {
      // Union must equal the article set; both must be subsets.
      if (!teen.sizes.every((s) => articleSet.has(s))) continue;
      if (!adult.sizes.every((s) => articleSet.has(s))) continue;
      const union = new Set<string>();
      teen.sizes.forEach((s) => union.add(s));
      adult.sizes.forEach((s) => union.add(s));
      if (union.size !== articleSet.size) continue;
      let equal = true;
      for (const s of articleSet) {
        if (!union.has(s)) { equal = false; break; }
      }
      if (equal) return { teen, adult };
    }
  }
  return null;
}

/** Render sizes×perBox using a template — picks the per-box value from the
 *  template map, defaults to 1 for missing entries. Each row keeps an
 *  optional barcode (empty until we add WB Content API sync). */
export function buildSizesFromTemplate(
  tpl: SizeTemplate,
  barcodeBySize: Record<string, string> = {},
): { size: string; perBox: number; barcode: string }[] {
  return tpl.sizes.map((size) => ({
    size,
    perBox: tpl.map[size] ?? 1,
    barcode: barcodeBySize[size] ?? '',
  }));
}

/** Wide range = ≥ 7 sizes OR numeric range ≥ 7. Triggers the split UI hint. */
export function isWideSizeRange(sizes: { size: string }[]): boolean {
  if (sizes.length >= 7) return true;
  const nums = sizes
    .map((s) => parseFloat(s.size))
    .filter((n) => Number.isFinite(n));
  if (nums.length < 2) return false;
  return Math.max(...nums) - Math.min(...nums) >= 7;
}

/** Pretty range string e.g. "41-46 (6 размеров)". */
export function describeRange(sizes: string[]): string {
  if (sizes.length === 0) return '—';
  const nums = sizes.map((s) => parseFloat(s)).filter((n) => Number.isFinite(n));
  const suffix = sizes.length === 1 ? '' : sizes.length < 5 ? 'а' : 'ов';
  if (nums.length >= 2) {
    return `${Math.min(...nums)}-${Math.max(...nums)} (${sizes.length} размер${suffix})`;
  }
  return `${sizes.length} размер${suffix}`;
}

/** Short range string for profile rows: "41-46". */
export function shortRange(sizes: string[]): string {
  if (sizes.length === 0) return '—';
  const nums = sizes.map((s) => parseFloat(s)).filter((n) => Number.isFinite(n));
  if (nums.length >= 2) {
    return `${Math.min(...nums)}-${Math.max(...nums)}`;
  }
  return sizes.slice(0, 3).join(', ');
}
