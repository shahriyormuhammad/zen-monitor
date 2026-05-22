'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRightLeft,
  Filter,
  Loader2,
  MapPin,
} from 'lucide-react';
import { OperatorState } from '@/components/dashboard/OperatorState';
import { formatNumber } from '@/components/economics/helpers';
import type { StocksV2Payload, StockSkuRow } from '@/server/analytics/stocks-v2/types';

type FilterMode = 'all' | 'critical' | 'overstock' | 'imbalanced';

/**
 * Per-cell colour: основано на «на сколько дней хватит этого склада» при
 * текущем avgDailyDemand SKU.
 *  - 0 шт + есть спрос → red
 *  - <7 дней (per cell) → amber
 *  - 7-90 дней → emerald
 *  - >90 дней → sky (затарка)
 *  - нет спроса вообще → muted
 */
function cellTone(qty: number, dailyDemand: number): {
  bg: string; text: string; label: string;
} {
  if (dailyDemand <= 0) {
    return qty > 0
      ? { bg: 'bg-muted/40', text: 'text-muted-foreground', label: 'нет спроса' }
      : { bg: 'bg-transparent', text: 'text-muted-foreground/40', label: '—' };
  }
  if (qty === 0) {
    return { bg: 'bg-rose-500/15', text: 'text-rose-700 dark:text-rose-300', label: 'нет' };
  }
  const days = qty / dailyDemand;
  if (days < 7) return { bg: 'bg-amber-500/15', text: 'text-amber-700 dark:text-amber-300', label: 'мало' };
  if (days < 90) return { bg: 'bg-emerald-500/15', text: 'text-emerald-700 dark:text-emerald-300', label: 'норма' };
  return { bg: 'bg-sky-500/15', text: 'text-sky-700 dark:text-sky-300', label: 'много' };
}

export function ByWarehousePageClient({ tenantId }: { tenantId: string }) {
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [search, setSearch] = useState('');

  const { data, isLoading, error, refetch } = useQuery<StocksV2Payload | null, Error>({
    queryKey: ['stocks-v2-by-warehouse', tenantId],
    queryFn: async () => {
      const response = await fetch(
        `/api/views/stocks-v2?targetDays=30&leadTimeDays=46&demandPeriodDays=30`,
        { cache: 'no-store' },
      );
      if (!response.ok) throw new Error('Не удалось загрузить остатки');
      return response.json();
    },
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
  });

  const items = useMemo<StockSkuRow[]>(() => data?.items ?? [], [data]);

  const warehouseTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const it of items) {
      for (const [wh, qty] of Object.entries(it.wbStockByWarehouse)) {
        totals.set(wh, (totals.get(wh) ?? 0) + (qty ?? 0));
      }
    }
    return totals;
  }, [items]);

  const allWarehouses = useMemo(() => {
    // Виртуальные «В пути / Всего находится» уходят в конец.
    const VIRTUAL = new Set([
      'В пути до получателей',
      'В пути возвраты на склад WB',
      'Всего находится на складах',
    ]);
    return Array.from(warehouseTotals.keys()).sort((a, b) => {
      const aV = VIRTUAL.has(a);
      const bV = VIRTUAL.has(b);
      if (aV !== bV) return aV ? 1 : -1;
      const aQ = warehouseTotals.get(a) ?? 0;
      const bQ = warehouseTotals.get(b) ?? 0;
      if (aQ !== bQ) return bQ - aQ;
      return a.localeCompare(b, 'ru');
    });
  }, [warehouseTotals]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((it) => {
      if (filterMode === 'critical' && it.status !== 'critical') return false;
      if (filterMode === 'overstock' && it.status !== 'overstock') return false;
      if (filterMode === 'imbalanced') {
        const counts = Object.values(it.wbStockByWarehouse);
        if (counts.length < 2 || it.wbStock === 0) return false;
        const max = Math.max(...counts);
        const min = Math.min(...counts);
        // imbalance: max ≥ 5× min И есть склад с >0, и склад с 0/малым
        if (max < 5 * Math.max(min, 1)) return false;
        if (max < 10) return false;
      }
      if (q) {
        const haystack = `${it.vendorCode ?? ''} ${it.brand ?? ''} ${it.nmId}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [items, filterMode, search]);

  if (isLoading) {
    return (
      <div className="flex h-[55vh] flex-col items-center justify-center gap-4 text-emerald-600">
        <Loader2 className="h-10 w-10 animate-spin" />
        <p className="animate-pulse font-medium text-muted-foreground">Считаем распределение по складам…</p>
      </div>
    );
  }
  if (error) {
    return (
      <OperatorState
        icon={AlertTriangle}
        tone="danger"
        title="Не удалось загрузить остатки"
        description={error.message}
        actionLabel="Повторить запрос"
        action={refetch}
      />
    );
  }
  if (!data || items.length === 0 || allWarehouses.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Link
            href="/stocks-v2"
            prefetch={false}
            className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Дашборд
          </Link>
        </div>
        <OperatorState
          icon={MapPin}
          tone="default"
          title="Данных по складам пока нет"
          description="После первой синхронизации со WB здесь появится распределение по физическим складам."
        />
      </div>
    );
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 space-y-4 pb-10 duration-500">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/stocks-v2"
            prefetch={false}
            className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Дашборд
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск по SKU, бренду или nmId"
          className="w-64 rounded-md border border-border bg-card px-2 py-1 text-xs focus:border-emerald-500 focus:outline-none"
        />
        <div className="flex items-center gap-1">
          {([
            { value: 'all', label: 'Все', count: items.length },
            { value: 'critical', label: '🔴 Дефицит', count: items.filter((i) => i.status === 'critical').length },
            { value: 'overstock', label: '🔵 Затарка', count: items.filter((i) => i.status === 'overstock').length },
            { value: 'imbalanced', label: '⚖ Перекос', count: items.filter((i) => {
              const c = Object.values(i.wbStockByWarehouse);
              if (c.length < 2 || i.wbStock === 0) return false;
              const max = Math.max(...c);
              const min = Math.min(...c);
              return max >= 5 * Math.max(min, 1) && max >= 10;
            }).length },
          ] as Array<{ value: FilterMode; label: string; count: number }>).map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setFilterMode(opt.value)}
              className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                filterMode === opt.value
                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {opt.label} <span className="opacity-60">({opt.count})</span>
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-3 text-[10px] text-muted-foreground">
          <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-rose-500/40" />нет</span>
          <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-amber-500/40" />&lt; 7 дн</span>
          <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500/40" />норма</span>
          <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-sky-500/40" />&gt; 90 дн</span>
        </div>
      </div>

      {/* Heatmap */}
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-max border-separate border-spacing-0 text-[12px]">
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky left-0 top-0 z-30 border-b border-r border-border bg-muted px-3 py-2 text-left font-semibold text-foreground"
                style={{ minWidth: 220 }}
              >
                SKU
              </th>
              <th
                scope="col"
                className="sticky top-0 z-20 border-b border-r border-border bg-muted px-2 py-2 text-right font-semibold text-foreground"
                style={{ minWidth: 80 }}
              >
                Всего
              </th>
              {allWarehouses.map((wh) => (
                <th
                  key={wh}
                  scope="col"
                  className="sticky top-0 z-20 border-b border-r border-border bg-muted px-2 py-2 text-center font-semibold text-foreground"
                  style={{ minWidth: 76 }}
                >
                  <div className="line-clamp-2 leading-tight">{wh}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredItems.length === 0 ? (
              <tr>
                <td colSpan={allWarehouses.length + 2} className="border-b border-border px-3 py-6 text-center text-sm text-muted-foreground">
                  Ничего не найдено по текущим фильтрам.
                </td>
              </tr>
            ) : (
              filteredItems.map((item) => (
                <tr key={item.nmId} className="hover:bg-muted/30">
                  {/* SKU sticky cell */}
                  <td
                    className="sticky left-0 z-10 border-b border-r border-border bg-card px-3 py-2"
                    style={{ minWidth: 220 }}
                  >
                    <div className="flex items-center gap-2">
                      <div className="h-9 w-9 flex-shrink-0 overflow-hidden rounded border border-border bg-muted">
                        {item.photoUrl ? (
                          <Image
                            src={item.photoUrl}
                            alt=""
                            width={36}
                            height={36}
                            className="h-full w-full object-cover"
                            referrerPolicy="no-referrer"
                          />
                        ) : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-semibold text-foreground">
                          {item.vendorCode ?? `nm ${item.nmId}`}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {item.brand ?? '—'} · {formatNumber(item.avgDailyDemand, 1)}/день
                        </div>
                      </div>
                    </div>
                  </td>
                  {/* Total */}
                  <td
                    className="border-b border-r border-border px-2 py-2 text-right tabular-nums font-semibold text-foreground"
                    style={{ minWidth: 80 }}
                  >
                    {formatNumber(item.wbStock, 0)}
                  </td>
                  {/* Per-warehouse cells */}
                  {allWarehouses.map((wh) => {
                    const qty = item.wbStockByWarehouse[wh] ?? 0;
                    const tone = cellTone(qty, item.avgDailyDemand);
                    return (
                      <td
                        key={`${item.nmId}-${wh}`}
                        title={`${wh}: ${qty} шт · ${tone.label}`}
                        className={`border-b border-r border-border px-2 py-2 text-center tabular-nums ${tone.bg} ${tone.text}`}
                        style={{ minWidth: 76 }}
                      >
                        {qty > 0 ? formatNumber(qty, 0) : '—'}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Tip */}
      <div className="flex items-start gap-2 rounded-xl border border-dashed border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
        <ArrowRightLeft className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-500" />
        <div>
          Подсветка ячеек учитывает <b>средний дневной спрос SKU</b> и количество <b>в этом конкретном складе</b>.
          Красный = склад пустой при наличии спроса. Жёлтый = меньше 7 дней. Синий = больше 90 дней (перетарка).
          Фильтр <b>«⚖ Перекос»</b> ищет SKU где между складами разница ≥ 5× — кандидаты на перераспределение
          для повышения локализации (см. P85, ИРП).
        </div>
      </div>
    </div>
  );
}
