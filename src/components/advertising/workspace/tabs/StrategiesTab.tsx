'use client';

import { useState } from 'react';
import { Bot, Loader2, RefreshCcw } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  formatDateTime,
  formatDecimal,
  formatMoney,
  formatMoneyPrecise,
  formatNumber,
  formatPercent,
} from '../../_shared/format';
import { mapStatusLabel, panelClass } from '../../_shared/ui';
import {
  bidChangeStatusLabel,
  drrToneClass,
  strategyReasonLabel,
  strategyStateLabel,
  toNullableNumber,
  toSummaryObject,
} from '../strategy-helpers';
import { useBidWorkspace } from '../context/BidWorkspaceContext';

export type StrategyRecord = {
  id: string;
  name: string;
  advertId: number;
  nmId: number;
  mode: 'classic' | 'self_learning';
  targetPositionFrom: number;
  targetPositionTo: number;
  explorationPct: number;
  minClicksForLearning: number;
  retestCooldownHours: number;
  retestPercent: number;
  maxRetestPerRun: number;
  isEnabled: boolean;
  dryRun: boolean;
  biddingMode: 'drr' | 'cpm' | 'roas' | 'hybrid';
  targetAcosPct: number;
  targetCpmRub: number;
  targetRoas: number;
  minOrders: number;
  maxCpcRub: number;
  minBid: number;
  maxBid: number;
  stepUpPct: number;
  stepDownPct: number;
  lookbackDays: number;
  intervalMinutes: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastStatus: string | null;
  lastSummary: Record<string, unknown>;
};

export type StrategyRun = {
  id: string;
  strategyId: string;
  triggerSource: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  summary: Record<string, unknown>;
};

export type StrategyRecentChange = {
  id: string;
  strategyId: string;
  cluster: string;
  previousBid: number | null;
  nextBid: number | null;
  status: string;
  reason: string | null;
  metrics: Record<string, unknown>;
  createdAt: string;
};

export type StrategiesResponse = {
  generatedAt: string;
  strategies: StrategyRecord[];
  runs: StrategyRun[];
  recentChanges: StrategyRecentChange[];
};

export type StrategyTemplateKey = 'balanced' | 'margin_guard' | 'growth' | 'launch' | 'self_learning';

export type StrategyDraft = {
  name: string;
  mode: 'classic' | 'self_learning';
  targetPositionFrom: number;
  targetPositionTo: number;
  explorationPct: number;
  minClicksForLearning: number;
  retestCooldownHours: number;
  retestPercent: number;
  maxRetestPerRun: number;
  biddingMode: 'drr' | 'cpm' | 'roas' | 'hybrid';
  targetAcosPct: number;
  targetCpmRub: number;
  targetRoas: number;
  minOrders: number;
  maxCpcRub: number;
  minBid: number;
  maxBid: number;
  stepUpPct: number;
  stepDownPct: number;
  lookbackDays: number;
  intervalMinutes: number;
  dryRun: boolean;
  isEnabled: boolean;
};

export type StrategyClusterRow = {
  cluster: string;
  status: 'active' | 'excluded' | 'unknown';
  currentBid: number | null;
  avgPos: number | null;
  todaySpend: number;
  todayClicks: number;
  todayOrders: number;
  totalSpend: number;
};

export type StrategyTodaySummary = {
  activeClusters: number;
  adSpendToday: number;
  clicksToday: number;
  ordersToday: number;
};

export type StrategyAutopilotInsights = {
  estimatedSavings24hRub: number;
  avgReward: number | null;
  observedAvgPos: number | null;
  inTargetRatePct: number | null;
};

export const STRATEGY_TEMPLATE_PRESETS: Record<StrategyTemplateKey, {
  label: string;
  description: string;
  values: {
    mode: 'classic' | 'self_learning';
    targetPositionFrom: number;
    targetPositionTo: number;
    explorationPct: number;
    minClicksForLearning: number;
    retestCooldownHours: number;
    retestPercent: number;
    maxRetestPerRun: number;
    targetAcosPct: number;
    minOrders: number;
    maxCpcRub: number;
    minBid: number;
    maxBid: number;
    stepUpPct: number;
    stepDownPct: number;
    lookbackDays: number;
    intervalMinutes: number;
    dryRun: boolean;
    isEnabled: boolean;
    biddingMode?: 'drr' | 'cpm' | 'roas' | 'hybrid';
    targetCpmRub?: number;
    targetRoas?: number;
  };
}> = {
  balanced: {
    label: 'Баланс ДРР',
    description: 'Стабильный режим для большинства SKU: умеренный рост и осторожное снижение.',
    values: {
      mode: 'classic',
      targetPositionFrom: 1,
      targetPositionTo: 2,
      explorationPct: 20,
      minClicksForLearning: 15,
      retestCooldownHours: 24,
      retestPercent: 10,
      maxRetestPerRun: 2,
      targetAcosPct: 25,
      minOrders: 2,
      maxCpcRub: 80,
      minBid: 100,
      maxBid: 5000,
      stepUpPct: 10,
      stepDownPct: 10,
      lookbackDays: 7,
      intervalMinutes: 60,
      dryRun: true,
      isEnabled: true,
    },
  },
  margin_guard: {
    label: 'Защита маржи',
    description: 'Жёстче ограничивает CPC и ДРР, быстро режет ставки при риске.',
    values: {
      mode: 'classic',
      targetPositionFrom: 1,
      targetPositionTo: 2,
      explorationPct: 15,
      minClicksForLearning: 18,
      retestCooldownHours: 36,
      retestPercent: 6,
      maxRetestPerRun: 1,
      targetAcosPct: 18,
      minOrders: 3,
      maxCpcRub: 55,
      minBid: 80,
      maxBid: 3200,
      stepUpPct: 4,
      stepDownPct: 18,
      lookbackDays: 7,
      intervalMinutes: 40,
      dryRun: true,
      isEnabled: true,
    },
  },
  growth: {
    label: 'Рост трафика',
    description: 'Агрессивнее повышает ставки при хорошей динамике, мягче режет вниз.',
    values: {
      mode: 'classic',
      targetPositionFrom: 1,
      targetPositionTo: 2,
      explorationPct: 25,
      minClicksForLearning: 12,
      retestCooldownHours: 24,
      retestPercent: 10,
      maxRetestPerRun: 3,
      targetAcosPct: 32,
      minOrders: 2,
      maxCpcRub: 110,
      minBid: 120,
      maxBid: 6500,
      stepUpPct: 16,
      stepDownPct: 8,
      lookbackDays: 5,
      intervalMinutes: 30,
      dryRun: true,
      isEnabled: true,
    },
  },
  launch: {
    label: 'Запуск новинки',
    description: 'Для разгона нового SKU: короткое окно анализа и частый пересчёт.',
    values: {
      mode: 'classic',
      targetPositionFrom: 1,
      targetPositionTo: 2,
      explorationPct: 30,
      minClicksForLearning: 8,
      retestCooldownHours: 12,
      retestPercent: 12,
      maxRetestPerRun: 3,
      targetAcosPct: 40,
      minOrders: 1,
      maxCpcRub: 140,
      minBid: 130,
      maxBid: 7000,
      stepUpPct: 18,
      stepDownPct: 6,
      lookbackDays: 3,
      intervalMinutes: 20,
      dryRun: true,
      isEnabled: true,
    },
  },
  self_learning: {
    label: 'Self-learning автопилот',
    description: 'Сам выбирает наиболее выгодный коридор позиций и удешевляет кластеры без потери выдачи.',
    values: {
      mode: 'self_learning',
      targetPositionFrom: 1,
      targetPositionTo: 2,
      explorationPct: 22,
      minClicksForLearning: 15,
      retestCooldownHours: 24,
      retestPercent: 15,
      maxRetestPerRun: 3,
      targetAcosPct: 28,
      minOrders: 1,
      maxCpcRub: 95,
      minBid: 100,
      maxBid: 6500,
      stepUpPct: 14,
      stepDownPct: 11,
      lookbackDays: 5,
      intervalMinutes: 30,
      dryRun: true,
      isEnabled: true,
    },
  },
};

function toSafeNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeRunEstimatedSavingsRub(summary: Record<string, unknown>) {
  const raw = Math.max(0, toSafeNumber(summary.estimatedSavingsRub, 0));
  if (raw <= 0) {
    return 0;
  }
  if (String(summary.estimatedSavingsModel ?? '') === 'interval_window') {
    return raw;
  }
  const lookbackDays = Math.max(
    0,
    toSafeNumber(summary.estimatedSavingsLookbackDays ?? summary.lookbackDays, 0),
  );
  const intervalMinutes = Math.max(
    0,
    toSafeNumber(summary.estimatedSavingsIntervalMinutes ?? summary.intervalMinutes, 0),
  );
  if (lookbackDays <= 0 || intervalMinutes <= 0) {
    return raw;
  }
  const lookbackMinutes = lookbackDays * 24 * 60;
  const intervalShare = Math.min(1, intervalMinutes / lookbackMinutes);
  return Math.round(raw * intervalShare * 100) / 100;
}

function strategyGuardrailLabel(value: unknown) {
  const code = String(value ?? '').trim();
  if (!code) return 'OK';
  if (code === 'drr_above_target') return 'ДРР выше цели';
  if (code === 'cpc_above_max') return 'CPC выше лимита';
  if (code === 'orders_below_min') return 'Заказов меньше минимума';
  return code;
}

function strategyGuardrailToneClass(value: unknown) {
  const code = String(value ?? '').trim();
  if (!code) return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-900/20 dark:text-emerald-300';
  if (code === 'drr_above_target') return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800/40 dark:bg-rose-900/20 dark:text-rose-300';
  if (code === 'cpc_above_max') return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-300';
  if (code === 'orders_below_min') return 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800/40 dark:bg-violet-900/20 dark:text-violet-300';
  return 'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300';
}

const DEFAULT_DRAFT: StrategyDraft = {
  name: '',
  mode: 'self_learning',
  targetPositionFrom: 1,
  targetPositionTo: 2,
  explorationPct: 22,
  minClicksForLearning: 15,
  retestCooldownHours: 24,
  retestPercent: 15,
  maxRetestPerRun: 3,
  biddingMode: 'drr',
  targetAcosPct: 25,
  targetCpmRub: 200,
  targetRoas: 4,
  minOrders: 2,
  maxCpcRub: 80,
  minBid: 100,
  maxBid: 5000,
  stepUpPct: 10,
  stepDownPct: 10,
  lookbackDays: 7,
  intervalMinutes: 60,
  dryRun: true,
  isEnabled: true,
};

export function StrategiesTab() {
  const {
    tenantId,
    fromParam,
    toParam,
    selectedCluster,
    effectiveAdvertId,
    bidsQuery,
    clusterMapQuery,
    strategiesQuery,
    strategyById,
    strategyClusterRows,
    strategyTodayKey,
    strategyTodaySummary,
    strategyAutopilotInsights,
    clusterToggleMutation,
    setMapActionMessage,
  } = useBidWorkspace();

  const clustersSyncing = bidsQuery.isFetching || clusterMapQuery.isFetching;

  const queryClient = useQueryClient();

  const [templateKey, setTemplateKey] = useState<StrategyTemplateKey>('self_learning');
  const [draft, setDraft] = useState<StrategyDraft>(DEFAULT_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);

  const editingStrategy = editingId ? (strategyById.get(editingId) ?? null) : null;
  const selectedTemplate = STRATEGY_TEMPLATE_PRESETS[templateKey];

  const strategyMutation = useMutation<unknown, Error, { action: 'save' | 'delete' | 'run'; payload: Record<string, unknown> }>({
    mutationFn: async ({ action, payload }) => {
      const response = await fetch(`/api/views/advertising/workspace/strategies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...payload }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof body?.error === 'string' ? body.error : 'Ошибка операции по стратегии');
      }
      return body;
    },
    onSuccess: (_result, variables) => {
      if (variables.action === 'save') {
        setEditingId(null);
      }
      void queryClient.invalidateQueries({ queryKey: ['adv-workspace-strategies', tenantId] });
      if (variables.action === 'run') {
        void queryClient.invalidateQueries({ queryKey: ['adv-workspace-bids', tenantId, fromParam, toParam] });
        void queryClient.invalidateQueries({ queryKey: ['adv-workspace-map', tenantId, fromParam, toParam] });
        void queryClient.invalidateQueries({ queryKey: ['adv-workspace-control', tenantId] });
        void queryClient.invalidateQueries({ queryKey: ['adv-workspace-clusters', tenantId, fromParam, toParam] });
      }
    },
  });

  const applyTemplate = () => {
    const template = STRATEGY_TEMPLATE_PRESETS[templateKey];
    setEditingId(null);
    setDraft((prev) => ({ ...prev, ...template.values, name: prev.name || template.label }));
  };

  const saveFromTemplate = () => {
    const targetAdvertId = effectiveAdvertId;
    const targetNmId = selectedCluster?.nmId ?? null;
    if (!targetAdvertId || !targetNmId) return;
    const template = STRATEGY_TEMPLATE_PRESETS[templateKey];
    void strategyMutation.mutateAsync({
      action: 'save',
      payload: {
        strategy: {
          ...template.values,
          name: `${template.label} ${targetAdvertId}/${targetNmId}`,
          advertId: targetAdvertId,
          nmId: targetNmId,
        },
      },
    });
  };

  const submitDraft = () => {
    const targetAdvertId = editingStrategy?.advertId ?? effectiveAdvertId;
    const targetNmId = editingStrategy?.nmId ?? selectedCluster?.nmId ?? null;
    if (!targetAdvertId || !targetNmId) return;
    void strategyMutation.mutateAsync({
      action: 'save',
      payload: {
        strategy: {
          ...draft,
          id: editingId ?? undefined,
          name: draft.name || `Автобидер ${targetAdvertId}/${targetNmId}`,
          advertId: targetAdvertId,
          nmId: targetNmId,
        },
      },
    });
  };

  const resetDraft = () => {
    setEditingId(null);
    setDraft(DEFAULT_DRAFT);
  };

  const editStrategy = (strategy: StrategyRecord) => {
    setEditingId(strategy.id);
    setDraft({
      name: strategy.name,
      mode: strategy.mode,
      targetPositionFrom: strategy.targetPositionFrom,
      targetPositionTo: strategy.targetPositionTo,
      explorationPct: strategy.explorationPct,
      minClicksForLearning: strategy.minClicksForLearning,
      retestCooldownHours: strategy.retestCooldownHours,
      retestPercent: strategy.retestPercent,
      maxRetestPerRun: strategy.maxRetestPerRun,
      biddingMode: strategy.biddingMode ?? 'drr',
      targetAcosPct: strategy.targetAcosPct,
      targetCpmRub: strategy.targetCpmRub ?? 200,
      targetRoas: strategy.targetRoas ?? 4,
      minOrders: strategy.minOrders,
      maxCpcRub: strategy.maxCpcRub,
      minBid: strategy.minBid,
      maxBid: strategy.maxBid,
      stepUpPct: strategy.stepUpPct,
      stepDownPct: strategy.stepDownPct,
      lookbackDays: strategy.lookbackDays,
      intervalMinutes: strategy.intervalMinutes,
      dryRun: strategy.dryRun,
      isEnabled: strategy.isEnabled,
    });
  };

  const toggleClusterFromRow = (cluster: string, currentStatus: 'active' | 'excluded' | 'unknown') => {
    if (!effectiveAdvertId || !selectedCluster) return;
    setMapActionMessage(null);
    void clusterToggleMutation.mutateAsync({
      advertId: effectiveAdvertId,
      nmId: selectedCluster.nmId,
      cluster,
      mode: currentStatus === 'excluded' ? 'include' : 'exclude',
    });
  };

  const clusterToggleDisabled = clusterToggleMutation.isPending || !effectiveAdvertId || !selectedCluster;
  const templateSubmitDisabled = strategyMutation.isPending || !selectedCluster || !effectiveAdvertId;
  const draftSubmitDisabled = strategyMutation.isPending || (!editingStrategy && (!selectedCluster || !effectiveAdvertId));
  const selectedClusterLabel = selectedCluster && effectiveAdvertId
    ? `кампания ${effectiveAdvertId}, nmID ${selectedCluster.nmId}`
    : 'выбери кластер и кампанию';

  const strategies = strategiesQuery.data?.strategies ?? [];
  const runs = strategiesQuery.data?.runs ?? [];
  const recentChanges = strategiesQuery.data?.recentChanges ?? [];
  const generatedAt = strategiesQuery.data?.generatedAt ?? null;

  return (
    <section className="space-y-4">
      <div className={panelClass}>
        <div className="mb-3 flex items-center gap-2">
          <Bot className="h-5 w-5 text-indigo-600" />
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Автостратегии-бидер</h2>
        </div>

        <div className="mb-3 rounded-xl border border-indigo-200 bg-indigo-50 p-3 dark:border-indigo-800/40 dark:bg-indigo-900/20">
          <p className="text-sm font-semibold text-indigo-900 dark:text-indigo-200">Мастер «Создать стратегию из шаблона»</p>
          <p className="mt-1 text-xs text-indigo-800">{selectedTemplate.description}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select
              value={templateKey}
              onChange={(event) => setTemplateKey(event.target.value as StrategyTemplateKey)}
              className="rounded-xl border border-indigo-200 bg-white px-3 py-2 text-sm text-slate-800"
            >
              {Object.entries(STRATEGY_TEMPLATE_PRESETS).map(([key, preset]) => (
                <option key={key} value={key}>{preset.label}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={applyTemplate}
              className="rounded-xl border border-indigo-300 bg-white px-3 py-2 text-sm font-semibold text-indigo-700"
            >
              Заполнить форму по шаблону
            </button>
            <button
              type="button"
              onClick={saveFromTemplate}
              disabled={templateSubmitDisabled}
              className="rounded-xl bg-indigo-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Создать стратегию из шаблона
            </button>
            <span className="text-xs text-indigo-800">
              Цель: {selectedClusterLabel}
            </span>
          </div>
        </div>

        <div className="mb-3 grid gap-2 md:grid-cols-5">
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Оценка экономии / 24ч</p>
            <p className="mt-1 text-lg font-bold text-emerald-700">{formatMoney(strategyAutopilotInsights.estimatedSavings24hRub)}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Расход сегодня</p>
            <p className="mt-1 text-lg font-bold text-slate-900">{formatMoney(strategyTodaySummary.adSpendToday)}</p>
            <p className="mt-1 text-[11px] text-slate-500">
              клики {formatNumber(strategyTodaySummary.clicksToday)} · заказы {formatNumber(strategyTodaySummary.ordersToday)}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Средний reward</p>
            <p className="mt-1 text-lg font-bold text-slate-900">{formatDecimal(strategyAutopilotInsights.avgReward, 3)}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Средняя позиция</p>
            <p className="mt-1 text-lg font-bold text-slate-900">{formatDecimal(strategyAutopilotInsights.observedAvgPos, 2)}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">В целевом коридоре</p>
            <p className="mt-1 text-lg font-bold text-indigo-700">{formatPercent(strategyAutopilotInsights.inTargetRatePct, 1)}</p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <label className="text-xs font-semibold text-slate-500">Название</label>
            <input
              type="text"
              value={draft.name}
              onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              placeholder="Например: Бидер Кампания 123"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500">Режим ставок</label>
            <select
              value={draft.biddingMode}
              onChange={(event) => setDraft((prev) => ({ ...prev, biddingMode: event.target.value as StrategyDraft['biddingMode'] }))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="drr">ДРР (spend/revenue)</option>
              <option value="cpm">CPM (spend/1000 показов)</option>
              <option value="roas">ROAS (revenue/spend)</option>
              <option value="hybrid">Hybrid (макс. давления)</option>
            </select>
            <p className="mt-1 text-[11px] text-slate-500">
              {draft.biddingMode === 'drr' && 'Legacy-режим: регулируется доля рекламных расходов.'}
              {draft.biddingMode === 'cpm' && 'Таргетируется цена 1000 показов.'}
              {draft.biddingMode === 'roas' && 'Таргетируется возврат на ₽ расхода (revenue/spend).'}
              {draft.biddingMode === 'hybrid' && 'Берётся максимум давлений DRR/CPM/ROAS.'}
            </p>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500">Целевая ДРР, %</label>
            <input
              type="number"
              value={draft.targetAcosPct}
              onChange={(event) => setDraft((prev) => ({ ...prev, targetAcosPct: Number(event.target.value) }))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              disabled={draft.biddingMode === 'cpm' || draft.biddingMode === 'roas'}
            />
          </div>
          {(draft.biddingMode === 'cpm' || draft.biddingMode === 'hybrid') && (
            <div>
              <label className="text-xs font-semibold text-slate-500">Целевая CPM, ₽ / 1000 показов</label>
              <input
                type="number"
                value={draft.targetCpmRub}
                onChange={(event) => setDraft((prev) => ({ ...prev, targetCpmRub: Number(event.target.value) }))}
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
          )}
          {(draft.biddingMode === 'roas' || draft.biddingMode === 'hybrid') && (
            <div>
              <label className="text-xs font-semibold text-slate-500">Целевой ROAS</label>
              <input
                type="number"
                step="0.1"
                value={draft.targetRoas}
                onChange={(event) => setDraft((prev) => ({ ...prev, targetRoas: Number(event.target.value) }))}
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
          )}
          <div>
            <label className="text-xs font-semibold text-slate-500">Мин. заказов</label>
            <input
              type="number"
              value={draft.minOrders}
              onChange={(event) => setDraft((prev) => ({ ...prev, minOrders: Number(event.target.value) }))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500">Макс. CPC, ₽</label>
            <input
              type="number"
              value={draft.maxCpcRub}
              onChange={(event) => setDraft((prev) => ({ ...prev, maxCpcRub: Number(event.target.value) }))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500">Шаг вверх/вниз, %</label>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <input
                type="number"
                value={draft.stepUpPct}
                onChange={(event) => setDraft((prev) => ({ ...prev, stepUpPct: Number(event.target.value) }))}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
              <input
                type="number"
                value={draft.stepDownPct}
                onChange={(event) => setDraft((prev) => ({ ...prev, stepDownPct: Number(event.target.value) }))}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500">Расписание, минут</label>
            <input
              type="number"
              value={draft.intervalMinutes}
              onChange={(event) => setDraft((prev) => ({ ...prev, intervalMinutes: Number(event.target.value) }))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <div>
            <label className="text-xs font-semibold text-slate-500">Мин. ставка</label>
            <input
              type="number"
              value={draft.minBid}
              onChange={(event) => setDraft((prev) => ({ ...prev, minBid: Number(event.target.value) }))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500">Макс. ставка</label>
            <input
              type="number"
              value={draft.maxBid}
              onChange={(event) => setDraft((prev) => ({ ...prev, maxBid: Number(event.target.value) }))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500">Окно анализа, дней</label>
            <input
              type="number"
              value={draft.lookbackDays}
              onChange={(event) => setDraft((prev) => ({ ...prev, lookbackDays: Number(event.target.value) }))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex items-end gap-3">
            <label className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={draft.dryRun}
                onChange={(event) => setDraft((prev) => ({ ...prev, dryRun: event.target.checked }))}
              />
              Только симуляция
            </label>
            <label className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={draft.isEnabled}
                onChange={(event) => setDraft((prev) => ({ ...prev, isEnabled: event.target.checked }))}
              />
              Включена
            </label>
          </div>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <div>
            <label className="text-xs font-semibold text-slate-500">Режим автопилота</label>
            <select
              value={draft.mode}
              onChange={(event) => setDraft((prev) => ({ ...prev, mode: event.target.value as 'classic' | 'self_learning' }))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="self_learning">Self-learning (автообучение)</option>
              <option value="classic">Классический (ДРР/CPC)</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500">Целевая позиция от</label>
            <input
              type="number"
              value={draft.targetPositionFrom}
              min={1}
              onChange={(event) => setDraft((prev) => ({ ...prev, targetPositionFrom: Number(event.target.value) }))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500">Целевая позиция до</label>
            <input
              type="number"
              value={draft.targetPositionTo}
              min={draft.targetPositionFrom}
              onChange={(event) => setDraft((prev) => ({ ...prev, targetPositionTo: Number(event.target.value) }))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500">Exploration, %</label>
            <input
              type="number"
              value={draft.explorationPct}
              min={0}
              max={100}
              onChange={(event) => setDraft((prev) => ({ ...prev, explorationPct: Number(event.target.value) }))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500">Мин. кликов для решения</label>
            <input
              type="number"
              value={draft.minClicksForLearning}
              min={1}
              onChange={(event) => setDraft((prev) => ({ ...prev, minClicksForLearning: Number(event.target.value) }))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500">Ретест через, часов</label>
            <input
              type="number"
              value={draft.retestCooldownHours}
              min={1}
              onChange={(event) => setDraft((prev) => ({ ...prev, retestCooldownHours: Number(event.target.value) }))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500">Ретест кластеров, %</label>
            <input
              type="number"
              value={draft.retestPercent}
              min={0}
              max={100}
              onChange={(event) => setDraft((prev) => ({ ...prev, retestPercent: Number(event.target.value) }))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500">Макс. ретестов за запуск</label>
            <input
              type="number"
              value={draft.maxRetestPerRun}
              min={0}
              onChange={(event) => setDraft((prev) => ({ ...prev, maxRetestPerRun: Number(event.target.value) }))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="mt-4">
          <button
            type="button"
            onClick={submitDraft}
            disabled={draftSubmitDisabled}
            className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {editingId ? 'Обновить стратегию' : 'Сохранить стратегию'}
          </button>
          <button
            type="button"
            onClick={resetDraft}
            className="ml-2 rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700"
          >
            Сбросить форму
          </button>
          {strategyMutation.error ? <span className="ml-3 text-sm text-rose-600">{strategyMutation.error.message}</span> : null}
          {editingStrategy ? (
            <span className="ml-3 text-xs text-slate-500">Редактируется #{editingStrategy.advertId}/{editingStrategy.nmId}</span>
          ) : null}
        </div>
      </div>

      <div className={panelClass}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-slate-700">Кластеры в показах (быстрое управление)</p>
            <p className="text-xs text-slate-500">
              Сегодня (МСК): {strategyTodayKey} · активных {formatNumber(strategyTodaySummary.activeClusters)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              void bidsQuery.refetch();
              void clusterMapQuery.refetch();
            }}
            disabled={clustersSyncing}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700 disabled:opacity-50"
          >
            <RefreshCcw className={`h-3.5 w-3.5 ${clustersSyncing ? 'animate-spin' : ''}`} />
            Обновить кластеры
          </button>
        </div>

        {clusterMapQuery.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Загружаем список кластеров...
          </div>
        ) : clusterMapQuery.error ? (
          <p className="text-sm text-rose-600">{clusterMapQuery.error.message}</p>
        ) : strategyClusterRows.length === 0 ? (
          <p className="text-sm text-slate-500">Нет кластеров для выбранной кампании и периода.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="text-left uppercase tracking-wider text-slate-500">
                  <th scope="col" className="px-2 py-2">Кластер</th>
                  <th scope="col" className="px-2 py-2">Статус</th>
                  <th scope="col" className="px-2 py-2">Ставка</th>
                  <th scope="col" className="px-2 py-2">Сегодня расход</th>
                  <th scope="col" className="px-2 py-2">Сегодня клики/заказы</th>
                  <th scope="col" className="px-2 py-2">Позиция</th>
                  <th scope="col" className="px-2 py-2">Расход (окно)</th>
                  <th scope="col" className="px-2 py-2">Действие</th>
                </tr>
              </thead>
              <tbody>
                {strategyClusterRows.slice(0, 140).map((row) => (
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
                    <td className="px-2 py-2">{formatMoneyPrecise(row.currentBid, 0)}</td>
                    <td className="px-2 py-2">{formatMoney(row.todaySpend)}</td>
                    <td className="px-2 py-2">{formatNumber(row.todayClicks)} / {formatNumber(row.todayOrders)}</td>
                    <td className="px-2 py-2">{formatDecimal(row.avgPos, 2)}</td>
                    <td className="px-2 py-2">{formatMoney(row.totalSpend)}</td>
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        disabled={clusterToggleDisabled}
                        onClick={() => toggleClusterFromRow(row.cluster, row.status)}
                        className={`rounded-lg px-2 py-1 text-[11px] font-semibold ${
                          row.status === 'excluded'
                            ? 'border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-900/20 dark:text-emerald-300'
                            : 'border border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800/40 dark:bg-rose-900/20 dark:text-rose-300'
                        } disabled:opacity-50`}
                      >
                        {row.status === 'excluded' ? 'Включить' : 'Вырубить'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className={panelClass}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-slate-700">Активные стратегии</p>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">
              Обновлено: {formatDateTime(generatedAt)}
            </span>
            <button
              type="button"
              onClick={() => { void strategiesQuery.refetch(); }}
              disabled={strategiesQuery.isFetching}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700 disabled:opacity-50"
            >
              <RefreshCcw className={`h-3.5 w-3.5 ${strategiesQuery.isFetching ? 'animate-spin' : ''}`} />
              Обновить
            </button>
          </div>
        </div>
        {strategiesQuery.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Загружаем стратегии...
          </div>
        ) : strategiesQuery.error ? (
          <p className="text-sm text-rose-600">{strategiesQuery.error.message}</p>
        ) : strategies.length === 0 ? (
          <p className="text-sm text-slate-500">Пока нет сохраненных стратегий.</p>
        ) : (
          <div className="space-y-3">
            {strategies.map((strategy) => (
              <article key={strategy.id} className="rounded-xl border border-slate-200 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold text-slate-900 dark:text-slate-100">{strategy.name}</p>
                    <p className="text-xs text-slate-500">
                      Кампания {strategy.advertId} · nmID {strategy.nmId} · интервал {strategy.intervalMinutes} мин · следующий запуск {formatDateTime(strategy.nextRunAt)}
                    </p>
                    <p className="text-xs text-slate-500">
                      Режим {strategy.mode === 'self_learning' ? 'Self-learning' : 'Классический'} · позиция {strategy.targetPositionFrom}-{strategy.targetPositionTo}
                      {strategy.mode === 'self_learning' ? ` · exploration ${formatPercent(strategy.explorationPct, 0)}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                      strategy.isEnabled ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400'
                    }`}>
                      {strategy.isEnabled ? 'включена' : 'на паузе'}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                      strategy.dryRun ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400'
                    }`}>
                      {strategy.dryRun ? 'симуляция' : 'боевой режим'}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-400">
                      {strategyStateLabel(strategy.lastStatus)}
                    </span>
                  </div>
                </div>
                <p className="mt-2 text-xs text-slate-600">
                  Целевая ДРР {formatPercent(strategy.targetAcosPct, 1)} · мин. заказов {formatNumber(strategy.minOrders)} · макс. CPC {formatMoneyPrecise(strategy.maxCpcRub, 2)}
                </p>
                {strategy.mode === 'self_learning' ? (
                  <p className="mt-1 text-xs text-slate-600">
                    Ретест: {formatDecimal(strategy.retestPercent, 0)}% каждые {formatNumber(strategy.retestCooldownHours)} ч. (до {formatNumber(strategy.maxRetestPerRun)} кластеров/запуск)
                  </p>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => { void strategyMutation.mutateAsync({ action: 'run', payload: { strategyId: strategy.id } }); }}
                    className="rounded-lg border border-slate-200 bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700"
                  >
                    Запустить сейчас
                  </button>
                  <button
                    type="button"
                    onClick={() => editStrategy(strategy)}
                    className="rounded-lg border border-slate-200 bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700"
                  >
                    Изменить
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void strategyMutation.mutateAsync({
                        action: 'save',
                        payload: { strategy: { ...strategy, isEnabled: !strategy.isEnabled } },
                      });
                    }}
                    className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-300"
                  >
                    {strategy.isEnabled ? 'Поставить на паузу' : 'Включить'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { void strategyMutation.mutateAsync({ action: 'delete', payload: { strategyId: strategy.id } }); }}
                    className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700 dark:border-rose-800/40 dark:bg-rose-900/20 dark:text-rose-300"
                  >
                    Удалить
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <div className={panelClass}>
        <p className="mb-2 text-sm font-semibold text-slate-700">Журнал автоизменений</p>
        <p className="mb-2 text-xs text-slate-500">Формат метрик: сегодня / окно (окно = период стратегии).</p>
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="text-left uppercase tracking-wider text-slate-500">
                <th scope="col" className="px-2 py-2">Время</th>
                <th scope="col" className="px-2 py-2">Кластер</th>
                <th scope="col" className="px-2 py-2">Ставка</th>
                <th scope="col" className="px-2 py-2">Δ ставки, %</th>
                <th scope="col" className="px-2 py-2">Позиция</th>
                <th scope="col" className="px-2 py-2">Цель</th>
                <th scope="col" className="px-2 py-2">Клики (сегодня/окно)</th>
                <th scope="col" className="px-2 py-2">Заказы (сегодня/окно)</th>
                <th scope="col" className="px-2 py-2">ДРР (сегодня/окно)</th>
                <th scope="col" className="px-2 py-2">Guardrail</th>
                <th scope="col" className="px-2 py-2">Экономия</th>
                <th scope="col" className="px-2 py-2">Статус</th>
                <th scope="col" className="px-2 py-2">Причина</th>
              </tr>
            </thead>
            <tbody>
              {recentChanges.slice(0, 40).map((item) => (
                <tr key={item.id} className="border-t border-slate-100">
                  {(() => {
                    const metrics = toSummaryObject(item.metrics);
                    const strategy = strategyById.get(item.strategyId);
                    const avgPos = toNullableNumber(metrics.avgPos);
                    const targetFrom = toNullableNumber(metrics.targetPositionFrom);
                    const targetTo = toNullableNumber(metrics.targetPositionTo);
                    const targetDrrPct = strategy?.targetAcosPct ?? null;
                    let bidDeltaPct = toNullableNumber(metrics.bidDeltaPct);
                    if (
                      bidDeltaPct === null
                      && item.previousBid !== null
                      && item.nextBid !== null
                      && item.previousBid > 0
                    ) {
                      bidDeltaPct = ((item.nextBid - item.previousBid) / item.previousBid) * 100;
                    }
                    const clicksToday = toNullableNumber(metrics.clicksToday);
                    const clicksWindow = toNullableNumber(metrics.clicksWindow ?? metrics.clicks);
                    const ordersToday = toNullableNumber(metrics.ordersToday);
                    const ordersWindow = toNullableNumber(metrics.ordersWindow ?? metrics.orders);
                    const drrTodayPct = toNullableNumber(metrics.drrTodayPct);
                    const drrWindowPct = toNullableNumber(metrics.drrWindowPct ?? metrics.acosProxyPct);
                    const estimatedSavingsRub = normalizeRunEstimatedSavingsRub({
                      ...metrics,
                      estimatedSavingsLookbackDays: metrics.estimatedSavingsLookbackDays ?? strategy?.lookbackDays,
                      estimatedSavingsIntervalMinutes: metrics.estimatedSavingsIntervalMinutes ?? strategy?.intervalMinutes,
                    });
                    return (
                      <>
                        <td className="px-2 py-2">{formatDateTime(item.createdAt)}</td>
                        <td className="px-2 py-2">{item.cluster}</td>
                        <td className="px-2 py-2">{formatMoneyPrecise(item.previousBid, 0)} → {formatMoneyPrecise(item.nextBid, 0)}</td>
                        <td className={`px-2 py-2 ${bidDeltaPct !== null && bidDeltaPct > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                          {formatPercent(bidDeltaPct, 2)}
                        </td>
                        <td className="px-2 py-2">{formatDecimal(avgPos, 2)}</td>
                        <td className="px-2 py-2">
                          {targetFrom !== null && targetTo !== null ? `${formatDecimal(targetFrom, 0)}-${formatDecimal(targetTo, 0)}` : '—'}
                        </td>
                        <td className="px-2 py-2">
                          {`${formatDecimal(clicksToday, 0)} / ${formatDecimal(clicksWindow, 0)}`}
                        </td>
                        <td className="px-2 py-2">
                          {`${formatDecimal(ordersToday, 0)} / ${formatDecimal(ordersWindow, 0)}`}
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex flex-col gap-1">
                            <span className={`inline-flex w-fit rounded-full border px-2 py-0.5 text-[11px] font-semibold ${drrToneClass(drrTodayPct, targetDrrPct)}`}>
                              сегодня: {formatPercent(drrTodayPct, 1)}
                            </span>
                            <span className={`inline-flex w-fit rounded-full border px-2 py-0.5 text-[11px] font-semibold ${drrToneClass(drrWindowPct, targetDrrPct)}`}>
                              окно: {formatPercent(drrWindowPct, 1)}
                            </span>
                          </div>
                        </td>
                        <td className="px-2 py-2">
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${strategyGuardrailToneClass(metrics.guardrailCode)}`}>
                            {strategyGuardrailLabel(metrics.guardrailCode)}
                          </span>
                        </td>
                        <td className="px-2 py-2">{formatMoney(estimatedSavingsRub)}</td>
                        <td className="px-2 py-2">{bidChangeStatusLabel(item.status)}</td>
                        <td className="px-2 py-2">{strategyReasonLabel(item.reason)}</td>
                      </>
                    );
                  })()}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className={panelClass}>
        <p className="mb-2 text-sm font-semibold text-slate-700">История запусков стратегий</p>
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="text-left uppercase tracking-wider text-slate-500">
                <th scope="col" className="px-2 py-2">Старт</th>
                <th scope="col" className="px-2 py-2">Стратегия</th>
                <th scope="col" className="px-2 py-2">Источник</th>
                <th scope="col" className="px-2 py-2">Статус</th>
                <th scope="col" className="px-2 py-2">Позиция</th>
                <th scope="col" className="px-2 py-2">Средн. позиция</th>
                <th scope="col" className="px-2 py-2">Экономия</th>
                <th scope="col" className="px-2 py-2">Финиш</th>
              </tr>
            </thead>
            <tbody>
              {runs.slice(0, 30).map((run) => (
                <tr key={run.id} className="border-t border-slate-100">
                  {(() => {
                    const summary = toSummaryObject(run.summary);
                    const targetFrom = toNullableNumber(summary.targetPositionFrom);
                    const targetTo = toNullableNumber(summary.targetPositionTo);
                    const observedPos = toNullableNumber(summary.observedAvgPos);
                    const estimatedSavingsRub = normalizeRunEstimatedSavingsRub(summary);
                    return (
                      <>
                        <td className="px-2 py-2">{formatDateTime(run.startedAt)}</td>
                        <td className="px-2 py-2">{strategyById.get(run.strategyId)?.name ?? run.strategyId}</td>
                        <td className="px-2 py-2">{run.triggerSource === 'manual' ? 'Ручной' : 'Плановый'}</td>
                        <td className="px-2 py-2">{strategyStateLabel(run.status)}</td>
                        <td className="px-2 py-2">
                          {targetFrom !== null && targetTo !== null ? `${formatDecimal(targetFrom, 0)}-${formatDecimal(targetTo, 0)}` : '—'}
                        </td>
                        <td className="px-2 py-2">{formatDecimal(observedPos, 2)}</td>
                        <td className="px-2 py-2">{formatMoney(estimatedSavingsRub)}</td>
                        <td className="px-2 py-2">{formatDateTime(run.finishedAt)}</td>
                      </>
                    );
                  })()}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
