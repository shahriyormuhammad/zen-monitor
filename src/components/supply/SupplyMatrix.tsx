'use client';

/**
 * Грид «товар × размер × склад» — порт таблицы «Поставлено».
 * Секции: [Товар] ‖ [Общие данные: Заказы/Остаток/Доля лок/КТР/КРП/Отгрузить] ‖ [Склады].
 * Строка-артикул раскрывается по РАЗМЕРАМ; в ячейках складов — «Отгрузить».
 * Доля/КТР/КРП — драйверы ИЛ/ИРП (ИЛ=Σзаказы×КТР, ИРП=Σзаказы×КРП).
 */

import { Fragment, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Loader2 } from 'lucide-react';

import {
  loadSupplyPlanAction,
  loadArticleSizesAction,
  loadLocalizationAction,
} from '@/app/(dashboard)/supply/actions';

function fmtNum(n: number): string {
  return Math.round(n).toLocaleString('ru-RU');
}
function shortWh(name: string): string {
  const head = name.split(/[-(]/)[0]?.trim() ?? name;
  return head.slice(0, 16) || name;
}
function shareCls(s: number): string {
  if (s >= 60) return 'text-emerald-600 dark:text-emerald-400';
  if (s >= 45) return 'text-amber-600 dark:text-amber-400';
  return 'text-rose-600 dark:text-rose-400';
}

const ROW_LIMIT = 60;

/** Доля/КТР/КРП — три ячейки «общих данных» (для артикула и размера). */
function LocCells({ share, ktr, krp }: { share: number | null; ktr: number | null; krp: number | null }) {
  return (
    <>
      <td className="px-2 py-2 text-right">
        {share == null ? <span className="text-muted-foreground/40">—</span> : <span className={`font-mono font-semibold ${shareCls(share)}`}>{share.toFixed(0)}%</span>}
      </td>
      <td className="px-2 py-2 text-right font-mono text-muted-foreground">{ktr == null ? '—' : ktr.toFixed(2)}</td>
      <td className="px-2 py-2 text-right font-mono text-muted-foreground">{krp == null ? '—' : krp.toFixed(2)}</td>
    </>
  );
}

export function SupplyMatrix({ tenantId }: { tenantId: string }) {
  const q = useQuery({
    queryKey: ['supplyplan', tenantId, 30, 30],
    queryFn: () => loadSupplyPlanAction(tenantId, 30, 30),
    enabled: Boolean(tenantId),
    staleTime: 30_000,
  });
  const locQ = useQuery({
    queryKey: ['localization', tenantId, 30],
    queryFn: () => loadLocalizationAction(tenantId, 30),
    enabled: Boolean(tenantId),
    staleTime: 60_000,
  });
  const data = q.data;

  const locByNm = useMemo(() => {
    const m = new Map<number, { share: number; ktr: number; krp: number }>();
    for (const a of locQ.data?.articles ?? []) m.set(a.nmId, { share: a.share, ktr: a.ktr, krp: a.krp });
    return m;
  }, [locQ.data]);

  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const toggle = (nmId: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(nmId)) next.delete(nmId);
      else next.add(nmId);
      return next;
    });

  const columns = useMemo(
    () => (data?.byWarehouse ?? []).filter((w) => w.ship > 0).map((w) => w.warehouse),
    [data],
  );
  const rows = useMemo(() => data?.articles.slice(0, ROW_LIMIT) ?? [], [data]);
  const colCount = 7 + columns.length;

  return (
    <div className="dashboard-card overflow-hidden">
      <div className="border-b border-border px-5 py-3">
        <h3 className="text-[14px] font-extrabold">План поставки · товар × размер × склад</h3>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          «Отгрузить» по формуле Поставлено (спрос по выкупам − остаток) по каждому складу. Доля/КТР/КРП — драйверы ИЛ/ИРП. Нажми на артикул — раскроются размеры. За 30 дн.
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
                <th className="sticky left-0 z-10 border-r border-border bg-subtle px-3 py-2 text-left font-bold">Товар / размер</th>
                <th className="px-2 py-2 text-right font-semibold">Заказы</th>
                <th className="px-2 py-2 text-right font-semibold">Остаток</th>
                <th className="px-2 py-2 text-right font-semibold">Доля</th>
                <th className="px-2 py-2 text-right font-semibold">КТР</th>
                <th className="px-2 py-2 text-right font-semibold">КРП</th>
                <th className="px-3 py-2 text-right font-bold">Отгрузить</th>
                {columns.map((c, i) => (
                  <th
                    key={c}
                    className={`whitespace-nowrap px-2 py-2 text-right font-semibold ${i === 0 ? 'border-l-2 border-border' : ''}`}
                    title={c}
                  >
                    {shortWh(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const byWh = new Map(a.legs.map((l) => [l.warehouse, l.ship] as const));
                const open = expanded.has(a.nmId);
                const loc = locByNm.get(a.nmId);
                return (
                  <Fragment key={a.nmId}>
                    <tr className="cursor-pointer border-t border-border hover:bg-subtle/40" onClick={() => toggle(a.nmId)}>
                      <td className="sticky left-0 z-10 border-r border-border bg-card px-3 py-2">
                        <div className="flex items-center gap-2">
                          <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
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
                      <td className="px-2 py-2 text-right font-mono text-muted-foreground">{fmtNum(a.totalOrders)}</td>
                      <td className="px-2 py-2 text-right font-mono text-muted-foreground">{fmtNum(a.totalStock)}</td>
                      <LocCells share={loc?.share ?? null} ktr={loc?.ktr ?? null} krp={loc?.krp ?? null} />
                      <td className="px-3 py-2 text-right font-mono font-extrabold text-rose-600 dark:text-rose-400">{fmtNum(a.totalShip)}</td>
                      {columns.map((c, i) => {
                        const v = byWh.get(c) ?? 0;
                        return (
                          <td
                            key={c}
                            className={`px-2 py-2 text-right font-mono tabular-nums ${i === 0 ? 'border-l-2 border-border' : ''} ${v > 0 ? 'font-bold text-foreground' : 'text-muted-foreground/40'}`}
                          >
                            {v > 0 ? fmtNum(v) : '·'}
                          </td>
                        );
                      })}
                    </tr>
                    {open ? <SizeRows tenantId={tenantId} nmId={a.nmId} columns={columns} colCount={colCount} /> : null}
                  </Fragment>
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

function SizeRows({
  tenantId, nmId, columns, colCount,
}: {
  tenantId: string;
  nmId: number;
  columns: string[];
  colCount: number;
}) {
  const q = useQuery({
    queryKey: ['article-sizes', tenantId, nmId],
    queryFn: () => loadArticleSizesAction(tenantId, nmId, 30, 30),
    enabled: Boolean(tenantId),
    staleTime: 60_000,
  });

  if (q.isLoading) {
    return (
      <tr className="bg-subtle/20">
        <td colSpan={colCount} className="border-r border-border px-10 py-3 text-[11px] text-muted-foreground">
          <Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> Считаем размеры…
        </td>
      </tr>
    );
  }
  const sizes = q.data?.sizes ?? [];
  if (sizes.length === 0) {
    return (
      <tr className="bg-subtle/20">
        <td colSpan={colCount} className="px-10 py-2 text-[11px] text-muted-foreground">Нет данных по размерам.</td>
      </tr>
    );
  }
  return (
    <>
      {sizes.map((s) => {
        const byWh = new Map(s.legs.map((l) => [l.warehouse, l.ship] as const));
        return (
          <tr key={s.size} className="border-t border-border/30 bg-subtle/20 text-[11px]">
            <td className="sticky left-0 z-10 border-r border-border bg-card px-3 py-1.5 pl-9 font-bold text-foreground">
              Размер {s.size}
            </td>
            <td className="px-2 py-1.5 text-right font-mono text-muted-foreground">{fmtNum(s.orders)}</td>
            <td className="px-2 py-1.5 text-right font-mono text-muted-foreground">{fmtNum(s.stock)}</td>
            <LocCells share={s.share} ktr={s.ktr} krp={s.krp} />
            <td className="px-3 py-1.5 text-right font-mono font-bold text-rose-600 dark:text-rose-400">{fmtNum(s.totalShip)}</td>
            {columns.map((c, i) => {
              const v = byWh.get(c) ?? 0;
              return (
                <td
                  key={c}
                  className={`px-2 py-1.5 text-right font-mono tabular-nums ${i === 0 ? 'border-l-2 border-border' : ''} ${v > 0 ? 'font-semibold text-foreground' : 'text-muted-foreground/30'}`}
                >
                  {v > 0 ? fmtNum(v) : '·'}
                </td>
              );
            })}
          </tr>
        );
      })}
    </>
  );
}
