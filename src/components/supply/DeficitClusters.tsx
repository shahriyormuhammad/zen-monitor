'use client';

/**
 * «Дефицит по кластерам» — таблица под планировщиком в «План поставки».
 *
 *   - Метa-бар сверху: количество артикулов, отгрузка, общий прогноз
 *   - Чипы-фильтр по округам (toggle, по умолчанию все включены)
 *   - Поиск по vendorCode/бренду
 *   - Главная таблица: sticky-колонки (фото, артикул, дефицит) + по
 *     каждому округу — sales / stock / need (3 ячейки)
 *   - Кнопка «+ В план» добавляет артикул в список поставки Шаг 1
 *
 * Виджеты справа (donut + top-deficit + coverage) живут в отдельном
 * компоненте DeficitWidgets.
 */

import { Fragment, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Loader2, Plus, Search } from 'lucide-react';

import {
  addSupplyItemAction,
  loadDeficitTableAction,
  loadSizeBreakdownAction,
  listProfilesForArticleAction,
} from '@/app/(dashboard)/supply/actions';
import type { DeficitResult, DeficitRow } from '@/server/supply/deficit';

const ALL_OKRUGS = ['ЦФО', 'СЗФО', 'ПФО', 'УФО', 'СФО', 'ЮФО'] as const;
type OkrugCode = typeof ALL_OKRUGS[number];

const OKRUG_PAIRS: Record<OkrugCode, string> = {
  'ЦФО':  'ЦФО',
  'СЗФО': 'СЗФО',
  'ПФО':  'ПФО',
  'УФО':  'УФО',
  'СФО':  'СФО+ДФО',
  'ЮФО':  'ЮФО+СКФО',
};

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return Math.round(n).toLocaleString('ru-RU');
}

export function DeficitClusters({ tenantId }: { tenantId: string }) {
  const [periodDays, setPeriodDays] = useState(30);
  const [forecastDays, setForecastDays] = useState(30);
  const [activeOkrugs, setActiveOkrugs] = useState<Set<OkrugCode>>(() => new Set(ALL_OKRUGS));
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState<number | null>(null);
  const [expandedNm, setExpandedNm] = useState<number | null>(null);
  const queryClient = useQueryClient();

  const deficitQuery = useQuery({
    queryKey: ['deficit', tenantId, periodDays, forecastDays],
    queryFn: () => loadDeficitTableAction(tenantId, periodDays, forecastDays),
    enabled: Boolean(tenantId),
    staleTime: 30_000,
  });

  const data: DeficitResult | undefined = deficitQuery.data;
  const rows = data?.rows ?? [];
  const totals = data?.totals;

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = q ? rows.filter((r) =>
      r.vendorCode.toLowerCase().includes(q)
      || (r.brand ?? '').toLowerCase().includes(q)
      || String(r.nmId).includes(q)
    ) : rows;
    // Sum need across ONLY the active okrug chips, then sort by it — so
    // filtering to e.g. just ДФО re-ranks the table by ДФО deficit.
    return base
      .map((r) => {
        let activeNeed = 0;
        for (const okrug of activeOkrugs) {
          const cell = r.byOkrug[okrug as keyof typeof r.byOkrug];
          if (cell) activeNeed += cell.need;
        }
        return { row: r, activeNeed };
      })
      .sort((a, b) => b.activeNeed - a.activeNeed)
      .map((x) => ({ ...x.row, activeNeed: x.activeNeed }));
  }, [rows, search, activeOkrugs]);

  const addMutation = useMutation({
    mutationFn: async ({ row, need }: { row: DeficitRow; need: number }) => {
      // Pick the default profile, ship enough boxes to cover the need
      // visible under the current okrug filter.
      const profiles = await listProfilesForArticleAction(tenantId, row.nmId, row.vendorCode);
      if (profiles.length === 0) throw new Error(`Нет ростовки у ${row.vendorCode}`);
      const profile = profiles.find((p) => p.isDefault) ?? profiles[0]!;
      const boxes = Math.max(1, Math.ceil(need / Math.max(1, profile.totalPerBox)));
      return addSupplyItemAction(tenantId, {
        vendorCode: row.vendorCode,
        nmId: row.nmId,
        profileId: profile.id,
        profileName: profile.name,
        boxes,
        rows: profile.rows,
        source: 'manual',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supply-items', tenantId] });
    },
    onSettled: () => setAdding(null),
  });

  if (deficitQuery.isLoading) {
    return (
      <div className="dashboard-card flex h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-rose-500" />
      </div>
    );
  }

  if (!data || rows.length === 0) {
    return (
      <div className="dashboard-card p-8 text-center text-[12px] text-muted-foreground">
        Нет данных для расчёта. Дождись синхронизации заказов/остатков WB.
      </div>
    );
  }

  const okrugList = ALL_OKRUGS.filter((o) => activeOkrugs.has(o));

  return (
    <div className="dashboard-card overflow-hidden">
      <header className="border-b border-border bg-subtle/30 px-5 py-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-[14px] font-extrabold">Дефицит по кластерам</h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Прогноз = средняя скорость продаж за период × горизонт. Дефицит = прогноз − остаток. Перекрёстные округа объединены WB-зонами (ЮФО+СКФО, СФО+ДФО).
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <NumField label="Период продаж, дн" value={periodDays} onChange={setPeriodDays} />
            <NumField label="Горизонт, дн" value={forecastDays} onChange={setForecastDays} />
          </div>
        </div>

        {/* Totals bar */}
        {totals ? (
          <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px]">
            <Tag>Артикулов: <strong>{fmtNum(totals.modelsCount)}</strong></Tag>
            <Tag tone={totals.withDeficit > 0 ? 'warn' : 'ok'}>
              С дефицитом: <strong>{fmtNum(totals.withDeficit)}</strong>
            </Tag>
            <Tag tone="warn">Общий прогноз: <strong>{fmtNum(totals.totalForecastNeed)} шт</strong></Tag>
          </div>
        ) : null}

        {/* Okrug chips */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">Кластеры:</span>
          {ALL_OKRUGS.map((okrug) => {
            const active = activeOkrugs.has(okrug);
            const cell = totals?.byOkrug[okrug];
            const need = cell?.need ?? 0;
            return (
              <button
                key={okrug}
                type="button"
                onClick={() => {
                  setActiveOkrugs((prev) => {
                    const next = new Set(prev);
                    if (next.has(okrug)) next.delete(okrug); else next.add(okrug);
                    return next;
                  });
                }}
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-bold transition-colors ${
                  active
                    ? 'border-rose-400 bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200'
                    : 'border-border bg-card text-muted-foreground hover:text-foreground'
                }`}
              >
                {OKRUG_PAIRS[okrug]}
                {need > 0 ? <span className="ml-1 text-[10px]">·{fmtNum(need)}</span> : null}
              </button>
            );
          })}
        </div>

        {/* Search */}
        <div className="mt-3 relative max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по vendorCode, бренду…"
            className="h-7 w-full rounded-md border border-border bg-card pl-8 pr-3 text-[12px] outline-none focus:border-rose-400"
          />
        </div>
      </header>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-[11.5px]">
          <thead className="bg-subtle/40 text-left text-muted-foreground">
            <tr>
              <th className="sticky left-0 z-10 bg-subtle/95 px-2 py-2 backdrop-blur">Артикул</th>
              <th className="px-2 py-2 text-right">Дефицит</th>
              {okrugList.map((okrug) => (
                <th key={okrug} className="border-l-2 border-l-foreground/60 px-2 py-2 text-center" colSpan={3}>
                  {OKRUG_PAIRS[okrug]}
                </th>
              ))}
              <th className="w-24 px-2 py-2 text-right">Действие</th>
            </tr>
            <tr className="text-[9.5px] uppercase">
              <th className="sticky left-0 z-10 bg-subtle/95 px-2 py-1 backdrop-blur" />
              <th className="px-2 py-1" />
              {okrugList.map((okrug) => (
                <FragmentHeader key={okrug} />
              ))}
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {/* Totals row */}
            {totals ? (
              <tr className="border-t border-border bg-amber-50/60 font-bold dark:bg-amber-950/15">
                <td className="sticky left-0 z-10 bg-amber-50/95 px-2 py-1.5 backdrop-blur dark:bg-amber-950/50">ИТОГО</td>
                <td className="px-2 py-1.5 text-right text-rose-700">{fmtNum(totals.totalForecastNeed)}</td>
                {okrugList.map((okrug) => {
                  const cell = totals.byOkrug[okrug] ?? { sales: 0, stock: 0, need: 0 };
                  return (
                    <FragmentCells key={okrug} cell={cell} />
                  );
                })}
                <td className="px-2 py-1.5" />
              </tr>
            ) : null}

            {/* Article rows */}
            {filteredRows.slice(0, 300).map((row) => {
              const isAdding = adding === row.nmId;
              const isExpanded = expandedNm === row.nmId;
              const colCount = 3 + okrugList.length * 3;
              return (
                <Fragment key={row.nmId}>
                  <tr className="border-t border-border hover:bg-rose-50/40 dark:hover:bg-rose-950/15">
                    <td className="sticky left-0 z-10 bg-card/95 px-2 py-1.5 backdrop-blur">
                      <button
                        type="button"
                        onClick={() => setExpandedNm(isExpanded ? null : row.nmId)}
                        className="flex w-full items-center gap-2 text-left"
                        title="Показать разбивку по размерам"
                      >
                        <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                        {row.photoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={row.photoUrl} alt={row.vendorCode} className="h-8 w-6 shrink-0 rounded object-cover" />
                        ) : (
                          <div className="grid h-8 w-6 shrink-0 place-items-center rounded bg-subtle text-[9px] text-muted-foreground">—</div>
                        )}
                        <div className="min-w-0">
                          <div className="truncate font-bold text-foreground">{row.vendorCode}</div>
                          <div className="truncate text-[10px] text-muted-foreground">
                            {row.brand ?? '—'}{row.category ? ` · ${row.category}` : ''}
                          </div>
                        </div>
                      </button>
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      {row.activeNeed > 0 ? (
                        <span className="font-mono font-bold text-rose-700">{fmtNum(row.activeNeed)}</span>
                      ) : (
                        <span className="font-mono text-muted-foreground">0</span>
                      )}
                      {row.topNeedOkrug && row.activeNeed > 0 ? (
                        <div className="text-[9.5px] text-muted-foreground">{row.topNeedOkrug}</div>
                      ) : null}
                    </td>
                    {okrugList.map((okrug) => {
                      const cell = row.byOkrug[okrug] ?? { sales: 0, stock: 0, need: 0 };
                      return <FragmentCells key={okrug} cell={cell} />;
                    })}
                    <td className="px-2 py-1.5 text-right">
                      <button
                        type="button"
                        disabled={isAdding || row.activeNeed === 0}
                        onClick={() => { setAdding(row.nmId); addMutation.mutate({ row, need: row.activeNeed }); }}
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-card px-2 text-[10.5px] font-bold text-foreground hover:border-rose-400 disabled:opacity-30"
                        title={row.activeNeed === 0 ? 'Дефицита нет' : 'Добавить в список поставки'}
                      >
                        {isAdding ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                        В план
                      </button>
                    </td>
                  </tr>
                  {isExpanded ? (
                    <tr className="bg-subtle/40">
                      <td colSpan={colCount} className="px-4 py-2">
                        <SizeBreakdown
                          tenantId={tenantId}
                          nmId={row.nmId}
                          vendorCode={row.vendorCode}
                          periodDays={periodDays}
                          forecastDays={forecastDays}
                        />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {filteredRows.length > 300 ? (
        <div className="border-t border-border px-4 py-2 text-center text-[11px] text-muted-foreground">
          Показано 300 из {fmtNum(filteredRows.length)}. Сузь поиск, чтобы увидеть остальные.
        </div>
      ) : null}

      {addMutation.error ? (
        <div className="border-t border-border bg-rose-50 px-4 py-2 text-[12px] text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          {addMutation.error instanceof Error ? addMutation.error.message : String(addMutation.error)}
        </div>
      ) : null}
    </div>
  );
}

/* ── pieces ────────────────────────────────────── */

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[9.5px] font-black uppercase tracking-[0.18em] text-muted-foreground">{label}</span>
      <input
        type="number"
        min={7}
        max={180}
        value={value}
        onChange={(e) => onChange(Math.max(7, Math.min(180, Number(e.target.value) || 30)))}
        className="h-7 w-20 rounded-md border border-border bg-card px-2 text-right font-mono text-[12px] outline-none focus:border-rose-400"
      />
    </label>
  );
}

function Tag({ children, tone }: { children: React.ReactNode; tone?: 'ok' | 'warn' }) {
  const cls = tone === 'warn'
    ? 'border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200'
    : tone === 'ok'
      ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200'
      : 'border-border bg-subtle text-muted-foreground';
  return <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 ${cls}`}>{children}</span>;
}

function FragmentHeader() {
  return (
    <>
      <th className="border-l-2 border-l-foreground/60 px-1.5 py-1 text-center text-[9.5px] font-bold">П</th>
      <th className="px-1.5 py-1 text-center text-[9.5px] font-bold">О</th>
      <th className="px-1.5 py-1 text-center text-[9.5px] font-bold">Н</th>
    </>
  );
}

function FragmentCells({ cell }: { cell: { sales: number; stock: number; need: number } }) {
  return (
    <>
      <td className="border-l-2 border-l-foreground/60 px-1.5 py-1.5 text-right font-mono">{cell.sales > 0 ? fmtNum(cell.sales) : '—'}</td>
      <td className="px-1.5 py-1.5 text-right font-mono">{cell.stock > 0 ? fmtNum(cell.stock) : '—'}</td>
      <td className={`px-1.5 py-1.5 text-right font-mono ${cell.need > 0 ? 'font-bold text-rose-700' : 'text-muted-foreground'}`}>
        {cell.need > 0 ? fmtNum(cell.need) : '—'}
      </td>
    </>
  );
}

/** Lazy-loaded per-size sales/stock/need breakdown shown when a row expands. */
function SizeBreakdown({
  tenantId, nmId, vendorCode, periodDays, forecastDays,
}: {
  tenantId: string;
  nmId: number;
  vendorCode: string;
  periodDays: number;
  forecastDays: number;
}) {
  const query = useQuery({
    queryKey: ['size-breakdown', tenantId, nmId, periodDays, forecastDays],
    queryFn: () => loadSizeBreakdownAction(tenantId, nmId, periodDays, forecastDays),
    enabled: Boolean(tenantId),
    staleTime: 30_000,
  });

  if (query.isLoading) {
    return <div className="flex items-center gap-2 text-[11px] text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> загрузка размеров…</div>;
  }
  const rows = query.data ?? [];
  if (rows.length === 0) {
    return <div className="text-[11px] text-muted-foreground">Нет данных по размерам для {vendorCode}.</div>;
  }

  return (
    <div>
      <div className="mb-1.5 text-[10px] font-black uppercase tracking-wider text-muted-foreground">
        Разбивка по размерам · {vendorCode} (продажи за {periodDays} дн, прогноз {forecastDays} дн)
      </div>
      <div className="flex flex-wrap gap-1.5">
        {rows.map((r) => (
          <div
            key={r.size}
            className={`min-w-[72px] rounded-lg border px-2 py-1.5 text-center ${
              r.need > 0
                ? 'border-rose-300 bg-rose-50 dark:border-rose-700/40 dark:bg-rose-950/30'
                : 'border-border bg-card'
            }`}
          >
            <div className="font-mono text-[13px] font-extrabold text-foreground">{r.size}</div>
            <div className="mt-0.5 text-[9.5px] text-muted-foreground">
              прод <span className="font-bold text-foreground">{fmtNum(r.sales)}</span> · ост <span className="font-bold text-foreground">{fmtNum(r.stock)}</span>
            </div>
            <div className={`text-[10px] font-bold ${r.need > 0 ? 'text-rose-700 dark:text-rose-300' : 'text-muted-foreground'}`}>
              нужно {fmtNum(r.need)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
