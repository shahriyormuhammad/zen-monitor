import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { apiRoute } from "@/lib/api-response";
import { withIdempotencyKey } from "@/lib/idempotency";
import { withRateLimit } from "@/lib/rate-limit";
import { requireActiveTenant } from "@/lib/auth/tenant-access";
import { parseApiDateParam } from "@/lib/date-range";
import { db, withTenantContext } from "@/lib/db";
import { redistributionItems, redistributionRuns } from "@/lib/db/schema";
import { resolvePersistentOutputDir } from "@/lib/runtime-paths";
import { buildRedistributionRecommendationSelectionKey } from "@/lib/redistribution-selection";
import type { RedistributionTransferRecommendation } from "@/server/analytics/redistribution";
import { buildRedistributionCsvContent, buildRedistributionCsvFilename } from "@/server/analytics/redistribution-csv";
import { getRedistributionPlan } from "@/server/analytics/redistribution";
import { applyRouteAvailabilityFilterToPlan } from "@/server/redistribution/route-scan";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const REDISTRIBUTION_OUTPUT_DIR = process.env.REDISTRIBUTION_OUTPUT_DIR
  ? path.resolve(process.env.REDISTRIBUTION_OUTPUT_DIR)
  : resolvePersistentOutputDir("redistribution");
const MAX_MANUAL_SELECTION_KEYS = 300;

function parseIsoDay(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
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
  fromIsoDay: string;
  toIsoDay: string;
  csvContent: string;
}) {
  await mkdir(REDISTRIBUTION_OUTPUT_DIR, { recursive: true });
  const fileName = buildRedistributionCsvFilename({
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

export const POST = withRateLimit(withIdempotencyKey(apiRoute(async (request: Request) => {
    const { tenantId } = await requireActiveTenant(request, ["owner", "admin"]);
    const body = await request.json() as {
      from?: string;
      to?: string;
      selectedRecommendationKeys?: unknown;
    };

    const fromRaw = body.from?.trim();
    const toRaw = body.to?.trim();
    if (!fromRaw || !toRaw) {
      return NextResponse.json({ error: "from and to are required" }, { status: 400 });
    }

    const from = parseApiDateParam(fromRaw);
    const to = parseApiDateParam(toRaw);
    if (!from || !to) {
      return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
    }

    const initialPlan = await getRedistributionPlan(tenantId, from, to);
    const filteredResult = await applyRouteAvailabilityFilterToPlan(tenantId, initialPlan);
    const plan = filteredResult.plan;
    const selectedRecommendationKeys = Array.isArray(body.selectedRecommendationKeys)
      ? Array.from(new Set(
        body.selectedRecommendationKeys
          .filter((key): key is string => typeof key === "string")
          .map((key) => key.trim())
          .filter((key) => key.length > 0),
      )).slice(0, MAX_MANUAL_SELECTION_KEYS)
      : [];
    const hasManualSelection = selectedRecommendationKeys.length > 0;
    const selectedRecommendationKeySet = new Set(selectedRecommendationKeys);
    const recommendationsToRun = hasManualSelection
      ? plan.recommendations.filter((item) => selectedRecommendationKeySet.has(buildRedistributionRecommendationSelectionKey(item)))
      : plan.recommendations;
    const selectedNotFoundCount = hasManualSelection
      ? Math.max(0, selectedRecommendationKeySet.size - recommendationsToRun.length)
      : 0;
    const runRecommendationCount = recommendationsToRun.length;
    const runTransferUnits = recommendationsToRun.reduce((sum, item) => sum + item.transferUnits, 0);
    const runEstimatedSavingsRub = recommendationsToRun.reduce((sum, item) => sum + item.estimatedSavingsRub, 0);
    const runSkuCount = new Set(recommendationsToRun.map((item) => item.nmId)).size;
    const excludedCount = filteredResult.excludedItems.length;
    const excludedLimit = filteredResult.excludedByStatus.limit_exhausted;
    const excludedUnavailable = filteredResult.excludedByStatus.route_unavailable;
    const createdRun = await withTenantContext(db, tenantId, async (tx) => {
      const [row] = await tx.insert(redistributionRuns).values({
        tenantId,
        triggerSource: "manual_ui",
        status: runRecommendationCount > 0 ? "planned" : "skipped_no_recommendations",
        requestedFrom: parseIsoDay(plan.dataWindow.requestedFrom) ?? from,
        requestedTo: parseIsoDay(plan.dataWindow.requestedTo) ?? to,
        snapshotDate: parseIsoDay(plan.dataWindow.snapshotDate),
        snapshotPeriodFrom: parseIsoDay(plan.dataWindow.snapshotPeriodFrom),
        snapshotPeriodTo: parseIsoDay(plan.dataWindow.snapshotPeriodTo),
        requestedDateWindowDays: plan.dataWindow.requestedDateWindowDays,
        effectiveDateWindowDays: plan.dataWindow.effectiveDateWindowDays,
        windowAligned: plan.dataWindow.windowAligned,
        methodology: plan.assumptions.methodology,
        recommendationCount: runRecommendationCount,
        skuCount: runSkuCount,
        transferUnits: runTransferUnits,
        estimatedSavingsRub: runEstimatedSavingsRub.toFixed(2),
        currentKrpPct: plan.summary.currentKrpPct.toFixed(2),
        simulatedKrpPct: plan.summary.simulatedKrpPct.toFixed(2),
        currentLocalSharePct: plan.summary.currentLocalSharePct.toFixed(2),
        simulatedLocalSharePct: plan.summary.simulatedLocalSharePct.toFixed(2),
        assumptions: plan.assumptions,
        notes: plan.assumptions.notes,
        updatedAt: new Date(),
      }).returning({ id: redistributionRuns.id });

      if (recommendationsToRun.length > 0) {
        const chunks = chunkArray(recommendationsToRun, 500);
        for (const chunk of chunks) {
          await tx.insert(redistributionItems).values(chunk.map((item) => ({
            runId: row!.id,
            tenantId,
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
        }
      }

      return row!;
    });

    if (!recommendationsToRun.length) {
      return NextResponse.json({
        ok: true,
        runId: createdRun.id,
        status: "skipped_no_recommendations",
        message: hasManualSelection
          ? `Прогон создан, но ни одна выбранная позиция не попала в актуальный план (${selectedRecommendationKeySet.size} выбрано, ${selectedNotFoundCount} не найдено или отфильтровано).`
          : excludedCount > 0
            ? `Прогон создан, но все рекомендации исключены сканом маршрутов (лимит: ${excludedLimit}, недоступно: ${excludedUnavailable}).`
            : "Прогон создан, но в выбранном окне нет рекомендаций к перемещению.",
      });
    }

    const csvContent = buildRedistributionCsvContent({ recommendations: recommendationsToRun });
    const csvMeta = await saveRunCsvFile({
      runId: createdRun.id,
      fromIsoDay: fromRaw,
      toIsoDay: toRaw,
      csvContent,
    });

    await withTenantContext(db, tenantId, async (tx) => {
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

    return NextResponse.json({
      ok: true,
      runId: createdRun.id,
      status: "exported",
      message: hasManualSelection
        ? [
          `Прогон по выбранным маршрутам сформирован: CSV готов (${runRecommendationCount} маршрутов, ${runTransferUnits} шт).`,
          selectedNotFoundCount > 0
            ? `Не вошло в прогон: ${selectedNotFoundCount} (не найдено в актуальном плане или отфильтровано).`
            : null,
        ].filter(Boolean).join(" ")
        : excludedCount > 0
          ? `Прогон сформирован: CSV готов, исключено ${excludedCount} маршрутов (лимит: ${excludedLimit}, недоступно: ${excludedUnavailable}).`
          : "Прогон сформирован: CSV готов, можно одобрять запуск RPA.",
    });
})), { per: 'tenant', limit: 10, window: 60 });
