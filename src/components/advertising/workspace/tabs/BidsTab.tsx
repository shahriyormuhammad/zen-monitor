'use client';

import { useMemo, useState } from 'react';
import { Loader2, Target } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  formatDecimal,
  formatMoney,
  formatMoneyPrecise,
  formatNumber,
  formatPercent,
} from '../../_shared/format';
import { panelClass } from '../../_shared/ui';
import { useBidWorkspace } from '../context/BidWorkspaceContext';

export type BidMode = 'set' | 'delta_abs' | 'delta_pct';

export type BidWorkspaceRow = {
  cluster: string;
  currentBid: number;
  adSpend: number;
  clicks: number;
  orders: number;
  ctrPct: number | null;
  cpcRub: number | null;
  cpoRub: number | null;
  avgPos: number | null;
  acosProxyPct: number | null;
};

export type BidWorkspaceResponse = {
  rows: BidWorkspaceRow[];
  summary: {
    clusters: number;
    adSpend: number;
    highRiskClusters: number;
  };
};

export type BulkBidResult = {
  requiresConfirmation: boolean;
  summary: {
    selectedClusters: number;
    changedClusters: number;
    blockedByGuardrail: number;
    applyCount: number;
    failedCount: number;
  };
  rows: Array<{
    cluster: string;
    currentBid: number;
    nextBid: number;
    delta: number;
    changePct: number;
    apply: boolean;
    blockedReason: string | null;
    adSpend: number;
    clicks: number;
    orders: number;
    acosProxyPct: number | null;
    cpoRub: number | null;
  }>;
};

export function BidsTab() {
  const {
    tenantId,
    fromParam,
    toParam,
    selectedCluster,
    effectiveAdvertId,
    guardrailAcos,
    setGuardrailAcos,
    guardrailCpo,
    setGuardrailCpo,
    guardrailClicks,
    setGuardrailClicks,
    enableGuardrail,
    setEnableGuardrail,
    bidsQuery,
  } = useBidWorkspace();

  const queryClient = useQueryClient();

  const [bulkMode, setBulkMode] = useState<BidMode>('delta_pct');
  const [bulkValue, setBulkValue] = useState<number>(-10);
  const [bulkMinBid, setBulkMinBid] = useState<number>(100);
  const [bulkMaxBid, setBulkMaxBid] = useState<number>(5000);
  const [preview, setPreview] = useState<BulkBidResult | null>(null);
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [search, setSearch] = useState('');
  const [onlyHighRisk, setOnlyHighRisk] = useState(false);
  const [selectedClusters, setSelectedClusters] = useState<string[]>([]);

  const visibleRows = useMemo(() => {
    const rows = bidsQuery.data?.rows ?? [];
    const normalizedSearch = search.trim().toLocaleLowerCase('ru-RU');
    return rows.filter((row) => {
      if (onlyHighRisk && !(row.clicks >= guardrailClicks && row.orders === 0)) {
        return false;
      }
      if (!normalizedSearch) {
        return true;
      }
      return row.cluster.toLocaleLowerCase('ru-RU').includes(normalizedSearch);
    });
  }, [bidsQuery.data?.rows, search, onlyHighRisk, guardrailClicks]);

  const bulkBidMutation = useMutation<BulkBidResult, Error, { dryRun: boolean; confirmed: boolean }>({
    mutationFn: async ({ dryRun, confirmed }) => {
      if (!selectedCluster || !effectiveAdvertId) {
        throw new Error('Сначала выбери кластер и кампанию');
      }
      const response = await fetch(`/api/views/advertising/workspace/bids`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          advertId: effectiveAdvertId,
          nmId: selectedCluster.nmId,
          from: fromParam,
          to: toParam,
          mode: bulkMode,
          value: bulkValue,
          clusters: selectedClusters.length > 0 ? selectedClusters : undefined,
          minBid: bulkMinBid,
          maxBid: bulkMaxBid,
          dryRun,
          confirmed,
          guardrail: {
            enabled: enableGuardrail,
            maxAcosPct: guardrailAcos,
            maxCpoRub: guardrailCpo,
            minClicksWithoutOrders: guardrailClicks,
            preventIncreaseWithoutOrders: true,
          },
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload?.error === 'string' ? payload.error : 'Не удалось выполнить пакет ставок');
      }
      return payload;
    },
    onSuccess: (payload) => {
      setPreview(payload);
      setNeedsConfirm(payload.requiresConfirmation);
      if (!payload.requiresConfirmation) {
        void queryClient.invalidateQueries({ queryKey: ['adv-workspace-bids', tenantId, fromParam, toParam] });
      }
    },
  });

  const selectionDisabled = !selectedCluster || !effectiveAdvertId;

  return (
    <section className="space-y-4">
      <div className={panelClass}>
        <div className="mb-3 flex items-center gap-2">
          <Target className="h-5 w-5 text-emerald-600" />
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Массовое управление ставками</h2>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <div>
            <label className="text-xs font-semibold text-slate-500">Режим</label>
            <select
              value={bulkMode}
              onChange={(event) => setBulkMode(event.target.value as BidMode)}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="set">Установить фиксированную ставку</option>
              <option value="delta_abs">Изменить на сумму (± ₽)</option>
              <option value="delta_pct">Изменить на процент (± %)</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500">Значение</label>
            <input
              type="number"
              value={bulkValue}
              onChange={(event) => setBulkValue(Number(event.target.value))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500">Мин. ставка, ₽</label>
            <input
              type="number"
              value={bulkMinBid}
              onChange={(event) => setBulkMinBid(Number(event.target.value))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500">Макс. ставка, ₽</label>
            <input
              type="number"
              value={bulkMaxBid}
              onChange={(event) => setBulkMaxBid(Number(event.target.value))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm">
            <input type="checkbox" checked={enableGuardrail} onChange={(event) => setEnableGuardrail(event.target.checked)} />
            Защитный лимит ДРР/CPO
          </label>
          <div>
            <label className="text-xs font-semibold text-slate-500">Макс. ДРР, %</label>
            <input
              type="number"
              value={guardrailAcos}
              onChange={(event) => setGuardrailAcos(Number(event.target.value))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500">Макс. CPO, ₽</label>
            <input
              type="number"
              value={guardrailCpo}
              onChange={(event) => setGuardrailCpo(Number(event.target.value))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500">Мин. кликов без заказов</label>
            <input
              type="number"
              value={guardrailClicks}
              onChange={(event) => setGuardrailClicks(Number(event.target.value))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setNeedsConfirm(false);
              void bulkBidMutation.mutateAsync({ dryRun: true, confirmed: false });
            }}
            disabled={bulkBidMutation.isPending || selectionDisabled}
            className="rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-50"
          >
            Тестовый прогон
          </button>
          <button
            type="button"
            onClick={() => {
              setNeedsConfirm(false);
              void bulkBidMutation.mutateAsync({ dryRun: false, confirmed: false });
            }}
            disabled={bulkBidMutation.isPending || selectionDisabled}
            className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-black disabled:opacity-50"
          >
            Применить
          </button>
          {needsConfirm ? (
            <button
              type="button"
              onClick={() => { void bulkBidMutation.mutateAsync({ dryRun: false, confirmed: true }); }}
              disabled={bulkBidMutation.isPending}
              className="rounded-xl bg-rose-600 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-700"
            >
              Подтвердить применение
            </button>
          ) : null}
          {bulkBidMutation.isPending ? (
            <span className="inline-flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Выполняем операцию...
            </span>
          ) : null}
          {bulkBidMutation.error ? <span className="text-sm text-rose-600">{bulkBidMutation.error.message}</span> : null}
        </div>
      </div>

      <div className={panelClass}>
        <p className="mb-3 text-sm font-semibold text-slate-700">
          Текущие ставки {bidsQuery.data ? `(${formatNumber(bidsQuery.data.summary.clusters)})` : ''}
        </p>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Поиск по кластеру"
            className="min-w-[240px] flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm"
          />
          <label className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={onlyHighRisk}
              onChange={(event) => setOnlyHighRisk(event.target.checked)}
            />
            Только высокий риск
          </label>
          <button
            type="button"
            onClick={() => setSelectedClusters(visibleRows.map((row) => row.cluster))}
            className="rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700"
          >
            Выбрать все видимые
          </button>
          <button
            type="button"
            onClick={() => setSelectedClusters([])}
            className="rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700"
          >
            Снять выбор
          </button>
        </div>
        {bidsQuery.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Загружаем ставки...
          </div>
        ) : bidsQuery.error ? (
          <p className="text-sm text-rose-600">{bidsQuery.error.message}</p>
        ) : !(bidsQuery.data?.rows?.length) ? (
          <p className="text-sm text-slate-500">Нет ставок для выбранной кампании.</p>
        ) : visibleRows.length === 0 ? (
          <p className="text-sm text-slate-500">По фильтрам не найдено кластеров.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-slate-500">
                  <th scope="col" className="px-2 py-2">Выбор</th>
                  <th scope="col" className="px-2 py-2">Кластер</th>
                  <th scope="col" className="px-2 py-2">Текущая ставка</th>
                  <th scope="col" className="px-2 py-2">ДРР*</th>
                  <th scope="col" className="px-2 py-2">CPO</th>
                  <th scope="col" className="px-2 py-2">Ср. позиция</th>
                  <th scope="col" className="px-2 py-2">Расход</th>
                  <th scope="col" className="px-2 py-2">Клики/Заказы</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => {
                  const checked = selectedClusters.includes(row.cluster);
                  return (
                    <tr key={row.cluster} className="border-t border-slate-100">
                      <td className="px-2 py-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => {
                            setSelectedClusters(
                              event.target.checked
                                ? [...selectedClusters, row.cluster]
                                : selectedClusters.filter((item) => item !== row.cluster),
                            );
                          }}
                        />
                      </td>
                      <td className="px-2 py-2 font-semibold text-slate-800 dark:text-slate-200">{row.cluster}</td>
                      <td className="px-2 py-2">{formatMoneyPrecise(row.currentBid, 0)}</td>
                      <td className={`px-2 py-2 font-semibold ${
                        row.acosProxyPct !== null && row.acosProxyPct > guardrailAcos ? 'text-rose-600' : 'text-slate-700'
                      }`}>{formatPercent(row.acosProxyPct, 1)}</td>
                      <td className={`px-2 py-2 font-semibold ${
                        row.cpoRub !== null && row.cpoRub > guardrailCpo ? 'text-rose-600' : 'text-slate-700'
                      }`}>{formatMoneyPrecise(row.cpoRub, 2)}</td>
                      <td className="px-2 py-2">{formatDecimal(row.avgPos, 2)}</td>
                      <td className="px-2 py-2">{formatMoney(row.adSpend)}</td>
                      <td className="px-2 py-2">{formatNumber(row.clicks)} / {formatNumber(row.orders)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {preview ? (
        <div className={panelClass}>
          <p className="mb-2 text-sm font-bold text-slate-900 dark:text-slate-100">Результат операции</p>
          <p className="text-xs text-slate-500">
            Выбрано: {formatNumber(preview.summary.selectedClusters)} ·
            Изменяется: {formatNumber(preview.summary.changedClusters)} ·
            Блокировано защитой: {formatNumber(preview.summary.blockedByGuardrail)} ·
            К применению: {formatNumber(preview.summary.applyCount)} ·
            Ошибок: {formatNumber(preview.summary.failedCount)}
          </p>
        </div>
      ) : null}
    </section>
  );
}
