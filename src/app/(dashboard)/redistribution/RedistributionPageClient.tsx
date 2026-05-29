'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  History,
  Loader2,
  MapPin,
  Package,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  TrendingUp,
  X,
} from 'lucide-react';

import { OperatorState } from '@/components/dashboard/OperatorState';
import { formatCurrency, formatNumber, formatPercent } from '@/components/economics/helpers';
import { resolveIrpFromLocalization, resolveLocalityIndexMultiplierFromLocalization as resolveKtrFromLocalization } from '@/components/economics/constants';
import { toLocalDateParam } from '@/lib/date-range';
import { useStore } from '@/store/useStore';
import type {
  RedistributionPlan,
  RedistributionTransferRecommendation,
} from '@/server/analytics/redistribution';

import { exportRedistributionXlsx } from './redistributionExport';
import { getRobotSessionStatus, type RobotSessionStatus } from './actions';
import { LocalizationView } from './LocalizationView';

const PAGE_SIZE = 20;

type RedistributionExecutionLog = {
  generatedAt: string;
  tenantId: string;
  windowHours: number;
  itemStatusCounts: Record<string, number>;
  items: Array<{
    id: string;
    status: string;
    nmId: number;
    vendorCode: string | null;
    brand: string | null;
    sizeName: string;
    fromWarehouse: string;
    fromOfficeId: number | null;
    toWarehouse: string;
    toOfficeId: number | null;
    transferUnits: number;
    executionNote: string | null;
    executedAt: string | null;
    createdAt: string | null;
    updatedAt: string | null;
    runId: string;
    runTriggerSource: string | null;
    runCreatedAt: string | null;
  }>;
  attempts: Array<{
    observedAt: string | null;
    fromWarehouse: string;
    toWarehouse: string;
    status: string;
    reason: string | null;
    source: string;
    runId: string | null;
    nmId: number | null;
    itemId: string | null;
    sizeName: string | null;
    fromOfficeId: number | null;
    toOfficeId: number | null;
    srcQuota: number | null;
    dstQuota: number | null;
    canSubmitUnits: number | null;
    submitted: boolean;
    submittedUnits: number;
  }>;
  monitorRuns: Array<{
    startedAt: string | null;
    finishedAt: string | null;
    triggerSource: string;
    mode: string;
    status: string;
    skipped: boolean;
    message: string | null;
    autoSubmit: boolean;
    maxRoutesPerTenant: number | null;
    probedItems: number;
    openedSlots: number;
  }>;
};

function formatDateTimeMsk(value: string | null) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  });
}

function executionStatusLabel(status: string) {
  if (status === 'rpa_submitted') return 'Создано в WB';
  if (status === 'rpa_failed') return 'Не создано';
  if (status === 'rpa_queued') return 'В очереди';
  if (status === 'rpa_running') return 'В работе';
  if (status === 'planned') return 'Ожидает слота';
  if (status === 'rejected') return 'Отклонено';
  return status;
}

function executionStatusClass(status: string) {
  if (status === 'rpa_submitted') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (status === 'rpa_failed') return 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300';
  if (status === 'rpa_running' || status === 'rpa_queued') return 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300';
  return 'border-border bg-muted text-muted-foreground';
}

function attemptStatusLabel(status: string, submitted: boolean) {
  if (submitted) return 'Заявка ушла';
  if (status === 'available') return 'Слот был';
  if (status === 'limit_exhausted') return 'Лимит ноль';
  if (status === 'route_unavailable') return 'Маршрут недоступен';
  if (status === 'transient_error') return 'Ошибка WB';
  return status;
}

function attemptStatusClass(status: string, submitted: boolean) {
  if (submitted || status === 'available') return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (status === 'transient_error') return 'bg-rose-500/10 text-rose-700 dark:text-rose-300';
  return 'bg-amber-500/10 text-amber-700 dark:text-amber-300';
}

function explainAttemptReason(reason: string | null) {
  if (!reason) return 'WB не вернул причину.';
  if (reason.includes('HTTP 429')) return 'WB ограничил частоту запросов. Монитор продолжит проверять с паузами.';
  if (reason === 'src_quota_zero') return 'На исходящем складе закончился суточный лимит отправки.';
  if (reason === 'dst_quota_zero') return 'На складе назначения закончился суточный лимит приёма.';
  if (reason === 'source_warehouse_not_found') return 'WB не отдал этот склад как доступный исходящий для артикула.';
  if (reason === 'destination_warehouse_not_found') return 'WB не отдал склад назначения для артикула.';
  if (reason === 'size_not_in_source_stock') return 'WB не видит нужный размер на исходном складе.';
  if (reason === 'source_stock_zero') return 'WB видит нулевой остаток на исходном складе.';
  if (reason === 'http_order_submitted') return 'WB принял заявку на перемещение.';
  return reason;
}

function HeroTile({
  icon: Icon,
  iconClass,
  label,
  primary,
  secondary,
  tone = 'default',
}: {
  icon: React.ElementType;
  iconClass: string;
  label: string;
  primary: React.ReactNode;
  secondary: React.ReactNode;
  tone?: 'ok' | 'warning' | 'critical' | 'default';
}) {
  const border =
    tone === 'ok'
      ? 'border-emerald-500/40 bg-emerald-500/5'
      : tone === 'warning'
        ? 'border-amber-500/40 bg-amber-500/5'
        : tone === 'critical'
          ? 'border-rose-500/40 bg-rose-500/5'
          : 'border-border bg-card';
  return (
    <div className={`rounded-2xl border ${border} px-5 py-4 shadow-sm`}>
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className={`h-4 w-4 ${iconClass}`} />
        {label}
      </div>
      <div className="mt-2 text-3xl font-bold tabular-nums text-foreground">{primary}</div>
      <div className="mt-1 text-xs text-muted-foreground">{secondary}</div>
    </div>
  );
}

function RobotStatusBlock({ status }: { status: RobotSessionStatus }) {
  let tone: 'ok' | 'warning' | 'critical' = 'critical';
  let title = '🔴 Робот не настроен';
  let body: React.ReactNode = (
    <>
      Перейдите в <Link href="/settings" className="font-medium text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-300">Настройки → WB ЛК</Link> и войдите через робота.
      Без этого «Завести в WB автоматически» не сработает — придётся скачивать Excel и заводить заявки руками.
    </>
  );

  if (status.hasSession && status.markedActive) {
    if (status.freshness === 'fresh') {
      tone = 'ok';
      title = '🟢 Робот готов';
      const ageStr = status.ageDays != null && status.ageDays > 0 ? ` (обновлено ${status.ageDays} дн назад)` : ' (свежая сессия)';
      body = <>Робот может зайти в WB и оформить заявки сам.{ageStr}</>;
    } else if (status.freshness === 'stale') {
      tone = 'warning';
      title = '🟡 Сессия давно не обновлялась';
      body = (
        <>
          Сессия живёт {status.ageDays} дней — пока работает, но рекомендуем
          перевойти в <Link href="/settings" className="font-medium text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-300">Настройках</Link>, чтобы куки не истекли.
        </>
      );
    } else {
      tone = 'critical';
      title = '🔴 Сессия устарела';
      body = (
        <>
          Прошло {status.ageDays ?? '—'} дней — нужно зайти заново в <Link href="/settings" className="font-medium text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-300">Настройках → WB ЛК</Link>.
        </>
      );
    }
  } else if (status.hasSession) {
    tone = 'warning';
    title = '🟡 Сессия есть, но не подтверждена';
    body = (
      <>
        Последний вход не был успешно подтверждён. Перейдите в <Link href="/settings" className="font-medium text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-300">Настройки → WB ЛК</Link> и войдите снова.
        {status.lastError ? <span className="mt-1 block opacity-70">Ошибка: {status.lastError.slice(0, 200)}</span> : null}
      </>
    );
  }

  const cls =
    tone === 'ok'
      ? 'border-emerald-500/40 bg-emerald-500/5'
      : tone === 'warning'
        ? 'border-amber-500/40 bg-amber-500/5'
        : 'border-rose-500/40 bg-rose-500/5';

  return (
    <div className={`rounded-2xl border ${cls} px-4 py-3 shadow-sm`}>
      <div className="text-sm font-semibold text-foreground">{title}</div>
      <div className="mt-1 text-xs text-muted-foreground">{body}</div>
    </div>
  );
}

type RecLeg = {
  fromWarehouse: string;
  toWarehouse: string;
  fromRegionName: string;
  toRegionName: string;
  totalUnits: number;
  savingsRub: number;
  sizes: { size: string; units: number }[];
};

type ArticleRecGroup = {
  nmId: number;
  vendorCode: string | null;
  brand: string | null;
  totalUnits: number;
  totalSavingsRub: number;
  maxPriority: number;
  localWeighted: number;
  simLocalWeighted: number;
  krpWeighted: number;
  simKrpWeighted: number;
  legs: Map<string, RecLeg>;
};

type ArticleRecRendered = Omit<ArticleRecGroup, 'legs'> & {
  legsList: RecLeg[];
  currentLocalSharePct: number;
  simulatedLocalSharePct: number;
  currentKrpPct: number;
  simulatedKrpPct: number;
};

/** Одна карточка-заявка на артикул: все маршруты и размеры внутри. */
function ArticleRecommendationCard({ group, rank }: { group: ArticleRecRendered; rank: number }) {
  const localDelta = group.simulatedLocalSharePct - group.currentLocalSharePct;
  const krpDelta = group.currentKrpPct - group.simulatedKrpPct;
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm transition-all hover:border-emerald-500/40 hover:shadow-md">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-bold text-muted-foreground">#{rank}</span>
          <h3 className="text-base font-semibold text-foreground">{group.vendorCode || `Артикул ${group.nmId}`}</h3>
          {group.brand && <span className="text-xs text-muted-foreground">· {group.brand}</span>}
          <span className="text-[11px] text-muted-foreground tabular-nums">{group.nmId}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-sky-500/10 px-2 py-0.5 text-xs font-bold text-sky-700 dark:text-sky-300">
            {group.totalUnits} шт · {group.legsList.length}{group.legsList.length === 1 ? ' маршрут' : ' маршр.'}
          </span>
          <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-xs font-bold text-emerald-700 dark:text-emerald-300">
            {formatCurrency(group.totalSavingsRub, 0)}/мес
          </span>
        </div>
      </div>

      {/* Маршруты артикула: каждый = откуда→куда + размеры */}
      <div className="mt-3 flex flex-col gap-2">
        {group.legsList.map((leg, i) => (
          <div key={i} className="rounded-xl border border-border bg-muted/30 p-2.5">
            <div className="flex flex-wrap items-center gap-1.5 text-sm">
              <span className="rounded-md border border-rose-500/30 bg-rose-500/5 px-2 py-0.5 text-[12px] font-medium text-foreground">{leg.fromWarehouse}</span>
              <ArrowRight className="h-4 w-4 text-emerald-500" />
              <span className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-2 py-0.5 text-[12px] font-medium text-foreground">{leg.toWarehouse}</span>
              <span className="ml-auto text-[12px] font-bold tabular-nums text-foreground">{leg.totalUnits} шт</span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {leg.sizes.map((s) => (
                <span key={s.size} className="inline-flex items-center gap-1 rounded-md bg-card px-1.5 py-0.5 font-mono text-[11px]">
                  {s.size} <span className="font-bold text-emerald-700 dark:text-emerald-300">×{s.units}</span>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Эффект по артикулу */}
      <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg border border-border bg-muted/30 p-2.5 text-xs">
        <div>
          <div className="text-muted-foreground">Локализация</div>
          <div className="font-semibold text-foreground tabular-nums">
            {formatPercent(group.currentLocalSharePct, 1)} → {formatPercent(group.simulatedLocalSharePct, 1)}
            {localDelta > 0 && <span className="ml-1 text-emerald-700 dark:text-emerald-400">(+{formatPercent(localDelta, 1)})</span>}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">Доплата WB за дальность</div>
          <div className="font-semibold text-foreground tabular-nums">
            {formatPercent(group.currentKrpPct, 2)} → {formatPercent(group.simulatedKrpPct, 2)}
            {krpDelta > 0 && <span className="ml-1 text-emerald-700 dark:text-emerald-400">(−{formatPercent(krpDelta, 2)})</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

function RecommendationCard({
  rec,
  rank,
}: {
  rec: RedistributionTransferRecommendation;
  rank: number;
}) {
  const localizationDelta = rec.simulatedLocalSharePct - rec.currentLocalSharePct;
  const krpDelta = rec.currentKrpPct - rec.simulatedKrpPct;
  const fromCoverage = rec.fromCoverageDaysBefore;
  const toCoverage = rec.toCoverageDaysBefore;
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm transition-all hover:border-emerald-500/40 hover:shadow-md">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-bold text-muted-foreground">
            #{rank}
          </span>
          <h3 className="text-base font-semibold text-foreground">
            {rec.vendorCode || `Артикул ${rec.nmId}`}
          </h3>
          {rec.brand && (
            <span className="text-xs text-muted-foreground">· {rec.brand}</span>
          )}
        </div>
        <div className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-xs font-bold text-emerald-700 dark:text-emerald-300">
          Сэкономит {formatCurrency(rec.estimatedSavingsRub, 0)}/мес
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>Размер: <span className="font-semibold text-foreground">{rec.sizeName}</span></span>
        <span>·</span>
        <span>Артикул WB: <span className="tabular-nums">{rec.nmId}</span></span>
      </div>

      {/* Маршрут */}
      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto_1fr_auto] md:items-center">
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-400">
            Откуда
          </div>
          <div className="mt-0.5 text-sm font-medium text-foreground">{rec.fromWarehouse}</div>
          <div className="text-[11px] text-muted-foreground">
            {rec.fromRegionName}
            {fromCoverage != null && (
              <span> · покрытие {formatNumber(fromCoverage, 0)} дн</span>
            )}
          </div>
        </div>
        <ArrowRight className="hidden h-5 w-5 text-emerald-500 md:block" />
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
            Куда
          </div>
          <div className="mt-0.5 text-sm font-medium text-foreground">{rec.toWarehouse}</div>
          <div className="text-[11px] text-muted-foreground">
            {rec.toRegionName}
            {toCoverage != null && (
              <span> · покрытие {formatNumber(toCoverage, 0)} дн</span>
            )}
          </div>
        </div>
        <div className="flex flex-col items-center justify-center rounded-lg border-2 border-emerald-500 bg-emerald-500/10 px-3 py-2 text-center">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
            Перевезти
          </div>
          <div className="text-2xl font-bold tabular-nums text-foreground">{rec.transferUnits}</div>
          <div className="text-[10px] text-muted-foreground">шт</div>
        </div>
      </div>

      {/* Эффект */}
      <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg border border-border bg-muted/30 p-2.5 text-xs">
        <div>
          <div className="text-muted-foreground">Локализация SKU</div>
          <div className="font-semibold text-foreground tabular-nums">
            {formatPercent(rec.currentLocalSharePct, 1)} → {formatPercent(rec.simulatedLocalSharePct, 1)}
            {localizationDelta > 0 && (
              <span className="ml-1 text-emerald-700 dark:text-emerald-400">
                (+{formatPercent(localizationDelta, 1)})
              </span>
            )}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">Доплата WB за дальность</div>
          <div className="font-semibold text-foreground tabular-nums">
            {formatPercent(rec.currentKrpPct, 2)} → {formatPercent(rec.simulatedKrpPct, 2)}
            {krpDelta > 0 && (
              <span className="ml-1 text-emerald-700 dark:text-emerald-400">
                (−{formatPercent(krpDelta, 2)})
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Pagination({
  currentPage,
  totalPages,
  onChange,
}: {
  currentPage: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  // Считаем какие страницы показать в навигации (с многоточиями для длинных списков).
  const pages: Array<number | '…'> = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (currentPage > 3) pages.push('…');
    const from = Math.max(2, currentPage - 1);
    const to = Math.min(totalPages - 1, currentPage + 1);
    for (let i = from; i <= to; i++) pages.push(i);
    if (currentPage < totalPages - 2) pages.push('…');
    pages.push(totalPages);
  }

  return (
    <div className="flex items-center gap-1 text-xs">
      <button
        type="button"
        onClick={() => onChange(Math.max(1, currentPage - 1))}
        disabled={currentPage <= 1}
        className="rounded-md border border-border bg-card px-2 py-1 font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
      >
        ← Назад
      </button>
      {pages.map((p, idx) =>
        p === '…' ? (
          <span key={`dots-${idx}`} className="px-1 text-muted-foreground">
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            className={`min-w-[28px] rounded-md px-2 py-1 font-medium tabular-nums transition-colors ${
              p === currentPage
                ? 'bg-emerald-500 text-white'
                : 'border border-border bg-card text-foreground hover:bg-muted'
            }`}
          >
            {p}
          </button>
        ),
      )}
      <button
        type="button"
        onClick={() => onChange(Math.min(totalPages, currentPage + 1))}
        disabled={currentPage >= totalPages}
        className="rounded-md border border-border bg-card px-2 py-1 font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
      >
        Вперёд →
      </button>
    </div>
  );
}

function ExecutionLogBlock({
  log,
  loading,
  refreshing,
  runningSlotMonitor,
  manualSubmitMessage,
  onRefresh,
  onRunSlotMonitor,
}: {
  log: RedistributionExecutionLog | null | undefined;
  loading: boolean;
  refreshing: boolean;
  runningSlotMonitor: boolean;
  manualSubmitMessage: string | null;
  onRefresh: () => void;
  onRunSlotMonitor: () => void;
}) {
  const submitted = log?.itemStatusCounts.rpa_submitted ?? 0;
  const planned = log?.itemStatusCounts.planned ?? 0;
  const queued = (log?.itemStatusCounts.rpa_queued ?? 0) + (log?.itemStatusCounts.rpa_running ?? 0);
  const lastRun = log?.monitorRuns[0] ?? null;
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'items' | 'attempts'>('items');
  const visibleItems = log?.items.slice(0, 6) ?? [];
  const visibleAttempts = log?.attempts.slice(0, 6) ?? [];

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-[280px] flex-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <History className="h-4 w-4 text-emerald-500" />
            Автосоздание
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>Создано: <b className="text-foreground">{submitted}</b></span>
            <span>В очереди: <b className="text-foreground">{queued}</b></span>
            <span>Ждёт слота: <b className="text-foreground">{planned}</b></span>
          </div>
          {lastRun ? (
            <div className="mt-1 truncate text-xs text-muted-foreground">
              Последняя проверка: {formatDateTimeMsk(lastRun.startedAt)} · {lastRun.message ?? lastRun.status}
            </div>
          ) : null}
          {manualSubmitMessage ? (
            <div className="mt-1 truncate text-xs text-muted-foreground">
              Ручной запуск: <span className="font-semibold text-foreground">{manualSubmitMessage}</span>
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Обновить
          </button>
          <button
            type="button"
            onClick={onRunSlotMonitor}
            disabled={runningSlotMonitor}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {runningSlotMonitor ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Создать в WB сейчас
          </button>
          <button
            type="button"
            onClick={() => setDetailsOpen((value) => !value)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
          >
            <History className="h-3.5 w-3.5" />
            {detailsOpen ? 'Скрыть журнал' : 'Журнал'}
          </button>
        </div>
      </div>

      {loading && detailsOpen ? (
        <div className="px-4 py-5 text-sm text-muted-foreground">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
          Загружаю журнал…
        </div>
      ) : null}

      {detailsOpen && !loading ? (
        <div className="border-t border-border px-4 py-3">
          <div className="mb-3 inline-flex rounded-lg border border-border bg-muted/30 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setActiveTab('items')}
              className={`rounded-md px-3 py-1.5 font-semibold ${
                activeTab === 'items' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Заявки
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('attempts')}
              className={`rounded-md px-3 py-1.5 font-semibold ${
                activeTab === 'attempts' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Попытки WB
            </button>
          </div>

          {activeTab === 'items' ? (
            visibleItems.length > 0 ? (
              <div className="overflow-hidden rounded-lg border border-border">
                {visibleItems.map((item) => (
                  <div
                    key={item.id}
                    className="grid grid-cols-1 gap-1 border-b border-border px-3 py-2 text-xs last:border-b-0 md:grid-cols-[1.2fr_1.4fr_auto]"
                  >
                    <div className="font-semibold text-foreground">
                      {item.vendorCode || item.nmId} · {item.sizeName}
                    </div>
                    <div className="text-muted-foreground">
                      {item.fromWarehouse} → {item.toWarehouse} · {item.transferUnits} шт · {formatDateTimeMsk(item.executedAt ?? item.updatedAt)}
                    </div>
                    <div className="md:text-right">
                      <span className={`rounded-md border px-2 py-0.5 font-semibold ${executionStatusClass(item.status)}`}>
                        {executionStatusLabel(item.status)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">
                Заявок в журнале пока нет.
              </div>
            )
          ) : visibleAttempts.length > 0 ? (
            <div className="overflow-hidden rounded-lg border border-border">
              {visibleAttempts.map((attempt, idx) => (
                <div
                  key={`${attempt.observedAt}-${attempt.itemId ?? idx}-${attempt.fromWarehouse}-${attempt.toWarehouse}`}
                  className="grid grid-cols-1 gap-1 border-b border-border px-3 py-2 text-xs last:border-b-0 md:grid-cols-[1.2fr_1.4fr_auto]"
                >
                  <div className="font-semibold text-foreground">
                    {attempt.nmId ?? 'маршрут'}{attempt.sizeName ? ` · ${attempt.sizeName}` : ''}
                  </div>
                  <div className="text-muted-foreground">
                    {attempt.fromWarehouse} → {attempt.toWarehouse} · src={attempt.srcQuota ?? '-'} · dst={attempt.dstQuota ?? '-'} · {formatDateTimeMsk(attempt.observedAt)}
                  </div>
                  <div className="md:text-right">
                    <span className={`rounded-md px-2 py-0.5 font-semibold ${attemptStatusClass(attempt.status, attempt.submitted)}`}>
                      {attemptStatusLabel(attempt.status, attempt.submitted)}
                    </span>
                  </div>
                  <div className="text-muted-foreground md:col-span-3">
                    {explainAttemptReason(attempt.reason)}
                    {attempt.submitted ? ` · ушло ${attempt.submittedUnits} шт` : ''}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">
              За последние {log?.windowHours ?? 168} ч попыток не найдено.
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

type WarehouseOption = {
  name: string;
  officeId: number | null;
};

type ManualRequestFormState = {
  nmId: string;
  vendorCode: string;
  sizeName: string;
  transferUnits: string;
  fromWarehouse: string;
  toWarehouse: string;
};

const emptyManualRequestForm: ManualRequestFormState = {
  nmId: '',
  vendorCode: '',
  sizeName: 'Без размера',
  transferUnits: '',
  fromWarehouse: '',
  toWarehouse: '',
};

function normalizeWarehouseOptionName(value: string) {
  return value
    .toLowerCase()
    .replace(/[«»"']/g, '')
    .replace(/\bwb\b/g, '')
    .replace(/[^a-zа-яё0-9]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveWarehouseOfficeId(options: WarehouseOption[], warehouseName: string) {
  const key = normalizeWarehouseOptionName(warehouseName);
  const ids = Array.from(new Set(
    options
      .filter((option) => normalizeWarehouseOptionName(option.name) === key)
      .map((option) => option.officeId)
      .filter((officeId): officeId is number => officeId != null),
  ));
  return ids.length === 1 ? ids[0] : null;
}

function ManualRequestBlock({
  warehouseOptions,
  onCreated,
}: {
  warehouseOptions: WarehouseOption[];
  onCreated: (submitNow: boolean) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ManualRequestFormState>(emptyManualRequestForm);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creatingMode, setCreatingMode] = useState<'queue' | 'submit' | null>(null);
  const datalistId = 'redistribution-manual-warehouse-options';

  const updateField = (field: keyof ManualRequestFormState, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const submitManualRequest = async (submitNow: boolean) => {
    setError(null);
    setMessage(null);
    setCreatingMode(submitNow ? 'submit' : 'queue');
    try {
      const payload = {
        nmId: form.nmId,
        vendorCode: form.vendorCode,
        sizeName: form.sizeName,
        transferUnits: form.transferUnits,
        fromWarehouse: form.fromWarehouse,
        fromOfficeId: resolveWarehouseOfficeId(warehouseOptions, form.fromWarehouse),
        toWarehouse: form.toWarehouse,
        toOfficeId: resolveWarehouseOfficeId(warehouseOptions, form.toWarehouse),
      };
      const res = await fetch('/api/views/redistribution/manual-request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        cache: 'no-store',
      });
      const data = await res.json().catch(() => null) as { message?: string; error?: string } | null;
      if (!res.ok) {
        setError(data?.error ?? `Не удалось добавить заявку: HTTP ${res.status}`);
        return;
      }
      setMessage(data?.message ?? 'Ручная заявка добавлена в очередь.');
      setForm(emptyManualRequestForm);
      await onCreated(submitNow);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось добавить заявку.');
    } finally {
      setCreatingMode(null);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Plus className="h-4 w-4 text-emerald-500" />
            Ручная заявка
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Добавить перемещение в очередь без рекомендации алгоритма.
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
        >
          {open ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          {open ? 'Скрыть' : 'Добавить'}
        </button>
      </div>

      {open ? (
        <div className="border-t border-border px-4 py-3">
          <datalist id={datalistId}>
            {warehouseOptions.map((option) => (
              <option key={`${option.name}-${option.officeId ?? 'none'}`} value={option.name} />
            ))}
          </datalist>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
            <label className="md:col-span-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Артикул WB</span>
              <input
                value={form.nmId}
                onChange={(event) => updateField('nmId', event.target.value)}
                inputMode="numeric"
                className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors focus:border-emerald-500"
                placeholder="178896573"
              />
            </label>
            <label className="md:col-span-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Размер</span>
              <input
                value={form.sizeName}
                onChange={(event) => updateField('sizeName', event.target.value)}
                className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors focus:border-emerald-500"
                placeholder="Без размера"
              />
            </label>
            <label className="md:col-span-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Штук</span>
              <input
                value={form.transferUnits}
                onChange={(event) => updateField('transferUnits', event.target.value)}
                inputMode="numeric"
                className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors focus:border-emerald-500"
                placeholder="10"
              />
            </label>
            <label className="md:col-span-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Название</span>
              <input
                value={form.vendorCode}
                onChange={(event) => updateField('vendorCode', event.target.value)}
                className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors focus:border-emerald-500"
                placeholder="необязательно"
              />
            </label>
            <label className="md:col-span-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Откуда</span>
              <input
                value={form.fromWarehouse}
                onChange={(event) => updateField('fromWarehouse', event.target.value)}
                list={datalistId}
                className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors focus:border-emerald-500"
                placeholder="Тула"
              />
            </label>
            <label className="md:col-span-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Куда</span>
              <input
                value={form.toWarehouse}
                onChange={(event) => updateField('toWarehouse', event.target.value)}
                list={datalistId}
                className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors focus:border-emerald-500"
                placeholder="Сарапул WB"
              />
            </label>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div className="min-h-5 text-xs">
              {error ? <span className="text-rose-600 dark:text-rose-300">{error}</span> : null}
              {message ? <span className="text-emerald-700 dark:text-emerald-300">{message}</span> : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => submitManualRequest(false)}
                disabled={creatingMode !== null}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
              >
                {creatingMode === 'queue' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                Добавить в очередь
              </button>
              <button
                type="button"
                onClick={() => submitManualRequest(true)}
                disabled={creatingMode !== null}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {creatingMode === 'submit' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                Добавить и создать в WB
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function RedistributionPageClient({ tenantId: tenantIdProp }: { tenantId?: string }) {
  const { tenantId: tenantIdFromStore, dateFrom, dateTo } = useStore();
  const tenantId = tenantIdProp ?? tenantIdFromStore;
  const fromParam = toLocalDateParam(dateFrom);
  const toParam = toLocalDateParam(dateTo);

  const planQuery = useQuery<RedistributionPlan | null, Error>({
    queryKey: ['redistribution-plan-v2', tenantId, fromParam, toParam],
    queryFn: async () => {
      if (!tenantId) return null;
      const res = await fetch(
        `/api/views/redistribution?from=${fromParam}&to=${toParam}`,
        { cache: 'no-store' },
      );
      if (!res.ok) throw new Error('Не удалось рассчитать план перераспределения');
      return res.json();
    },
    enabled: Boolean(tenantId),
    staleTime: 60_000,
  });

  // Параллельный запрос на «настоящее» значение локализации из funnel_stats.
  // redistribution.ts считает локализацию по stock_sizes-матрице (прогнозную),
  // что расходится с WB-кабинетом на ~6-7 п.п. Чтобы KPI совпадало с тем что
  // видит продавец у WB, берём то же значение что и /stocks-v2/localization.
  const stocksLocQuery = useQuery<{ kpi: { avgLocalizationPercent: number | null } } | null, Error>({
    queryKey: ['redistribution-real-localization', tenantId],
    queryFn: async () => {
      if (!tenantId) return null;
      const res = await fetch('/api/views/stocks-v2?targetDays=30&leadTimeDays=46&demandPeriodDays=30', {
        cache: 'no-store',
      });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: Boolean(tenantId),
    staleTime: 60_000,
  });

  const robotQuery = useQuery<RobotSessionStatus | null, Error>({
    queryKey: ['redistribution-robot-status', tenantId],
    queryFn: async () => (tenantId ? getRobotSessionStatus(tenantId) : null),
    enabled: Boolean(tenantId),
    staleTime: 30_000,
  });

  const executionLogQuery = useQuery<RedistributionExecutionLog | null, Error>({
    queryKey: ['redistribution-execution-log', tenantId],
    queryFn: async () => {
      if (!tenantId) return null;
      const res = await fetch('/api/views/redistribution/execution-log', {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('Не удалось загрузить журнал перераспределения');
      return res.json();
    },
    enabled: Boolean(tenantId),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });

  const [exporting, setExporting] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [runningSlotMonitor, setRunningSlotMonitor] = useState(false);
  const [manualSubmitMessage, setManualSubmitMessage] = useState<string | null>(null);
  // Горизонт WB-пересчёта индекса (скользящее окно 13 недель).
  const [horizonWeeks, setHorizonWeeks] = useState<1 | 13>(13);
  // Активная вкладка раздела: рекомендации / индекс локализации.
  const [redistView, setRedistView] = useState<'recs' | 'localization'>('recs');

  const sortedRecommendations = useMemo(() => {
    const recs = planQuery.data?.recommendations ?? [];
    return [...recs].sort((a, b) => b.priorityScore - a.priorityScore);
  }, [planQuery.data]);

  // Группировка: одна карточка-заявка на артикул, внутри — маршруты
  // (откуда→куда), а в каждом маршруте список размеров. Так 519-10 не
  // распадается на 5 строк по размерам, а собирается в одну заявку.
  const groupedByArticle = useMemo(() => {
    const byNm = new Map<number, ArticleRecGroup>();
    for (const rec of sortedRecommendations) {
      let g = byNm.get(rec.nmId);
      if (!g) {
        g = {
          nmId: rec.nmId,
          vendorCode: rec.vendorCode,
          brand: rec.brand,
          totalUnits: 0,
          totalSavingsRub: 0,
          maxPriority: 0,
          localWeighted: 0,
          simLocalWeighted: 0,
          krpWeighted: 0,
          simKrpWeighted: 0,
          legs: new Map(),
        };
        byNm.set(rec.nmId, g);
      }
      const routeKey = `${rec.fromWarehouse} → ${rec.toWarehouse}`;
      let leg = g.legs.get(routeKey);
      if (!leg) {
        leg = {
          fromWarehouse: rec.fromWarehouse,
          toWarehouse: rec.toWarehouse,
          fromRegionName: rec.fromRegionName,
          toRegionName: rec.toRegionName,
          totalUnits: 0,
          savingsRub: 0,
          sizes: [],
        };
        g.legs.set(routeKey, leg);
      }
      leg.sizes.push({ size: rec.sizeName, units: rec.transferUnits });
      leg.totalUnits += rec.transferUnits;
      leg.savingsRub += rec.estimatedSavingsRub;
      g.totalUnits += rec.transferUnits;
      g.totalSavingsRub += rec.estimatedSavingsRub;
      g.maxPriority = Math.max(g.maxPriority, rec.priorityScore);
      g.localWeighted += rec.currentLocalSharePct * rec.transferUnits;
      g.simLocalWeighted += rec.simulatedLocalSharePct * rec.transferUnits;
      g.krpWeighted += rec.currentKrpPct * rec.transferUnits;
      g.simKrpWeighted += rec.simulatedKrpPct * rec.transferUnits;
    }
    return Array.from(byNm.values())
      .map((g) => ({
        ...g,
        legsList: Array.from(g.legs.values())
          .map((leg) => ({
            ...leg,
            sizes: leg.sizes.slice().sort((a, b) => parseFloat(a.size) - parseFloat(b.size)),
          }))
          .sort((a, b) => b.totalUnits - a.totalUnits),
        currentLocalSharePct: g.totalUnits > 0 ? g.localWeighted / g.totalUnits : 0,
        simulatedLocalSharePct: g.totalUnits > 0 ? g.simLocalWeighted / g.totalUnits : 0,
        currentKrpPct: g.totalUnits > 0 ? g.krpWeighted / g.totalUnits : 0,
        simulatedKrpPct: g.totalUnits > 0 ? g.simKrpWeighted / g.totalUnits : 0,
      }))
      .sort((a, b) => b.maxPriority - a.maxPriority);
  }, [sortedRecommendations]);

  const warehouseOptions = useMemo(() => {
    const options = new Map<string, WarehouseOption>();
    const addWarehouse = (name: string | null | undefined, officeId: number | null | undefined) => {
      const safeName = name?.replace(/\s+/g, ' ').trim();
      if (!safeName) return;
      const key = normalizeWarehouseOptionName(safeName);
      const existing = options.get(key);
      if (!existing || (existing.officeId == null && officeId != null)) {
        options.set(key, { name: safeName, officeId: officeId ?? null });
      }
    };

    for (const rec of sortedRecommendations) {
      addWarehouse(rec.fromWarehouse, rec.fromOfficeId);
      addWarehouse(rec.toWarehouse, rec.toOfficeId);
    }
    for (const item of executionLogQuery.data?.items ?? []) {
      addWarehouse(item.fromWarehouse, item.fromOfficeId);
      addWarehouse(item.toWarehouse, item.toOfficeId);
    }
    for (const attempt of executionLogQuery.data?.attempts ?? []) {
      addWarehouse(attempt.fromWarehouse, attempt.fromOfficeId);
      addWarehouse(attempt.toWarehouse, attempt.toOfficeId);
    }

    return Array.from(options.values()).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [executionLogQuery.data, sortedRecommendations]);

  // Пагинация по АРТИКУЛАМ (сгруппированным заявкам), не по строкам размеров.
  const totalPages = Math.max(1, Math.ceil(groupedByArticle.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const pageEnd = Math.min(pageStart + PAGE_SIZE, groupedByArticle.length);
  const pagedGroups = groupedByArticle.slice(pageStart, pageEnd);

  if (planQuery.isLoading) {
    return (
      <div className="flex h-[55vh] flex-col items-center justify-center gap-4 text-emerald-600">
        <Loader2 className="h-10 w-10 animate-spin" />
        <p className="animate-pulse font-medium text-muted-foreground">
          Считаем что куда везти…
        </p>
      </div>
    );
  }
  if (planQuery.error) {
    return (
      <OperatorState
        icon={AlertCircle}
        tone="danger"
        title="Не удалось рассчитать план"
        description={planQuery.error.message}
        actionLabel="Повторить"
        action={() => planQuery.refetch()}
      />
    );
  }
  if (!planQuery.data) {
    return (
      <OperatorState
        icon={MapPin}
        tone="default"
        title="Нет данных"
        description="После первой синхронизации с WB здесь появится план перемещений."
      />
    );
  }

  const plan = planQuery.data;
  const summary = plan.summary;

  // Локализация из funnel_stats (как WB кабинет показывает) — приоритет.
  // Дельту симуляции из redistribution применяем к ней.
  const realCurrentLocal = stocksLocQuery.data?.kpi?.avgLocalizationPercent ?? null;
  const simulationDelta = summary.simulatedLocalSharePct - summary.currentLocalSharePct;
  const displayCurrentLocal = realCurrentLocal != null ? realCurrentLocal : summary.currentLocalSharePct;
  const displaySimulatedLocal = realCurrentLocal != null
    ? Math.min(100, realCurrentLocal + simulationDelta)
    : summary.simulatedLocalSharePct;
  const localDelta = displaySimulatedLocal - displayCurrentLocal;

  // Реальная доплата WB по официальной сетке КРП.
  // При локализации ≥60% → 0%. Симуляция redistribution.summary даёт «прогнозный»
  // КРП на основе stock_sizes; если реальная локализация уже ≥60%, экономить
  // нечего, какие бы цифры redistribution не нарисовал.
  const realCurrentKrp = realCurrentLocal != null ? resolveIrpFromLocalization(realCurrentLocal) : summary.currentKrpPct;
  const realSimulatedKrp = resolveIrpFromLocalization(displaySimulatedLocal);
  const krpDelta = Math.max(0, realCurrentKrp - realSimulatedKrp);
  // Если реальная доплата уже 0 — экономии нет, какие бы цифры redistribution
  // не выдал (он считает по другой методике, поэтому может рисовать «-1.35%»
  // там где её на самом деле нет).
  const displaySavingsRub = realCurrentKrp === 0 ? 0 : summary.estimatedSavingsRub;
  const noSavingsBecauseAlreadyAtTarget = realCurrentLocal != null && realCurrentKrp === 0;

  const handleExport = async () => {
    if (!plan) return;
    setExporting(true);
    try {
      await exportRedistributionXlsx(plan);
    } catch (err) {
      console.error('[redistribution-export]', err);
    } finally {
      setExporting(false);
    }
  };

  const handleRunSlotMonitor = async () => {
    setRunningSlotMonitor(true);
    setManualSubmitMessage(null);
    try {
      const res = await fetch('/api/views/redistribution/slot-monitor', {
        method: 'POST',
        cache: 'no-store',
      });
      const payload = await res.json().catch(() => null) as {
        monitorResult?: {
          message?: string;
          probedItems?: number;
          openedSlots?: number;
          autoSubmit?: boolean;
        };
        error?: string;
      } | null;
      if (!res.ok) {
        setManualSubmitMessage(payload?.error ?? `Ошибка запуска: HTTP ${res.status}`);
        return;
      }
      const result = payload?.monitorResult;
      const details = result
        ? `${result.message ?? 'запуск выполнен'} · проверено ${result.probedItems ?? 0} · слотов ${result.openedSlots ?? 0}`
        : 'запуск выполнен';
      setManualSubmitMessage(details);
      await Promise.all([
        executionLogQuery.refetch(),
        planQuery.refetch(),
      ]);
    } catch (err) {
      setManualSubmitMessage(err instanceof Error ? err.message : 'Не удалось запустить автосоздание.');
    } finally {
      setRunningSlotMonitor(false);
    }
  };

  const handleManualRequestCreated = async (submitNow: boolean) => {
    await executionLogQuery.refetch();
    if (submitNow) {
      await handleRunSlotMonitor();
    }
  };

  const robot = robotQuery.data;

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 space-y-4 pb-10 duration-500">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/stocks-v2"
            className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Дашборд
          </Link>
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting || sortedRecommendations.length === 0}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Download className="h-4 w-4" />
          {exporting ? 'Готовлю…' : 'Скачать Excel'}
        </button>
      </div>

      {/* 3 KPI */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <HeroTile
          icon={TrendingUp}
          iconClass={noSavingsBecauseAlreadyAtTarget ? 'text-emerald-500' : displaySavingsRub > 0 ? 'text-emerald-500' : 'text-muted-foreground'}
          label="Сэкономите за месяц"
          primary={
            noSavingsBecauseAlreadyAtTarget
              ? '0 ₽'
              : formatCurrency(displaySavingsRub, 0)
          }
          secondary={
            noSavingsBecauseAlreadyAtTarget
              ? `WB уже не берёт доплату (локализация ≥ 60%) — экономить нечего`
              : `на доплате WB за дальность (комиссия 0.5% уже учтена)`
          }
          tone={noSavingsBecauseAlreadyAtTarget ? 'ok' : displaySavingsRub > 0 ? 'ok' : 'default'}
        />
        <HeroTile
          icon={Package}
          iconClass="text-sky-500"
          label="Перемещений"
          primary={`${formatNumber(summary.transferUnits, 0)} шт`}
          secondary={`по ${summary.skuCount} товарам · ${summary.recommendationCount} маршрутов`}
        />
        <HeroTile
          icon={MapPin}
          iconClass={realCurrentKrp === 0 ? 'text-emerald-500' : 'text-amber-500'}
          label="Локализация"
          primary={`${formatPercent(displayCurrentLocal, 1)} → ${formatPercent(displaySimulatedLocal, 1)}`}
          secondary={
            realCurrentLocal == null
              ? 'данных от WB пока нет'
              : realCurrentKrp === 0
                ? `WB не берёт доплату · уже на цели ≥ 60%`
                : localDelta > 0
                  ? `+${formatPercent(localDelta, 1)} · доплата WB упадёт на ${formatPercent(krpDelta, 2)}`
                  : 'без значимых перемещений'
          }
          tone={realCurrentKrp === 0 ? 'ok' : localDelta > 0 ? 'ok' : 'default'}
        />
      </div>

      {/* ИЛ / ИРП индексы + сплит экономии + горизонт WB-пересчёта */}
      {displaySavingsRub > 0 ? (
        <div className="rounded-2xl border border-border bg-card px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Индексы WB и эффект перевозки
            </div>
            {/* Горизонт: WB пересчитывает ИЛ на скользящем окне 13 недель */}
            <div className="inline-flex rounded-full border border-border bg-subtle p-0.5 text-[11px] font-bold">
              {([1, 13] as const).map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => setHorizonWeeks(w)}
                  className={`rounded-full px-2.5 py-1 transition-colors ${horizonWeeks === w ? 'bg-foreground text-card' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  через {w} нед
                </button>
              ))}
            </div>
          </div>

          {(() => {
            const w = horizonWeeks / 13; // доля реализации улучшения
            const blendedLocal = displayCurrentLocal + localDelta * w;
            const ilNow = resolveKtrFromLocalization(displayCurrentLocal);
            const ilFuture = resolveKtrFromLocalization(blendedLocal);
            const krpFuture = resolveIrpFromLocalization(blendedLocal);
            const savingsAtHorizon = displaySavingsRub * w;
            const krpPart = realCurrentKrp === 0 ? 0 : summary.krpSavingsRub * w;
            const ktrPart = realCurrentKrp === 0 ? 0 : summary.ktrLogisticsSavingsRub * w;
            return (
              <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                <div className="rounded-xl border border-border bg-subtle/40 px-3 py-2">
                  <div className="text-[10px] uppercase text-muted-foreground">ИЛ (логистика)</div>
                  <div className="mt-0.5 font-mono text-[15px] font-bold text-foreground">
                    {ilNow.toFixed(2)} <span className="text-emerald-600">→ {ilFuture.toFixed(2)}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground">множитель тарифа, ниже — лучше</div>
                </div>
                <div className="rounded-xl border border-border bg-subtle/40 px-3 py-2">
                  <div className="text-[10px] uppercase text-muted-foreground">ИРП (комиссия)</div>
                  <div className="mt-0.5 font-mono text-[15px] font-bold text-foreground">
                    {realCurrentKrp.toFixed(2)}% <span className="text-emerald-600">→ {krpFuture.toFixed(2)}%</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground">доплата за дальность</div>
                </div>
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
                  <div className="text-[10px] uppercase text-muted-foreground">Экономия логистика</div>
                  <div className="mt-0.5 font-mono text-[15px] font-bold text-emerald-700 dark:text-emerald-300">{formatCurrency(ktrPart, 0)}</div>
                  <div className="text-[10px] text-muted-foreground">КТР — тариф доставки</div>
                </div>
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
                  <div className="text-[10px] uppercase text-muted-foreground">Экономия комиссия</div>
                  <div className="mt-0.5 font-mono text-[15px] font-bold text-emerald-700 dark:text-emerald-300">{formatCurrency(krpPart, 0)}</div>
                  <div className="text-[10px] text-muted-foreground">КРП — доплата %</div>
                </div>
                <div className="col-span-2 text-[11px] text-muted-foreground md:col-span-4">
                  WB пересчитывает индекс локализации на скользящем окне 13 недель. {horizonWeeks === 13
                    ? 'Через 13 недель эффект перевозки реализуется полностью.'
                    : `Через ${horizonWeeks} нед реализуется ~${Math.round(w * 100)}% эффекта — итого ${formatCurrency(savingsAtHorizon, 0)}.`}
                </div>
              </div>
            );
          })()}
        </div>
      ) : null}

      {/* Если реальная доплата уже 0% — заметный блок «всё хорошо» */}
      {noSavingsBecauseAlreadyAtTarget && (
        <div className="rounded-2xl border-2 border-emerald-500/40 bg-emerald-500/5 px-5 py-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-emerald-500" />
            <div className="text-sm">
              <div className="font-semibold text-foreground">
                Прямо сейчас перемещать ничего не нужно
              </div>
              <div className="mt-1 text-muted-foreground">
                Ваша локализация {formatPercent(displayCurrentLocal, 1)} —
                это уже больше {formatPercent(60, 0)}, поэтому WB не берёт
                доплату за дальность. Перемещения ниже — на случай если
                локализация упадёт (например, при росте продаж в дальних
                регионах) или если вы хотите ещё прибавить запас прочности.
                В деньгах прямо сейчас они не сэкономят.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Вкладки: Рекомендации / Индекс локализации */}
      <div className="flex flex-wrap gap-2">
        {([
          { key: 'recs', label: 'Рекомендации по распределению' },
          { key: 'localization', label: 'Индекс локализации' },
        ] as const).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setRedistView(t.key)}
            className={`rounded-xl border px-3 py-2 text-[12px] font-bold transition-colors ${
              redistView === t.key
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
                : 'border-border bg-card text-foreground hover:border-emerald-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {redistView === 'localization' ? (
        tenantId ? (
          <LocalizationView
            tenantId={tenantId}
            projectedLocalSharePct={displaySimulatedLocal}
            projectedKtr={resolveKtrFromLocalization(displaySimulatedLocal)}
          />
        ) : null
      ) : (
      <>
      {/* Robot status */}
      {robot ? (
        <RobotStatusBlock status={robot} />
      ) : (
        <div className="rounded-2xl border border-dashed border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
          <Loader2 className="mr-2 inline h-3.5 w-3.5 animate-spin" />
          Проверяю статус робота…
        </div>
      )}

      <ManualRequestBlock
        warehouseOptions={warehouseOptions}
        onCreated={handleManualRequestCreated}
      />

      <ExecutionLogBlock
        log={executionLogQuery.data}
        loading={executionLogQuery.isLoading}
        refreshing={executionLogQuery.isFetching}
        runningSlotMonitor={runningSlotMonitor}
        manualSubmitMessage={manualSubmitMessage}
        onRefresh={() => executionLogQuery.refetch()}
        onRunSlotMonitor={handleRunSlotMonitor}
      />

      {/* Recommendations */}
      {sortedRecommendations.length === 0 ? (
        <div className="rounded-2xl border-2 border-emerald-500/40 bg-emerald-500/5 px-5 py-6 text-center">
          <CheckCircle2 className="mx-auto mb-2 h-6 w-6 text-emerald-500" />
          <div className="text-sm font-semibold text-foreground">
            Перемещать ничего не нужно
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            По текущим данным склады распределены ровно — заметного эффекта по
            локализации/доплате не прогнозируется.
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Sparkles className="h-4 w-4 text-emerald-500" />
                Что нужно сделать ({groupedByArticle.length}{groupedByArticle.length === 1 ? ' артикул' : ' артикулов'} · {sortedRecommendations.length} перемещений)
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Одна заявка на артикул — внутри маршруты и размеры. Отсортировано по выгоде.
              </div>
            </div>
            {totalPages > 1 && (
              <div className="text-xs text-muted-foreground tabular-nums">
                Показаны <span className="font-semibold text-foreground">{pageStart + 1}–{pageEnd}</span> из {groupedByArticle.length} артикулов
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 p-4">
            {pagedGroups.map((group, idx) => (
              <ArticleRecommendationCard
                key={`${group.nmId}-${pageStart + idx}`}
                group={group}
                rank={pageStart + idx + 1}
              />
            ))}
          </div>
          {/* Pagination footer */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/30 px-4 py-3 text-xs">
            {totalPages > 1 ? (
              <Pagination
                currentPage={safePage}
                totalPages={totalPages}
                onChange={(p) => {
                  setCurrentPage(p);
                  // плавный скролл к началу списка
                  if (typeof window !== 'undefined') {
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }
                }}
              />
            ) : (
              <span className="text-muted-foreground">
                Все {sortedRecommendations.length} перемещений показаны.
              </span>
            )}
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:text-emerald-300"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              Скачать Excel со всем планом
            </button>
          </div>
        </div>
      )}

      {/* Footer note about methodology */}
      <div className="rounded-xl border border-border bg-muted/40 px-4 py-2 text-[11px] text-muted-foreground">
        <span className="font-semibold">Как считаем:</span> {plan.assumptions.methodology}.
        Целевое покрытие — {plan.assumptions.targetCoverageDays} дн, горизонт прогноза — {plan.assumptions.forecastHorizonDays} дн.
        План построен {new Date(plan.generatedAt).toLocaleString('ru-RU')}.
      </div>
      </>
      )}
    </div>
  );
}
