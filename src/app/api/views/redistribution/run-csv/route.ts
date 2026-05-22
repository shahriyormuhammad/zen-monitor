import { readFile } from "node:fs/promises";

import { and, asc, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { apiRoute } from "@/lib/api-response";
import { requireActiveTenant } from "@/lib/auth/tenant-access";
import { db, withTenantContext } from "@/lib/db";
import { redistributionItems, redistributionRuns } from "@/lib/db/schema";
import type { RedistributionTransferRecommendation } from "@/server/analytics/redistribution";
import { buildRedistributionCsvContent, buildRedistributionCsvFilename } from "@/server/analytics/redistribution-csv";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const GET = apiRoute(async (request: Request) => {
  const { tenantId } = await requireActiveTenant(request);
  const { searchParams } = new URL(request.url);
  const runId = searchParams.get("runId")?.trim() ?? null;

  const loaded = await withTenantContext(db, tenantId, async (tx) => {
    const [run] = runId
      ? await tx.select({
          id: redistributionRuns.id,
          csvFilePath: redistributionRuns.csvFilePath,
          csvFileName: redistributionRuns.csvFileName,
          requestedFrom: redistributionRuns.requestedFrom,
          requestedTo: redistributionRuns.requestedTo,
        })
          .from(redistributionRuns)
          .where(and(
            eq(redistributionRuns.tenantId, tenantId),
            eq(redistributionRuns.id, runId),
          ))
          .limit(1)
      : await tx.select({
          id: redistributionRuns.id,
          csvFilePath: redistributionRuns.csvFilePath,
          csvFileName: redistributionRuns.csvFileName,
          requestedFrom: redistributionRuns.requestedFrom,
          requestedTo: redistributionRuns.requestedTo,
        })
          .from(redistributionRuns)
          .where(eq(redistributionRuns.tenantId, tenantId))
          .orderBy(desc(redistributionRuns.createdAt))
          .limit(1);

    if (!run) {
      return null;
    }

    const items = await tx.select({
      nmId: redistributionItems.nmId,
      vendorCode: redistributionItems.vendorCode,
      brand: redistributionItems.brand,
      sizeName: redistributionItems.sizeName,
      chrtId: redistributionItems.chrtId,
      fromRegionName: redistributionItems.fromRegionName,
      fromWarehouse: redistributionItems.fromWarehouse,
      fromOfficeId: redistributionItems.fromOfficeId,
      toRegionName: redistributionItems.toRegionName,
      toWarehouse: redistributionItems.toWarehouse,
      toOfficeId: redistributionItems.toOfficeId,
      transferUnits: redistributionItems.transferUnits,
      priorityScore: redistributionItems.priorityScore,
      estimatedSavingsRub: redistributionItems.estimatedSavingsRub,
      currentLocalSharePct: redistributionItems.currentLocalSharePct,
      simulatedLocalSharePct: redistributionItems.simulatedLocalSharePct,
      currentKrpPct: redistributionItems.currentKrpPct,
      simulatedKrpPct: redistributionItems.simulatedKrpPct,
      fromCoverageDaysBefore: redistributionItems.fromCoverageDaysBefore,
      toCoverageDaysBefore: redistributionItems.toCoverageDaysBefore,
    })
      .from(redistributionItems)
      .where(eq(redistributionItems.runId, run.id))
      .orderBy(asc(redistributionItems.createdAt));

    return { run, items };
  });

  if (!loaded) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const { run, items } = loaded;
  const fileName = run.csvFileName?.trim() || buildRedistributionCsvFilename({
    from: run.requestedFrom.toISOString().slice(0, 10),
    to: run.requestedTo.toISOString().slice(0, 10),
    runId: run.id,
  });

  let csvContent: string;

  if (items.length > 0) {
    const recommendations: RedistributionTransferRecommendation[] = items.map((item) => ({
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
      priorityScore: Number(item.priorityScore),
      estimatedSavingsRub: Number(item.estimatedSavingsRub),
      currentLocalSharePct: Number(item.currentLocalSharePct),
      simulatedLocalSharePct: Number(item.simulatedLocalSharePct),
      currentKrpPct: Number(item.currentKrpPct),
      simulatedKrpPct: Number(item.simulatedKrpPct),
      fromCoverageDaysBefore: item.fromCoverageDaysBefore !== null ? Number(item.fromCoverageDaysBefore) : null,
      toCoverageDaysBefore: item.toCoverageDaysBefore !== null ? Number(item.toCoverageDaysBefore) : null,
    }));
    csvContent = buildRedistributionCsvContent({ recommendations });
  } else if (run.csvFilePath) {
    const fileContent = await readFile(run.csvFilePath, "utf8").catch(() => null);
    if (!fileContent) {
      return NextResponse.json({ error: "CSV file is missing for selected run" }, { status: 404 });
    }
    csvContent = fileContent;
  } else {
    return NextResponse.json({ error: "CSV file is missing for selected run" }, { status: 404 });
  }

  return new NextResponse(csvContent, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
});
