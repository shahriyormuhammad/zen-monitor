import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

import { apiRoute } from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { inngest } from "@/inngest/client";
import { requireActiveTenant } from "@/lib/auth/tenant-access";
import { parseRequestBody } from "@/lib/api-parse";
import { db, withTenantContext } from "@/lib/db";
import { redistributionItems, redistributionRuns } from "@/lib/db/schema";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ACTIONS = ["queue_rpa", "reject"] as const;

const bodySchema = z.object({
  runId: z.string().uuid("runId must be a valid UUID"),
  action: z.enum(ACTIONS, { error: "action must be queue_rpa or reject" }),
});

export const POST = apiRoute(async (request: Request) => {
  const { tenantId } = await requireActiveTenant(request, ["owner", "admin"]);
  const { runId, action } = await parseRequestBody(request, bodySchema);

  const run = await withTenantContext(db, tenantId, async (tx) => {
    const [row] = await tx.select({
      id: redistributionRuns.id,
      status: redistributionRuns.status,
      csvFilePath: redistributionRuns.csvFilePath,
      csvFileName: redistributionRuns.csvFileName,
    })
      .from(redistributionRuns)
      .where(and(
        eq(redistributionRuns.id, runId),
        eq(redistributionRuns.tenantId, tenantId),
      ))
      .limit(1);
    return row ?? null;
  });

  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  if (action === "reject") {
    await withTenantContext(db, tenantId, async (tx) => {
      await tx.update(redistributionRuns)
        .set({
          status: "manual_rejected",
          updatedAt: new Date(),
        })
        .where(eq(redistributionRuns.id, runId));

      await tx.update(redistributionItems)
        .set({
          status: "manual_rejected",
          updatedAt: new Date(),
        })
        .where(and(
          eq(redistributionItems.runId, runId),
          inArray(redistributionItems.status, ["planned", "rpa_queued", "rpa_failed"]),
        ));
    });

    return NextResponse.json({
      ok: true,
      status: "manual_rejected",
      message: "Прогон отклонен вручную.",
    });
  }

  if (!run.csvFilePath) {
    return NextResponse.json({ error: "CSV file is missing for this run" }, { status: 409 });
  }

  if (run.status === "rpa_running") {
    return NextResponse.json({ error: "RPA is already running for this run" }, { status: 409 });
  }
  if (run.status === "rpa_completed") {
    return NextResponse.json({ error: "RPA is already completed for this run" }, { status: 409 });
  }

  try {
    await inngest.send({
      name: "wb/redistribution.rpa.requested",
      data: {
        tenantId,
        runId,
        csvFilePath: run.csvFilePath,
        csvFileName: run.csvFileName,
      },
    });
  } catch (queueError) {
    logger.error({ err: queueError }, 'Redistribution run action: Inngest queue error');
    const localRuntimeHint = process.env.INNGEST_BASE_URL
      ? "Очередь Inngest недоступна. Повторите запуск чуть позже."
      : "Очередь Inngest не запущена (локальный режим). Запустите `npm run dev:runtime` и повторите.";
    return NextResponse.json({ error: localRuntimeHint }, { status: 503 });
  }

  await withTenantContext(db, tenantId, async (tx) => {
    await tx.update(redistributionRuns)
      .set({
        status: "rpa_queued",
        rpaRequestedAt: new Date(),
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(redistributionRuns.id, runId));

    await tx.update(redistributionItems)
      .set({
        status: "rpa_queued",
        updatedAt: new Date(),
      })
      .where(and(
        eq(redistributionItems.runId, runId),
        inArray(redistributionItems.status, ["planned", "rpa_failed", "manual_rejected"]),
      ));
  });

  return NextResponse.json({
    ok: true,
    status: "rpa_queued",
    message: "Прогон одобрен: RPA-процесс поставлен в очередь.",
  });
});
