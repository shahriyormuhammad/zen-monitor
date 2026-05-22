import { logger } from '@/lib/logger';

/**
 * Centralized wrapper for WB Ads API calls from the advertising workspace layer.
 *
 * Underlying retry + timeout logic lives in `src/lib/wb-api/client.ts`
 * (`fetchWithExponentialBackoff`, MAX_ATTEMPTS=5, REQUEST_TIMEOUT_MS=30s).
 * This helper adds consistent contextual logging (tenantId, advertId, nmId,
 * runId, operation label) so that diagnosing partial failures does not require
 * scrolling through ad-hoc `logger.warn` calls scattered across 3000-line
 * workspace.ts.
 *
 * Returns `T` on success or `null` on any error. Caller decides whether to
 * fall back to empty data, skip a strategy run, or rethrow. We intentionally
 * do NOT re-throw here: workspace callers want to continue the run with
 * partial data for analytics purposes. If the caller wants strict behaviour,
 * they can `throw` on `null`.
 */
export async function callWbAdsApi<T>(
  label: string,
  fn: () => Promise<T>,
  context: {
    tenantId: string;
    advertId?: number;
    nmId?: number;
    runId?: string | null;
    strategyId?: string | null;
    [key: string]: unknown;
  },
): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    logger.warn({ err: error, operation: label, ...context }, `[WB Ads] ${label} failed`);
    return null;
  }
}
