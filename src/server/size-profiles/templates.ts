/**
 * Pre-built size profile templates for footwear (кроссовки / shoes).
 *
 * Each template defines a sequence of sizes with default per-box counts.
 * Picking a template auto-fills the form when creating a new profile;
 * the user can still tweak per-box counts and barcodes afterwards.
 *
 * Convention: 8 пар/коробка is the most common pack size for adult
 * shoes; some boxes use 7 or 10. Distribution favours the centre of the
 * range (most-sold sizes).
 */

export type SizeProfileTemplate = {
  id: string;
  /** Russian label shown in the picker. */
  name: string;
  /** Short hint (e.g. "8 пар/коробка, центр размерного ряда"). */
  hint: string;
  /** Category tag for filtering / grouping in UI. */
  group: 'shoes-kids' | 'shoes-teen' | 'shoes-adult' | 'shoes-full' | 'shoes-women' | 'shoes-men';
  /** Sizes in canonical order, with default per-box counts. */
  sizes: { size: string; perBox: number }[];
};

export const SIZE_PROFILE_TEMPLATES: SizeProfileTemplate[] = [
  // === Детская ===
  {
    id: 'kids-28-35',
    name: 'Детская 28-35',
    hint: '8 пар · детский ряд',
    group: 'shoes-kids',
    sizes: [
      { size: '28', perBox: 1 }, { size: '29', perBox: 1 }, { size: '30', perBox: 1 },
      { size: '31', perBox: 1 }, { size: '32', perBox: 1 }, { size: '33', perBox: 1 },
      { size: '34', perBox: 1 }, { size: '35', perBox: 1 },
    ],
  },

  // === Подростковая ===
  {
    id: 'teen-36-40',
    name: 'Подростковая 36-40',
    hint: '8 пар · 5 размеров',
    group: 'shoes-teen',
    sizes: [
      { size: '36', perBox: 2 }, { size: '37', perBox: 2 }, { size: '38', perBox: 2 },
      { size: '39', perBox: 1 }, { size: '40', perBox: 1 },
    ],
  },
  {
    id: 'teen-37-41',
    name: 'Подростковая 37-41',
    hint: '8 пар · 5 размеров',
    group: 'shoes-teen',
    sizes: [
      { size: '37', perBox: 2 }, { size: '38', perBox: 2 }, { size: '39', perBox: 2 },
      { size: '40', perBox: 1 }, { size: '41', perBox: 1 },
    ],
  },
  {
    id: 'teen-35-41',
    name: 'Подростковая полная 35-41',
    hint: '10 пар · 7 размеров',
    group: 'shoes-teen',
    sizes: [
      { size: '35', perBox: 1 }, { size: '36', perBox: 2 }, { size: '37', perBox: 2 },
      { size: '38', perBox: 2 }, { size: '39', perBox: 1 }, { size: '40', perBox: 1 },
      { size: '41', perBox: 1 },
    ],
  },

  // === Взрослая ===
  {
    id: 'adult-40-45',
    name: 'Взрослая 40-45',
    hint: '8 пар · 6 размеров',
    group: 'shoes-adult',
    sizes: [
      { size: '40', perBox: 1 }, { size: '41', perBox: 2 }, { size: '42', perBox: 2 },
      { size: '43', perBox: 2 }, { size: '44', perBox: 1 }, { size: '45', perBox: 0 },
    ].filter((s) => s.perBox > 0),
  },
  {
    id: 'adult-41-46',
    name: 'Взрослая 41-46',
    hint: '8 пар · 6 размеров',
    group: 'shoes-adult',
    sizes: [
      { size: '41', perBox: 1 }, { size: '42', perBox: 2 }, { size: '43', perBox: 2 },
      { size: '44', perBox: 2 }, { size: '45', perBox: 1 }, { size: '46', perBox: 0 },
    ].filter((s) => s.perBox > 0),
  },

  // === Женская ===
  {
    id: 'women-35-40',
    name: 'Женская 35-40',
    hint: '8 пар · 6 размеров',
    group: 'shoes-women',
    sizes: [
      { size: '35', perBox: 1 }, { size: '36', perBox: 2 }, { size: '37', perBox: 2 },
      { size: '38', perBox: 1 }, { size: '39', perBox: 1 }, { size: '40', perBox: 1 },
    ],
  },

  // === Мужская ===
  {
    id: 'men-41-46',
    name: 'Мужская 41-46',
    hint: '8 пар · 6 размеров',
    group: 'shoes-men',
    sizes: [
      { size: '41', perBox: 1 }, { size: '42', perBox: 2 }, { size: '43', perBox: 2 },
      { size: '44', perBox: 2 }, { size: '45', perBox: 1 }, { size: '46', perBox: 0 },
    ].filter((s) => s.perBox > 0),
  },

  // === Полные ряды (для справки — не отгружаются в одной коробке) ===
  {
    id: 'full-36-45',
    name: 'Полный ряд 36-45',
    hint: '⚠ 10 размеров — рекомендуется разделить',
    group: 'shoes-full',
    sizes: [
      { size: '36', perBox: 1 }, { size: '37', perBox: 1 }, { size: '38', perBox: 1 },
      { size: '39', perBox: 1 }, { size: '40', perBox: 1 }, { size: '41', perBox: 1 },
      { size: '42', perBox: 1 }, { size: '43', perBox: 1 }, { size: '44', perBox: 1 },
      { size: '45', perBox: 1 },
    ],
  },
  {
    id: 'full-37-46',
    name: 'Полный ряд 37-46',
    hint: '⚠ 10 размеров — рекомендуется разделить',
    group: 'shoes-full',
    sizes: [
      { size: '37', perBox: 1 }, { size: '38', perBox: 1 }, { size: '39', perBox: 1 },
      { size: '40', perBox: 1 }, { size: '41', perBox: 1 }, { size: '42', perBox: 1 },
      { size: '43', perBox: 1 }, { size: '44', perBox: 1 }, { size: '45', perBox: 1 },
      { size: '46', perBox: 1 },
    ],
  },
];

/** Group label → human title. Used as a section header in the picker. */
export const SIZE_PROFILE_TEMPLATE_GROUP_LABEL: Record<SizeProfileTemplate['group'], string> = {
  'shoes-kids':  'Детская обувь',
  'shoes-teen':  'Подростковая',
  'shoes-adult': 'Взрослая (унисекс)',
  'shoes-women': 'Женская',
  'shoes-men':   'Мужская',
  'shoes-full':  'Полный ряд (для справки)',
};

/**
 * Detect whether a size range is "wide" — too many sizes to fit in one box
 * (Postal heuristic: ≥7 sizes OR range ≥ 7). When wide, suggest splitting.
 */
export function isWideSizeRange(sizes: { size: string }[]): boolean {
  if (sizes.length >= 7) return true;
  const nums = sizes
    .map((s) => parseInt(s.size, 10))
    .filter((n) => Number.isFinite(n));
  if (nums.length < 2) return false;
  return Math.max(...nums) - Math.min(...nums) >= 7;
}
