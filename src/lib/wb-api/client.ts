import { logger } from '@/lib/logger';

const MAX_ATTEMPTS = 5;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ERROR_PAYLOAD_LENGTH = 500;
const RATE_LIMIT_RETRY_DELAY_MS = 60_000;
const MAX_RETRY_AFTER_DELAY_MS = (() => {
  const parsed = Number.parseInt(process.env.WB_API_MAX_RETRY_AFTER_MS ?? '120000', 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 120_000;
  }

  return parsed;
})();

const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);
const OPERATION_MIN_INTERVAL_MS: Record<string, number> = {
  createDetailedHistoryReportDownload: 20_000,
  downloadDetailedHistoryReport: 20_000,
  getAdSpend: 20_000,
  getAdBalance: 1_000,
  getAdSpendHistory: 1_100,
  getAdBudget: 260,
  getDetailedHistoryReportStatus: 20_000,
  getNomenclatureReport: 20_000,
  getOrders: 60_000,
  getPaidStorage: 60_000,
  getPaidStorageDownload: 60_000,
  getPaidStorageStatus: 5_000,
  getFbwSupplies: 2_000,
  getFbwSupplyDetails: 2_000,
  getFbwSupplyGoods: 2_000,
  getRegionSales: 10_000,
  getRealizationReport: 60_000,
  getSalesV1: 60_000,
  getStockOfficesMetrics: 20_000,
  getStockSizesMetrics: 20_000,
  'getStocks.productsSummary': 20_000,
  'getStocks.wbWarehouses': 20_000,
  updateProductCards: 6_000,
};

type RateLimitState = {
  lastRequestedAt?: number;
  queue: Promise<void>;
};

const operationRateLimitState = new Map<string, RateLimitState>();

const getOperationMinIntervalMs = (operation: string) => {
  if (
    process.env.NODE_ENV === 'test'
    && process.env.WB_API_OPERATION_THROTTLE_IN_TESTS !== '1'
  ) {
    return 0;
  }

  return OPERATION_MIN_INTERVAL_MS[operation] ?? 0;
};

const getAbortError = (signal?: AbortSignal) => {
  const reason = signal?.reason;
  if (reason instanceof Error) {
    return reason;
  }

  return new DOMException('The operation was aborted.', 'AbortError');
};

const wait = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) {
    reject(getAbortError(signal));
    return;
  }

  const timeout = setTimeout(() => {
    cleanup();
    resolve();
  }, ms);

  const onAbort = () => {
    clearTimeout(timeout);
    cleanup();
    reject(getAbortError(signal));
  };

  const cleanup = () => {
    signal?.removeEventListener('abort', onAbort);
  };

  signal?.addEventListener('abort', onAbort, { once: true });
});

const getHeaderValue = (headers: HeadersInit | undefined, headerName: string) => {
  if (!headers) {
    return undefined;
  }

  const normalizedName = headerName.toLowerCase();

  if (headers instanceof Headers) {
    return headers.get(headerName) ?? undefined;
  }

  if (Array.isArray(headers)) {
    const entry = headers.find(([key]) => key.toLowerCase() === normalizedName);
    return entry?.[1];
  }

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === normalizedName) {
      return String(value);
    }
  }

  return undefined;
};

const fingerprintToken = (value: string | undefined) => {
  if (!value) {
    return 'no-token';
  }

  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }

  return (hash >>> 0).toString(36);
};

const waitForOperationRateLimit = async (
  operation: string,
  options: RequestInit,
  signal?: AbortSignal,
) => {
  const minIntervalMs = getOperationMinIntervalMs(operation);
  if (minIntervalMs <= 0) {
    return;
  }

  const tokenFingerprint = fingerprintToken(getHeaderValue(options.headers, 'Authorization'));
  const key = `${operation}:${tokenFingerprint}`;
  const state = operationRateLimitState.get(key) ?? { queue: Promise.resolve() };

  const queued = state.queue.catch(() => undefined).then(async () => {
    if (state.lastRequestedAt !== undefined) {
      const elapsed = Date.now() - state.lastRequestedAt;
      if (elapsed < minIntervalMs) {
        await wait(minIntervalMs - elapsed, signal);
      }
    }

    state.lastRequestedAt = Date.now();
  });

  state.queue = queued;
  operationRateLimitState.set(key, state);
  await queued;
};

const parseSecondsDelayMs = (value: string | null) => {
  if (!value) {
    return undefined;
  }

  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) {
    return undefined;
  }

  return Math.ceil(seconds * 1000);
};

const getBackoffDelay = (attempt: number, retryAfterMs?: number, status?: number) => {
  const baseDelay = Math.min(16_000, Math.pow(2, attempt) * 1000);
  const jitter = Math.floor(Math.random() * 300);
  const rateLimitDelay = status === 429 && retryAfterMs === undefined ? RATE_LIMIT_RETRY_DELAY_MS : 0;
  return Math.max(baseDelay + jitter, retryAfterMs ?? 0, rateLimitDelay);
};

const getRetryAfterMs = (response: Response) => {
  const rateLimitRetryMs = parseSecondsDelayMs(response.headers.get('X-Ratelimit-Retry'));
  if (rateLimitRetryMs !== undefined) {
    return rateLimitRetryMs;
  }

  const retryAfter = response.headers.get('Retry-After');
  const retryAfterSecondsMs = parseSecondsDelayMs(retryAfter);

  if (retryAfterSecondsMs !== undefined) {
    return retryAfterSecondsMs;
  }

  if (retryAfter) {
    const retryDate = Date.parse(retryAfter);
    if (!Number.isNaN(retryDate)) {
      return Math.max(0, retryDate - Date.now());
    }
  }

  return parseSecondsDelayMs(response.headers.get('X-Ratelimit-Reset'));
};

const isRetryAfterOverCap = (retryAfterMs: number | undefined) => (
  retryAfterMs !== undefined
    && MAX_RETRY_AFTER_DELAY_MS > 0
    && retryAfterMs > MAX_RETRY_AFTER_DELAY_MS
);

const truncatePayload = (payload: string) => {
  if (payload.length <= MAX_ERROR_PAYLOAD_LENGTH) {
    return payload;
  }

  return `${payload.slice(0, MAX_ERROR_PAYLOAD_LENGTH)}...`;
};

async function getErrorPayload(response: Response) {
  try {
    const text = await response.clone().text();
    return truncatePayload(text.trim());
  } catch {
    return '';
  }
}

export class WbApiError extends Error {
  readonly operation: string;
  readonly status?: number;
  readonly attempt: number;
  readonly retryable: boolean;
  readonly details?: string;

  constructor(params: {
    message: string;
    operation: string;
    status?: number;
    attempt: number;
    retryable: boolean;
    details?: string;
  }) {
    super(params.message);
    this.name = 'WbApiError';
    this.operation = params.operation;
    this.status = params.status;
    this.attempt = params.attempt;
    this.retryable = params.retryable;
    this.details = params.details;
  }
}

export async function createWbApiResponseError(
  operation: string,
  response: Response,
  attempt = 1
) {
  const details = await getErrorPayload(response);
  const retryable = RETRYABLE_STATUS_CODES.has(response.status);
  const detailSuffix = details ? `: ${details}` : '';

  return new WbApiError({
    message: `[WB API] ${operation} failed with status ${response.status}${detailSuffix}`,
    operation,
    status: response.status,
    attempt,
    retryable,
    details,
  });
}

export async function ensureWbApiResponseOk(
  operation: string,
  response: Response,
  attempt = 1
) {
  if (response.ok) {
    return response;
  }

  throw await createWbApiResponseError(operation, response, attempt);
}

export async function fetchWithExponentialBackoff(
  url: string,
  options: RequestInit,
  config?: {
    operation?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  }
): Promise<Response> {
  const operation = config?.operation ?? url;
  const timeoutMs = config?.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const externalSignal = config?.signal;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    if (externalSignal?.aborted) {
      throw getAbortError(externalSignal);
    }

    await waitForOperationRateLimit(operation, options, externalSignal);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new DOMException('Request timed out', 'AbortError')), timeoutMs);
    const signal = externalSignal
      ? AbortSignal.any([controller.signal, externalSignal])
      : controller.signal;

    try {
      const response = await fetch(url, {
        ...options,
        signal,
      });

      clearTimeout(timeout);

      if (!RETRYABLE_STATUS_CODES.has(response.status)) {
        return response;
      }

      if (attempt >= MAX_ATTEMPTS) {
        throw await createWbApiResponseError(operation, response, attempt);
      }

      const retryAfterMs = getRetryAfterMs(response);
      if (response.status === 429 && isRetryAfterOverCap(retryAfterMs)) {
        logger.warn(
          {
            operation,
            status: response.status,
            retryAfterMs,
            maxRetryAfterDelayMs: MAX_RETRY_AFTER_DELAY_MS,
            attempt,
            maxAttempts: MAX_ATTEMPTS,
          },
          '[WB API] retry-after exceeds cap, failing fast'
        );
        throw await createWbApiResponseError(operation, response, attempt);
      }

      const delay = getBackoffDelay(attempt, retryAfterMs, response.status);
      logger.warn(
        { operation, status: response.status, delayMs: delay, attempt, maxAttempts: MAX_ATTEMPTS },
        '[WB API] retrying after status'
      );
      await wait(delay, externalSignal);
    } catch (error) {
      clearTimeout(timeout);

      if (error instanceof WbApiError) {
        throw error;
      }

      if (externalSignal?.aborted) {
        throw getAbortError(externalSignal);
      }

      const message =
        error instanceof Error && error.name === 'AbortError'
          ? `request timed out after ${timeoutMs}ms`
          : error instanceof Error
            ? error.message
            : 'Unknown network error';

      if (attempt >= MAX_ATTEMPTS) {
        throw new WbApiError({
          message: `[WB API] ${operation} failed after ${MAX_ATTEMPTS} attempts: ${message}`,
          operation,
          attempt,
          retryable: true,
          details: message,
        });
      }

      const delay = getBackoffDelay(attempt);
      logger.warn(
        { operation, delayMs: delay, attempt, maxAttempts: MAX_ATTEMPTS, reason: message },
        '[WB API] network failure, retrying'
      );
      await wait(delay, externalSignal);
    }
  }

  throw new WbApiError({
    message: `[WB API] ${operation} exhausted retry budget`,
    operation,
    attempt: MAX_ATTEMPTS,
    retryable: true,
  });
}

export function __resetWbRateLimitStateForTests() {
  operationRateLimitState.clear();
}
