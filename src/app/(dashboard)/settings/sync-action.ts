'use server'

import { inngest } from "@/inngest/client";
import { revalidatePath } from "next/cache";
import { invalidateDashboardCache } from "@/lib/analytics/dashboard-cache";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { db, withTenantContext } from "@/lib/db";
import { syncRuns, tenants } from "@/lib/db/schema";
import { and, desc, eq, or, sql } from "drizzle-orm";
import { subDays } from "date-fns";
import {
  DEFAULT_SYNC_STALE_TIMEOUT_MINUTES,
  formatStaleSyncRunMessage,
} from "@/lib/sync-run";
import { logger } from "@/lib/logger";
import {
  WB_SYNC_ONBOARDING_SOURCES,
  type WbSyncSource,
} from "@/server/jobs/wb-sync-sources";

const syncRunSortOrder = sql`COALESCE(${syncRuns.startedAt}, ${syncRuns.requestedAt}, ${syncRuns.finishedAt})`;
const hasSyncRunTimestamp = sql`COALESCE(${syncRuns.startedAt}, ${syncRuns.requestedAt}, ${syncRuns.finishedAt}) IS NOT NULL`;

const SYNC_STALE_TIMEOUT_MINUTES = (() => {
  const parsed = Number.parseInt(process.env.WB_SYNC_STALE_TIMEOUT_MINUTES ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 10) {
    return DEFAULT_SYNC_STALE_TIMEOUT_MINUTES;
  }

  return parsed;
})();

const STALE_SYNC_RUN_MESSAGE = formatStaleSyncRunMessage(SYNC_STALE_TIMEOUT_MINUTES);

type TriggerWbSyncOptions = {
  triggerSource?: string;
  lookbackDays?: number;
  requestedSources?: readonly WbSyncSource[];
  summary?: Record<string, unknown>;
};

const getUtcDayStart = (value?: string | null) => {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  parsed.setUTCHours(0, 0, 0, 0);
  return parsed;
};

const resolveManualSyncRange = (from?: string, to?: string, lookbackDays = 30) => {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const parsedFrom = getUtcDayStart(from);
  const parsedTo = getUtcDayStart(to);

  let normalizedTo = parsedTo ?? today;
  if (normalizedTo > today) {
    normalizedTo = new Date(today);
  }

  let normalizedFrom = parsedFrom ?? subDays(normalizedTo, Math.max(1, lookbackDays));
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

function isInngestRuntimeConnectionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const causeCode = error instanceof Error && typeof error.cause === "object" && error.cause !== null && "code" in error.cause
    ? String(error.cause.code)
    : "";
  const nestedCodes = error instanceof Error && typeof error.cause === "object" && error.cause !== null && "errors" in error.cause && Array.isArray(error.cause.errors)
    ? error.cause.errors.map((item) => {
        if (typeof item === "object" && item !== null && "code" in item) {
          return String(item.code);
        }

        return "";
      }).join(" ")
    : "";

  return /ECONNREFUSED|fetch failed/i.test([message, causeCode, nestedCodes].join(" "));
}

function resolveSyncTriggerMessage(error: unknown) {
  if (process.env.INNGEST_DEV && isInngestRuntimeConnectionError(error)) {
    return "Локальный Inngest Dev Server недоступен. Запустите `npm run dev:runtime` или отдельно `npm run inngest:dev` рядом с `npm run dev`.";
  }

  return error instanceof Error ? error.message : "Failed to trigger sync";
}

async function expireStaleSyncRuns(tenantId: string) {
  if (!tenantId) {
    return;
  }

  try {
    const staleBeforeIso = new Date(Date.now() - SYNC_STALE_TIMEOUT_MINUTES * 60_000).toISOString();
    const finalizedAt = new Date();

    await withTenantContext(db, tenantId, async (tx) => {
      await tx.update(syncRuns)
        .set({
          status: "failed",
          finishedAt: finalizedAt,
          errorMessage: STALE_SYNC_RUN_MESSAGE,
        })
        .where(and(
          eq(syncRuns.tenantId, tenantId),
          or(eq(syncRuns.status, "pending"), eq(syncRuns.status, "running")),
          sql`COALESCE((${syncRuns.summary}->'progress'->>'updatedAt')::timestamptz, ${syncRuns.startedAt}, ${syncRuns.requestedAt}) < ${staleBeforeIso}::timestamptz`,
        ));
    });
  } catch (error) {
    logger.error({ err: error, tenantId, timeoutMinutes: SYNC_STALE_TIMEOUT_MINUTES }, "[Sync] Failed to expire stale sync runs");
  }
}

export async function triggerWbSync(tenantId: string, from?: string, to?: string, options: TriggerWbSyncOptions = {}) {
  if (!tenantId) throw new Error("Tenant ID is required");
  const { user } = await requireTenantAccess(tenantId, ['owner', 'admin']);
  const triggerSource = options.triggerSource?.trim() || 'manual';
  const requestedSources = options.requestedSources ? [...options.requestedSources] : undefined;
  const range = resolveManualSyncRange(from, to, options.lookbackDays);
  const summary = {
    ...(options.summary ?? {}),
    ...(requestedSources ? { requestedSources } : {}),
  };

  const syncRunId = await withTenantContext(db, tenantId, async (tx) => {
    const [row] = await tx.insert(syncRuns).values({
      tenantId,
      requestedBy: user.id,
      triggerSource,
      status: 'pending',
      dateFrom: range.fromDate,
      dateTo: range.toDate,
      summary,
    }).returning({ id: syncRuns.id });
    return row!.id;
  });

  try {
    logger.info({ tenantId, from: range.fromIsoDate, to: range.toIsoDate, triggerSource, requestedSources }, "[Sync] Triggering WB sync");

    await inngest.send({
      name: "wb/sync.requested",
      data: {
        tenantId: tenantId,
        syncRunId,
        from: range.fromIsoDate,
        to: range.toIsoDate,
        ...(requestedSources ? { requestedSources } : {}),
      },
    });

    invalidateDashboardCache(tenantId);
    revalidatePath('/overview');
    revalidatePath('/settings');
    return { success: true, syncRunId };
  } catch (error) {
    const errorMessage = resolveSyncTriggerMessage(error);
    logger.error({ err: error, tenantId }, "[Sync Error] Failed to trigger sync");
    await withTenantContext(db, tenantId, async (tx) => {
      await tx.update(syncRuns)
        .set({
          status: 'failed',
          finishedAt: new Date(),
          errorMessage,
        })
        .where(eq(syncRuns.id, syncRunId));
    });
    throw new Error(errorMessage);
  }
}

export async function triggerInitialWbSync(tenantId: string) {
  return triggerWbSync(tenantId, undefined, undefined, {
    triggerSource: 'onboarding_initial',
    lookbackDays: 7,
    requestedSources: WB_SYNC_ONBOARDING_SOURCES,
    summary: {
      profile: 'onboarding_initial',
      comment: 'Fast first sync: essentials only; heavy finance, funnel, ads and warehouse analytics are loaded by scheduled background jobs.',
    },
  });
}

export async function getLatestSyncRun(tenantId: string) {
  if (!tenantId) {
    return null;
  }

  await requireTenantAccess(tenantId);
  await expireStaleSyncRuns(tenantId);

  const latestRun = await withTenantContext(db, tenantId, async (tx) => {
    const [row] = await tx.select({
      id: syncRuns.id,
      status: syncRuns.status,
      requestedAt: syncRuns.requestedAt,
      startedAt: syncRuns.startedAt,
      finishedAt: syncRuns.finishedAt,
      dateFrom: syncRuns.dateFrom,
      dateTo: syncRuns.dateTo,
      summary: syncRuns.summary,
      errorMessage: syncRuns.errorMessage,
      triggerSource: syncRuns.triggerSource,
    })
      .from(syncRuns)
      .where(and(eq(syncRuns.tenantId, tenantId), hasSyncRunTimestamp))
      .orderBy(desc(syncRunSortOrder))
      .limit(1);
    return row ?? null;
  });

  return latestRun;
}

const DEFAULT_SYNC_HISTORY_LIMIT = 50;
const MAX_SYNC_HISTORY_LIMIT = 200;

export async function getSyncRunsHistory(tenantId: string, limit = DEFAULT_SYNC_HISTORY_LIMIT) {
  if (!tenantId) {
    return [];
  }

  await requireTenantAccess(tenantId);
  await expireStaleSyncRuns(tenantId);

  const safeLimit = Number.isFinite(limit)
    ? Math.max(1, Math.min(Math.floor(limit), MAX_SYNC_HISTORY_LIMIT))
    : DEFAULT_SYNC_HISTORY_LIMIT;

  return withTenantContext(db, tenantId, async (tx) =>
    tx.select({
      id: syncRuns.id,
      status: syncRuns.status,
      requestedAt: syncRuns.requestedAt,
      startedAt: syncRuns.startedAt,
      finishedAt: syncRuns.finishedAt,
      dateFrom: syncRuns.dateFrom,
      dateTo: syncRuns.dateTo,
      summary: syncRuns.summary,
      errorMessage: syncRuns.errorMessage,
      triggerSource: syncRuns.triggerSource,
    })
      .from(syncRuns)
      .where(and(eq(syncRuns.tenantId, tenantId), hasSyncRunTimestamp))
      .orderBy(desc(syncRunSortOrder))
      .limit(safeLimit),
  );
}

export async function getTenantSyncPrerequisites(tenantId: string) {
  if (!tenantId) {
    return null;
  }

  await requireTenantAccess(tenantId);

  // `tenants` не входит в 0040_rls_enable.sql (root-таблица, нет tenant_id) —
  // withTenantContext не нужен.
  const [tenant] = await db.select({
    wbTokenHealthStatus: tenants.wbTokenHealthStatus,
    wbLkPhone: tenants.wbLkPhone,
    wbLkSessionStatus: tenants.wbLkSessionStatus,
    wbLkSessionCheckedAt: tenants.wbLkSessionCheckedAt,
    wbLkSessionError: tenants.wbLkSessionError,
  })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  return tenant ?? null;
}
