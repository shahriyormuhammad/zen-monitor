import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { apiRoute } from "@/lib/api-response";
import { requireActiveTenant } from "@/lib/auth/tenant-access";
import { db, withTenantContext } from "@/lib/db";
import { redistributionItems, redistributionRuns } from "@/lib/db/schema";
import { withRateLimit } from "@/lib/rate-limit";
import {
  buildManualRedistributionApplicationComment,
  normalizeManualRedistributionWarehouseName,
  parseManualRedistributionRequestPayload,
} from "@/server/redistribution/manual-request";
import { isOfficialRedistributionWarehouse } from "@/server/redistribution/route-scan";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MANUAL_REQUEST_ACTIVE_STATUSES = ["planned", "rpa_queued", "rpa_running", "rpa_failed"] as const;

function toUtcDayStart(value: Date) {
  const day = new Date(value);
  day.setUTCHours(0, 0, 0, 0);
  return day;
}

function toNumericString(value: number, fractionDigits = 2) {
  return value.toFixed(fractionDigits);
}

export const POST = withRateLimit(apiRoute(async (request: Request) => {
  const { tenantId } = await requireActiveTenant(request, ["owner", "admin"]);
  const parsed = parseManualRedistributionRequestPayload(await request.json().catch(() => null));

  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const input = parsed.input;
  if (!isOfficialRedistributionWarehouse(input.fromWarehouse)) {
    return NextResponse.json({
      error: `Склад отправки "${input.fromWarehouse}" не входит в официальный список WB для перераспределения.`,
    }, { status: 400 });
  }
  if (!isOfficialRedistributionWarehouse(input.toWarehouse)) {
    return NextResponse.json({
      error: `Склад назначения "${input.toWarehouse}" не входит в официальный список WB для перераспределения.`,
    }, { status: 400 });
  }

  const now = new Date();
  const fromKey = normalizeManualRedistributionWarehouseName(input.fromWarehouse);
  const toKey = normalizeManualRedistributionWarehouseName(input.toWarehouse);
  const sizeKey = input.sizeName.trim().toLowerCase();

  const result = await withTenantContext(db, tenantId, async (tx) => {
    const duplicateCandidates = await tx.select({
      id: redistributionItems.id,
      runId: redistributionItems.runId,
      status: redistributionItems.status,
      fromWarehouse: redistributionItems.fromWarehouse,
      toWarehouse: redistributionItems.toWarehouse,
      updatedAt: redistributionItems.updatedAt,
    })
      .from(redistributionItems)
      .where(and(
        eq(redistributionItems.tenantId, tenantId),
        eq(redistributionItems.nmId, input.nmId),
        inArray(redistributionItems.status, [...MANUAL_REQUEST_ACTIVE_STATUSES]),
        sql`lower(${redistributionItems.sizeName}) = ${sizeKey}`,
      ))
      .orderBy(desc(redistributionItems.updatedAt))
      .limit(50);
    const duplicate = duplicateCandidates.find((item) =>
      normalizeManualRedistributionWarehouseName(item.fromWarehouse) === fromKey
      && normalizeManualRedistributionWarehouseName(item.toWarehouse) === toKey,
    );

    if (duplicate) {
      return {
        duplicate,
        created: null,
      };
    }

    const notes = [
      "Ручная заявка пользователя: не рекомендация алгоритма.",
      buildManualRedistributionApplicationComment(input),
    ];
    const [run] = await tx.insert(redistributionRuns).values({
      tenantId,
      triggerSource: "manual_custom_ui",
      status: "planned",
      requestedFrom: toUtcDayStart(now),
      requestedTo: now,
      snapshotDate: null,
      snapshotPeriodFrom: null,
      snapshotPeriodTo: null,
      requestedDateWindowDays: 0,
      effectiveDateWindowDays: 0,
      windowAligned: true,
      methodology: "manual_user_request_v1",
      recommendationCount: 1,
      skuCount: 1,
      transferUnits: input.transferUnits,
      estimatedSavingsRub: toNumericString(0),
      currentKrpPct: toNumericString(0),
      simulatedKrpPct: toNumericString(0),
      currentLocalSharePct: toNumericString(0),
      simulatedLocalSharePct: toNumericString(0),
      assumptions: {
        methodology: "manual_user_request_v1",
        source: "manual_custom_ui",
        targetCoverageDays: 0,
        forecastHorizonDays: 0,
        notes,
      },
      notes,
      updatedAt: now,
    }).returning({ id: redistributionRuns.id });

    const [item] = await tx.insert(redistributionItems).values({
      runId: run!.id,
      tenantId,
      status: "planned",
      nmId: input.nmId,
      vendorCode: input.vendorCode,
      brand: input.brand,
      sizeName: input.sizeName,
      chrtId: input.chrtId,
      fromRegionName: input.fromRegionName,
      fromWarehouse: input.fromWarehouse,
      fromOfficeId: input.fromOfficeId,
      toRegionName: input.toRegionName,
      toWarehouse: input.toWarehouse,
      toOfficeId: input.toOfficeId,
      transferUnits: input.transferUnits,
      priorityScore: toNumericString(100_000),
      estimatedSavingsRub: toNumericString(0),
      currentLocalSharePct: toNumericString(0),
      simulatedLocalSharePct: toNumericString(0),
      currentKrpPct: toNumericString(0),
      simulatedKrpPct: toNumericString(0),
      fromCoverageDaysBefore: null,
      toCoverageDaysBefore: null,
      applicationComment: buildManualRedistributionApplicationComment(input),
      executionNote: "manual_custom_ui_created",
      updatedAt: now,
    }).returning({ id: redistributionItems.id });

    return {
      duplicate: null,
      created: {
        runId: run!.id,
        itemId: item!.id,
      },
    };
  });

  if (result.duplicate) {
    return NextResponse.json({
      ok: false,
      error: "Такая заявка уже есть в очереди или ожидает повторной проверки слота.",
      duplicate: {
        itemId: result.duplicate.id,
        runId: result.duplicate.runId,
        status: result.duplicate.status,
        updatedAt: result.duplicate.updatedAt?.toISOString() ?? null,
      },
    }, { status: 409 });
  }

  return NextResponse.json({
    ok: true,
    runId: result.created!.runId,
    itemId: result.created!.itemId,
    message: `Ручная заявка добавлена: ${input.fromWarehouse} → ${input.toWarehouse}, ${input.transferUnits} шт.`,
  });
}), { per: "tenant", limit: 30, window: 60 });
