'use server';

import { AnalyticsEngine } from '@/server/analytics/engine';
import { revalidatePath } from 'next/cache';
import { requireTenantAccess } from '@/lib/auth/tenant-access';
import {
  resolveSignalAutomationSuppressionTarget,
  resolveSignalFollowUpResolution,
  resolveSignalQueueView,
  resolveSignalReviewSource,
  resolveSignalSavedViewScope,
  resolveSignalSortPreset,
  resolveSignalWorkflowState,
} from '@/lib/operator-signal-timeline';
import { z } from 'zod';

const signalNoteSchema = z.string().trim().min(3, 'Комментарий должен быть не короче 3 символов').max(2000, 'Комментарий слишком длинный');
const signalIdsSchema = z.array(z.string().uuid()).min(1, 'Выберите хотя бы один сигнал').max(100, 'Слишком много сигналов за одну операцию');
const signalStatusSchema = z.enum(['resolved', 'ignored']);
const optionalAssigneeSchema = z.string().uuid().nullable().optional();
const optionalSavedViewOwnerSchema = z.string().uuid().nullable().optional();
const signalSavedViewIdSchema = z.string().uuid();
const signalSavedViewNameSchema = z.string().trim().min(2, 'Название вида должно быть не короче 2 символов').max(120, 'Название вида слишком длинное');
const signalWorkflowFilterSchema = z.enum(['all', 'new', 'in_progress', 'handoff', 'blocked']);
const signalSavedViewDefaultSchema = z.boolean();
const signalSavedViewMoveDirectionSchema = z.enum(['up', 'down']);
const signalFollowUpResolutionSchema = z.enum(['acknowledged', 'action_taken', 'no_action']);
const signalAutomationSuppressionTargetSchema = z.enum(['saved_view', 'queue_owner']);
const signalAutomationSuppressionReasonSchema = z.string().trim().min(3, 'Причина должна быть не короче 3 символов').max(500, 'Причина слишком длинная');

function buildSignalWorkflowActor(
  user: { id: string; email?: string | null },
  access: { role: string },
  openedFrom?: string | null,
) {
  return {
    userId: user.id,
    actorEmail: user.email ?? user.id,
    actorRole: access.role,
    openedFrom: resolveSignalReviewSource(openedFrom) ?? 'overview',
  };
}

function parseOptionalFutureTimestamp(value?: string | null) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Некорректный suppress-until');
  }

  return parsed;
}

function parseSignalSavedViewPayload(payload: {
  name: string;
  queueView: string;
  assigneeFilter: string;
  workflowFilter: string;
  scope: string;
  sortPreset: string;
  sharedOwnerUserId?: string | null;
}) {
  const parsedName = signalSavedViewNameSchema.parse(payload.name);
  const parsedQueueView = resolveSignalQueueView(payload.queueView);
  const parsedWorkflowFilter = signalWorkflowFilterSchema.parse(payload.workflowFilter);
  const parsedScope = resolveSignalSavedViewScope(payload.scope);
  const parsedSortPreset = resolveSignalSortPreset(payload.sortPreset);

  if (!parsedQueueView) {
    throw new Error('Некорректный queue view');
  }

  if (!parsedScope) {
    throw new Error('Некорректный scope saved view');
  }

  if (!parsedSortPreset) {
    throw new Error('Некорректный sort preset');
  }

  const assigneeFilter = payload.assigneeFilter?.trim() || 'all';
  const isValidAssigneeFilter = assigneeFilter === 'all'
    || assigneeFilter === 'unassigned'
    || z.string().uuid().safeParse(assigneeFilter).success;

  if (!isValidAssigneeFilter) {
    throw new Error('Некорректный фильтр ответственного');
  }

  return {
    name: parsedName,
    scope: parsedScope,
    queueView: parsedQueueView,
    assigneeFilter,
    workflowFilter: parsedWorkflowFilter,
    sortPreset: parsedSortPreset,
    sharedOwnerUserId: parsedScope === 'team'
      ? optionalSavedViewOwnerSchema.parse(payload.sharedOwnerUserId ?? null)
      : null,
  };
}

/**
 * Пометить сигнал как решенный
 */
export async function resolveSignal(tenantId: string, signalId: string) {
  await requireTenantAccess(tenantId, ['owner', 'admin']);

  await AnalyticsEngine.updateSignalStatus(tenantId, signalId, 'resolved');
  revalidatePath('/overview');
  return { success: true };
}

export async function assignSignalOwner(
  tenantId: string,
  signalId: string,
  assigneeUserId: string | null,
  openedFrom?: string | null,
) {
  const { user, access } = await requireTenantAccess(tenantId, ['owner', 'admin']);

  await AnalyticsEngine.assignSignalOwner(tenantId, signalId, assigneeUserId, buildSignalWorkflowActor(user, access, openedFrom));

  revalidatePath('/overview');
  return { success: true };
}

export async function updateSignalWorkflowStateAction(
  tenantId: string,
  signalId: string,
  workflowState: string,
  openedFrom?: string | null,
) {
  const { user, access } = await requireTenantAccess(tenantId, ['owner', 'admin']);
  const resolvedWorkflowState = resolveSignalWorkflowState(workflowState);

  if (!resolvedWorkflowState) {
    throw new Error('Некорректный workflow state');
  }

  await AnalyticsEngine.updateSignalWorkflowState(
    tenantId,
    signalId,
    resolvedWorkflowState,
    buildSignalWorkflowActor(user, access, openedFrom),
  );

  revalidatePath('/overview');
  return { success: true };
}

export async function addSignalNote(
  tenantId: string,
  signalId: string,
  noteBody: string,
  openedFrom?: string | null,
) {
  const { user, access } = await requireTenantAccess(tenantId);
  const parsedNote = signalNoteSchema.parse(noteBody);

  await AnalyticsEngine.addSignalNote(tenantId, signalId, parsedNote, buildSignalWorkflowActor(user, access, openedFrom));

  revalidatePath('/overview');
  return { success: true };
}

/**
 * Скрыть/Игнорировать сигнал
 */
export async function ignoreSignal(tenantId: string, signalId: string) {
  await requireTenantAccess(tenantId, ['owner', 'admin']);

  await AnalyticsEngine.updateSignalStatus(tenantId, signalId, 'ignored');
  revalidatePath('/overview');
  return { success: true };
}

export async function bulkAssignSignalOwner(
  tenantId: string,
  signalIds: string[],
  assigneeUserId: string | null,
  openedFrom?: string | null,
) {
  const { user, access } = await requireTenantAccess(tenantId, ['owner', 'admin']);
  const parsedSignalIds = signalIdsSchema.parse(signalIds);

  await AnalyticsEngine.bulkAssignSignalOwner(
    tenantId,
    parsedSignalIds,
    assigneeUserId,
    buildSignalWorkflowActor(user, access, openedFrom),
  );

  revalidatePath('/overview');
  return { success: true };
}

export async function bulkUpdateSignalWorkflowStateAction(
  tenantId: string,
  signalIds: string[],
  workflowState: string,
  openedFrom?: string | null,
) {
  const { user, access } = await requireTenantAccess(tenantId, ['owner', 'admin']);
  const parsedSignalIds = signalIdsSchema.parse(signalIds);
  const resolvedWorkflowState = resolveSignalWorkflowState(workflowState);

  if (!resolvedWorkflowState) {
    throw new Error('Некорректный workflow state');
  }

  await AnalyticsEngine.bulkUpdateSignalWorkflowState(
    tenantId,
    parsedSignalIds,
    resolvedWorkflowState,
    buildSignalWorkflowActor(user, access, openedFrom),
  );

  revalidatePath('/overview');
  return { success: true };
}

export async function bulkUpdateSignalStatusAction(
  tenantId: string,
  signalIds: string[],
  status: 'resolved' | 'ignored',
) {
  await requireTenantAccess(tenantId, ['owner', 'admin']);
  const parsedSignalIds = signalIdsSchema.parse(signalIds);
  const parsedStatus = signalStatusSchema.parse(status);

  await AnalyticsEngine.bulkUpdateSignalStatus(tenantId, parsedSignalIds, parsedStatus);

  revalidatePath('/overview');
  return { success: true };
}

export async function bulkAddSignalNoteAction(
  tenantId: string,
  signalIds: string[],
  noteBody: string,
  openedFrom?: string | null,
) {
  const { user, access } = await requireTenantAccess(tenantId);
  const parsedSignalIds = signalIdsSchema.parse(signalIds);
  const parsedNote = signalNoteSchema.parse(noteBody);

  await AnalyticsEngine.bulkAddSignalNote(tenantId, parsedSignalIds, parsedNote, buildSignalWorkflowActor(user, access, openedFrom));

  revalidatePath('/overview');
  return { success: true };
}

export async function applySignalHandoffPresetAction(
  tenantId: string,
  signalId: string,
  payload: {
    assigneeUserId?: string | null;
    workflowState: string;
    noteBody: string;
  },
  openedFrom?: string | null,
) {
  const { user, access } = await requireTenantAccess(tenantId, ['owner', 'admin']);
  const parsedAssigneeUserId = payload.assigneeUserId === undefined
    ? undefined
    : optionalAssigneeSchema.parse(payload.assigneeUserId);
  const parsedNote = signalNoteSchema.parse(payload.noteBody);
  const resolvedWorkflowState = resolveSignalWorkflowState(payload.workflowState);

  if (!resolvedWorkflowState) {
    throw new Error('Некорректный workflow state');
  }

  await AnalyticsEngine.bulkApplySignalHandoffPreset(tenantId, [signalId], {
    assigneeUserId: parsedAssigneeUserId,
    workflowState: resolvedWorkflowState,
    noteBody: parsedNote,
  }, buildSignalWorkflowActor(user, access, openedFrom));

  revalidatePath('/overview');
  return { success: true };
}

export async function bulkApplySignalHandoffPresetAction(
  tenantId: string,
  signalIds: string[],
  payload: {
    assigneeUserId?: string | null;
    workflowState: string;
    noteBody: string;
  },
  openedFrom?: string | null,
) {
  const { user, access } = await requireTenantAccess(tenantId, ['owner', 'admin']);
  const parsedSignalIds = signalIdsSchema.parse(signalIds);
  const parsedAssigneeUserId = payload.assigneeUserId === undefined
    ? undefined
    : optionalAssigneeSchema.parse(payload.assigneeUserId);
  const parsedNote = signalNoteSchema.parse(payload.noteBody);
  const resolvedWorkflowState = resolveSignalWorkflowState(payload.workflowState);

  if (!resolvedWorkflowState) {
    throw new Error('Некорректный workflow state');
  }

  await AnalyticsEngine.bulkApplySignalHandoffPreset(tenantId, parsedSignalIds, {
    assigneeUserId: parsedAssigneeUserId,
    workflowState: resolvedWorkflowState,
    noteBody: parsedNote,
  }, buildSignalWorkflowActor(user, access, openedFrom));

  revalidatePath('/overview');
  return { success: true };
}

export async function runSignalSlaAutomationAction(
  tenantId: string,
  signalIds: string[],
  openedFrom?: string | null,
  context?: {
    savedViewId?: string | null;
    sharedOwnerUserId?: string | null;
    queuePresetId?: string | null;
    triggerLabel?: string | null;
    dryRun?: boolean;
    previewControlEventId?: string | null;
  },
) {
  const { user, access } = await requireTenantAccess(tenantId, ['owner', 'admin']);
  const parsedSignalIds = signalIdsSchema.parse(signalIds);

  const result = await AnalyticsEngine.runSignalSlaAutomation(
    tenantId,
    parsedSignalIds,
    buildSignalWorkflowActor(user, access, openedFrom),
    {
      savedViewId: context?.savedViewId ? signalSavedViewIdSchema.parse(context.savedViewId) : null,
      sharedOwnerUserId: context?.sharedOwnerUserId ? optionalSavedViewOwnerSchema.parse(context.sharedOwnerUserId) : null,
      queuePresetId: context?.queuePresetId?.trim() || null,
      triggerLabel: context?.triggerLabel?.trim() || null,
      dryRun: context?.dryRun ?? false,
      previewControlEventId: context?.previewControlEventId ? signalSavedViewIdSchema.parse(context.previewControlEventId) : null,
    },
  );

  if (!(context?.dryRun ?? false)) {
    revalidatePath('/overview');
    return { success: true };
  }

  return result;
}

export async function runSignalSlaFollowUpAction(
  tenantId: string,
  runId: string,
  openedFrom?: string | null,
) {
  const { user, access } = await requireTenantAccess(tenantId, ['owner', 'admin']);
  const parsedRunId = signalSavedViewIdSchema.parse(runId);

  await AnalyticsEngine.runSignalSlaPendingFollowUp(
    tenantId,
    parsedRunId,
    buildSignalWorkflowActor(user, access, openedFrom),
  );

  revalidatePath('/overview');
  return { success: true };
}

export async function previewSignalSlaAutomationAction(
  tenantId: string,
  signalIds: string[],
  openedFrom?: string | null,
  context?: {
    savedViewId?: string | null;
    sharedOwnerUserId?: string | null;
    queuePresetId?: string | null;
    triggerLabel?: string | null;
  },
) {
  const { user, access } = await requireTenantAccess(tenantId, ['owner', 'admin']);
  const parsedSignalIds = signalIdsSchema.parse(signalIds);

  return AnalyticsEngine.previewSignalSlaAutomation(
    tenantId,
    parsedSignalIds,
    buildSignalWorkflowActor(user, access, openedFrom),
    {
      savedViewId: context?.savedViewId ? signalSavedViewIdSchema.parse(context.savedViewId) : null,
      sharedOwnerUserId: context?.sharedOwnerUserId ? optionalSavedViewOwnerSchema.parse(context.sharedOwnerUserId) : null,
      queuePresetId: context?.queuePresetId?.trim() || null,
      triggerLabel: context?.triggerLabel?.trim() || null,
    },
  );
}

export async function captureSignalFollowUpResolutionAction(
  tenantId: string,
  signalId: string,
  payload: {
    sourceAutomationRunId: string;
    followUpBatchId: string;
    resolution: string;
  },
  openedFrom?: string | null,
) {
  const { user, access } = await requireTenantAccess(tenantId);
  const parsedSourceAutomationRunId = signalSavedViewIdSchema.parse(payload.sourceAutomationRunId);
  const parsedFollowUpBatchId = signalSavedViewIdSchema.parse(payload.followUpBatchId);
  const parsedResolution = resolveSignalFollowUpResolution(signalFollowUpResolutionSchema.parse(payload.resolution));

  if (!parsedResolution) {
    throw new Error('Некорректная follow-up resolution');
  }

  await AnalyticsEngine.captureSignalFollowUpResolution(
    tenantId,
    signalSavedViewIdSchema.parse(signalId),
    {
      sourceAutomationRunId: parsedSourceAutomationRunId,
      followUpBatchId: parsedFollowUpBatchId,
      resolution: parsedResolution,
    },
    buildSignalWorkflowActor(user, access, openedFrom),
  );

  revalidatePath('/overview');
  return { success: true };
}

export async function toggleSignalAutomationSuppressionAction(
  tenantId: string,
  payload: {
    targetType: string;
    savedViewId?: string | null;
    sharedOwnerUserId?: string | null;
    isSuppressed: boolean;
    reason?: string | null;
    suppressUntil?: string | null;
    clearReason?: string | null;
  },
) {
  const { user, access } = await requireTenantAccess(tenantId, ['owner', 'admin']);
  const targetType = resolveSignalAutomationSuppressionTarget(signalAutomationSuppressionTargetSchema.parse(payload.targetType));

  if (!targetType) {
    throw new Error('Некорректный target suppression');
  }

  const parsedSavedViewId = payload.savedViewId ? signalSavedViewIdSchema.parse(payload.savedViewId) : null;
  const parsedSharedOwnerUserId = payload.sharedOwnerUserId ? optionalSavedViewOwnerSchema.parse(payload.sharedOwnerUserId) : null;
  const parsedSuppressUntil = parseOptionalFutureTimestamp(payload.suppressUntil ?? null);

  if (payload.isSuppressed) {
    await AnalyticsEngine.clearSignalAutomationSuppression(
      tenantId,
      buildSignalWorkflowActor(user, access, 'overview'),
      {
        targetType,
        savedViewId: parsedSavedViewId,
        sharedOwnerUserId: parsedSharedOwnerUserId,
        clearReason: payload.clearReason?.trim() || null,
      },
    );
  } else {
    await AnalyticsEngine.setSignalAutomationSuppression(
      tenantId,
      buildSignalWorkflowActor(user, access, 'overview'),
      {
        targetType,
        savedViewId: parsedSavedViewId,
        sharedOwnerUserId: parsedSharedOwnerUserId,
        reason: signalAutomationSuppressionReasonSchema.parse(payload.reason ?? ''),
        suppressUntil: parsedSuppressUntil,
      },
    );
  }

  revalidatePath('/overview');
  return { success: true };
}

export async function saveSignalSavedViewAction(
  tenantId: string,
  payload: {
    name: string;
    queueView: string;
    assigneeFilter: string;
    workflowFilter: string;
    scope: string;
    sortPreset: string;
    sharedOwnerUserId?: string | null;
  },
) {
  const { user, access } = await requireTenantAccess(tenantId);
  const parsedPayload = parseSignalSavedViewPayload(payload);

  await AnalyticsEngine.saveSignalSavedView(tenantId, user.id, access.role, parsedPayload);

  revalidatePath('/overview');
  return { success: true };
}

export async function updateSignalSavedViewAction(
  tenantId: string,
  savedViewId: string,
  payload: {
    name: string;
    queueView: string;
    assigneeFilter: string;
    workflowFilter: string;
    scope: string;
    sortPreset: string;
    sharedOwnerUserId?: string | null;
  },
) {
  const { user, access } = await requireTenantAccess(tenantId);
  const parsedSavedViewId = signalSavedViewIdSchema.parse(savedViewId);
  const parsedPayload = parseSignalSavedViewPayload(payload);

  await AnalyticsEngine.updateSignalSavedView(tenantId, user.id, access.role, parsedSavedViewId, parsedPayload);

  revalidatePath('/overview');
  return { success: true };
}

export async function setDefaultSignalSavedViewAction(
  tenantId: string,
  savedViewId: string,
  isDefault: boolean,
) {
  const { user, access } = await requireTenantAccess(tenantId);
  const parsedSavedViewId = signalSavedViewIdSchema.parse(savedViewId);
  const parsedIsDefault = signalSavedViewDefaultSchema.parse(isDefault);

  await AnalyticsEngine.setSignalSavedViewDefault(tenantId, user.id, access.role, parsedSavedViewId, parsedIsDefault);

  revalidatePath('/overview');
  return { success: true };
}

export async function togglePinSignalSavedViewAction(
  tenantId: string,
  savedViewId: string,
  isPinned: boolean,
) {
  const { user, access } = await requireTenantAccess(tenantId);
  const parsedSavedViewId = signalSavedViewIdSchema.parse(savedViewId);
  const parsedIsPinned = signalSavedViewDefaultSchema.parse(isPinned);

  await AnalyticsEngine.toggleSignalSavedViewPin(tenantId, user.id, access.role, parsedSavedViewId, parsedIsPinned);

  revalidatePath('/overview');
  return { success: true };
}

export async function moveSignalSavedViewAction(
  tenantId: string,
  savedViewId: string,
  direction: 'up' | 'down',
) {
  const { user, access } = await requireTenantAccess(tenantId);
  const parsedSavedViewId = signalSavedViewIdSchema.parse(savedViewId);
  const parsedDirection = signalSavedViewMoveDirectionSchema.parse(direction);

  await AnalyticsEngine.moveSignalSavedView(tenantId, user.id, access.role, parsedSavedViewId, parsedDirection);

  revalidatePath('/overview');
  return { success: true };
}

export async function deleteSignalSavedViewAction(
  tenantId: string,
  savedViewId: string,
) {
  const { user, access } = await requireTenantAccess(tenantId);
  const parsedSavedViewId = signalSavedViewIdSchema.parse(savedViewId);

  await AnalyticsEngine.deleteSignalSavedView(tenantId, user.id, access.role, parsedSavedViewId);

  revalidatePath('/overview');
  return { success: true };
}

export async function markSignalNotificationsReadAction(
  tenantId: string,
  eventIds: string[],
) {
  const { user } = await requireTenantAccess(tenantId);
  const parsedEventIds = signalIdsSchema.parse(eventIds);

  await AnalyticsEngine.markSignalNotificationsRead(tenantId, user.id, parsedEventIds);

  return { success: true };
}

export async function acknowledgeSignalNotificationsAction(
  tenantId: string,
  eventIds: string[],
) {
  const { user } = await requireTenantAccess(tenantId);
  const parsedEventIds = signalIdsSchema.parse(eventIds);

  await AnalyticsEngine.acknowledgeSignalNotifications(tenantId, user.id, parsedEventIds);

  return { success: true };
}
