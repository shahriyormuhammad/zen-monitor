'use client';

import { useMemo, useState } from 'react';
import Image from 'next/image';
import { Loader2, Megaphone, PackageSearch, RefreshCcw } from 'lucide-react';
import {
  formatDateTime,
  formatDecimal,
  formatMoney,
  formatMoneyPrecise,
  formatNumber,
  formatPercent,
} from '../../_shared/format';
import {
  bidChangeStatusLabel,
  drrToneClass,
  strategyReasonLabel,
  toNullableNumber,
  toSummaryObject,
} from '../strategy-helpers';
import { useBidWorkspace } from '../context/BidWorkspaceContext';

export type Ads2StatusFilter = 'all' | 'active' | 'pause';
export type Ads2BottomTab = 'days' | 'queries';

export type Ads2Row = {
  cluster: string;
  currentBid: number;
  adSpend: number;
  clicks: number;
  orders: number;
  ctrPct: number | null;
  acosProxyPct: number | null;
};

export type Ads2Summary = {
  clusters: number;
  adSpend: number;
  clicks: number;
  orders: number;
  riskClusters: number;
  weightedDrrPct: number | null;
};

export type Ads2DailyRow = {
  day: string;
  spend: number;
  clicks: number;
  orders: number;
  ctrPct: number | null;
  avgPos: number | null;
};

export type Ads2MapRow = {
  daily: Ads2DailyRow[];
};

export type Ads2ChangeRow = {
  id: string;
  cluster: string;
  previousBid: number | null;
  nextBid: number | null;
  status: string;
  reason: string | null;
  metrics: Record<string, unknown>;
  createdAt: string;
};

export type Ads2Strategy = {
  name: string;
  lookbackDays: number;
  targetAcosPct: number;
  maxCpcRub: number;
};

export type Ads2SelectedCluster = {
  nmId: number;
  cluster: string;
  brand: string | null;
  photoUrl: string | null;
};

function normalizeClusterKey(value: string) {
  return String(value ?? '').trim().toLocaleLowerCase('ru-RU');
}

function toSafeNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function Ads2Tab() {
  const {
    selectedCluster,
    effectiveAdvertId,
    availableCampaigns,
    guardrailAcos,
    guardrailClicks,
    bidsQuery,
    clusterMapQuery,
    strategiesQuery,
    strategyByCampaignKey,
    latestRunByStrategyId,
    ads2ChangedClusterSet,
  } = useBidWorkspace();

  const [statusFilter, setStatusFilter] = useState<Ads2StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [riskOnly, setRiskOnly] = useState(false);
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [bottomTab, setBottomTab] = useState<Ads2BottomTab>('days');
  const [activeCluster, setActiveCluster] = useState<string | null>(null);

  const ads2CampaignRows = useMemo(() => {
    if (!selectedCluster) {
      return [];
    }
    return availableCampaigns.map((campaign) => {
      const strategy = strategyByCampaignKey.get(`${campaign.advertId}:${selectedCluster.nmId}`) ?? null;
      const latestRun = strategy ? (latestRunByStrategyId.get(strategy.id) ?? null) : null;
      return { advertId: campaign.advertId, actionable: campaign.actionable, strategy, latestRun };
    });
  }, [availableCampaigns, latestRunByStrategyId, selectedCluster, strategyByCampaignKey]);

  const visibleCampaignRows = useMemo(() => (
    ads2CampaignRows.filter((row) => {
      if (statusFilter === 'all') return true;
      if (statusFilter === 'active') return Boolean(row.strategy?.isEnabled);
      return row.strategy ? !row.strategy.isEnabled : true;
    })
  ), [ads2CampaignRows, statusFilter]);

  const visibleRows = useMemo(() => {
    const rows = bidsQuery.data?.rows ?? [];
    const normalizedSearch = normalizeClusterKey(search);
    return rows.filter((row) => {
      const isRisk = (row.acosProxyPct !== null && row.acosProxyPct > guardrailAcos)
        || (row.orders <= 0 && row.clicks >= guardrailClicks);
      if (riskOnly && !isRisk) return false;
      if (onlyChanged && !ads2ChangedClusterSet.has(normalizeClusterKey(row.cluster))) return false;
      if (normalizedSearch.length > 0 && !normalizeClusterKey(row.cluster).includes(normalizedSearch)) return false;
      return true;
    });
  }, [ads2ChangedClusterSet, onlyChanged, riskOnly, search, bidsQuery.data?.rows, guardrailAcos, guardrailClicks]);

  const activeRow = useMemo(() => {
    if (visibleRows.length === 0) return null;
    if (activeCluster) {
      const key = normalizeClusterKey(activeCluster);
      const found = visibleRows.find((row) => normalizeClusterKey(row.cluster) === key);
      if (found) return found;
    }
    return visibleRows[0];
  }, [activeCluster, visibleRows]);

  const activeMapRow = useMemo(() => {
    if (!activeRow) return null;
    const key = normalizeClusterKey(activeRow.cluster);
    return (clusterMapQuery.data?.rows ?? []).find((row) => normalizeClusterKey(row.cluster) === key) ?? null;
  }, [activeRow, clusterMapQuery.data?.rows]);

  const activeChangeRows = useMemo(() => {
    if (!activeRow) return [];
    const key = normalizeClusterKey(activeRow.cluster);
    return (strategiesQuery.data?.recentChanges ?? [])
      .filter((change) => normalizeClusterKey(change.cluster) === key)
      .slice(0, 40);
  }, [activeRow, strategiesQuery.data?.recentChanges]);

  const summary = useMemo<Ads2Summary>(() => {
    const adSpend = visibleRows.reduce((sum, row) => sum + row.adSpend, 0);
    const clicks = visibleRows.reduce((sum, row) => sum + row.clicks, 0);
    const orders = visibleRows.reduce((sum, row) => sum + row.orders, 0);
    const riskClusters = visibleRows.filter((row) => (
      (row.acosProxyPct !== null && row.acosProxyPct > guardrailAcos)
      || (row.orders <= 0 && row.clicks >= guardrailClicks)
    )).length;
    const drrRows = visibleRows.filter((row) => row.acosProxyPct !== null && row.adSpend > 0);
    const weightedDrrPct = drrRows.length > 0
      ? drrRows.reduce((sum, row) => sum + (toSafeNumber(row.acosProxyPct) * row.adSpend), 0)
        / Math.max(1, drrRows.reduce((sum, row) => sum + row.adSpend, 0))
      : null;
    return {
      clusters: visibleRows.length,
      adSpend: Math.round(adSpend * 100) / 100,
      clicks,
      orders,
      riskClusters,
      weightedDrrPct: weightedDrrPct === null ? null : Math.round(weightedDrrPct * 100) / 100,
    };
  }, [visibleRows, guardrailAcos, guardrailClicks]);

  const currentStrategy = useMemo(() => {
    if (!selectedCluster || !effectiveAdvertId) return null;
    return strategyByCampaignKey.get(`${effectiveAdvertId}:${selectedCluster.nmId}`) ?? null;
  }, [effectiveAdvertId, selectedCluster, strategyByCampaignKey]);

  const isSyncing = bidsQuery.isFetching || strategiesQuery.isFetching;

  const handleSync = () => {
    void bidsQuery.refetch();
    void clusterMapQuery.refetch();
    void strategiesQuery.refetch();
  };

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-fuchsia-700/70 bg-[#0b0715] p-3 text-fuchsia-100 shadow-[0_0_0_1px_rgba(217,70,239,0.25)]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-fuchsia-300" />
            <h2 className="text-sm font-bold text-fuchsia-100">Реклама 2 · Поток управления</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {([
              { key: 'active', label: 'Активные' },
              { key: 'pause', label: 'Пауза' },
              { key: 'all', label: 'Все' },
            ] as const).map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setStatusFilter(item.key)}
                className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold transition ${
                  statusFilter === item.key
                    ? 'border-fuchsia-300 bg-fuchsia-500/20 text-fuchsia-100'
                    : 'border-fuchsia-700/50 bg-black/35 text-fuchsia-200 hover:bg-fuchsia-500/10'
                }`}
              >
                {item.label}
              </button>
            ))}
            <button
              type="button"
              onClick={handleSync}
              className="inline-flex items-center gap-1 rounded-md border border-fuchsia-700/50 bg-black/35 px-2.5 py-1 text-[11px] font-semibold text-fuchsia-200 hover:bg-fuchsia-500/10"
            >
              <RefreshCcw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              Синхронизация
            </button>
          </div>
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-6">
          <div className="rounded-lg border border-fuchsia-700/50 bg-black/35 p-2.5">
            <p className="text-[10px] uppercase tracking-wide text-fuchsia-300/80">Кластеров</p>
            <p className="mt-1 text-base font-bold">{formatNumber(summary.clusters)}</p>
          </div>
          <div className="rounded-lg border border-fuchsia-700/50 bg-black/35 p-2.5">
            <p className="text-[10px] uppercase tracking-wide text-fuchsia-300/80">Расход</p>
            <p className="mt-1 text-base font-bold">{formatMoney(summary.adSpend)}</p>
          </div>
          <div className="rounded-lg border border-fuchsia-700/50 bg-black/35 p-2.5">
            <p className="text-[10px] uppercase tracking-wide text-fuchsia-300/80">Клики / Заказы</p>
            <p className="mt-1 text-base font-bold">{formatNumber(summary.clicks)} / {formatNumber(summary.orders)}</p>
          </div>
          <div className="rounded-lg border border-fuchsia-700/50 bg-black/35 p-2.5">
            <p className="text-[10px] uppercase tracking-wide text-fuchsia-300/80">ДРР (взв.)</p>
            <p className={`mt-1 text-base font-bold ${summary.weightedDrrPct !== null && currentStrategy?.targetAcosPct !== undefined && summary.weightedDrrPct > currentStrategy.targetAcosPct ? 'text-rose-300' : 'text-emerald-300'}`}>
              {formatPercent(summary.weightedDrrPct, 1)}
            </p>
          </div>
          <div className="rounded-lg border border-fuchsia-700/50 bg-black/35 p-2.5">
            <p className="text-[10px] uppercase tracking-wide text-fuchsia-300/80">Риск-кластеры</p>
            <p className={`mt-1 text-base font-bold ${summary.riskClusters > 0 ? 'text-rose-300' : 'text-emerald-300'}`}>
              {formatNumber(summary.riskClusters)}
            </p>
          </div>
          <div className="rounded-lg border border-fuchsia-700/50 bg-black/35 p-2.5">
            <p className="text-[10px] uppercase tracking-wide text-fuchsia-300/80">Кампаний</p>
            <p className="mt-1 text-base font-bold">{formatNumber(visibleCampaignRows.length)}</p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="гр. предмет / кластер"
            className="min-w-[240px] flex-1 rounded-md border border-fuchsia-700/50 bg-black/40 px-3 py-1.5 text-xs text-fuchsia-100 placeholder:text-fuchsia-300/50"
          />
          <label className="inline-flex items-center gap-2 rounded-md border border-fuchsia-700/50 bg-black/35 px-2.5 py-1.5 text-[11px] font-semibold text-fuchsia-200">
            <input type="checkbox" checked={riskOnly} onChange={(event) => setRiskOnly(event.target.checked)} />
            риск
          </label>
          <label className="inline-flex items-center gap-2 rounded-md border border-fuchsia-700/50 bg-black/35 px-2.5 py-1.5 text-[11px] font-semibold text-fuchsia-200">
            <input type="checkbox" checked={onlyChanged} onChange={(event) => setOnlyChanged(event.target.checked)} />
            изменённые
          </label>
        </div>
      </div>

      <div className="rounded-2xl border border-fuchsia-700/70 bg-[#090612] p-3 text-fuchsia-100 shadow-[0_0_0_1px_rgba(217,70,239,0.2)]">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-fuchsia-200/80">Лента кампаний и кластеров</p>
        {bidsQuery.isLoading ? (
          <div className="flex items-center gap-2 text-xs text-fuchsia-200/70">
            <Loader2 className="h-4 w-4 animate-spin" />
            Загружаем ленту...
          </div>
        ) : bidsQuery.error ? (
          <p className="text-xs text-rose-300">{bidsQuery.error.message}</p>
        ) : visibleRows.length === 0 ? (
          <p className="text-xs text-fuchsia-200/70">Нет строк по текущим фильтрам.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="text-left uppercase tracking-wide text-fuchsia-200/70">
                  <th scope="col" className="px-2 py-1.5">Товар / Кластер</th>
                  <th scope="col" className="px-2 py-1.5">Камп.</th>
                  <th scope="col" className="px-2 py-1.5">Период</th>
                  <th scope="col" className="px-2 py-1.5">Таргет / Ставка / Лимит</th>
                  <th scope="col" className="px-2 py-1.5">CTR</th>
                  <th scope="col" className="px-2 py-1.5">Затраты</th>
                  <th scope="col" className="px-2 py-1.5">Клики / Заказы</th>
                  <th scope="col" className="px-2 py-1.5">ДРР</th>
                  <th scope="col" className="px-2 py-1.5">Сигнал</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.slice(0, 140).map((row) => {
                  const risk = (row.acosProxyPct !== null && row.acosProxyPct > guardrailAcos)
                    || (row.orders <= 0 && row.clicks >= guardrailClicks);
                  const isSelected = activeRow ? row.cluster === activeRow.cluster : false;
                  return (
                    <tr
                      key={row.cluster}
                      className={`cursor-pointer border-t border-fuchsia-900/70 transition ${
                        isSelected ? 'bg-fuchsia-500/25' : risk ? 'bg-rose-500/10 hover:bg-rose-500/15' : 'hover:bg-fuchsia-500/10'
                      }`}
                      onClick={() => setActiveCluster(row.cluster)}
                    >
                      <td className="px-2 py-1.5">
                        <p className="font-semibold text-fuchsia-100">{row.cluster}</p>
                        <p className="text-[10px] text-fuchsia-200/70">nmID {selectedCluster?.nmId ?? '—'}</p>
                      </td>
                      <td className="px-2 py-1.5 text-fuchsia-50">#{effectiveAdvertId ?? '—'}</td>
                      <td className="px-2 py-1.5 text-fuchsia-50">{formatNumber(currentStrategy?.lookbackDays ?? null)} дн.</td>
                      <td className="px-2 py-1.5 text-fuchsia-50">
                        {formatPercent(currentStrategy?.targetAcosPct ?? null, 1)} / {formatMoneyPrecise(row.currentBid, 0)} / {formatMoneyPrecise(currentStrategy?.maxCpcRub ?? null, 2)}
                      </td>
                      <td className="px-2 py-1.5 text-fuchsia-50">{formatPercent(row.ctrPct, 2)}</td>
                      <td className="px-2 py-1.5 text-fuchsia-50">{formatMoney(row.adSpend)}</td>
                      <td className="px-2 py-1.5 text-fuchsia-50">{formatNumber(row.clicks)} / {formatNumber(row.orders)}</td>
                      <td className="px-2 py-1.5">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${drrToneClass(row.acosProxyPct, currentStrategy?.targetAcosPct ?? null)}`}>
                          {formatPercent(row.acosProxyPct, 1)}
                        </span>
                      </td>
                      <td className="px-2 py-1.5">
                        {risk ? (
                          <span className="inline-flex rounded-full border border-rose-400/60 bg-rose-500/20 px-2 py-0.5 text-[11px] font-semibold text-rose-200">risk</span>
                        ) : (
                          <span className="inline-flex rounded-full border border-emerald-400/60 bg-emerald-500/20 px-2 py-0.5 text-[11px] font-semibold text-emerald-200">ok</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid gap-3 xl:grid-cols-[300px_1fr]">
        <div className="rounded-2xl border border-fuchsia-700/70 bg-[#090612] p-3 text-fuchsia-100 shadow-[0_0_0_1px_rgba(217,70,239,0.2)]">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-fuchsia-200/80">Карточка товара</p>
          <div className="space-y-2">
            <div className="h-[220px] w-full overflow-hidden rounded-xl border border-fuchsia-700/50 bg-black/40">
              {selectedCluster?.photoUrl ? (
                <Image
                  src={selectedCluster.photoUrl}
                  alt={`nmId ${selectedCluster.nmId}`}
                  width={320}
                  height={220}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-fuchsia-300/70">
                  <PackageSearch className="h-8 w-8" />
                </div>
              )}
            </div>
            <div className="rounded-xl border border-fuchsia-700/50 bg-black/35 p-2.5 text-xs text-fuchsia-100">
              <p className="font-semibold">{selectedCluster?.brand ?? 'Бренд не указан'}</p>
              <p className="mt-1 text-fuchsia-200/80">Код товара: {selectedCluster?.nmId ?? '—'}</p>
              <p className="text-fuchsia-200/80">Кампания: #{effectiveAdvertId ?? '—'}</p>
              <p className="text-fuchsia-200/80">Кластер: {activeRow?.cluster ?? selectedCluster?.cluster ?? '—'}</p>
              <p className="mt-2 text-[11px] text-fuchsia-300/80">
                {currentStrategy
                  ? `Стратегия: ${currentStrategy.name}`
                  : 'Для кампании пока нет автостратегии'}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-fuchsia-700/70 bg-[#090612] p-3 text-fuchsia-100 shadow-[0_0_0_1px_rgba(217,70,239,0.2)]">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setBottomTab('days')}
              className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold ${
                bottomTab === 'days'
                  ? 'border-fuchsia-300 bg-fuchsia-500/20 text-fuchsia-100'
                  : 'border-fuchsia-700/50 bg-black/35 text-fuchsia-200'
              }`}
            >
              По дням
            </button>
            <button
              type="button"
              onClick={() => setBottomTab('queries')}
              className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold ${
                bottomTab === 'queries'
                  ? 'border-fuchsia-300 bg-fuchsia-500/20 text-fuchsia-100'
                  : 'border-fuchsia-700/50 bg-black/35 text-fuchsia-200'
              }`}
            >
              Запросы
            </button>
            <span className="ml-auto text-[11px] text-fuchsia-200/70">
              Активный кластер: {activeRow?.cluster ?? '—'}
            </span>
          </div>

          {bottomTab === 'days' ? (
            !activeMapRow ? (
              <p className="text-xs text-fuchsia-200/70">Нет дневной истории для выбранного кластера.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="text-left uppercase tracking-wide text-fuchsia-200/70">
                      <th scope="col" className="px-2 py-1.5">Дата</th>
                      <th scope="col" className="px-2 py-1.5">Расход</th>
                      <th scope="col" className="px-2 py-1.5">Клики</th>
                      <th scope="col" className="px-2 py-1.5">Заказы</th>
                      <th scope="col" className="px-2 py-1.5">CTR</th>
                      <th scope="col" className="px-2 py-1.5">Позиция</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...activeMapRow.daily].reverse().slice(0, 14).map((day) => (
                      <tr key={day.day} className="border-t border-fuchsia-900/70">
                        <td className="px-2 py-1.5 text-fuchsia-50">{day.day}</td>
                        <td className="px-2 py-1.5 text-fuchsia-50">{formatMoney(day.spend)}</td>
                        <td className="px-2 py-1.5 text-fuchsia-50">{formatNumber(day.clicks)}</td>
                        <td className="px-2 py-1.5 text-fuchsia-50">{formatNumber(day.orders)}</td>
                        <td className="px-2 py-1.5 text-fuchsia-50">{formatPercent(day.ctrPct, 2)}</td>
                        <td className="px-2 py-1.5 text-fuchsia-50">{formatDecimal(day.avgPos, 2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : (
            !activeChangeRows || activeChangeRows.length === 0 ? (
              <p className="text-xs text-fuchsia-200/70">Нет автоизменений для выбранного кластера.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="text-left uppercase tracking-wide text-fuchsia-200/70">
                      <th scope="col" className="px-2 py-1.5">Время</th>
                      <th scope="col" className="px-2 py-1.5">Ставка</th>
                      <th scope="col" className="px-2 py-1.5">Δ%</th>
                      <th scope="col" className="px-2 py-1.5">ДРР (сегодня/окно)</th>
                      <th scope="col" className="px-2 py-1.5">Статус</th>
                      <th scope="col" className="px-2 py-1.5">Причина</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeChangeRows.map((change) => {
                      const metrics = toSummaryObject(change.metrics);
                      const drrTodayPct = toNullableNumber(metrics.drrTodayPct);
                      const drrWindowPct = toNullableNumber(metrics.drrWindowPct ?? metrics.acosProxyPct);
                      const deltaPct = (
                        change.previousBid !== null
                        && change.nextBid !== null
                        && change.previousBid > 0
                      )
                        ? ((change.nextBid - change.previousBid) / change.previousBid) * 100
                        : null;
                      return (
                        <tr key={change.id} className="border-t border-fuchsia-900/70">
                          <td className="px-2 py-1.5 text-fuchsia-50">{formatDateTime(change.createdAt)}</td>
                          <td className="px-2 py-1.5 text-fuchsia-50">
                            {formatMoneyPrecise(change.previousBid, 0)} → {formatMoneyPrecise(change.nextBid, 0)}
                          </td>
                          <td className={`px-2 py-1.5 ${deltaPct !== null && deltaPct > 0 ? 'text-rose-300' : 'text-emerald-300'}`}>
                            {formatPercent(deltaPct, 2)}
                          </td>
                          <td className="px-2 py-1.5">
                            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${drrToneClass(drrTodayPct, currentStrategy?.targetAcosPct ?? null)}`}>
                              {`${formatPercent(drrTodayPct, 1)} / ${formatPercent(drrWindowPct, 1)}`}
                            </span>
                          </td>
                          <td className="px-2 py-1.5 text-fuchsia-50">{bidChangeStatusLabel(change.status)}</td>
                          <td className="px-2 py-1.5 text-fuchsia-50">{strategyReasonLabel(change.reason)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          )}
        </div>
      </div>
    </section>
  );
}
