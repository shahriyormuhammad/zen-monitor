import { and, desc, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { apiRoute } from "@/lib/api-response";
import { requireActiveTenant } from "@/lib/auth/tenant-access";
import { db, withTenantContext } from "@/lib/db";
import { redistributionItems, redistributionRuns } from "@/lib/db/schema";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const GET = apiRoute(async (request: Request) => {
  const { tenantId } = await requireActiveTenant(request);
  const { searchParams } = new URL(request.url);
  const runId = searchParams.get("runId")?.trim() ?? null;

  const result = await withTenantContext(db, tenantId, async (tx) => {
    const [run] = runId
      ? await tx.select({
        id: redistributionRuns.id,
        csvFilePath: redistributionRuns.csvFilePath,
        csvFileName: redistributionRuns.csvFileName,
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
      })
        .from(redistributionRuns)
        .where(eq(redistributionRuns.tenantId, tenantId))
        .orderBy(desc(redistributionRuns.createdAt))
        .limit(1);

    if (!run || !run.csvFilePath) {
      return null;
    }

    const items = await tx.select({
      id: redistributionItems.id,
      status: redistributionItems.status,
      nmId: redistributionItems.nmId,
      vendorCode: redistributionItems.vendorCode,
      sizeName: redistributionItems.sizeName,
      fromWarehouse: redistributionItems.fromWarehouse,
      toWarehouse: redistributionItems.toWarehouse,
      transferUnits: redistributionItems.transferUnits,
      priorityScore: redistributionItems.priorityScore,
      applicationComment: redistributionItems.applicationComment,
    })
      .from(redistributionItems)
      .where(eq(redistributionItems.runId, run.id))
      .orderBy(desc(sql<number>`${redistributionItems.priorityScore}`))
      .limit(200);

    return { run, items };
  });

  if (!result) {
    return NextResponse.json({ error: "CSV file is missing for selected run" }, { status: 404 });
  }

  return NextResponse.json({
    run: result.run,
    items: result.items,
    rpaTargetUrl: process.env.WB_RPA_REDISTRIBUTION_URL?.trim() ?? null,
  });
});
