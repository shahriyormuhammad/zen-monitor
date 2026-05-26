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

/**
 * User-specified auto-rule: detected sizes → per-box distribution targeting
 * ~`targetPerBox` pairs/box (default 8), with central sizes getting more.
 *
 * Examples (target = 8):
 *   41-46 (6 sizes)  → 1,1,2,2,1,1  (43-44 по 2)
 *   37-41 (5 sizes)  → 1,2,2,2,1    (38-39-40 по 2)
 *   36-41 (6 sizes)  → 1,1,2,2,1,1  (38-39 по 2)
 *   40-45 (6 sizes)  → 1,1,2,2,1,1
 *   35-41 (7 sizes)  → 1,1,1,2,1,1,1 (38 — центр)
 *
 * Wider ranges (>= 9 sizes) stay at 1 per size — the user should split.
 */
export function suggestDistribution(
  sizes: string[],
  targetPerBox = 8,
): { size: string; perBox: number }[] {
  const n = sizes.length;
  if (n === 0) return [];
  const base = sizes.map((s) => ({ size: s, perBox: 1 }));
  if (n >= targetPerBox) return base;

  let extras = targetPerBox - n;
  // If we'd need more than 1 extra per size (very small ranges, e.g. n=3),
  // distribute as evenly as possible from the centre outwards.
  while (extras > 0) {
    // Find indexes still equal to the minimum perBox, prioritise centre.
    const minVal = Math.min(...base.map((r) => r.perBox));
    const candidates: number[] = [];
    for (let i = 0; i < n; i++) {
      if (base[i]!.perBox === minVal) candidates.push(i);
    }
    if (candidates.length === 0) break;
    const need = Math.min(extras, candidates.length);
    // Take the central `need` candidates.
    const start = Math.floor((candidates.length - need) / 2);
    for (let k = 0; k < need; k++) {
      base[candidates[start + k]!]!.perBox += 1;
    }
    extras -= need;
  }
  return base;
}

/**
 * Build a synthetic template named after the detected size range
 * (e.g. "Авто 41-46 (8 пар)") with the user's central-bias rule applied.
 * Falls back to null when sizes is empty.
 */
export function buildAutoTemplate(
  sizes: string[],
  targetPerBox = 8,
): SizeProfileTemplate | null {
  if (sizes.length === 0) return null;
  const dist = suggestDistribution(sizes, targetPerBox);
  const first = sizes[0]!;
  const last = sizes[sizes.length - 1]!;
  const total = dist.reduce((s, r) => s + r.perBox, 0);
  const range = sizes.length === 1 ? first : `${first}-${last}`;
  return {
    id: `auto-${range}`,
    name: `Авто ${range}`,
    hint: `${total} пар по найденным размерам · центр размерного ряда — по 2`,
    group: 'shoes-adult',
    sizes: dist,
  };
}
