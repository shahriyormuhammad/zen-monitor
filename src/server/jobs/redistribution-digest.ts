import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { subDays } from "date-fns";
import { and, eq, isNotNull } from "drizzle-orm";

import { inngest } from "@/inngest/client";
import { handleInngestFailure } from "@/inngest/on-failure";
import { db, withTenantContext } from "@/lib/db";
import { redistributionItems, redistributionRuns, tenants } from "@/lib/db/schema";
import { resolvePersistentOutputDir } from "@/lib/runtime-paths";
import type { RedistributionTransferRecommendation } from "@/server/analytics/redistribution";
import { buildRedistributionCsvContent, buildRedistributionCsvFilename } from "@/server/analytics/redistribution-csv";
import { getRedistributionPlan } from "@/server/analytics/redistribution";
import { applyRouteAvailabilityFilterToPlan } from "@/server/redistribution/route-scan";
import { BotService } from "@/server/bot/service";

const REDISTRIBUTION_DIGEST_CRON = process.env.REDISTRIBUTION_DIGEST_CRON ?? "30 3 * * *";
const REDISTRIBUTION_WINDOW_DAYS = (() => {
  const parsed = Number.parseInt(process.env.REDISTRIBUTION_WINDOW_DAYS ?? "91", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 91;
  }

  return Math.min(180, parsed);
})();
const REDISTRIBUTION_OUTPUT_DIR = process.env.REDISTRIBUTION_OUTPUT_DIR
  ? path.resolve(process.env.REDISTRIBUTION_OUTPUT_DIR)
  : resolvePersistentOutputDir("redistribution");
const REDISTRIBUTION_RPA_AUTO_QUEUE = process.env.REDISTRIBUTION_RPA_AUTO_QUEUE === "true";
const REDISTRIBUTION_RPA_EVENT = "wb/redistribution.rpa.requested";

function toUtcDayStart(value: Date) {
  const day = new Date(value);
  day.setUTCHours(0, 0, 0, 0);
  return day;
}

function parseIsoDay(value: string | null): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function toTransferApplicationComment(item: RedistributionTransferRecommendation) {
  return `Переместить ${item.transferUnits} шт размера ${item.sizeName} с ${item.fromWarehouse} (${item.fromRegionName}) на ${item.toWarehouse} (${item.toRegionName})`;
}

async function saveRunCsvFile(input: {
  runId: string;
  tenantName: string | null;
  fromIsoDay: string;
  toIsoDay: string;
  csvContent: string;
}) {
  await mkdir(REDISTRIBUTION_OUTPUT_DIR, { recursive: true });
  const fileName = buildRedistributionCsvFilename({
    tenantName: input.tenantName,
    from: input.fromIsoDay,
    to: input.toIsoDay,
    runId: input.runId,
  });
  const filePath = path.join(REDISTRIBUTION_OUTPUT_DIR, fileName);
  await writeFile(filePath, input.csvContent, "utf8");

  const checksumSha256 = createHash("sha256").update(input.csvContent, "utf8").digest("hex");
  return {
    fileName,
    filePath,
    checksumSha256,
  };
}

export const redistributionDigestJob = inngest.createFunction(
  {
    id: "redistribution-digest-daily",
    name: "Redistribution Digest Daily",
    concurrency: { limit: 1 },
    onFailure: handleInngestFailure,
    triggers: [{ cron: REDISTRIBUTION_DIGEST_CRON }],
  },
  async ({ step }) => {
    const activeTenants = await step.run("redistribution-digest-fetch-tenants", async () => {
      return db.select({
        id: tenants.id,
        name: tenants.name,
      })
        .from(tenants)
        .where(and(
          eq(tenants.notificationsEnabled, true),
          isNotNull(tenants.telegramChatId),
        ));
    });

    if (activeTenants.length === 0) {
      return {
        processed: 0,
        exported: 0,
        sent: 0,
        queuedRpa: 0,
      };
    }

    let exported = 0;
    let sent = 0;
    let queuedRpa = 0;
    let skippedNoRecommendations = 0;
    let failed = 0;

    const today = toUtcDayStart(new Date());
    const from = toUtcDayStart(subDays(today, REDISTRIBUTION_WINDOW_DAYS));
    const to = today;
    const fromIso = from.toISOString().slice(0, 10);
    const toIso = to.toISOString().slice(0, 10);

    for (const tenant of activeTenants) {
      let runId: string | null = null;

      try {
        const tenantPlanInitial = await step.run(`redistribution-digest-plan-${tenant.id}`, async () => {
          return getRedistributionPlan(tenant.id, from, to);
        });
        const tenantPlanFiltered = await step.run(`redistribution-digest-plan-filter-${tenant.id}`, async () => {
          return applyRouteAvailabilityFilterToPlan(tenant.id, tenantPlanInitial);
        });
        const tenantPlan = tenantPlanFiltered.plan;

        const createdRunArr = await step.run(`redistribution-digest-create-run-${tenant.id}`, async () => {
          return withTenantContext(db, tenant.id, async (tx) =>
            tx.insert(redistributionRuns).values({
            tenantId: tenant.id,
            triggerSource: "scheduled_daily",
            status: tenantPlan.recommendations.length > 0 ? "planned" : "skipped_no_recommendations",
            requestedFrom: parseIsoDay(tenantPlan.dataWindow.requestedFrom) ?? from,
            requestedTo: parseIsoDay(tenantPlan.dataWindow.requestedTo) ?? to,
            snapshotDate: parseIsoDay(tenantPlan.dataWindow.snapshotDate),
            snapshotPeriodFrom: parseIsoDay(tenantPlan.dataWindow.snapshotPeriodFrom),
            snapshotPeriodTo: parseIsoDay(tenantPlan.dataWindow.snapshotPeriodTo),
            requestedDateWindowDays: tenantPlan.dataWindow.requestedDateWindowDays,
            effectiveDateWindowDays: tenantPlan.dataWindow.effectiveDateWindowDays,
            windowAligned: tenantPlan.dataWindow.windowAligned,
            methodology: tenantPlan.assumptions.methodology,
            recommendationCount: tenantPlan.summary.recommendationCount,
            skuCount: tenantPlan.summary.skuCount,
            transferUnits: tenantPlan.summary.transferUnits,
            estimatedSavingsRub: tenantPlan.summary.estimatedSavingsRub.toFixed(2),
            currentKrpPct: tenantPlan.summary.currentKrpPct.toFixed(2),
            simulatedKrpPct: tenantPlan.summary.simulatedKrpPct.toFixed(2),
            currentLocalSharePct: tenantPlan.summary.currentLocalSharePct.toFixed(2),
            simulatedLocalSharePct: tenantPlan.summary.simulatedLocalSharePct.toFixed(2),
            assumptions: tenantPlan.assumptions,
            notes: tenantPlan.assumptions.notes,
            updatedAt: new Date(),
          }).returning({
            id: redistributionRuns.id,
          }),
          );
        });
        const createdRun = createdRunArr[0]!;
        runId = createdRun.id;

        if (!tenantPlan.recommendations.length) {
          skippedNoRecommendations += 1;
          continue;
        }

        const recommendationChunks = chunkArray(tenantPlan.recommendations, 500);
        for (let index = 0; index < recommendationChunks.length; index += 1) {
          const chunk = recommendationChunks[index]!;
          await step.run(`redistribution-digest-items-${tenant.id}-${index}`, async () => {
            await withTenantContext(db, tenant.id, async (tx) => {
              await tx.insert(redistributionItems).values(chunk.map((item) => ({
              runId: createdRun.id,
              tenantId: tenant.id,
              status: "planned",
              nmId: item.nmId,
              vendorCode: item.vendorCode,
              brand: item.brand,
              sizeName: item.sizeName,
              chrtId: item.chrtId,
              fromRegionName: item.fromRegionName,
              fromWarehouse: item.fromWarehouse,
              fromOfficeId: item.fromOfficeId,
              toRegionName: item.toRegionName,
              toWarehouse: item.toWarehouse,
              toOfficeId: item.toOfficeId,
              transferUnits: item.transferUnits,
              priorityScore: item.priorityScore.toFixed(2),
              estimatedSavingsRub: item.estimatedSavingsRub.toFixed(2),
              currentLocalSharePct: item.currentLocalSharePct.toFixed(2),
              simulatedLocalSharePct: item.simulatedLocalSharePct.toFixed(2),
              currentKrpPct: item.currentKrpPct.toFixed(2),
              simulatedKrpPct: item.simulatedKrpPct.toFixed(2),
              fromCoverageDaysBefore: item.fromCoverageDaysBefore === null ? null : item.fromCoverageDaysBefore.toFixed(2),
              toCoverageDaysBefore: item.toCoverageDaysBefore === null ? null : item.toCoverageDaysBefore.toFixed(2),
              applicationComment: toTransferApplicationComment(item),
              updatedAt: new Date(),
            })));
            });
          });
        }

        const csvContent = buildRedistributionCsvContent(tenantPlan);
        const csvMeta = await step.run(`redistribution-digest-csv-${tenant.id}`, async () => {
          return saveRunCsvFile({
            runId: createdRun.id,
            tenantName: tenant.name,
            fromIsoDay: fromIso,
            toIsoDay: toIso,
            csvContent,
          });
        });

        await step.run(`redistribution-digest-mark-exported-${tenant.id}`, async () => {
          await withTenantContext(db, tenant.id, async (tx) => {
            await tx.update(redistributionRuns)
              .set({
                status: "exported",
                csvFilePath: csvMeta.filePath,
                csvFileName: csvMeta.fileName,
                csvChecksumSha256: csvMeta.checksumSha256,
                csvGeneratedAt: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(redistributionRuns.id, createdRun.id));
          });
        });
        exported += 1;

        const telegramResult = await step.run(`redistribution-digest-send-${tenant.id}`, async () => {
          return BotService.sendRedistributionDigest(tenant.id, {
            generatedAt: tenantPlan.generatedAt,
            summary: tenantPlan.summary,
            recommendations: tenantPlan.recommendations.map((recommendation) => ({
              nmId: recommendation.nmId,
              vendorCode: recommendation.vendorCode,
              sizeName: recommendation.sizeName,
              fromWarehouse: recommendation.fromWarehouse,
              toWarehouse: recommendation.toWarehouse,
              transferUnits: recommendation.transferUnits,
            })),
            csvFilePath: csvMeta.filePath,
            csvFileName: csvMeta.fileName,
          });
        });

        if (telegramResult.sent) {
          await step.run(`redistribution-digest-mark-sent-${tenant.id}`, async () => {
            await withTenantContext(db, tenant.id, async (tx) => {
              await tx.update(redistributionRuns)
                .set({
                  status: REDISTRIBUTION_RPA_AUTO_QUEUE ? "rpa_queued" : "telegram_sent",
                  telegramSentAt: new Date(),
                  telegramMessageId: telegramResult.messageId,
                  rpaRequestedAt: REDISTRIBUTION_RPA_AUTO_QUEUE ? new Date() : null,
                  updatedAt: new Date(),
                })
                .where(eq(redistributionRuns.id, createdRun.id));
            });
          });
          sent += 1;
        } else {
          await step.run(`redistribution-digest-mark-telegram-error-${tenant.id}`, async () => {
            await withTenantContext(db, tenant.id, async (tx) => {
              await tx.update(redistributionRuns)
                .set({
                  status: "exported",
                  errorMessage: telegramResult.error ?? "telegram_send_failed",
                  updatedAt: new Date(),
                })
                .where(eq(redistributionRuns.id, createdRun.id));
            });
          });
        }

        if (REDISTRIBUTION_RPA_AUTO_QUEUE) {
          await step.run(`redistribution-digest-rpa-queue-${tenant.id}`, async () => {
            await withTenantContext(db, tenant.id, async (tx) => {
              await tx.update(redistributionItems)
                .set({
                  status: "rpa_queued",
                  updatedAt: new Date(),
                })
                .where(eq(redistributionItems.runId, createdRun.id));
            });

            await inngest.send({
              name: REDISTRIBUTION_RPA_EVENT,
              data: {
                tenantId: tenant.id,
                runId: createdRun.id,
                csvFilePath: csvMeta.filePath,
                csvFileName: csvMeta.fileName,
              },
            });
          });
          queuedRpa += 1;
        }
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : "redistribution_digest_unknown_error";

        if (runId) {
          await step.run(`redistribution-digest-mark-failed-${tenant.id}`, async () => {
            await withTenantContext(db, tenant.id, async (tx) => {
              await tx.update(redistributionRuns)
                .set({
                  status: "failed",
                  errorMessage: message.slice(0, 4000),
                  updatedAt: new Date(),
                })
                .where(eq(redistributionRuns.id, runId as string));
            });
          });
        }
      }
    }

    return {
      processed: activeTenants.length,
      exported,
      sent,
      queuedRpa,
      skippedNoRecommendations,
      failed,
      dateWindow: {
        from: from.toISOString(),
        to: to.toISOString(),
      },
      outputDir: REDISTRIBUTION_OUTPUT_DIR,
    };
  },
);
