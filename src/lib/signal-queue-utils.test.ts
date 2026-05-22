import { describe, expect, it } from "vitest";

import type {
  SignalAgingSummary,
  SignalAssigneeOption,
  SignalAutomationRun,
  SignalListItem,
  SignalSavedView,
} from "@/lib/operator-signal-timeline";
import {
  buildSignalAssigneeRoleMap,
  buildSignalQueueOwnerSummaries,
  buildSignalQueueRebalanceSuggestion,
  getDefaultSortPresetForQueueView,
  matchesSignalQueueView,
  sortSignals,
} from "@/lib/signal-queue-utils";

function makeAging(overrides: Partial<SignalAgingSummary> = {}): SignalAgingSummary {
  return {
    queueEnteredAt: "2026-04-05T10:00:00.000Z",
    queueAgeHours: 4,
    queueAgeLabel: "4h",
    slaTargetHours: 8,
    slaWarnHours: 6,
    slaState: "healthy",
    slaLabel: "In SLA",
    ...overrides,
  };
}

function makeSignal(id: string, overrides: Partial<SignalListItem> = {}): SignalListItem {
  return {
    id,
    nmId: 101,
    type: "margin_risk",
    severity: "high",
    title: `Signal ${id}`,
    description: `Description ${id}`,
    impactRub: "1000.00",
    createdAt: "2026-04-05T09:00:00.000Z",
    workflowState: "new",
    assigneeUserId: null,
    assigneeEmail: null,
    status: "active",
    workflowUpdatedAt: "2026-04-05T09:30:00.000Z",
    lastEscalation: null,
    ...overrides,
    aging: makeAging(overrides.aging),
  };
}

describe("signal queue utils", () => {
  const assignees: SignalAssigneeOption[] = [
    { userId: "owner-1", email: "owner1@example.com", role: "owner" },
    { userId: "owner-2", email: "owner2@example.com", role: "owner" },
    { userId: "operator-1", email: "operator1@example.com", role: "viewer" },
  ];

  it("classifies working queues correctly", () => {
    const assigneeRoleById = buildSignalAssigneeRoleMap(assignees);
    const needsAction = makeSignal("needs-action", {
      assigneeUserId: "operator-1",
      assigneeEmail: "operator1@example.com",
      workflowState: "in_progress",
    });
    const awaitingOwner = makeSignal("awaiting-owner", {
      assigneeUserId: "owner-1",
      assigneeEmail: "owner1@example.com",
      workflowState: "handoff",
    });
    const blocked = makeSignal("blocked", {
      workflowState: "blocked",
      aging: makeAging({ slaState: "overdue", queueAgeHours: 18 }),
    });

    expect(matchesSignalQueueView(needsAction, "needs_action", assigneeRoleById)).toBe(true);
    expect(matchesSignalQueueView(awaitingOwner, "awaiting_owner", assigneeRoleById)).toBe(true);
    expect(matchesSignalQueueView(awaitingOwner, "needs_action", assigneeRoleById)).toBe(false);
    expect(matchesSignalQueueView(blocked, "blocked", assigneeRoleById)).toBe(true);
    expect(matchesSignalQueueView(blocked, "overdue_only", assigneeRoleById)).toBe(true);
    expect(getDefaultSortPresetForQueueView("overdue_only")).toBe("sla_pressure");
  });

  it("sorts signals by severity and SLA pressure", () => {
    const signals = [
      makeSignal("healthy-medium", {
        severity: "medium",
        aging: makeAging({ slaState: "healthy", queueAgeHours: 2 }),
      }),
      makeSignal("warning-high", {
        severity: "high",
        aging: makeAging({ slaState: "warning", queueAgeHours: 7 }),
      }),
      makeSignal("overdue-critical", {
        severity: "critical",
        aging: makeAging({ slaState: "overdue", queueAgeHours: 16 }),
      }),
    ];

    expect(sortSignals(signals, "severity").map((signal) => signal.id)).toEqual([
      "overdue-critical",
      "warning-high",
      "healthy-medium",
    ]);
    expect(sortSignals(signals, "sla_pressure").map((signal) => signal.id)).toEqual([
      "overdue-critical",
      "warning-high",
      "healthy-medium",
    ]);
  });

  it("builds owner summaries from shared views, runs, and assigned signals", () => {
    const savedViews: SignalSavedView[] = [
      {
        id: "view-owner-1",
        name: "Owner 1 queue",
        queueView: "needs_action",
        assigneeFilter: "all",
        workflowFilter: "all",
        sortPreset: "severity",
        scope: "team",
        ownerUserId: "manager-1",
        ownerEmail: "manager@example.com",
        sharedOwnerUserId: "owner-1",
        sharedOwnerEmail: "owner1@example.com",
        isPinned: true,
        isDefault: false,
        isTeamDefault: true,
        position: 0,
        canEdit: true,
        canDelete: true,
        canReorder: true,
        canTogglePin: true,
        canSetDefault: false,
        canSetTeamDefault: true,
        canManageSharedOwner: true,
        createdAt: "2026-04-05T09:00:00.000Z",
        updatedAt: "2026-04-05T09:00:00.000Z",
      },
    ];
    const runs: SignalAutomationRun[] = [
      {
        id: "run-1",
        automationType: "sla",
        automationSource: "manual",
        triggerType: "saved_view",
        triggerLabel: "Owner 1 queue",
        actorUserId: "manager-1",
        actorEmail: "manager@example.com",
        actorRole: "owner",
        savedViewId: "view-owner-1",
        savedViewName: "Owner 1 queue",
        sharedOwnerUserId: "owner-1",
        sharedOwnerEmail: "owner1@example.com",
        targetSignalCount: 3,
        eligibleCount: 2,
        affectedCount: 2,
        skippedCount: 1,
        appliedPresets: [],
        outcomeCounts: { pending: 2, progressed: 0, resolved: 0, ignored: 0 },
        followUpCount: 0,
        followUpWaveCount: 0,
        escalationAlertCount: 0,
        escalationWaveCount: 0,
        followUpResolutionCounts: { acknowledged: 0, action_taken: 0, no_action: 0 },
        awaitingExplicitOutcomeCount: 0,
        lastFollowUpAt: null,
        lastEscalationAlertAt: null,
        latestFollowUpResolutionAt: null,
        latestFollowUpWave: null,
        status: "completed",
        errorMessage: null,
        createdAt: "2026-04-05T10:00:00.000Z",
        finishedAt: "2026-04-05T10:05:00.000Z",
      },
    ];
    const signals = [
      makeSignal("owner-signal-1", {
        assigneeUserId: "owner-1",
        assigneeEmail: "owner1@example.com",
        workflowState: "handoff",
        aging: makeAging({ slaState: "warning", queueAgeHours: 9 }),
      }),
      makeSignal("owner-signal-2", {
        assigneeUserId: "owner-1",
        assigneeEmail: "owner1@example.com",
        workflowState: "in_progress",
      }),
    ];

    const summaries = buildSignalQueueOwnerSummaries({
      signals,
      savedViews,
      automationRuns: runs,
      assignees,
    });

    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      ownerUserId: "owner-1",
      teamViewsCount: 1,
      pinnedViewsCount: 1,
      recentRunsCount: 1,
      pendingOutcomesCount: 2,
      assignedSignalsCount: 2,
      teamDefaultName: "Owner 1 queue",
    });
  });

  it("suggests a rebalance from the busiest owner queue", () => {
    const assigneeRoleById = buildSignalAssigneeRoleMap(assignees);
    const signals = [
      makeSignal("a-1", { assigneeUserId: "owner-1", assigneeEmail: "owner1@example.com", workflowState: "in_progress" }),
      makeSignal("a-2", { assigneeUserId: "owner-1", assigneeEmail: "owner1@example.com", workflowState: "in_progress" }),
      makeSignal("a-3", { assigneeUserId: "owner-1", assigneeEmail: "owner1@example.com", workflowState: "new" }),
      makeSignal("a-4", { assigneeUserId: "owner-1", assigneeEmail: "owner1@example.com", workflowState: "new" }),
      makeSignal("b-1", { assigneeUserId: "owner-2", assigneeEmail: "owner2@example.com", workflowState: "in_progress" }),
    ];

    const ownerSummaries = buildSignalQueueOwnerSummaries({
      signals,
      savedViews: [],
      automationRuns: [],
      assignees,
    });
    const suggestion = buildSignalQueueRebalanceSuggestion({
      targetOwnerUserId: "owner-2",
      signals,
      ownerSummaries,
      assigneeRoleById,
    });

    expect(suggestion).toMatchObject({
      sourceOwnerUserId: "owner-1",
      targetOwnerUserId: "owner-2",
      count: 1,
    });
    expect(suggestion?.signalIds).toEqual(["a-1"]);
  });
});
