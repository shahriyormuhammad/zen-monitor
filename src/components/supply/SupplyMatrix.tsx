'use client';

/**
 * Грид «товар × склад» — «Отгрузить» по каждому складу (расчёт «Поставлено»).
 * Заменяет старую «Дефицит по кластерам» (считалась по округу, давала др. число).
 * Строки — артикулы к поставке (ship>0), колонки — склады, в ячейках «Отгрузить».
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';

import { loadSupplyPlanAction } from '@/app/(dashboard)/supply/actions';

function fmtNum(n: number): string {
  return Math.round(n).toLocaleString('ru-RU');
}

/** Короткая подпись склада для шапки колонки (полное имя — в title). */
function shortWh(name: string): string {
  const head = name.split(/[-(]/)[0]?.trim() ?? name;
  return head.slice(0, 16) || name;
}

const ROW_LIMIT = 60;

export function SupplyMatrix({ tenantId }: { tenantId: string }) {
  const q = useQuery({
    queryKey: ['supplyplan', tenantId, 30, 30],
    queryFn: () => loadSupplyPlanAction(tenantId, 30, 30),
    enabled: Boolean(tenantId),
    staleTime: 30_000,
  });
  const data = q.data;

  const columns = useMemo(
    () => (data?.byWarehouse ?? []).filter((w) => w.ship > 0).map((w) => w.warehouse),
    [data],
  );
  const rows = useMemo(() => data?.articles.slice(0, ROW_LIMIT) ?? [], [data]);

  return (
    <div className="dashboard-card overflow-hidden">
      <div className="border-b border-border px-5 py-3">
        <h3 className="text-[14px] font-extrabold">План поставки по складам · товар × склад</h3>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          «Отгрузить» по формуле Поставлено: спрос по выкупам − остаток, по каждому складу. За 30 дн.
        </p>
      </div>

      {q.isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-rose-500" />
        </div>
      ) : !data || rows.length === 0 ? (
        <div className="p-8 text-center text-[12px] text-muted-foreground">Всё обеспечено — догружать нечего 🎉</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-0 text-[12px]">
            <thead>
              <tr className="bg-subtle/60 text-muted-foreground">
                <th className="sticky left-0 z-10 bg-subtle px-3 py-2 text-left font-bold">Товар</th>
                <th className="px-3 py-2 text-right font-bold">Всего</th>
                {columns.map((c) => (
                  <th key={c} className="whitespace-nowrap px-2 py-2 text-right font-semibold" title={c}>
                    {shortWh(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const byWh = new Map(a.legs.map((l) => [l.warehouse, l.ship] as const));
                return (
                  <tr key={a.nmId} className="border-t border-border/60 hover:bg-subtle/40">
                    <td className="sticky left-0 z-10 bg-card px-3 py-2">
                      <div className="flex items-center gap-2">
                        {a.photoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={a.photoUrl} alt={a.vendorCode} className="h-9 w-7 rounded object-cover" />
                        ) : (
                          <div className="grid h-9 w-7 place-items-center rounded bg-subtle text-[10px] text-muted-foreground">—</div>
                        )}
                        <div className="flex flex-col leading-tight">
                          <span className="font-bold text-foreground">{a.vendorCode}</span>
                          <span className="text-[10px] text-muted-foreground">{a.brand ?? a.nmId}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-extrabold text-rose-600 dark:text-rose-400">{fmtNum(a.totalShip)}</td>
                    {columns.map((c) => {
                      const v = byWh.get(c) ?? 0;
                      return (
                        <td
                          key={c}
                          className={`px-2 py-2 text-right font-mono tabular-nums ${v > 0 ? 'font-bold text-foreground' : 'text-muted-foreground/40'}`}
                        >
                          {v > 0 ? fmtNum(v) : '·'}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {data && data.articles.length > rows.length ? (
        <div className="border-t border-border px-5 py-2 text-[11px] text-muted-foreground">
          Показаны топ-{rows.length} из {fmtNum(data.articles.length)} артикулов к поставке.
        </div>
      ) : null}
    </div>
  );
}
