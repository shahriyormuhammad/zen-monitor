'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowUpCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  History,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import { getSyncRunsHistory, triggerWbSync } from './sync-action';
import { useStore } from '@/store/useStore';
import { toInputDateValue, toLocalDateParam } from '@/lib/date-range';
import { isStaleSyncRunError } from '@/lib/sync-run';

type SyncSourceMeta = {
  reason?: string;
  errorCategory?: string;
  statusCode?: number;
  shortMessage?: string;
  operation?: string;
  retryable?: boolean;
};

type SyncSourceSummary = {
  source: string;
  status: string;
  records: number;
  batches: number;
  error?: string;
  meta?: SyncSourceMeta;
};

type SyncRunDiagnosis = {
  kind: string;
  title: string;
  message: string;
  action?: string;
  affectedSources?: string[];
};

type SyncRunProgress = {
  totalSources: number;
  completedSources: number;
  runningSource?: string;
  percent: number;
};

type SyncRunSummary = {
  sources?: SyncSourceSummary[];
  totals?: { records: number; batches: number; errors: number };
  progress?: SyncRunProgress;
  diagnosis?: SyncRunDiagnosis;
};

type SyncRun = {
  id: string;
  status: string;
  requestedAt: string | Date;
  startedAt: string | Date | null;
  finishedAt: string | Date | null;
  dateFrom: string | Date | null;
  dateTo: string | Date | null;
  summary: SyncRunSummary;
  errorMessage: string | null;
  triggerSource: string;
};

type StoredTokenHealth = {
  status: 'unknown' | 'healthy' | 'warning' | 'invalid';
  title: string;
  message: string;
  checkedAt: string;
};

const statusConfig: Record<'pending' | 'running' | 'completed' | 'completed_with_errors' | 'failed', { label: string; tone: string }> = {
  pending: { label: 'В очереди', tone: 'text-amber-600 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-900/20 dark:border-amber-800/40' },
  running: { label: 'Выполняется', tone: 'text-blue-600 bg-blue-50 border-blue-200 dark:text-blue-300 dark:bg-blue-900/20 dark:border-blue-800/40' },
  completed: { label: 'Успешно', tone: 'text-emerald-600 bg-emerald-50 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-900/20 dark:border-emerald-800/40' },
  completed_with_errors: { label: 'Частично с ошибками', tone: 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-900/20 dark:border-amber-800/40' },
  failed: { label: 'Ошибка', tone: 'text-rose-600 bg-rose-50 border-rose-200 dark:text-rose-300 dark:bg-rose-900/20 dark:border-rose-800/40' },
};

const formatDateTime = (value: string | Date | null) => {
  if (!value) {
    return 'Не зафиксировано';
  }

  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value instanceof Date ? value : new Date(value));
};

const toInputDate = (value: string | Date | null) => {
  return toInputDateValue(value);
};

const formatSourceLabel = (source: string) => source.replaceAll('_', ' ');

export function SyncButton({
  hasStoredToken = false,
  tokenHealth = null,
}: {
  hasStoredToken?: boolean;
  tokenHealth?: StoredTokenHealth | null;
}) {
  const { tenantId } = useStore();
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return toLocalDateParam(d);
  });
  const [toDate, setToDate] = useState(() => toLocalDateParam(new Date()));
  const [isTriggering, setIsTriggering] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const todayDateParam = useMemo(() => toLocalDateParam(new Date()), []);

  const syncHistoryQuery = useQuery<SyncRun[]>({
    queryKey: ['sync-runs-history', tenantId],
    queryFn: () => (tenantId ? getSyncRunsHistory(tenantId, 6) : Promise.resolve([])),
    enabled: Boolean(tenantId),
    refetchInterval: (query) => {
      const current = query.state.data?.[0];
      return current?.status === 'pending' || current?.status === 'running' ? 3000 : false;
    },
  });

  const syncRuns = syncHistoryQuery.data ?? [];
  const latestRun = syncRuns[0] ?? null;
  const historyRuns = syncRuns.slice(1);
  const normalizedStatus = latestRun && latestRun.status in statusConfig
    ? (latestRun.status as keyof typeof statusConfig)
    : null;
  const isRunning = normalizedStatus === 'pending' || normalizedStatus === 'running';
  const isLatestRunStaleTimeout = isStaleSyncRunError(latestRun?.errorMessage);
  const latestStatus = normalizedStatus
    ? (normalizedStatus === 'failed' && isLatestRunStaleTimeout
      ? { label: 'Зависший запуск (таймаут)', tone: 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-900/20 dark:border-amber-800/40' }
      : statusConfig[normalizedStatus])
    : null;
  const latestTotals = latestRun?.summary?.totals;
  const latestProgress = latestRun?.summary?.progress;
  const latestDiagnosis = latestRun?.summary?.diagnosis;
  const showDetailedError = latestRun?.errorMessage
    && latestRun.errorMessage !== latestDiagnosis?.message
    && !isLatestRunStaleTimeout;
  const syncPrerequisiteBlocked = !hasStoredToken || (hasStoredToken && (!tokenHealth || tokenHealth.status === 'unknown'));
  const syncRiskTone = tokenHealth?.status === 'invalid'
    ? 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800/40 dark:bg-rose-900/20 dark:text-rose-200'
    : tokenHealth?.status === 'warning'
      ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-200'
      : 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800/40 dark:bg-blue-900/20 dark:text-blue-200';
  const syncRiskTitle = !hasStoredToken
    ? 'Сначала сохраните токен кабинета'
    : !tokenHealth
      ? 'Сначала подтвердите сохранённый токен'
      : tokenHealth.status === 'unknown'
        ? 'Дождитесь проверки сохранённого токена'
      : tokenHealth.title;
  const syncRiskMessage = !hasStoredToken
    ? 'У этого кабинета ещё нет сохранённого WB токена. Синхронизацию запускать нечем.'
    : !tokenHealth
      ? 'Сохранённый токен ещё не проходил preflight. Проверьте его в блоке Wildberries Token перед первым sync.'
      : tokenHealth.status === 'unknown'
        ? 'Новый ключ уже сохранён, но WB API ещё не подтвердил его права. После проверки синхронизация разблокируется автоматически.'
      : tokenHealth.message;
  const primarySyncLabel = isRunning
    ? 'Синхронизация выполняется'
    : syncPrerequisiteBlocked
      ? (!hasStoredToken ? 'Сначала сохраните токен' : 'Идёт проверка токена')
      : tokenHealth?.status === 'invalid'
        ? 'Запустить несмотря на проблемный токен'
        : tokenHealth?.status === 'warning'
          ? 'Запустить синхронизацию с предупреждением'
          : 'Запустить синхронизацию';
  const showDetails = detailsOpen || isRunning || Boolean(localError) || syncPrerequisiteBlocked || tokenHealth?.status === 'invalid' || tokenHealth?.status === 'warning';

  const latestSourceSummary = useMemo(() => {
    if (!latestRun?.summary?.sources?.length) {
      return [];
    }

    return latestRun.summary.sources
      .filter((source) => source.status !== 'skipped')
      .slice(0, 6);
  }, [latestRun]);

  const progressPercent = latestProgress?.percent ?? (isRunning ? 0 : normalizedStatus === 'completed' || normalizedStatus === 'completed_with_errors' ? 100 : 0);
  const progressCompletedSources = latestProgress?.completedSources ?? latestRun?.summary?.sources?.length ?? 0;
  const progressTotalSources = latestProgress?.totalSources ?? latestRun?.summary?.sources?.length ?? 0;
  const progressRunningLabel = latestProgress?.runningSource ? formatSourceLabel(latestProgress.runningSource) : null;

  const scrollToTokenCard = () => {
    document.getElementById('wb-token-card')?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
  };

  const getSourceRowState = (source: SyncSourceSummary) => {
    const isRateLimited = source.meta?.reason === 'wb_rate_limited'
      || source.meta?.errorCategory === 'wb_rate_limited'
      || source.meta?.statusCode === 429;

    if (source.status === 'error') {
      if (isRateLimited) {
        return {
          icon: <RefreshCw className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />,
          tone: 'border-amber-100 bg-amber-50 text-amber-800 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-300',
          text: 'WB временно ограничил источник, данные догрузим позже',
        };
      }

      return {
        icon: <XCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-rose-500" />,
        tone: 'border-rose-100 bg-rose-50 text-rose-700 dark:border-rose-800/40 dark:bg-rose-900/20 dark:text-rose-300',
        text: source.meta?.shortMessage ?? 'Ошибка источника',
      };
    }

    if (source.status === 'skipped') {
      if (isRateLimited) {
        return {
          icon: <RefreshCw className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />,
          tone: 'border-amber-100 bg-amber-50 text-amber-800 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-300',
          text: 'WB временно ограничил источник, данные догрузим позже',
        };
      }

      return {
        icon: <RefreshCw className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-400" />,
        tone: 'border-slate-100 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400',
        text: source.meta?.reason === 'retained_previous_snapshot'
          ? 'Сохранён прошлый снимок'
          : source.meta?.reason === 'empty' || source.meta?.reason === 'no_reports'
            ? 'Без новых данных'
            : 'Пропущено',
      };
    }

    return {
      icon: <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-500" />,
      tone: 'border-emerald-100 bg-emerald-50 text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-900/20 dark:text-emerald-300',
      text: `${source.records} записей`,
    };
  };

  const runSync = async (range?: { from?: string | null; to?: string | null }) => {
    if (!tenantId || isRunning || isTriggering) {
      return;
    }

    const requestedFrom = range?.from ?? fromDate;
    const requestedTo = range?.to ?? toDate;
    const normalizedTo = requestedTo > todayDateParam ? todayDateParam : requestedTo;
    const normalizedFrom = requestedFrom > normalizedTo ? normalizedTo : requestedFrom;

    if (normalizedFrom !== fromDate) {
      setFromDate(normalizedFrom);
    }
    if (normalizedTo !== toDate) {
      setToDate(normalizedTo);
    }

    setLocalError(null);
    setIsTriggering(true);

    try {
      await triggerWbSync(
        tenantId,
        normalizedFrom,
        normalizedTo
      );
      await syncHistoryQuery.refetch();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Не удалось запустить синхронизацию');
    } finally {
      setIsTriggering(false);
    }
  };

  const retryRun = async (run: SyncRun) => {
    const rawRetryFrom = toInputDate(run.dateFrom) ?? fromDate;
    const rawRetryTo = toInputDate(run.dateTo) ?? toDate;
    const retryTo = rawRetryTo > todayDateParam ? todayDateParam : rawRetryTo;
    const retryFrom = rawRetryFrom > retryTo ? retryTo : rawRetryFrom;

    setFromDate(retryFrom);
    setToDate(retryTo);
    await runSync({ from: retryFrom, to: retryTo });
  };

  const renderSourceBreakdown = (run: SyncRun) => {
    const sources = run.summary?.sources ?? [];
    if (sources.length === 0) {
      return (
        <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
          Детализация по источникам для этого запуска не записана.
        </div>
      );
    }

    return (
      <div className="space-y-2">
        {sources.map((source) => {
          const sourceState = getSourceRowState(source);

          return (
            <div
              key={`${run.id}-${source.source}`}
              className={`flex items-start justify-between gap-3 rounded-xl border px-3 py-2 text-xs ${sourceState.tone}`}
            >
              <div className="flex items-start gap-2">
                {sourceState.icon}
                <div>
                  <p className="font-bold text-current capitalize">{formatSourceLabel(source.source)}</p>
                  {source.status === 'error' && source.error ? (
                    <p className="mt-1 max-w-xl text-[11px] leading-relaxed opacity-80">
                      {source.meta?.operation ? `${source.meta.operation}: ` : ''}
                      {sourceState.text}
                    </p>
                  ) : null}
                </div>
              </div>
              <span className="font-medium whitespace-nowrap">{sourceState.text}</span>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="w-full space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <label className="ml-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">От</label>
          <input
            type="date"
            value={fromDate}
            max={todayDateParam}
            onChange={(e) => {
              const nextFrom = e.target.value > todayDateParam ? todayDateParam : e.target.value;
              setFromDate(nextFrom > toDate ? toDate : nextFrom);
            }}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium dark:border-slate-700 dark:bg-slate-900/30 dark:text-slate-200"
          />
        </div>
        <div className="space-y-1">
          <label className="ml-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">До</label>
          <input
            type="date"
            value={toDate}
            max={todayDateParam}
            onChange={(e) => {
              const nextTo = e.target.value > todayDateParam ? todayDateParam : e.target.value;
              setToDate(nextTo);
              if (fromDate > nextTo) {
                setFromDate(nextTo);
              }
            }}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium dark:border-slate-700 dark:bg-slate-900/30 dark:text-slate-200"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <button
          type="button"
          onClick={() => runSync()}
          data-testid="manual-sync-trigger"
          disabled={!tenantId || isRunning || isTriggering || syncPrerequisiteBlocked}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-600 px-5 py-3 text-sm font-bold text-white transition-all hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isRunning || isTriggering ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 fill-current" />}
          {primarySyncLabel}
        </button>

        <button
          type="button"
          onClick={() => latestRun ? retryRun(latestRun) : syncHistoryQuery.refetch()}
          data-testid="retry-latest-sync"
          disabled={!latestRun || isRunning || isTriggering}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-700"
        >
          <RotateCcw className="h-4 w-4" />
          Повторить последний диапазон
        </button>
      </div>

      {syncPrerequisiteBlocked || tokenHealth?.status === 'invalid' || tokenHealth?.status === 'warning' ? (
        <div className={`rounded-2xl border px-4 py-3 text-xs ${syncRiskTone}`}>
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <div className="space-y-1">
              <p className="font-bold">{syncRiskTitle}</p>
              <p className="font-medium leading-relaxed">{syncRiskMessage}</p>
              <button
                type="button"
                onClick={scrollToTokenCard}
                className="inline-flex items-center gap-2 pt-1 font-bold transition-colors hover:opacity-80"
              >
                <ArrowUpCircle className="h-4 w-4" />
                Перейти к блоку Wildberries Token
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Последний запуск</p>
            <p className="mt-1 text-sm font-bold text-slate-800">
              {latestRun ? formatDateTime(latestRun.requestedAt) : 'Синхронизация ещё не запускалась'}
            </p>
          </div>

          {latestStatus ? (
            <div data-testid="latest-sync-status" className={`rounded-full border px-3 py-1 text-[11px] font-bold ${latestStatus.tone}`}>
              {latestStatus.label}
            </div>
          ) : (
            <div data-testid="latest-sync-status" className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-bold text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
              Нет истории
            </div>
          )}

          <button
            type="button"
            onClick={() => setDetailsOpen((value) => !value)}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            {showDetails ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {showDetails ? 'Скрыть детали' : 'Показать детали'}
          </button>
        </div>

        {showDetails && latestRun ? (
          <div className="mt-4 space-y-3">
            {isRunning ? (
              <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-800 dark:border-blue-800/40 dark:bg-blue-900/20 dark:text-blue-200">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-bold">Прогресс синхронизации: {progressPercent}%</p>
                    <p className="mt-1 font-medium leading-relaxed">
                      {progressTotalSources > 0
                        ? `${progressCompletedSources} из ${progressTotalSources} источников завершено`
                        : 'Ожидаем первые результаты по источникам'}
                      {progressRunningLabel ? ` • сейчас: ${progressRunningLabel}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 whitespace-nowrap font-bold">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {progressPercent}%
                  </div>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-blue-100">
                  <div
                    data-testid="sync-progress-bar"
                    className="h-full rounded-full bg-blue-500 transition-all duration-300"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-3 text-xs text-slate-500 md:grid-cols-3">
              <div>
                <span className="font-bold uppercase tracking-wider text-slate-400">Диапазон</span>
                <div className="mt-1 font-medium text-slate-700">
                  {latestRun.dateFrom ? formatDateTime(latestRun.dateFrom) : 'Авто'}
                  {' -> '}
                  {latestRun.dateTo ? formatDateTime(latestRun.dateTo) : 'Сейчас'}
                </div>
              </div>
              <div>
                <span className="font-bold uppercase tracking-wider text-slate-400">Записей</span>
                <div className="mt-1 font-medium text-slate-700">{latestTotals?.records ?? 0}</div>
              </div>
              <div>
                <span className="font-bold uppercase tracking-wider text-slate-400">Ошибок источников</span>
                <div className="mt-1 font-medium text-slate-700">{latestTotals?.errors ?? 0}</div>
              </div>
            </div>

            {latestDiagnosis ? (
              <div
                data-testid="sync-diagnosis"
                className={`rounded-2xl border px-4 py-3 text-xs ${
                  latestDiagnosis.kind === 'wb_token_invalid' || latestDiagnosis.kind === 'wb_auth_failed'
                    ? 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800/40 dark:bg-rose-900/20 dark:text-rose-200'
                    : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-200'
                }`}
              >
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <div className="space-y-1">
                    <p className="font-bold">{latestDiagnosis.title}</p>
                    <p className="font-medium leading-relaxed">{latestDiagnosis.message}</p>
                    {(latestDiagnosis.kind === 'wb_token_invalid' || latestDiagnosis.kind === 'wb_auth_failed') ? (
                      <button
                        type="button"
                        onClick={scrollToTokenCard}
                        className="inline-flex items-center gap-2 pt-1 font-bold text-rose-700 transition-colors hover:text-rose-900"
                      >
                        <ArrowUpCircle className="h-4 w-4" />
                        Перейти к блоку Wildberries Token
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}

            {isLatestRunStaleTimeout ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-200">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <div className="space-y-1">
                    <p className="font-bold">Зависший запуск остановлен по таймауту</p>
                    <p className="font-medium leading-relaxed">
                      Этот sync не завершился за допустимое время и был автоматически переведён в ошибку.
                      Запустите новый sync для обновления данных.
                    </p>
                  </div>
                </div>
              </div>
            ) : null}

            {latestSourceSummary.length > 0 ? (
              <div className="space-y-2 border-t border-slate-100 pt-3">
                {latestSourceSummary.map((source) => {
                  const sourceState = getSourceRowState(source);

                  return (
                    <div
                      key={source.source}
                      className={`flex items-start justify-between gap-3 rounded-xl border px-3 py-2 text-xs ${sourceState.tone}`}
                    >
                      <div className="flex items-start gap-2">
                        {sourceState.icon}
                        <div>
                          <span className="font-bold text-current capitalize">{formatSourceLabel(source.source)}</span>
                          {source.status === 'error' && source.error ? (
                            <p className="mt-1 max-w-xl text-[11px] leading-relaxed opacity-80">
                              {source.meta?.operation ? `${source.meta.operation}: ` : ''}
                              {sourceState.text}
                            </p>
                          ) : null}
                        </div>
                      </div>
                      <span className="font-medium whitespace-nowrap">
                        {sourceState.text}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : null}

            {showDetailedError ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-200">
                {latestRun.errorMessage}
              </div>
            ) : null}
          </div>
        ) : null}

        {showDetails && localError ? (
          <div data-testid="manual-sync-error" className="mt-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 dark:border-rose-800/40 dark:bg-rose-900/20 dark:text-rose-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>{localError}</span>
          </div>
        ) : null}

        {showDetails && syncQueryIsSuccess(syncHistoryQuery.data) && normalizedStatus === 'completed' ? (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-900/20 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
            <span>Последняя синхронизация завершилась без ошибок.</span>
          </div>
        ) : null}

        {showDetails ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
          <button
            type="button"
            onClick={() => syncHistoryQuery.refetch()}
            data-testid="refresh-sync-status"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold uppercase tracking-wider text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-800 dark:border-slate-700 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:text-slate-300"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Обновить статус и историю
          </button>
        </div>
        ) : null}

        {showDetails ? (
        <div data-testid="sync-history-block" className="mt-4 space-y-3 border-t border-slate-100 pt-4">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-slate-400" />
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">История запусков</p>
          </div>

          {historyRuns.length > 0 ? (
            <div className="space-y-2">
              {historyRuns.map((run) => {
                const runStatus = run.status in statusConfig
                  ? statusConfig[run.status as keyof typeof statusConfig]
                  : null;
                const isExpanded = expandedRunId === run.id;
                const runTotals = run.summary?.totals;
                const runDiagnosis = run.summary?.diagnosis;

                return (
                  <div key={run.id} className="rounded-2xl border border-slate-200 bg-slate-50/60 dark:border-slate-700 dark:bg-slate-800/40">
                    <div className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-start md:justify-between">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-bold text-slate-800">{formatDateTime(run.requestedAt)}</p>
                          {runStatus ? (
                            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${runStatus.tone}`}>
                              {runStatus.label}
                            </span>
                          ) : null}
                        </div>
                        <p className="text-xs font-medium text-slate-500">
                          {run.dateFrom ? formatDateTime(run.dateFrom) : 'Авто'}
                          {' -> '}
                          {run.dateTo ? formatDateTime(run.dateTo) : 'Сейчас'}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          Записей: {runTotals?.records ?? 0} • Ошибок: {runTotals?.errors ?? 0}
                        </p>
                        {runDiagnosis ? (
                          <p className="text-[11px] font-medium text-slate-600">{runDiagnosis.message}</p>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => retryRun(run)}
                          disabled={isRunning || isTriggering}
                          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-bold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-700"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          Повторить
                        </button>
                        <button
                          type="button"
                          onClick={() => setExpandedRunId(isExpanded ? null : run.id)}
                          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-bold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-700"
                        >
                          {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                          Детали
                        </button>
                      </div>
                    </div>

                    {isExpanded ? (
                      <div className="space-y-3 border-t border-slate-200 bg-white px-4 py-4 dark:border-slate-700 dark:bg-slate-800/50">
                        {runDiagnosis ? (
                          <div className={`rounded-xl border px-3 py-2 text-xs ${
                            runDiagnosis.kind === 'wb_token_invalid' || runDiagnosis.kind === 'wb_auth_failed'
                              ? 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800/40 dark:bg-rose-900/20 dark:text-rose-200'
                              : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-200'
                          }`}>
                            <p className="font-bold">{runDiagnosis.title}</p>
                            <p className="mt-1 font-medium">{runDiagnosis.message}</p>
                          </div>
                        ) : null}

                        {renderSourceBreakdown(run)}

                        {run.errorMessage && run.errorMessage !== runDiagnosis?.message ? (
                          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-200">
                            {run.errorMessage}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <div
              data-testid="sync-history-empty"
              className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-xs font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400"
            >
              {latestRun
                ? 'Пока записан только один запуск. После следующей синхронизации здесь появится сравнимая история диапазонов и ошибок по источникам.'
                : 'История появится после первого запуска синхронизации.'}
            </div>
          )}
        </div>
        ) : null}
      </div>
    </div>
  );
}

function syncQueryIsSuccess(data: SyncRun[] | undefined) {
  return Array.isArray(data);
}
