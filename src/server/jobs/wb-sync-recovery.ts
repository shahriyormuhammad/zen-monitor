import { and, eq, inArray, ne, sql } from "drizzle-orm";

import { inngest } from "@/inngest/client";
import { handleInngestFailure } from "@/inngest/on-failure";
import { db, withAdminContext, withTenantContext } from "@/lib/db";
import { syncRuns, tenants } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { buildSyncRunRecoveryPlan } from "@/server/jobs/wb-sync-recovery-plan";
import { resolveSyncRunStatus, type SyncRunStatus } from "@/server/jobs/sync-runtime";

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

const RECOVERY_CRON = process.env.WB_SYNC_RECOVERY_CRON ?? "*/15 * * * *";
const RECOVERY_STALE_MINUTES = parsePositiveInt(process.env.WB_SYNC_RECOVERY_STALE_MINUTES, 45);
const RECOVERY_FAILED_LOOKBACK_HOURS = parsePositiveInt(process.env.WB_SYNC_RECOVERY_FAILED_LOOKBACK_HOURS, 24);
const RECOVERY_MAX_RUNS_PER_TICK = parsePositiveInt(process.env.WB_SYNC_RECOVERY_MAX_RUNS_PER_TICK, 20);
const RECOVERY_MAX_ATTEMPTS = parsePositiveInt(process.env.WB_SYNC_RECOVERY_MAX_ATTEMPTS, 3);
const RECOVERY_TRIGGER_SOURCE = "auto-recovery";

const ACTIVE_STATUSES = ["pending", "running"] as const;

const isPlainRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);

const toDate = (value: unknown) => {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value;
  }

  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
};

type RecoveryCandidate = {
  id: string;
  tenantId: string;
  triggerSource: string | null;
  status: string;
  dateFrom: Date | null;
  dateTo: Date | null;
  requestedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  summary: Record<string, unknown>;
  errorMessage: string | null;
};

type RecoveryCandidateRow = Omit<RecoveryCandidate, "dateFrom" | "dateTo" | "requestedAt" | "startedAt" | "finishedAt" | "summary"> & {
  dateFrom: unknown;
  dateTo: unknown;
  requestedAt: unknown;
  startedAt: unknown;
  finishedAt: unknown;
  summary: unknown;
};

type RecoveryResult =
  | { skipped: true; reason: string; activeRunId?: string }
  | { finalized: true; status: SyncRunStatus }
  | { recovered: true; syncRunId: string };

function normalizeRecoveryCandidate(row: RecoveryCandidateRow): RecoveryCandidate {
  return {
    ...row,
    dateFrom: toDate(row.dateFrom),
    dateTo: toDate(row.dateTo),
    requestedAt: toDate(row.requestedAt) ?? new Date(0),
    startedAt: toDate(row.startedAt),
    finishedAt: toDate(row.finishedAt),
    summary: isPlainRecord(row.summary) ? row.summary : {},
  };
}

export const wbSyncRecoveryJob = inngest.createFunction(
  {
    id: "wb-sync-recovery",
    name: "WB Sync Recovery",
    concurrency: { limit: 1 },
    onFailure: handleInngestFailure,
    triggers: [{ cron: RECOVERY_CRON }],
  },
  async ({ step }) => {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - RECOVERY_STALE_MINUTES * 60_000);

    const candidatesRaw = await step.run("find-recoverable-sync-runs", async () => {
      return withAdminContext(db, async (tx) => tx
        .select({
          id: syncRuns.id,
          tenantId: syncRuns.tenantId,
          triggerSource: syncRuns.triggerSource,
          status: syncRuns.status,
          dateFrom: syncRuns.dateFrom,
          dateTo: syncRuns.dateTo,
          requestedAt: syncRuns.requestedAt,
          startedAt: syncRuns.startedAt,
          finishedAt: syncRuns.finishedAt,
          summary: syncRuns.summary,
          errorMessage: syncRuns.errorMessage,
        })
        .from(syncRuns)
        .innerJoin(tenants, eq(syncRuns.tenantId, tenants.id))
        .where(and(
          sql`COALESCE(${tenants.wbApiToken}, '') <> ''`,
          sql`COALESCE(${tenants.wbTokenHealthStatus}, '') <> 'invalid'`,
          sql`(
            (
              ${syncRuns.status} IN ('pending', 'running')
              AND COALESCE(${syncRuns.startedAt}, ${syncRuns.requestedAt}) <= ${staleBefore.toISOString()}::timestamptz
            )
            OR (
              ${syncRuns.status} = 'failed'
              AND ${syncRuns.errorMessage} LIKE '%[sync_run_stale_timeout]%'
              AND ${syncRuns.finishedAt} >= now() - (${RECOVERY_FAILED_LOOKBACK_HOURS} * interval '1 hour')
            )
          )`,
        ))
        .orderBy(syncRuns.requestedAt)
        .limit(RECOVERY_MAX_RUNS_PER_TICK));
    }) as unknown as RecoveryCandidateRow[];
    const candidates = candidatesRaw.map(normalizeRecoveryCandidate);

    let recovered = 0;
    let finalized = 0;
    let skipped = 0;

    for (const candidate of candidates) {
      const plan = buildSyncRunRecoveryPlan({
        status: candidate.status,
        triggerSource: candidate.triggerSource,
        summary: candidate.summary,
        requestedAt: candidate.requestedAt,
        startedAt: candidate.startedAt,
        finishedAt: candidate.finishedAt,
        errorMessage: candidate.errorMessage,
        staleBefore,
        maxAttempts: RECOVERY_MAX_ATTEMPTS,
      });

      if (!plan.shouldRecover) {
        skipped += 1;
        continue;
      }

      const recoveryResult = await step.run(`recover-sync-run-${candidate.id}`, async () => {
        return withTenantContext(db, candidate.tenantId, async (tx) => {
          const [activeSibling] = await tx.select({ id: syncRuns.id })
            .from(syncRuns)
            .where(and(
              eq(syncRuns.tenantId, candidate.tenantId),
              inArray(syncRuns.status, [...ACTIVE_STATUSES]),
              ne(syncRuns.id, candidate.id),
            ))
            .limit(1);

          if (activeSibling?.id) {
            return {
              skipped: true,
              reason: "active_sibling_exists",
              activeRunId: activeSibling.id,
            };
          }

          const recoverySummary = isPlainRecord(candidate.summary.recovery)
            ? candidate.summary.recovery
            : {};
          const nextRecovery = {
            ...recoverySummary,
            attempt: plan.nextAttempt,
            recoveredAt: now.toISOString(),
            reason: plan.reason,
            heartbeatAt: plan.heartbeatAt?.toISOString() ?? null,
            parentSyncRunId: candidate.id,
            requestedSources: plan.requestedSources,
            completedSources: plan.completedSources,
            remainingSources: plan.remainingSources,
          };

          if (plan.remainingSources.length === 0) {
            const status = resolveSyncRunStatus(plan.sourceSummaries);
            await tx.update(syncRuns)
              .set({
                status,
                finishedAt: now,
                summary: {
                  ...candidate.summary,
                  requestedSources: plan.requestedSources,
                  recovery: {
                    ...nextRecovery,
                    finalizedWithoutResume: true,
                  },
                },
                errorMessage: status === "completed"
                  ? null
                  : "[sync_run_auto_recovered] Stale run finalized from saved source summaries.",
              })
              .where(eq(syncRuns.id, candidate.id));

            return {
              finalized: true,
              status,
            };
          }

          const [newRun] = await tx.insert(syncRuns).values({
            tenantId: candidate.tenantId,
            requestedBy: null,
            triggerSource: RECOVERY_TRIGGER_SOURCE,
            status: "pending",
            dateFrom: candidate.dateFrom,
            dateTo: candidate.dateTo,
            summary: {
              requestedSources: plan.remainingSources,
              recovery: nextRecovery,
            },
          }).returning({ id: syncRuns.id });

          if (!newRun?.id) {
            throw new Error(`Failed to create recovery sync run for ${candidate.id}`);
          }

          await tx.update(syncRuns)
            .set({
              status: "failed",
              finishedAt: now,
              summary: {
                ...candidate.summary,
                requestedSources: plan.requestedSources,
                recovery: {
                  ...nextRecovery,
                  recoverySyncRunId: newRun.id,
                },
              },
              errorMessage: `[sync_run_auto_recovered] Stale sync run resumed as ${newRun.id}.`,
            })
            .where(eq(syncRuns.id, candidate.id));

          return {
            recovered: true,
            syncRunId: newRun.id,
          };
        });
      }) as unknown as RecoveryResult;

      if ("skipped" in recoveryResult && recoveryResult.skipped) {
        skipped += 1;
        continue;
      }

      if ("finalized" in recoveryResult && recoveryResult.finalized) {
        finalized += 1;
        continue;
      }

      if ("recovered" in recoveryResult && recoveryResult.recovered && recoveryResult.syncRunId) {
        await step.run(`dispatch-recovery-sync-${recoveryResult.syncRunId}`, async () => {
          await inngest.send({
            name: "wb/sync.requested",
            data: {
              tenantId: candidate.tenantId,
              syncRunId: recoveryResult.syncRunId,
              from: candidate.dateFrom?.toISOString(),
              to: candidate.dateTo?.toISOString(),
              requestedSources: plan.remainingSources,
            },
          });
        });

        recovered += 1;
      }
    }

    logger.info(
      { scanned: candidates.length, recovered, finalized, skipped, staleMinutes: RECOVERY_STALE_MINUTES },
      "[SyncRecovery] recovery sweep complete",
    );

    return {
      scanned: candidates.length,
      recovered,
      finalized,
      skipped,
      staleMinutes: RECOVERY_STALE_MINUTES,
    };
  },
);
