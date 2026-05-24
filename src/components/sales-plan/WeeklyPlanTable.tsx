'use client';

/**
 * Weekly Plan Table — 53-week × N-column table ported from the Postal
 * prototype ("Скиншоповский Шаблон Сезона").
 *
 * For the first integration step the table is fully client-side and works
 * from a simple `WeeklyRow[]` input. Server-side weekly plan storage is a
 * follow-up: until then we synthesize rows from a SalesPlanSummary using a
 * fixed seasonal curve (cos-wave with August peak).
 *
 * Visual contract:
 *  - Header has two rows: group-coloured top + sub-columns underneath.
 *  - First weeks (current-period / past) are visually de-emphasized when
 *    they are "past", and the current week gets a left emerald accent.
 *  - Plan vs fact cells are colour-coded by deviation (red >20%, amber 5-20%).
 *  - Each row carries a SeasonPill (Пик/Рост/Спад/Несезон).
 *  - "Fact" columns get a yellow background to distinguish from plan.
 */

import { useMemo } from 'react';
import { SeasonPill, classifySeasonPhase, type SeasonKind } from './SeasonPill';

export type WeeklyRow = {
  wk: number;
  /** ISO date (Monday) for this week. */
  date: string;
  monthName: string;
  seasonCoef: number;
  /** Plan / fact orders. */
  planOrders: number;
  factOrders: number | null;
  /** Plan / fact average selling price, in rubles. */
  pricePlan: number;
  priceFact: number | null;
  /** Plan / fact margin %. */
  marginPlan: number;
  marginFact: number | null;
  /** Plan / fact buyout %. */
  buyoutPlan: number;
  buyoutFact: number | null;
  /** Weekly profit, week-by-week (plan only for now). */
  weekProfit: number;
  /** Cumulative profit (plan only for now). */
  cumProfit: number;
  /** Cumulative "cash" profit — profit minus purchases. */
  cumCash: number;
};

type Props = {
  rows: WeeklyRow[];
  /** Highlight the row whose date contains "today". */
  highlightToday?: boolean;
};

function formatRuDate(iso: string): string {
  const [y, m, d] = iso.split('-').map((s) => Number(s));
  const months = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  return `${d}\u00a0${months[(m ?? 1) - 1]}`;
}

function formatNum(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return Math.round(n).toLocaleString('ru-RU');
}

function formatMoneyCompact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M\u00a0₽';
  if (abs >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K\u00a0₽';
  return Math.round(n) + '\u00a0₽';
}

function cashCellStyle(value: number, maxAbs: number): string {
  if (!Number.isFinite(value)) return '';
  const ratio = Math.max(-1, Math.min(1, value / (maxAbs || 1)));
  if (ratio >= 0) {
    const alpha = (0.10 + ratio * 0.30).toFixed(2);
    return `background:rgba(16,185,129,${alpha});color:#065f46;font-weight:600`;
  }
  const a = (0.10 + Math.abs(ratio) * 0.32).toFixed(2);
  return `background:rgba(239,68,68,${a});color:#991b1b;font-weight:600`;
}

function deviationCellStyle(plan: number, fact: number | null): string {
  if (fact == null || plan <= 0) return '';
  const d = (fact - plan) / plan;
  if (d > 0.05) return 'background:rgba(16,185,129,.18);color:#047857;font-weight:600';
  if (d < -0.20) return 'background:rgba(239,68,68,.22);color:#b91c1c;font-weight:600';
  if (d < -0.05) return 'background:rgba(245,158,11,.22);color:#92400e;font-weight:600';
  return '';
}

function deltaPercent(plan: number, fact: number | null): string {
  if (fact == null || plan <= 0) return '—';
  const d = ((fact - plan) / plan) * 100;
  return `${d >= 0 ? '+' : ''}${d.toFixed(0)}%`;
}

export function WeeklyPlanTable({ rows, highlightToday = true }: Props) {
  const phases: SeasonKind[] = useMemo(
    () => rows.map((_, i) => classifySeasonPhase(rows.map((r) => r.seasonCoef), i)),
    [rows],
  );

  const maxCash = useMemo(
    () => rows.reduce((m, r) => Math.max(m, Math.abs(r.cumCash || 0)), 1),
    [rows],
  );

  const todayMs = useMemo(() => Date.now(), []);

  return (
    <div className="overflow-auto rounded-2xl border border-border bg-card shadow-[var(--shadow-xs)]">
      <table className="w-full min-w-[2400px] border-collapse text-[11px]">
        <thead>
          {/* Group row — coloured by section */}
          <tr>
            <th rowSpan={2} className="sticky top-0 z-10 border border-border bg-subtle px-2 py-1.5 text-[10.5px] font-bold text-muted-foreground" style={{ width: 90 }}>
              Период
            </th>
            <th rowSpan={2} className="sticky top-0 z-10 border border-border bg-subtle px-2 py-1.5 text-[10.5px] font-bold text-muted-foreground" style={{ width: 50 }}>Нед</th>
            <th rowSpan={2} className="sticky top-0 z-10 border border-border bg-subtle px-2 py-1.5 text-[10.5px] font-bold text-muted-foreground" style={{ width: 70 }}>Месяц</th>
            <th rowSpan={2} className="sticky top-0 z-10 border border-border bg-subtle px-2 py-1.5 text-[10.5px] font-bold text-muted-foreground" style={{ width: 90 }}>Сезон</th>

            <th colSpan={4} className="border border-border bg-indigo-100 px-2 py-1 text-[11px] font-extrabold uppercase tracking-[0.04em] text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">Цена</th>
            <th colSpan={2} className="border border-border bg-fuchsia-100 px-2 py-1 text-[11px] font-extrabold uppercase tracking-[0.04em] text-fuchsia-700 dark:bg-fuchsia-950 dark:text-fuchsia-300">Маржа</th>
            <th colSpan={3} className="border border-border bg-emerald-100 px-2 py-1 text-[11px] font-extrabold uppercase tracking-[0.04em] text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">Заказы</th>
            <th colSpan={2} className="border border-border bg-cyan-100 px-2 py-1 text-[11px] font-extrabold uppercase tracking-[0.04em] text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300">Выкупы</th>
            <th colSpan={3} className="border border-border bg-amber-100 px-2 py-1 text-[11px] font-extrabold uppercase tracking-[0.04em] text-amber-700 dark:bg-amber-950 dark:text-amber-300">Финал</th>
          </tr>

          {/* Sub-columns */}
          <tr>
            <th className="sticky top-[28px] z-10 border border-border bg-subtle px-2 py-1.5 text-[10px] font-semibold text-muted-foreground">Цена<br />план</th>
            <th className="sticky top-[28px] z-10 border border-border bg-amber-50 px-2 py-1.5 text-[10px] font-semibold text-amber-900 dark:bg-amber-900/30">Цена<br />факт</th>
            <th className="sticky top-[28px] z-10 border border-border bg-subtle px-2 py-1.5 text-[10px] font-semibold text-muted-foreground">% выкуп<br />план</th>
            <th className="sticky top-[28px] z-10 border border-border bg-amber-50 px-2 py-1.5 text-[10px] font-semibold text-amber-900 dark:bg-amber-900/30">% выкуп<br />факт</th>

            <th className="sticky top-[28px] z-10 border border-border bg-subtle px-2 py-1.5 text-[10px] font-semibold text-muted-foreground">Маржа<br />план</th>
            <th className="sticky top-[28px] z-10 border border-border bg-amber-50 px-2 py-1.5 text-[10px] font-semibold text-amber-900 dark:bg-amber-900/30">Маржа<br />факт</th>

            <th className="sticky top-[28px] z-10 border border-border bg-subtle px-2 py-1.5 text-[10px] font-semibold text-muted-foreground">Заказы<br />план</th>
            <th className="sticky top-[28px] z-10 border border-border bg-amber-50 px-2 py-1.5 text-[10px] font-semibold text-amber-900 dark:bg-amber-900/30">Заказы<br />факт</th>
            <th className="sticky top-[28px] z-10 border border-border bg-subtle px-2 py-1.5 text-[10px] font-semibold text-muted-foreground">Δ %</th>

            <th className="sticky top-[28px] z-10 border border-border bg-subtle px-2 py-1.5 text-[10px] font-semibold text-muted-foreground">Шт</th>
            <th className="sticky top-[28px] z-10 border border-border bg-subtle px-2 py-1.5 text-[10px] font-semibold text-muted-foreground">Сумма</th>

            <th className="sticky top-[28px] z-10 border border-border bg-subtle px-2 py-1.5 text-[10px] font-semibold text-muted-foreground">Прибыль<br />/нед</th>
            <th className="sticky top-[28px] z-10 border border-border bg-subtle px-2 py-1.5 text-[10px] font-semibold text-muted-foreground">Накоп.</th>
            <th className="sticky top-[28px] z-10 border border-border bg-subtle px-2 py-1.5 text-[10px] font-semibold text-muted-foreground">Касса</th>
          </tr>
        </thead>

        <tbody>
          {rows.map((r, idx) => {
            const date = new Date(r.date);
            const next = new Date(date.getTime() + 7 * 86400000);
            const isCurrent = highlightToday && date.getTime() <= todayMs && next.getTime() > todayMs;
            const isPast = !isCurrent && next.getTime() < todayMs;

            const rowClass = isCurrent
              ? 'bg-emerald-50/60 dark:bg-emerald-900/15'
              : isPast
                ? 'opacity-75'
                : '';

            const buyouts = r.factOrders != null
              ? Math.round(r.factOrders * ((r.buyoutFact ?? r.buyoutPlan) / 100))
              : Math.round(r.planOrders * (r.buyoutPlan / 100));
            const buyoutAmount = buyouts * (r.priceFact ?? r.pricePlan);

            return (
              <tr key={r.wk} className={`border-b border-border font-mono ${rowClass}`}>
                <td className="whitespace-nowrap border border-border px-2 py-1 text-left">
                  {formatRuDate(r.date)}{isCurrent ? ' ▸' : ''}
                </td>
                <td className="border border-border px-2 py-1 text-center font-sans font-bold">W{r.wk}</td>
                <td className="border border-border px-2 py-1 text-center font-sans">{r.monthName}</td>
                <td className="border border-border px-2 py-1 text-center font-sans">
                  <SeasonPill kind={phases[idx]!} />
                </td>

                {/* Цена */}
                <td className="border border-border px-2 py-1 text-right">{Math.round(r.pricePlan)} ₽</td>
                <td className="border border-border bg-amber-50/50 px-2 py-1 text-right dark:bg-amber-900/15">
                  {r.priceFact != null ? `${Math.round(r.priceFact)} ₽` : '—'}
                </td>
                <td className="border border-border px-2 py-1 text-right">{r.buyoutPlan.toFixed(0)}%</td>
                <td className="border border-border bg-amber-50/50 px-2 py-1 text-right dark:bg-amber-900/15">
                  {r.buyoutFact != null ? `${r.buyoutFact.toFixed(0)}%` : '—'}
                </td>

                {/* Маржа */}
                <td className="border border-border px-2 py-1 text-right">{(r.marginPlan * 100).toFixed(1)}%</td>
                <td className="border border-border bg-amber-50/50 px-2 py-1 text-right dark:bg-amber-900/15">
                  {r.marginFact != null ? `${(r.marginFact * 100).toFixed(1)}%` : '—'}
                </td>

                {/* Заказы */}
                <td className="border border-border px-2 py-1 text-right">{formatNum(r.planOrders)}</td>
                <td className="border border-border bg-amber-50/50 px-2 py-1 text-right dark:bg-amber-900/15">
                  {formatNum(r.factOrders)}
                </td>
                <td className="border border-border px-2 py-1 text-right" style={{ ...parseInlineStyle(deviationCellStyle(r.planOrders, r.factOrders)) }}>
                  {deltaPercent(r.planOrders, r.factOrders)}
                </td>

                {/* Выкупы */}
                <td className="border border-border px-2 py-1 text-right">{formatNum(buyouts)}</td>
                <td className="border border-border px-2 py-1 text-right">{formatMoneyCompact(buyoutAmount)}</td>

                {/* Финал */}
                <td className="border border-border px-2 py-1 text-right">{formatMoneyCompact(r.weekProfit)}</td>
                <td className="border border-border px-2 py-1 text-right">{formatMoneyCompact(r.cumProfit)}</td>
                <td className="border border-border px-2 py-1 text-right" style={{ ...parseInlineStyle(cashCellStyle(r.cumCash, maxCash)) }}>
                  {formatMoneyCompact(r.cumCash)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Tiny parser for inline CSS strings → React style object. Keeps cell logic terse. */
function parseInlineStyle(css: string): React.CSSProperties {
  if (!css) return {};
  const obj: Record<string, string> = {};
  for (const decl of css.split(';')) {
    const [k, v] = decl.split(':');
    if (!k || v == null) continue;
    const key = k.trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    obj[key] = v.trim();
  }
  return obj as React.CSSProperties;
}

export default WeeklyPlanTable;
