import { subDays } from "date-fns";
import { ne, sql } from "drizzle-orm";

import { inngest } from "@/inngest/client";
import { handleInngestFailure } from "@/inngest/on-failure";
import { db, withTenantContext } from "@/lib/db";
import { tenants } from "@/lib/db/schema";
import {
  WB_SYNC_FAST_SOURCES,
  WB_SYNC_MEDIUM_SOURCES,
  WB_SYNC_NIGHTLY_SOURCES,
  WB_SYNC_PRICE_SNAPSHOT_SOURCES,
  WB_SYNC_WEEKLY_FINANCE_RETRY_SOURCES,
  type WbSyncSource,
} from "@/server/jobs/wb-sync-sources";

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

const FAST_SYNC_CRON = process.env.WB_SYNC_FAST_CRON ?? "0 * * * *";
const MEDIUM_SYNC_CRON = process.env.WB_SYNC_MEDIUM_CRON ?? "15 */2 * * *";
const NIGHTLY_SYNC_CRON = process.env.WB_SYNC_NIGHTLY_CRON ?? "10 2 * * *";
const SPP_SNAPSHOT_CRON = process.env.WB_SPP_SNAPSHOT_CRON ?? "0 6,15 * * *";
const WEEKLY_FINANCE_RETRY_CRONS = (
  process.env.WB_SYNC_WEEKLY_FINANCE_RETRY_CRONS
  ?? "30 7 * * 1-3;0 9 * * 1-3;0 11 * * 1-3"
)
  .split(";")
  .map((entry) => entry.trim())
  .filter(Boolean);
const ACTIVE_RUN_LOCK_MINUTES = parsePositiveInt(process.env.WB_SYNC_ACTIVE_LOCK_MINUTES, 60);
const STALE_RUN_TIMEOUT_MINUTES = Math.max(
  ACTIVE_RUN_LOCK_MINUTES,
  parsePositiveInt(process.env.WB_SYNC_STALE_TIMEOUT_MINUTES, 240),
);
const NIGHTLY_SYNC_LOOKBACK_DAYS = (() => {
  const parsed = Number.parseInt(process.env.WB_SYNC_NIGHTLY_LOOKBACK_DAYS ?? "91", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 91;
  }
  return Math.min(180, parsed);
})();

type ScheduledWbSyncProfile = {
  profile: "fast" | "medium" | "nightly" | "spp_snapshot" | "weekly_finance_retry";
  triggerSource: string;
  lookbackDays: number;
  sources: readonly WbSyncSource[];
  weeklyFinanceRetry?: boolean;
};

const FAST_PROFILE: ScheduledWbSyncProfile = {
  profile: "fast",
  triggerSource: "scheduled-fast-60m",
  lookbackDays: 0,
  sources: WB_SYNC_FAST_SOURCES,
};

const MEDIUM_PROFILE: ScheduledWbSyncProfile = {
  profile: "medium",
  triggerSource: "scheduled-medium-2h",
  lookbackDays: 0,
  sources: WB_SYNC_MEDIUM_SOURCES,
};

const NIGHTLY_PROFILE: ScheduledWbSyncProfile = {
  profile: "nightly",
  triggerSource: "scheduled-nightly",
  lookbackDays: NIGHTLY_SYNC_LOOKBACK_DAYS,
  sources: WB_SYNC_NIGHTLY_SOURCES,
};

const SPP_SNAPSHOT_PROFILE: ScheduledWbSyncProfile = {
  profile: "spp_snapshot",
  triggerSource: "scheduled-spp-snapshot",
  lookbackDays: 0,
  sources: WB_SYNC_PRICE_SNAPSHOT_SOURCES,
};

const WEEKLY_FINANCE_RETRY_PROFILE: ScheduledWbSyncProfile = {
  profile: "weekly_finance_retry",
  triggerSource: "scheduled-weekly-finance-retry",
  lookbackDays: 0,
  sources: WB_SYNC_WEEKLY_FINANCE_RETRY_SOURCES,
  weeklyFinanceRetry: true,
};

const getUtcDayBucket = (value: Date) => {
  const bucket = new Date(value);
  bucket.setUTCHours(0, 0, 0, 0);
  return bucket;
};

export function getPreviousWeeklyReportRange(referenceDate = new Date()) {
  const today = getUtcDayBucket(referenceDate);
  const dayOfWeek = today.getUTCDay();
  const daysSincePreviousSunday = dayOfWeek === 0 ? 7 : dayOfWeek;
  const reportEnd = getUtcDayBucket(subDays(today, daysSincePreviousSunday));
  const reportStart = getUtcDayBucket(subDays(reportEnd, 6));

  return {
    reportStart,
    reportEnd,
    reportStartIso: reportStart.toISOString(),
    reportEndIso: reportEnd.toISOString(),
    reportStartDate: reportStart.toISOString().slice(0, 10),
    reportEndDate: reportEnd.toISOString().slice(0, 10),
  };
}

type ScheduledStep = {
  run: (id: string, fn: () => Promise<unknown>) => Promise<unknown>;
};

async function enqueueScheduledWbSync(
  step: ScheduledStep,
  profile: ScheduledWbSyncProfile,
) {
  const rangeTo = getUtcDayBucket(new Date());
  const weeklyReportRange = profile.weeklyFinanceRetry
    ? getPreviousWeeklyReportRange(rangeTo)
    : null;
  const rangeFrom = weeklyReportRange
    ? weeklyReportRange.reportStart
    : profile.lookbackDays > 0
      ? getUtcDayBucket(subDays(rangeTo, profile.lookbackDays))
      : new Date(rangeTo);
  const rangeFromIso = rangeFrom.toISOString();
  const rangeToIso = rangeTo.toISOString();

  const activeTenants = await step.run(`scheduled-${profile.profile}-fetch-tenants`, async () => {
    return db
      .select({
        id: tenants.id,
        wbApiToken: tenants.wbApiToken,
      })
      .from(tenants)
      .where(ne(tenants.wbTokenHealthStatus, "invalid"));
  }) as Array<{ id: string; wbApiToken: string }>;

  let queued = 0;
  let skippedWithoutToken = 0;
  let skippedBusy = 0;
  let skippedAlreadyLoaded = 0;

  for (const tenant of activeTenants) {
    if (!tenant.wbApiToken?.trim()) {
      skippedWithoutToken += 1;
      continue;
    }

    if (weeklyReportRange) {
      const coverageRows = await step.run(`scheduled-${profile.profile}-check-coverage-${tenant.id}`, async () => {
        return withTenantContext(db, tenant.id, async (tx) => tx.execute<{
          maxDateTo: string | null;
        }>(sql`
          SELECT MAX(date_to)::date::text AS "maxDateTo"
          FROM raw_api_realization_reports
          WHERE tenant_id = ${tenant.id}::uuid
        `));
      }) as Array<{ maxDateTo: string | null }>;
      const maxDateTo = coverageRows[0]?.maxDateTo ?? null;

      if (maxDateTo && maxDateTo >= weeklyReportRange.reportEndDate) {
        skippedAlreadyLoaded += 1;
        continue;
      }
    }

    const summaryPayload = JSON.stringify({
      scheduledProfile: profile.profile,
      requestedSources: [...profile.sources],
      weeklyReportRange: weeklyReportRange
        ? {
            from: weeklyReportRange.reportStartDate,
            to: weeklyReportRange.reportEndDate,
          }
        : undefined,
    });
    const ignoreAdsRetryLock = profile.profile === "nightly";
    const createdSyncRuns = await step.run(`scheduled-${profile.profile}-create-run-${tenant.id}`, async () => {
      return withTenantContext(db, tenant.id, async (tx) =>
        tx.execute<{ id: string }>(sql`
          WITH expired_stale_runs AS (
            UPDATE sync_runs
            SET
              status = 'failed',
              finished_at = NOW(),
              error_message = '[sync_run_stale_timeout] Scheduled sync guard expired stale pending/running run.'
            WHERE tenant_id = ${tenant.id}::uuid
              AND status IN ('pending', 'running')
              AND COALESCE((summary->'progress'->>'updatedAt')::timestamptz, started_at, requested_at) <= now() - (${STALE_RUN_TIMEOUT_MINUTES} * interval '1 minute')
            RETURNING id
          )
          INSERT INTO sync_runs (
            tenant_id,
            requested_by,
            trigger_source,
            status,
            date_from,
            date_to,
            summary
          )
          SELECT
            ${tenant.id}::uuid,
            NULL,
            ${profile.triggerSource},
            'pending',
            ${rangeFromIso}::timestamptz,
            ${rangeToIso}::timestamptz,
            ${summaryPayload}::jsonb
          WHERE NOT EXISTS (
            SELECT 1
            FROM sync_runs
            WHERE tenant_id = ${tenant.id}::uuid
              AND status IN ('pending', 'running')
              AND COALESCE((summary->'progress'->>'updatedAt')::timestamptz, started_at, requested_at) > now() - (${STALE_RUN_TIMEOUT_MINUTES} * interval '1 minute')
              AND (
                ${ignoreAdsRetryLock}::boolean = false
                OR (
                  trigger_source NOT LIKE 'scheduled-ads-retry-%'
                  AND trigger_source NOT LIKE 'scheduled-source-retry-%'
                )
              )
          )
          RETURNING id
        `),
      );
    }) as Array<{ id: string }>;

    const [syncRun] = createdSyncRuns;
    if (!syncRun?.id) {
      skippedBusy += 1;
      continue;
    }

    await step.run(`scheduled-${profile.profile}-enqueue-${tenant.id}`, async () => {
      await inngest.send({
        name: "wb/sync.requested",
        data: {
          tenantId: tenant.id,
          syncRunId: syncRun.id,
          from: rangeFromIso,
          to: rangeToIso,
          requestedSources: [...profile.sources],
        },
      });
    });

    queued += 1;
  }

  return {
    profile: profile.profile,
    triggerSource: profile.triggerSource,
    sources: profile.sources,
    range: {
      from: rangeFromIso,
      to: rangeToIso,
    },
    scannedTenants: activeTenants.length,
    queued,
    skippedWithoutToken,
    skippedBusy,
    skippedAlreadyLoaded,
    weeklyReportRange: weeklyReportRange
      ? {
          from: weeklyReportRange.reportStartIso,
          to: weeklyReportRange.reportEndIso,
        }
      : null,
  };
}

export const wbSyncFastJob = inngest.createFunction(
  {
    id: "wb-sync-fast-30m",
    name: "WB Sync Fast 60m",
    concurrency: { limit: 1 },
    onFailure: handleInngestFailure,
    triggers: [{ cron: FAST_SYNC_CRON }],
  },
  async ({ step }) => {
    return enqueueScheduledWbSync(step, FAST_PROFILE);
  },
);

export const wbSyncMediumJob = inngest.createFunction(
  {
    id: "wb-sync-medium-2h",
    name: "WB Sync Medium 2h",
    concurrency: { limit: 1 },
    onFailure: handleInngestFailure,
    triggers: [{ cron: MEDIUM_SYNC_CRON }],
  },
  async ({ step }) => {
    return enqueueScheduledWbSync(step, MEDIUM_PROFILE);
  },
);

export const wbSyncNightlyJob = inngest.createFunction(
  {
    id: "wb-sync-nightly",
    name: "WB Sync Nightly Full",
    concurrency: { limit: 1 },
    onFailure: handleInngestFailure,
    triggers: [{ cron: NIGHTLY_SYNC_CRON }],
  },
  async ({ step }) => {
    return enqueueScheduledWbSync(step, NIGHTLY_PROFILE);
  },
);

export const wbSppSnapshotJob = inngest.createFunction(
  {
    id: "wb-spp-snapshot-2x-daily",
    name: "WB SPP Snapshot 2x Daily",
    concurrency: { limit: 1 },
    onFailure: handleInngestFailure,
    triggers: [{ cron: SPP_SNAPSHOT_CRON }],
  },
  async ({ step }) => {
    return enqueueScheduledWbSync(step, SPP_SNAPSHOT_PROFILE);
  },
);

export const wbSyncWeeklyFinanceRetryJob = inngest.createFunction(
  {
    id: "wb-sync-weekly-finance-retry",
    name: "WB Weekly Finance Retry",
    concurrency: { limit: 1 },
    onFailure: handleInngestFailure,
    triggers: WEEKLY_FINANCE_RETRY_CRONS.map((cron) => ({ cron })),
  },
  async ({ step }) => {
    return enqueueScheduledWbSync(step, WEEKLY_FINANCE_RETRY_PROFILE);
  },
);
