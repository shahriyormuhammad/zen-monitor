'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Loader2, ShieldBan } from 'lucide-react';

import { OperatorState } from '@/components/dashboard/OperatorState';

import type {
  ActionMessage,
  AdvertisingClusterControlResponse,
  AdvertisingClusterToggleResponse,
  SelectedCluster,
} from '../_shared/types';
import {
  formatDateTime,
  formatMoneyPrecise,
  formatNumber,
} from '../_shared/format';
import { statusLabel } from '../_shared/format';

type Props = {
  tenantId: string;
  selectedCluster: SelectedCluster;
  invalidationKeys?: unknown[][];
};

export function AdvertisingControl({
  tenantId,
  selectedCluster,
  invalidationKeys = [],
}: Props) {
  const queryClient = useQueryClient();
  const [actionMessage, setActionMessage] = useState<ActionMessage>(null);

  const clusterControlQuery = useQuery<AdvertisingClusterControlResponse | null, Error>({
    queryKey: [
      'advertising-cluster-control',
      tenantId,
      selectedCluster?.nmId ?? 0,
      selectedCluster?.cluster ?? '',
    ],
    queryFn: async () => {
      if (!selectedCluster) return null;
      const params = new URLSearchParams({
        tenantId,
        nmId: String(selectedCluster.nmId),
        cluster: selectedCluster.cluster,
      });
      const response = await fetch(
        `/api/views/advertising/clusters/actions?${params.toString()}`,
        { cache: 'no-store' },
      );
      if (!response.ok) {
        throw new Error('Не удалось загрузить состояние кластера');
      }
      return response.json();
    },
    enabled: Boolean(tenantId && selectedCluster),
  });

  const clusterToggleMutation = useMutation<
    AdvertisingClusterToggleResponse,
    Error,
    { advertId: number; mode: 'exclude' | 'include' }
  >({
    mutationFn: async ({ advertId, mode }) => {
      if (!selectedCluster) {
        throw new Error('Сначала выберите кластер');
      }
      const response = await fetch(
        `/api/views/advertising/clusters/actions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            advertId,
            nmId: selectedCluster.nmId,
            cluster: selectedCluster.cluster,
            mode,
          }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof payload?.error === 'string'
            ? payload.error
            : 'Не удалось применить действие по кластеру',
        );
      }
      return payload;
    },
    onSuccess: (result) => {
      setActionMessage({
        tone: 'success',
        text: result.changed
          ? `Кластер ${result.mode === 'exclude' ? 'исключён' : 'возвращён'} в кампанию ${result.advertId}`
          : 'Изменений не потребовалось: состояние уже актуально.',
      });
      void queryClient.invalidateQueries({
        queryKey: [
          'advertising-cluster-control',
          tenantId,
          selectedCluster?.nmId ?? 0,
          selectedCluster?.cluster ?? '',
        ],
      });
      for (const key of invalidationKeys) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
    onError: (error) => {
      setActionMessage({ tone: 'error', text: error.message });
    },
  });

  if (!selectedCluster) {
    return (
      <OperatorState
        icon={ShieldBan}
        tone="warning"
        title="Сначала выберите кластер"
        description="Откройте вкладку «Кластеры», выберите строку и перейдите к управлению."
      />
    );
  }

  if (clusterControlQuery.isLoading) {
    return (
      <div className="flex h-[45vh] flex-col items-center justify-center gap-3 text-slate-500">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        <p>Подтягиваем актуальное состояние кампаний по кластеру...</p>
      </div>
    );
  }

  if (clusterControlQuery.error) {
    return (
      <OperatorState
        icon={AlertTriangle}
        tone="danger"
        title="Не удалось получить состояние кластера"
        description={clusterControlQuery.error.message}
        actionLabel="Повторить"
        action={clusterControlQuery.refetch}
      />
    );
  }

  const control = clusterControlQuery.data;
  if (!control) {
    return (
      <OperatorState
        icon={ShieldBan}
        tone="warning"
        title="Нет данных по выбранному кластеру"
        description="Проверьте диапазон дат или выберите другой кластер."
      />
    );
  }

  return (
    <div className="space-y-4">
      {actionMessage ? (
        <section
          className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${
            actionMessage.tone === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-rose-200 bg-rose-50 text-rose-700'
          }`}
        >
          {actionMessage.text}
        </section>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Выбранный кластер</p>
        <p className="mt-2 text-lg font-extrabold text-slate-900">{control.cluster}</p>
        <p className="mt-1 text-sm text-slate-600">nmId {control.nmId}</p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-base font-bold text-slate-900">Кампании с этим SKU</h2>
          {clusterToggleMutation.isPending ? (
            <span className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Применяем изменения...
            </span>
          ) : null}
        </div>

        {control.campaigns.length === 0 ? (
          <p className="text-sm text-slate-500">Активные поисковые кампании для этого SKU не найдены.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {control.campaigns.map((campaign) => {
              const disableAction = clusterToggleMutation.isPending || !campaign.actionable;
              const nextMode: 'exclude' | 'include' = campaign.isExcluded ? 'include' : 'exclude';

              return (
                <article key={campaign.advertId} className="rounded-xl border border-slate-200 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="font-semibold text-slate-900">Кампания {campaign.advertId}</p>
                    <span
                      className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold ${
                        campaign.isExcluded
                          ? 'border-rose-200 bg-rose-50 text-rose-700'
                          : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      }`}
                    >
                      {campaign.isExcluded ? 'в минусе' : 'активен'}
                    </span>
                  </div>

                  <p className="text-xs text-slate-500">
                    Статус: {statusLabel(campaign.status)} · {campaign.paymentType ?? '—'} · текущая ставка: {formatMoneyPrecise(campaign.currentBid, 0)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Минус-фраз: {formatNumber(campaign.minusPhrasesCount)}
                  </p>

                  <button
                    type="button"
                    onClick={() => {
                      setActionMessage(null);
                      clusterToggleMutation.mutate({
                        advertId: campaign.advertId,
                        mode: nextMode,
                      });
                    }}
                    disabled={disableAction}
                    className={`mt-3 inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      campaign.isExcluded
                        ? 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-slate-300'
                        : 'bg-rose-600 text-white hover:bg-rose-700 disabled:bg-slate-300'
                    }`}
                  >
                    {campaign.isExcluded ? <CheckCircle2 className="h-4 w-4" /> : <ShieldBan className="h-4 w-4" />}
                    {campaign.isExcluded ? 'Вернуть в показы' : 'Добавить в минус'}
                  </button>

                  {!campaign.actionable ? (
                    <p className="mt-2 text-xs text-amber-700">Кампания в статусе без изменения параметров.</p>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-base font-bold text-slate-900">Рекомендуемые ставки (WB)</h2>
          {!control.recommendation ? (
            <p className="text-sm text-slate-500">Рекомендации недоступны (например, для не CPM-кампаний).</p>
          ) : (
            <div className="space-y-2 text-sm">
              <p className="font-semibold text-slate-800">Кампания {control.recommendation.advertId}</p>
              <p className="text-slate-600">Базовая конкурентная: {formatMoneyPrecise(control.recommendation.baseCompetitiveBidRub, 2)}</p>
              <p className="text-slate-600">Базовая для лидеров: {formatMoneyPrecise(control.recommendation.baseLeadersBidRub, 2)}</p>
              <p className="text-slate-600">Базовая топ-2: {formatMoneyPrecise(control.recommendation.baseTop2BidRub, 2)}</p>
              <div className="mt-3 rounded-xl bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">По выбранному кластеру</p>
                <p className="mt-1 text-slate-700">Охват мин.: {formatMoneyPrecise(control.recommendation.clusterReachMinRub, 2)}</p>
                <p className="text-slate-700">Охват средний: {formatMoneyPrecise(control.recommendation.clusterReachMediumRub, 2)}</p>
                <p className="text-slate-700">Охват макс.: {formatMoneyPrecise(control.recommendation.clusterReachMaxRub, 2)}</p>
                <p className="text-slate-700">Охват макс-мин.: {formatMoneyPrecise(control.recommendation.clusterReachMaxMinRub, 2)}</p>
              </div>
            </div>
          )}
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-base font-bold text-slate-900">История действий</h2>
          {control.recentActions.length === 0 ? (
            <p className="text-sm text-slate-500">Пока нет операций по этому кластеру.</p>
          ) : (
            <div className="space-y-2">
              {control.recentActions.map((log) => (
                <div key={log.id} className="rounded-lg border border-slate-200 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-slate-700">
                      {log.action === 'exclude' ? 'Добавлен в минус' : 'Возвращён в показы'} · кампания {log.advertId}
                    </p>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        log.status === 'success'
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-rose-100 text-rose-700'
                      }`}
                    >
                      {log.status}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {formatDateTime(log.createdAt)} · {log.beforeMinusCount} → {log.afterMinusCount}
                  </p>
                  {log.errorMessage ? <p className="mt-1 text-xs text-rose-600">{log.errorMessage}</p> : null}
                </div>
              ))}
            </div>
          )}
        </article>
      </section>
    </div>
  );
}
