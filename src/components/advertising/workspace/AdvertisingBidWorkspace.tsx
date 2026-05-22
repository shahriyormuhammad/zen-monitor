'use client';

import { useMemo, useState } from 'react';
import Image from 'next/image';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Megaphone, PackageSearch, Zap } from 'lucide-react';
import { panelClass } from '../_shared/ui';
import { AlertsTab } from './tabs/AlertsTab';
import { MapTab, type ClusterMapResponse, type MapActionMessage } from './tabs/MapTab';
import { BatchTab } from './tabs/BatchTab';
import { BidsTab, type BidWorkspaceResponse } from './tabs/BidsTab';
import { Ads2Tab } from './tabs/Ads2Tab';
import { PacingTab } from './tabs/PacingTab';
import { PortfoliosTab } from './tabs/PortfoliosTab';
import { OperationsHealthStrip, OperationsTab } from './tabs/OperationsTab';
import {
  StrategiesTab,
  normalizeRunEstimatedSavingsRub,
  type StrategiesResponse,
  type StrategyRecord,
} from './tabs/StrategiesTab';
import {
  toNullableNumber,
  toSummaryObject,
} from './strategy-helpers';
import {
  BidWorkspaceContext,
  type ClusterToggleArgs,
  type ClusterToggleResult,
} from './context/BidWorkspaceContext';

export type AdvertisingWorkspaceTab = 'bids' | 'map' | 'batch' | 'ads2' | 'strategies' | 'pacing' | 'portfolios' | 'alerts' | 'operations';

type Props = {
  tenantId: string;
  fromParam: string;
  toParam: string;
  initialTab?: AdvertisingWorkspaceTab;
};

type ClusterRiskLevel = 'high' | 'medium' | 'low' | 'none';

type AdvertisingClusterListRow = {
  nmId: number;
  cluster: string;
  vendorCode: string | null;
  brand: string | null;
  photoUrl: string | null;
  adSpend: number;
  clicks: number;
  orders: number;
  riskLevel: ClusterRiskLevel;
  riskReason: string | null;
};

type AdvertisingClusterListResponse = {
  rows: AdvertisingClusterListRow[];
  summary: {
    highRiskClusters: number;
  };
};

type AdvertisingClusterCampaignState = {
  advertId: number;
  paymentType: 'cpm' | 'cpc' | null;
  actionable: boolean;
};

type AdvertisingClusterControlResponse = {
  campaigns: AdvertisingClusterCampaignState[];
};

function toSafeNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatDayKeyMoscow(value: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Europe/Moscow',
  }).format(value);
}

function normalizeClusterKey(value: string) {
  return String(value ?? '').trim().toLocaleLowerCase('ru-RU');
}

export function AdvertisingBidWorkspace(props: Props) {
  const { tenantId, fromParam, toParam, initialTab } = props;
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<AdvertisingWorkspaceTab>(initialTab ?? 'bids');
  const [selectedClusterKey, setSelectedClusterKey] = useState<string>('');
  const [selectedAdvertId, setSelectedAdvertId] = useState<number | null>(null);
  const [guardrailAcos, setGuardrailAcos] = useState<number>(35);
  const [guardrailCpo, setGuardrailCpo] = useState<number>(1200);
  const [guardrailClicks, setGuardrailClicks] = useState<number>(15);
  const [enableGuardrail, setEnableGuardrail] = useState(true);
  const [mapActionMessage, setMapActionMessage] = useState<MapActionMessage | null>(null);

  const clustersQuery = useQuery<AdvertisingClusterListResponse | null, Error>({
    queryKey: ['adv-workspace-clusters', tenantId, fromParam, toParam],
    queryFn: async () => {
      const response = await fetch(
        `/api/views/advertising/clusters?from=${fromParam}&to=${toParam}&limit=180`,
        { cache: 'no-store' },
      );
      if (!response.ok) {
        throw new Error('Не удалось получить список кластеров');
      }
      return response.json();
    },
    enabled: Boolean(tenantId),
  });

  const selectedCluster = useMemo(() => {
    const rows = clustersQuery.data?.rows ?? [];
    if (rows.length === 0) {
      return null;
    }
    if (!selectedClusterKey) {
      return rows[0];
    }
    return rows.find((row) => `${row.nmId}:${row.cluster}` === selectedClusterKey) ?? rows[0];
  }, [clustersQuery.data?.rows, selectedClusterKey]);

  const clusterControlQuery = useQuery<AdvertisingClusterControlResponse | null, Error>({
    queryKey: ['adv-workspace-control', tenantId, selectedCluster?.nmId ?? 0, selectedCluster?.cluster ?? ''],
    queryFn: async () => {
      if (!selectedCluster) {
        return null;
      }
      const params = new URLSearchParams({
        nmId: String(selectedCluster.nmId),
        cluster: selectedCluster.cluster,
      });
      const response = await fetch(`/api/views/advertising/clusters/actions?${params.toString()}`, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('Не удалось загрузить кампании выбранного кластера');
      }
      return response.json();
    },
    enabled: Boolean(tenantId && selectedCluster),
  });

  const availableCampaigns = useMemo(() => {
    const campaigns = clusterControlQuery.data?.campaigns ?? [];
    return campaigns.filter((campaign) => campaign.paymentType === 'cpm' && campaign.actionable);
  }, [clusterControlQuery.data?.campaigns]);

  const effectiveAdvertId = useMemo(() => {
    if (availableCampaigns.length === 0) {
      return null;
    }
    const exists = availableCampaigns.some((campaign) => campaign.advertId === selectedAdvertId);
    if (exists && selectedAdvertId !== null) {
      return selectedAdvertId;
    }
    return availableCampaigns[0]!.advertId;
  }, [availableCampaigns, selectedAdvertId]);

  const bidsQuery = useQuery<BidWorkspaceResponse | null, Error>({
    queryKey: ['adv-workspace-bids', tenantId, fromParam, toParam, selectedCluster?.nmId ?? 0, effectiveAdvertId ?? 0],
    queryFn: async () => {
      if (!selectedCluster || !effectiveAdvertId) {
        return null;
      }
      const params = new URLSearchParams({
        from: fromParam,
        to: toParam,
        advertId: String(effectiveAdvertId),
        nmId: String(selectedCluster.nmId),
      });
      const response = await fetch(`/api/views/advertising/workspace/bids?${params.toString()}`, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('Не удалось загрузить текущие ставки');
      }
      return response.json();
    },
    enabled: Boolean(tenantId && selectedCluster && effectiveAdvertId),
  });

  const clusterMapQuery = useQuery<ClusterMapResponse | null, Error>({
    queryKey: ['adv-workspace-map', tenantId, fromParam, toParam, selectedCluster?.nmId ?? 0, effectiveAdvertId ?? 0],
    queryFn: async () => {
      if (!selectedCluster || !effectiveAdvertId) {
        return null;
      }
      const params = new URLSearchParams({
        from: fromParam,
        to: toParam,
        advertId: String(effectiveAdvertId),
        nmId: String(selectedCluster.nmId),
      });
      const response = await fetch(`/api/views/advertising/workspace/map?${params.toString()}`, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('Не удалось загрузить карту кластеров');
      }
      return response.json();
    },
    enabled: Boolean(tenantId && selectedCluster && effectiveAdvertId),
  });

  const strategiesQuery = useQuery<StrategiesResponse | null, Error>({
    queryKey: ['adv-workspace-strategies', tenantId],
    queryFn: async () => {
      const response = await fetch(`/api/views/advertising/workspace/strategies`, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('Не удалось загрузить автостратегии');
      }
      return response.json();
    },
    enabled: Boolean(tenantId),
    refetchInterval: tab === 'strategies' ? 15_000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  const strategyById = useMemo(() => {
    const map = new globalThis.Map<string, StrategyRecord>();
    for (const strategy of strategiesQuery.data?.strategies ?? []) {
      map.set(strategy.id, strategy);
    }
    return map;
  }, [strategiesQuery.data?.strategies]);

  const strategyByCampaignKey = useMemo(() => {
    const map = new globalThis.Map<string, StrategyRecord>();
    for (const strategy of strategiesQuery.data?.strategies ?? []) {
      map.set(`${strategy.advertId}:${strategy.nmId}`, strategy);
    }
    return map;
  }, [strategiesQuery.data?.strategies]);

  const latestRunByStrategyId = useMemo(() => {
    const map = new globalThis.Map<string, StrategiesResponse['runs'][number]>();
    for (const run of strategiesQuery.data?.runs ?? []) {
      if (!map.has(run.strategyId)) {
        map.set(run.strategyId, run);
      }
    }
    return map;
  }, [strategiesQuery.data?.runs]);

  const strategyAutopilotInsights = useMemo(() => {
    const runs = strategiesQuery.data?.runs ?? [];
    const recentChanges = strategiesQuery.data?.recentChanges ?? [];
    const generatedAtMs = Date.parse(String(strategiesQuery.data?.generatedAt ?? ''));
    const nowMs = Number.isFinite(generatedAtMs) ? generatedAtMs : 0;
    const dayMs = 24 * 60 * 60 * 1000;

    let estimatedSavings24hRub = 0;
    let rewardSum = 0;
    let rewardSamples = 0;
    let observedPosSum = 0;
    let observedPosSamples = 0;

    for (const run of runs) {
      const summary = toSummaryObject(run.summary);
      const normalizedSavingsRub = normalizeRunEstimatedSavingsRub(summary);
      const startedAtMs = Date.parse(run.startedAt);
      if (nowMs > 0 && Number.isFinite(startedAtMs) && nowMs - startedAtMs <= dayMs) {
        estimatedSavings24hRub += normalizedSavingsRub;
      }
      const reward = toNullableNumber(summary.runReward);
      if (reward !== null) {
        rewardSum += reward;
        rewardSamples += 1;
      }
      const observedPos = toNullableNumber(summary.observedAvgPos);
      if (observedPos !== null) {
        observedPosSum += observedPos;
        observedPosSamples += 1;
      }
    }

    let inTargetCount = 0;
    let inTargetSamples = 0;
    for (const change of recentChanges) {
      const metrics = toSummaryObject(change.metrics);
      const avgPos = toNullableNumber(metrics.avgPos);
      const targetFrom = toNullableNumber(metrics.targetPositionFrom);
      const targetTo = toNullableNumber(metrics.targetPositionTo);
      if (avgPos === null || targetFrom === null || targetTo === null) {
        continue;
      }
      inTargetSamples += 1;
      if (avgPos >= targetFrom && avgPos <= targetTo) {
        inTargetCount += 1;
      }
    }

    return {
      estimatedSavings24hRub: Math.round(estimatedSavings24hRub),
      avgReward: rewardSamples > 0 ? rewardSum / rewardSamples : null,
      observedAvgPos: observedPosSamples > 0 ? observedPosSum / observedPosSamples : null,
      inTargetRatePct: inTargetSamples > 0 ? (inTargetCount / inTargetSamples) * 100 : null,
    };
  }, [strategiesQuery.data?.generatedAt, strategiesQuery.data?.runs, strategiesQuery.data?.recentChanges]);

  const strategyTodayKey = useMemo(() => formatDayKeyMoscow(new Date()), []);

  const bidsByClusterKey = useMemo(() => {
    const map = new globalThis.Map<string, BidWorkspaceResponse['rows'][number]>();
    for (const row of bidsQuery.data?.rows ?? []) {
      map.set(normalizeClusterKey(row.cluster), row);
    }
    return map;
  }, [bidsQuery.data?.rows]);

  const strategyClusterRows = useMemo(() => {
    return (clusterMapQuery.data?.rows ?? [])
      .map((row) => {
        const today = row.daily.find((day) => day.day === strategyTodayKey) ?? null;
        const bidRow = bidsByClusterKey.get(normalizeClusterKey(row.cluster));
        return {
          cluster: row.cluster,
          status: row.status,
          currentBid: bidRow?.currentBid ?? null,
          avgPos: today?.avgPos ?? row.totals.avgPos ?? null,
          todaySpend: today?.spend ?? 0,
          todayClicks: today?.clicks ?? 0,
          todayOrders: today?.orders ?? 0,
          totalSpend: row.totals.spend,
        };
      })
      .sort((left, right) => {
        if (left.status !== right.status) {
          if (left.status === 'active') return -1;
          if (right.status === 'active') return 1;
          if (left.status === 'excluded') return -1;
          if (right.status === 'excluded') return 1;
        }
        if (right.todaySpend !== left.todaySpend) {
          return right.todaySpend - left.todaySpend;
        }
        return right.totalSpend - left.totalSpend;
      });
  }, [bidsByClusterKey, clusterMapQuery.data?.rows, strategyTodayKey]);

  const strategyTodaySummary = useMemo(() => {
    const activeRows = strategyClusterRows.filter((row) => row.status === 'active');
    return {
      activeClusters: activeRows.length,
      adSpendToday: activeRows.reduce((sum, row) => sum + row.todaySpend, 0),
      clicksToday: activeRows.reduce((sum, row) => sum + row.todayClicks, 0),
      ordersToday: activeRows.reduce((sum, row) => sum + row.todayOrders, 0),
    };
  }, [strategyClusterRows]);

  const ads2ChangedClusterSet = useMemo(() => {
    const set = new Set<string>();
    for (const change of strategiesQuery.data?.recentChanges ?? []) {
      const key = normalizeClusterKey(change.cluster ?? '');
      if (key) {
        set.add(key);
      }
    }
    return set;
  }, [strategiesQuery.data?.recentChanges]);

  const clusterToggleMutation = useMutation<ClusterToggleResult, Error, ClusterToggleArgs>({
    mutationFn: async ({ advertId, nmId, cluster, mode }) => {
      const response = await fetch(`/api/views/advertising/clusters/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ advertId, nmId, cluster, mode }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload?.error === 'string' ? payload.error : 'Не удалось изменить статус кластера');
      }
      return payload;
    },
    onSuccess: (result) => {
      setMapActionMessage({
        tone: 'success',
        text: result.changed
          ? `Кластер «${result.cluster}» ${result.mode === 'exclude' ? 'добавлен в минус-фразы' : 'возвращён в показы'} в кампании ${result.advertId}.`
          : `Изменения не требуются: кластер «${result.cluster}» уже в нужном состоянии.`,
      });
      void queryClient.invalidateQueries({ queryKey: ['adv-workspace-map', tenantId, fromParam, toParam] });
      void queryClient.invalidateQueries({ queryKey: ['adv-workspace-control', tenantId] });
      void queryClient.invalidateQueries({ queryKey: ['adv-workspace-clusters', tenantId, fromParam, toParam] });
      void queryClient.invalidateQueries({ queryKey: ['adv-workspace-alerts', tenantId, fromParam, toParam] });
    },
    onError: (error) => {
      setMapActionMessage({ tone: 'error', text: error.message });
    },
  });

  const tabButtonClass = (key: AdvertisingWorkspaceTab) => (
    `rounded-xl px-3 py-2 text-sm font-semibold transition ${
      tab === key
        ? 'bg-slate-900 text-white'
        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
    }`
  );

  // Suppress unused variable warning — toSafeNumber is kept for potential future use
  void toSafeNumber;

  return (
    <BidWorkspaceContext.Provider value={{
      tenantId,
      fromParam,
      toParam,
      selectedCluster: selectedCluster ?? null,
      effectiveAdvertId,
      availableCampaigns,
      guardrailAcos,
      setGuardrailAcos,
      guardrailCpo,
      setGuardrailCpo,
      guardrailClicks,
      setGuardrailClicks,
      enableGuardrail,
      setEnableGuardrail,
      bidsQuery,
      clusterMapQuery,
      strategiesQuery,
      strategyById,
      strategyByCampaignKey,
      latestRunByStrategyId,
      strategyClusterRows,
      strategyTodayKey,
      strategyTodaySummary,
      strategyAutopilotInsights,
      ads2ChangedClusterSet,
      clusterToggleMutation,
      mapActionMessage,
      setMapActionMessage,
    }}>
      <div className="space-y-4">
        <section className={panelClass}>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={tabButtonClass('bids')} onClick={() => setTab('bids')}>Ставки</button>
            <button type="button" className={tabButtonClass('map')} onClick={() => setTab('map')}>Карта кластеров</button>
            <button type="button" className={tabButtonClass('batch')} onClick={() => setTab('batch')}>Пакетные операции</button>
            <button type="button" className={tabButtonClass('ads2')} onClick={() => setTab('ads2')}>Реклама 2</button>
            <button type="button" className={tabButtonClass('strategies')} onClick={() => setTab('strategies')}>Автостратегии</button>
            <button type="button" className={tabButtonClass('pacing')} onClick={() => setTab('pacing')}>Пейсинг и почасовой режим</button>
            <button type="button" className={tabButtonClass('portfolios')} onClick={() => setTab('portfolios')}>Портфели</button>
            <button type="button" className={tabButtonClass('alerts')} onClick={() => setTab('alerts')}>Алерты</button>
            <button type="button" className={tabButtonClass('operations')} onClick={() => setTab('operations')}>Операции</button>
          </div>
        </section>

        <OperationsHealthStrip tenantId={tenantId} fromParam={fromParam} toParam={toParam} />

        <section className={panelClass}>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Контекст управления</p>
          {clustersQuery.isLoading ? (
            <div className="mt-3 flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Загружаем кластеры...
            </div>
          ) : clustersQuery.error ? (
            <p className="mt-3 text-sm text-rose-600">{clustersQuery.error.message}</p>
          ) : (clustersQuery.data?.rows?.length ?? 0) === 0 ? (
            <p className="mt-3 text-sm text-slate-500">Нет кластеров в выбранном диапазоне дат.</p>
          ) : (
            <>
              <div className="mt-3 grid gap-3 md:grid-cols-[1.2fr_1fr]">
                <div>
                  <label className="text-xs font-semibold text-slate-500">Кластер</label>
                  <select
                    value={selectedCluster ? `${selectedCluster.nmId}:${selectedCluster.cluster}` : ''}
                    onChange={(event) => {
                      setSelectedClusterKey(event.target.value);
                    }}
                    className="mt-1 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-300"
                  >
                    {(clustersQuery.data?.rows ?? []).slice(0, 140).map((row) => (
                      <option key={`${row.nmId}:${row.cluster}`} value={`${row.nmId}:${row.cluster}`}>
                        nmId {row.nmId} · {row.cluster}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500">Кампания (CPM)</label>
                  <select
                    value={effectiveAdvertId ?? ''}
                    onChange={(event) => setSelectedAdvertId(Number(event.target.value))}
                    disabled={availableCampaigns.length === 0}
                    className="mt-1 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-300 disabled:bg-slate-50 dark:disabled:bg-slate-700"
                  >
                    {availableCampaigns.length === 0 ? (
                      <option value="">Нет доступных кампаний</option>
                    ) : availableCampaigns.map((campaign) => (
                      <option key={campaign.advertId} value={campaign.advertId}>
                        Кампания {campaign.advertId}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {selectedCluster ? (
                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Текущий товар и кампания</p>
                  <div className="grid gap-3 md:grid-cols-[88px_1fr]">
                    <div className="h-[88px] w-[88px] overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                      {selectedCluster.photoUrl ? (
                        <Image
                          src={selectedCluster.photoUrl}
                          alt={`nmId ${selectedCluster.nmId}`}
                          width={88}
                          height={88}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-slate-400">
                          <PackageSearch className="h-6 w-6" />
                        </div>
                      )}
                    </div>
                    <div className="space-y-1 text-sm text-slate-700">
                      <p className="font-semibold text-slate-900 dark:text-slate-100">
                        {selectedCluster.brand || selectedCluster.vendorCode
                          ? `${selectedCluster.brand ?? 'Бренд не указан'} · ${selectedCluster.vendorCode ?? 'Артикул не указан'}`
                          : `nmId ${selectedCluster.nmId}`}
                      </p>
                      <p className="text-xs text-slate-600">nmId {selectedCluster.nmId}</p>
                      <p className="text-xs text-slate-600">Кластер: {selectedCluster.cluster}</p>
                      <p className="text-xs font-semibold text-indigo-700">
                        Кампания: {effectiveAdvertId ? `#${effectiveAdvertId}` : 'не выбрана'}
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </section>

        {tab === 'bids' ? <BidsTab /> : null}

        {tab === 'ads2' ? <Ads2Tab /> : null}

        {tab === 'map' ? (
          <MapTab
            actionMessage={mapActionMessage}
            isLoading={clusterMapQuery.isLoading}
            error={clusterMapQuery.error}
            data={clusterMapQuery.data}
            toggleDisabled={clusterToggleMutation.isPending || !effectiveAdvertId || !selectedCluster}
            onToggle={(cluster, currentStatus) => {
              if (!effectiveAdvertId || !selectedCluster) {
                return;
              }
              setMapActionMessage(null);
              void clusterToggleMutation.mutateAsync({
                advertId: effectiveAdvertId,
                nmId: selectedCluster.nmId,
                cluster,
                mode: currentStatus === 'excluded' ? 'include' : 'exclude',
              });
            }}
          />
        ) : null}

        {tab === 'batch' ? (
          <BatchTab tenantId={tenantId} fromParam={fromParam} toParam={toParam} />
        ) : null}

        {tab === 'strategies' ? <StrategiesTab /> : null}

        {tab === 'pacing' ? (
          <PacingTab
            tenantId={tenantId}
            fromParam={fromParam}
            toParam={toParam}
            selectedClusterNmId={selectedCluster?.nmId ?? null}
            effectiveAdvertId={effectiveAdvertId}
          />
        ) : null}

        {tab === 'portfolios' ? (
          <PortfoliosTab tenantId={tenantId} fromParam={fromParam} toParam={toParam} />
        ) : null}

        {tab === 'alerts' ? (
          <AlertsTab tenantId={tenantId} fromParam={fromParam} toParam={toParam} />
        ) : null}

        {tab === 'operations' ? (
          <OperationsTab tenantId={tenantId} fromParam={fromParam} toParam={toParam} />
        ) : null}

        <section className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
          <p className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-emerald-600" />
            Защитные лимиты ДРР и авто-бидер используют оценочные метрики по кластерам (на базе сырых данных и текущей WB-выгрузки).
          </p>
          <p className="mt-1 flex items-center gap-2">
            <Megaphone className="h-4 w-4 text-sky-600" />
            Карта кластеров построена на `normquery/list` + дневной динамике `v1/normquery/stats`.
          </p>
        </section>
      </div>
    </BidWorkspaceContext.Provider>
  );
}
