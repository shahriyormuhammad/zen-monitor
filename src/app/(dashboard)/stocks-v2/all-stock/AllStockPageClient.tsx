'use client';

import { useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  Filter,
  Loader2,
  PackageCheck,
} from 'lucide-react';
import { OperatorState } from '@/components/dashboard/OperatorState';
import { formatNumber } from '@/components/economics/helpers';
import type { StocksV2Payload, StockSkuRow } from '@/server/analytics/stocks-v2/types';

type StatusFilter = StockSkuRow['status'] | 'all';

const STATUS_LABEL: Record<StockSkuRow['status'], string> = {
  critical: 'Срочно',
  warning: 'Скоро',
  ok: 'Норма',
  overstock: 'Перезатарка',
};

const STATUS_CLASS: Record<StockSkuRow['status'], string> = {
  critical: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  warning: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  ok: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  overstock: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
};

function formatDaysLeft(daysLeft: number): string {
  if (!Number.isFinite(daysLeft)) return '∞';
  return daysLeft < 1 ? '< 1' : formatNumber(daysLeft, 1);
}

export function AllStockPageClient({ tenantId }: { tenantId: string }) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');

  const { data, isLoading, error, refetch } = useQuery<StocksV2Payload | null, Error>({
    queryKey: ['stocks-v2-all-stock', tenantId],
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

  const items = useMemo(() => {
    const query = search.trim().toLowerCase();
    return [...(data?.items ?? [])]
      .filter((item) => {
        if (statusFilter !== 'all' && item.status !== statusFilter) return false;
        if (!query) return true;
        return `${item.vendorCode ?? ''} ${item.brand ?? ''} ${item.nmId}`.toLowerCase().includes(query);
      })
      .sort((a, b) => b.totalAvailable - a.totalAvailable || a.daysLeft - b.daysLeft);
  }, [data?.items, search, statusFilter]);

  if (isLoading) {
    return (
      <div className="flex h-[55vh] flex-col items-center justify-center gap-4 text-emerald-600">
        <Loader2 className="h-10 w-10 animate-spin" />
        <p className="animate-pulse font-medium text-muted-foreground">Собираем общий остаток…</p>
      </div>
    );
  }

  if (error) {
    return (
      <OperatorState
        icon={AlertTriangle}
        tone="danger"
        title="Не удалось загрузить общий остаток"
        description={error.message}
        actionLabel="Повторить запрос"
        action={refetch}
      />
    );
  }

  if (!data || data.items.length === 0) {
    return (
      <div className="space-y-4">
        <Link
          href="/stocks-v2"
          prefetch={false}
          className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Дашборд
        </Link>
        <OperatorState
          icon={PackageCheck}
          tone="default"
          title="Общего остатка пока нет"
          description="После синхронизации или ручного прихода здесь появится разрез по всем слоям."
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
          <h1 className="text-lg font-bold text-foreground">Все остатки</h1>
        </div>
        <div className="text-sm font-semibold tabular-nums text-foreground">
          {formatNumber(data.kpi.allStockTotal, 0)} шт
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="SKU, артикул или бренд"
          className="w-64 rounded-md border border-border bg-card px-2 py-1 text-xs focus:border-emerald-500 focus:outline-none"
        />
        {([
          { value: 'all', label: 'Все' },
          { value: 'critical', label: 'Срочно' },
          { value: 'warning', label: 'Скоро' },
          { value: 'ok', label: 'Норма' },
          { value: 'overstock', label: 'Перезатарка' },
        ] as Array<{ value: StatusFilter; label: string }>).map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setStatusFilter(option.value)}
            className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
              statusFilter === option.value
                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-max border-separate border-spacing-0 text-[12px]">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-20 border-b border-r border-border bg-muted px-3 py-2 text-left font-semibold text-foreground">
                SKU
              </th>
              {['Всего', 'WB', 'Свой', 'Китай', 'Производство', 'В пути', 'Хватит', 'Статус'].map((label) => (
                <th
                  key={label}
                  className="sticky top-0 z-10 border-b border-r border-border bg-muted px-2 py-2 text-right font-semibold text-foreground"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={9} className="border-b border-border px-3 py-6 text-center text-sm text-muted-foreground">
                  Ничего не найдено.
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.nmId} className="hover:bg-muted/30">
                  <td className="sticky left-0 z-10 border-b border-r border-border bg-card px-3 py-2">
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
                      <div className="min-w-0">
                        <div className="max-w-56 truncate font-semibold text-foreground">
                          {item.vendorCode ?? `nm ${item.nmId}`}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {item.brand ?? '—'} · nm {item.nmId}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="border-b border-r border-border px-2 py-2 text-right font-bold tabular-nums text-foreground">
                    {formatNumber(item.totalAvailable, 0)}
                  </td>
                  <td className="border-b border-r border-border px-2 py-2 text-right tabular-nums">{formatNumber(item.wbStock, 0)}</td>
                  <td className="border-b border-r border-border px-2 py-2 text-right tabular-nums">{formatNumber(item.ownStock, 0)}</td>
                  <td className="border-b border-r border-border px-2 py-2 text-right tabular-nums">{formatNumber(item.chinaStock, 0)}</td>
                  <td className="border-b border-r border-border px-2 py-2 text-right tabular-nums">{formatNumber(item.inProduction, 0)}</td>
                  <td className="border-b border-r border-border px-2 py-2 text-right tabular-nums">{formatNumber(item.inTransit, 0)}</td>
                  <td className="border-b border-r border-border px-2 py-2 text-right tabular-nums">
                    {formatDaysLeft(item.daysLeft)} дн
                  </td>
                  <td className="border-b border-r border-border px-2 py-2 text-right">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_CLASS[item.status]}`}>
                      {STATUS_LABEL[item.status]}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
