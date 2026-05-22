'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Clock3, RefreshCw } from 'lucide-react';
import { getSyncRunsHistory, getTenantSyncPrerequisites } from '@/app/(dashboard)/settings/sync-action';
import { isStaleSyncRunError } from '@/lib/sync-run';
import { DateRangePicker, DateRangePresetBar } from '@/components/layout/DateRangePicker';

type SyncRunSummary = {
  totals?: {
    records?: number;
    batches?: number;
    errors?: number;
  };
};

type SyncRun = {
  id: string;
  status: string;
  requestedAt: string | Date;
  startedAt: string | Date | null;
  finishedAt: string | Date | null;
  dateFrom: string | Date | null;
  dateTo: string | Date | null;
  summary?: SyncRunSummary;
  errorMessage?: string | null;
  triggerSource: string;
};

type CoverageState = 'ok' | 'partial' | 'unknown';

type SyncPrerequisites = {
  wbTokenHealthStatus: string;
  wbLkPhone: string | null;
  wbLkSessionStatus: string;
  wbLkSessionCheckedAt: string | Date | null;
  wbLkSessionError: string | null;
};

function toDate(value: string | Date | null | undefined) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toLocalDayKey(value: string | Date | null | undefined) {
  const date = toDate(value);
  if (!date) {
    return null;
  }

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function formatDateTime(value: string | Date | null | undefined) {
  const date = toDate(value);
  if (!date) {
    return 'Не зафиксировано';
  }

  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatDateLabel(value: string | Date | null | undefined) {
  const date = toDate(value);
  if (!date) {
    return 'не указан';
  }

  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

function getStatusView(status: string | null, errorMessage?: string | null) {
  switch (status) {
    case 'pending':
      return {
        label: 'В очереди',
        tone: 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800/50 dark:bg-blue-900/30 dark:text-blue-200',
      };
    case 'running':
      return {
        label: 'Выполняется',
        tone: 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800/50 dark:bg-blue-900/30 dark:text-blue-200',
      };
    case 'completed':
      return {
        label: 'Успешно',
        tone: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/50 dark:bg-emerald-900/30 dark:text-emerald-200',
      };
    case 'completed_with_errors':
      return {
        label: 'Частично с ошибками',
        tone: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/50 dark:bg-amber-900/30 dark:text-amber-200',
      };
    case 'failed':
      return {
        label: isStaleSyncRunError(errorMessage) ? 'Остановлен по таймауту' : 'Ошибка',
        tone: isStaleSyncRunError(errorMessage)
          ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/50 dark:bg-amber-900/30 dark:text-amber-200'
          : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800/50 dark:bg-rose-900/30 dark:text-rose-200',
      };
    default:
      return {
        label: 'Нет истории',
        tone: 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300',
      };
  }
}

function truncateMessage(message: string | null | undefined) {
  if (!message) {
    return null;
  }

  return message.length > 180 ? `${message.slice(0, 177)}...` : message;
}

function coversSelectedRange(run: SyncRun, dateFrom?: Date, dateTo?: Date) {
  if (!dateFrom || !dateTo) {
    return false;
  }

  const syncedFrom = toLocalDayKey(run.dateFrom);
  const syncedTo = toLocalDayKey(run.dateTo);
  const selectedFrom = toLocalDayKey(dateFrom);
  const selectedTo = toLocalDayKey(dateTo);

  if (!syncedFrom || !syncedTo || !selectedFrom || !selectedTo) {
    return false;
  }

  return selectedFrom >= syncedFrom && selectedTo <= syncedTo;
}

function FreshnessShell({ children, showDateControls }: { children: React.ReactNode; showDateControls: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="min-w-0">
        {children}
      </div>
      {showDateControls ? (
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-end">
          <DateRangePresetBar />
          <div className="shrink-0 self-end lg:self-auto">
            <DateRangePicker />
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function DataFreshnessBanner({
  tenantId,
  dateFrom,
  dateTo,
  showSelectedRange = true,
  showDateControls = true,
}: {
  tenantId: string;
  dateFrom?: Date;
  dateTo?: Date;
  showSelectedRange?: boolean;
  showDateControls?: boolean;
}) {
  const syncHistoryQuery = useQuery<SyncRun[]>({
    queryKey: ['data-freshness-sync-runs', tenantId, 80],
    queryFn: () => getSyncRunsHistory(tenantId, 80),
    enabled: Boolean(tenantId),
    refetchInterval: (query) => {
      const current = query.state.data?.[0];
      return current?.status === 'pending' || current?.status === 'running' ? 3000 : false;
    },
  });
  const syncPrerequisitesQuery = useQuery<SyncPrerequisites | null>({
    queryKey: ['data-freshness-sync-prerequisites', tenantId],
    queryFn: () => getTenantSyncPrerequisites(tenantId),
    enabled: Boolean(tenantId),
    refetchInterval: 60_000,
  });

  const syncRuns = useMemo(() => syncHistoryQuery.data ?? [], [syncHistoryQuery.data]);
  const syncPrerequisites = syncPrerequisitesQuery.data;
  const latestRun = syncRuns[0] ?? null;
  const latestUsableRun = useMemo(
    () => syncRuns.find((run) => run.status === 'completed' || run.status === 'completed_with_errors') ?? null,
    [syncRuns]
  );
  const rangeCoveringUsableRun = useMemo(() => {
    if (!showSelectedRange || !dateFrom || !dateTo) {
      return null;
    }

    return syncRuns.find((run) => (
      (run.status === 'completed' || run.status === 'completed_with_errors')
      && coversSelectedRange(run, dateFrom, dateTo)
    )) ?? null;
  }, [dateFrom, dateTo, showSelectedRange, syncRuns]);
  const displayCoverageRun = rangeCoveringUsableRun ?? latestUsableRun;
  const latestStatus = getStatusView(latestRun?.status ?? null, latestRun?.errorMessage ?? null);
  const isLatestRunStaleTimeout = isStaleSyncRunError(latestRun?.errorMessage);

  const coverageState = useMemo<CoverageState>(() => {
    if (!showSelectedRange || !dateFrom || !dateTo || !latestUsableRun) {
      return 'unknown';
    }

    if (rangeCoveringUsableRun) {
      return 'ok';
    }

    const syncedFrom = toLocalDayKey(displayCoverageRun?.dateFrom);
    const syncedTo = toLocalDayKey(displayCoverageRun?.dateTo);
    const selectedFrom = toLocalDayKey(dateFrom);
    const selectedTo = toLocalDayKey(dateTo);
    if (!syncedFrom || !syncedTo || !selectedFrom || !selectedTo) {
      return 'unknown';
    }

    return selectedFrom < syncedFrom || selectedTo > syncedTo ? 'partial' : 'ok';
  }, [dateFrom, dateTo, displayCoverageRun, latestUsableRun, rangeCoveringUsableRun, showSelectedRange]);

  const summary = useMemo(() => {
    if (!latestRun) {
      return {
        tone: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800/50 dark:bg-amber-900/30 dark:text-amber-200',
        icon: <AlertTriangle className="h-5 w-5 text-amber-600" />,
        title: 'Синхронизация ещё не запускалась',
        description: 'Экран показывает пустой или исторический state без подтверждённой свежести. Сначала запустите sync в настройках.',
      };
    }

    if (latestRun.status === 'pending' || latestRun.status === 'running') {
      return {
        tone: 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-800/50 dark:bg-blue-900/30 dark:text-blue-200',
        icon: <RefreshCw className="h-5 w-5 animate-spin text-blue-600" />,
        title: 'Синхронизация выполняется',
        description: latestUsableRun
          ? `Пока новый запуск не завершился, экран опирается на предыдущий usable sync от ${formatDateTime(latestUsableRun.finishedAt ?? latestUsableRun.requestedAt)}.`
          : 'Это первый запуск для текущего кабинета. Данные на страницах появятся после его завершения.',
      };
    }

    if (latestRun.status === 'failed') {
      if (isLatestRunStaleTimeout) {
        return {
          tone: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800/50 dark:bg-amber-900/30 dark:text-amber-200',
          icon: <AlertTriangle className="h-5 w-5 text-amber-600" />,
          title: 'Зависший запуск остановлен по таймауту',
          description: latestUsableRun
            ? `Последний usable sync был ${formatDateTime(latestUsableRun.finishedAt ?? latestUsableRun.requestedAt)}. Запустите новый sync, чтобы обновить данные.`
            : 'У кабинета пока нет usable sync. Запустите синхронизацию повторно после проверки токена и доступности runtime.',
        };
      }

      return {
        tone: 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-800/50 dark:bg-rose-900/30 dark:text-rose-200',
        icon: <AlertTriangle className="h-5 w-5 text-rose-600" />,
        title: 'Последняя попытка sync завершилась ошибкой',
        description: latestUsableRun
          ? `Последний usable sync был ${formatDateTime(latestUsableRun.finishedAt ?? latestUsableRun.requestedAt)}. Текущий экран всё ещё опирается на него.`
          : 'У кабинета пока нет ни одного usable sync. Данные на страницах могут быть пустыми или неполными.',
      };
    }

    if (coverageState === 'partial') {
      return {
        tone: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800/50 dark:bg-amber-900/30 dark:text-amber-200',
        icon: <Clock3 className="h-5 w-5 text-amber-600" />,
        title: 'Выбранный период шире последнего usable sync',
        description: 'Часть активного диапазона может выходить за покрытие последней успешной загрузки. Проверяйте sync range перед выводами по данным.',
      };
    }

    if (latestRun.status === 'completed_with_errors') {
      const errorCount = latestRun.summary?.totals?.errors ?? 0;

      return {
        tone: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800/50 dark:bg-amber-900/30 dark:text-amber-200',
        icon: <AlertTriangle className="h-5 w-5 text-amber-600" />,
        title: 'Последний usable sync завершился частично',
        description: errorCount > 0
          ? `Во время последней загрузки зафиксировано ${errorCount} ошибок источников. Данные пригодны для работы, но часть срезов могла обновиться не полностью.`
          : 'Последняя загрузка завершилась с предупреждениями. Данные пригодны для работы, но требуют внимательной интерпретации.',
      };
    }

    return {
      tone: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800/50 dark:bg-emerald-900/30 dark:text-emerald-200',
      icon: <CheckCircle2 className="h-5 w-5 text-emerald-600" />,
      title: 'Данные синхронизированы',
      description: latestUsableRun
        ? `Последний usable sync завершился ${formatDateTime(latestUsableRun.finishedAt ?? latestUsableRun.requestedAt)}. Можно работать с текущим срезом без явных признаков stale-state.`
        : 'У кабинета есть успешный sync, и текущий экран опирается на него.',
    };
  }, [coverageState, isLatestRunStaleTimeout, latestRun, latestUsableRun]);

  const wbLkIssue = useMemo(() => {
    if (!syncPrerequisites) {
      return null;
    }

    if (syncPrerequisites.wbLkSessionStatus === 'healthy') {
      return null;
    }

    if (syncPrerequisites.wbLkSessionStatus === 'warning') {
      return {
        tone: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800/50 dark:bg-amber-900/30 dark:text-amber-200',
        title: 'WB ЛК: требуется подтверждение по SMS',
        message: syncPrerequisites.wbLkSessionError
          ? syncPrerequisites.wbLkSessionError
          : 'Выполните подтверждение входа через SMS-код в настройках.',
      };
    }

    if (syncPrerequisites.wbLkSessionStatus === 'invalid') {
      return {
        tone: 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-800/50 dark:bg-rose-900/30 dark:text-rose-200',
        title: 'WB ЛК: проблема с номером/сессией',
        message: syncPrerequisites.wbLkSessionError
          ? syncPrerequisites.wbLkSessionError
          : 'Проверьте номер телефона и вход в WB ЛК в разделе настроек.',
      };
    }

    return {
      tone: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300',
      title: 'WB ЛК: номер не подтвержден',
      message: 'Добавьте номер телефона и пройдите проверку входа WB ЛК в настройках.',
    };
  }, [syncPrerequisites]);

  const compactLine = useMemo(() => {
    const fragments: string[] = [];
    const usableAt = latestUsableRun ? formatDateTime(latestUsableRun.finishedAt ?? latestUsableRun.requestedAt) : null;
    if (usableAt) {
      fragments.push(`usable sync: ${usableAt}`);
    } else if (latestRun) {
      fragments.push(`последняя попытка: ${formatDateTime(latestRun.requestedAt)}`);
    } else {
      fragments.push('история sync ещё не сформирована');
    }

    if (displayCoverageRun?.dateFrom && displayCoverageRun?.dateTo) {
      fragments.push(`окно sync: ${formatDateLabel(displayCoverageRun.dateFrom)} – ${formatDateLabel(displayCoverageRun.dateTo)}`);
    }

    if (coverageState === 'partial') {
      fragments.push('выбранный диапазон покрыт частично');
    }

    if (wbLkIssue) {
      fragments.push(wbLkIssue.title);
    }

    if (latestRun?.status === 'failed' && latestRun.errorMessage) {
      const tailError = truncateMessage(latestRun.errorMessage);
      if (tailError) {
        fragments.push(`ошибка: ${tailError}`);
      }
    }

    return truncateMessage(fragments.join(' · ')) ?? 'Состояние sync не определено';
  }, [coverageState, displayCoverageRun, latestRun, latestUsableRun, wbLkIssue]);

  if (syncHistoryQuery.isLoading && !latestRun) {
    return (
      <FreshnessShell showDateControls={showDateControls}>
        <div
          aria-hidden="true"
          data-testid="data-freshness-banner"
          className="h-9 rounded-xl border border-slate-200 bg-slate-50/80 px-2.5 py-1.5 shadow-[var(--shadow-xs)] dark:border-slate-700 dark:bg-slate-800/45"
        />
      </FreshnessShell>
    );
  }

  if (syncHistoryQuery.error) {
    return (
      <FreshnessShell showDateControls={showDateControls}>
        <div
          data-testid="data-freshness-banner"
          className="truncate rounded-xl border border-rose-300/70 bg-rose-100/70 px-2.5 py-1.5 text-xs font-bold text-rose-900 shadow-[var(--shadow-xs)] dark:border-rose-400/30 dark:bg-rose-500/10 dark:text-rose-100"
        >
          Не удалось загрузить статус свежести данных: {syncHistoryQuery.error.message}
        </div>
      </FreshnessShell>
    );
  }

  return (
    <FreshnessShell showDateControls={showDateControls}>
      <div
        data-testid="data-freshness-banner"
        className={`rounded-xl border px-2.5 py-1.5 shadow-[var(--shadow-xs)] ${summary.tone}`}
      >
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div className="shrink-0 [&_svg]:h-3.5 [&_svg]:w-3.5">{summary.icon}</div>
            <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.14em] ${latestStatus.tone}`}>
              {latestStatus.label}
            </span>
            <p className="max-w-[260px] shrink-0 truncate text-xs font-black">{summary.title}</p>
            <p className="min-w-0 truncate text-[11px] font-semibold opacity-85">{compactLine}</p>
          </div>
          <Link
            href="/settings"
            prefetch={false}
            className="inline-flex h-7 shrink-0 items-center justify-center rounded-lg border border-current/15 bg-white/65 px-2.5 text-[10px] font-black uppercase tracking-[0.14em] transition-all hover:bg-white dark:bg-slate-950/40 dark:hover:bg-slate-950/70"
          >
            Sync
          </Link>
        </div>
      </div>
    </FreshnessShell>
  );
}
