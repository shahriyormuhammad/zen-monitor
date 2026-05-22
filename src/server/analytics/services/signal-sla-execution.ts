import { db, withTenantContext } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sql, and, desc, eq, gte, inArray } from "drizzle-orm";
import {
  riskSignals,
  signalAutomationRuns,
  signalAutomationSuppressions,
  signalOperatorTimeline,
  signalSavedViews,
} from "@/lib/db/schema";
import type {
  SignalAutomationDryRunPreview,
  SignalAutomationSuppressionTarget,
  SignalAutomationTriggerType,
  SignalFeedResponse,
  SignalFollowUpResolution,
  SignalWorkflowState,
} from "@/lib/operator-signal-timeline";
import {
  resolveSignalFollowUpResolution,
  resolveSignalWorkflowState,
} from "@/lib/operator-signal-timeline";
import { buildSignalAssigneeRoleMap, getSignalEscalationPreset } from "@/lib/signal-queue-utils";
import {
  buildSignalAgingSummary,
  buildSignalFollowUpResolutionNoteBody,
  buildSignalSlaFollowUpEscalationNoteBody,
  buildSignalSlaFollowUpNoteBody,
  isActiveSignalAutomationSuppression,
  normalizeSignalSeverity,
  resolveSignalAutomationSource,
  resolveSignalAutomationSuppressionStatus,
  toPayloadRecord,
} from "../helpers/signals";
import * as SignalSavedViewsService from "./signal-saved-views";
import * as SignalAutomationQueriesService from "./signal-automation-queries";
import * as SignalCoreService from "./signal-core";
import * as SignalFeedService from "./signal-feed";

import type { SignalDetailViewer } from "./signal-automation-queries";

export async function previewSignalSlaAutomation(
  tenantId: string,
  signalIds: string[],
  actor: SignalDetailViewer,
  options?: {
    savedViewId?: string | null;
    sharedOwnerUserId?: string | null;
    queuePresetId?: string | null;
    triggerLabel?: string | null;
  },
): Promise<SignalAutomationDryRunPreview> {
  const targetSignalCount = Array.from(new Set(signalIds.filter(Boolean))).length;
  const matchedSuppressions = await SignalAutomationQueriesService.getMatchingSignalAutomationSuppressions(tenantId, {
    savedViewId: options?.savedViewId ?? null,
    sharedOwnerUserId: options?.sharedOwnerUserId ?? null,
  });
  const preview = await runSignalSlaAutomation(tenantId, signalIds, actor, {
    savedViewId: options?.savedViewId ?? null,
    sharedOwnerUserId: options?.sharedOwnerUserId ?? null,
    queuePresetId: options?.queuePresetId ?? null,
    triggerLabel: options?.triggerLabel ?? null,
    dryRun: true,
  });

  const savedViewContext = options?.savedViewId
    ? await db
      .select({
        id: signalSavedViews.id,
        name: signalSavedViews.name,
        sharedOwnerUserId: signalSavedViews.sharedOwnerUserId,
        sharedOwnerEmail: signalSavedViews.sharedOwnerEmail,
      })
      .from(signalSavedViews)
      .where(and(
        eq(signalSavedViews.tenantId, tenantId),
        eq(signalSavedViews.id, options.savedViewId),
      ))
      .limit(1)
      .then((rows) => rows[0] ?? null)
    : null;
  const directSharedOwner = !savedViewContext && options?.sharedOwnerUserId
    ? await SignalSavedViewsService.resolveSignalSavedViewSharedOwner(tenantId, options.sharedOwnerUserId)
    : null;
  const triggerType: SignalAutomationTriggerType = savedViewContext
    ? "saved_view"
    : options?.queuePresetId
      ? "queue_preset"
      : "ad_hoc";
  let controlEventId: string | null = null;

  try {
    controlEventId = await SignalAutomationQueriesService.recordSignalAutomationControlEvent(tenantId, actor, {
      eventType: "preview",
      automationSource: "manual",
      triggerType,
      triggerLabel: savedViewContext?.name ?? options?.triggerLabel ?? null,
      savedViewId: savedViewContext?.id ?? null,
      savedViewName: savedViewContext?.name ?? null,
      sharedOwnerUserId: savedViewContext?.sharedOwnerUserId ?? directSharedOwner?.userId ?? null,
      sharedOwnerEmail: savedViewContext?.sharedOwnerEmail ?? directSharedOwner?.email ?? null,
      targetSignalCount,
      eligibleCount: preview.eligible,
      affectedCount: preview.affected,
      skippedCount: preview.skippedAlreadyEscalated,
      awaitingOutcomeCount: 0,
      matchedSuppressionCount: matchedSuppressions.length,
      appliedPresets: preview.appliedPresets,
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to record signal automation preview control event");
  }

  return {
    controlEventId,
    targetSignalCount,
    eligibleCount: preview.eligible,
    affectedCount: preview.affected,
    skippedCount: preview.skippedAlreadyEscalated,
    awaitingOutcomeCount: 0,
    appliedPresets: preview.appliedPresets,
    matchedSuppressions,
    triggerLabel: options?.triggerLabel ?? null,
  };
}

export async function setSignalAutomationSuppression(
  tenantId: string,
  actor: SignalDetailViewer,
  payload: {
    targetType: SignalAutomationSuppressionTarget;
    savedViewId?: string | null;
    sharedOwnerUserId?: string | null;
    reason?: string | null;
    suppressUntil?: Date | string | null;
  },
) {
  const reason = payload.reason?.trim() ?? "";
  if (reason.length < 3) {
    throw new Error("Укажите reason для suppression");
  }

  const suppressUntil = payload.suppressUntil ? new Date(payload.suppressUntil) : null;
  if (suppressUntil && Number.isNaN(suppressUntil.getTime())) {
    throw new Error("Некорректный suppress-until");
  }
  if (suppressUntil && suppressUntil.getTime() <= Date.now()) {
    throw new Error("suppress-until должен быть в будущем");
  }

  if (payload.targetType === "saved_view") {
    if (!payload.savedViewId) {
      throw new Error("saved view не указан");
    }
    const savedViewIdInput = payload.savedViewId;

    await withTenantContext(db, tenantId, async (tx) => {
      const [savedView] = await tx
        .select({
          id: signalSavedViews.id,
          name: signalSavedViews.name,
          sharedOwnerUserId: signalSavedViews.sharedOwnerUserId,
          sharedOwnerEmail: signalSavedViews.sharedOwnerEmail,
        })
        .from(signalSavedViews)
        .where(and(
          eq(signalSavedViews.tenantId, tenantId),
          eq(signalSavedViews.id, savedViewIdInput),
        ))
        .limit(1);

      if (!savedView) {
        throw new Error("Saved view не найден");
      }

      const existing = await tx
        .select({
          id: signalAutomationSuppressions.id,
          suppressUntil: signalAutomationSuppressions.suppressUntil,
          clearedAt: signalAutomationSuppressions.clearedAt,
        })
        .from(signalAutomationSuppressions)
        .where(and(
          eq(signalAutomationSuppressions.tenantId, tenantId),
          eq(signalAutomationSuppressions.targetType, "saved_view"),
          eq(signalAutomationSuppressions.savedViewId, savedView.id),
        ))
        .orderBy(desc(signalAutomationSuppressions.createdAt));

      const activeExisting = existing.find((suppression) => resolveSignalAutomationSuppressionStatus({
        suppressUntil: suppression.suppressUntil,
        clearedAt: suppression.clearedAt,
      }) === "active");

      if (!activeExisting) {
        await tx.insert(signalAutomationSuppressions).values({
          tenantId,
          targetType: "saved_view",
          savedViewId: savedView.id,
          savedViewName: savedView.name,
          sharedOwnerUserId: savedView.sharedOwnerUserId ?? null,
          sharedOwnerEmail: savedView.sharedOwnerEmail ?? null,
          reason,
          suppressUntil,
          actorUserId: actor.userId,
          actorEmail: actor.actorEmail,
          actorRole: actor.actorRole,
        });
      }
    });

    return SignalAutomationQueriesService.getSignalAutomationSuppressions(tenantId);
  }

  if (!payload.sharedOwnerUserId) {
    throw new Error("queue owner не указан");
  }

  const owner = await SignalSavedViewsService.resolveSignalSavedViewSharedOwner(tenantId, payload.sharedOwnerUserId);
  if (!owner) {
    throw new Error("Queue owner не найден");
  }

  await withTenantContext(db, tenantId, async (tx) => {
    const existing = await tx
      .select({
        id: signalAutomationSuppressions.id,
        suppressUntil: signalAutomationSuppressions.suppressUntil,
        clearedAt: signalAutomationSuppressions.clearedAt,
      })
      .from(signalAutomationSuppressions)
      .where(and(
        eq(signalAutomationSuppressions.tenantId, tenantId),
        eq(signalAutomationSuppressions.targetType, "queue_owner"),
        eq(signalAutomationSuppressions.sharedOwnerUserId, owner.userId),
      ))
      .orderBy(desc(signalAutomationSuppressions.createdAt));

    const activeExisting = existing.find((suppression) => resolveSignalAutomationSuppressionStatus({
      suppressUntil: suppression.suppressUntil,
      clearedAt: suppression.clearedAt,
    }) === "active");

    if (!activeExisting) {
      await tx.insert(signalAutomationSuppressions).values({
        tenantId,
        targetType: "queue_owner",
        sharedOwnerUserId: owner.userId,
        sharedOwnerEmail: owner.email ?? null,
        reason,
        suppressUntil,
        actorUserId: actor.userId,
        actorEmail: actor.actorEmail,
        actorRole: actor.actorRole,
      });
    }
  });

  return SignalAutomationQueriesService.getSignalAutomationSuppressions(tenantId);
}

export async function clearSignalAutomationSuppression(
  tenantId: string,
  actor: SignalDetailViewer,
  payload: {
    targetType: SignalAutomationSuppressionTarget;
    savedViewId?: string | null;
    sharedOwnerUserId?: string | null;
    clearReason?: string | null;
  },
) {
  const clearReason = payload.clearReason?.trim() || null;

  if (payload.targetType === "saved_view") {
    if (!payload.savedViewId) {
      throw new Error("saved view не указан");
    }
    const savedViewId = payload.savedViewId;

    await withTenantContext(db, tenantId, (tx) =>
      tx.update(signalAutomationSuppressions)
        .set({
          clearedAt: new Date(),
          clearedByUserId: actor.userId,
          clearedByEmail: actor.actorEmail,
          clearedByRole: actor.actorRole,
          clearReason,
        })
        .where(and(
          eq(signalAutomationSuppressions.tenantId, tenantId),
          eq(signalAutomationSuppressions.targetType, "saved_view"),
          eq(signalAutomationSuppressions.savedViewId, savedViewId),
          sql<boolean>`${signalAutomationSuppressions.clearedAt} is null`,
          sql<boolean>`(${signalAutomationSuppressions.suppressUntil} is null or ${signalAutomationSuppressions.suppressUntil} > now())`,
        )),
    );

    return SignalAutomationQueriesService.getSignalAutomationSuppressions(tenantId);
  }

  if (!payload.sharedOwnerUserId) {
    throw new Error("queue owner не указан");
  }
  const sharedOwnerUserId = payload.sharedOwnerUserId;

  await withTenantContext(db, tenantId, (tx) =>
    tx.update(signalAutomationSuppressions)
      .set({
        clearedAt: new Date(),
        clearedByUserId: actor.userId,
        clearedByEmail: actor.actorEmail,
        clearedByRole: actor.actorRole,
        clearReason,
      })
      .where(and(
        eq(signalAutomationSuppressions.tenantId, tenantId),
        eq(signalAutomationSuppressions.targetType, "queue_owner"),
        eq(signalAutomationSuppressions.sharedOwnerUserId, sharedOwnerUserId),
        sql<boolean>`${signalAutomationSuppressions.clearedAt} is null`,
        sql<boolean>`(${signalAutomationSuppressions.suppressUntil} is null or ${signalAutomationSuppressions.suppressUntil} > now())`,
      )),
  );

  return SignalAutomationQueriesService.getSignalAutomationSuppressions(tenantId);
}

export async function captureSignalFollowUpResolution(
  tenantId: string,
  signalId: string,
  payload: {
    sourceAutomationRunId: string;
    followUpBatchId: string;
    resolution: SignalFollowUpResolution;
  },
  actor: SignalDetailViewer,
) {
  const [run] = await db
    .select({
      id: signalAutomationRuns.id,
      triggerLabel: signalAutomationRuns.triggerLabel,
      savedViewName: signalAutomationRuns.savedViewName,
      automationSource: signalAutomationRuns.automationSource,
    })
    .from(signalAutomationRuns)
    .where(and(
      eq(signalAutomationRuns.tenantId, tenantId),
      eq(signalAutomationRuns.id, payload.sourceAutomationRunId),
    ))
    .limit(1);

  if (!run) {
    throw new Error("Automation run не найден");
  }

  const sourceAutomationRunIdSql = sql<string>`(${signalOperatorTimeline.eventPayload} ->> 'sourceAutomationRunId')`;
  const followUpBatchIdSql = sql<string>`(${signalOperatorTimeline.eventPayload} ->> 'followUpBatchId')`;
  const followUpResolutionSql = sql<string>`(${signalOperatorTimeline.eventPayload} ->> 'resolution')`;
  const [followUpEvent] = await db
    .select({
      eventPayload: signalOperatorTimeline.eventPayload,
    })
    .from(signalOperatorTimeline)
    .where(and(
      eq(signalOperatorTimeline.tenantId, tenantId),
      eq(signalOperatorTimeline.signalId, signalId),
      eq(signalOperatorTimeline.eventType, "note"),
      eq(sourceAutomationRunIdSql, payload.sourceAutomationRunId),
      eq(followUpBatchIdSql, payload.followUpBatchId),
      sql<boolean>`${signalOperatorTimeline.eventPayload} ->> 'automation' = 'sla_follow_up'`,
    ))
    .orderBy(desc(signalOperatorTimeline.createdAt))
    .limit(1);

  if (!followUpEvent) {
    throw new Error("Follow-up wave не найдена");
  }

  const [latestResolution] = await db
    .select({
      resolution: followUpResolutionSql,
    })
    .from(signalOperatorTimeline)
    .where(and(
      eq(signalOperatorTimeline.tenantId, tenantId),
      eq(signalOperatorTimeline.signalId, signalId),
      eq(signalOperatorTimeline.eventType, "note"),
      eq(sourceAutomationRunIdSql, payload.sourceAutomationRunId),
      eq(followUpBatchIdSql, payload.followUpBatchId),
      sql<boolean>`${signalOperatorTimeline.eventPayload} ->> 'automation' = 'sla_follow_up_resolution'`,
    ))
    .orderBy(desc(signalOperatorTimeline.createdAt))
    .limit(1);

  const currentResolution = resolveSignalFollowUpResolution(latestResolution?.resolution ?? null);
  if (currentResolution === payload.resolution) {
    return;
  }

  const followUpPayload = toPayloadRecord(followUpEvent.eventPayload);
  await SignalCoreService.addSignalNote(
    tenantId,
    signalId,
    buildSignalFollowUpResolutionNoteBody({
      run: {
        triggerLabel: run.triggerLabel ?? null,
        savedViewName: run.savedViewName ?? null,
        automationSource: resolveSignalAutomationSource(run.automationSource),
      },
      resolution: payload.resolution,
    }),
    actor,
    {
      eventPayload: {
        automation: "sla_follow_up_resolution",
        resolution: payload.resolution,
        followUpBatchId: payload.followUpBatchId,
        sourceAutomationRunId: payload.sourceAutomationRunId,
        automationSource: typeof followUpPayload.automationSource === "string" ? followUpPayload.automationSource : "manual",
        sourceAutomationSource: typeof followUpPayload.sourceAutomationSource === "string" ? followUpPayload.sourceAutomationSource : null,
        sourceTriggerType: typeof followUpPayload.sourceTriggerType === "string" ? followUpPayload.sourceTriggerType : null,
        sourceSavedViewId: typeof followUpPayload.sourceSavedViewId === "string" ? followUpPayload.sourceSavedViewId : null,
        sourceSharedOwnerUserId: typeof followUpPayload.sourceSharedOwnerUserId === "string" ? followUpPayload.sourceSharedOwnerUserId : null,
        sourceSharedOwnerEmail: typeof followUpPayload.sourceSharedOwnerEmail === "string" ? followUpPayload.sourceSharedOwnerEmail : null,
      },
    },
  );
}

export async function runSignalSlaAutomation(
  tenantId: string,
  signalIds: string[],
  actor: SignalDetailViewer,
  options?: {
    automationSource?: "manual" | "scheduled";
    dryRun?: boolean;
    dedupeWindowHours?: number;
    savedViewId?: string | null;
    sharedOwnerUserId?: string | null;
    queuePresetId?: string | null;
    triggerLabel?: string | null;
    previewControlEventId?: string | null;
  },
) {
  const uniqueSignalIds = Array.from(new Set(signalIds.filter(Boolean)));
  const automationSource = options?.automationSource ?? "manual";
  const dryRun = options?.dryRun ?? false;
  const dedupeWindowHours = options?.dedupeWindowHours ?? (automationSource === "scheduled" ? 12 : 0);

  if (uniqueSignalIds.length === 0) {
    return {
      targetSignalCount: 0,
      affected: 0,
      eligible: 0,
      skippedAlreadyEscalated: 0,
      awaitingExplicitOutcomeCount: 0,
      appliedPresets: [] as Array<{ presetId: string; count: number }>,
    };
  }

  const [signals, members] = await Promise.all([
    withTenantContext(db, tenantId, (tx) =>
      tx.select({
        id: riskSignals.id,
        nmId: riskSignals.nmId,
        type: riskSignals.type,
        severity: riskSignals.severity,
        title: riskSignals.title,
        description: riskSignals.description,
        impactRub: riskSignals.impactRub,
        createdAt: riskSignals.createdAt,
        workflowState: riskSignals.workflowState,
        assigneeUserId: riskSignals.assigneeUserId,
        assigneeEmail: riskSignals.assigneeEmail,
        status: riskSignals.status,
        workflowUpdatedAt: riskSignals.workflowUpdatedAt,
      })
        .from(riskSignals)
        .where(and(
          eq(riskSignals.tenantId, tenantId),
          eq(riskSignals.status, "active"),
          inArray(riskSignals.id, uniqueSignalIds),
        )),
    ),
    SignalCoreService.getSignalWorkflowMembers(tenantId),
  ]);

  const assigneeRoleById = buildSignalAssigneeRoleMap(members);
  const recentAutomationKeys = new Set<string>();
  if (automationSource === "scheduled" && dedupeWindowHours > 0) {
    const recentEvents = await withTenantContext(db, tenantId, (tx) =>
      tx
        .select({
          signalId: signalOperatorTimeline.signalId,
          eventPayload: signalOperatorTimeline.eventPayload,
        })
        .from(signalOperatorTimeline)
        .where(and(
          eq(signalOperatorTimeline.tenantId, tenantId),
          eq(signalOperatorTimeline.eventType, "note"),
          inArray(signalOperatorTimeline.signalId, uniqueSignalIds),
          gte(signalOperatorTimeline.createdAt, new Date(Date.now() - dedupeWindowHours * 60 * 60 * 1000)),
        )),
    );

    for (const event of recentEvents) {
      const payload = toPayloadRecord(event.eventPayload);
      if (payload.automation !== "sla") {
        continue;
      }

      const presetId = typeof payload.presetId === "string" ? payload.presetId : null;
      const source = typeof payload.automationSource === "string" ? payload.automationSource : null;
      if (!presetId || source !== "scheduled") {
        continue;
      }

      recentAutomationKeys.add(`${event.signalId}:${presetId}`);
    }
  }

  const groups = new Map<string, { workflowState: SignalWorkflowState; noteBody: string; signalIds: string[] }>();
  let eligible = 0;
  let skippedAlreadyEscalated = 0;

  for (const signal of signals) {
    const signalItem = {
      id: signal.id,
      nmId: signal.nmId,
      type: signal.type,
      severity: normalizeSignalSeverity(signal.severity),
      title: signal.title,
      description: signal.description,
      impactRub: signal.impactRub,
      createdAt: signal.createdAt,
      workflowState: resolveSignalWorkflowState(signal.workflowState) ?? "new",
      assigneeUserId: signal.assigneeUserId ?? null,
      assigneeEmail: signal.assigneeEmail ?? null,
      status: signal.status,
      workflowUpdatedAt: signal.workflowUpdatedAt ?? null,
      aging: buildSignalAgingSummary({
        createdAt: signal.createdAt,
        workflowUpdatedAt: signal.workflowUpdatedAt,
        workflowState: resolveSignalWorkflowState(signal.workflowState) ?? "new",
      }),
      lastEscalation: null,
    } satisfies SignalFeedResponse["signals"][number];

    if (automationSource === "scheduled" && signalItem.aging.slaState !== "overdue") {
      continue;
    }

    const preset = getSignalEscalationPreset(signalItem, assigneeRoleById);
    if (!preset) {
      continue;
    }

    if (recentAutomationKeys.has(`${signal.id}:${preset.id}`)) {
      skippedAlreadyEscalated += 1;
      continue;
    }

    eligible += 1;
    const existingGroup = groups.get(preset.id);
    if (existingGroup) {
      existingGroup.signalIds.push(signal.id);
      continue;
    }

    groups.set(preset.id, {
      workflowState: preset.workflowState,
      noteBody: preset.noteBody,
      signalIds: [signal.id],
    });
  }

  let affected = 0;
  const awaitingExplicitOutcomeCount = 0;
  const appliedPresets: Array<{ presetId: string; count: number }> = [];
  const savedViewContext = options?.savedViewId
    ? await db
      .select({
        id: signalSavedViews.id,
        name: signalSavedViews.name,
        sharedOwnerUserId: signalSavedViews.sharedOwnerUserId,
        sharedOwnerEmail: signalSavedViews.sharedOwnerEmail,
      })
      .from(signalSavedViews)
      .where(and(
        eq(signalSavedViews.tenantId, tenantId),
        eq(signalSavedViews.id, options.savedViewId),
      ))
      .limit(1)
      .then((rows) => rows[0] ?? null)
    : null;
  const directSharedOwner = !savedViewContext && options?.sharedOwnerUserId
    ? await SignalSavedViewsService.resolveSignalSavedViewSharedOwner(tenantId, options.sharedOwnerUserId)
    : null;

  const shouldRecordRun = !dryRun && (automationSource === "manual" || eligible > 0 || skippedAlreadyEscalated > 0);
  const triggerType: SignalAutomationTriggerType =
    automationSource === "scheduled"
      ? "scheduled"
      : savedViewContext
        ? "saved_view"
        : options?.queuePresetId
          ? "queue_preset"
          : "ad_hoc";
  const triggerLabel =
    automationSource === "scheduled"
      ? "Scheduled SLA sweep"
      : savedViewContext?.name ?? options?.triggerLabel ?? null;
  let automationRunId: string | null = null;
  let matchedSuppressionCount = 0;

  if (!dryRun && automationSource === "manual") {
    matchedSuppressionCount = (
      await SignalAutomationQueriesService.getMatchingSignalAutomationSuppressions(tenantId, {
        savedViewId: savedViewContext?.id ?? null,
        sharedOwnerUserId: savedViewContext?.sharedOwnerUserId ?? directSharedOwner?.userId ?? null,
      })
    ).length;
  }

  if (shouldRecordRun) {
    const [insertedRun] = await withTenantContext(db, tenantId, (tx) =>
      tx.insert(signalAutomationRuns)
        .values({
          tenantId,
          automationType: "sla",
          automationSource,
          triggerType,
          triggerLabel,
          actorUserId: actor.userId,
          actorEmail: actor.actorEmail,
          actorRole: actor.actorRole,
          savedViewId: savedViewContext?.id ?? null,
          savedViewName: savedViewContext?.name ?? null,
          sharedOwnerUserId: savedViewContext?.sharedOwnerUserId ?? directSharedOwner?.userId ?? null,
          sharedOwnerEmail: savedViewContext?.sharedOwnerEmail ?? directSharedOwner?.email ?? null,
          targetSignalCount: uniqueSignalIds.length,
          eligibleCount: eligible,
          affectedCount: 0,
          skippedCount: skippedAlreadyEscalated,
          appliedPresets,
          status: "running",
        })
        .returning({
          id: signalAutomationRuns.id,
        }),
    );

    automationRunId = insertedRun?.id ?? null;
  }

  try {
    for (const [presetId, group] of groups.entries()) {
      appliedPresets.push({
        presetId,
        count: group.signalIds.length,
      });

      if (dryRun) {
        continue;
      }

      await SignalFeedService.bulkApplySignalHandoffPreset(tenantId, group.signalIds, {
        workflowState: group.workflowState,
        noteBody: group.noteBody,
        noteEventPayload: {
          automation: "sla",
          automationRunId,
          automationSource,
          presetId,
          queuePresetId: options?.queuePresetId ?? null,
          triggerType,
        },
      }, actor);

      affected += group.signalIds.length;
    }

    if (automationRunId) {
      await withTenantContext(db, tenantId, (tx) =>
        tx.update(signalAutomationRuns)
          .set({
            eligibleCount: eligible,
            affectedCount: affected,
            skippedCount: skippedAlreadyEscalated,
            appliedPresets,
            status: "completed",
            finishedAt: new Date(),
            errorMessage: null,
          })
          .where(eq(signalAutomationRuns.id, automationRunId)),
      );
    }

    if (!dryRun && automationSource === "manual") {
      try {
        await SignalAutomationQueriesService.recordSignalAutomationControlEvent(tenantId, actor, {
          eventType: "execute",
          automationSource,
          triggerType,
          triggerLabel,
          savedViewId: savedViewContext?.id ?? null,
          savedViewName: savedViewContext?.name ?? null,
          sharedOwnerUserId: savedViewContext?.sharedOwnerUserId ?? directSharedOwner?.userId ?? null,
          sharedOwnerEmail: savedViewContext?.sharedOwnerEmail ?? directSharedOwner?.email ?? null,
          linkedEventId: options?.previewControlEventId ?? null,
          automationRunId,
          targetSignalCount: uniqueSignalIds.length,
          eligibleCount: eligible,
          affectedCount: affected,
          skippedCount: skippedAlreadyEscalated,
          awaitingOutcomeCount: awaitingExplicitOutcomeCount,
          matchedSuppressionCount,
          appliedPresets,
          status: "completed",
        });
      } catch (controlError) {
        logger.error({ err: controlError }, "Failed to record signal automation execute control event");
      }
    }
  } catch (error) {
    if (automationRunId) {
      await withTenantContext(db, tenantId, (tx) =>
        tx.update(signalAutomationRuns)
          .set({
            eligibleCount: eligible,
            affectedCount: affected,
            skippedCount: skippedAlreadyEscalated,
            appliedPresets,
            status: "failed",
            finishedAt: new Date(),
            errorMessage: error instanceof Error ? error.message : String(error),
          })
          .where(eq(signalAutomationRuns.id, automationRunId)),
      );
    }

    if (!dryRun && automationSource === "manual") {
      try {
        await SignalAutomationQueriesService.recordSignalAutomationControlEvent(tenantId, actor, {
          eventType: "execute",
          automationSource,
          triggerType,
          triggerLabel,
          savedViewId: savedViewContext?.id ?? null,
          savedViewName: savedViewContext?.name ?? null,
          sharedOwnerUserId: savedViewContext?.sharedOwnerUserId ?? directSharedOwner?.userId ?? null,
          sharedOwnerEmail: savedViewContext?.sharedOwnerEmail ?? directSharedOwner?.email ?? null,
          linkedEventId: options?.previewControlEventId ?? null,
          automationRunId,
          targetSignalCount: uniqueSignalIds.length,
          eligibleCount: eligible,
          affectedCount: affected,
          skippedCount: skippedAlreadyEscalated,
          awaitingOutcomeCount: awaitingExplicitOutcomeCount,
          matchedSuppressionCount,
          appliedPresets,
          status: "failed",
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      } catch (controlError) {
        logger.error({ err: controlError }, "Failed to record failed signal automation execute control event");
      }
    }

    throw error;
  }

  return {
    targetSignalCount: uniqueSignalIds.length,
    affected,
    eligible,
    skippedAlreadyEscalated,
    awaitingExplicitOutcomeCount,
    appliedPresets,
  };
}

export async function runSignalSlaPendingFollowUp(
  tenantId: string,
  runId: string,
  actor: SignalDetailViewer,
  options?: {
    automationSource?: "manual" | "scheduled";
    dryRun?: boolean;
    dedupeWindowHours?: number;
    acknowledgedGraceWindowHours?: number;
    actionTakenGraceWindowHours?: number;
    escalationThresholdHours?: number;
    escalationDedupeWindowHours?: number;
  },
) {
  const detail = await SignalAutomationQueriesService.getSignalAutomationRunDetails(tenantId, runId);
  if (!detail) {
    throw new Error("Automation run не найден");
  }

  const automationSource = options?.automationSource ?? "manual";
  const dryRun = options?.dryRun ?? false;
  const dedupeWindowHours = options?.dedupeWindowHours ?? (automationSource === "scheduled" ? 8 : 2);
  const acknowledgedGraceWindowHours = options?.acknowledgedGraceWindowHours ?? (automationSource === "scheduled" ? 12 : 4);
  const actionTakenGraceWindowHours = options?.actionTakenGraceWindowHours ?? (automationSource === "scheduled" ? 24 : 8);
  const escalationThresholdHours = options?.escalationThresholdHours ?? (automationSource === "scheduled" ? 8 : 3);
  const escalationDedupeWindowHours = options?.escalationDedupeWindowHours ?? (automationSource === "scheduled" ? 16 : 6);
  const now = Date.now();
  const followUpBatchId = crypto.randomUUID();
  const followUpTriggeredAt = new Date().toISOString();
  const escalationBatchId = crypto.randomUUID();
  const escalationTriggeredAt = new Date().toISOString();
  const pendingSignals = detail.signals.filter((signal) => signal.outcome === "pending");
  let eligible = 0;
  let affected = 0;
  let skippedRecentlyReminded = 0;
  let awaitingExplicitOutcome = 0;
  let skippedAcknowledged = 0;
  let skippedOutcomeCaptured = 0;
  let escalationEligible = 0;
  let escalationAlertsTriggered = 0;
  let skippedEscalationRecently = 0;
  let skippedEscalationTooFresh = 0;

  for (const signal of pendingSignals) {
    if (signal.awaitingFollowUpOutcome) {
      awaitingExplicitOutcome += 1;

      const lastFollowUpAtMs = signal.lastFollowUpAt ? new Date(signal.lastFollowUpAt).getTime() : Number.NaN;
      if (Number.isNaN(lastFollowUpAtMs)) {
        continue;
      }

      const awaitingOutcomeHours = Math.max(1, Math.round((now - lastFollowUpAtMs) / (60 * 60 * 1000)));
      if (awaitingOutcomeHours < escalationThresholdHours) {
        skippedEscalationTooFresh += 1;
        continue;
      }

      const lastEscalationAlertAtMs = signal.lastEscalationAlertAt
        ? new Date(signal.lastEscalationAlertAt).getTime()
        : Number.NaN;
      const escalatedRecently = !Number.isNaN(lastEscalationAlertAtMs)
        && now - lastEscalationAlertAtMs < escalationDedupeWindowHours * 60 * 60 * 1000;

      if (escalatedRecently) {
        skippedEscalationRecently += 1;
        continue;
      }

      escalationEligible += 1;
      if (dryRun) {
        continue;
      }

      const alertNumber = signal.escalationAlertCount + 1;
      await SignalCoreService.addSignalNote(
        tenantId,
        signal.signalId,
        buildSignalSlaFollowUpEscalationNoteBody(detail.run, alertNumber, awaitingOutcomeHours),
        actor,
        {
          eventPayload: {
            automation: "sla_follow_up_escalation",
            automationSource,
            sourceAutomationRunId: detail.run.id,
            sourceAutomationSource: detail.run.automationSource,
            sourceTriggerType: detail.run.triggerType,
            sourceSavedViewId: detail.run.savedViewId,
            sourceSharedOwnerUserId: detail.run.sharedOwnerUserId,
            sourceSharedOwnerEmail: detail.run.sharedOwnerEmail,
            followUpBatchId: signal.latestFollowUpBatchId,
            escalationBatchId,
            escalationTriggeredAt,
            alertNumber,
            previousEscalationAlertCount: signal.escalationAlertCount,
            awaitingOutcomeHours,
          },
        },
      );
      escalationAlertsTriggered += 1;
      continue;
    }

    if (signal.followUpResolution) {
      const resolutionAgeMs = now - new Date(signal.followUpResolution.createdAt).getTime();

      if (signal.followUpResolution.resolution === "no_action") {
        skippedOutcomeCaptured += 1;
        continue;
      }

      if (
        signal.followUpResolution.resolution === "action_taken"
        && resolutionAgeMs < actionTakenGraceWindowHours * 60 * 60 * 1000
      ) {
        skippedOutcomeCaptured += 1;
        continue;
      }

      if (
        signal.followUpResolution.resolution === "acknowledged"
        && resolutionAgeMs < acknowledgedGraceWindowHours * 60 * 60 * 1000
      ) {
        skippedAcknowledged += 1;
        continue;
      }
    }

    const lastFollowUpAtMs = signal.lastFollowUpAt ? new Date(signal.lastFollowUpAt).getTime() : Number.NaN;
    const wasRemindedRecently = !Number.isNaN(lastFollowUpAtMs)
      && now - lastFollowUpAtMs < dedupeWindowHours * 60 * 60 * 1000;

    if (wasRemindedRecently) {
      skippedRecentlyReminded += 1;
      continue;
    }

    eligible += 1;
    if (dryRun) {
      continue;
    }

    const reminderNumber = signal.followUpCount + 1;
    await SignalCoreService.addSignalNote(
      tenantId,
      signal.signalId,
      buildSignalSlaFollowUpNoteBody(detail.run, reminderNumber),
      actor,
      {
        eventPayload: {
          automation: "sla_follow_up",
          automationSource,
          sourceAutomationRunId: detail.run.id,
          sourceAutomationSource: detail.run.automationSource,
          sourceTriggerType: detail.run.triggerType,
          sourceSavedViewId: detail.run.savedViewId,
          sourceSharedOwnerUserId: detail.run.sharedOwnerUserId,
          sourceSharedOwnerEmail: detail.run.sharedOwnerEmail,
          followUpBatchId,
          followUpTriggeredAt,
          reminderNumber,
          previousFollowUpCount: signal.followUpCount,
        },
      },
    );
    affected += 1;
  }

  return {
    pending: pendingSignals.length,
    eligible,
    affected,
    skippedRecentlyReminded,
    awaitingExplicitOutcome,
    skippedAcknowledged,
    skippedOutcomeCaptured,
    escalationEligible,
    escalationAlertsTriggered,
    skippedEscalationRecently,
    skippedEscalationTooFresh,
  };
}

export async function runSignalSlaPendingFollowUpSweep(
  tenantId: string,
  actor: SignalDetailViewer,
  options?: {
    dryRun?: boolean;
    lookbackHours?: number;
    dedupeWindowHours?: number;
  },
) {
  const lookbackHours = options?.lookbackHours ?? 72;
  const runRows = await withTenantContext(db, tenantId, (tx) =>
    tx
      .select({
        id: signalAutomationRuns.id,
        savedViewId: signalAutomationRuns.savedViewId,
        sharedOwnerUserId: signalAutomationRuns.sharedOwnerUserId,
      })
      .from(signalAutomationRuns)
      .where(and(
        eq(signalAutomationRuns.tenantId, tenantId),
        eq(signalAutomationRuns.status, "completed"),
        gte(signalAutomationRuns.createdAt, new Date(Date.now() - lookbackHours * 60 * 60 * 1000)),
      ))
      .orderBy(desc(signalAutomationRuns.createdAt))
      .limit(12),
  );
  const suppressions = (await SignalAutomationQueriesService.getSignalAutomationSuppressions(tenantId))
    .filter((suppression) => isActiveSignalAutomationSuppression(suppression));

  let runsWithPending = 0;
  let runsFollowedUp = 0;
  let signalsPending = 0;
  let affected = 0;
  let skippedRecentlyReminded = 0;
  let skippedSuppressed = 0;
  let awaitingExplicitOutcome = 0;
  let skippedAcknowledged = 0;
  let skippedOutcomeCaptured = 0;
  let escalationEligible = 0;
  let escalationAlertsTriggered = 0;
  let skippedEscalationRecently = 0;
  let skippedEscalationTooFresh = 0;

  for (const run of runRows) {
    const isSuppressed = suppressions.some((suppression) => (
      (run.savedViewId && suppression.targetType === "saved_view" && suppression.savedViewId === run.savedViewId)
      || (
        run.sharedOwnerUserId
        && suppression.targetType === "queue_owner"
        && suppression.sharedOwnerUserId === run.sharedOwnerUserId
      )
    ));

    if (isSuppressed) {
      skippedSuppressed += 1;
      continue;
    }

    const followUp = await runSignalSlaPendingFollowUp(tenantId, run.id, actor, {
      automationSource: "scheduled",
      dryRun: options?.dryRun ?? false,
      dedupeWindowHours: options?.dedupeWindowHours,
    });

    if (followUp.pending > 0) {
      runsWithPending += 1;
    }

    if (followUp.affected > 0) {
      runsFollowedUp += 1;
    }

    signalsPending += followUp.pending;
    affected += followUp.affected;
    skippedRecentlyReminded += followUp.skippedRecentlyReminded;
    awaitingExplicitOutcome += followUp.awaitingExplicitOutcome;
    skippedAcknowledged += followUp.skippedAcknowledged;
    skippedOutcomeCaptured += followUp.skippedOutcomeCaptured;
    escalationEligible += followUp.escalationEligible;
    escalationAlertsTriggered += followUp.escalationAlertsTriggered;
    skippedEscalationRecently += followUp.skippedEscalationRecently;
    skippedEscalationTooFresh += followUp.skippedEscalationTooFresh;
  }

  return {
    runsScanned: runRows.length,
    runsWithPending,
    runsFollowedUp,
    signalsPending,
    affected,
    skippedRecentlyReminded,
    skippedSuppressed,
    awaitingExplicitOutcome,
    skippedAcknowledged,
    skippedOutcomeCaptured,
    escalationEligible,
    escalationAlertsTriggered,
    skippedEscalationRecently,
    skippedEscalationTooFresh,
  };
}
