'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  Clock,
  Factory,
  FileSpreadsheet,
  Loader2,
  MapPin,
  Package,
  PackageCheck,
  TrendingUp,
  Truck,
} from 'lucide-react';
import { exportPurchaseListXlsx } from './purchaseListExport';
import { OperatorState } from '@/components/dashboard/OperatorState';
import {
  formatCurrency,
  formatNumber,
  formatPercent,
} from '@/components/economics/helpers';
import type { StocksV2Payload, StockSkuRow } from '@/server/analytics/stocks-v2/types';

const URGENT_PREVIEW_LIMIT = 8;
type StatusFilter = Extract<StockSkuRow['status'], 'warning' | 'ok' | 'overstock'>;

const STATUS_FILTER_META: Record<StatusFilter, {
  emoji: string;
  label: string;
  tone: 'warning' | 'ok' | 'overstock';
}> = {
  warning: { emoji: '🟠', label: 'Скоро', tone: 'warning' },
  ok: { emoji: '🟢', label: 'Норма', tone: 'ok' },
  overstock: { emoji: '🔵', label: 'Перезатарка', tone: 'overstock' },
};

function readStatusFilterFromUrl(): StatusFilter | null {
  if (typeof window === 'undefined') return null;
  const value = new URLSearchParams(window.location.search).get('stockStatus');
  return value === 'warning' || value === 'ok' || value === 'overstock' ? value : null;
}

function updateStatusFilterUrl(status: StatusFilter | null) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (status) {
    url.searchParams.set('stockStatus', status);
  } else {
    url.searchParams.delete('stockStatus');
  }
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

function formatDaysLeftLabel(daysLeft: number): string {
  if (!Number.isFinite(daysLeft)) return '∞';
  return daysLeft < 1 ? '< 1 дня' : `${formatNumber(daysLeft, 1)} дн`;
}

function getStatusDescription(status: StatusFilter, leadTimeDays: number): string {
  if (status === 'warning') return `Покрытия меньше ${leadTimeDays + 14} дней`;
  if (status === 'ok') return `Покрытия ${leadTimeDays + 14}–${60 + leadTimeDays} дней`;
  return `Покрытия больше ${60 + leadTimeDays} дней`;
}

function getSortedStatusItems(items: StockSkuRow[], status: StatusFilter): StockSkuRow[] {
  return items
    .filter((item) => item.status === status)
    .sort((a, b) => {
      if (status === 'overstock') {
        const aInfinite = !Number.isFinite(a.daysLeft);
        const bInfinite = !Number.isFinite(b.daysLeft);
        if (aInfinite !== bInfinite) return aInfinite ? -1 : 1;
        return b.daysLeft - a.daysLeft || b.totalAvailable - a.totalAvailable;
      }
      return a.daysLeft - b.daysLeft || b.totalAvailable - a.totalAvailable;
    });
}

function Tile({
  icon: Icon,
  iconClass,
  label,
  value,
  hint,
  hintTone,
  href,
}: {
  icon: React.ElementType;
  iconClass: string;
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  hintTone?: 'ok' | 'warning' | 'critical' | 'muted';
  href?: string;
}) {
  const hintColor =
    hintTone === 'critical'
      ? 'text-rose-600 dark:text-rose-400'
      : hintTone === 'warning'
        ? 'text-amber-600 dark:text-amber-400'
        : hintTone === 'ok'
          ? 'text-emerald-600 dark:text-emerald-400'
          : 'text-muted-foreground';
  const inner = (
    <>
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className={`h-4 w-4 ${iconClass}`} />
        {label}
      </div>
      <div className="mt-1.5 text-2xl font-bold tabular-nums text-foreground">{value}</div>
      {hint ? <div className={`mt-1 text-xs font-medium ${hintColor}`}>{hint}</div> : null}
    </>
  );
  if (href) {
    return (
      <Link
        href={href}
        prefetch={false}
        aria-label={`Открыть раздел: ${label}`}
        className="group block rounded-2xl border border-border bg-card px-4 py-3 shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-500/60 hover:bg-muted/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
      >
        {inner}
      </Link>
    );
  }
  return (
    <div className="rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
      {inner}
    </div>
  );
}

function StatusCounterCard({
  emoji,
  label,
  description,
  count,
  tone,
  selected,
  onClick,
}: {
  emoji: string;
  label: string;
  description: string;
  count: number;
  tone: 'warning' | 'ok' | 'overstock';
  selected: boolean;
  onClick: () => void;
}) {
  const cardClass =
    tone === 'warning'
      ? 'border-amber-500/40 bg-amber-500/5'
      : tone === 'ok'
        ? 'border-emerald-500/40 bg-emerald-500/5'
        : 'border-sky-500/40 bg-sky-500/5';
  const labelClass =
    tone === 'warning'
      ? 'text-amber-700 dark:text-amber-300'
      : tone === 'ok'
        ? 'text-emerald-700 dark:text-emerald-300'
        : 'text-sky-700 dark:text-sky-300';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`w-full rounded-2xl border ${cardClass} px-4 py-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 ${
        selected ? 'ring-2 ring-emerald-500/35' : ''
      }`}
    >
      <div className={`flex items-center gap-2 text-sm font-semibold ${labelClass}`}>
        <span>{emoji}</span>
        {label}
      </div>
      <div className="mt-1 text-3xl font-bold text-foreground tabular-nums">{count}</div>
      <div className="text-[11px] text-muted-foreground">{description}</div>
    </button>
  );
}

function UrgentSkuRow({ item }: { item: StockSkuRow }) {
  const daysLeftLabel = formatDaysLeftLabel(item.daysLeft);
  return (
    <div className="flex items-center gap-3 border-b border-border/60 px-3 py-2.5 last:border-b-0">
      <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-lg border border-border bg-muted">
        {item.photoUrl ? (
          <Image
            src={item.photoUrl}
            alt=""
            width={48}
            height={48}
            className="h-full w-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground/60">
            IMG
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-foreground">
          {item.vendorCode ?? `nm ${item.nmId}`}
        </div>
        <div className="text-xs text-muted-foreground">
          {item.brand ?? '—'} · WB: {item.wbStock} шт · спрос {formatNumber(item.avgDailyDemand, 2)}/день
          {item.demandSource === 'sales_plan' ? ' · из плана' : ''}
        </div>
        <div className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">
          На {daysLeftLabel}
        </div>
      </div>
      <div className="text-right">
        <div className="text-sm font-bold tabular-nums text-foreground">
          👉 {item.recommendQty} шт
        </div>
        <div className="text-xs font-medium tabular-nums text-muted-foreground">
          {item.recommendCost != null
            ? formatCurrency(item.recommendCost, 0)
            : 'себест. не задана'}
        </div>
      </div>
    </div>
  );
}

function StatusSkuDetails({
  status,
  items,
  leadTimeDays,
  onClose,
}: {
  status: StatusFilter;
  items: StockSkuRow[];
  leadTimeDays: number;
  onClose: () => void;
}) {
  const meta = STATUS_FILTER_META[status];
  const description = getStatusDescription(status, leadTimeDays);

  return (
    <section className="rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <div className="flex items-center gap-2 text-base font-bold text-foreground">
            <span>{meta.emoji}</span>
            {meta.label}: {items.length} SKU
          </div>
          <div className="text-xs text-muted-foreground">{description}</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
        >
          Свернуть
        </button>
      </div>

      {items.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-muted-foreground">SKU в этой группе нет.</div>
      ) : (
        <div className="divide-y divide-border/70">
          {items.map((item) => (
            <div
              key={item.nmId}
              className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(260px,1.4fr)_120px_220px_150px] md:items-center"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-lg border border-border bg-muted">
                  {item.photoUrl ? (
                    <Image
                      src={item.photoUrl}
                      alt=""
                      width={48}
                      height={48}
                      className="h-full w-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground/60">
                      IMG
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-foreground">
                    {item.vendorCode ?? `nm ${item.nmId}`}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {item.brand ?? '—'} · nm {item.nmId}
                    {item.demandSource === 'sales_plan' ? ' · из плана' : ''}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    спрос {formatNumber(item.avgDailyDemand, 2)}/день
                  </div>
                </div>
              </div>

              <div className="rounded-lg bg-muted/40 px-3 py-2 md:text-right">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Хватит
                </div>
                <div className="font-bold tabular-nums text-foreground">
                  {formatDaysLeftLabel(item.daysLeft)}
                </div>
              </div>

              <div className="grid grid-cols-5 gap-1 rounded-lg bg-muted/30 px-2 py-2 text-center text-[11px]">
                <div>
                  <div className="font-semibold tabular-nums text-foreground">{formatNumber(item.wbStock, 0)}</div>
                  <div className="text-muted-foreground">WB</div>
                </div>
                <div>
                  <div className="font-semibold tabular-nums text-foreground">{formatNumber(item.ownStock, 0)}</div>
                  <div className="text-muted-foreground">свой</div>
                </div>
                <div>
                  <div className="font-semibold tabular-nums text-foreground">{formatNumber(item.chinaStock, 0)}</div>
                  <div className="text-muted-foreground">Китай</div>
                </div>
                <div>
                  <div className="font-semibold tabular-nums text-foreground">{formatNumber(item.inProduction, 0)}</div>
                  <div className="text-muted-foreground">произв.</div>
                </div>
                <div>
                  <div className="font-semibold tabular-nums text-foreground">{formatNumber(item.inTransit, 0)}</div>
                  <div className="text-muted-foreground">в пути</div>
                </div>
              </div>

              <div className="md:text-right">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Рекомендация
                </div>
                <div className="font-bold tabular-nums text-foreground">
                  {item.recommendQty > 0 ? `${formatNumber(item.recommendQty, 0)} шт` : 'не докупать'}
                </div>
                <div className="text-xs text-muted-foreground">
                  всего {formatNumber(item.totalAvailable, 0)} шт
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function RegionsStrip({ regions }: { regions: StocksV2Payload['regions'] }) {
  if (!regions || regions.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="text-sm text-muted-foreground">Региональных данных пока нет.</div>
      </div>
    );
  }
  const top = regions.slice(0, 8);
  const max = top.reduce((m, r) => Math.max(m, r.demandShare), 0) || 1;
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
        <MapPin className="h-4 w-4 text-emerald-500" />
        Карта спроса по федеральным округам
      </div>
      <div className="space-y-2">
        {top.map((r) => {
          const widthPct = max > 0 ? (r.demandShare / max) * 100 : 0;
          return (
            <div key={r.foName} className="flex items-center gap-3">
              <div className="w-32 truncate text-xs font-medium text-muted-foreground">
                {r.foName || 'Без региона'}
              </div>
              <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-emerald-500/70"
                  style={{ width: `${widthPct}%` }}
                />
              </div>
              <div className="w-16 text-right text-xs font-semibold tabular-nums text-foreground">
                {formatPercent(r.demandShare * 100, 0)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function StocksV2PageClient({ tenantId }: { tenantId: string }) {
  const [selectedStatus, setSelectedStatus] = useState<StatusFilter | null>(() => readStatusFilterFromUrl());
  const { data, isLoading, error, refetch } = useQuery<StocksV2Payload | null, Error>({
    queryKey: ['stocks-v2', tenantId],
    queryFn: async () => {
      const response = await fetch(
        `/api/views/stocks-v2?targetDays=30&leadTimeDays=46&demandPeriodDays=30`,
        { cache: 'no-store' },
      );
      if (!response.ok) throw new Error('Не удалось загрузить остатки');
      return response.json();
    },
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
  });

  useEffect(() => {
    const syncFromUrl = () => setSelectedStatus(readStatusFilterFromUrl());
    window.addEventListener('popstate', syncFromUrl);
    return () => window.removeEventListener('popstate', syncFromUrl);
  }, []);

  const selectStatus = (status: StatusFilter) => {
    const next = selectedStatus === status ? null : status;
    setSelectedStatus(next);
    updateStatusFilterUrl(next);
  };

  if (isLoading) {
    return (
      <div className="flex h-[55vh] flex-col items-center justify-center gap-4 text-emerald-600">
        <Loader2 className="h-10 w-10 animate-spin" />
        <p className="animate-pulse font-medium text-muted-foreground">Считаем остатки и план закупки…</p>
      </div>
    );
  }
  if (error) {
    return (
      <OperatorState
        icon={AlertTriangle}
        tone="danger"
        title="Не удалось загрузить остатки"
        description={error.message}
        actionLabel="Повторить запрос"
        action={refetch}
      />
    );
  }
  if (!data) {
    return (
      <OperatorState
        icon={Boxes}
        tone="default"
        title="Остатков пока нет"
        description="После первой синхронизации с WB здесь появятся данные по всем складам."
      />
    );
  }

  const { kpi, items, regions, planning } = data;

  // Sort: critical first by smallest daysLeft, then warning, then ok, then overstock.
  const sortedItems = [...items].sort((a, b) => {
    const order = { critical: 0, warning: 1, ok: 2, overstock: 3 } as const;
    const cmp = order[a.status] - order[b.status];
    if (cmp !== 0) return cmp;
    return a.daysLeft - b.daysLeft;
  });
  const urgentItems = sortedItems
    .filter((it) => it.status === 'critical' && it.recommendQty > 0)
    .slice(0, URGENT_PREVIEW_LIMIT);
  const selectedStatusItems = selectedStatus
    ? getSortedStatusItems(items, selectedStatus)
    : [];

  const totalDailyDemand = items.reduce((sum, it) => sum + (it.avgDailyDemand || 0), 0);
  const wbDaysLeft = totalDailyDemand > 0 ? kpi.wbStockTotal / totalDailyDemand : 0;
  const allDaysLeft = totalDailyDemand > 0 ? kpi.allStockTotal / totalDailyDemand : 0;

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 space-y-4 pb-10 duration-500">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <div className="flex items-center gap-2">
          <Link
            href="/stocks-v2/all-stock"
            prefetch={false}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
          >
            📦 Все остатки
          </Link>
          <Link
            href="/stocks-v2/own-stock"
            prefetch={false}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
          >
            🏪 Свой склад
          </Link>
          <Link
            href="/stocks-v2/china-stock"
            prefetch={false}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
          >
            🇨🇳 Склад Китай
          </Link>
          <Link
            href="/stocks-v2/batches"
            prefetch={false}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
          >
            🌏 Партии
          </Link>
          <Link
            href="/stocks-v2/by-warehouse"
            prefetch={false}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
          >
            🗂 По складам
          </Link>
          <Link
            href="/stocks-v2/wb-supplies"
            prefetch={false}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
          >
            ✅ WB-поставки
          </Link>
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-8">
        <Tile
          icon={Package}
          iconClass="text-emerald-500"
          label="WB склады"
          value={`${formatNumber(kpi.wbStockTotal, 0)} шт`}
          hint={
            wbDaysLeft > 0
              ? `на ~${formatNumber(wbDaysLeft, 0)} дней`
              : 'спроса нет'
          }
          hintTone={wbDaysLeft >= planning.leadTimeDays ? 'ok' : wbDaysLeft >= planning.leadTimeDays / 2 ? 'warning' : 'critical'}
          href="/stocks-v2/by-warehouse"
        />
        <Tile
          icon={Boxes}
          iconClass="text-amber-500"
          label="Свой склад"
          value={`${formatNumber(kpi.ownStockTotal, 0)} шт`}
          hint={kpi.ownStockTotal > 0 ? 'готово к отгрузке на WB' : 'пусто'}
          hintTone="muted"
          href="/stocks-v2/own-stock"
        />
        <Tile
          icon={MapPin}
          iconClass="text-red-500"
          label="Склад Китай"
          value={`${formatNumber(kpi.chinaStockTotal, 0)} шт`}
          hint={kpi.chinaStockTotal > 0 ? 'готово к отправке' : 'пусто'}
          hintTone="muted"
          href="/stocks-v2/china-stock"
        />
        <Tile
          icon={Factory}
          iconClass="text-violet-500"
          label="В производстве"
          value={`${formatNumber(kpi.inProductionTotal, 0)} шт`}
          hint={kpi.inProductionTotal > 0 ? 'у поставщика' : 'нет активных'}
          hintTone="muted"
          href="/stocks-v2/batches"
        />
        <Tile
          icon={Truck}
          iconClass="text-sky-500"
          label="В пути"
          value={`${formatNumber(kpi.inTransitTotal, 0)} шт`}
          hint={kpi.inTransitTotal > 0 ? 'едет к нам / на WB' : 'ничего не едет'}
          hintTone="muted"
          href="/stocks-v2/batches"
        />
        <Tile
          icon={PackageCheck}
          iconClass="text-emerald-500"
          label="Всего товаров"
          value={`${formatNumber(kpi.allStockTotal, 0)} шт`}
          hint={
            allDaysLeft > 0
              ? `на ~${formatNumber(allDaysLeft, 0)} дней`
              : 'спроса нет'
          }
          hintTone={allDaysLeft >= planning.leadTimeDays ? 'ok' : allDaysLeft >= planning.leadTimeDays / 2 ? 'warning' : 'critical'}
          href="/stocks-v2/all-stock"
        />
        <Tile
          icon={TrendingUp}
          iconClass="text-emerald-500"
          label="Локализация"
          value={
            kpi.avgLocalizationPercent != null
              ? formatPercent(kpi.avgLocalizationPercent, 0)
              : '—'
          }
          hint={
            kpi.avgLocalizationPercent != null
              ? kpi.avgLocalizationPercent >= 60
                ? 'WB не берёт доплату'
                : 'платим WB доплату за дальность'
              : 'нет данных от WB'
          }
          hintTone={
            kpi.avgLocalizationPercent != null && kpi.avgLocalizationPercent >= 60
              ? 'ok'
              : 'warning'
          }
          href="/stocks-v2/localization"
        />
        <Tile
          icon={PackageCheck}
          iconClass="text-sky-500"
          label="WB-поставки"
          value="журнал"
          hint="списания и расхождения"
          hintTone="muted"
          href="/stocks-v2/wb-supplies"
        />
      </div>

      {/* Critical / urgent SKUs */}
      <div className="rounded-2xl border-2 border-rose-500/40 bg-rose-500/5">
        <div className="flex items-center justify-between gap-3 border-b border-rose-500/30 px-4 py-3">
          <div className="flex items-center gap-2 text-base font-bold text-rose-700 dark:text-rose-300">
            <AlertTriangle className="h-5 w-5" />
            🔴 Срочно — закончится скоро
          </div>
          <div className="text-sm text-muted-foreground">
            {kpi.urgentSkuCount === 0 ? 'нет дефицитных SKU' : `${kpi.urgentSkuCount} SKU`}
          </div>
        </div>
        {kpi.urgentSkuCount === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            <CheckCircle2 className="mx-auto mb-2 h-6 w-6 text-emerald-500" />
            Дефицита нет — все SKU закроют lead-time без срочной закупки.
          </div>
        ) : (
          <>
            {urgentItems.map((item) => (
              <UrgentSkuRow key={item.nmId} item={item} />
            ))}
            <div className="flex items-center justify-between border-t-2 border-rose-500/20 bg-rose-500/10 px-4 py-3">
              <div className="text-sm font-semibold text-foreground">
                🛒 Итого: {kpi.urgentSkuCount} SKU ·{' '}
                {urgentItems.reduce((sum, it) => sum + it.recommendQty, 0).toLocaleString('ru-RU')} шт ·{' '}
                <span className="text-rose-700 dark:text-rose-400">
                  {formatCurrency(kpi.urgentBuyTotalRub, 0)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (data) {
                      void exportPurchaseListXlsx(data).catch((err) => {
                        console.error('[purchase-list-export]', err);
                      });
                    }
                  }}
                  disabled={!data || kpi.urgentSkuCount === 0}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:text-emerald-300"
                  title="Скачать .xlsx со списком SKU для закупки"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  Скачать Excel
                </button>
                <Link
                  href="/stocks-v2/batches"
                  prefetch={false}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-600"
                >
                  📦 Перейти к партиям
                </Link>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Status counters */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <StatusCounterCard
          emoji={STATUS_FILTER_META.warning.emoji}
          label={STATUS_FILTER_META.warning.label}
          description={getStatusDescription('warning', planning.leadTimeDays)}
          count={kpi.warningSkuCount}
          tone="warning"
          selected={selectedStatus === 'warning'}
          onClick={() => selectStatus('warning')}
        />
        <StatusCounterCard
          emoji={STATUS_FILTER_META.ok.emoji}
          label={STATUS_FILTER_META.ok.label}
          description={getStatusDescription('ok', planning.leadTimeDays)}
          count={kpi.okSkuCount}
          tone="ok"
          selected={selectedStatus === 'ok'}
          onClick={() => selectStatus('ok')}
        />
        <StatusCounterCard
          emoji={STATUS_FILTER_META.overstock.emoji}
          label={STATUS_FILTER_META.overstock.label}
          description={getStatusDescription('overstock', planning.leadTimeDays)}
          count={kpi.overstockSkuCount}
          tone="overstock"
          selected={selectedStatus === 'overstock'}
          onClick={() => selectStatus('overstock')}
        />
      </div>

      {selectedStatus ? (
        <StatusSkuDetails
          status={selectedStatus}
          items={selectedStatusItems}
          leadTimeDays={planning.leadTimeDays}
          onClose={() => {
            setSelectedStatus(null);
            updateStatusFilterUrl(null);
          }}
        />
      ) : null}

      {/* Regions */}
      <RegionsStrip regions={regions} />

      {/* Worst SKU footer */}
      {kpi.worstSku ? (
        <div className="rounded-xl border border-border bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
          <Clock className="mr-2 inline h-3.5 w-3.5" />
          Худший по запасу: <span className="font-semibold text-foreground">{kpi.worstSku.vendorCode ?? kpi.worstSku.nmId}</span>
          {' '}— осталось {kpi.worstSku.daysLeft < 1 ? '< 1 дня' : `${formatNumber(kpi.worstSku.daysLeft, 1)} дн`}.
        </div>
      ) : null}

      {/* Note about upcoming stages */}
      <div className="flex items-start gap-2 rounded-xl border border-dashed border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
        <PackageCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-500" />
        <div>
          Раздел считает общий запас из WB, своего склада, склада Китай, производства и доставки.
          Клик по карточкам открывает детализацию соответствующего слоя.
        </div>
      </div>
    </div>
  );
}
