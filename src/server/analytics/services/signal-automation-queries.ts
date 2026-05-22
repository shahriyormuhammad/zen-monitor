import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, withTenantContext } from "@/lib/db";
import {
  riskSignals,
  signalAutomationControlEvents,
  signalAutomationRuns,
  signalAutomationSuppressions,
  signalOperatorTimeline,
} from "@/lib/db/schema";
import type {
  SignalAutomationControlEvent,
  SignalAutomationControlEventStatus,
  SignalAutomationControlEventType,
  SignalAutomationFollowUpResolutionSummary,
  SignalAutomationFollowUpWave,
  SignalAutomationRun,
  SignalAutomationRunDetail,
  SignalAutomationSource,
  SignalAutomationSuppression,
  SignalAutomationSuppressionTarget,
  SignalAutomationTriggerType,
  SignalEscalationOutcome,
  SignalFollowUpResolution,
  SignalReviewSource,
} from "@/lib/operator-signal-timeline";
import {
  resolveSignalAutomationSuppressionTarget,
  resolveSignalFollowUpResolution,
  resolveSignalWorkflowState,
} from "@/lib/operator-signal-timeline";
import {
  buildSignalAgingSummary,
  createEmptyEscalationOutcomeCounts,
  createEmptyFollowUpResolutionCounts,
  createSignalAutomationFollowUpWave,
  getSignalEscalationOutcomeLabel,
  isActiveSignalAutomationSuppression,
  normalizeSignalSeverity,
  resolveAppliedPresets,
  resolveSignalAutomationControlEventStatus,
  resolveSignalAutomationControlEventType,
  resolveSignalAutomationSource,
  resolveSignalAutomationSuppressionStatus,
  resolveSignalAutomationTriggerType,
  resolveSignalEscalationOutcome,
  toPayloadRecord,
} from "../helpers/signals";

export type SignalDetailViewer = {
  userId: string | null;
  actorEmail: string;
  actorRole: string;
  openedFrom: SignalReviewSource;
};

export async function getSignalAutomationRuns(tenantId: string): Promise<SignalAutomationRun[]> {
    return withTenantContext(db, tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: signalAutomationRuns.id,
        automationType: signalAutomationRuns.automationType,
        automationSource: signalAutomationRuns.automationSource,
        triggerType: signalAutomationRuns.triggerType,
        triggerLabel: signalAutomationRuns.triggerLabel,
        actorUserId: signalAutomationRuns.actorUserId,
        actorEmail: signalAutomationRuns.actorEmail,
        actorRole: signalAutomationRuns.actorRole,
        savedViewId: signalAutomationRuns.savedViewId,
        savedViewName: signalAutomationRuns.savedViewName,
        sharedOwnerUserId: signalAutomationRuns.sharedOwnerUserId,
        sharedOwnerEmail: signalAutomationRuns.sharedOwnerEmail,
        targetSignalCount: signalAutomationRuns.targetSignalCount,
        eligibleCount: signalAutomationRuns.eligibleCount,
        affectedCount: signalAutomationRuns.affectedCount,
        skippedCount: signalAutomationRuns.skippedCount,
        appliedPresets: signalAutomationRuns.appliedPresets,
        status: signalAutomationRuns.status,
        errorMessage: signalAutomationRuns.errorMessage,
        createdAt: signalAutomationRuns.createdAt,
        finishedAt: signalAutomationRuns.finishedAt,
      })
      .from(signalAutomationRuns)
      .where(eq(signalAutomationRuns.tenantId, tenantId))
      .orderBy(desc(signalAutomationRuns.createdAt))
      .limit(8);

    if (rows.length === 0) {
      return [] as SignalAutomationRun[];
    }

    const runIds = rows.map((row) => row.id);
    const automationRunIdSql = sql<string>`(${signalOperatorTimeline.eventPayload} ->> 'automationRunId')`;
    const sourceAutomationRunIdSql = sql<string>`(${signalOperatorTimeline.eventPayload} ->> 'sourceAutomationRunId')`;
    const followUpBatchIdSql = sql<string>`(${signalOperatorTimeline.eventPayload} ->> 'followUpBatchId')`;
    const followUpAutomationSourceSql = sql<string>`(${signalOperatorTimeline.eventPayload} ->> 'automationSource')`;
    const followUpResolutionSql = sql<string>`(${signalOperatorTimeline.eventPayload} ->> 'resolution')`;
    const automationEvents = await tx
      .select({
        signalId: signalOperatorTimeline.signalId,
        automationRunId: automationRunIdSql,
        createdAt: signalOperatorTimeline.createdAt,
        actorEmail: signalOperatorTimeline.actorEmail,
      })
      .from(signalOperatorTimeline)
      .where(and(
        eq(signalOperatorTimeline.tenantId, tenantId),
        eq(signalOperatorTimeline.eventType, "note"),
        inArray(automationRunIdSql, runIds),
        sql<boolean>`${signalOperatorTimeline.eventPayload} ->> 'automation' = 'sla'`,
      ));
    const followUpEvents = await tx
      .select({
        signalId: signalOperatorTimeline.signalId,
        sourceAutomationRunId: sourceAutomationRunIdSql,
        followUpBatchId: followUpBatchIdSql,
        automationSource: followUpAutomationSourceSql,
        createdAt: signalOperatorTimeline.createdAt,
        actorEmail: signalOperatorTimeline.actorEmail,
      })
      .from(signalOperatorTimeline)
      .where(and(
        eq(signalOperatorTimeline.tenantId, tenantId),
        eq(signalOperatorTimeline.eventType, "note"),
        inArray(sourceAutomationRunIdSql, runIds),
        sql<boolean>`${signalOperatorTimeline.eventPayload} ->> 'automation' = 'sla_follow_up'`,
      ));
    const followUpResolutionEvents = await tx
      .select({
        signalId: signalOperatorTimeline.signalId,
        sourceAutomationRunId: sourceAutomationRunIdSql,
        followUpBatchId: followUpBatchIdSql,
        automationSource: followUpAutomationSourceSql,
        resolution: followUpResolutionSql,
        noteBody: signalOperatorTimeline.eventBody,
        createdAt: signalOperatorTimeline.createdAt,
        actorEmail: signalOperatorTimeline.actorEmail,
      })
      .from(signalOperatorTimeline)
      .where(and(
        eq(signalOperatorTimeline.tenantId, tenantId),
        eq(signalOperatorTimeline.eventType, "note"),
        inArray(sourceAutomationRunIdSql, runIds),
        sql<boolean>`${signalOperatorTimeline.eventPayload} ->> 'automation' = 'sla_follow_up_resolution'`,
      ));
    const followUpEscalationEvents = await tx
      .select({
        signalId: signalOperatorTimeline.signalId,
        sourceAutomationRunId: sourceAutomationRunIdSql,
        followUpBatchId: followUpBatchIdSql,
        automationSource: followUpAutomationSourceSql,
        createdAt: signalOperatorTimeline.createdAt,
        actorEmail: signalOperatorTimeline.actorEmail,
      })
      .from(signalOperatorTimeline)
      .where(and(
        eq(signalOperatorTimeline.tenantId, tenantId),
        eq(signalOperatorTimeline.eventType, "note"),
        inArray(sourceAutomationRunIdSql, runIds),
        sql<boolean>`${signalOperatorTimeline.eventPayload} ->> 'automation' = 'sla_follow_up_escalation'`,
      ));

    const signalIds = Array.from(new Set([
      ...automationEvents.map((event) => event.signalId),
      ...followUpEvents.map((event) => event.signalId),
      ...followUpResolutionEvents.map((event) => event.signalId),
      ...followUpEscalationEvents.map((event) => event.signalId),
    ]));
    const signals = signalIds.length === 0
      ? []
      : await tx
        .select({
          id: riskSignals.id,
          status: riskSignals.status,
          resolvedAt: riskSignals.resolvedAt,
          workflowUpdatedAt: riskSignals.workflowUpdatedAt,
          workflowUpdatedByEmail: riskSignals.workflowUpdatedByEmail,
        })
        .from(riskSignals)
        .where(and(
          eq(riskSignals.tenantId, tenantId),
          inArray(riskSignals.id, signalIds),
        ));

    const signalById = new Map(signals.map((signal) => [signal.id, signal]));
    const outcomeCountsByRun = new Map<string, Record<SignalEscalationOutcome, number>>();
    const followUpStatsByRun = new Map<string, { count: number; lastFollowUpAt: Date | string | null }>();
    const followUpEscalationStatsByRun = new Map<string, { count: number; lastEscalationAlertAt: Date | string | null }>();
    const latestFollowUpBatchByRunAndSignal = new Map<string, Map<string, { batchId: string; createdAt: Date | string }>>();
    const followUpWavesByRun = new Map<string, Map<string, SignalAutomationFollowUpWave>>();
    const followUpResolutionCountsByRun = new Map<string, Record<SignalFollowUpResolution, number>>();
    const followUpLatestResolutionAtByRun = new Map<string, Date | string | null>();
    const followUpAwaitingOutcomeCountsByRun = new Map<string, number>();
    const followUpLatestResolutionByRunAndWave = new Map<string, Map<string, Map<string, SignalAutomationFollowUpResolutionSummary>>>();

    for (const event of automationEvents) {
      const signal = signalById.get(event.signalId);
      if (!signal) {
        continue;
      }

      const currentCounts = outcomeCountsByRun.get(event.automationRunId) ?? createEmptyEscalationOutcomeCounts();
      const outcome = resolveSignalEscalationOutcome({
        signalStatus: signal.status,
        resolvedAt: signal.resolvedAt,
        workflowUpdatedAt: signal.workflowUpdatedAt,
        workflowUpdatedByEmail: signal.workflowUpdatedByEmail,
        escalatedAt: event.createdAt,
        actorEmail: event.actorEmail,
      });
      currentCounts[outcome] += 1;
      outcomeCountsByRun.set(event.automationRunId, currentCounts);
    }

    for (const event of followUpEvents) {
      const signal = signalById.get(event.signalId);
      if (!signal) {
        continue;
      }

      const currentStats = followUpStatsByRun.get(event.sourceAutomationRunId) ?? {
        count: 0,
        lastFollowUpAt: null,
      };
      currentStats.count += 1;
      const currentLastFollowUpAt = currentStats.lastFollowUpAt;

      if (!currentLastFollowUpAt || new Date(event.createdAt).getTime() > new Date(currentLastFollowUpAt).getTime()) {
        currentStats.lastFollowUpAt = event.createdAt;
      }

      followUpStatsByRun.set(event.sourceAutomationRunId, currentStats);

      const outcome = resolveSignalEscalationOutcome({
        signalStatus: signal.status,
        resolvedAt: signal.resolvedAt,
        workflowUpdatedAt: signal.workflowUpdatedAt,
        workflowUpdatedByEmail: signal.workflowUpdatedByEmail,
        escalatedAt: event.createdAt,
        actorEmail: event.actorEmail,
      });
      const batchId = event.followUpBatchId || `${event.sourceAutomationRunId}:${new Date(event.createdAt).toISOString()}`;
      const latestBatchBySignal = latestFollowUpBatchByRunAndSignal.get(event.sourceAutomationRunId) ?? new Map<string, { batchId: string; createdAt: Date | string }>();
      const currentLatestBatch = latestBatchBySignal.get(event.signalId);
      if (
        !currentLatestBatch
        || new Date(event.createdAt).getTime() > new Date(currentLatestBatch.createdAt).getTime()
      ) {
        latestBatchBySignal.set(event.signalId, {
          batchId,
          createdAt: event.createdAt,
        });
      }
      latestFollowUpBatchByRunAndSignal.set(event.sourceAutomationRunId, latestBatchBySignal);
      const runWaves = followUpWavesByRun.get(event.sourceAutomationRunId) ?? new Map<string, SignalAutomationFollowUpWave>();
      const existingWave = runWaves.get(batchId) ?? createSignalAutomationFollowUpWave({
        batchId,
        automationSource: event.automationSource,
        actorEmail: event.actorEmail,
        createdAt: event.createdAt,
      });

      existingWave.targetCount += 1;
      existingWave.outcomeCounts[outcome] += 1;
      runWaves.set(batchId, existingWave);
      followUpWavesByRun.set(event.sourceAutomationRunId, runWaves);
    }

    for (const event of followUpResolutionEvents) {
      const resolution = resolveSignalFollowUpResolution(event.resolution);
      if (!resolution) {
        continue;
      }

      const batchId = event.followUpBatchId || `${event.sourceAutomationRunId}:${new Date(event.createdAt).toISOString()}`;
      const runWaves = followUpWavesByRun.get(event.sourceAutomationRunId) ?? new Map<string, SignalAutomationFollowUpWave>();
      const existingWave = runWaves.get(batchId) ?? createSignalAutomationFollowUpWave({
        batchId,
        automationSource: event.automationSource,
        actorEmail: event.actorEmail,
        createdAt: event.createdAt,
      });
      const currentWaveLatestResolutionAt = existingWave.latestResolutionAt;
      if (
        !currentWaveLatestResolutionAt
        || new Date(event.createdAt).getTime() > new Date(currentWaveLatestResolutionAt).getTime()
      ) {
        existingWave.latestResolutionAt = event.createdAt;
      }
      runWaves.set(batchId, existingWave);
      followUpWavesByRun.set(event.sourceAutomationRunId, runWaves);

      const resolutionByWave = followUpLatestResolutionByRunAndWave.get(event.sourceAutomationRunId)
        ?? new Map<string, Map<string, SignalAutomationFollowUpResolutionSummary>>();
      const resolutionBySignal = resolutionByWave.get(batchId) ?? new Map<string, SignalAutomationFollowUpResolutionSummary>();
      const currentResolution = resolutionBySignal.get(event.signalId);
      if (
        !currentResolution
        || new Date(event.createdAt).getTime() > new Date(currentResolution.createdAt).getTime()
      ) {
        resolutionBySignal.set(event.signalId, {
          batchId,
          resolution,
          actorEmail: event.actorEmail,
          createdAt: event.createdAt,
          noteBody: event.noteBody ?? null,
        });
      }
      resolutionByWave.set(batchId, resolutionBySignal);
      followUpLatestResolutionByRunAndWave.set(event.sourceAutomationRunId, resolutionByWave);
    }

    for (const event of followUpEscalationEvents) {
      const currentStats = followUpEscalationStatsByRun.get(event.sourceAutomationRunId) ?? {
        count: 0,
        lastEscalationAlertAt: null,
      };
      currentStats.count += 1;

      if (
        !currentStats.lastEscalationAlertAt
        || new Date(event.createdAt).getTime() > new Date(currentStats.lastEscalationAlertAt).getTime()
      ) {
        currentStats.lastEscalationAlertAt = event.createdAt;
      }

      followUpEscalationStatsByRun.set(event.sourceAutomationRunId, currentStats);

      const batchId = event.followUpBatchId || `${event.sourceAutomationRunId}:${new Date(event.createdAt).toISOString()}`;
      const runWaves = followUpWavesByRun.get(event.sourceAutomationRunId) ?? new Map<string, SignalAutomationFollowUpWave>();
      const existingWave = runWaves.get(batchId) ?? createSignalAutomationFollowUpWave({
        batchId,
        automationSource: event.automationSource,
        actorEmail: event.actorEmail,
        createdAt: event.createdAt,
      });
      existingWave.escalationAlertCount += 1;
      if (
        !existingWave.lastEscalationAlertAt
        || new Date(event.createdAt).getTime() > new Date(existingWave.lastEscalationAlertAt).getTime()
      ) {
        existingWave.lastEscalationAlertAt = event.createdAt;
      }
      runWaves.set(batchId, existingWave);
      followUpWavesByRun.set(event.sourceAutomationRunId, runWaves);
    }

    for (const [runId, resolutionByWave] of followUpLatestResolutionByRunAndWave.entries()) {
      const runCounts = createEmptyFollowUpResolutionCounts();
      const latestResolutionBySignal = new Map<string, SignalAutomationFollowUpResolutionSummary>();

      for (const [batchId, resolutionBySignal] of resolutionByWave.entries()) {
        const wave = followUpWavesByRun.get(runId)?.get(batchId);
        const waveCounts = createEmptyFollowUpResolutionCounts();
        let latestResolutionAt: Date | string | null = null;

        for (const [signalId, resolutionSummary] of resolutionBySignal.entries()) {
          waveCounts[resolutionSummary.resolution] += 1;
          const currentLatestResolution = latestResolutionBySignal.get(signalId);
          if (
            !currentLatestResolution
            || new Date(resolutionSummary.createdAt).getTime() > new Date(currentLatestResolution.createdAt).getTime()
          ) {
            latestResolutionBySignal.set(signalId, resolutionSummary);
          }

          if (
            !latestResolutionAt
            || new Date(resolutionSummary.createdAt).getTime() > new Date(latestResolutionAt).getTime()
          ) {
            latestResolutionAt = resolutionSummary.createdAt;
          }
        }

        if (wave) {
          wave.resolutionCounts = waveCounts;
          wave.latestResolutionAt = latestResolutionAt;
        }
      }

      let latestResolutionAt: Date | string | null = null;
      for (const resolutionSummary of latestResolutionBySignal.values()) {
        runCounts[resolutionSummary.resolution] += 1;
        if (
          !latestResolutionAt
          || new Date(resolutionSummary.createdAt).getTime() > new Date(latestResolutionAt).getTime()
        ) {
          latestResolutionAt = resolutionSummary.createdAt;
        }
      }

      followUpResolutionCountsByRun.set(runId, runCounts);
      followUpLatestResolutionAtByRun.set(runId, latestResolutionAt);
    }

    for (const [runId, latestBatchBySignal] of latestFollowUpBatchByRunAndSignal.entries()) {
      let awaitingExplicitOutcomeCount = 0;
      const resolutionByWave = followUpLatestResolutionByRunAndWave.get(runId);

      for (const [signalId, latestBatch] of latestBatchBySignal.entries()) {
        const waveResolutions = resolutionByWave?.get(latestBatch.batchId);
        if (waveResolutions?.has(signalId)) {
          continue;
        }

        awaitingExplicitOutcomeCount += 1;
        const wave = followUpWavesByRun.get(runId)?.get(latestBatch.batchId);
        if (wave) {
          wave.awaitingExplicitOutcomeCount += 1;
        }
      }

      followUpAwaitingOutcomeCountsByRun.set(runId, awaitingExplicitOutcomeCount);
    }

    return rows.map((row) => {
      const followUpWaves = Array.from(followUpWavesByRun.get(row.id)?.values() ?? [])
        .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
      const followUpEscalationStats = followUpEscalationStatsByRun.get(row.id);

      return {
        id: row.id,
        automationType: "sla",
        automationSource: resolveSignalAutomationSource(row.automationSource),
        triggerType: resolveSignalAutomationTriggerType(row.triggerType),
        triggerLabel: row.triggerLabel ?? null,
        actorUserId: row.actorUserId ?? null,
        actorEmail: row.actorEmail,
        actorRole: row.actorRole,
        savedViewId: row.savedViewId ?? null,
        savedViewName: row.savedViewName ?? null,
        sharedOwnerUserId: row.sharedOwnerUserId ?? null,
        sharedOwnerEmail: row.sharedOwnerEmail ?? null,
        targetSignalCount: row.targetSignalCount,
        eligibleCount: row.eligibleCount,
        affectedCount: row.affectedCount,
        skippedCount: row.skippedCount,
        appliedPresets: resolveAppliedPresets(row.appliedPresets),
        outcomeCounts: outcomeCountsByRun.get(row.id) ?? createEmptyEscalationOutcomeCounts(),
        followUpCount: followUpStatsByRun.get(row.id)?.count ?? 0,
        followUpWaveCount: followUpWaves.length,
        escalationAlertCount: followUpEscalationStats?.count ?? 0,
        escalationWaveCount: followUpWaves.filter((wave) => wave.escalationAlertCount > 0).length,
        followUpResolutionCounts: followUpResolutionCountsByRun.get(row.id) ?? createEmptyFollowUpResolutionCounts(),
        awaitingExplicitOutcomeCount: followUpAwaitingOutcomeCountsByRun.get(row.id) ?? 0,
        lastFollowUpAt: followUpStatsByRun.get(row.id)?.lastFollowUpAt ?? null,
        lastEscalationAlertAt: followUpEscalationStats?.lastEscalationAlertAt ?? null,
        latestFollowUpResolutionAt: followUpLatestResolutionAtByRun.get(row.id) ?? null,
        latestFollowUpWave: followUpWaves[0] ?? null,
        status: row.status === "running" || row.status === "failed" ? row.status : "completed",
        errorMessage: row.errorMessage ?? null,
        createdAt: row.createdAt,
        finishedAt: row.finishedAt ?? null,
      };
    });
    });
  }

export async function getSignalAutomationRunDetails(tenantId: string, runId: string): Promise<SignalAutomationRunDetail | null> {
    return withTenantContext(db, tenantId, async (tx) => {
    const [runRow] = await tx
      .select({
        id: signalAutomationRuns.id,
        automationType: signalAutomationRuns.automationType,
        automationSource: signalAutomationRuns.automationSource,
        triggerType: signalAutomationRuns.triggerType,
        triggerLabel: signalAutomationRuns.triggerLabel,
        actorUserId: signalAutomationRuns.actorUserId,
        actorEmail: signalAutomationRuns.actorEmail,
        actorRole: signalAutomationRuns.actorRole,
        savedViewId: signalAutomationRuns.savedViewId,
        savedViewName: signalAutomationRuns.savedViewName,
        sharedOwnerUserId: signalAutomationRuns.sharedOwnerUserId,
        sharedOwnerEmail: signalAutomationRuns.sharedOwnerEmail,
        targetSignalCount: signalAutomationRuns.targetSignalCount,
        eligibleCount: signalAutomationRuns.eligibleCount,
        affectedCount: signalAutomationRuns.affectedCount,
        skippedCount: signalAutomationRuns.skippedCount,
        appliedPresets: signalAutomationRuns.appliedPresets,
        status: signalAutomationRuns.status,
        errorMessage: signalAutomationRuns.errorMessage,
        createdAt: signalAutomationRuns.createdAt,
        finishedAt: signalAutomationRuns.finishedAt,
      })
      .from(signalAutomationRuns)
      .where(and(
        eq(signalAutomationRuns.tenantId, tenantId),
        eq(signalAutomationRuns.id, runId),
      ))
      .limit(1);

    if (!runRow) {
      return null;
    }

    const automationRunIdSql = sql<string>`(${signalOperatorTimeline.eventPayload} ->> 'automationRunId')`;
    const sourceAutomationRunIdSql = sql<string>`(${signalOperatorTimeline.eventPayload} ->> 'sourceAutomationRunId')`;
    const followUpBatchIdSql = sql<string>`(${signalOperatorTimeline.eventPayload} ->> 'followUpBatchId')`;
    const followUpAutomationSourceSql = sql<string>`(${signalOperatorTimeline.eventPayload} ->> 'automationSource')`;
    const followUpResolutionSql = sql<string>`(${signalOperatorTimeline.eventPayload} ->> 'resolution')`;
    const eventRows = await tx
      .select({
        signalId: signalOperatorTimeline.signalId,
        createdAt: signalOperatorTimeline.createdAt,
        noteBody: signalOperatorTimeline.eventBody,
        actorEmail: signalOperatorTimeline.actorEmail,
        eventPayload: signalOperatorTimeline.eventPayload,
        title: riskSignals.title,
        severity: riskSignals.severity,
        nmId: riskSignals.nmId,
        status: riskSignals.status,
        workflowState: riskSignals.workflowState,
        assigneeUserId: riskSignals.assigneeUserId,
        assigneeEmail: riskSignals.assigneeEmail,
        signalCreatedAt: riskSignals.createdAt,
        workflowUpdatedAt: riskSignals.workflowUpdatedAt,
        workflowUpdatedByEmail: riskSignals.workflowUpdatedByEmail,
        resolvedAt: riskSignals.resolvedAt,
      })
      .from(signalOperatorTimeline)
      .leftJoin(riskSignals, eq(signalOperatorTimeline.signalId, riskSignals.id))
      .where(and(
        eq(signalOperatorTimeline.tenantId, tenantId),
        eq(signalOperatorTimeline.eventType, "note"),
        eq(automationRunIdSql, runId),
        sql<boolean>`${signalOperatorTimeline.eventPayload} ->> 'automation' = 'sla'`,
      ))
      .orderBy(desc(signalOperatorTimeline.createdAt));

    const followUpRows = await tx
      .select({
        signalId: signalOperatorTimeline.signalId,
        actorEmail: signalOperatorTimeline.actorEmail,
        followUpBatchId: followUpBatchIdSql,
        automationSource: followUpAutomationSourceSql,
        createdAt: signalOperatorTimeline.createdAt,
      })
      .from(signalOperatorTimeline)
      .where(and(
        eq(signalOperatorTimeline.tenantId, tenantId),
        eq(signalOperatorTimeline.eventType, "note"),
        eq(sourceAutomationRunIdSql, runId),
        sql<boolean>`${signalOperatorTimeline.eventPayload} ->> 'automation' = 'sla_follow_up'`,
      ))
      .orderBy(desc(signalOperatorTimeline.createdAt));

    const followUpResolutionRows = await tx
      .select({
        signalId: signalOperatorTimeline.signalId,
        actorEmail: signalOperatorTimeline.actorEmail,
        followUpBatchId: followUpBatchIdSql,
        automationSource: followUpAutomationSourceSql,
        resolution: followUpResolutionSql,
        noteBody: signalOperatorTimeline.eventBody,
        createdAt: signalOperatorTimeline.createdAt,
      })
      .from(signalOperatorTimeline)
      .where(and(
        eq(signalOperatorTimeline.tenantId, tenantId),
        eq(signalOperatorTimeline.eventType, "note"),
        eq(sourceAutomationRunIdSql, runId),
        sql<boolean>`${signalOperatorTimeline.eventPayload} ->> 'automation' = 'sla_follow_up_resolution'`,
      ))
      .orderBy(desc(signalOperatorTimeline.createdAt));
    const followUpEscalationRows = await tx
      .select({
        signalId: signalOperatorTimeline.signalId,
        actorEmail: signalOperatorTimeline.actorEmail,
        followUpBatchId: followUpBatchIdSql,
        automationSource: followUpAutomationSourceSql,
        createdAt: signalOperatorTimeline.createdAt,
      })
      .from(signalOperatorTimeline)
      .where(and(
        eq(signalOperatorTimeline.tenantId, tenantId),
        eq(signalOperatorTimeline.eventType, "note"),
        eq(sourceAutomationRunIdSql, runId),
        sql<boolean>`${signalOperatorTimeline.eventPayload} ->> 'automation' = 'sla_follow_up_escalation'`,
      ))
      .orderBy(desc(signalOperatorTimeline.createdAt));

    const outcomeCounts = createEmptyEscalationOutcomeCounts();
    const followUpResolutionCounts = createEmptyFollowUpResolutionCounts();
    let latestFollowUpResolutionAt: Date | string | null = null;
    let lastEscalationAlertAt: Date | string | null = null;
    const followUpStatsBySignal = new Map<string, {
      count: number;
      lastFollowUpAt: Date | string | null;
      latestFollowUpBatchId: string | null;
    }>();
    const followUpEscalationStatsBySignal = new Map<string, {
      count: number;
      lastEscalationAlertAt: Date | string | null;
    }>();
    const latestFollowUpBatchBySignal = new Map<string, { batchId: string; createdAt: Date | string }>();
    const followUpWaves = new Map<string, SignalAutomationFollowUpWave>();
    const latestFollowUpResolutionBySignal = new Map<string, SignalAutomationFollowUpResolutionSummary>();
    const latestFollowUpResolutionByWave = new Map<string, Map<string, SignalAutomationFollowUpResolutionSummary>>();

    const eventSignalRows = eventRows.map((row) => ({
      signalId: row.signalId,
      status: row.status,
      resolvedAt: row.resolvedAt,
      workflowUpdatedAt: row.workflowUpdatedAt,
      workflowUpdatedByEmail: row.workflowUpdatedByEmail,
    }));
    const signalStateById = new Map(eventSignalRows.map((row) => [row.signalId, row]));

    for (const row of followUpRows) {
      const signalState = signalStateById.get(row.signalId);
      const currentStats = followUpStatsBySignal.get(row.signalId) ?? {
        count: 0,
        lastFollowUpAt: null,
        latestFollowUpBatchId: null,
      };
      currentStats.count += 1;
      const currentLastFollowUpAt = currentStats.lastFollowUpAt;
      const batchId = row.followUpBatchId || `${runId}:${new Date(row.createdAt).toISOString()}`;

      if (!currentLastFollowUpAt || new Date(row.createdAt).getTime() > new Date(currentLastFollowUpAt).getTime()) {
        currentStats.lastFollowUpAt = row.createdAt;
        currentStats.latestFollowUpBatchId = batchId;
      }

      followUpStatsBySignal.set(row.signalId, currentStats);
      const currentLatestBatch = latestFollowUpBatchBySignal.get(row.signalId);
      if (
        !currentLatestBatch
        || new Date(row.createdAt).getTime() > new Date(currentLatestBatch.createdAt).getTime()
      ) {
        latestFollowUpBatchBySignal.set(row.signalId, {
          batchId,
          createdAt: row.createdAt,
        });
      }

      if (!signalState) {
        continue;
      }

      const outcome = resolveSignalEscalationOutcome({
        signalStatus: signalState.status,
        resolvedAt: signalState.resolvedAt,
        workflowUpdatedAt: signalState.workflowUpdatedAt,
        workflowUpdatedByEmail: signalState.workflowUpdatedByEmail,
        escalatedAt: row.createdAt,
        actorEmail: row.actorEmail,
      });
      const wave = followUpWaves.get(batchId) ?? createSignalAutomationFollowUpWave({
        batchId,
        automationSource: row.automationSource,
        actorEmail: row.actorEmail,
        createdAt: row.createdAt,
      });
      wave.targetCount += 1;
      wave.outcomeCounts[outcome] += 1;
      followUpWaves.set(batchId, wave);
    }

    for (const row of followUpResolutionRows) {
      const resolution = resolveSignalFollowUpResolution(row.resolution);
      if (!resolution) {
        continue;
      }

      const batchId = row.followUpBatchId || `${runId}:${new Date(row.createdAt).toISOString()}`;
      const wave = followUpWaves.get(batchId) ?? createSignalAutomationFollowUpWave({
        batchId,
        automationSource: row.automationSource,
        actorEmail: row.actorEmail,
        createdAt: row.createdAt,
      });
      const currentWaveLatestResolutionAt = wave.latestResolutionAt;
      if (
        !currentWaveLatestResolutionAt
        || new Date(row.createdAt).getTime() > new Date(currentWaveLatestResolutionAt).getTime()
      ) {
        wave.latestResolutionAt = row.createdAt;
      }
      followUpWaves.set(batchId, wave);

      const waveResolutions = latestFollowUpResolutionByWave.get(batchId) ?? new Map<string, SignalAutomationFollowUpResolutionSummary>();
      const currentWaveResolution = waveResolutions.get(row.signalId);
      if (
        !currentWaveResolution
        || new Date(row.createdAt).getTime() > new Date(currentWaveResolution.createdAt).getTime()
      ) {
        waveResolutions.set(row.signalId, {
          batchId,
          resolution,
          actorEmail: row.actorEmail,
          createdAt: row.createdAt,
          noteBody: row.noteBody ?? null,
        });
      }
      latestFollowUpResolutionByWave.set(batchId, waveResolutions);

      const currentSignalResolution = latestFollowUpResolutionBySignal.get(row.signalId);
      if (
        !currentSignalResolution
        || new Date(row.createdAt).getTime() > new Date(currentSignalResolution.createdAt).getTime()
      ) {
        latestFollowUpResolutionBySignal.set(row.signalId, {
          batchId,
          resolution,
          actorEmail: row.actorEmail,
          createdAt: row.createdAt,
          noteBody: row.noteBody ?? null,
        });
      }
    }

    for (const row of followUpEscalationRows) {
      const currentStats = followUpEscalationStatsBySignal.get(row.signalId) ?? {
        count: 0,
        lastEscalationAlertAt: null,
      };
      currentStats.count += 1;
      if (
        !currentStats.lastEscalationAlertAt
        || new Date(row.createdAt).getTime() > new Date(currentStats.lastEscalationAlertAt).getTime()
      ) {
        currentStats.lastEscalationAlertAt = row.createdAt;
      }
      followUpEscalationStatsBySignal.set(row.signalId, currentStats);

      if (!lastEscalationAlertAt || new Date(row.createdAt).getTime() > new Date(lastEscalationAlertAt).getTime()) {
        lastEscalationAlertAt = row.createdAt;
      }

      const batchId = row.followUpBatchId || `${runId}:${new Date(row.createdAt).toISOString()}`;
      const wave = followUpWaves.get(batchId) ?? createSignalAutomationFollowUpWave({
        batchId,
        automationSource: row.automationSource,
        actorEmail: row.actorEmail,
        createdAt: row.createdAt,
      });
      wave.escalationAlertCount += 1;
      if (
        !wave.lastEscalationAlertAt
        || new Date(row.createdAt).getTime() > new Date(wave.lastEscalationAlertAt).getTime()
      ) {
        wave.lastEscalationAlertAt = row.createdAt;
      }
      followUpWaves.set(batchId, wave);
    }

    for (const [batchId, resolutionBySignal] of latestFollowUpResolutionByWave.entries()) {
      const wave = followUpWaves.get(batchId);
      if (!wave) {
        continue;
      }

      const resolutionCounts = createEmptyFollowUpResolutionCounts();
      let latestResolutionAt: Date | string | null = null;

      for (const resolutionSummary of resolutionBySignal.values()) {
        resolutionCounts[resolutionSummary.resolution] += 1;
        if (
          !latestResolutionAt
          || new Date(resolutionSummary.createdAt).getTime() > new Date(latestResolutionAt).getTime()
        ) {
          latestResolutionAt = resolutionSummary.createdAt;
        }
      }

      wave.resolutionCounts = resolutionCounts;
      wave.latestResolutionAt = latestResolutionAt;
    }

    let awaitingExplicitOutcomeCount = 0;
    for (const [signalId, latestBatch] of latestFollowUpBatchBySignal.entries()) {
      const waveResolutions = latestFollowUpResolutionByWave.get(latestBatch.batchId);
      if (waveResolutions?.has(signalId)) {
        continue;
      }

      awaitingExplicitOutcomeCount += 1;
      const wave = followUpWaves.get(latestBatch.batchId);
      if (wave) {
        wave.awaitingExplicitOutcomeCount += 1;
      }
    }

    for (const resolutionSummary of latestFollowUpResolutionBySignal.values()) {
      followUpResolutionCounts[resolutionSummary.resolution] += 1;
      if (
        !latestFollowUpResolutionAt
        || new Date(resolutionSummary.createdAt).getTime() > new Date(latestFollowUpResolutionAt).getTime()
      ) {
        latestFollowUpResolutionAt = resolutionSummary.createdAt;
      }
    }

    const signals = eventRows.map((row) => {
      const payload = toPayloadRecord(row.eventPayload);
      const followUpStats = followUpStatsBySignal.get(row.signalId);
      const followUpResolution = latestFollowUpResolutionBySignal.get(row.signalId) ?? null;
      const latestFollowUpBatch = latestFollowUpBatchBySignal.get(row.signalId);
      const awaitingFollowUpOutcome = Boolean(
        latestFollowUpBatch
        && (
          !followUpResolution
          || followUpResolution.batchId !== latestFollowUpBatch.batchId
        )
      );
      const outcome = resolveSignalEscalationOutcome({
        signalStatus: row.status,
        resolvedAt: row.resolvedAt,
        workflowUpdatedAt: row.workflowUpdatedAt,
        workflowUpdatedByEmail: row.workflowUpdatedByEmail,
        escalatedAt: row.createdAt,
        actorEmail: row.actorEmail,
      });
      outcomeCounts[outcome] += 1;

      return {
        signalId: row.signalId,
        title: row.title ?? `Signal ${row.signalId.slice(0, 8)}`,
        severity: normalizeSignalSeverity(row.severity),
        nmId: row.nmId ?? null,
        status: row.status ?? "active",
        workflowState: resolveSignalWorkflowState(row.workflowState) ?? "new",
        assigneeUserId: row.assigneeUserId ?? null,
        assigneeEmail: row.assigneeEmail ?? null,
        aging: buildSignalAgingSummary({
          createdAt: row.signalCreatedAt,
          workflowUpdatedAt: row.workflowUpdatedAt,
          workflowState: resolveSignalWorkflowState(row.workflowState) ?? "new",
        }),
        presetId: typeof payload.presetId === "string" ? payload.presetId : null,
        noteBody: row.noteBody ?? null,
        createdAt: row.createdAt,
        outcome,
        outcomeLabel: getSignalEscalationOutcomeLabel(outcome),
        followUpCount: followUpStats?.count ?? 0,
        escalationAlertCount: followUpEscalationStatsBySignal.get(row.signalId)?.count ?? 0,
        latestFollowUpBatchId: followUpStats?.latestFollowUpBatchId ?? null,
        lastFollowUpAt: followUpStats?.lastFollowUpAt ?? null,
        lastEscalationAlertAt: followUpEscalationStatsBySignal.get(row.signalId)?.lastEscalationAlertAt ?? null,
        awaitingFollowUpOutcome,
        followUpResolution,
      };
    });

    return {
      run: {
        id: runRow.id,
        automationType: "sla",
        automationSource: resolveSignalAutomationSource(runRow.automationSource),
        triggerType: resolveSignalAutomationTriggerType(runRow.triggerType),
        triggerLabel: runRow.triggerLabel ?? null,
        actorUserId: runRow.actorUserId ?? null,
        actorEmail: runRow.actorEmail,
        actorRole: runRow.actorRole,
        savedViewId: runRow.savedViewId ?? null,
        savedViewName: runRow.savedViewName ?? null,
        sharedOwnerUserId: runRow.sharedOwnerUserId ?? null,
        sharedOwnerEmail: runRow.sharedOwnerEmail ?? null,
        targetSignalCount: runRow.targetSignalCount,
        eligibleCount: runRow.eligibleCount,
        affectedCount: runRow.affectedCount,
        skippedCount: runRow.skippedCount,
        appliedPresets: resolveAppliedPresets(runRow.appliedPresets),
        outcomeCounts,
        followUpCount: followUpRows.length,
        followUpWaveCount: followUpWaves.size,
        escalationAlertCount: followUpEscalationRows.length,
        escalationWaveCount: Array.from(followUpWaves.values()).filter((wave) => wave.escalationAlertCount > 0).length,
        followUpResolutionCounts,
        awaitingExplicitOutcomeCount,
        lastFollowUpAt: followUpRows[0]?.createdAt ?? null,
        lastEscalationAlertAt,
        latestFollowUpResolutionAt,
        latestFollowUpWave: Array.from(followUpWaves.values()).sort(
          (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
        )[0] ?? null,
        status: runRow.status === "running" || runRow.status === "failed" ? runRow.status : "completed",
        errorMessage: runRow.errorMessage ?? null,
        createdAt: runRow.createdAt,
        finishedAt: runRow.finishedAt ?? null,
      },
      signals,
      followUpWaves: Array.from(followUpWaves.values()).sort(
        (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
      ),
    };
    });
  }

export async function getSignalAutomationSuppressions(tenantId: string): Promise<SignalAutomationSuppression[]> {
    return withTenantContext(db, tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: signalAutomationSuppressions.id,
        targetType: signalAutomationSuppressions.targetType,
        savedViewId: signalAutomationSuppressions.savedViewId,
        savedViewName: signalAutomationSuppressions.savedViewName,
        sharedOwnerUserId: signalAutomationSuppressions.sharedOwnerUserId,
        sharedOwnerEmail: signalAutomationSuppressions.sharedOwnerEmail,
        reason: signalAutomationSuppressions.reason,
        suppressUntil: signalAutomationSuppressions.suppressUntil,
        actorUserId: signalAutomationSuppressions.actorUserId,
        actorEmail: signalAutomationSuppressions.actorEmail,
        actorRole: signalAutomationSuppressions.actorRole,
        clearedAt: signalAutomationSuppressions.clearedAt,
        clearedByUserId: signalAutomationSuppressions.clearedByUserId,
        clearedByEmail: signalAutomationSuppressions.clearedByEmail,
        clearedByRole: signalAutomationSuppressions.clearedByRole,
        clearReason: signalAutomationSuppressions.clearReason,
        createdAt: signalAutomationSuppressions.createdAt,
      })
      .from(signalAutomationSuppressions)
      .where(eq(signalAutomationSuppressions.tenantId, tenantId))
      .orderBy(desc(signalAutomationSuppressions.createdAt));

    const suppressions: SignalAutomationSuppression[] = [];

    for (const row of rows) {
      const targetType = resolveSignalAutomationSuppressionTarget(row.targetType);
      if (!targetType) {
        continue;
      }

      suppressions.push({
        id: row.id,
        targetType,
        savedViewId: row.savedViewId ?? null,
        savedViewName: row.savedViewName ?? null,
        sharedOwnerUserId: row.sharedOwnerUserId ?? null,
        sharedOwnerEmail: row.sharedOwnerEmail ?? null,
        reason: row.reason ?? null,
        suppressUntil: row.suppressUntil ?? null,
        actorUserId: row.actorUserId ?? null,
        actorEmail: row.actorEmail,
        actorRole: row.actorRole,
        status: resolveSignalAutomationSuppressionStatus({
          suppressUntil: row.suppressUntil,
          clearedAt: row.clearedAt,
        }),
        clearedAt: row.clearedAt ?? null,
        clearedByUserId: row.clearedByUserId ?? null,
        clearedByEmail: row.clearedByEmail ?? null,
        clearedByRole: row.clearedByRole ?? null,
        clearReason: row.clearReason ?? null,
        createdAt: row.createdAt,
      });
    }

    return suppressions;
    });
  }

export async function getSignalAutomationControlEvents(tenantId: string): Promise<SignalAutomationControlEvent[]> {
    return withTenantContext(db, tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: signalAutomationControlEvents.id,
        eventType: signalAutomationControlEvents.eventType,
        automationType: signalAutomationControlEvents.automationType,
        automationSource: signalAutomationControlEvents.automationSource,
        triggerType: signalAutomationControlEvents.triggerType,
        triggerLabel: signalAutomationControlEvents.triggerLabel,
        actorUserId: signalAutomationControlEvents.actorUserId,
        actorEmail: signalAutomationControlEvents.actorEmail,
        actorRole: signalAutomationControlEvents.actorRole,
        savedViewId: signalAutomationControlEvents.savedViewId,
        savedViewName: signalAutomationControlEvents.savedViewName,
        sharedOwnerUserId: signalAutomationControlEvents.sharedOwnerUserId,
        sharedOwnerEmail: signalAutomationControlEvents.sharedOwnerEmail,
        linkedEventId: signalAutomationControlEvents.linkedEventId,
        automationRunId: signalAutomationControlEvents.automationRunId,
        targetType: signalAutomationControlEvents.targetType,
        reason: signalAutomationControlEvents.reason,
        suppressUntil: signalAutomationControlEvents.suppressUntil,
        targetSignalCount: signalAutomationControlEvents.targetSignalCount,
        eligibleCount: signalAutomationControlEvents.eligibleCount,
        affectedCount: signalAutomationControlEvents.affectedCount,
        skippedCount: signalAutomationControlEvents.skippedCount,
        awaitingOutcomeCount: signalAutomationControlEvents.awaitingOutcomeCount,
        matchedSuppressionCount: signalAutomationControlEvents.matchedSuppressionCount,
        appliedPresets: signalAutomationControlEvents.appliedPresets,
        status: signalAutomationControlEvents.status,
        errorMessage: signalAutomationControlEvents.errorMessage,
        createdAt: signalAutomationControlEvents.createdAt,
      })
      .from(signalAutomationControlEvents)
      .where(eq(signalAutomationControlEvents.tenantId, tenantId))
      .orderBy(desc(signalAutomationControlEvents.createdAt))
      .limit(12);

    const events: SignalAutomationControlEvent[] = [];

    for (const row of rows) {
      const eventType = resolveSignalAutomationControlEventType(row.eventType);
      if (!eventType) {
        continue;
      }

      events.push({
        id: row.id,
        eventType,
        automationType: "sla",
        automationSource: resolveSignalAutomationSource(row.automationSource),
        triggerType: resolveSignalAutomationTriggerType(row.triggerType),
        triggerLabel: row.triggerLabel ?? null,
        actorUserId: row.actorUserId ?? null,
        actorEmail: row.actorEmail,
        actorRole: row.actorRole,
        savedViewId: row.savedViewId ?? null,
        savedViewName: row.savedViewName ?? null,
        sharedOwnerUserId: row.sharedOwnerUserId ?? null,
        sharedOwnerEmail: row.sharedOwnerEmail ?? null,
        linkedEventId: row.linkedEventId ?? null,
        automationRunId: row.automationRunId ?? null,
        targetType: resolveSignalAutomationSuppressionTarget(row.targetType),
        reason: row.reason ?? null,
        suppressUntil: row.suppressUntil ?? null,
        targetSignalCount: row.targetSignalCount,
        eligibleCount: row.eligibleCount,
        affectedCount: row.affectedCount,
        skippedCount: row.skippedCount,
        awaitingOutcomeCount: row.awaitingOutcomeCount,
        matchedSuppressionCount: row.matchedSuppressionCount,
        appliedPresets: resolveAppliedPresets(row.appliedPresets),
        status: resolveSignalAutomationControlEventStatus(row.status),
        errorMessage: row.errorMessage ?? null,
        createdAt: row.createdAt,
      });
    }

    return events;
    });
  }

export async function getMatchingSignalAutomationSuppressions(
    tenantId: string,
    context?: {
      savedViewId?: string | null;
      sharedOwnerUserId?: string | null;
    },
  ) {
    const suppressions = (await getSignalAutomationSuppressions(tenantId))
      .filter((suppression) => isActiveSignalAutomationSuppression(suppression));

    return suppressions.filter((suppression) => (
      (context?.savedViewId && suppression.targetType === "saved_view" && suppression.savedViewId === context.savedViewId)
      || (
        context?.sharedOwnerUserId
        && suppression.targetType === "queue_owner"
        && suppression.sharedOwnerUserId === context.sharedOwnerUserId
      )
    ));
  }

export async function recordSignalAutomationControlEvent(
    tenantId: string,
    actor: SignalDetailViewer,
    payload: {
      eventType: SignalAutomationControlEventType;
      automationSource?: SignalAutomationSource;
      triggerType?: SignalAutomationTriggerType;
      triggerLabel?: string | null;
      savedViewId?: string | null;
      savedViewName?: string | null;
      sharedOwnerUserId?: string | null;
      sharedOwnerEmail?: string | null;
      linkedEventId?: string | null;
      automationRunId?: string | null;
      targetType?: SignalAutomationSuppressionTarget | null;
      reason?: string | null;
      suppressUntil?: Date | string | null;
      targetSignalCount?: number;
      eligibleCount?: number;
      affectedCount?: number;
      skippedCount?: number;
      awaitingOutcomeCount?: number;
      matchedSuppressionCount?: number;
      appliedPresets?: Array<{ presetId: string; count: number }>;
      status?: SignalAutomationControlEventStatus;
      errorMessage?: string | null;
    },
  ) {
    const [inserted] = await withTenantContext(db, tenantId, (tx) =>
      tx.insert(signalAutomationControlEvents)
      .values({
        tenantId,
        eventType: payload.eventType,
        automationType: "sla",
        automationSource: payload.automationSource ?? "manual",
        triggerType: payload.triggerType ?? "ad_hoc",
        triggerLabel: payload.triggerLabel ?? null,
        actorUserId: actor.userId,
        actorEmail: actor.actorEmail,
        actorRole: actor.actorRole,
        savedViewId: payload.savedViewId ?? null,
        savedViewName: payload.savedViewName ?? null,
        sharedOwnerUserId: payload.sharedOwnerUserId ?? null,
        sharedOwnerEmail: payload.sharedOwnerEmail ?? null,
        linkedEventId: payload.linkedEventId ?? null,
        automationRunId: payload.automationRunId ?? null,
        targetType: payload.targetType ?? null,
        reason: payload.reason ?? null,
        suppressUntil: payload.suppressUntil ? new Date(payload.suppressUntil) : null,
        targetSignalCount: payload.targetSignalCount ?? 0,
        eligibleCount: payload.eligibleCount ?? 0,
        affectedCount: payload.affectedCount ?? 0,
        skippedCount: payload.skippedCount ?? 0,
        awaitingOutcomeCount: payload.awaitingOutcomeCount ?? 0,
        matchedSuppressionCount: payload.matchedSuppressionCount ?? 0,
        appliedPresets: payload.appliedPresets ?? [],
        status: payload.status ?? "completed",
        errorMessage: payload.errorMessage ?? null,
      })
      .returning({
        id: signalAutomationControlEvents.id,
      }),
    );

    return inserted?.id ?? null;
  }
