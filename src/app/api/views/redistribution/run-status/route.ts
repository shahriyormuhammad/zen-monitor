import { desc, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { apiRoute } from "@/lib/api-response";
import { requireActiveTenant } from "@/lib/auth/tenant-access";
import { db, withTenantContext } from "@/lib/db";
import { redistributionItems, redistributionRuns } from "@/lib/db/schema";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const GET = apiRoute(async (request: Request) => {
  const { tenantId } = await requireActiveTenant(request);

  const result = await withTenantContext(db, tenantId, async (tx) => {
    const [run] = await tx.select({
      id: redistributionRuns.id,
      status: redistributionRuns.status,
      methodology: redistributionRuns.methodology,
      recommendationCount: redistributionRuns.recommendationCount,
      transferUnits: redistributionRuns.transferUnits,
      estimatedSavingsRub: redistributionRuns.estimatedSavingsRub,
      csvFileName: redistributionRuns.csvFileName,
      createdAt: redistributionRuns.createdAt,
      csvGeneratedAt: redistributionRuns.csvGeneratedAt,
      telegramSentAt: redistributionRuns.telegramSentAt,
      rpaRequestedAt: redistributionRuns.rpaRequestedAt,
      rpaStartedAt: redistributionRuns.rpaStartedAt,
      rpaFinishedAt: redistributionRuns.rpaFinishedAt,
      errorMessage: redistributionRuns.errorMessage,
    })
      .from(redistributionRuns)
      .where(eq(redistributionRuns.tenantId, tenantId))
      .orderBy(desc(redistributionRuns.createdAt))
      .limit(1);

    if (!run) {
      return { run: null, itemStatuses: {} as Record<string, number> };
    }

    const statusRows = await tx.select({
      status: redistributionItems.status,
      count: sql<number>`count(*)::int`,
    })
      .from(redistributionItems)
      .where(eq(redistributionItems.runId, run.id))
      .groupBy(redistributionItems.status);

    const itemStatuses = Object.fromEntries(statusRows.map((row) => [row.status, row.count]));
    return { run, itemStatuses };
  });

  return NextResponse.json(result);
});
