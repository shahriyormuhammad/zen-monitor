'use client';

import Image from 'next/image';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Loader2, PackageSearch } from 'lucide-react';

import { OperatorState } from '@/components/dashboard/OperatorState';

import { formatMoney, formatNumber, formatPercent } from '../_shared/format';
import type { AdvertisingProductListRow, AdvertisingProductsResponse } from '../_shared/types';

type Props = {
  tenantId: string;
  fromParam: string;
  toParam: string;
  /** Переход в Ставки с фокусом на nmId */
  onOpenWorkspace?: (nmId: number) => void;
};

const RISK_CLASS: Record<AdvertisingProductListRow['risk'], string> = {
  good: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300',
  warning: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300',
  danger: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300',
};

const RISK_LABEL: Record<AdvertisingProductListRow['risk'], string> = {
  good: 'Норма',
  warning: 'Внимание',
  danger: 'Проблема',
};

function ProductRowCard({
  row,
  onOpenWorkspace,
}: {
  row: AdvertisingProductListRow;
  onOpenWorkspace?: (nmId: number) => void;
}) {
  const isGroupScope = row.attributionScope === 'group';
  const title = row.title || row.brand || row.vendorCode || `nmId ${row.nmId}`;

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md dark:border-slate-700 dark:bg-slate-800">
      <div className="flex gap-3">
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-900/50">
          {row.photoUrl ? (
            <Image
              src={row.photoUrl}
              alt={title}
              fill
              sizes="80px"
              className="object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[10px] font-black uppercase text-slate-400">
              Фото
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="line-clamp-2 text-sm font-black leading-5 text-slate-900 dark:text-slate-100">
                {title}
              </p>
              <p className="mt-1 truncate text-xs font-semibold text-slate-500 dark:text-slate-400">
                {row.vendorCode ? `${row.vendorCode} · ` : ''}
                nmId {row.nmId}
              </p>
            </div>
            <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${RISK_CLASS[row.risk]}`}>
              {RISK_LABEL[row.risk]}
            </span>
          </div>

          {isGroupScope ? (
            <p className="mt-2 truncate text-xs font-black text-emerald-700 dark:text-emerald-300">
              Склейка: {row.groupName ?? 'без названия'} · {row.groupNmCount} SKU
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-3 dark:bg-slate-900/40">
        <div>
          <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Расход</p>
          <p className="mt-1 text-sm font-black text-slate-900 dark:text-slate-100">{formatMoney(row.adSpend)}</p>
        </div>
        <div>
          <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Заказы</p>
          <p className="mt-1 text-sm font-black text-slate-900 dark:text-slate-100">{formatNumber(row.orders)}</p>
        </div>
        <div>
          <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">ДРР</p>
          <p className="mt-1 text-sm font-black text-slate-900 dark:text-slate-100">{row.acosPct === null ? '—' : formatPercent(row.acosPct)}</p>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 text-xs font-semibold text-slate-500 dark:text-slate-400">
        <span>Выручка {formatMoney(row.revenue)}</span>
        <span>CTR {row.ctrPct === null ? '—' : formatPercent(row.ctrPct, 2)}</span>
        <span>CPC {row.cpc === null ? '—' : formatMoney(row.cpc)}</span>
      </div>

      <p className="mt-3 text-xs font-semibold leading-5 text-slate-600 dark:text-slate-300">
        {row.reason}
      </p>

      {onOpenWorkspace ? (
        <button
          type="button"
          onClick={() => onOpenWorkspace(row.nmId)}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black text-slate-700 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300"
        >
          Открыть ставки
          <ArrowUpRight className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </article>
  );
}

export function ProductsTab({ tenantId, fromParam, toParam, onOpenWorkspace }: Props) {
  const query = useQuery<AdvertisingProductsResponse | null, Error>({
    queryKey: ['advertising-products', tenantId, fromParam, toParam],
    queryFn: async () => {
      const res = await fetch(
        `/api/views/advertising/products?from=${fromParam}&to=${toParam}`,
        { cache: 'no-store' },
      );
      if (!res.ok) throw new Error('Ошибка при загрузке карточек товаров');
      return res.json();
    },
    enabled: Boolean(tenantId),
  });
  const rows = query.data?.rows ?? [];

  if (query.isLoading) {
    return (
      <div className="flex h-[45vh] flex-col items-center justify-center gap-4 text-emerald-600">
        <Loader2 className="h-10 w-10 animate-spin" />
        <p className="animate-pulse text-sm font-medium text-slate-500">Загружаем карточки товаров...</p>
      </div>
    );
  }

  if (query.error) {
    return (
      <OperatorState
        icon={PackageSearch}
        tone="danger"
        title="Не удалось загрузить товары"
        description={query.error.message}
        actionLabel="Повторить"
        action={query.refetch}
      />
    );
  }

  if (rows.length === 0) {
    return (
      <OperatorState
        icon={PackageSearch}
        tone="warning"
        title="Нет данных по товарам за выбранный период"
        description="Запустите синхронизацию рекламных данных и повторите загрузку."
        actionLabel="Перейти в настройки"
        actionHref="/settings"
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">
          Показано {rows.length} объектов · склейки считаются целиком · сортировка по расходу
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {rows.map((row) => (
          <ProductRowCard
            key={`${row.groupId ?? row.nmId}`}
            row={row}
            onOpenWorkspace={onOpenWorkspace}
          />
        ))}
      </div>
    </div>
  );
}
