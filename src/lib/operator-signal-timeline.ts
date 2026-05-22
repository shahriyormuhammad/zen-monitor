export type SignalReviewSource = 'overview' | 'economics' | 'explorer';

export type SignalTimelineEventType = 'view' | 'note' | 'assignment' | 'workflow_state';

export type SignalWorkflowState = 'new' | 'in_progress' | 'handoff' | 'blocked';

export type SignalQueueView = 'all' | 'needs_action' | 'blocked' | 'awaiting_owner' | 'overdue_only';

export type SignalSortPreset = 'severity' | 'sla_pressure' | 'newest';

export type SignalSavedViewScope = 'private' | 'team';

export type SignalSlaState = 'healthy' | 'warning' | 'overdue';

export type SignalAutomationSource = 'manual' | 'scheduled';

export type SignalAutomationTriggerType = 'ad_hoc' | 'queue_preset' | 'saved_view' | 'scheduled' | 'follow_up';

export type SignalAutomationRunStatus = 'running' | 'completed' | 'failed';

export type SignalEscalationOutcome = 'pending' | 'progressed' | 'resolved' | 'ignored';

export type SignalFollowUpResolution = 'acknowledged' | 'action_taken' | 'no_action';

export type SignalAutomationSuppressionTarget = 'saved_view' | 'queue_owner';

export type SignalAutomationControlEventType = 'preview' | 'execute';

export type SignalAutomationControlEventStatus = 'completed' | 'failed';

export type SignalAutomationSuppressionStatus = 'active' | 'expired' | 'cleared';

export type SignalAutomationFollowUpResolutionSummary = {
  batchId: string;
  resolution: SignalFollowUpResolution;
  actorEmail: string;
  createdAt: string | Date;
  noteBody: string | null;
};

export type SignalAutomationFollowUpWave = {
  batchId: string;
  automationSource: SignalAutomationSource;
  actorEmail: string;
  createdAt: string | Date;
  targetCount: number;
  outcomeCounts: Record<SignalEscalationOutcome, number>;
  resolutionCounts: Record<SignalFollowUpResolution, number>;
  awaitingExplicitOutcomeCount: number;
  escalationAlertCount: number;
  lastEscalationAlertAt: string | Date | null;
  latestResolutionAt: string | Date | null;
};

export type SignalNotificationPreferenceKey = 'note' | 'assignment' | 'blocked' | 'automation';

export type SignalNotificationPreferences = Record<SignalNotificationPreferenceKey, boolean>;

export const DEFAULT_SIGNAL_NOTIFICATION_PREFERENCES: SignalNotificationPreferences = {
  note: true,
  assignment: true,
  blocked: true,
  automation: true,
};

export type SignalTimelineEntry = {
  id: string;
  signalId: string;
  actorUserId: string | null;
  actorEmail: string;
  actorRole: string;
  eventType: SignalTimelineEventType;
  openedFrom: SignalReviewSource;
  eventBody: string | null;
  eventPayload: Record<string, unknown>;
  createdAt: string | Date;
};

export type RecentSignalReview = {
  signalId: string;
  title: string;
  severity: string;
  nmId: number | null;
  actorEmail: string;
  actorRole: string;
  eventType: SignalTimelineEventType;
  openedFrom: SignalReviewSource;
  createdAt: string | Date;
  isActive: boolean;
};

export type SignalAssigneeOption = {
  userId: string;
  email: string | null;
  role: string;
};

export type SignalWorkflowSummary = {
  workflowState: SignalWorkflowState;
  assigneeUserId: string | null;
  assigneeEmail: string | null;
  workflowUpdatedAt: string | Date | null;
  workflowUpdatedByUserId: string | null;
  workflowUpdatedByEmail: string | null;
  availableAssignees: SignalAssigneeOption[];
};

export type SignalAgingSummary = {
  queueEnteredAt: string | Date | null;
  queueAgeHours: number;
  queueAgeLabel: string;
  slaTargetHours: number | null;
  slaWarnHours: number | null;
  slaState: SignalSlaState;
  slaLabel: string;
};

export type SignalListItem = {
  id: string;
  nmId: number | null;
  vendorCode?: string | null;
  brand?: string | null;
  photoUrl?: string | null;
  type: string;
  severity: 'critical' | 'high' | 'medium';
  title: string;
  description: string;
  impactRub?: string | null;
  primaryActionLabel?: string;
  primaryActionHref?: string;
  createdAt: string | Date | null;
  workflowState: SignalWorkflowState;
  assigneeUserId: string | null;
  assigneeEmail: string | null;
  status: string;
  workflowUpdatedAt: string | Date | null;
  aging: SignalAgingSummary;
  lastEscalation: {
    automationRunId: string | null;
    presetId: string | null;
    automationSource: SignalAutomationSource;
    actorEmail: string;
    createdAt: string | Date;
    outcome: SignalEscalationOutcome;
    outcomeLabel: string;
  } | null;
};

export type SignalSavedView = {
  id: string;
  name: string;
  queueView: SignalQueueView;
  assigneeFilter: string;
  workflowFilter: 'all' | SignalWorkflowState;
  sortPreset: SignalSortPreset;
  scope: SignalSavedViewScope;
  ownerUserId: string;
  ownerEmail: string | null;
  sharedOwnerUserId: string | null;
  sharedOwnerEmail: string | null;
  isPinned: boolean;
  isDefault: boolean;
  isTeamDefault: boolean;
  position: number;
  canEdit: boolean;
  canDelete: boolean;
  canReorder: boolean;
  canTogglePin: boolean;
  canSetDefault: boolean;
  canSetTeamDefault: boolean;
  canManageSharedOwner: boolean;
  createdAt: string | Date;
  updatedAt: string | Date;
};

export type SignalQueueOwnerSummary = {
  key: string;
  ownerUserId: string | null;
  ownerEmail: string | null;
  label: string;
  queueCounts: Record<SignalQueueView, number>;
  teamViewsCount: number;
  pinnedViewsCount: number;
  recentRunsCount: number;
  pendingOutcomesCount: number;
  assignedSignalsCount: number;
  overdueAssignedCount: number;
  teamDefaultName: string | null;
};

export type SignalAutomationRun = {
  id: string;
  automationType: 'sla';
  automationSource: SignalAutomationSource;
  triggerType: SignalAutomationTriggerType;
  triggerLabel: string | null;
  actorUserId: string | null;
  actorEmail: string;
  actorRole: string;
  savedViewId: string | null;
  savedViewName: string | null;
  sharedOwnerUserId: string | null;
  sharedOwnerEmail: string | null;
  targetSignalCount: number;
  eligibleCount: number;
  affectedCount: number;
  skippedCount: number;
  appliedPresets: Array<{ presetId: string; count: number }>;
  outcomeCounts: Record<SignalEscalationOutcome, number>;
  followUpCount: number;
  followUpWaveCount: number;
  escalationAlertCount: number;
  escalationWaveCount: number;
  followUpResolutionCounts: Record<SignalFollowUpResolution, number>;
  awaitingExplicitOutcomeCount: number;
  lastFollowUpAt: string | Date | null;
  lastEscalationAlertAt: string | Date | null;
  latestFollowUpResolutionAt: string | Date | null;
  latestFollowUpWave: SignalAutomationFollowUpWave | null;
  status: SignalAutomationRunStatus;
  errorMessage: string | null;
  createdAt: string | Date;
  finishedAt: string | Date | null;
};

export type SignalAutomationRunSignal = {
  signalId: string;
  title: string;
  severity: 'critical' | 'high' | 'medium';
  nmId: number | null;
  status: string;
  workflowState: SignalWorkflowState;
  assigneeUserId: string | null;
  assigneeEmail: string | null;
  aging: SignalAgingSummary;
  presetId: string | null;
  noteBody: string | null;
  createdAt: string | Date;
  outcome: SignalEscalationOutcome;
  outcomeLabel: string;
  followUpCount: number;
  escalationAlertCount: number;
  latestFollowUpBatchId: string | null;
  lastFollowUpAt: string | Date | null;
  lastEscalationAlertAt: string | Date | null;
  awaitingFollowUpOutcome: boolean;
  followUpResolution: SignalAutomationFollowUpResolutionSummary | null;
};

export type SignalAutomationRunDetail = {
  run: SignalAutomationRun;
  signals: SignalAutomationRunSignal[];
  followUpWaves: SignalAutomationFollowUpWave[];
};

export type SignalAutomationSuppression = {
  id: string;
  targetType: SignalAutomationSuppressionTarget;
  savedViewId: string | null;
  savedViewName: string | null;
  sharedOwnerUserId: string | null;
  sharedOwnerEmail: string | null;
  reason: string | null;
  suppressUntil: string | Date | null;
  actorUserId: string | null;
  actorEmail: string;
  actorRole: string;
  status: SignalAutomationSuppressionStatus;
  clearedAt: string | Date | null;
  clearedByUserId: string | null;
  clearedByEmail: string | null;
  clearedByRole: string | null;
  clearReason: string | null;
  createdAt: string | Date;
};

export type SignalAutomationControlEvent = {
  id: string;
  eventType: SignalAutomationControlEventType;
  automationType: 'sla';
  automationSource: SignalAutomationSource;
  triggerType: SignalAutomationTriggerType;
  triggerLabel: string | null;
  actorUserId: string | null;
  actorEmail: string;
  actorRole: string;
  savedViewId: string | null;
  savedViewName: string | null;
  sharedOwnerUserId: string | null;
  sharedOwnerEmail: string | null;
  linkedEventId: string | null;
  automationRunId: string | null;
  targetType: SignalAutomationSuppressionTarget | null;
  reason: string | null;
  suppressUntil: string | Date | null;
  targetSignalCount: number;
  eligibleCount: number;
  affectedCount: number;
  skippedCount: number;
  awaitingOutcomeCount: number;
  matchedSuppressionCount: number;
  appliedPresets: Array<{ presetId: string; count: number }>;
  status: SignalAutomationControlEventStatus;
  errorMessage: string | null;
  createdAt: string | Date;
};

export type SignalAutomationDryRunPreview = {
  controlEventId: string | null;
  targetSignalCount: number;
  eligibleCount: number;
  affectedCount: number;
  skippedCount: number;
  awaitingOutcomeCount: number;
  appliedPresets: Array<{ presetId: string; count: number }>;
  matchedSuppressions: SignalAutomationSuppression[];
  triggerLabel: string | null;
};

export type SignalFeedResponse = {
  signals: SignalListItem[];
  availableAssignees: SignalAssigneeOption[];
  savedViews: SignalSavedView[];
  automationRuns: SignalAutomationRun[];
  automationSuppressions: SignalAutomationSuppression[];
  automationControlEvents: SignalAutomationControlEvent[];
};

export type SignalDashboardSlaSummary = {
  overdueBlockedCount: number;
  overdueHandoffCount: number;
  agingNeedsActionCount: number;
};

export type SignalNotificationItem = {
  eventId: string;
  signalId: string;
  signalTitle: string;
  signalSeverity: 'critical' | 'high' | 'medium';
  signalNmId: number | null;
  actorEmail: string;
  eventType: SignalTimelineEventType;
  eventBody: string | null;
  openedFrom: SignalReviewSource;
  createdAt: string | Date;
  summary: string;
  isSlaNotification: boolean;
  workflowState: SignalWorkflowState | null;
  assigneeEmail: string | null;
  href: string;
  readAt: string | Date | null;
  acknowledgedAt: string | Date | null;
  isRead: boolean;
  isAcknowledged: boolean;
};

export type SignalNotificationsResponse = {
  notifications: SignalNotificationItem[];
  unreadCount: number;
};

export function isSignalReviewSource(value: string | null | undefined): value is SignalReviewSource {
  return value === 'overview' || value === 'economics' || value === 'explorer';
}

export function resolveSignalReviewSource(value: string | null | undefined): SignalReviewSource | null {
  return isSignalReviewSource(value) ? value : null;
}

export function isSignalTimelineEventType(value: string | null | undefined): value is SignalTimelineEventType {
  return value === 'view' || value === 'note' || value === 'assignment' || value === 'workflow_state';
}

export function resolveSignalTimelineEventType(value: string | null | undefined): SignalTimelineEventType | null {
  return isSignalTimelineEventType(value) ? value : null;
}

export function isSignalWorkflowState(value: string | null | undefined): value is SignalWorkflowState {
  return value === 'new' || value === 'in_progress' || value === 'handoff' || value === 'blocked';
}

export function resolveSignalWorkflowState(value: string | null | undefined): SignalWorkflowState | null {
  return isSignalWorkflowState(value) ? value : null;
}

export function isSignalQueueView(value: string | null | undefined): value is SignalQueueView {
  return value === 'all' || value === 'needs_action' || value === 'blocked' || value === 'awaiting_owner' || value === 'overdue_only';
}

export function resolveSignalQueueView(value: string | null | undefined): SignalQueueView | null {
  return isSignalQueueView(value) ? value : null;
}

export function isSignalSortPreset(value: string | null | undefined): value is SignalSortPreset {
  return value === 'severity' || value === 'sla_pressure' || value === 'newest';
}

export function resolveSignalSortPreset(value: string | null | undefined): SignalSortPreset | null {
  return isSignalSortPreset(value) ? value : null;
}

export function isSignalSavedViewScope(value: string | null | undefined): value is SignalSavedViewScope {
  return value === 'private' || value === 'team';
}

export function resolveSignalSavedViewScope(value: string | null | undefined): SignalSavedViewScope | null {
  return isSignalSavedViewScope(value) ? value : null;
}

export function isSignalFollowUpResolution(value: string | null | undefined): value is SignalFollowUpResolution {
  return value === 'acknowledged' || value === 'action_taken' || value === 'no_action';
}

export function resolveSignalFollowUpResolution(value: string | null | undefined): SignalFollowUpResolution | null {
  return isSignalFollowUpResolution(value) ? value : null;
}

export function isSignalAutomationSuppressionTarget(value: string | null | undefined): value is SignalAutomationSuppressionTarget {
  return value === 'saved_view' || value === 'queue_owner';
}

export function resolveSignalAutomationSuppressionTarget(value: string | null | undefined): SignalAutomationSuppressionTarget | null {
  return isSignalAutomationSuppressionTarget(value) ? value : null;
}

export function resolveSignalNotificationPreferences(value: unknown): SignalNotificationPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return DEFAULT_SIGNAL_NOTIFICATION_PREFERENCES;
  }

  const candidate = value as Partial<Record<SignalNotificationPreferenceKey, unknown>>;

  return {
    note: typeof candidate.note === 'boolean' ? candidate.note : DEFAULT_SIGNAL_NOTIFICATION_PREFERENCES.note,
    assignment: typeof candidate.assignment === 'boolean' ? candidate.assignment : DEFAULT_SIGNAL_NOTIFICATION_PREFERENCES.assignment,
    blocked: typeof candidate.blocked === 'boolean' ? candidate.blocked : DEFAULT_SIGNAL_NOTIFICATION_PREFERENCES.blocked,
    automation: typeof candidate.automation === 'boolean'
      ? candidate.automation
      : typeof candidate.note === 'boolean'
        ? candidate.note
        : DEFAULT_SIGNAL_NOTIFICATION_PREFERENCES.automation,
  };
}

export function isSignalAutomationNotificationPayload(eventPayload?: Record<string, unknown> | null) {
  return eventPayload?.automation === 'sla'
    || eventPayload?.automation === 'sla_follow_up'
    || eventPayload?.automation === 'sla_follow_up_resolution'
    || eventPayload?.automation === 'sla_follow_up_escalation';
}

export function resolveSignalNotificationPreferenceKey(
  eventType: SignalTimelineEventType,
  eventPayload?: Record<string, unknown> | null,
): SignalNotificationPreferenceKey | null {
  if (eventType === 'note') {
    return isSignalAutomationNotificationPayload(eventPayload) ? 'automation' : 'note';
  }

  if (eventType === 'assignment') {
    return eventType;
  }

  if (eventType === 'workflow_state') {
    const workflowState = resolveSignalWorkflowState(
      typeof eventPayload?.workflowState === 'string' ? eventPayload.workflowState : null,
    );

    return workflowState === 'blocked' ? 'blocked' : null;
  }

  return null;
}
