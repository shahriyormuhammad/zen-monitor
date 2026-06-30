'use client';

/**
 * Сводка над таблицей в «План поставки» — на расчёте ПО СКЛАДАМ
 * (computeSupplyPlan, формула «Поставлено»):
 *   1. Donut «Отгрузить по округам» — доля отгрузки по округам.
 *   2. «Топ к поставке» — топ артикулов по «Отгрузить».
 *   3. «Покрытие по округам» — остаток / (остаток + отгрузить).
 *
 * Тот же queryKey ['supplyplan', …], что у шапки → без второго round-trip и
 * с единым числом (раньше тут был старый расчёт по округу — расходился).
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';

import { loadSupplyPlanAction } from '@/app/(dashboard)/supply/actions';

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
    queryKey: ['supplyplan', tenantId, 30, 30],
    queryFn: () => loadSupplyPlanAction(tenantId, 30, 30),
    enabled: Boolean(tenantId),
    staleTime: 30_000,
  });

  const data = query.data;

  const donut = useMemo(() => {
    if (!data) return [];
    return OKRUG_ORDER
      .map((okrug, i) => ({
        name: OKRUG_LABEL[okrug] ?? okrug,
        value: data.byOkrug[okrug]?.ship ?? 0,
        color: COLORS[i % COLORS.length]!,
      }))
      .filter((d) => d.value > 0);
  }, [data]);

  const topShip = useMemo(() => data?.topArticles.slice(0, 5) ?? [], [data]);

  const coverage = useMemo(() => {
    if (!data) return [];
    return OKRUG_ORDER.map((okrug) => {
      const cell = data.byOkrug[okrug] ?? { ship: 0, orders: 0, stock: 0 };
      const denom = cell.stock + cell.ship;
      const pct = denom === 0 ? 100 : Math.round((cell.stock / denom) * 100);
      return { okrug: OKRUG_LABEL[okrug] ?? okrug, pct };
    });
  }, [data]);

  if (query.isLoading || !data) return null;

  const total = data.total;
  const maxShip = Math.max(1, ...topShip.map((r) => r.ship));

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* Donut */}
      <div className="dashboard-card p-4">
        <h4 className="text-[12px] font-black uppercase tracking-[0.14em] text-muted-foreground">Отгрузить по округам</h4>
        {donut.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-[12px] text-muted-foreground">Всё обеспечено 🎉</div>
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
              <div className="font-mono text-[18px] font-extrabold text-foreground">{fmtNum(total)}</div>
              <div className="text-[9px] uppercase text-muted-foreground">шт отгрузить</div>
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

      {/* Top */}
      <div className="dashboard-card p-4">
        <h4 className="text-[12px] font-black uppercase tracking-[0.14em] text-muted-foreground">Топ к поставке</h4>
        {topShip.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-[12px] text-muted-foreground">Нет поставки</div>
        ) : (
          <div className="mt-2 flex flex-col gap-2">
            {topShip.map((r) => (
              <div key={r.nmId}>
                <div className="flex items-baseline justify-between text-[11px]">
                  <span className="truncate font-bold text-foreground">{r.vendorCode}</span>
                  <span className="ml-2 shrink-0 font-mono font-bold text-rose-700">{fmtNum(r.ship)}</span>
                </div>
                <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-subtle">
                  <div className="h-full rounded-full bg-rose-500" style={{ width: `${(r.ship / maxShip) * 100}%` }} />
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
