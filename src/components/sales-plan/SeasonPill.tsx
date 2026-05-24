/**
 * Season phase pill — Пик / Рост / Спад / Несезон.
 *
 * Ported from the Postal prototype. Used in the weekly plan table and any
 * other place where we want a one-glance seasonality tag.
 *
 * Colour mapping (intentionally distinct hues so they survive at small sizes):
 *   peak       → solid emerald               "сезон в разгаре"
 *   growth     → light blue                  "идёт вверх"
 *   decline    → soft orange                 "пошёл вниз"
 *   offseason  → neutral slate               "несезон"
 */

export type SeasonKind = 'peak' | 'growth' | 'decline' | 'offseason';

const KIND_CLASS: Record<SeasonKind, string> = {
  peak:      'bg-emerald-500 text-white dark:bg-emerald-600',
  growth:    'bg-sky-300 text-sky-900 dark:bg-sky-400 dark:text-sky-950',
  decline:   'bg-orange-300 text-orange-900 dark:bg-orange-400 dark:text-orange-950',
  offseason: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
};

const KIND_LABEL: Record<SeasonKind, string> = {
  peak:      'Пик',
  growth:    'Рост',
  decline:   'Спад',
  offseason: 'Несезон',
};

type SeasonPillProps = {
  kind: SeasonKind;
  /** Override the default label if you want a richer text (e.g. "Пик · 1.28x"). */
  label?: string;
  className?: string;
};

export function SeasonPill({ kind, label, className }: SeasonPillProps) {
  const text = label ?? KIND_LABEL[kind];
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-[9px] py-[2px] text-[10.5px] font-bold leading-[1.4] tracking-[0.2px] ${KIND_CLASS[kind]} ${className ?? ''}`}
    >
      {text}
    </span>
  );
}

/**
 * Derive the season phase from a coefficient array (one entry per week).
 * Reuses the same heuristic as the Postal prototype: rank by normalized
 * value (max=1, min=0) and inspect neighbouring values for trend.
 */
export function classifySeasonPhase(
  coefs: number[],
  index: number,
): SeasonKind {
  if (!coefs.length) return 'growth';
  const max = Math.max(...coefs);
  const min = Math.min(...coefs);
  const range = max - min || 1;
  const c = coefs[index] ?? max;
  const prev = index > 0 ? coefs[index - 1]! : c;
  const next = index < coefs.length - 1 ? coefs[index + 1]! : c;
  const normalized = (c - min) / range;
  if (normalized >= 0.85) return 'peak';
  if (normalized <= 0.25) return 'offseason';
  if (next > c && c > prev) return 'growth';
  if (next < c && c < prev) return 'decline';
  if (normalized >= 0.6) return 'peak';
  if (normalized >= 0.4) return 'growth';
  return 'decline';
}

export default SeasonPill;
