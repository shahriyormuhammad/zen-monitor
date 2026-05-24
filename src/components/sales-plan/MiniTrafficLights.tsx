/**
 * Compact inline traffic lights — a short pill row of key metrics with a
 * coloured dot for at-a-glance health.
 *
 * Ported from the Postal `.sp-exec-mini-traffic` block. Designed for the
 * Hero / overview area: each pill is one metric (e.g. "ДРР 18%") with
 * green/amber/red dot indicating norm/risk/critical.
 */

export type LightTone = 'ok' | 'warn' | 'bad' | 'idle';

const DOT_CLASS: Record<LightTone, string> = {
  ok:   'bg-emerald-500 ring-emerald-500/20',
  warn: 'bg-amber-500   ring-amber-500/20',
  bad:  'bg-rose-500    ring-rose-500/20',
  idle: 'bg-slate-300   ring-slate-300/20 dark:bg-slate-600',
};

const VALUE_CLASS: Record<LightTone, string> = {
  ok:   'text-emerald-600 dark:text-emerald-300',
  warn: 'text-amber-600   dark:text-amber-300',
  bad:  'text-rose-600    dark:text-rose-300',
  idle: 'text-slate-500',
};

export type TrafficLightItem = {
  /** Short caption — "План", "Маржа", "ДРР", … */
  label: string;
  /** Formatted value — "67%", "18.0%", "—" */
  value: string;
  /** Light tone derived from thresholds. */
  tone: LightTone;
};

type MiniTrafficLightsProps = {
  items: TrafficLightItem[];
};

export function MiniTrafficLights({ items }: MiniTrafficLightsProps) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {items.map((it) => (
        <div
          key={it.label}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-subtle px-2.5 py-1 text-[11px] font-semibold"
        >
          <span className={`h-[7px] w-[7px] rounded-full ring-2 ${DOT_CLASS[it.tone]}`} />
          <span className="text-muted-foreground">{it.label}</span>
          <span className={`font-mono font-bold ${VALUE_CLASS[it.tone]}`}>{it.value}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Helper: given a value, "ok/warn" thresholds, return a tone.
 *
 * `direction = 'higher-better'` (default) — bigger is greener.
 * `direction = 'lower-better'` — smaller is greener (e.g. ДРР, СПП).
 */
export function lightTone(
  value: number | null | undefined,
  okThreshold: number,
  warnThreshold: number,
  direction: 'higher-better' | 'lower-better' = 'higher-better',
): LightTone {
  if (value == null || !Number.isFinite(value)) return 'idle';
  if (direction === 'lower-better') {
    if (value <= okThreshold) return 'ok';
    if (value <= warnThreshold) return 'warn';
    return 'bad';
  }
  if (value >= okThreshold) return 'ok';
  if (value >= warnThreshold) return 'warn';
  return 'bad';
}

export default MiniTrafficLights;
