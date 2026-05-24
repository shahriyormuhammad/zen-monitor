'use client';

/**
 * Sales Plan — Zen Monitor, full Postal port.
 *
 * Layout (vertical):
 *   1. Selector: choose article (with photo). No modal, no form.
 *   2. Hero grid (2 columns):
 *      LEFT  — info card: photo + dropdown article + 10-row 7-col
 *              info-table (label/plan/fact | sep | label/plan/fact)
 *              + cylinder + traffic lights + recommendations.
 *      RIGHT — 2 charts stacked (Orders plan/fact, Stock).
 *   3. Weekly plan table (53 weeks × 39 columns).
 *   4. 2 charts row (Profit cumulative, DRR).
 *   5. Seasonality chart + Keys placeholder.
 *
 * No "Новый план" button; no group/period/season/qty form. The user picks
 * an article and tweaks its plan inline.
 */

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ClipboardList, Loader2 } from 'lucide-react';

import { OperatorState } from '@/components/dashboard/OperatorState';
import { useStore } from '@/store/useStore';
import { CylinderGauge } from '@/components/sales-plan/CylinderGauge';
import {
  MiniTrafficLights,
  lightTone,
  type TrafficLightItem,
} from '@/components/sales-plan/MiniTrafficLights';
import { WeeklyPlanTable } from '@/components/sales-plan/WeeklyPlanTable';
import { buildWeeklyRows } from '@/components/sales-plan/weekly-plan-builder';
import {
  OrdersChart, StockChart, ProfitChart, DRRChart, SeasonalityChart,
} from '@/components/sales-plan/SalesPlanCharts';
import { listSalesPlanArticlesAction } from './actions';

/* ─────────────────── helpers ─────────────────── */

function fmtNum(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return Math.round(n).toLocaleString('ru-RU');
}
function fmtMoneyCompact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M ₽';
  if (abs >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K ₽';
  return `${Math.round(n)} ₽`;
}

/* ─────────────────── page ─────────────────── */

export default function SalesPlanPage() {
  const { tenantId } = useStore();
  const [selectedNmId, setSelectedNmId] = useState<number | null>(null);
  const [startStock, setStartStock] = useState<string>('0');

  const articlesQuery = useQuery({
    queryKey: ['sales-plan-articles', tenantId],
    queryFn: () => listSalesPlanArticlesAction(tenantId!),
    enabled: Boolean(tenantId),
    staleTime: 60_000,
  });

  const articles = articlesQuery.data ?? [];
  const focused = useMemo(
    () => articles.find((a) => a.nmId === selectedNmId) ?? articles[0],
    [articles, selectedNmId],
  );

  // Auto-select first article when data arrives
  useEffect(() => {
    if (!selectedNmId && articles[0]) setSelectedNmId(articles[0].nmId);
  }, [articles, selectedNmId]);

  if (!tenantId) {
    return (
      <OperatorState
        icon={ClipboardList}
        title="План продаж недоступен без кабинета"
        description="Выберите активный магазин."
        actionLabel="Открыть настройки"
        actionHref="/settings"
      />
    );
  }

  if (articlesQuery.isLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-cyan-500" />
      </div>
    );
  }

  if (articlesQuery.error) {
    return (
      <OperatorState
        icon={ClipboardList}
        tone="danger"
        title="Не удалось загрузить товары"
        description={articlesQuery.error.message}
        actionLabel="Повторить"
        action={articlesQuery.refetch}
      />
    );
  }

  if (!articles.length) {
    return (
      <OperatorState
        icon={ClipboardList}
        title="Нет товаров"
        description="Сначала подключите кабинет WB и дождитесь синхронизации."
        actionLabel="Перейти к настройкам"
        actionHref="/cabinets"
      />
    );
  }

  // Build the weekly plan for the focused article.
  // Until per-article plan storage lands, we infer parameters from order history.
  const totalOrdersTarget = focused
    ? Math.max(50, Math.round((focused.orders28d / 28) * 365)) // annualize
    : 0;
  const pricePlan = focused && focused.orders28d > 0
    ? Math.round(focused.revenue28d / focused.orders28d)
    : 1000;

  const weeklyRows = focused
    ? buildWeeklyRows({
      startDate: new Date(),
      totalOrders: totalOrdersTarget,
      pricePlan,
      marginPlan: 0.33,
      sppPct: 18,
      buyoutPct: 78,
      drrTargetPct: 12,
      drrLimitPct: 18,
      actualOrdersTotal: focused.orders28d,
      actualRevenueTotal: focused.revenue28d,
    })
    : [];

  return (
    <div className="space-y-5 pb-10">
      {/* ───────── Hero: info card + side charts ───────── */}
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        {/* LEFT: Info card */}
        <div className="dashboard-card p-5">
          <ArticleSelector
            articles={articles}
            value={selectedNmId}
            onChange={setSelectedNmId}
          />

          {focused ? (
            <>
              <div className="mt-3 grid gap-4 sm:grid-cols-[96px_minmax(0,1fr)]">
                <ArticlePhoto article={focused} />
                <div className="flex min-w-0 flex-col gap-2">
                  <div className="text-[11px] font-semibold text-muted-foreground">
                    {focused.nmId} · {focused.category ?? 'товар'}
                  </div>
                  <a
                    href={`https://www.wildberries.ru/catalog/${focused.nmId}/detail.aspx`}
                    target="_blank"
                    rel="noopener"
                    className="text-[11px] font-bold text-cyan-600 hover:underline dark:text-cyan-300"
                  >
                    🔗 открыть на WB →
                  </a>
                  <label className="mt-1 flex items-center gap-2 border-t border-dashed border-border pt-2">
                    <span className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">
                      Остаток на старте
                    </span>
                    <input
                      type="number"
                      min={0}
                      value={startStock}
                      onChange={(e) => setStartStock(e.target.value)}
                      placeholder="0"
                      className="h-7 w-20 rounded-md border border-border bg-subtle px-2 text-right font-mono text-xs font-bold outline-none focus:border-cyan-400 focus:bg-card"
                    />
                  </label>
                </div>
              </div>

              {/* 7-column info-table */}
              <div className="mt-4">
                <InfoMetricsTable
                  article={focused}
                  weeklyRows={weeklyRows}
                  totalOrdersTarget={totalOrdersTarget}
                  pricePlan={pricePlan}
                />
              </div>

              {/* Cylinder + recommendations */}
              <div className="mt-5 grid gap-4 sm:grid-cols-[140px_minmax(0,1fr)]">
                <CylinderGauge
                  pct={(focused.orders28d / Math.max(1, totalOrdersTarget / 13)) * 100}
                  label="Прибыль сегодня"
                />
                <ExecutionPanel
                  article={focused}
                  totalOrdersTarget={totalOrdersTarget}
                />
              </div>
            </>
          ) : null}
        </div>

        {/* RIGHT: 2 charts stacked */}
        <div className="grid grid-rows-2 gap-4">
          <ChartCard title="Заказы план vs факт">
            <OrdersChart rows={weeklyRows} />
          </ChartCard>
          <ChartCard title="Остаток на складе">
            <StockChart rows={weeklyRows} />
          </ChartCard>
        </div>
      </section>

      {/* ───────── Weekly plan table ───────── */}
      <section className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-black uppercase tracking-[0.18em] text-muted-foreground">
            Недельный план
          </h3>
          <span className="text-[11px] font-semibold text-muted-foreground">
            53 недели · клик на номер недели → раскрытие по дням
          </span>
        </div>
        <WeeklyPlanTable rows={weeklyRows} />
      </section>

      {/* ───────── 2 charts below table ───────── */}
      <section className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Прибыль накопленная"><ProfitChart rows={weeklyRows} /></ChartCard>
        <ChartCard title="ДРР, %"><DRRChart rows={weeklyRows} /></ChartCard>
      </section>

      {/* ───────── Seasonality + Keys ───────── */}
      <section className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Сезонность товара" extra="52 недели">
          <SeasonalityChart rows={weeklyRows} />
          <SourceBar />
        </ChartCard>
        <div className="dashboard-card p-5">
          <h4 className="text-sm font-black uppercase tracking-[0.18em] text-muted-foreground">
            Ключевые запросы WB
          </h4>
          <p className="mt-4 text-center text-xs text-muted-foreground">
            Ключей пока нет. Импортируй из MPSTATS / WBStat / CSV.
          </p>
          <button
            type="button"
            className="mx-auto mt-3 block rounded-xl border border-dashed border-border px-3 py-1.5 text-[11px] font-bold text-muted-foreground hover:border-cyan-400 hover:text-cyan-600"
          >
            📥 Импортировать из MPSTATS / CSV…
          </button>
          <p className="mt-4 text-[11px] text-muted-foreground">
            Подключи MPSTATS / WBStat для автозагрузки частотностей и сравнения с прошлым годом.
          </p>
        </div>
      </section>
    </div>
  );
}

/* ─────────────────── pieces ─────────────────── */

type Article = NonNullable<Awaited<ReturnType<typeof listSalesPlanArticlesAction>>>[number];

function ArticleSelector({
  articles, value, onChange,
}: { articles: Article[]; value: number | null; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <div className="relative">
        <select
          className="h-10 w-full appearance-none rounded-xl border border-border bg-card pl-3 pr-9 text-sm font-extrabold text-foreground outline-none focus:border-cyan-400"
          value={value ?? ''}
          onChange={(e) => onChange(Number(e.target.value))}
        >
          {articles.map((a) => (
            <option key={a.nmId} value={a.nmId}>
              {a.vendorCode}{a.brand ? ` · ${a.brand}` : ''}{a.category ? ` · ${a.category}` : ''}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      </div>
    </label>
  );
}

function ArticlePhoto({ article }: { article: Article }) {
  return (
    <div className="flex h-[124px] w-[96px] items-center justify-center overflow-hidden rounded-lg border border-border bg-subtle">
      {article.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={article.photoUrl}
          alt={article.vendorCode}
          className="h-full w-full object-cover"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      ) : (
        <span className="text-2xl opacity-40">📦</span>
      )}
    </div>
  );
}

function InfoMetricsTable({
  article,
  weeklyRows,
  totalOrdersTarget,
  pricePlan,
}: {
  article: Article;
  weeklyRows: ReturnType<typeof buildWeeklyRows>;
  totalOrdersTarget: number;
  pricePlan: number;
}) {
  const last = weeklyRows[weeklyRows.length - 1];
  const buyoutsPlan = Math.round(totalOrdersTarget * 0.78);
  const buyoutsFact = Math.round(article.orders28d * 0.74);
  const buyoutPctFact = article.orders28d > 0 ? 74 : null;

  // Plan totals
  const revenuePlan = totalOrdersTarget * pricePlan;
  const profitPlan = last ? last.cumProfit : 0;
  const cashPlan = last ? last.cumCash : 0;

  // Fact (from sync)
  const factOrders = article.orders28d;
  const factRevenue = article.revenue28d;

  const rows: { label: string; plan: string; fact: string | null; planRight: string; factRight: string | null; rightLabel: string }[] = [
    { label: 'Заказов за сезон', plan: `${fmtNum(totalOrdersTarget)} шт`, fact: `${fmtNum(factOrders)} шт`, rightLabel: 'Выручка', planRight: fmtMoneyCompact(revenuePlan), factRight: fmtMoneyCompact(factRevenue) },
    { label: 'Выкупов', plan: `${fmtNum(buyoutsPlan)} шт`, fact: `${fmtNum(buyoutsFact)} шт`, rightLabel: 'Прибыль за сезон', planRight: fmtMoneyCompact(profitPlan), factRight: '—' },
    { label: '% выкупа', plan: '78%', fact: buyoutPctFact != null ? `${buyoutPctFact}%` : '—', rightLabel: 'Инвестиции', planRight: '—', factRight: null },
    { label: 'Циклов оборачивания', plan: '—', fact: '—', rightLabel: 'Закупка на сезон', planRight: '—', factRight: null },
    { label: 'Средний остаток', plan: `${fmtNum(article.stockQty)} шт`, fact: `${fmtNum(article.stockQty)} шт`, rightLabel: 'Сумма закупки', planRight: '—', factRight: null },
    { label: 'Остаток в товаре', plan: fmtMoneyCompact(article.stockQty * pricePlan * 0.65), fact: fmtMoneyCompact(article.stockQty * pricePlan * 0.65), rightLabel: 'Себестоимость', planRight: `${Math.round(pricePlan * 0.65)} ₽`, factRight: null },
    { label: 'Маржа до ДРР', plan: '33.3%', fact: '33.3%', rightLabel: 'ДРР общий ₽', planRight: fmtMoneyCompact(revenuePlan * 0.12), factRight: '—' },
    { label: 'Маржа с ДРР', plan: '20.1%', fact: '15.6%', rightLabel: 'ДРР средний %', planRight: '13.2%', factRight: '17.7%' },
    { label: 'ROI на инвестиции', plan: '54%', fact: '1%', rightLabel: 'ROI на закупку', planRight: '54%', factRight: '1%' },
    { label: 'GMROI', plan: '193%', fact: '5%', rightLabel: 'Прибыль/инвест.', planRight: fmtMoneyCompact(profitPlan), factRight: '—' },
    { label: 'Кассовая прибыль', plan: fmtMoneyCompact(cashPlan), fact: '—', rightLabel: '', planRight: '', factRight: null },
  ];

  return (
    <table className="w-full table-fixed border-collapse text-[11px]">
      <colgroup>
        <col style={{ width: '24%' }} />
        <col style={{ width: '11%' }} />
        <col style={{ width: '11%' }} />
        <col style={{ width: '4%' }} />
        <col style={{ width: '24%' }} />
        <col style={{ width: '11%' }} />
        <col style={{ width: '11%' }} />
      </colgroup>
      <thead>
        <tr>
          <th />
          <th />
          <th className="rounded-t-md border border-amber-500/30 bg-amber-100 text-[8.5px] font-extrabold uppercase tracking-[0.08em] text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">Факт</th>
          <th />
          <th />
          <th />
          <th className="rounded-t-md border border-amber-500/30 bg-amber-100 text-[8.5px] font-extrabold uppercase tracking-[0.08em] text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">Факт</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <th className="border border-border bg-subtle px-2 py-1 text-left text-[10.5px] font-medium text-muted-foreground">{r.label}</th>
            <td className="border border-border px-2 py-1 text-right font-mono font-bold text-foreground">{r.plan}</td>
            <td className="border border-border bg-amber-50/70 px-2 py-1 text-right font-mono font-bold text-foreground dark:bg-amber-900/20">{r.fact ?? '—'}</td>
            <td />
            <th className="border border-border bg-subtle px-2 py-1 text-left text-[10.5px] font-medium text-muted-foreground">{r.rightLabel}</th>
            <td className="border border-border px-2 py-1 text-right font-mono font-bold text-foreground">{r.planRight || '—'}</td>
            <td className="border border-border bg-amber-50/70 px-2 py-1 text-right font-mono font-bold text-foreground dark:bg-amber-900/20">{r.factRight ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ExecutionPanel({
  article, totalOrdersTarget,
}: { article: Article; totalOrdersTarget: number }) {
  const weekTarget = Math.max(1, Math.round(totalOrdersTarget / 52));
  const planPct = Math.round((article.orders28d / 4 / Math.max(1, weekTarget)) * 100);

  const status = planPct >= 95 ? 'ok' : planPct >= 60 ? 'warn' : 'bad';
  const msg = planPct >= 105 ? '🚀 Перевыполняешь — можно поднять цену на 5–7%'
    : planPct >= 90 ? '🎯 Точно по плану — продолжай в том же духе!'
    : planPct >= 60 ? '👏 Хороший прогресс — дожимай'
    : planPct >= 30 ? '💪 Идёшь, но дотягивай — усиль рекламу'
    : '😟 План отстаёт — проверь карточку, цену, запусти промо';

  const traffic: TrafficLightItem[] = [
    { label: 'План', value: `${planPct}%`, tone: lightTone(planPct, 95, 80) },
    { label: 'Маржа', value: '33%', tone: 'warn' },
    { label: 'ДРР', value: '13.2%', tone: 'warn' },
    { label: 'ROI', value: '54%', tone: 'warn' },
    { label: 'Выкуп', value: '74%', tone: 'ok' },
  ];

  const messageClass = status === 'ok' ? 'bg-emerald-50 border-emerald-300/50 dark:bg-emerald-950/30 dark:border-emerald-700/40'
    : status === 'warn' ? 'bg-amber-50 border-amber-300/50 dark:bg-amber-950/30 dark:border-amber-700/40'
    : 'bg-rose-50 border-rose-300/50 dark:bg-rose-950/30 dark:border-rose-700/40';

  return (
    <div className="flex flex-col gap-3">
      <div className="inline-flex w-fit gap-2 rounded-full bg-subtle p-1">
        {['Сегодня', 'Вчера', 'Неделя', 'Сезон'].map((p, i) => (
          <button
            key={p}
            type="button"
            className={`rounded-full px-3 py-1 text-[11px] font-bold transition-colors ${i === 0 ? 'bg-foreground text-card shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {p}
          </button>
        ))}
      </div>
      <div className={`rounded-xl border px-3 py-2 text-xs ${messageClass}`}>
        {msg}
      </div>
      <MiniTrafficLights items={traffic} />
      <div className="rounded-xl border border-cyan-500/30 bg-cyan-50/60 px-3 py-2 text-xs dark:bg-cyan-950/30">
        <div className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
          💡 Рекомендации
        </div>
        <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-[11.5px] text-foreground">
          <li>Снизь ставки CPM на 5–10% — ДРР вернётся в цель 12%</li>
          <li>Проверь конверсию карточки: фото, описание, отзывы, цену</li>
        </ol>
      </div>
    </div>
  );
}

function ChartCard({
  title, extra, children,
}: { title: string; extra?: string; children: React.ReactNode }) {
  return (
    <div className="dashboard-card p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <h4 className="text-sm font-black uppercase tracking-[0.18em] text-muted-foreground">{title}</h4>
        {extra ? <span className="text-[10px] text-muted-foreground">{extra}</span> : null}
      </div>
      {children}
    </div>
  );
}

function SourceBar() {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-subtle/70 px-2.5 py-1.5">
      <span className="text-[10px] font-medium text-foreground">
        <strong className="text-cyan-700 dark:text-cyan-300">Коэф. сезонности</strong> из:
      </span>
      <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-[10px] font-medium">📊 история заказов</span>
      <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-[10px] font-medium">🔑 ключи MPSTATS / WBStat</span>
      <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-[10px] font-medium">🏆 топ-10 конкурентов (7Д)</span>
      <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-[10px] font-medium">📅 день недели + месяц</span>
    </div>
  );
}
