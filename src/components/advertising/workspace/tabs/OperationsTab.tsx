'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { formatDateTime, formatMoney, formatNumber } from '../../_shared/format';
import { panelClass } from '../../_shared/ui';

export type AdvertisingOperationsResponse = {
  generatedAt: string;
  status: 'ok' | 'warning' | 'critical';
  summary: {
    alertsTotal: number;
    criticalAlerts: number;
    highAlerts: number;
    failedBidChanges: number;
    guardrailBlockedBidChanges: number;
    failedClusterActions: number;
    failedStrategyRuns: number;
    campaignVerificationFailures: number;
  };
  incidents: Array<{
    id: string;
    severity: 'warning' | 'critical';
    title: string;
    details: string;
    count: number;
  }>;
  dailyReport: {
    periodDays: number;
    spendRub: number;
    revenueRub: number;
    orders: number;
    clicks: number;
    drrPct: number | null;
    cpcRub: number | null;
    appliedBidChanges: number;
    loweredBidChanges: number;
    raisedBidChanges: number;
    postActionSavingsRub: number;
    postActionExtraOrders: number;
    postActionRollbackCount: number;
    postActionRolledBackCount: number;
    lines: string[];
  };
  capabilities: Array<{
    id: string;
    label: string;
    status: 'supported' | 'fallback' | 'analytics';
    controlSurface: 'api_campaign_card' | 'api_search_cluster' | 'lk_assisted' | 'analytics_only';
    controlLabel: string;
    summary: string;
    operatorNote: string;
  }>;
  postActionEffects: Array<{
    id: string;
    kind: 'saving' | 'growth' | 'rollback' | 'watch' | 'rolled_back';
    title: string;
    summary: string;
    primaryMetric: string;
    secondaryMetric: string;
    direction: 'raise' | 'lower';
    outcome: 'improved' | 'worse' | 'neutral' | 'insufficient_data';
    recommendation: 'keep' | 'rollback' | 'watch';
    checkedAt: string;
    createdAt: string;
    horizonHours: number;
    bidChange: string;
    scopeLabel: string;
    rollbackStatus: 'not_needed' | 'skipped' | 'applied' | 'failed';
    nextStep: string;
    autoCorrection: string;
    advertId: number;
    nmId: number;
    cluster: string;
    impact: {
      beforeOrders: number;
      afterOrders: number;
      ordersDelta: number;
      beforeSpendRub: number;
      afterSpendRub: number;
      spendDeltaRub: number;
      savingsRub: number;
      beforeRevenueRub: number;
      afterRevenueRub: number;
      revenueDeltaRub: number;
      beforeDrrPct: number | null;
      afterDrrPct: number | null;
      drrDeltaPctPoints: number | null;
    };
  }>;
  queue: Array<{
    id: string;
    kind: 'alert' | 'bid_change' | 'cluster_action' | 'campaign_action' | 'strategy_run';
    status: 'needs_attention' | 'blocked' | 'completed' | 'info';
    title: string;
    details: string;
    createdAt: string;
    advertId: number | null;
    nmId: number | null;
    cluster: string | null;
    source: string | null;
  }>;
};

type OperationsProps = {
  tenantId: string;
  fromParam: string;
  toParam: string;
};

function operationsQueryKey({ tenantId, fromParam, toParam }: OperationsProps) {
  return ['adv-workspace-operations', tenantId, fromParam, toParam] as const;
}

function useAdvertisingOperationsQuery(props: OperationsProps) {
  const { tenantId, fromParam, toParam } = props;
  return useQuery<AdvertisingOperationsResponse | null, Error>({
    queryKey: operationsQueryKey(props),
    queryFn: async () => {
      const params = new URLSearchParams({
        from: fromParam,
        to: toParam,
      });
      const response = await fetch(`/api/views/advertising/workspace/operations?${params.toString()}`, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('Не удалось загрузить операционный статус рекламы');
      }
      return response.json();
    },
    enabled: Boolean(tenantId),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}

function statusLabel(status: AdvertisingOperationsResponse['status']) {
  if (status === 'critical') return 'Нужна проверка';
  if (status === 'warning') return 'Есть предупреждения';
  return 'Контур стабилен';
}

function statusClasses(status: AdvertisingOperationsResponse['status']) {
  if (status === 'critical') return 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-200';
  if (status === 'warning') return 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200';
  return 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200';
}

function queueStatusLabel(status: AdvertisingOperationsResponse['queue'][number]['status']) {
  if (status === 'needs_attention') return 'Проверить';
  if (status === 'blocked') return 'Заблокировано';
  if (status === 'completed') return 'Готово';
  return 'Инфо';
}

function queueKindLabel(kind: AdvertisingOperationsResponse['queue'][number]['kind']) {
  const labels: Record<AdvertisingOperationsResponse['queue'][number]['kind'], string> = {
    alert: 'Алерт',
    bid_change: 'Ставка',
    cluster_action: 'Кластер',
    campaign_action: 'Кампания',
    strategy_run: 'Автостратегия',
  };
  return labels[kind];
}

function statusBadgeClass(status: AdvertisingOperationsResponse['queue'][number]['status']) {
  if (status === 'needs_attention') return 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300';
  if (status === 'blocked') return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300';
  if (status === 'completed') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300';
  return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
}

function effectClass(kind: AdvertisingOperationsResponse['postActionEffects'][number]['kind']) {
  if (kind === 'rollback') return 'border-rose-200 bg-rose-50 dark:border-rose-900/50 dark:bg-rose-950/30';
  if (kind === 'saving' || kind === 'growth' || kind === 'rolled_back') return 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-950/30';
  return 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/60';
}

function effectBadgeClass(kind: AdvertisingOperationsResponse['postActionEffects'][number]['kind']) {
  if (kind === 'rollback') return 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300';
  if (kind === 'saving' || kind === 'growth' || kind === 'rolled_back') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300';
  return 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200';
}

function effectBadge(kind: AdvertisingOperationsResponse['postActionEffects'][number]['kind']) {
  if (kind === 'saving') return 'Экономия';
  if (kind === 'growth') return 'Рост';
  if (kind === 'rollback') return 'Откат';
  if (kind === 'rolled_back') return 'Откат применён';
  return 'Наблюдаем';
}

function ordersPhrase(effect: AdvertisingOperationsResponse['postActionEffects'][number]) {
  const delta = effect.impact.ordersDelta;
  if (delta === 0) {
    return `заказы те же: ${effect.impact.beforeOrders} → ${effect.impact.afterOrders}`;
  }
  if (delta > 0) {
    return `заказов больше: ${effect.impact.beforeOrders} → ${effect.impact.afterOrders} (+${delta})`;
  }
  return `заказов меньше: ${effect.impact.beforeOrders} → ${effect.impact.afterOrders} (${delta})`;
}

function signedMoney(value: number) {
  if (value === 0) return formatMoney(0);
  const sign = value > 0 ? '+' : '-';
  return `${sign}${formatMoney(Math.abs(value))}`;
}

function nullablePercent(value: number | null) {
  return value === null ? '—' : `${value.toFixed(1)}%`;
}

function capabilityClass(status: AdvertisingOperationsResponse['capabilities'][number]['status']) {
  if (status === 'supported') return 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-950/30';
  if (status === 'fallback') return 'border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30';
  return 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/60';
}

export function OperationsHealthStrip(props: OperationsProps) {
  const operationsQuery = useAdvertisingOperationsQuery(props);
  const data = operationsQuery.data;

  if (operationsQuery.isLoading) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-3 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900">
        <span className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Проверяем операционный статус рекламы...
        </span>
      </section>
    );
  }

  if (operationsQuery.error) {
    return (
      <section className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300">
        {operationsQuery.error.message}
      </section>
    );
  }

  if (!data) {
    return null;
  }

  const Icon = data.status === 'ok' ? CheckCircle2 : data.status === 'warning' ? AlertTriangle : Activity;
  return (
    <section className={`rounded-2xl border p-3 ${statusClasses(data.status)}`}>
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <p className="flex items-center gap-2 text-sm font-bold">
          <Icon className="h-4 w-4" />
          {statusLabel(data.status)}
        </p>
        <p className="text-xs">
          Алерты: {formatNumber(data.summary.alertsTotal)} · ошибки WB: {formatNumber(
            data.summary.failedBidChanges
            + data.summary.failedClusterActions
            + data.summary.campaignVerificationFailures,
          )} · очередь: {formatNumber(data.queue.length)}
        </p>
      </div>
    </section>
  );
}

export function OperationsTab(props: OperationsProps) {
  const operationsQuery = useAdvertisingOperationsQuery(props);
  const data = operationsQuery.data;
  const postActionEffects = data?.postActionEffects ?? [];

  const summaryItems = useMemo(() => {
    if (!data) return [];
    return [
      { label: 'Алерты', value: data.summary.alertsTotal },
      { label: 'Critical', value: data.summary.criticalAlerts },
      { label: 'High', value: data.summary.highAlerts },
      { label: 'Ошибки ставок', value: data.summary.failedBidChanges },
      { label: 'Guardrails', value: data.summary.guardrailBlockedBidChanges },
      { label: 'Ошибки кластеров', value: data.summary.failedClusterActions },
      { label: 'Ошибки статусов', value: data.summary.campaignVerificationFailures },
      { label: 'Ошибки стратегий', value: data.summary.failedStrategyRuns },
    ];
  }, [data]);

  const postActionTotals = useMemo(() => {
    const effects = data?.postActionEffects ?? [];
    return {
      savingsRub: effects.reduce((sum, item) => sum + item.impact.savingsRub, 0),
      extraOrders: effects.reduce((sum, item) => sum + Math.max(0, item.impact.ordersDelta), 0),
      rollbackCount: effects.filter((item) => item.kind === 'rollback').length,
      watchCount: effects.filter((item) => item.kind === 'watch').length,
    };
  }, [data]);

  return (
    <section className={panelClass}>
      <div className="mb-3 flex items-center gap-2">
        <Activity className="h-5 w-5 text-slate-700 dark:text-slate-200" />
        <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Операционный центр</h2>
      </div>

      {operationsQuery.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Собираем статус...
        </div>
      ) : operationsQuery.error ? (
        <p className="text-sm text-rose-600">{operationsQuery.error.message}</p>
      ) : !data ? (
        <p className="text-sm text-slate-500">Нет данных.</p>
      ) : (
        <div className="space-y-4">
          <div className={`rounded-2xl border p-3 ${statusClasses(data.status)}`}>
            <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
              <p className="text-sm font-bold">{statusLabel(data.status)}</p>
              <p className="text-xs">Обновлено: {formatDateTime(data.generatedAt)}</p>
            </div>
          </div>

          <div className="grid gap-2 md:grid-cols-4">
            {summaryItems.map((item) => (
              <div key={item.label} className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
                <p className="text-[11px] font-semibold uppercase text-slate-500">{item.label}</p>
                <p className="mt-1 text-lg font-bold text-slate-900 dark:text-slate-100">{formatNumber(item.value)}</p>
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900/40">
            <div className="mb-3 flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Отчет за выбранный период</p>
              <p className="text-xs text-slate-500">{formatNumber(data.dailyReport.periodDays)} дн.</p>
            </div>
            <div className="grid gap-2 md:grid-cols-5">
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
                <p className="text-[11px] font-semibold uppercase text-slate-500">Расход</p>
                <p className="mt-1 text-base font-black text-slate-900 dark:text-slate-100">{formatMoney(data.dailyReport.spendRub)}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
                <p className="text-[11px] font-semibold uppercase text-slate-500">Выручка</p>
                <p className="mt-1 text-base font-black text-slate-900 dark:text-slate-100">{formatMoney(data.dailyReport.revenueRub)}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
                <p className="text-[11px] font-semibold uppercase text-slate-500">Заказы / ДРР</p>
                <p className="mt-1 text-base font-black text-slate-900 dark:text-slate-100">
                  {formatNumber(data.dailyReport.orders)} · {nullablePercent(data.dailyReport.drrPct)}
                </p>
              </div>
              <div className="rounded-xl bg-emerald-50 p-3 dark:bg-emerald-950/30">
                <p className="text-[11px] font-semibold uppercase text-emerald-700 dark:text-emerald-300">Эффект ставок</p>
                <p className="mt-1 text-base font-black text-slate-900 dark:text-slate-100">
                  {formatMoney(data.dailyReport.postActionSavingsRub)} · +{formatNumber(data.dailyReport.postActionExtraOrders)}
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
                <p className="text-[11px] font-semibold uppercase text-slate-500">Изменения</p>
                <p className="mt-1 text-base font-black text-slate-900 dark:text-slate-100">
                  ↓{formatNumber(data.dailyReport.loweredBidChanges)} · ↑{formatNumber(data.dailyReport.raisedBidChanges)}
                </p>
              </div>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {data.dailyReport.lines.map((line) => (
                <p key={line} className="rounded-xl bg-slate-50 p-2 text-xs font-semibold text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                  {line}
                </p>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Типы рекламы и управление</p>
            <div className="grid gap-2 md:grid-cols-4">
              {data.capabilities.map((capability) => (
                <article key={capability.id} className={`rounded-xl border p-3 ${capabilityClass(capability.status)}`}>
                  <p className="text-sm font-black text-slate-900 dark:text-slate-100">{capability.label}</p>
                  <p className="mt-1 text-xs font-bold text-emerald-700 dark:text-emerald-300">{capability.controlLabel}</p>
                  <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">{capability.summary}</p>
                  <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{capability.operatorNote}</p>
                </article>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Инциденты</p>
            {data.incidents.length === 0 ? (
              <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300">
                Активных инцидентов по выбранному периоду нет.
              </p>
            ) : (
              <div className="grid gap-2 md:grid-cols-2">
                {data.incidents.map((incident) => (
                  <article key={incident.id} className={`rounded-xl border p-3 ${
                    incident.severity === 'critical'
                      ? 'border-rose-200 bg-rose-50 dark:border-rose-900/50 dark:bg-rose-950/30'
                      : 'border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30'
                  }`}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{incident.title}</p>
                      <span className="text-sm font-bold">{formatNumber(incident.count)}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{incident.details}</p>
                  </article>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="mb-2 flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Последствия изменений ставок</p>
              {postActionEffects.length > 0 ? (
                <p className="text-xs text-slate-500">
                  Проверка через 2 / 6 / 24 часа после изменения
                </p>
              ) : null}
            </div>
            {postActionEffects.length === 0 ? (
              <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/60">
                Проверенных последствий пока нет. Первые выводы появятся через 2 часа после изменения ставки.
              </p>
            ) : (
              <div className="space-y-3">
                <div className="grid gap-2 md:grid-cols-4">
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900/50 dark:bg-emerald-950/30">
                    <p className="text-[11px] font-semibold uppercase text-emerald-700 dark:text-emerald-300">Экономия</p>
                    <p className="mt-1 text-lg font-bold text-slate-900 dark:text-slate-100">{formatMoney(postActionTotals.savingsRub)}</p>
                  </div>
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900/50 dark:bg-emerald-950/30">
                    <p className="text-[11px] font-semibold uppercase text-emerald-700 dark:text-emerald-300">Доп. заказы</p>
                    <p className="mt-1 text-lg font-bold text-slate-900 dark:text-slate-100">+{formatNumber(postActionTotals.extraOrders)}</p>
                  </div>
                  <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 dark:border-rose-900/50 dark:bg-rose-950/30">
                    <p className="text-[11px] font-semibold uppercase text-rose-700 dark:text-rose-300">Нужен откат</p>
                    <p className="mt-1 text-lg font-bold text-slate-900 dark:text-slate-100">{formatNumber(postActionTotals.rollbackCount)}</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
                    <p className="text-[11px] font-semibold uppercase text-slate-500">Наблюдаем</p>
                    <p className="mt-1 text-lg font-bold text-slate-900 dark:text-slate-100">{formatNumber(postActionTotals.watchCount)}</p>
                  </div>
                </div>

                <div className="grid gap-2 md:grid-cols-2">
                  {postActionEffects.map((effect) => (
                    <article key={effect.id} className={`rounded-xl border p-3 ${effectClass(effect.kind)}`}>
                      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                        <div>
                          <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{effect.title}</p>
                          <p className="mt-1 text-xs font-semibold text-slate-700 dark:text-slate-200">{effect.primaryMetric}</p>
                        </div>
                        <span className={`inline-flex w-fit rounded-full px-2 py-0.5 text-[11px] font-bold ${effectBadgeClass(effect.kind)}`}>
                          {effectBadge(effect.kind)}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">{ordersPhrase(effect)}</p>
                      <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{effect.secondaryMetric}</p>
                      <p className="mt-2 rounded-lg bg-white/70 p-2 text-xs font-semibold text-slate-700 dark:bg-slate-900/40 dark:text-slate-200">
                        {effect.nextStep}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{effect.autoCorrection}</p>
                      <div className="mt-2 grid gap-1 text-[11px] text-slate-500 md:grid-cols-2">
                        <p>{effect.scopeLabel}</p>
                        <p>Ставка: {effect.bidChange}</p>
                        <p>Расход дельта: {signedMoney(effect.impact.spendDeltaRub)}</p>
                        <p>Проверено: {formatDateTime(effect.checkedAt)} · {effect.horizonHours} ч</p>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Очередь действий</p>
            {data.queue.length === 0 ? (
              <p className="text-sm text-slate-500">Нет действий за выбранный период.</p>
            ) : (
              <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
                <div className="max-h-[520px] overflow-auto">
                  <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
                    <thead className="sticky top-0 bg-slate-50 text-left text-[11px] uppercase text-slate-500 dark:bg-slate-800">
                      <tr>
                        <th className="px-3 py-2">Статус</th>
                        <th className="px-3 py-2">Тип</th>
                        <th className="px-3 py-2">Действие</th>
                        <th className="px-3 py-2">Объект</th>
                        <th className="px-3 py-2">Время</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {data.queue.map((item) => (
                        <tr key={item.id} className="align-top">
                          <td className="px-3 py-2">
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ${statusBadgeClass(item.status)}`}>
                              {queueStatusLabel(item.status)}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-xs font-semibold text-slate-500">{queueKindLabel(item.kind)}</td>
                          <td className="px-3 py-2">
                            <p className="font-semibold text-slate-900 dark:text-slate-100">{item.title}</p>
                            <p className="mt-1 max-w-[520px] text-xs text-slate-600 dark:text-slate-300">{item.details}</p>
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-300">
                            {item.advertId ? <p>Кампания #{item.advertId}</p> : null}
                            {item.nmId ? <p>nmId {item.nmId}</p> : null}
                            {item.cluster ? <p>Кластер: {item.cluster}</p> : null}
                            {item.source ? <p>Источник: {item.source}</p> : null}
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-500">{formatDateTime(item.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
