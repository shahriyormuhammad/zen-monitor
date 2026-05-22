import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db, withTenantContext } from "@/lib/db";
import {
  riskSignals,
  signalNotificationReceipts,
  signalOperatorTimeline,
  userTenants,
} from "@/lib/db/schema";
import type {
  SignalNotificationItem,
  SignalNotificationsResponse,
  SignalReviewSource,
  SignalTimelineEventType,
} from "@/lib/operator-signal-timeline";
import {
  resolveSignalNotificationPreferenceKey,
  resolveSignalNotificationPreferences,
  resolveSignalWorkflowState,
} from "@/lib/operator-signal-timeline";
import {
  buildSignalCollaborationSummary,
  buildSignalOverviewHref,
  isSlaAutomationNotification,
  normalizeSignalSeverity,
  toPayloadRecord,
} from "../helpers/signals";

export async function getSignalNotifications(
  tenantId: string,
  currentUserId: string,
): Promise<SignalNotificationsResponse> {
  const [membership, rows] = await withTenantContext(db, tenantId, (tx) => Promise.all([
    tx.select({
      inAppSignalNotificationPrefs: userTenants.inAppSignalNotificationPrefs,
    })
      .from(userTenants)
      .where(and(
        eq(userTenants.tenantId, tenantId),
        eq(userTenants.userId, currentUserId),
      ))
      .limit(1)
      .then((result) => result[0] ?? null),
    tx
      .select({
        eventId: signalOperatorTimeline.id,
        signalId: signalOperatorTimeline.signalId,
        actorUserId: signalOperatorTimeline.actorUserId,
        actorEmail: signalOperatorTimeline.actorEmail,
        eventType: signalOperatorTimeline.eventType,
        openedFrom: signalOperatorTimeline.openedFrom,
        eventBody: signalOperatorTimeline.eventBody,
        eventPayload: signalOperatorTimeline.eventPayload,
        createdAt: signalOperatorTimeline.createdAt,
        signalTitle: riskSignals.title,
        signalSeverity: riskSignals.severity,
        signalNmId: riskSignals.nmId,
        signalStatus: riskSignals.status,
        receiptReadAt: signalNotificationReceipts.readAt,
        receiptAcknowledgedAt: signalNotificationReceipts.acknowledgedAt,
      })
      .from(signalOperatorTimeline)
      .leftJoin(riskSignals, eq(signalOperatorTimeline.signalId, riskSignals.id))
      .leftJoin(signalNotificationReceipts, and(
        eq(signalNotificationReceipts.tenantId, tenantId),
        eq(signalNotificationReceipts.eventId, signalOperatorTimeline.id),
        eq(signalNotificationReceipts.userId, currentUserId),
      ))
      .where(and(
        eq(signalOperatorTimeline.tenantId, tenantId),
        or(
          eq(signalOperatorTimeline.eventType, "note"),
          eq(signalOperatorTimeline.eventType, "assignment"),
          eq(signalOperatorTimeline.eventType, "workflow_state"),
        ),
      ))
      .orderBy(desc(signalOperatorTimeline.createdAt))
      .limit(40),
  ]));

  const inAppPreferences = resolveSignalNotificationPreferences(membership?.inAppSignalNotificationPrefs);

  const notifications: SignalNotificationItem[] = [];
  let unreadCount = 0;

  for (const row of rows) {
    if (!row.signalId || row.signalStatus !== "active") {
      continue;
    }

    if (row.actorUserId && row.actorUserId === currentUserId) {
      continue;
    }

    const eventType = row.eventType as SignalTimelineEventType;
    const eventPayload = toPayloadRecord(row.eventPayload);
    const workflowState = resolveSignalWorkflowState(
      typeof eventPayload.workflowState === "string" ? eventPayload.workflowState : null
    );
    const preferenceKey = resolveSignalNotificationPreferenceKey(eventType, eventPayload);

    if (!preferenceKey) {
      continue;
    }

    if (row.receiptAcknowledgedAt) {
      continue;
    }

    if (!inAppPreferences[preferenceKey]) {
      continue;
    }

    const isRead = Boolean(row.receiptReadAt);
    if (!isRead) {
      unreadCount += 1;
    }

    notifications.push({
      eventId: row.eventId,
      signalId: row.signalId,
      signalTitle: row.signalTitle ?? `Signal ${row.signalId.slice(0, 8)}`,
      signalSeverity: normalizeSignalSeverity(row.signalSeverity),
      signalNmId: row.signalNmId ?? null,
      actorEmail: row.actorEmail,
      eventType,
      eventBody: row.eventBody ?? null,
      openedFrom: (row.openedFrom as SignalReviewSource) ?? "overview",
      createdAt: row.createdAt,
      summary: buildSignalCollaborationSummary({
        actorEmail: row.actorEmail,
        eventType,
        eventPayload,
      }),
      isSlaNotification: isSlaAutomationNotification(eventPayload),
      workflowState,
      assigneeEmail: typeof eventPayload.assigneeEmail === "string" ? eventPayload.assigneeEmail : null,
      href: buildSignalOverviewHref(row.signalId),
      readAt: row.receiptReadAt ?? null,
      acknowledgedAt: row.receiptAcknowledgedAt ?? null,
      isRead,
      isAcknowledged: false,
    });

    if (notifications.length >= 12) {
      break;
    }
  }

  return {
    notifications,
    unreadCount,
  };
}

export async function markSignalNotificationsRead(tenantId: string, userId: string, eventIds: string[]) {
  const uniqueEventIds = Array.from(new Set(eventIds.filter(Boolean)));
  if (uniqueEventIds.length === 0) {
    return { affected: 0 };
  }

  return withTenantContext(db, tenantId, async (tx) => {
    const existingEvents = await tx
      .select({ eventId: signalOperatorTimeline.id })
      .from(signalOperatorTimeline)
      .where(and(
        eq(signalOperatorTimeline.tenantId, tenantId),
        inArray(signalOperatorTimeline.id, uniqueEventIds),
      ));

    const validEventIds = existingEvents.map((row) => row.eventId);
    if (validEventIds.length === 0) {
      return { affected: 0 };
    }

    const now = new Date();

    await tx.insert(signalNotificationReceipts)
      .values(validEventIds.map((eventId) => ({
        tenantId,
        eventId,
        userId,
        readAt: now,
      })))
      .onConflictDoNothing();

    await tx.update(signalNotificationReceipts)
      .set({
        readAt: sql`coalesce(${signalNotificationReceipts.readAt}, ${now})`,
      })
      .where(and(
        eq(signalNotificationReceipts.tenantId, tenantId),
        eq(signalNotificationReceipts.userId, userId),
        inArray(signalNotificationReceipts.eventId, validEventIds),
      ));

    return { affected: validEventIds.length };
  });
}

export async function acknowledgeSignalNotifications(tenantId: string, userId: string, eventIds: string[]) {
  const uniqueEventIds = Array.from(new Set(eventIds.filter(Boolean)));
  if (uniqueEventIds.length === 0) {
    return { affected: 0 };
  }

  return withTenantContext(db, tenantId, async (tx) => {
    const existingEvents = await tx
      .select({ eventId: signalOperatorTimeline.id })
      .from(signalOperatorTimeline)
      .where(and(
        eq(signalOperatorTimeline.tenantId, tenantId),
        inArray(signalOperatorTimeline.id, uniqueEventIds),
      ));

    const validEventIds = existingEvents.map((row) => row.eventId);
    if (validEventIds.length === 0) {
      return { affected: 0 };
    }

    const now = new Date();

    await tx.insert(signalNotificationReceipts)
      .values(validEventIds.map((eventId) => ({
        tenantId,
        eventId,
        userId,
        readAt: now,
        acknowledgedAt: now,
      })))
      .onConflictDoNothing();

    await tx.update(signalNotificationReceipts)
      .set({
        readAt: sql`coalesce(${signalNotificationReceipts.readAt}, ${now})`,
        acknowledgedAt: now,
      })
      .where(and(
        eq(signalNotificationReceipts.tenantId, tenantId),
        eq(signalNotificationReceipts.userId, userId),
        inArray(signalNotificationReceipts.eventId, validEventIds),
      ));

    return { affected: validEventIds.length };
  });
}
