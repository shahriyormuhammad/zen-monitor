import type {
  SignalAutomationRun,
  SignalAssigneeOption,
  SignalDashboardSlaSummary,
  SignalListItem,
  SignalQueueView,
  SignalQueueOwnerSummary,
  SignalSavedView,
  SignalSortPreset,
  SignalWorkflowState,
} from '@/lib/operator-signal-timeline';
import { SIGNAL_ESCALATION_PRESETS, type SignalSlaQueuePreset, isOwnerLikeTenantRole } from '@/lib/signal-workflow-config';

export function buildSignalAssigneeRoleMap(assignees: SignalAssigneeOption[]) {
  return Object.fromEntries(assignees.map((member) => [member.userId, member.role]));
}

export function formatSignalAssigneeLabel(email: string | null | undefined, userId: string | null | undefined) {
  if (email) {
    return email;
  }

  if (userId) {
    return `user:${userId.slice(0, 8)}`;
  }

  return 'Без ответственного';
}

export function isAwaitingOwnerSignal(
  signal: SignalListItem,
  assigneeRoleById: Record<string, string>,
) {
  return signal.workflowState === 'handoff'
    && Boolean(signal.assigneeUserId)
    && isOwnerLikeTenantRole(signal.assigneeUserId ? assigneeRoleById[signal.assigneeUserId] : null);
}

export function matchesSignalQueueView(
  signal: SignalListItem,
  queueView: SignalQueueView,
  assigneeRoleById: Record<string, string>,
) {
  if (queueView === 'all') {
    return true;
  }

  if (queueView === 'blocked') {
    return signal.workflowState === 'blocked';
  }

  if (queueView === 'overdue_only') {
    return signal.aging.slaState === 'overdue';
  }

  const awaitingOwner = isAwaitingOwnerSignal(signal, assigneeRoleById);

  if (queueView === 'awaiting_owner') {
    return awaitingOwner;
  }

  if (signal.workflowState === 'blocked') {
    return false;
  }

  if (signal.workflowState === 'handoff') {
    return !awaitingOwner;
  }

  return true;
}

export function matchesSignalWorkflowFilter(
  signal: SignalListItem,
  workflowFilter: 'all' | SignalWorkflowState,
) {
  return workflowFilter === 'all' ? true : signal.workflowState === workflowFilter;
}

export function matchesSignalSlaQueuePreset(
  signal: SignalListItem,
  preset: SignalSlaQueuePreset,
  assigneeRoleById: Record<string, string>,
) {
  return matchesSignalQueueView(signal, preset.queueView, assigneeRoleById)
    && matchesSignalWorkflowFilter(signal, preset.workflowFilter);
}

export function sortSignals(
  signals: SignalListItem[],
  sortPreset: SignalSortPreset,
) {
  const severityOrder = {
    critical: 0,
    high: 1,
    medium: 2,
  } as const;
  const slaOrder = {
    overdue: 0,
    warning: 1,
    healthy: 2,
  } as const;

  return [...signals].sort((left, right) => {
    if (sortPreset === 'newest') {
      const leftTime = new Date(left.workflowUpdatedAt ?? left.createdAt ?? 0).getTime();
      const rightTime = new Date(right.workflowUpdatedAt ?? right.createdAt ?? 0).getTime();
      return rightTime - leftTime;
    }

    if (sortPreset === 'sla_pressure') {
      const bySla = slaOrder[left.aging.slaState] - slaOrder[right.aging.slaState];
      if (bySla !== 0) {
        return bySla;
      }

      const byAge = right.aging.queueAgeHours - left.aging.queueAgeHours;
      if (byAge !== 0) {
        return byAge;
      }
    }

    const bySeverity = severityOrder[left.severity] - severityOrder[right.severity];
    if (bySeverity !== 0) {
      return bySeverity;
    }

    const bySla = slaOrder[left.aging.slaState] - slaOrder[right.aging.slaState];
    if (bySla !== 0) {
      return bySla;
    }

    return right.aging.queueAgeHours - left.aging.queueAgeHours;
  });
}

export function buildSignalSlaDashboardSummary(
  signals: SignalListItem[],
  assigneeRoleById: Record<string, string>,
): SignalDashboardSlaSummary {
  return signals.reduce<SignalDashboardSlaSummary>((summary, signal) => {
    if (signal.workflowState === 'blocked' && signal.aging.slaState === 'overdue') {
      summary.overdueBlockedCount += 1;
    }

    if (signal.workflowState === 'handoff' && signal.aging.slaState === 'overdue') {
      summary.overdueHandoffCount += 1;
    }

    if (
      matchesSignalQueueView(signal, 'needs_action', assigneeRoleById)
      && signal.aging.slaState !== 'healthy'
    ) {
      summary.agingNeedsActionCount += 1;
    }

    return summary;
  }, {
    overdueBlockedCount: 0,
    overdueHandoffCount: 0,
    agingNeedsActionCount: 0,
  });
}

export function createEmptySignalQueueCounts(): Record<SignalQueueView, number> {
  return {
    all: 0,
    needs_action: 0,
    blocked: 0,
    awaiting_owner: 0,
    overdue_only: 0,
  };
}

export function getDefaultSortPresetForQueueView(queueView: SignalQueueView): SignalSortPreset {
  return queueView === 'overdue_only' ? 'sla_pressure' : 'severity';
}

export function getSignalQueueOwnerLoad(summary: SignalQueueOwnerSummary) {
  return summary.queueCounts.needs_action + summary.queueCounts.awaiting_owner + summary.queueCounts.blocked;
}

export function buildSignalQueueRebalanceSuggestion({
  targetOwnerUserId,
  signals,
  ownerSummaries,
  assigneeRoleById,
}: {
  targetOwnerUserId: string | null;
  signals: SignalListItem[];
  ownerSummaries: SignalQueueOwnerSummary[];
  assigneeRoleById: Record<string, string>;
}) {
  if (!targetOwnerUserId) {
    return null;
  }

  const targetSummary = ownerSummaries.find((summary) => summary.ownerUserId === targetOwnerUserId);
  if (!targetSummary) {
    return null;
  }

  const targetLoad = getSignalQueueOwnerLoad(targetSummary);
  const sourceSummary = [...ownerSummaries]
    .filter((summary) => summary.ownerUserId && summary.ownerUserId !== targetOwnerUserId)
    .sort((left, right) => {
      const byLoad = getSignalQueueOwnerLoad(right) - getSignalQueueOwnerLoad(left);
      if (byLoad !== 0) {
        return byLoad;
      }

      return right.overdueAssignedCount - left.overdueAssignedCount;
    })
    .find((summary) => getSignalQueueOwnerLoad(summary) > targetLoad + 1);

  if (!sourceSummary?.ownerUserId) {
    return null;
  }

  const rebalanceCount = Math.min(
    5,
    Math.max(1, Math.floor((getSignalQueueOwnerLoad(sourceSummary) - targetLoad) / 2)),
  );
  const candidateSignals = signals
    .filter((signal) =>
      signal.assigneeUserId === sourceSummary.ownerUserId
        && matchesSignalQueueView(signal, 'needs_action', assigneeRoleById)
        && signal.workflowState !== 'blocked'
    )
    .slice(0, rebalanceCount);

  if (candidateSignals.length === 0) {
    return null;
  }

  return {
    sourceOwnerUserId: sourceSummary.ownerUserId,
    sourceOwnerEmail: sourceSummary.ownerEmail,
    sourceOwnerLabel: sourceSummary.label,
    targetOwnerUserId,
    targetOwnerLabel: targetSummary.label,
    signalIds: candidateSignals.map((signal) => signal.id),
    count: candidateSignals.length,
  };
}

export function buildSignalQueueOwnerSummaries({
  signals,
  savedViews,
  automationRuns,
  assignees,
}: {
  signals: SignalListItem[];
  savedViews: SignalSavedView[];
  automationRuns: SignalAutomationRun[];
  assignees: SignalAssigneeOption[];
}): SignalQueueOwnerSummary[] {
  const assigneeRoleById = buildSignalAssigneeRoleMap(assignees);
  const queueOwnerOptions = new Map<string, { userId: string | null; email: string | null }>();

  assignees.forEach((member) => {
    queueOwnerOptions.set(member.userId, {
      userId: member.userId,
      email: member.email ?? null,
    });
  });

  savedViews.forEach((view) => {
    if (!view.sharedOwnerUserId) {
      return;
    }

    queueOwnerOptions.set(view.sharedOwnerUserId, {
      userId: view.sharedOwnerUserId,
      email: view.sharedOwnerEmail ?? null,
    });
  });

  automationRuns.forEach((run) => {
    if (!run.sharedOwnerUserId) {
      return;
    }

    queueOwnerOptions.set(run.sharedOwnerUserId, {
      userId: run.sharedOwnerUserId,
      email: run.sharedOwnerEmail ?? null,
    });
  });

  const summaryMap = new Map<string, SignalQueueOwnerSummary>();

  const ensureSummary = (ownerUserId: string | null, ownerEmail: string | null) => {
    const key = ownerUserId ?? 'unassigned';
    const existing = summaryMap.get(key);
    if (existing) {
      return existing;
    }

    const next: SignalQueueOwnerSummary = {
      key,
      ownerUserId,
      ownerEmail,
      label: formatSignalAssigneeLabel(ownerEmail, ownerUserId),
      queueCounts: createEmptySignalQueueCounts(),
      teamViewsCount: 0,
      pinnedViewsCount: 0,
      recentRunsCount: 0,
      pendingOutcomesCount: 0,
      assignedSignalsCount: 0,
      overdueAssignedCount: 0,
      teamDefaultName: null,
    };
    summaryMap.set(key, next);
    return next;
  };

  queueOwnerOptions.forEach((owner) => {
    ensureSummary(owner.userId, owner.email);
  });

  savedViews
    .filter((view) => view.scope === 'team')
    .forEach((view) => {
      const summary = ensureSummary(view.sharedOwnerUserId, view.sharedOwnerEmail);
      summary.teamViewsCount += 1;
      if (view.isPinned) {
        summary.pinnedViewsCount += 1;
      }
      if (view.isTeamDefault) {
        summary.teamDefaultName = view.name;
      }
    });

  automationRuns.forEach((run) => {
    const summary = ensureSummary(run.sharedOwnerUserId, run.sharedOwnerEmail);
    summary.recentRunsCount += 1;
    summary.pendingOutcomesCount += run.outcomeCounts.pending;
  });

  signals.forEach((signal) => {
    const ownerUserId = signal.assigneeUserId ?? null;
    const owner = ownerUserId ? queueOwnerOptions.get(ownerUserId) : null;
    const summary = ensureSummary(ownerUserId, owner?.email ?? signal.assigneeEmail ?? null);

    summary.queueCounts.all += 1;
    if (matchesSignalQueueView(signal, 'needs_action', assigneeRoleById)) {
      summary.queueCounts.needs_action += 1;
    }
    if (matchesSignalQueueView(signal, 'blocked', assigneeRoleById)) {
      summary.queueCounts.blocked += 1;
    }
    if (matchesSignalQueueView(signal, 'awaiting_owner', assigneeRoleById)) {
      summary.queueCounts.awaiting_owner += 1;
    }
    if (matchesSignalQueueView(signal, 'overdue_only', assigneeRoleById)) {
      summary.queueCounts.overdue_only += 1;
    }

    if (!signal.assigneeUserId) {
      return;
    }

    summary.assignedSignalsCount += 1;
    if (signal.aging.slaState === 'overdue') {
      summary.overdueAssignedCount += 1;
    }
  });

  return Array.from(summaryMap.values())
    .filter((summary) => summary.teamViewsCount > 0 || summary.recentRunsCount > 0 || summary.assignedSignalsCount > 0)
    .sort((left, right) => {
      const byPending = right.pendingOutcomesCount - left.pendingOutcomesCount;
      if (byPending !== 0) {
        return byPending;
      }

      const byOverdue = right.overdueAssignedCount - left.overdueAssignedCount;
      if (byOverdue !== 0) {
        return byOverdue;
      }

      return left.label.localeCompare(right.label, 'ru-RU');
    });
}

export function getSignalEscalationPreset(
  signal: SignalListItem,
  assigneeRoleById: Record<string, string>,
) {
  if (signal.workflowState === 'blocked' && signal.aging.slaState === 'overdue') {
    return SIGNAL_ESCALATION_PRESETS.find((preset) => preset.id === 'blocked-overdue') ?? null;
  }

  if (signal.workflowState === 'handoff' && signal.aging.slaState === 'overdue') {
    return SIGNAL_ESCALATION_PRESETS.find((preset) => preset.id === 'handoff-owner-overdue') ?? null;
  }

  if (matchesSignalQueueView(signal, 'needs_action', assigneeRoleById) && signal.aging.slaState !== 'healthy') {
    return SIGNAL_ESCALATION_PRESETS.find((preset) => preset.id === 'needs-action-priority') ?? null;
  }

  return null;
}
