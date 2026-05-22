'use client';

import { useMemo, useState } from 'react';
import { Loader2, Map } from 'lucide-react';
import {
  formatDecimal,
  formatMoney,
  formatMoneyPrecise,
  formatNumber,
  formatPercent,
} from '../../_shared/format';
import { mapStatusLabel, panelClass } from '../../_shared/ui';

export type MapStatusFilter = 'all' | 'active' | 'excluded';
export type MapActionMessage = { tone: 'success' | 'error'; text: string };

export type ClusterMapRow = {
  cluster: string;
  status: 'active' | 'excluded' | 'unknown';
  totals: {
    spend: number;
    views: number;
    clicks: number;
    orders: number;
    atbs: number;
    shks: number;
    ctrPct: number | null;
    cpcRub: number | null;
    cpmRub: number | null;
    cpoRub: number | null;
    avgPos: number | null;
  };
  daily: Array<{
    day: string;
    spend: number;
    views: number;
    clicks: number;
    orders: number;
    atbs: number;
    shks: number;
    ctrPct: number | null;
    cpcRub: number | null;
    cpmRub: number | null;
    avgPos: number | null;
  }>;
};

export type ClusterMapResponse = {
  statsSource: 'wb_api' | 'local_fallback' | 'empty';
  activeCount: number;
  excludedCount: number;
  rows: ClusterMapRow[];
};

type MapTabProps = {
  actionMessage: MapActionMessage | null;
  isLoading: boolean;
  error: Error | null;
  data: ClusterMapResponse | null | undefined;
  toggleDisabled: boolean;
  onToggle: (cluster: string, currentStatus: 'active' | 'excluded' | 'unknown') => void;
};

export function MapTab({
  actionMessage,
  isLoading,
  error,
  data,
  toggleDisabled,
  onToggle,
}: MapTabProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<MapStatusFilter>('all');

  const visibleRows = useMemo(() => {
    const rows = data?.rows ?? [];
    const normalizedSearch = search.trim().toLocaleLowerCase('ru-RU');
    return rows.filter((row) => {
      if (statusFilter !== 'all' && row.status !== statusFilter) {
        return false;
      }
      if (!normalizedSearch) {
        return true;
      }
      return row.cluster.toLocaleLowerCase('ru-RU').includes(normalizedSearch);
    });
  }, [data?.rows, statusFilter, search]);

  const sourceLabel = data?.statsSource === 'wb_api'
    ? 'дневная статистика WB'
    : data?.statsSource === 'local_fallback'
      ? 'локальный fallback'
      : 'нет статистики';

  return (
    <section className={panelClass}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Map className="h-5 w-5 text-sky-600" />
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Карта активных/исключенных кластеров</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Поиск кластера"
            className="w-44 rounded-xl border border-slate-200 px-3 py-2 text-sm"
          />
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as MapStatusFilter)}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="all">Все статусы</option>
            <option value="active">Только активные</option>
            <option value="excluded">Только исключенные</option>
          </select>
        </div>
      </div>
      {actionMessage ? (
        <p className={`mb-3 rounded-xl border px-3 py-2 text-xs font-semibold ${
          actionMessage.tone === 'success'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-900/20 dark:text-emerald-300'
            : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800/40 dark:bg-rose-900/20 dark:text-rose-300'
        }`}>
          {actionMessage.text}
        </p>
      ) : null}

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Загружаем карту кластеров...
        </div>
      ) : error ? (
        <p className="text-sm text-rose-600">{error.message}</p>
      ) : !data ? (
        <p className="text-sm text-slate-500">Нет данных.</p>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-slate-500">
            Активных: {formatNumber(data.activeCount)} · исключённых: {formatNumber(data.excludedCount)} · источник: {sourceLabel}
          </p>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-slate-500">
                  <th scope="col" className="px-2 py-2">Кластер</th>
                  <th scope="col" className="px-2 py-2">Статус</th>
                  <th scope="col" className="px-2 py-2">Расход</th>
                  <th scope="col" className="px-2 py-2">Показы/CTR</th>
                  <th scope="col" className="px-2 py-2">CPC/CPM/CPO</th>
                  <th scope="col" className="px-2 py-2">Клики/ATB/Заказы</th>
                  <th scope="col" className="px-2 py-2">ШК/позиция</th>
                  <th scope="col" className="px-2 py-2">Дневная динамика</th>
                  <th scope="col" className="px-2 py-2">Действие</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.slice(0, 80).map((row) => (
                  <tr key={row.cluster} className="border-t border-slate-100">
                    <td className="px-2 py-2 font-semibold text-slate-800 dark:text-slate-200">{row.cluster}</td>
                    <td className="px-2 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                        row.status === 'active'
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                          : row.status === 'excluded'
                            ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300'
                            : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400'
                      }`}>
                        {mapStatusLabel(row.status)}
                      </span>
                    </td>
                    <td className="px-2 py-2 font-semibold">{formatMoney(row.totals.spend)}</td>
                    <td className="px-2 py-2">
                      {formatNumber(row.totals.views)} / {formatPercent(row.totals.ctrPct, 2)}
                    </td>
                    <td className="px-2 py-2">
                      {formatMoneyPrecise(row.totals.cpcRub, 2)} / {formatMoneyPrecise(row.totals.cpmRub, 2)} / {formatMoneyPrecise(row.totals.cpoRub, 2)}
                    </td>
                    <td className="px-2 py-2">
                      {formatNumber(row.totals.clicks)} / {formatNumber(row.totals.atbs)} / {formatNumber(row.totals.orders)}
                    </td>
                    <td className="px-2 py-2">
                      {formatNumber(row.totals.shks)} / {formatDecimal(row.totals.avgPos, 2)}
                    </td>
                    <td className="px-2 py-2 text-xs text-slate-600">
                      {row.daily.slice(-3).map((day) => (
                        `${day.day}: ${Math.round(day.spend)}₽, ${formatNumber(day.clicks)}/${formatNumber(day.orders)}, поз. ${formatDecimal(day.avgPos, 2)}`
                      )).join(' · ') || '—'}
                    </td>
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        disabled={toggleDisabled}
                        onClick={() => onToggle(row.cluster, row.status)}
                        className={`rounded-lg px-2 py-1 text-xs font-semibold ${
                          row.status === 'excluded'
                            ? 'border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-900/20 dark:text-emerald-300'
                            : 'border border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800/40 dark:bg-rose-900/20 dark:text-rose-300'
                        } disabled:opacity-50`}
                      >
                        {row.status === 'excluded' ? 'Вернуть' : 'Исключить'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
