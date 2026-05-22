'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock3, Loader2 } from 'lucide-react';
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

export type PacingRuleRecord = {
  id: string;
  name: string;
  advertId: number;
  nmId: number;
  isEnabled: boolean;
  dryRun: boolean;
  dailyBudgetRub: number;
  softCapPct: number;
  stepDownPct: number;
  minBid: number;
  maxBid: number;
  daypartHours: number[];
  timezone: string;
  intervalMinutes: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastStatus: string | null;
};

export type PacingRecentChange = {
  id: string;
  cluster: string;
  previousBid: number | null;
  nextBid: number | null;
  status: string;
  reason: string | null;
  createdAt: string;
};

export type PacingResponse = {
  rules: PacingRuleRecord[];
  recentChanges: PacingRecentChange[];
};

export type PacingDraft = {
  name: string;
  dailyBudgetRub: number;
  softCapPct: number;
  stepDownPct: number;
  minBid: number;
  maxBid: number;
  daypartHours: string;
  timezone: string;
  intervalMinutes: number;
  dryRun: boolean;
  isEnabled: boolean;
};

export type PacingEnabledFilter = 'all' | 'enabled' | 'paused';
export type PacingGroupBy = 'none' | 'campaign' | 'status';

const PACING_PRESETS: Array<{
  key: string;
  label: string;
  hint: string;
  values: {
    dailyBudgetRub: number;
    softCapPct: number;
    stepDownPct: number;
    intervalMinutes: number;
    daypartHours: string;
  };
}> = [
  {
    key: 'standard',
    label: 'Стандарт',
    hint: 'Умеренный пейсинг на рабочий день',
    values: {
      dailyBudgetRub: 3000,
      softCapPct: 85,
      stepDownPct: 20,
      intervalMinutes: 20,
      daypartHours: '8,9,10,11,12,13,14,15,16,17,18,19,20,21',
    },
  },
  {
    key: 'strict',
    label: 'Жёсткий',
    hint: 'Жёстче останавливает при перерасходе',
    values: {
      dailyBudgetRub: 3000,
      softCapPct: 70,
      stepDownPct: 30,
      intervalMinutes: 15,
      daypartHours: '8,9,10,11,12,13,14,15,16,17,18,19,20,21',
    },
  },
  {
    key: 'evening',
    label: 'Вечерний',
    hint: 'Активен в прайм-тайм 18-23',
    values: {
      dailyBudgetRub: 2500,
      softCapPct: 85,
      stepDownPct: 25,
      intervalMinutes: 20,
      daypartHours: '18,19,20,21,22,23',
    },
  },
];

const DEFAULT_DRAFT: PacingDraft = {
  name: '',
  dailyBudgetRub: 3000,
  softCapPct: 85,
  stepDownPct: 20,
  minBid: 100,
  maxBid: 5000,
  daypartHours: '8,9,10,11,12,13,14,15,16,17,18,19,20,21',
  timezone: 'Europe/Moscow',
  intervalMinutes: 20,
  dryRun: true,
  isEnabled: true,
};

type PacingTabProps = {
  tenantId: string;
  fromParam: string;
  toParam: string;
  selectedClusterNmId: number | null;
  effectiveAdvertId: number | null;
};

export function PacingTab({
  tenantId,
  fromParam,
  toParam,
  selectedClusterNmId,
  effectiveAdvertId,
}: PacingTabProps) {
  const queryClient = useQueryClient();

  const [draft, setDraft] = useState<PacingDraft>(DEFAULT_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [enabledFilter, setEnabledFilter] = useState<PacingEnabledFilter>('all');
  const [groupBy, setGroupBy] = useState<PacingGroupBy>('campaign');

  const pacingQuery = useQuery<PacingResponse | null, Error>({
    queryKey: ['adv-workspace-pacing', tenantId],
    queryFn: async () => {
      const response = await fetch(`/api/views/advertising/workspace/pacing`, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('Не удалось загрузить правила пейсинга');
      }
      return response.json();
    },
    enabled: Boolean(tenantId),
  });

  const mutation = useMutation<unknown, Error, { action: 'save' | 'delete' | 'run'; payload: Record<string, unknown> }>({
    mutationFn: async ({ action, payload }) => {
      const response = await fetch(`/api/views/advertising/workspace/pacing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...payload }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof body?.error === 'string' ? body.error : 'Ошибка операции по пейсингу');
      }
      return body;
    },
    onSuccess: (_result, variables) => {
      if (variables.action === 'save') {
        setEditingId(null);
      }
      void queryClient.invalidateQueries({ queryKey: ['adv-workspace-pacing', tenantId] });
      void queryClient.invalidateQueries({ queryKey: ['adv-workspace-bids', tenantId, fromParam, toParam] });
    },
  });

  const pacingById = useMemo(() => {
    const map = new globalThis.Map<string, PacingRuleRecord>();
    for (const rule of pacingQuery.data?.rules ?? []) {
      map.set(rule.id, rule);
    }
    return map;
  }, [pacingQuery.data?.rules]);

  const editingRule = editingId ? (pacingById.get(editingId) ?? null) : null;

  const visiblePacingRules = useMemo(() => {
    const rules = pacingQuery.data?.rules ?? [];
    const normalizedSearch = search.trim().toLocaleLowerCase('ru-RU');
    return rules.filter((rule) => {
      if (enabledFilter === 'enabled' && !rule.isEnabled) {
        return false;
      }
      if (enabledFilter === 'paused' && rule.isEnabled) {
        return false;
      }
      if (!normalizedSearch) {
        return true;
      }
      const searchable = `${rule.name} ${rule.advertId} ${rule.nmId} ${rule.timezone}`.toLocaleLowerCase('ru-RU');
      return searchable.includes(normalizedSearch);
    });
  }, [pacingQuery.data?.rules, search, enabledFilter]);

  const groupedRules = useMemo(() => {
    if (groupBy === 'none') {
      return [{ key: 'all', label: 'Все правила', items: visiblePacingRules }];
    }
    const groups = new globalThis.Map<string, { key: string; label: string; items: PacingRuleRecord[] }>();
    for (const rule of visiblePacingRules) {
      const key = groupBy === 'campaign'
        ? `campaign:${rule.advertId}`
        : rule.isEnabled
          ? 'status:enabled'
          : 'status:paused';
      const label = groupBy === 'campaign'
        ? `Кампания ${rule.advertId}`
        : rule.isEnabled
          ? 'Включенные правила'
          : 'Правила на паузе';
      const current = groups.get(key);
      if (current) {
        current.items.push(rule);
      } else {
        groups.set(key, { key, label, items: [rule] });
      }
    }
    return [...groups.values()];
  }, [visiblePacingRules, groupBy]);

  const applyPreset = (presetKey: string) => {
    const preset = PACING_PRESETS.find((item) => item.key === presetKey);
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
    const targetAdvertId = editingRule?.advertId ?? effectiveAdvertId;
    const targetNmId = editingRule?.nmId ?? selectedClusterNmId ?? null;
    if (!targetAdvertId || !targetNmId) {
      return;
    }
    void mutation.mutateAsync({
      action: 'save',
      payload: {
        rule: {
          id: editingId ?? undefined,
          name: draft.name || `Пейсинг ${targetAdvertId}/${targetNmId}`,
          advertId: targetAdvertId,
          nmId: targetNmId,
          isEnabled: draft.isEnabled,
          dryRun: draft.dryRun,
          dailyBudgetRub: draft.dailyBudgetRub,
          softCapPct: draft.softCapPct,
          stepDownPct: draft.stepDownPct,
          minBid: draft.minBid,
          maxBid: draft.maxBid,
          daypartHours: parseIntList(draft.daypartHours).filter((value) => value >= 0 && value <= 23),
          timezone: draft.timezone,
          intervalMinutes: draft.intervalMinutes,
        },
      },
    });
  };

  const onEditRule = (rule: PacingRuleRecord) => {
    setEditingId(rule.id);
    setDraft({
      name: rule.name,
      dailyBudgetRub: rule.dailyBudgetRub,
      softCapPct: rule.softCapPct,
      stepDownPct: rule.stepDownPct,
      minBid: rule.minBid,
      maxBid: rule.maxBid,
      daypartHours: rule.daypartHours.join(','),
      timezone: rule.timezone,
      intervalMinutes: rule.intervalMinutes,
      dryRun: rule.dryRun,
      isEnabled: rule.isEnabled,
    });
  };

  const onRunRule = (ruleId: string) => {
    void mutation.mutateAsync({ action: 'run', payload: { ruleId } });
  };

  const onDeleteRule = (ruleId: string) => {
    void mutation.mutateAsync({ action: 'delete', payload: { ruleId } });
  };

  const onToggleRule = (rule: PacingRuleRecord) => {
    void mutation.mutateAsync({
      action: 'save',
      payload: { rule: { ...rule, isEnabled: !rule.isEnabled } },
    });
  };

  const onResetFilters = () => {
    setSearch('');
    setEnabledFilter('all');
    setGroupBy('campaign');
  };

  const submitDisabled = mutation.isPending || (!editingRule && (!selectedClusterNmId || !effectiveAdvertId));
  const mutationError = mutation.error;
  const isLoading = pacingQuery.isLoading;
  const error = pacingQuery.error;
  const rulesTotal = pacingQuery.data?.rules?.length ?? 0;
  const visibleRulesCount = visiblePacingRules.length;
  const recentChanges = pacingQuery.data?.recentChanges ?? [];

  return (
    <section className="space-y-4">
      <div className={panelClass}>
        <div className="mb-3 flex items-center gap-2">
          <Clock3 className="h-5 w-5 text-emerald-600" />
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Пейсинг бюджета и почасовой режим</h2>
        </div>

        <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-800/40 dark:bg-emerald-900/20">
          <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">Быстрые пресеты пейсинга</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {PACING_PRESETS.map((preset) => (
              <button
                key={preset.key}
                type="button"
                onClick={() => applyPreset(preset.key)}
                className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-800"
                title={preset.hint}
              >
                {preset.label}
              </button>
            ))}
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
              placeholder="Например: Пейсинг Кампания 123"
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
          <div>
            <label className="text-xs font-semibold text-slate-500">Мягкий лимит, %</label>
            <input
              type="number"
              value={draft.softCapPct}
              onChange={(event) => setDraft((prev) => ({ ...prev, softCapPct: Number(event.target.value) }))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500">Шаг снижения, %</label>
            <input
              type="number"
              value={draft.stepDownPct}
              onChange={(event) => setDraft((prev) => ({ ...prev, stepDownPct: Number(event.target.value) }))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500">Часы активности (0-23 через запятую)</label>
            <input
              type="text"
              value={draft.daypartHours}
              onChange={(event) => setDraft((prev) => ({ ...prev, daypartHours: event.target.value }))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500">Часовой пояс</label>
            <input
              type="text"
              value={draft.timezone}
              onChange={(event) => setDraft((prev) => ({ ...prev, timezone: event.target.value }))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <div>
            <label className="text-xs font-semibold text-slate-500">Интервал, минут</label>
            <input
              type="number"
              value={draft.intervalMinutes}
              onChange={(event) => setDraft((prev) => ({ ...prev, intervalMinutes: Number(event.target.value) }))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
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
              Включено
            </label>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onSubmitDraft}
            disabled={submitDisabled}
            className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {editingId ? 'Обновить правило' : 'Сохранить правило'}
          </button>
          <button
            type="button"
            onClick={onResetDraft}
            className="rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700"
          >
            Сбросить форму
          </button>
          {mutationError ? <span className="text-sm text-rose-600">{mutationError.message}</span> : null}
          {editingRule ? (
            <span className="text-xs text-slate-500">Редактируется правило #{editingRule.advertId}/{editingRule.nmId}</span>
          ) : null}
        </div>
      </div>

      <div className={panelClass}>
        <p className="mb-3 text-sm font-semibold text-slate-700">Правила пейсинга</p>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="min-w-[220px] rounded-xl border border-slate-200 px-3 py-2 text-sm"
            placeholder="Поиск по названию, кампании, nmID"
          />
          <select
            value={enabledFilter}
            onChange={(event) => setEnabledFilter(event.target.value as PacingEnabledFilter)}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="all">Все состояния</option>
            <option value="enabled">Только включенные</option>
            <option value="paused">Только на паузе</option>
          </select>
          <select
            value={groupBy}
            onChange={(event) => setGroupBy(event.target.value as PacingGroupBy)}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="campaign">Группировка: кампания</option>
            <option value="status">Группировка: статус</option>
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
            Показано {formatNumber(visibleRulesCount)} из {formatNumber(rulesTotal)}
          </span>
        </div>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Загружаем правила...
          </div>
        ) : error ? (
          <p className="text-sm text-rose-600">{error.message}</p>
        ) : rulesTotal === 0 ? (
          <p className="text-sm text-slate-500">Пока нет правил пейсинга.</p>
        ) : visibleRulesCount === 0 ? (
          <p className="text-sm text-slate-500">По текущим фильтрам правила не найдены.</p>
        ) : (
          <div className="space-y-4">
            {groupedRules.map((group) => (
              <div key={group.key} className="space-y-3">
                {groupBy !== 'none' ? (
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    {group.label} · {formatNumber(group.items.length)}
                  </p>
                ) : null}
                {group.items.map((rule) => (
                  <article key={rule.id} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-semibold text-slate-900 dark:text-slate-100">{rule.name}</p>
                        <p className="text-xs text-slate-500">
                          Кампания {rule.advertId} · nmID {rule.nmId} · {rule.timezone} · запуск каждые {rule.intervalMinutes} мин
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                          rule.isEnabled ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400'
                        }`}>
                          {rule.isEnabled ? 'включено' : 'на паузе'}
                        </span>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                          rule.dryRun ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400'
                        }`}>
                          {rule.dryRun ? 'симуляция' : 'боевой режим'}
                        </span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-400">
                          {strategyStateLabel(rule.lastStatus)}
                        </span>
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-slate-600">
                      Бюджет {formatMoneyPrecise(rule.dailyBudgetRub, 2)} · мягкий лимит {formatPercent(rule.softCapPct, 1)} · шаг снижения {formatPercent(rule.stepDownPct, 1)}
                    </p>
                    <p className="text-xs text-slate-600">
                      Часы: {rule.daypartHours.length > 0 ? rule.daypartHours.join(', ') : 'все'} · след. запуск {formatDateTime(rule.nextRunAt)}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => onRunRule(rule.id)}
                        className="rounded-lg border border-slate-200 bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700"
                      >
                        Запустить сейчас
                      </button>
                      <button
                        type="button"
                        onClick={() => onEditRule(rule)}
                        className="rounded-lg border border-slate-200 bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700"
                      >
                        Изменить
                      </button>
                      <button
                        type="button"
                        onClick={() => onToggleRule(rule)}
                        className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-300"
                      >
                        {rule.isEnabled ? 'Пауза' : 'Включить'}
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteRule(rule.id)}
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
        <p className="mb-2 text-sm font-semibold text-slate-700">Журнал изменений пейсинга</p>
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
