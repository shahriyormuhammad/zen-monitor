'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Loader2, Search, ShieldBan, SlidersHorizontal } from 'lucide-react';

import { OperatorState } from '@/components/dashboard/OperatorState';

import type {
  AdvertisingClusterListResponse,
  SelectedCluster,
} from '../_shared/types';
import { formatMoney, formatNumber } from '../_shared/format';
import { ClusterTable } from './ClusterTable';

type Props = {
  tenantId: string;
  fromParam: string;
  toParam: string;
  selectedCluster: SelectedCluster;
  onOpenCluster: (cluster: { nmId: number; cluster: string }) => void;
};

export function AdvertisingClusters({
  tenantId,
  fromParam,
  toParam,
  selectedCluster,
  onOpenCluster,
}: Props) {
  const [clusterSearch, setClusterSearch] = useState('');
  const [onlyRisk, setOnlyRisk] = useState(false);

  const clusterQuery = useQuery<AdvertisingClusterListResponse | null, Error>({
    queryKey: ['advertising-clusters', tenantId, fromParam, toParam, clusterSearch.trim()],
    queryFn: async () => {
      const params = new URLSearchParams({
        from: fromParam,
        to: toParam,
        limit: '180',
      });
      if (clusterSearch.trim()) {
        params.set('search', clusterSearch.trim());
      }
      const response = await fetch(`/api/views/advertising/clusters?${params.toString()}`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error('Ошибка при загрузке списка кластеров');
      }
      return response.json();
    },
    enabled: Boolean(tenantId),
  });

  const visibleClusterRows = useMemo(() => {
    const rows = clusterQuery.data?.rows ?? [];
    if (!onlyRisk) {
      return rows;
    }
    return rows.filter((row) => row.riskLevel === 'high' || row.riskLevel === 'medium');
  }, [clusterQuery.data?.rows, onlyRisk]);

  if (clusterQuery.isLoading) {
    return (
      <div className="flex h-[45vh] flex-col items-center justify-center gap-3 text-slate-500">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        <p>Собираем кластеры из сырых данных...</p>
      </div>
    );
  }

  if (clusterQuery.error) {
    return (
      <OperatorState
        icon={AlertTriangle}
        tone="danger"
        title="Не удалось загрузить кластеры"
        description={clusterQuery.error.message}
        actionLabel="Повторить"
        action={clusterQuery.refetch}
      />
    );
  }

  if (!clusterQuery.data || !clusterQuery.data.hasData || visibleClusterRows.length === 0) {
    return (
      <OperatorState
        icon={ShieldBan}
        tone="warning"
        title="Кластеры не найдены"
        description="По выбранному фильтру и периоду нет данных. Измените диапазон или очистите поиск."
      />
    );
  }

  return (
    <div className="space-y-4">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Найдено кластеров</p>
          <p className="mt-2 text-2xl font-extrabold text-slate-900">{formatNumber(clusterQuery.data.total)}</p>
          <p className="mt-2 text-xs text-slate-500">Показано: {formatNumber(visibleClusterRows.length)}</p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Расход по кластерам</p>
          <p className="mt-2 text-2xl font-extrabold text-slate-900">{formatMoney(clusterQuery.data.summary.adSpend)}</p>
          <p className="mt-2 text-xs text-slate-500">Выручка SKU: {formatMoney(clusterQuery.data.summary.revenue)}</p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Клики / Заказы</p>
          <p className="mt-2 text-2xl font-extrabold text-slate-900">
            {formatNumber(clusterQuery.data.summary.clicks)} / {formatNumber(clusterQuery.data.summary.orders)}
          </p>
          <p className="mt-2 text-xs text-slate-500">Отбор по оперативному управлению ниже</p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Высокий риск</p>
          <p className="mt-2 text-2xl font-extrabold text-rose-700">{formatNumber(clusterQuery.data.summary.highRiskClusters)}</p>
          <p className="mt-2 text-xs text-slate-500">Кластеры с кликами без заказов</p>
        </article>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[260px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={clusterSearch}
              onChange={(event) => setClusterSearch(event.target.value)}
              placeholder="Поиск: кластер, бренд, артикул, nmId"
              className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-sm text-slate-700 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
            />
          </div>
          <button
            type="button"
            onClick={() => setOnlyRisk((prev) => !prev)}
            className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition ${
              onlyRisk
                ? 'border-rose-200 bg-rose-50 text-rose-700'
                : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
            }`}
          >
            <SlidersHorizontal className="h-4 w-4" />
            Только риск
          </button>
        </div>
      </section>

      <ClusterTable
        rows={visibleClusterRows}
        selected={selectedCluster}
        onSelect={onOpenCluster}
      />
    </div>
  );
}
