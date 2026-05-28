'use client';

/**
 * Visual summary above the deficit table in «План поставки»:
 *   1. Donut «Дефицит по округам» — need share per okrug.
 *   2. «Топ дефицитных артикулов» — top-5 by total need with bars.
 *   3. «Покрытие по округам» — stock / (stock + need) as coloured bars.
 *
 * Shares the same react-query key as DeficitClusters (30/30 default) so it
 * doesn't trigger a second server round-trip.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';

import { loadDeficitTableAction } from '@/app/(dashboard)/supply/actions';

const OKRUG_ORDER = ['ЦФО', 'СЗФО', 'ПФО', 'УФО', 'СФО', 'ЮФО'] as const;
const OKRUG_LABEL: Record<string, string> = {
  'ЦФО': 'ЦФО', 'СЗФО': 'СЗФО', 'ПФО': 'ПФО', 'УФО': 'УФО', 'СФО': 'СФО+ДФО', 'ЮФО': 'ЮФО+СКФО',
};
const COLORS = ['#6366f1', '#06b6d4', '#f59e0b', '#10b981', '#a855f7', '#ef4444'];

function fmtNum(n: number): string {
  return Math.round(n).toLocaleString('ru-RU');
}

export function DeficitWidgets({ tenantId }: { tenantId: string }) {
  const query = useQuery({
    queryKey: ['deficit', tenantId, 30, 30],
    queryFn: () => loadDeficitTableAction(tenantId, 30, 30),
    enabled: Boolean(tenantId),
    staleTime: 30_000,
  });

  const data = query.data;

  const donut = useMemo(() => {
    if (!data) return [];
    return OKRUG_ORDER
      .map((okrug, i) => ({
        name: OKRUG_LABEL[okrug] ?? okrug,
        value: data.totals.byOkrug[okrug]?.need ?? 0,
        color: COLORS[i % COLORS.length]!,
      }))
      .filter((d) => d.value > 0);
  }, [data]);

  const topDeficit = useMemo(() => {
    if (!data) return [];
    return data.rows.filter((r) => r.overall.need > 0).slice(0, 5);
  }, [data]);

  const coverage = useMemo(() => {
    if (!data) return [];
    return OKRUG_ORDER.map((okrug) => {
      const cell = data.totals.byOkrug[okrug] ?? { sales: 0, stock: 0, need: 0 };
      const denom = cell.stock + cell.need;
      const pct = denom === 0 ? 100 : Math.round((cell.stock / denom) * 100);
      return { okrug: OKRUG_LABEL[okrug] ?? okrug, pct, stock: cell.stock, need: cell.need };
    });
  }, [data]);

  if (query.isLoading || !data) return null;

  const totalNeed = data.totals.totalForecastNeed;
  const maxNeed = Math.max(1, ...topDeficit.map((r) => r.overall.need));

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* Donut */}
      <div className="dashboard-card p-4">
        <h4 className="text-[12px] font-black uppercase tracking-[0.14em] text-muted-foreground">Дефицит по округам</h4>
        {donut.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-[12px] text-muted-foreground">Дефицита нет 🎉</div>
        ) : (
          <div className="relative mt-2 h-40">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={donut} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={42} outerRadius={64} paddingAngle={2}>
                  {donut.map((d) => <Cell key={d.name} fill={d.color} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <div className="font-mono text-[18px] font-extrabold text-foreground">{fmtNum(totalNeed)}</div>
              <div className="text-[9px] uppercase text-muted-foreground">шт нужно</div>
            </div>
          </div>
        )}
        {donut.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
            {donut.map((d) => (
              <span key={d.name} className="inline-flex items-center gap-1 text-[10.5px] text-muted-foreground">
                <span className="h-2 w-2 rounded-full" style={{ background: d.color }} />
                {d.name} · <strong className="text-foreground">{fmtNum(d.value)}</strong>
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {/* Top deficit */}
      <div className="dashboard-card p-4">
        <h4 className="text-[12px] font-black uppercase tracking-[0.14em] text-muted-foreground">Топ дефицитных</h4>
        {topDeficit.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-[12px] text-muted-foreground">Нет дефицита</div>
        ) : (
          <div className="mt-2 flex flex-col gap-2">
            {topDeficit.map((r) => (
              <div key={r.nmId}>
                <div className="flex items-baseline justify-between text-[11px]">
                  <span className="truncate font-bold text-foreground">{r.vendorCode}</span>
                  <span className="ml-2 shrink-0 font-mono font-bold text-rose-700">{fmtNum(r.overall.need)}</span>
                </div>
                <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-subtle">
                  <div className="h-full rounded-full bg-rose-500" style={{ width: `${(r.overall.need / maxNeed) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Coverage */}
      <div className="dashboard-card p-4">
        <h4 className="text-[12px] font-black uppercase tracking-[0.14em] text-muted-foreground">Покрытие по округам</h4>
        <div className="mt-2 flex flex-col gap-2">
          {coverage.map((c) => {
            const color = c.pct >= 80 ? 'bg-emerald-500' : c.pct >= 50 ? 'bg-amber-500' : 'bg-rose-500';
            return (
              <div key={c.okrug}>
                <div className="flex items-baseline justify-between text-[11px]">
                  <span className="font-bold text-foreground">{c.okrug}</span>
                  <span className="ml-2 font-mono text-muted-foreground">{c.pct}%</span>
                </div>
                <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-subtle">
                  <div className={`h-full rounded-full ${color}`} style={{ width: `${c.pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
