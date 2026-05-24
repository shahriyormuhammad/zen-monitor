'use client';

/**
 * Weekly Plan Table — 53-week × 39-column (Postal full-stack port).
 *
 * Column groups (each with its own pastel header colour):
 *   Период | Нед | Месяц | Сезон
 *   Сезонность (5):   Коэф расчёт · Скор. зак. 7Д · Коэф цен · Коэф спрос/предл · Коэф итого
 *   Цена (6):          Цена СПП план / факт · СПП план / факт · Цена до СПП план / факт
 *   Маржа (3):         Маржа план / факт · Раскрутка
 *   Заказы (3):        план / факт · Δ%
 *   Выкупы (3):        % план / факт · шт
 *   Остатки (3):       План / Факт · Об-ть дн
 *   Поставка (3):      ручная · руб · инвестиции
 *   ДРР (5):           % план / факт · руб · внешн · общий
 *   Финал (7):         Маржа с ДРР · К перечисл · Налог % · Налог · Прибыль/нед · Накопл · Касса
 */

import { useMemo } from 'react';
import { SeasonPill, classifySeasonPhase, type SeasonKind } from './SeasonPill';

export type WeeklyRow = {
  wk: number;
  date: string;
  dateEnd: string;
  monthName: string;
  // Сезонность
  seasonCoef: number;
  coefSeasonPrice: number;
  coefDemandSupply: number;
  coefFinal: number;
  compRate7d: number;
  // Цена
  pricePlan: number;
  priceFact: number | null;
  sppPlan: number;
  sppFact: number | null;
  priceBeforeSppPlan: number;
  priceBeforeSppFact: number | null;
  // Маржа / Раскрутка
  marginPlan: number;
  marginFact: number | null;
  ramp: number;
  // Заказы
  planOrders: number;
  factOrders: number | null;
  // Выкупы
  buyoutPlan: number;
  buyoutFact: number | null;
  buyoutShtPlan: number;
  buyoutShtFact: number | null;
  // Остатки / Поставка
  supplies: number;
  supplyRub: number;
  stockPlan: number;
  stockFact: number | null;
  stockDays: number | null;
  investments: number;
  // ДРР
  drrPlan: number;
  drrFact: number | null;
  adCost: number;
  externalCosts: number;
  drrTotalPct: number;
  // Финал
  marginAfterDrrPct: number;
  toTransfer: number;
  taxPct: number;
  taxRub: number;
  weekProfit: number;
  cumProfit: number;
  cumCash: number;
};

type Props = {
  rows: WeeklyRow[];
  highlightToday?: boolean;
};

function formatRuDate(iso: string): string {
  const [, m, d] = iso.split('-').map((s) => Number(s));
  const months = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  return `${d}\u00a0${months[(m ?? 1) - 1]}`;
}

function formatPeriod(start: string, end: string): string {
  const fmt = (iso: string) => {
    const [, m, d] = iso.split('-').map((s) => Number(s));
    return `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}`;
  };
  return `${fmt(start)} → ${fmt(end)}`;
}

function fmtNum(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return Math.round(n).toLocaleString('ru-RU');
}

function fmtMoneyCompact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M\u00a0₽';
  if (abs >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K\u00a0₽';
  return Math.round(n) + '\u00a0₽';
}

function cashCellStyle(value: number, maxAbs: number): React.CSSProperties {
  if (!Number.isFinite(value)) return {};
  const ratio = Math.max(-1, Math.min(1, value / (maxAbs || 1)));
  if (ratio >= 0) {
    const alpha = 0.10 + ratio * 0.30;
    return { background: `rgba(16,185,129,${alpha.toFixed(2)})`, color: '#065f46', fontWeight: 700 };
  }
  const a = 0.10 + Math.abs(ratio) * 0.32;
  return { background: `rgba(239,68,68,${a.toFixed(2)})`, color: '#991b1b', fontWeight: 700 };
}

function deltaCellStyle(plan: number, fact: number | null): React.CSSProperties {
  if (fact == null || plan <= 0) return {};
  const d = (fact - plan) / plan;
  if (d > 0.05) return { background: 'rgba(16,185,129,.18)', color: '#047857', fontWeight: 700 };
  if (d < -0.20) return { background: 'rgba(239,68,68,.22)', color: '#b91c1c', fontWeight: 700 };
  if (d < -0.05) return { background: 'rgba(245,158,11,.22)', color: '#92400e', fontWeight: 700 };
  return {};
}

function deltaPercent(plan: number, fact: number | null): string {
  if (fact == null || plan <= 0) return '—';
  const d = ((fact - plan) / plan) * 100;
  return `${d >= 0 ? '+' : ''}${d.toFixed(0)}%`;
}

const GROUPS = {
  season:  'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300',
  price:   'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  margin:  'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-950 dark:text-fuchsia-300',
  orders:  'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  buyout:  'bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300',
  stock:   'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300',
  supply:  'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300',
  drr:     'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
  final:   'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
};

const HEAD_TH = 'sticky top-0 z-10 border border-border bg-subtle px-2 py-1.5 text-[10.5px] font-bold text-muted-foreground whitespace-nowrap';
const HEAD_FACT = 'sticky top-0 z-10 border border-border bg-amber-50 px-2 py-1.5 text-[10px] font-semibold text-amber-900 dark:bg-amber-900/30 whitespace-nowrap';
const CELL = 'border border-border px-2 py-1 text-right whitespace-nowrap';
const CELL_FACT = 'border border-border bg-amber-50/50 px-2 py-1 text-right whitespace-nowrap dark:bg-amber-900/15';

// Vertical divider between column groups — thick black left border so the
// reader instantly sees where one group ends and the next begins.
const SEP = 'border-l-[2px] border-l-foreground dark:border-l-foreground';

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
      <table className="w-full min-w-[2900px] border-collapse text-[11px]">
        <thead>
          {/* Group row */}
          <tr>
            <th rowSpan={2} className={HEAD_TH}>Период</th>
            <th rowSpan={2} className={HEAD_TH}>Нед</th>
            <th rowSpan={2} className={HEAD_TH}>Месяц</th>
            <th rowSpan={2} className={HEAD_TH}>Сезон</th>
            <th colSpan={5} className={`border border-border px-2 py-1 text-[11px] font-extrabold uppercase tracking-[0.04em] ${GROUPS.season}`}>Сезонность</th>
            <th colSpan={6} className={`border border-border px-2 py-1 text-[11px] font-extrabold uppercase tracking-[0.04em] ${GROUPS.price}`}>Цена</th>
            <th colSpan={3} className={`border border-border px-2 py-1 text-[11px] font-extrabold uppercase tracking-[0.04em] ${GROUPS.margin}`}>Маржа / Раскрутка</th>
            <th colSpan={3} className={`border border-border px-2 py-1 text-[11px] font-extrabold uppercase tracking-[0.04em] ${GROUPS.orders}`}>Заказы</th>
            <th colSpan={3} className={`border border-border px-2 py-1 text-[11px] font-extrabold uppercase tracking-[0.04em] ${GROUPS.buyout}`}>Выкупы</th>
            <th colSpan={3} className={`border border-border px-2 py-1 text-[11px] font-extrabold uppercase tracking-[0.04em] ${GROUPS.stock}`}>Остатки</th>
            <th colSpan={3} className={`border border-border px-2 py-1 text-[11px] font-extrabold uppercase tracking-[0.04em] ${GROUPS.supply}`}>Поставка</th>
            <th colSpan={5} className={`border border-border px-2 py-1 text-[11px] font-extrabold uppercase tracking-[0.04em] ${GROUPS.drr}`}>ДРР</th>
            <th colSpan={7} className={`border border-border px-2 py-1 text-[11px] font-extrabold uppercase tracking-[0.04em] ${GROUPS.final}`}>Финал</th>
          </tr>

          {/* Sub-columns */}
          <tr>
            <th className={`${HEAD_TH} ${SEP}`}>Коэф<br/>расчёт</th>
            <th className={HEAD_TH}>Скор.<br/>зак. 7Д</th>
            <th className={HEAD_TH}>Коэф<br/>цен</th>
            <th className={HEAD_TH}>Спрос<br/>/предл</th>
            <th className={HEAD_TH}>Итого</th>

            <th className={`${HEAD_TH} ${SEP}`}>Цена СПП<br/>план</th>
            <th className={HEAD_FACT}>Цена СПП<br/>факт</th>
            <th className={HEAD_TH}>СПП<br/>план</th>
            <th className={HEAD_FACT}>СПП<br/>факт</th>
            <th className={HEAD_TH}>До СПП<br/>план</th>
            <th className={HEAD_FACT}>До СПП<br/>факт</th>

            <th className={`${HEAD_TH} ${SEP}`}>Маржа<br/>план</th>
            <th className={HEAD_FACT}>Маржа<br/>факт</th>
            <th className={HEAD_TH}>Раскр.</th>

            <th className={`${HEAD_TH} ${SEP}`}>Заказы<br/>план</th>
            <th className={HEAD_FACT}>Заказы<br/>факт</th>
            <th className={HEAD_TH}>Δ %</th>

            <th className={`${HEAD_TH} ${SEP}`}>% выкуп<br/>план</th>
            <th className={HEAD_FACT}>% выкуп<br/>факт</th>
            <th className={HEAD_TH}>Шт</th>

            <th className={`${HEAD_TH} ${SEP}`}>Остаток<br/>план</th>
            <th className={HEAD_FACT}>Остаток<br/>факт</th>
            <th className={HEAD_TH}>Об-ть<br/>дн</th>

            <th className={`${HEAD_TH} ${SEP}`}>Ручная<br/>поставка</th>
            <th className={HEAD_TH}>Сумма<br/>₽</th>
            <th className={HEAD_TH}>Инвест.</th>

            <th className={`${HEAD_TH} ${SEP}`}>% ДРР<br/>план</th>
            <th className={HEAD_FACT}>% ДРР<br/>факт</th>
            <th className={HEAD_TH}>ДРР ₽</th>
            <th className={HEAD_TH}>Внешн.</th>
            <th className={HEAD_TH}>Общий</th>

            <th className={`${HEAD_TH} ${SEP}`}>Маржа<br/>с ДРР</th>
            <th className={HEAD_TH}>К пере-<br/>числ.</th>
            <th className={HEAD_TH}>Налог %</th>
            <th className={HEAD_TH}>Налог</th>
            <th className={HEAD_TH}>Прибыль<br/>/нед</th>
            <th className={HEAD_TH}>Накоп.</th>
            <th className={HEAD_TH}>Касса</th>
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

            return (
              <tr key={r.wk} className={`border-b border-border font-mono ${rowClass}`}>
                <td className="whitespace-nowrap border border-border px-2 py-1 text-left">
                  {formatPeriod(r.date, r.dateEnd)}{isCurrent ? ' ▸' : ''}
                </td>
                <td className="border border-border px-2 py-1 text-center font-sans font-bold">W{r.wk}</td>
                <td className="border border-border px-2 py-1 text-center font-sans">{r.monthName}</td>
                <td className="border border-border px-2 py-1 text-center font-sans">
                  <SeasonPill kind={phases[idx]!} />
                </td>

                {/* Сезонность */}
                <td className={`${CELL} ${SEP}`}>{(r.seasonCoef * 100).toFixed(0)}%</td>
                <td className={CELL}>{fmtNum(r.compRate7d)}</td>
                <td className={CELL}>{(r.coefSeasonPrice * 100).toFixed(0)}%</td>
                <td className={CELL}>{(r.coefDemandSupply * 100).toFixed(0)}%</td>
                <td className={CELL}>{(r.coefFinal * 100).toFixed(0)}%</td>

                {/* Цена */}
                <td className={`${CELL} ${SEP}`}>{Math.round(r.pricePlan)} ₽</td>
                <td className={CELL_FACT}>{r.priceFact != null ? `${Math.round(r.priceFact)} ₽` : '—'}</td>
                <td className={CELL}>{r.sppPlan.toFixed(1)}%</td>
                <td className={CELL_FACT}>{r.sppFact != null ? `${r.sppFact.toFixed(1)}%` : '—'}</td>
                <td className={CELL}>{Math.round(r.priceBeforeSppPlan)} ₽</td>
                <td className={CELL_FACT}>{r.priceBeforeSppFact != null ? `${Math.round(r.priceBeforeSppFact)} ₽` : '—'}</td>

                {/* Маржа */}
                <td className={`${CELL} ${SEP}`}>{(r.marginPlan * 100).toFixed(1)}%</td>
                <td className={CELL_FACT}>{r.marginFact != null ? `${(r.marginFact * 100).toFixed(1)}%` : '—'}</td>
                <td className={CELL}>{(r.ramp * 100).toFixed(0)}%</td>

                {/* Заказы */}
                <td className={`${CELL} ${SEP}`}>{fmtNum(r.planOrders)}</td>
                <td className={CELL_FACT}>{fmtNum(r.factOrders)}</td>
                <td className={CELL} style={deltaCellStyle(r.planOrders, r.factOrders)}>
                  {deltaPercent(r.planOrders, r.factOrders)}
                </td>

                {/* Выкупы */}
                <td className={`${CELL} ${SEP}`}>{r.buyoutPlan.toFixed(0)}%</td>
                <td className={CELL_FACT}>{r.buyoutFact != null ? `${r.buyoutFact.toFixed(0)}%` : '—'}</td>
                <td className={CELL}>{fmtNum(r.buyoutShtFact ?? r.buyoutShtPlan)}</td>

                {/* Остатки */}
                <td className={`${CELL} ${SEP}`}>{fmtNum(r.stockPlan)}</td>
                <td className={CELL_FACT}>{fmtNum(r.stockFact)}</td>
                <td className={CELL}>{r.stockDays != null ? r.stockDays : '—'}</td>

                {/* Поставка */}
                <td className={`${CELL} ${SEP}`}>{fmtNum(r.supplies)}</td>
                <td className={CELL}>{fmtMoneyCompact(r.supplyRub)}</td>
                <td className={CELL}>{fmtMoneyCompact(r.investments)}</td>

                {/* ДРР */}
                <td className={`${CELL} ${SEP}`}>{r.drrPlan.toFixed(1)}%</td>
                <td className={CELL_FACT}>{r.drrFact != null ? `${r.drrFact.toFixed(1)}%` : '—'}</td>
                <td className={CELL}>{fmtMoneyCompact(r.adCost)}</td>
                <td className={CELL}>{fmtMoneyCompact(r.externalCosts)}</td>
                <td className={CELL}>{r.drrTotalPct.toFixed(1)}%</td>

                {/* Финал */}
                <td className={`${CELL} ${SEP}`}>{(r.marginAfterDrrPct * 100).toFixed(1)}%</td>
                <td className={CELL}>{fmtMoneyCompact(r.toTransfer)}</td>
                <td className={CELL}>{r.taxPct.toFixed(1)}%</td>
                <td className={CELL}>{fmtMoneyCompact(r.taxRub)}</td>
                <td className={CELL}>{fmtMoneyCompact(r.weekProfit)}</td>
                <td className={CELL}>{fmtMoneyCompact(r.cumProfit)}</td>
                <td className={CELL} style={cashCellStyle(r.cumCash, maxCash)}>
                  {fmtMoneyCompact(r.cumCash)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default WeeklyPlanTable;

// Re-export so callers can keep the formatRuDate helper if needed.
export { formatRuDate };
