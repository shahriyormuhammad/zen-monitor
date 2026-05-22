'use client';

import Image from 'next/image';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, BarChart3, Loader2, Megaphone, Search } from 'lucide-react';

import { OperatorState } from '@/components/dashboard/OperatorState';
import { getTerm } from '@/lib/advertising/terms';

import type {
  AdvertisingClusterListResponse,
  AdvertisingProductListRow,
  AdvertisingProductsResponse,
} from '../_shared/types';
import {
  formatMoney,
  formatMoneyPrecise,
  formatNumber,
  formatPercent,
} from '../_shared/format';
import { rankTone, riskChip, riskLabel } from '../_shared/ui';

type Props = {
  tenantId: string;
  fromParam: string;
  toParam: string;
};

type FastSummary = {
  adSpend: number;
  revenue: number;
  views: number;
  clicks: number;
  orders: number;
  objects: number;
  riskyObjects: number;
  acosPct: number | null;
  roas: number | null;
  ctrPct: number | null;
  cpc: number | null;
  cpo: number | null;
};

const REQUEST_TIMEOUT_MS = 15_000;

function round(value: number, precision = 2) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function pct(numerator: number, denominator: number) {
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  return round((numerator / denominator) * 100, 2);
}

function ratio(numerator: number, denominator: number) {
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  return round(numerator / denominator, 2);
}

async function fetchJsonWithTimeout<T>(url: string, fallbackMessage: string): Promise<T> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      cache: 'no-store',
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null) as { error?: string } | null;

    if (!response.ok) {
      throw new Error(payload?.error || fallbackMessage);
    }
    return payload as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`${fallbackMessage}: запрос дольше ${REQUEST_TIMEOUT_MS / 1000} секунд`);
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function buildSummary(rows: AdvertisingProductListRow[]): FastSummary {
  const adSpend = round(rows.reduce((sum, row) => sum + row.adSpend, 0), 2);
  const revenue = round(rows.reduce((sum, row) => sum + row.revenue, 0), 2);
  const views = rows.reduce((sum, row) => sum + row.views, 0);
  const clicks = rows.reduce((sum, row) => sum + row.clicks, 0);
  const orders = rows.reduce((sum, row) => sum + row.orders, 0);

  return {
    adSpend,
    revenue,
    views,
    clicks,
    orders,
    objects: rows.length,
    riskyObjects: rows.filter((row) => row.risk !== 'good').length,
    acosPct: pct(adSpend, revenue),
    roas: ratio(revenue, adSpend),
    ctrPct: pct(clicks, views),
    cpc: ratio(adSpend, clicks),
    cpo: ratio(adSpend, orders),
  };
}

function productTitle(row: AdvertisingProductListRow) {
  return row.title || row.brand || row.vendorCode || `nmId ${row.nmId}`;
}

function productKey(row: AdvertisingProductListRow) {
  return row.groupId ?? `sku:${row.nmId}`;
}

export function AdvertisingOverview({ tenantId, fromParam, toParam }: Props) {
  const productsQuery = useQuery<AdvertisingProductsResponse, Error>({
    queryKey: ['advertising-overview-fast-products', tenantId, fromParam, toParam],
    queryFn: () => fetchJsonWithTimeout<AdvertisingProductsResponse>(
      `/api/views/advertising/products?from=${fromParam}&to=${toParam}`,
      'Ошибка при загрузке подробной аналитики товаров',
    ),
    enabled: Boolean(tenantId),
    retry: 1,
  });

  const clustersQuery = useQuery<AdvertisingClusterListResponse, Error>({
    queryKey: ['advertising-overview-fast-clusters', tenantId, fromParam, toParam],
    queryFn: () => fetchJsonWithTimeout<AdvertisingClusterListResponse>(
      `/api/views/advertising/clusters?from=${fromParam}&to=${toParam}&limit=40`,
      'Ошибка при загрузке поисковых кластеров',
    ),
    enabled: Boolean(tenantId),
    retry: 1,
  });

  if (productsQuery.isLoading) {
    return (
      <div className="flex h-72 flex-col items-center justify-center gap-4 text-emerald-600">
        <Loader2 className="h-10 w-10 animate-spin" />
        <p className="animate-pulse font-medium text-slate-500">Собираем подробную аналитику рекламы...</p>
      </div>
    );
  }

  if (productsQuery.error) {
    return (
      <OperatorState
        icon={AlertTriangle}
        tone="danger"
        title="Не удалось собрать подробную аналитику"
        description={productsQuery.error.message}
        actionLabel="Повторить запрос"
        action={productsQuery.refetch}
      />
    );
  }

  const rows = productsQuery.data?.rows ?? [];
  const clusterRows = clustersQuery.data?.rows ?? [];

  if (rows.length === 0 && clusterRows.length === 0) {
    return (
      <OperatorState
        icon={Megaphone}
        tone="warning"
        title="По выбранному диапазону пока нет рекламных данных"
        description="Запустите синхронизацию рекламных данных и повторите загрузку."
        actionLabel="Перейти в настройки"
        actionHref="/settings"
      />
    );
  }

  const summary = buildSummary(rows);

  return (
    <div className="space-y-6">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Расход рекламы</p>
          <p className="mt-2 text-2xl font-extrabold text-slate-900">{formatMoney(summary.adSpend)}</p>
          <p className="mt-2 text-xs text-slate-500">По рекламируемым SKU и склейкам за период</p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Выручка WB</p>
          <p className="mt-2 text-2xl font-extrabold text-slate-900">{formatMoney(summary.revenue)}</p>
          <p className="mt-2 text-xs text-slate-500" title={getTerm('ROAS').tooltip}>
            {getTerm('ROAS').label}: {summary.roas === null ? '—' : `${summary.roas.toFixed(2)}×`}
          </p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500" title={getTerm('DRR').tooltip}>
            {getTerm('DRR').label}
          </p>
          <p className={`mt-2 text-2xl font-extrabold ${rankTone(summary.acosPct)}`}>
            {formatPercent(summary.acosPct)}
          </p>
          <p className="mt-2 text-xs text-slate-500" title={getTerm('CPO').tooltip}>
            {getTerm('CPO').label}: {formatMoneyPrecise(summary.cpo, 2)}
          </p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Трафик</p>
          <p className="mt-2 text-2xl font-extrabold text-slate-900">
            {formatNumber(summary.clicks)} / {formatNumber(summary.views)}
          </p>
          <p className="mt-2 text-xs text-slate-500">
            <span title={getTerm('CTR').tooltip}>{getTerm('CTR').label}</span>: {formatPercent(summary.ctrPct, 2)} ·{' '}
            <span title={getTerm('CPC').tooltip}>{getTerm('CPC').label}</span>: {formatMoneyPrecise(summary.cpc, 2)}
          </p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Заказы</p>
          <p className="mt-2 text-2xl font-extrabold text-slate-900">{formatNumber(summary.orders)}</p>
          <p className="mt-2 text-xs text-slate-500">Из рекламной статистики WB</p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Объекты в рекламе</p>
          <p className="mt-2 text-2xl font-extrabold text-slate-900">{formatNumber(summary.objects)}</p>
          <p className="mt-2 text-xs text-slate-500">Требуют внимания: {formatNumber(summary.riskyObjects)}</p>
        </article>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-emerald-600" />
          <h2 className="text-lg font-bold text-slate-900">Товары и склейки по расходу</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-slate-500">
                <th scope="col" className="px-3 py-2">Товар</th>
                <th scope="col" className="px-3 py-2">Расход</th>
                <th scope="col" className="px-3 py-2">Выручка</th>
                <th scope="col" className="px-3 py-2" title={getTerm('DRR').tooltip}>{getTerm('DRR').label}</th>
                <th scope="col" className="px-3 py-2">
                  <span title={getTerm('CTR').tooltip}>{getTerm('CTR').label}</span>
                  {' / '}
                  <span title={getTerm('CPC').tooltip}>{getTerm('CPC').label}</span>
                </th>
                <th scope="col" className="px-3 py-2">Клики / Заказы</th>
                <th scope="col" className="px-3 py-2">Статус</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 40).map((row) => (
                <tr key={productKey(row)} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <div className="flex min-w-[260px] items-center gap-3">
                      <div className="relative h-10 w-10 overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
                        {row.photoUrl ? (
                          <Image
                            src={row.photoUrl}
                            alt={productTitle(row)}
                            fill
                            sizes="40px"
                            className="object-cover"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[10px] font-bold text-slate-400">ФОТО</div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="line-clamp-1 font-semibold text-slate-800">{productTitle(row)}</p>
                        <p className="truncate text-xs text-slate-500">
                          nmId {row.nmId}{row.vendorCode ? ` · ${row.vendorCode}` : ''}
                        </p>
                        {row.attributionScope === 'group' ? (
                          <p
                            className="truncate text-[11px] font-semibold text-emerald-700"
                            title="Реклама и продажи считаются по всей склейке."
                          >
                            Склейка: {row.groupName ?? 'без названия'} · {row.groupNmCount} SKU
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 font-semibold text-slate-700">{formatMoney(row.adSpend)}</td>
                  <td className="px-3 py-2 font-semibold text-slate-700">{formatMoney(row.revenue)}</td>
                  <td className={`px-3 py-2 font-semibold ${rankTone(row.acosPct)}`} title={getTerm('DRR').tooltip}>{formatPercent(row.acosPct)}</td>
                  <td className="px-3 py-2 text-slate-700">
                    {formatPercent(row.ctrPct, 2)} / {formatMoneyPrecise(row.cpc, 2)}
                  </td>
                  <td className="px-3 py-2 text-slate-700">
                    {formatNumber(row.clicks)} / {formatNumber(row.orders)}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider ${
                      row.risk === 'danger'
                        ? 'border-rose-200 bg-rose-50 text-rose-700'
                        : row.risk === 'warning'
                          ? 'border-amber-200 bg-amber-50 text-amber-700'
                          : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    }`}>
                      {row.risk === 'danger' ? 'Проблема' : row.risk === 'warning' ? 'Внимание' : 'Норма'}
                    </span>
                    <p className="mt-1 max-w-[220px] text-xs text-slate-500">{row.reason}</p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Search className="h-5 w-5 text-emerald-600" />
          <h2 className="text-lg font-bold text-slate-900">Поисковые кластеры</h2>
        </div>

        {clustersQuery.isLoading ? (
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
            Загружаем кластеры...
          </div>
        ) : clustersQuery.error ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-700">
            {clustersQuery.error.message}
          </div>
        ) : clusterRows.length === 0 ? (
          <p className="text-sm font-semibold text-slate-500">Кластеры за выбранный период не найдены.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-slate-500">
                  <th scope="col" className="px-3 py-2">Кластер</th>
                  <th scope="col" className="px-3 py-2">SKU</th>
                  <th scope="col" className="px-3 py-2">Расход</th>
                  <th scope="col" className="px-3 py-2">Клики / Заказы</th>
                  <th scope="col" className="px-3 py-2">CTR / CPC</th>
                  <th scope="col" className="px-3 py-2">Риск</th>
                </tr>
              </thead>
              <tbody>
                {clusterRows.slice(0, 40).map((cluster) => (
                  <tr key={`${cluster.nmId}:${cluster.cluster}`} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-semibold text-slate-800">{cluster.cluster}</td>
                    <td className="px-3 py-2 text-slate-600">
                      nmId {cluster.nmId}
                      {cluster.vendorCode ? <p className="text-xs text-slate-500">{cluster.vendorCode}</p> : null}
                    </td>
                    <td className="px-3 py-2 font-semibold text-slate-700">{formatMoney(cluster.adSpend)}</td>
                    <td className="px-3 py-2 text-slate-700">
                      {formatNumber(cluster.clicks)} / {formatNumber(cluster.orders)}
                    </td>
                    <td className="px-3 py-2 text-slate-700">
                      {formatPercent(cluster.ctrPct, 2)} / {formatMoneyPrecise(cluster.cpc, 2)}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider ${riskChip(cluster.riskLevel)}`}>
                        {riskLabel(cluster.riskLevel)}
                      </span>
                      {cluster.riskReason ? (
                        <p className="mt-1 max-w-[240px] text-xs text-slate-500">{cluster.riskReason}</p>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
