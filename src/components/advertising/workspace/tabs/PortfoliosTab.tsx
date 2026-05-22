'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BriefcaseBusiness, Loader2 } from 'lucide-react';
import {
  formatDateTime,
  formatMoneyPrecise,
  formatNumber,
  formatPercent,
} from '../../_shared/format';
import { panelClass } from '../../_shared/ui';
import {
  bidChangeStatusLabel,
  parseIntList,
  strategyReasonLabel,
  strategyStateLabel,
} from '../strategy-helpers';

export type PortfolioRecord = {
  id: string;
  name: string;
  brandFilter: string | null;
  nmIds: number[];
  isEnabled: boolean;
  dryRun: boolean;
  targetAcosPct: number;
  minOrders: number;
  maxCpcRub: number;
  dailyBudgetRub: number;
  minBid: number;
  maxBid: number;
  stepUpPct: number;
  stepDownPct: number;
  lookbackDays: number;
  intervalMinutes: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastStatus: string | null;
};

export type PortfolioRecentChange = {
  id: string;
  cluster: string;
  previousBid: number | null;
  nextBid: number | null;
  status: string;
  reason: string | null;
  createdAt: string;
};

export type PortfoliosResponse = {
  portfolios: PortfolioRecord[];
  recentChanges: PortfolioRecentChange[];
};

export type PortfolioDraft = {
  name: string;
  brandFilter: string;
  nmIds: string;
  targetAcosPct: number;
  minOrders: number;
  maxCpcRub: number;
  dailyBudgetRub: number;
  minBid: number;
  maxBid: number;
  stepUpPct: number;
  stepDownPct: number;
  lookbackDays: number;
  intervalMinutes: number;
  dryRun: boolean;
  isEnabled: boolean;
};

export type PortfolioEnabledFilter = 'all' | 'enabled' | 'paused';
export type PortfolioModeFilter = 'all' | 'dry' | 'live';
export type PortfolioGroupBy = 'none' | 'status' | 'mode';

const PORTFOLIO_PRESETS: Array<{
  key: string;
  label: string;
  hint: string;
  values: {
    targetAcosPct: number;
    minOrders: number;
    maxCpcRub: number;
    dailyBudgetRub: number;
    minBid: number;
    maxBid: number;
    stepUpPct: number;
    stepDownPct: number;
    lookbackDays: number;
    intervalMinutes: number;
  };
}> = [
  {
    key: 'portfolio_balanced',
    label: 'Баланс',
    hint: 'Универсальный режим портфеля',
    values: {
      targetAcosPct: 25,
      minOrders: 2,
      maxCpcRub: 80,
      dailyBudgetRub: 10000,
      minBid: 100,
      maxBid: 5000,
      stepUpPct: 10,
      stepDownPct: 10,
      lookbackDays: 7,
      intervalMinutes: 60,
    },
  },
  {
    key: 'portfolio_margin',
    label: 'Маржа',
    hint: 'Приоритет прибыльности над объёмом',
    values: {
      targetAcosPct: 18,
      minOrders: 3,
      maxCpcRub: 60,
      dailyBudgetRub: 8000,
      minBid: 90,
      maxBid: 3800,
      stepUpPct: 5,
      stepDownPct: 16,
      lookbackDays: 10,
      intervalMinutes: 60,
    },
  },
  {
    key: 'portfolio_growth',
    label: 'Рост',
    hint: 'Больше трафика при контроле ДРР',
    values: {
      targetAcosPct: 32,
      minOrders: 1,
      maxCpcRub: 110,
      dailyBudgetRub: 14000,
      minBid: 120,
      maxBid: 6500,
      stepUpPct: 15,
      stepDownPct: 8,
      lookbackDays: 5,
      intervalMinutes: 30,
    },
  },
];

const DEFAULT_DRAFT: PortfolioDraft = {
  name: '',
  brandFilter: '',
  nmIds: '',
  targetAcosPct: 25,
  minOrders: 2,
  maxCpcRub: 80,
  dailyBudgetRub: 10000,
  minBid: 100,
  maxBid: 5000,
  stepUpPct: 10,
  stepDownPct: 10,
  lookbackDays: 7,
  intervalMinutes: 60,
  dryRun: true,
  isEnabled: true,
};

type PortfoliosTabProps = {
  tenantId: string;
  fromParam: string;
  toParam: string;
};

export function PortfoliosTab({ tenantId, fromParam, toParam }: PortfoliosTabProps) {
  const queryClient = useQueryClient();

  const [draft, setDraft] = useState<PortfolioDraft>(DEFAULT_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [enabledFilter, setEnabledFilter] = useState<PortfolioEnabledFilter>('all');
  const [modeFilter, setModeFilter] = useState<PortfolioModeFilter>('all');
  const [groupBy, setGroupBy] = useState<PortfolioGroupBy>('status');

  const portfoliosQuery = useQuery<PortfoliosResponse | null, Error>({
    queryKey: ['adv-workspace-portfolios', tenantId],
    queryFn: async () => {
      const response = await fetch(`/api/views/advertising/workspace/portfolios`, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('Не удалось загрузить портфели');
      }
      return response.json();
    },
    enabled: Boolean(tenantId),
  });

  const mutation = useMutation<unknown, Error, { action: 'save' | 'delete' | 'run'; payload: Record<string, unknown> }>({
    mutationFn: async ({ action, payload }) => {
      const response = await fetch(`/api/views/advertising/workspace/portfolios`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...payload }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof body?.error === 'string' ? body.error : 'Ошибка операции по портфелю');
      }
      return body;
    },
    onSuccess: (_result, variables) => {
      if (variables.action === 'save') {
        setEditingId(null);
      }
      void queryClient.invalidateQueries({ queryKey: ['adv-workspace-portfolios', tenantId] });
      void queryClient.invalidateQueries({ queryKey: ['adv-workspace-bids', tenantId, fromParam, toParam] });
    },
  });

  const visiblePortfolios = useMemo(() => {
    const rows = portfoliosQuery.data?.portfolios ?? [];
    const normalizedSearch = search.trim().toLocaleLowerCase('ru-RU');
    return rows.filter((portfolio) => {
      if (enabledFilter === 'enabled' && !portfolio.isEnabled) {
        return false;
      }
      if (enabledFilter === 'paused' && portfolio.isEnabled) {
        return false;
      }
      if (modeFilter === 'dry' && !portfolio.dryRun) {
        return false;
      }
      if (modeFilter === 'live' && portfolio.dryRun) {
        return false;
      }
      if (!normalizedSearch) {
        return true;
      }
      const searchable = `${portfolio.name} ${portfolio.brandFilter ?? ''} ${portfolio.nmIds.join(' ')}`.toLocaleLowerCase('ru-RU');
      return searchable.includes(normalizedSearch);
    });
  }, [portfoliosQuery.data?.portfolios, search, enabledFilter, modeFilter]);

  const groupedPortfolios = useMemo(() => {
    if (groupBy === 'none') {
      return [{ key: 'all', label: 'Все портфели', items: visiblePortfolios }];
    }
    const groups = new globalThis.Map<string, { key: string; label: string; items: PortfolioRecord[] }>();
    for (const portfolio of visiblePortfolios) {
      const key = groupBy === 'status'
        ? portfolio.isEnabled
          ? 'status:enabled'
          : 'status:paused'
        : portfolio.dryRun
          ? 'mode:dry'
          : 'mode:live';
      const label = groupBy === 'status'
        ? portfolio.isEnabled
          ? 'Включенные портфели'
          : 'Портфели на паузе'
        : portfolio.dryRun
          ? 'Только симуляция'
          : 'Боевой режим';
      const current = groups.get(key);
      if (current) {
        current.items.push(portfolio);
      } else {
        groups.set(key, { key, label, items: [portfolio] });
      }
    }
    return [...groups.values()];
  }, [visiblePortfolios, groupBy]);

  const applyPreset = (presetKey: string) => {
    const preset = PORTFOLIO_PRESETS.find((item) => item.key === presetKey);
    if (!preset) {
      return;
    }
    setDraft((prev) => ({ ...prev, ...preset.values }));
  };

  const onResetDraft = () => {
    setEditingId(null);
    setDraft(DEFAULT_DRAFT);
  };

  const onSubmitDraft = () => {
    void mutation.mutateAsync({
      action: 'save',
      payload: {
        portfolio: {
          id: editingId ?? undefined,
          name: draft.name || 'Портфель рекламы',
          brandFilter: draft.brandFilter || null,
          nmIds: parseIntList(draft.nmIds).filter((value) => value > 0),
          isEnabled: draft.isEnabled,
          dryRun: draft.dryRun,
          targetAcosPct: draft.targetAcosPct,
          minOrders: draft.minOrders,
          maxCpcRub: draft.maxCpcRub,
          dailyBudgetRub: draft.dailyBudgetRub,
          minBid: draft.minBid,
          maxBid: draft.maxBid,
          stepUpPct: draft.stepUpPct,
          stepDownPct: draft.stepDownPct,
          lookbackDays: draft.lookbackDays,
          intervalMinutes: draft.intervalMinutes,
        },
      },
    });
  };

  const onEditPortfolio = (portfolio: PortfolioRecord) => {
    setEditingId(portfolio.id);
    setDraft({
      name: portfolio.name,
      brandFilter: portfolio.brandFilter ?? '',
      nmIds: portfolio.nmIds.join(','),
      targetAcosPct: portfolio.targetAcosPct,
      minOrders: portfolio.minOrders,
      maxCpcRub: portfolio.maxCpcRub,
      dailyBudgetRub: portfolio.dailyBudgetRub,
      minBid: portfolio.minBid,
      maxBid: portfolio.maxBid,
      stepUpPct: portfolio.stepUpPct,
      stepDownPct: portfolio.stepDownPct,
      lookbackDays: portfolio.lookbackDays,
      intervalMinutes: portfolio.intervalMinutes,
      dryRun: portfolio.dryRun,
      isEnabled: portfolio.isEnabled,
    });
  };

  const onRunPortfolio = (portfolioId: string) => {
    void mutation.mutateAsync({ action: 'run', payload: { portfolioId } });
  };

  const onDeletePortfolio = (portfolioId: string) => {
    void mutation.mutateAsync({ action: 'delete', payload: { portfolioId } });
  };

  const onTogglePortfolio = (portfolio: PortfolioRecord) => {
    void mutation.mutateAsync({
      action: 'save',
      payload: { portfolio: { ...portfolio, isEnabled: !portfolio.isEnabled } },
    });
  };

  const onResetFilters = () => {
    setSearch('');
    setEnabledFilter('all');
    setModeFilter('all');
    setGroupBy('status');
  };

  const submitDisabled = mutation.isPending;
  const mutationError = mutation.error;
  const isLoading = portfoliosQuery.isLoading;
  const error = portfoliosQuery.error;
  const portfoliosTotal = portfoliosQuery.data?.portfolios?.length ?? 0;
  const visiblePortfoliosCount = visiblePortfolios.length;
  const recentChanges = portfoliosQuery.data?.recentChanges ?? [];

  return (
    <section className="space-y-4">
      <div className={panelClass}>
        <div className="mb-3 flex items-center gap-2">
          <BriefcaseBusiness className="h-5 w-5 text-indigo-600" />
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Портфельные цели по товарам и брендам</h2>
        </div>

        <div className="mb-3 rounded-xl border border-indigo-200 bg-indigo-50 p-3 dark:border-indigo-800/40 dark:bg-indigo-900/20">
          <p className="text-sm font-semibold text-indigo-900 dark:text-indigo-200">Быстрые пресеты портфеля</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {PORTFOLIO_PRESETS.map((preset) => (
              <button
                key={preset.key}
                type="button"
                onClick={() => applyPreset(preset.key)}
                className="rounded-xl border border-indigo-200 bg-white px-3 py-2 text-xs font-semibold text-indigo-800"
                title={preset.hint}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <label className="text-xs font-semibold text-slate-500">Название портфеля</label>
            <input
              type="text"
              value={draft.name}
              onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500">Бренды (через запятую)</label>
            <input
              type="text"
              value={draft.brandFilter}
              onChange={(event) => setDraft((prev) => ({ ...prev, brandFilter: event.target.value }))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              placeholder="POPSTYLE, NMID"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500">Артикулы nmID (через запятую)</label>
            <input
              type="text"
              value={draft.nmIds}
              onChange={(event) => setDraft((prev) => ({ ...prev, nmIds: event.target.value }))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              placeholder="620789046, 861477462"
            />
          </div>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <div>
            <label className="text-xs font-semibold text-slate-500">Целевая ДРР, %</label>
            <input
              type="number"
              value={draft.targetAcosPct}
              onChange={(event) => setDraft((prev) => ({ ...prev, targetAcosPct: Number(event.target.value) }))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
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
            <label className="text-xs font-semibold text-slate-500">Дневной бюджет, ₽</label>
            <input
              type="number"
              value={draft.dailyBudgetRub}
              onChange={(event) => setDraft((prev) => ({ ...prev, dailyBudgetRub: Number(event.target.value) }))}
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
            <label className="text-xs font-semibold text-slate-500">Шаг вверх / вниз, %</label>
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
            <label className="text-xs font-semibold text-slate-500">Окно / интервал (дни / мин)</label>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <input
                type="number"
                value={draft.lookbackDays}
                onChange={(event) => setDraft((prev) => ({ ...prev, lookbackDays: Number(event.target.value) }))}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
              <input
                type="number"
                value={draft.intervalMinutes}
                onChange={(event) => setDraft((prev) => ({ ...prev, intervalMinutes: Number(event.target.value) }))}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
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
            Включено
          </label>
          <button
            type="button"
            onClick={onSubmitDraft}
            disabled={submitDisabled}
            className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {editingId ? 'Обновить портфель' : 'Сохранить портфель'}
          </button>
          <button
            type="button"
            onClick={onResetDraft}
            className="rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700"
          >
            Сбросить форму
          </button>
          {mutationError ? <span className="text-sm text-rose-600">{mutationError.message}</span> : null}
        </div>
      </div>

      <div className={panelClass}>
        <p className="mb-3 text-sm font-semibold text-slate-700">Портфели</p>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="min-w-[220px] rounded-xl border border-slate-200 px-3 py-2 text-sm"
            placeholder="Поиск по названию, бренду или nmID"
          />
          <select
            value={enabledFilter}
            onChange={(event) => setEnabledFilter(event.target.value as PortfolioEnabledFilter)}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="all">Все состояния</option>
            <option value="enabled">Только включенные</option>
            <option value="paused">Только на паузе</option>
          </select>
          <select
            value={modeFilter}
            onChange={(event) => setModeFilter(event.target.value as PortfolioModeFilter)}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="all">Любой режим</option>
            <option value="dry">Только симуляция</option>
            <option value="live">Только боевой</option>
          </select>
          <select
            value={groupBy}
            onChange={(event) => setGroupBy(event.target.value as PortfolioGroupBy)}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="status">Группировка: статус</option>
            <option value="mode">Группировка: режим</option>
            <option value="none">Без группировки</option>
          </select>
          <button
            type="button"
            onClick={onResetFilters}
            className="rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700"
          >
            Сбросить фильтры
          </button>
          <span className="text-xs text-slate-500">
            Показано {formatNumber(visiblePortfoliosCount)} из {formatNumber(portfoliosTotal)}
          </span>
        </div>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Загружаем портфели...
          </div>
        ) : error ? (
          <p className="text-sm text-rose-600">{error.message}</p>
        ) : portfoliosTotal === 0 ? (
          <p className="text-sm text-slate-500">Пока нет сохранённых портфелей.</p>
        ) : visiblePortfoliosCount === 0 ? (
          <p className="text-sm text-slate-500">По текущим фильтрам портфели не найдены.</p>
        ) : (
          <div className="space-y-4">
            {groupedPortfolios.map((group) => (
              <div key={group.key} className="space-y-3">
                {groupBy !== 'none' ? (
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    {group.label} · {formatNumber(group.items.length)}
                  </p>
                ) : null}
                {group.items.map((portfolio) => (
                  <article key={portfolio.id} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-semibold text-slate-900 dark:text-slate-100">{portfolio.name}</p>
                        <p className="text-xs text-slate-500">
                          Бренды: {portfolio.brandFilter || '—'} · артикулов: {portfolio.nmIds.length}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                          portfolio.isEnabled ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400'
                        }`}>
                          {portfolio.isEnabled ? 'включен' : 'на паузе'}
                        </span>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                          portfolio.dryRun ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400'
                        }`}>
                          {portfolio.dryRun ? 'симуляция' : 'боевой режим'}
                        </span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-400">
                          {strategyStateLabel(portfolio.lastStatus)}
                        </span>
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-slate-600">
                      ДРР {formatPercent(portfolio.targetAcosPct, 1)} · мин. заказов {formatNumber(portfolio.minOrders)} · макс. CPC {formatMoneyPrecise(portfolio.maxCpcRub, 2)} · бюджет {formatMoneyPrecise(portfolio.dailyBudgetRub, 2)}
                    </p>
                    <p className="text-xs text-slate-600">
                      Интервал {portfolio.intervalMinutes} мин · след. запуск {formatDateTime(portfolio.nextRunAt)}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => onRunPortfolio(portfolio.id)}
                        className="rounded-lg border border-slate-200 bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700"
                      >
                        Запустить сейчас
                      </button>
                      <button
                        type="button"
                        onClick={() => onEditPortfolio(portfolio)}
                        className="rounded-lg border border-slate-200 bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700"
                      >
                        Изменить
                      </button>
                      <button
                        type="button"
                        onClick={() => onTogglePortfolio(portfolio)}
                        className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-300"
                      >
                        {portfolio.isEnabled ? 'Пауза' : 'Включить'}
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeletePortfolio(portfolio.id)}
                        className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700 dark:border-rose-800/40 dark:bg-rose-900/20 dark:text-rose-300"
                      >
                        Удалить
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={panelClass}>
        <p className="mb-2 text-sm font-semibold text-slate-700">Журнал изменений портфеля</p>
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="text-left uppercase tracking-wider text-slate-500">
                <th scope="col" className="px-2 py-2">Время</th>
                <th scope="col" className="px-2 py-2">Кластер</th>
                <th scope="col" className="px-2 py-2">Ставка</th>
                <th scope="col" className="px-2 py-2">Статус</th>
                <th scope="col" className="px-2 py-2">Причина</th>
              </tr>
            </thead>
            <tbody>
              {recentChanges.slice(0, 40).map((item) => (
                <tr key={item.id} className="border-t border-slate-100">
                  <td className="px-2 py-2">{formatDateTime(item.createdAt)}</td>
                  <td className="px-2 py-2">{item.cluster}</td>
                  <td className="px-2 py-2">{formatMoneyPrecise(item.previousBid, 0)} → {formatMoneyPrecise(item.nextBid, 0)}</td>
                  <td className="px-2 py-2">{bidChangeStatusLabel(item.status)}</td>
                  <td className="px-2 py-2">{strategyReasonLabel(item.reason)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
