import { and, eq, gt, inArray, sql } from "drizzle-orm";

import { inngest } from "@/inngest/client";
import { handleInngestFailure } from "@/inngest/on-failure";
import { db, withTenantContext } from "@/lib/db";
import { syncRuns, tenants } from "@/lib/db/schema";
import { WB_SYNC_SOURCE_SEQUENCE, type WbSyncSource } from "@/server/jobs/wb-sync-sources";

const ADS_RETRY_EVENT = "wb/sync.ads_retry.requested";
const RETRYABLE_SYNC_SOURCES: readonly WbSyncSource[] = ["orders", "sales", "ads", "ad_clusters"];
const DEFAULT_RETRY_SOURCES: readonly WbSyncSource[] = ["ads", "ad_clusters"];

const parsePositiveInt = (value: string | undefined, fallback: number) => {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
};

const ADS_RETRY_MAX_ATTEMPTS = parsePositiveInt(process.env.WB_ADS_RETRY_MAX_ATTEMPTS, 2);
const ADS_RETRY_FIRST_DELAY_MINUTES = parsePositiveInt(process.env.WB_ADS_RETRY_DELAY_MINUTES, 10);
const ADS_RETRY_NEXT_DELAY_MINUTES = parsePositiveInt(process.env.WB_ADS_RETRY_DELAY_FOLLOWUP_MINUTES, 15);
const ACTIVE_RUN_LOCK_MINUTES = parsePositiveInt(process.env.WB_SYNC_ACTIVE_LOCK_MINUTES, 60);

type WbAdsRetryRequestedEvent = {
  data: {
    tenantId: string;
    from?: string;
    to?: string;
    attempt?: number;
    requestedSources?: WbSyncSource[];
    parentSyncRunId?: string;
    lastErrorCode?: number;
  };
};

type RetryStep = {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>;
  sleep(id: string, duration: string): Promise<void>;
};

const getUtcDayStart = (value?: string) => {
  const parsed = value ? new Date(value) : new Date();
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  parsed.setUTCHours(0, 0, 0, 0);
  return parsed;
};

const normalizeRange = (from?: string, to?: string) => {
  const today = getUtcDayStart() ?? new Date();
  today.setUTCHours(0, 0, 0, 0);

  const parsedFrom = getUtcDayStart(from);
  const parsedTo = getUtcDayStart(to);

  let normalizedTo = parsedTo ?? today;
  if (normalizedTo > today) {
    normalizedTo = new Date(today);
  }

  let normalizedFrom = parsedFrom ?? normalizedTo;
  if (normalizedFrom > normalizedTo) {
    normalizedFrom = new Date(normalizedTo);
  }

  return {
    fromDate: normalizedFrom,
    toDate: normalizedTo,
    fromIsoDate: normalizedFrom.toISOString().slice(0, 10),
    toIsoDate: normalizedTo.toISOString().slice(0, 10),
  };
};

const normalizeAttempt = (attempt?: number) => {
  if (!Number.isFinite(attempt)) {
    return 1;
  }

  return Math.max(1, Math.floor(attempt as number));
};

const normalizeRequestedSources = (sources?: WbSyncSource[]) => {
  if (!Array.isArray(sources)) {
    return [...DEFAULT_RETRY_SOURCES];
  }

  const normalized = sources.filter((source): source is WbSyncSource => (
    WB_SYNC_SOURCE_SEQUENCE.includes(source)
    && RETRYABLE_SYNC_SOURCES.includes(source)
  ));

  return normalized.length > 0 ? normalized : [...DEFAULT_RETRY_SOURCES];
};

const normalizeStatusCode = (value?: number) => {
  if (!Number.isFinite(value)) {
    return undefined;
  }

  const parsed = Math.floor(value as number);
  return parsed >= 100 && parsed <= 599 ? parsed : undefined;
};

const getRetryDelayMinutes = (attempt: number, lastErrorCode?: number) => {
  const baseDelay = attempt <= 1 ? ADS_RETRY_FIRST_DELAY_MINUTES : ADS_RETRY_NEXT_DELAY_MINUTES;
  if (lastErrorCode !== 429) {
    return baseDelay;
  }

  const exponent = Math.max(0, attempt - 1);
  const withBackoff = baseDelay * Math.pow(2, exponent);
  return Math.min(withBackoff, 120);
};

export const wbSyncAdsRetryDispatcher = inngest.createFunction(
  {
    id: "wb-sync-ads-retry-dispatcher",
    name: "WB Sync Ads Retry Dispatcher",
    concurrency: [
      { limit: 1, key: "event.data.tenantId" },
    ],
    onFailure: handleInngestFailure,
    triggers: [{ event: ADS_RETRY_EVENT }],
  },
  async ({ event, step }: { event: WbAdsRetryRequestedEvent; step: RetryStep }) => {
    const tenantId = event.data.tenantId;
    if (!tenantId) {
      throw new Error("Tenant ID is required for source retry");
    }

    const attempt = normalizeAttempt(event.data.attempt);
    if (attempt > ADS_RETRY_MAX_ATTEMPTS) {
      return {
        skipped: true,
        reason: "max_attempts_exceeded",
        tenantId,
        attempt,
        maxAttempts: ADS_RETRY_MAX_ATTEMPTS,
      };
    }

    const retrySources = normalizeRequestedSources(event.data.requestedSources);
    const lastErrorCode = normalizeStatusCode(event.data.lastErrorCode);
    const delayMinutes = getRetryDelayMinutes(attempt, lastErrorCode);

    await step.sleep(`ads-retry-delay-${attempt}`, `${delayMinutes}m`);

    const [tenant] = await step.run("ads-retry-load-tenant", async () => {
      return db
        .select({
          id: tenants.id,
          wbApiToken: tenants.wbApiToken,
          wbTokenHealthStatus: tenants.wbTokenHealthStatus,
        })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1);
    });

    if (!tenant) {
      return {
        skipped: true,
        reason: "tenant_not_found",
        tenantId,
        attempt,
      };
    }

    if (!tenant.wbApiToken?.trim()) {
      return {
        skipped: true,
        reason: "missing_token",
        tenantId,
        attempt,
      };
    }

    if (tenant.wbTokenHealthStatus === "invalid") {
      return {
        skipped: true,
        reason: "invalid_token",
        tenantId,
        attempt,
      };
    }

    const [activeRun] = await step.run("ads-retry-check-active-run", async () => {
      return withTenantContext(db, tenantId, async (tx) =>
        tx.select({
          id: syncRuns.id,
        })
          .from(syncRuns)
          .where(and(
            eq(syncRuns.tenantId, tenantId),
            inArray(syncRuns.status, ["pending", "running"]),
            gt(syncRuns.requestedAt, sql`now() - (${ACTIVE_RUN_LOCK_MINUTES} * interval '1 minute')`),
          ))
          .limit(1),
      );
    });

    if (activeRun?.id) {
      return {
        skipped: true,
        reason: "active_run_exists",
        tenantId,
        attempt,
        activeRunId: activeRun.id,
      };
    }

    const range = normalizeRange(event.data.from, event.data.to);
    const triggerSource = `scheduled-source-retry-${attempt}`.slice(0, 50);

    const syncRunArr = await step.run("ads-retry-create-sync-run", async () => {
      return withTenantContext(db, tenantId, async (tx) =>
        tx.insert(syncRuns).values({
          tenantId,
          requestedBy: null,
          triggerSource,
          status: "pending",
          dateFrom: range.fromDate,
          dateTo: range.toDate,
          summary: {
            sourceRetry: {
              attempt,
              parentSyncRunId: event.data.parentSyncRunId ?? null,
              delayMinutes,
              lastErrorCode: lastErrorCode ?? null,
              requestedSources: [...retrySources],
            },
          },
        }).returning({
          id: syncRuns.id,
        }),
      );
    });
    const syncRun = syncRunArr[0]!;

    await step.run("ads-retry-dispatch-sync", async () => {
      await inngest.send({
        name: "wb/sync.requested",
        data: {
          tenantId,
          syncRunId: syncRun.id,
          from: range.fromIsoDate,
          to: range.toIsoDate,
          requestedSources: [...retrySources],
          adsRetryAttempt: attempt,
          adsRetryParentSyncRunId: event.data.parentSyncRunId ?? null,
        },
      });
    });

    return {
      success: true,
      tenantId,
      attempt,
      delayMinutes,
      lastErrorCode: lastErrorCode ?? null,
      syncRunId: syncRun.id,
      requestedSources: retrySources,
      range: {
        from: range.fromIsoDate,
        to: range.toIsoDate,
      },
    };
  },
);
