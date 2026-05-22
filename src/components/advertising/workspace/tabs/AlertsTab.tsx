'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { formatNumber } from '../../_shared/format';
import { alertSeverityLabel, alertTypeLabel, panelClass } from '../../_shared/ui';

export type AlertsSeverityFilter = 'all' | 'critical' | 'high' | 'medium';
export type AlertsTypeFilter =
  | 'all'
  | 'spend_spike_without_orders'
  | 'ctr_cvr_degradation'
  | 'brand_anomaly'
  | 'sku_anomaly';

export type AlertsResponse = {
  summary: {
    total: number;
    critical: number;
    high: number;
    medium: number;
  };
  alerts: Array<{
    id: string;
    type: string;
    severity: 'critical' | 'high' | 'medium';
    title: string;
    details: string;
    metric: string;
    nmId: number | null;
    cluster: string | null;
    brand: string | null;
    vendorCode: string | null;
  }>;
};

type AlertsTabProps = {
  tenantId: string;
  fromParam: string;
  toParam: string;
};

export function AlertsTab({ tenantId, fromParam, toParam }: AlertsTabProps) {
  const [severityFilter, setSeverityFilter] = useState<AlertsSeverityFilter>('all');
  const [typeFilter, setTypeFilter] = useState<AlertsTypeFilter>('all');

  const alertsQuery = useQuery<AlertsResponse | null, Error>({
    queryKey: ['adv-workspace-alerts', tenantId, fromParam, toParam],
    queryFn: async () => {
      const params = new URLSearchParams({
        from: fromParam,
        to: toParam,
      });
      const response = await fetch(`/api/views/advertising/workspace/alerts?${params.toString()}`, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('Не удалось загрузить алерты');
      }
      return response.json();
    },
    enabled: Boolean(tenantId),
  });

  const data = alertsQuery.data;
  const isLoading = alertsQuery.isLoading;
  const error = alertsQuery.error;

  const visibleAlerts = useMemo(() => {
    const alerts = data?.alerts ?? [];
    return alerts.filter((alert) => {
      if (severityFilter !== 'all' && alert.severity !== severityFilter) {
        return false;
      }
      if (typeFilter !== 'all' && alert.type !== typeFilter) {
        return false;
      }
      return true;
    });
  }, [data?.alerts, severityFilter, typeFilter]);

  return (
    <section className={panelClass}>
      <div className="mb-3 flex items-center gap-2">
        <AlertTriangle className="h-5 w-5 text-amber-600" />
        <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Алерты рекламного контура</h2>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          value={severityFilter}
          onChange={(event) => setSeverityFilter(event.target.value as AlertsSeverityFilter)}
          className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
        >
          <option value="all">Все приоритеты</option>
          <option value="critical">Только критичные</option>
          <option value="high">Только высокий риск</option>
          <option value="medium">Только средний риск</option>
        </select>
        <select
          value={typeFilter}
          onChange={(event) => setTypeFilter(event.target.value as AlertsTypeFilter)}
          className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
        >
          <option value="all">Все типы</option>
          <option value="spend_spike_without_orders">Всплеск расхода</option>
          <option value="ctr_cvr_degradation">Падение CTR/CVR</option>
          <option value="brand_anomaly">Аномалия бренда</option>
          <option value="sku_anomaly">Аномалия SKU</option>
        </select>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Проверяем аномалии...
        </div>
      ) : error ? (
        <p className="text-sm text-rose-600">{error.message}</p>
      ) : !data ? (
        <p className="text-sm text-slate-500">Нет данных.</p>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-slate-500">
            Всего: {formatNumber(data.summary.total)} ·
            критично: {formatNumber(data.summary.critical)} ·
            высокий риск: {formatNumber(data.summary.high)} ·
            средний риск: {formatNumber(data.summary.medium)}
          </p>
          <p className="text-xs text-slate-500">После фильтрации: {formatNumber(visibleAlerts.length)}</p>
          <div className="grid gap-3 md:grid-cols-2">
            {visibleAlerts.slice(0, 60).map((alert) => (
              <article key={alert.id} className="rounded-xl border border-slate-200 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{alert.title}</p>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                    alert.severity === 'critical'
                      ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300'
                      : alert.severity === 'high'
                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                        : 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300'
                  }`}>
                    {alertSeverityLabel(alert.severity)}
                  </span>
                </div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{alertTypeLabel(alert.type)}</p>
                <p className="text-xs text-slate-600">{alert.details}</p>
                <p className="mt-2 text-sm font-semibold text-slate-800">{alert.metric}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {alert.cluster ? `Кластер: ${alert.cluster}` : ''}
                  {alert.nmId ? ` · nmId ${alert.nmId}` : ''}
                  {alert.brand ? ` · ${alert.brand}` : ''}
                  {alert.vendorCode ? ` · ${alert.vendorCode}` : ''}
                </p>
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
