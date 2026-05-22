import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { apiRoute } from "@/lib/api-response";
import { requireActiveTenant } from "@/lib/auth/tenant-access";
import { db, withTenantContext } from "@/lib/db";
import {
  redistributionItems,
  redistributionRouteAvailabilityEvents,
  redistributionRuns,
  redistributionSlotMonitorRuns,
} from "@/lib/db/schema";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const RECENT_HOURS = 168;
const SLOT_EVENT_SOURCES = [
  "slot_monitor_probe",
  "slot_monitor_auto_submit",
  "http_slot_monitor_probe",
  "http_slot_monitor_auto_submit",
] as const;

function toIsoOrNull(value: Date | string | number | null) {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function toNumberOrNull(value: unknown) {
  const numeric = Number(value ?? NaN);
  return Number.isFinite(numeric) ? numeric : null;
}

function toStringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function toBoolean(value: unknown) {
  return value === true;
}

export const GET = apiRoute(async (request: Request) => {
  const { tenantId } = await requireActiveTenant(request);
  const since = new Date(Date.now() - RECENT_HOURS * 60 * 60 * 1_000);
  const sinceIso = since.toISOString();

  const [statusRows, itemRows, attemptRows, monitorRunRows] = await withTenantContext(db, tenantId, (tx) => Promise.all([
    tx.select({
      status: redistributionItems.status,
      count: sql<number>`count(*)::int`,
    })
      .from(redistributionItems)
      .where(eq(redistributionItems.tenantId, tenantId))
      .groupBy(redistributionItems.status),
    tx.select({
      id: redistributionItems.id,
      status: redistributionItems.status,
      nmId: redistributionItems.nmId,
      vendorCode: redistributionItems.vendorCode,
      brand: redistributionItems.brand,
      sizeName: redistributionItems.sizeName,
      fromWarehouse: redistributionItems.fromWarehouse,
      fromOfficeId: redistributionItems.fromOfficeId,
      toWarehouse: redistributionItems.toWarehouse,
      toOfficeId: redistributionItems.toOfficeId,
      transferUnits: redistributionItems.transferUnits,
      executionNote: redistributionItems.executionNote,
      executedAt: redistributionItems.executedAt,
      createdAt: redistributionItems.createdAt,
      updatedAt: redistributionItems.updatedAt,
      runId: redistributionItems.runId,
      runTriggerSource: redistributionRuns.triggerSource,
      runCreatedAt: redistributionRuns.createdAt,
    })
      .from(redistributionItems)
      .leftJoin(redistributionRuns, eq(redistributionItems.runId, redistributionRuns.id))
      .where(eq(redistributionItems.tenantId, tenantId))
      .orderBy(desc(redistributionItems.updatedAt))
      .limit(80),
    tx.select({
      fromWarehouse: redistributionRouteAvailabilityEvents.fromWarehouse,
      toWarehouse: redistributionRouteAvailabilityEvents.toWarehouse,
      status: redistributionRouteAvailabilityEvents.status,
      reason: redistributionRouteAvailabilityEvents.reason,
      source: redistributionRouteAvailabilityEvents.source,
      metadata: redistributionRouteAvailabilityEvents.metadata,
      observedAt: redistributionRouteAvailabilityEvents.observedAt,
      runId: redistributionRouteAvailabilityEvents.runId,
    })
      .from(redistributionRouteAvailabilityEvents)
      .where(and(
        eq(redistributionRouteAvailabilityEvents.tenantId, tenantId),
        inArray(redistributionRouteAvailabilityEvents.source, [...SLOT_EVENT_SOURCES]),
        sql`${redistributionRouteAvailabilityEvents.observedAt} > ${sinceIso}`,
        sql`${redistributionRouteAvailabilityEvents.toWarehouse} not like '__%_quota__'`,
      ))
      .orderBy(desc(redistributionRouteAvailabilityEvents.observedAt))
      .limit(120),
    tx.select({
      startedAt: redistributionSlotMonitorRuns.startedAt,
      finishedAt: redistributionSlotMonitorRuns.finishedAt,
      triggerSource: redistributionSlotMonitorRuns.triggerSource,
      mode: redistributionSlotMonitorRuns.mode,
      status: redistributionSlotMonitorRuns.status,
      skipped: redistributionSlotMonitorRuns.skipped,
      message: redistributionSlotMonitorRuns.message,
      autoSubmit: redistributionSlotMonitorRuns.autoSubmit,
      maxRoutesPerTenant: redistributionSlotMonitorRuns.maxRoutesPerTenant,
      probedItems: redistributionSlotMonitorRuns.probedItems,
      openedSlots: redistributionSlotMonitorRuns.openedSlots,
    })
      .from(redistributionSlotMonitorRuns)
      .where(and(
        eq(redistributionSlotMonitorRuns.tenantId, tenantId),
        sql`${redistributionSlotMonitorRuns.startedAt} > ${sinceIso}`,
      ))
      .orderBy(desc(redistributionSlotMonitorRuns.startedAt))
      .limit(60),
  ]));

  const itemStatusCounts = Object.fromEntries(statusRows.map((row) => [row.status, row.count]));
  const attempts = attemptRows.map((row) => {
    const metadata = row.metadata ?? {};
    return {
      observedAt: toIsoOrNull(row.observedAt),
      fromWarehouse: row.fromWarehouse,
      toWarehouse: row.toWarehouse,
      status: row.status,
      reason: row.reason,
      source: row.source,
      runId: row.runId,
      nmId: toNumberOrNull(metadata.nmId),
      itemId: toStringOrNull(metadata.itemId),
      sizeName: toStringOrNull(metadata.sizeName),
      fromOfficeId: toNumberOrNull(metadata.fromOfficeId),
      toOfficeId: toNumberOrNull(metadata.toOfficeId),
      srcQuota: toNumberOrNull(metadata.srcQuota),
      dstQuota: toNumberOrNull(metadata.dstQuota),
      canSubmitUnits: toNumberOrNull(metadata.canSubmitUnits),
      submitted: toBoolean(metadata.submitted),
      submittedUnits: toNumberOrNull(metadata.submittedUnits) ?? 0,
    };
  });

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    tenantId,
    windowHours: RECENT_HOURS,
    itemStatusCounts,
    items: itemRows.map((row) => ({
      id: row.id,
      status: row.status,
      nmId: row.nmId,
      vendorCode: row.vendorCode,
      brand: row.brand,
      sizeName: row.sizeName,
      fromWarehouse: row.fromWarehouse,
      fromOfficeId: row.fromOfficeId,
      toWarehouse: row.toWarehouse,
      toOfficeId: row.toOfficeId,
      transferUnits: row.transferUnits,
      executionNote: row.executionNote,
      executedAt: toIsoOrNull(row.executedAt),
      createdAt: toIsoOrNull(row.createdAt),
      updatedAt: toIsoOrNull(row.updatedAt),
      runId: row.runId,
      runTriggerSource: row.runTriggerSource,
      runCreatedAt: toIsoOrNull(row.runCreatedAt),
    })),
    attempts,
    monitorRuns: monitorRunRows.map((row) => ({
      startedAt: toIsoOrNull(row.startedAt),
      finishedAt: toIsoOrNull(row.finishedAt),
      triggerSource: row.triggerSource,
      mode: row.mode,
      status: row.status,
      skipped: row.skipped,
      message: row.message,
      autoSubmit: row.autoSubmit,
      maxRoutesPerTenant: row.maxRoutesPerTenant,
      probedItems: row.probedItems,
      openedSlots: row.openedSlots,
    })),
  });
});
