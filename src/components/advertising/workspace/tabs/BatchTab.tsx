'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, ShieldBan } from 'lucide-react';
import type { ClusterRiskLevel } from '../../_shared/types';
import { formatMoney, formatNumber } from '../../_shared/format';
import { panelClass, riskLabel } from '../../_shared/ui';

export type BatchRiskLevel = Exclude<ClusterRiskLevel, 'none'>;

export type BatchResult = {
  requiresConfirmation: boolean;
  summary: {
    selectedClusters: number;
    queuedOperations: number;
    applied: number;
    failed: number;
  };
  operations: Array<{
    advertId: number;
    nmId: number;
    cluster: string;
    riskLevel: ClusterRiskLevel;
    clicks: number;
    orders: number;
    adSpend: number;
  }>;
  errors: Array<{
    advertId: number;
    nmId: number;
    cluster: string;
    error: string;
  }>;
};

type BatchTabProps = {
  tenantId: string;
  fromParam: string;
  toParam: string;
};

export function BatchTab({ tenantId, fromParam, toParam }: BatchTabProps) {
  const queryClient = useQueryClient();

  const [riskLevels, setRiskLevels] = useState<BatchRiskLevel[]>(['high']);
  const [maxClusters, setMaxClusters] = useState<number>(60);
  const [result, setResult] = useState<BatchResult | null>(null);
  const [needsConfirm, setNeedsConfirm] = useState(false);

  const mutation = useMutation<BatchResult, Error, { dryRun: boolean; confirmed: boolean }>({
    mutationFn: async ({ dryRun, confirmed }) => {
      const response = await fetch(`/api/views/advertising/workspace/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: fromParam,
          to: toParam,
          riskLevels,
          dryRun,
          confirmed,
          maxClusters,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload?.error === 'string' ? payload.error : 'Не удалось выполнить пакетную операцию');
      }
      return payload;
    },
    onSuccess: (payload) => {
      setResult(payload);
      setNeedsConfirm(payload.requiresConfirmation);
      if (!payload.requiresConfirmation) {
        void queryClient.invalidateQueries({ queryKey: ['adv-workspace-clusters', tenantId, fromParam, toParam] });
      }
    },
  });

  const toggleRiskLevel = (level: BatchRiskLevel, enabled: boolean) => {
    setRiskLevels((prev) => (enabled ? [...prev, level] : prev.filter((item) => item !== level)));
  };

  const onDryRun = () => {
    setNeedsConfirm(false);
    void mutation.mutateAsync({ dryRun: true, confirmed: false });
  };

  const onApply = () => {
    setNeedsConfirm(false);
    void mutation.mutateAsync({ dryRun: false, confirmed: false });
  };

  const onConfirm = () => {
    void mutation.mutateAsync({ dryRun: false, confirmed: true });
  };

  const isPending = mutation.isPending;
  const error = mutation.error;

  return (
    <section className={panelClass}>
      <div className="mb-3 flex items-center gap-2">
        <ShieldBan className="h-5 w-5 text-rose-600" />
        <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Пакетная минусация риск-кластеров</h2>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {(['high', 'medium', 'low'] as const).map((level) => {
          const enabled = riskLevels.includes(level);
          return (
            <label key={level} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => toggleRiskLevel(level, event.target.checked)}
              />
              {riskLabel(level)}
            </label>
          );
        })}
        <div className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm">
          <span className="text-slate-500">Лимит кластеров:</span>
          <input
            type="number"
            min={1}
            max={120}
            value={maxClusters}
            onChange={(event) => setMaxClusters(Number(event.target.value))}
            className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-sm"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onDryRun}
          className="rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700"
          disabled={isPending}
        >
          Тестовый прогон
        </button>
        <button
          type="button"
          onClick={onApply}
          className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
          disabled={isPending}
        >
          Выполнить
        </button>
        {needsConfirm ? (
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-xl bg-rose-600 px-3 py-2 text-sm font-semibold text-white"
            disabled={isPending}
          >
            Подтвердить минусацию
          </button>
        ) : null}
        {isPending ? (
          <span className="inline-flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Выполняем пакетную операцию...
          </span>
        ) : null}
        {error ? <span className="text-sm text-rose-600">{error.message}</span> : null}
      </div>

      {result ? (
        <div className="mt-4 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
          <p className="text-xs text-slate-600">
            Кластеров к обработке: {formatNumber(result.summary.selectedClusters)} ·
            Операций: {formatNumber(result.summary.queuedOperations)} ·
            Успешно: {formatNumber(result.summary.applied)} ·
            Ошибок: {formatNumber(result.summary.failed)}
          </p>
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="text-left uppercase tracking-wider text-slate-500">
                  <th scope="col" className="px-2 py-1">Кампания</th>
                  <th scope="col" className="px-2 py-1">nmId</th>
                  <th scope="col" className="px-2 py-1">Кластер</th>
                  <th scope="col" className="px-2 py-1">Риск</th>
                  <th scope="col" className="px-2 py-1">Метрика</th>
                </tr>
              </thead>
              <tbody>
                {result.operations.slice(0, 50).map((operation) => (
                  <tr key={`${operation.advertId}:${operation.nmId}:${operation.cluster}`} className="border-t border-slate-200">
                    <td className="px-2 py-1">{operation.advertId}</td>
                    <td className="px-2 py-1">{operation.nmId}</td>
                    <td className="px-2 py-1">{operation.cluster}</td>
                    <td className="px-2 py-1">{riskLabel(operation.riskLevel)}</td>
                    <td className="px-2 py-1">
                      {formatMoney(operation.adSpend)} · {formatNumber(operation.clicks)} / {formatNumber(operation.orders)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.errors.length > 0 ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-800/40 dark:bg-rose-900/20 dark:text-rose-300">
              <p className="font-semibold">Ошибки пакетной операции:</p>
              <ul className="mt-2 space-y-1">
                {result.errors.slice(0, 10).map((errorItem) => (
                  <li key={`${errorItem.advertId}:${errorItem.nmId}:${errorItem.cluster}`}>
                    Кампания {errorItem.advertId}, nmId {errorItem.nmId}, «{errorItem.cluster}»: {errorItem.error}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
