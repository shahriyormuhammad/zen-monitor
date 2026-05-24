'use client';

/**
 * Vertical "cylinder" gauge — visualizes plan completion (0..100%+).
 *
 * Ported from the Postal prototype. The cylinder fills up like a beaker;
 * tick marks at 25/50/75/100 give a quick anchor for the reading.
 *
 * Colour ramp follows the existing paceStatus semantics used elsewhere in
 * the project:
 *   < 30% → bad (red)         "не сдавайся"
 *   30–60% → warn (orange)     "дотягивай"
 *   60–105% → ok (emerald)     "по плану / лучше"
 *   > 105% → peak (cyan/blue)  "перевыполнение"
 *
 * The text reading and status colours are derived once; the SVG itself is
 * static — animation is added later (a 0.7s ease on the fill height).
 */

type Tone = 'bad' | 'warn' | 'ok' | 'peak';

function toneFromPct(pct: number): Tone {
  if (pct < 30) return 'bad';
  if (pct < 60) return 'warn';
  if (pct <= 105) return 'ok';
  return 'peak';
}

const TONE_CLASSES: Record<Tone, { fill: string; value: string }> = {
  bad: {
    fill: 'bg-gradient-to-t from-rose-600 to-rose-400',
    value: 'text-rose-600 dark:text-rose-300',
  },
  warn: {
    fill: 'bg-gradient-to-t from-amber-600 to-amber-400',
    value: 'text-amber-600 dark:text-amber-300',
  },
  ok: {
    fill: 'bg-gradient-to-t from-emerald-700 to-emerald-400',
    value: 'text-emerald-600 dark:text-emerald-300',
  },
  peak: {
    fill: 'bg-gradient-to-t from-cyan-700 to-cyan-400',
    value: 'text-cyan-600 dark:text-cyan-300',
  },
};

type CylinderGaugeProps = {
  /** 0..100+ — actual completion percent. Values > 100 visually pinned to 100%. */
  pct: number;
  /** Label below the cylinder, e.g. "Прибыль за сезон". */
  label?: string;
  /** Optional fixed tone override; by default derived from pct. */
  tone?: Tone;
  /** Visual height in px. Defaults to 180. */
  height?: number;
};

export function CylinderGauge({ pct, label, tone, height = 180 }: CylinderGaugeProps) {
  const safePct = Number.isFinite(pct) ? Math.max(0, pct) : 0;
  const fillHeight = Math.min(100, safePct);
  const resolvedTone = tone ?? toneFromPct(safePct);
  const classes = TONE_CLASSES[resolvedTone];

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className="relative w-[60px] overflow-hidden rounded-[30px] border-[1.5px] border-border bg-subtle shadow-inner"
        style={{ height }}
      >
        {/* Liquid */}
        <div
          className={`absolute bottom-0 left-0 right-0 rounded-b-[26px] transition-[height] duration-700 ease-out ${classes.fill}`}
          style={{ height: `${fillHeight}%` }}
        >
          {/* Surface highlight */}
          <span className="pointer-events-none absolute left-[8%] right-[8%] top-[2px] h-[3px] rounded-full bg-white/40" />
        </div>

        {/* Tick marks at 25 / 50 / 75 / 100% — read bottom-up */}
        {[25, 50, 75].map((mark) => (
          <span
            key={mark}
            className="pointer-events-none absolute -left-2 -right-2 h-px bg-slate-400/30"
            style={{ bottom: `${mark}%` }}
          >
            <span className="absolute right-[100%] top-[-7px] mr-1.5 whitespace-nowrap text-[9px] font-bold text-slate-400">
              {mark}%
            </span>
          </span>
        ))}
      </div>

      <div className="text-center">
        <div className={`font-mono text-2xl font-extrabold leading-none ${classes.value}`}>
          {Math.round(safePct)}%
        </div>
        {label ? (
          <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            {label}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default CylinderGauge;
