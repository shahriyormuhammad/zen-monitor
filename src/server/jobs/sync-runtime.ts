import { WbApiError } from "@/lib/wb-api/client";

export type SyncSourceStatus = 'success' | 'skipped' | 'error';
export type SyncRunStatus = 'pending' | 'running' | 'completed' | 'completed_with_errors' | 'failed';

export type SyncErrorCategory =
  | 'wb_token_invalid'
  | 'wb_auth_failed'
  | 'wb_rate_limited'
  | 'wb_upstream_error'
  | 'network_error'
  | 'unknown_error';

export interface SyncSourceMeta extends Record<string, unknown> {
  reason?: string;
  errorCategory?: SyncErrorCategory;
  statusCode?: number;
  shortMessage?: string;
  operation?: string;
  retryable?: boolean;
}

export interface SyncSourceSummary {
  source: string;
  status: SyncSourceStatus;
  records: number;
  batches: number;
  startedAt: string;
  finishedAt: string;
  error?: string;
  meta?: SyncSourceMeta;
}

export interface SyncRunDiagnosis {
  kind: 'wb_token_invalid' | 'wb_auth_failed' | 'wb_rate_limited' | 'source_failures';
  title: string;
  message: string;
  action?: string;
  affectedSources: string[];
}

export interface SyncRunProgress {
  totalSources: number;
  completedSources: number;
  runningSource?: string;
  percent: number;
  updatedAt?: string;
}

export interface SyncRunSummary {
  sources: SyncSourceSummary[];
  totals: {
    records: number;
    batches: number;
    errors: number;
  };
  progress?: SyncRunProgress;
  diagnosis?: SyncRunDiagnosis;
}

export class SyncSourceTimeoutError extends Error {
  readonly source: string;
  readonly timeoutMs: number;

  constructor(source: string, timeoutMs: number) {
    super(`[Sync] ${source} exceeded ${timeoutMs}ms`);
    this.name = 'SyncSourceTimeoutError';
    this.source = source;
    this.timeoutMs = timeoutMs;
  }
}

const MAX_SERIALIZED_ERROR_LENGTH = 600;

function truncateErrorMessage(message: string) {
  return message.length > MAX_SERIALIZED_ERROR_LENGTH
    ? `${message.slice(0, MAX_SERIALIZED_ERROR_LENGTH)}...`
    : message;
}

function serializeDatabaseError(error: Error) {
  if (!/^Failed query:/i.test(error.message)) {
    return null;
  }

  const cause = error.cause instanceof Error ? error.cause.message : "";
  if (cause.trim().length > 0) {
    return truncateErrorMessage(`Ошибка БД: ${cause.trim()}`);
  }

  return 'Ошибка БД: запрос синхронизации не выполнен';
}

export function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

export function serializeError(error: unknown) {
  if (error instanceof Error) {
    return serializeDatabaseError(error) ?? truncateErrorMessage(error.message);
  }

  if (typeof error === 'string') {
    return truncateErrorMessage(error);
  }

  try {
    return truncateErrorMessage(JSON.stringify(error));
  } catch {
    return 'Unknown sync error';
  }
}

function classifySyncError(error: unknown): SyncSourceMeta | undefined {
  if (error instanceof SyncSourceTimeoutError) {
    return {
      errorCategory: 'network_error',
      shortMessage: `Источник превысил лимит ${Math.round(error.timeoutMs / 1000)}с`,
      operation: error.source,
    };
  }

  if (error instanceof WbApiError) {
    if (error.status === 401) {
      const payload = `${error.message} ${error.details ?? ''}`;
      const invalidToken = /token is malformed|access token problem|invalid number of segments/i.test(payload);

      return {
        errorCategory: invalidToken ? 'wb_token_invalid' : 'wb_auth_failed',
        statusCode: 401,
        shortMessage: invalidToken ? 'WB token отклонён' : 'WB API вернул 401',
        operation: error.operation,
      };
    }

    if (error.status === 429) {
      return {
        errorCategory: 'wb_rate_limited',
        statusCode: 429,
        shortMessage: 'WB временно ограничил источник, данные догрузим позже',
        operation: error.operation,
        reason: 'wb_rate_limited',
        retryable: true,
      };
    }

    if (typeof error.status === 'number' && error.status >= 500) {
      return {
        errorCategory: 'wb_upstream_error',
        statusCode: error.status,
        shortMessage: `WB API ${error.status}`,
        operation: error.operation,
        retryable: error.retryable,
      };
    }

    return {
      errorCategory: 'unknown_error',
      statusCode: error.status,
      shortMessage: error.status ? `WB API ${error.status}` : 'WB API ошибка',
      operation: error.operation,
      retryable: error.retryable,
    };
  }

  const message = serializeError(error);
  if (/fetch failed|ECONNREFUSED|timed out|network/i.test(message)) {
    return {
      errorCategory: 'network_error',
      shortMessage: 'Сетевой сбой',
    };
  }

  return undefined;
}

function isWbRateLimitedSource(source: SyncSourceSummary) {
  return source.meta?.reason === 'wb_rate_limited'
    || source.meta?.errorCategory === 'wb_rate_limited'
    || source.meta?.statusCode === 429;
}

function shouldSkipAdsTransientError(source: string, meta: SyncSourceMeta | undefined, error: unknown) {
  if (source !== 'ads' && source !== 'ad_clusters') {
    return false;
  }

  if (meta?.statusCode === 401) {
    return false;
  }

  if (meta?.statusCode === 429) {
    return true;
  }

  if (meta?.errorCategory === 'network_error' || meta?.errorCategory === 'wb_upstream_error') {
    return true;
  }

  if (error instanceof WbApiError) {
    return error.retryable && error.status !== 401;
  }

  return false;
}

export async function runSyncSource(
  source: string,
  executor: () => Promise<{
    status?: Exclude<SyncSourceStatus, 'error'>;
    records?: number;
    batches?: number;
    meta?: SyncSourceMeta;
  }>,
  options?: {
    timeoutMs?: number;
  }
): Promise<SyncSourceSummary> {
  const startedAt = new Date().toISOString();
  const timeoutMs = options?.timeoutMs;

  try {
    const result = timeoutMs
      ? await Promise.race([
          executor(),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new SyncSourceTimeoutError(source, timeoutMs)), timeoutMs);
          }),
        ])
      : await executor();

    return {
      source,
      status: result.status ?? 'success',
      records: result.records ?? 0,
      batches: result.batches ?? 0,
      meta: result.meta,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  } catch (error) {
    const meta = classifySyncError(error);
    if (shouldSkipAdsTransientError(source, meta, error)) {
      return {
        source,
        status: 'skipped',
        records: 0,
        batches: 0,
        meta: {
          ...meta,
          reason: meta?.statusCode === 429 ? 'wb_rate_limited' : 'wb_temporary_unavailable',
          fallbackError: serializeError(error),
        },
        startedAt,
        finishedAt: new Date().toISOString(),
      };
    }

    return {
      source,
      status: 'error',
      records: 0,
      batches: 0,
      error: serializeError(error),
      meta,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  }
}

function buildSyncRunDiagnosis(sources: SyncSourceSummary[]): SyncRunDiagnosis | undefined {
  const errorSources = sources.filter((source) => source.status === 'error');
  if (errorSources.length === 0) {
    return undefined;
  }

  const affectedSources = errorSources.map((source) => source.source);
  const rateLimitedSources = errorSources.filter(isWbRateLimitedSource);
  if (rateLimitedSources.length === errorSources.length) {
    return {
      kind: 'wb_rate_limited',
      title: 'Wildberries временно ограничил часть данных',
      message: rateLimitedSources.length === 1
        ? 'WB временно ограничил источник. Данные догрузим автоматически позже.'
        : `WB временно ограничил источники: ${affectedSources.join(', ')}. Данные догрузим автоматически позже.`,
      action: 'Повторный догруз поставлен точечно по ограниченным источникам.',
      affectedSources,
    };
  }

  const invalidTokenSources = errorSources.filter((source) => source.meta?.errorCategory === 'wb_token_invalid');
  if (invalidTokenSources.length === errorSources.length) {
    return {
      kind: 'wb_token_invalid',
      title: 'Wildberries отклонил токен кабинета',
      message: 'API токен кабинета не принят Wildberries. Обновите токен в блоке Wildberries Token и повторите синхронизацию.',
      action: 'Обновите токен и повторите синхронизацию.',
      affectedSources,
    };
  }

  const authFailedSources = errorSources.filter((source) => source.meta?.errorCategory === 'wb_auth_failed');
  if (authFailedSources.length === errorSources.length) {
    return {
      kind: 'wb_auth_failed',
      title: 'WB API не авторизовал синхронизацию',
      message: 'Wildberries вернул ошибку авторизации для всех источников. Проверьте токен кабинета и его права доступа.',
      action: 'Проверьте токен и права доступа.',
      affectedSources,
    };
  }

  return {
    kind: 'source_failures',
    title: 'Синхронизация завершилась с ошибками',
    message: errorSources.length === 1
      ? 'Один источник завершился ошибкой. Проверьте breakdown ниже.'
      : `${errorSources.length} источников завершились ошибкой. Проверьте breakdown ниже.`,
    affectedSources,
  };
}

export function buildSyncRunSummary(
  sources: SyncSourceSummary[],
  progress?: {
    totalSources?: number;
    completedSources?: number;
    runningSource?: string;
    updatedAt?: string;
  }
): SyncRunSummary {
  const totalSources = Math.max(progress?.totalSources ?? sources.length, sources.length);
  const completedSources = Math.min(progress?.completedSources ?? sources.length, totalSources);
  const normalizedPercent = totalSources > 0
    ? Math.min(100, Math.max(0, Math.round((completedSources / totalSources) * 100)))
    : 0;

  return {
    sources,
    totals: {
      records: sources.reduce((sum, source) => sum + source.records, 0),
      batches: sources.reduce((sum, source) => sum + source.batches, 0),
      errors: sources.filter((source) => source.status === 'error').length,
    },
    progress: {
      totalSources,
      completedSources,
      runningSource: progress?.runningSource,
      percent: normalizedPercent,
      updatedAt: progress?.updatedAt ?? new Date().toISOString(),
    },
    diagnosis: buildSyncRunDiagnosis(sources),
  };
}

export function formatSyncRunErrorMessage(summary: SyncRunSummary) {
  if (summary.diagnosis) {
    return summary.diagnosis.message;
  }

  const errorSources = summary.sources.filter((source) => source.status === 'error');
  if (errorSources.length === 0) {
    return null;
  }

  return errorSources
    .slice(0, 3)
    .map((source) => `${source.source}: ${source.meta?.shortMessage ?? source.error ?? 'Ошибка'}`)
    .join('\n');
}

export function resolveSyncRunStatus(sources: SyncSourceSummary[]): SyncRunStatus {
  const hasSuccess = sources.some((source) => source.status === 'success');
  const errorSources = sources.filter((source) => source.status === 'error');
  const hasErrors = errorSources.length > 0;

  if (hasErrors && !hasSuccess) {
    return errorSources.every(isWbRateLimitedSource) ? 'completed_with_errors' : 'failed';
  }

  if (hasErrors) {
    return 'completed_with_errors';
  }

  return 'completed';
}
