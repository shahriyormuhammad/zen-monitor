import type {
  SignalAgingSummary,
  SignalAutomationFollowUpWave,
  SignalAutomationSource,
  SignalAutomationSuppression,
  SignalAutomationSuppressionStatus,
  SignalAutomationControlEventStatus,
  SignalAutomationControlEventType,
  SignalAutomationTriggerType,
  SignalEscalationOutcome,
  SignalFollowUpResolution,
  SignalTimelineEventType,
  SignalWorkflowState,
} from "@/lib/operator-signal-timeline";
import {
  isSignalAutomationNotificationPayload,
  resolveSignalFollowUpResolution,
  resolveSignalWorkflowState,
} from "@/lib/operator-signal-timeline";
export type SignalRecommendation = {
  label: string;
  description: string;
  href: string;
};

export type SignalFixAction = {
  label: string;
  href: string;
};

export type SignalInsight = {
  label: string;
  value: string;
  tone: "danger" | "warning" | "success" | "default";
};

export function normalizeSignalType(type: string) {
  switch (type) {
    case "margin_leak":
      return "negative_margin";
    case "conversion_drop":
      return "conversion_drop";
    default:
      return type;
  }
}

export function getSafeUserLabel(email: string | null | undefined, userId: string | null | undefined) {
  if (email) {
    return email;
  }

  if (userId) {
    return `user:${userId.slice(0, 8)}`;
  }

  return "unknown-user";
}

export function normalizeSignalSeverity(value: string | null | undefined): "critical" | "high" | "medium" {
  if (value === "critical" || value === "high") {
    return value;
  }

  return "medium";
}

export function toPayloadRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

export function buildSignalOverviewHref(signalId: string) {
  const params = new URLSearchParams({ signalId });
  return `/overview?${params.toString()}`;
}

export function isTenantManager(role: string | null | undefined) {
  return role === "owner" || role === "admin";
}

export function getSignalEscalationOutcomeLabel(outcome: SignalEscalationOutcome) {
  switch (outcome) {
    case "resolved":
      return "Закрыт после эскалации";
    case "ignored":
      return "Снят после эскалации";
    case "progressed":
      return "Есть движение после эскалации";
    default:
      return "Ждёт реакции";
  }
}

export function resolveSignalEscalationOutcome({
  signalStatus,
  resolvedAt,
  workflowUpdatedAt,
  workflowUpdatedByEmail,
  escalatedAt,
  actorEmail,
}: {
  signalStatus: string | null | undefined;
  resolvedAt: Date | string | null | undefined;
  workflowUpdatedAt: Date | string | null | undefined;
  workflowUpdatedByEmail: string | null | undefined;
  escalatedAt: Date | string;
  actorEmail: string;
}): SignalEscalationOutcome {
  const escalatedAtMs = new Date(escalatedAt).getTime();
  const resolvedAtMs = resolvedAt ? new Date(resolvedAt).getTime() : Number.NaN;
  const workflowUpdatedAtMs = workflowUpdatedAt ? new Date(workflowUpdatedAt).getTime() : Number.NaN;

  if (signalStatus === "resolved" && !Number.isNaN(resolvedAtMs) && resolvedAtMs >= escalatedAtMs) {
    return "resolved";
  }

  if (signalStatus === "ignored") {
    return "ignored";
  }

  if (!Number.isNaN(workflowUpdatedAtMs) && workflowUpdatedAtMs > escalatedAtMs && workflowUpdatedByEmail !== actorEmail) {
    return "progressed";
  }

  return "pending";
}

export function resolveSignalAutomationSource(value: string | null | undefined): SignalAutomationSource {
  return value === "scheduled" ? "scheduled" : "manual";
}

export function resolveSignalAutomationTriggerType(value: string | null | undefined): SignalAutomationTriggerType {
  switch (value) {
    case "queue_preset":
    case "saved_view":
    case "scheduled":
    case "follow_up":
      return value;
    default:
      return "ad_hoc";
  }
}

export function resolveSignalAutomationControlEventType(value: string | null | undefined): SignalAutomationControlEventType | null {
  switch (value) {
    case "preview":
    case "execute":
      return value;
    default:
      return null;
  }
}

export function resolveSignalAutomationControlEventStatus(value: string | null | undefined): SignalAutomationControlEventStatus {
  return value === "failed" ? "failed" : "completed";
}

export function isSlaAutomationNotification(payload: Record<string, unknown>) {
  return isSignalAutomationNotificationPayload(payload);
}

export function buildSignalAutomationRunLabel(run: {
  triggerLabel: string | null;
  savedViewName: string | null;
  automationSource: SignalAutomationSource;
}) {
  return run.triggerLabel ?? run.savedViewName ?? (run.automationSource === "scheduled" ? "Scheduled SLA sweep" : "Ad hoc SLA automation");
}

export function buildSignalSlaFollowUpNoteBody(run: {
  triggerLabel: string | null;
  savedViewName: string | null;
  sharedOwnerEmail: string | null;
  automationSource: SignalAutomationSource;
}, reminderNumber: number) {
  const sourceLabel = buildSignalAutomationRunLabel(run);
  const ownerSuffix = run.sharedOwnerEmail ? ` Queue owner: ${run.sharedOwnerEmail}.` : "";

  return `SLA follow-up #${reminderNumber}: после "${sourceLabel}" сигнал всё ещё ждёт реакции.${ownerSuffix} Нужен апдейт по статусу или явное решение в timeline.`;
}

export function buildSignalSlaFollowUpEscalationNoteBody(run: {
  triggerLabel: string | null;
  savedViewName: string | null;
  sharedOwnerEmail: string | null;
  automationSource: SignalAutomationSource;
}, alertNumber: number, awaitingOutcomeHours: number) {
  const sourceLabel = buildSignalAutomationRunLabel(run);
  const ownerSuffix = run.sharedOwnerEmail ? ` Queue owner: ${run.sharedOwnerEmail}.` : "";

  return `SLA escalation #${alertNumber}: после "${sourceLabel}" follow-up уже ${awaitingOutcomeHours}ч без явного outcome.${ownerSuffix} Нужен acknowledged / action taken / no action либо обновление workflow.`;
}

export function createEmptyEscalationOutcomeCounts(): Record<SignalEscalationOutcome, number> {
  return {
    pending: 0,
    progressed: 0,
    resolved: 0,
    ignored: 0,
  };
}

export function createEmptyFollowUpResolutionCounts(): Record<SignalFollowUpResolution, number> {
  return {
    acknowledged: 0,
    action_taken: 0,
    no_action: 0,
  };
}

export function createSignalAutomationFollowUpWave(params: {
  batchId: string;
  automationSource: string | null | undefined;
  actorEmail: string;
  createdAt: string | Date;
}): SignalAutomationFollowUpWave {
  return {
    batchId: params.batchId,
    automationSource: resolveSignalAutomationSource(params.automationSource),
    actorEmail: params.actorEmail,
    createdAt: params.createdAt,
    targetCount: 0,
    outcomeCounts: createEmptyEscalationOutcomeCounts(),
    resolutionCounts: createEmptyFollowUpResolutionCounts(),
    awaitingExplicitOutcomeCount: 0,
    escalationAlertCount: 0,
    lastEscalationAlertAt: null,
    latestResolutionAt: null,
  };
}

export function getSignalFollowUpResolutionLabel(resolution: SignalFollowUpResolution) {
  switch (resolution) {
    case "action_taken":
      return "Действие выполнено";
    case "no_action":
      return "Без действия";
    default:
      return "Подтверждено";
  }
}

export function buildSignalFollowUpResolutionNoteBody({
  run,
  resolution,
}: {
  run: {
    triggerLabel: string | null;
    savedViewName: string | null;
    automationSource: SignalAutomationSource;
  };
  resolution: SignalFollowUpResolution;
}) {
  const sourceLabel = buildSignalAutomationRunLabel(run);

  switch (resolution) {
    case "action_taken":
      return `Follow-up outcome: по сигналу после "${sourceLabel}" зафиксировано действие со стороны оператора.`;
    case "no_action":
      return `Follow-up outcome: по сигналу после "${sourceLabel}" зафиксировано решение без дальнейших действий.`;
    default:
      return `Follow-up outcome: по сигналу после "${sourceLabel}" подтверждено получение напоминания.`;
  }
}

export function resolveAppliedPresets(value: unknown): Array<{ presetId: string; count: number }> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return null;
      }

      const candidate = item as Record<string, unknown>;
      const presetId = typeof candidate.presetId === "string" ? candidate.presetId : null;
      const count = typeof candidate.count === "number" ? candidate.count : Number(candidate.count ?? 0);
      if (!presetId || !Number.isFinite(count)) {
        return null;
      }

      return {
        presetId,
        count,
      };
    })
    .filter((item): item is { presetId: string; count: number } => Boolean(item));
}

export function resolveSignalAutomationSuppressionStatus({
  suppressUntil,
  clearedAt,
}: {
  suppressUntil: string | Date | null | undefined;
  clearedAt: string | Date | null | undefined;
}): SignalAutomationSuppressionStatus {
  if (clearedAt) {
    return "cleared";
  }

  if (suppressUntil && new Date(suppressUntil).getTime() <= Date.now()) {
    return "expired";
  }

  return "active";
}

export function isActiveSignalAutomationSuppression(suppression: Pick<SignalAutomationSuppression, "status">) {
  return suppression.status === "active";
}

export function buildSignalCollaborationSummary({
  actorEmail,
  eventType,
  eventPayload,
}: {
  actorEmail: string;
  eventType: SignalTimelineEventType;
  eventPayload: Record<string, unknown>;
}) {
  if (eventType === "note") {
    if (eventPayload.automation === "sla") {
      return `${actorEmail} запустил SLA-эскалацию`;
    }

    if (eventPayload.automation === "sla_follow_up") {
      return `${actorEmail} отправил SLA follow-up`;
    }

    if (eventPayload.automation === "sla_follow_up_escalation") {
      return `${actorEmail} отправил SLA escalation alert`;
    }

    if (eventPayload.automation === "sla_follow_up_resolution") {
      const resolution = resolveSignalFollowUpResolution(
        typeof eventPayload.resolution === "string" ? eventPayload.resolution : null,
      );

      return `${actorEmail} отметил follow-up как ${getSignalFollowUpResolutionLabel(resolution ?? "acknowledged").toLowerCase()}`;
    }

    return `${actorEmail} оставил комментарий`;
  }

  if (eventType === "assignment") {
    const assigneeEmail = typeof eventPayload.assigneeEmail === "string" ? eventPayload.assigneeEmail : null;
    const previousAssigneeEmail = typeof eventPayload.previousAssigneeEmail === "string" ? eventPayload.previousAssigneeEmail : null;

    if (assigneeEmail && previousAssigneeEmail && assigneeEmail !== previousAssigneeEmail) {
      return `${actorEmail} переназначил сигнал на ${assigneeEmail}`;
    }

    if (assigneeEmail) {
      return `${actorEmail} назначил сигнал на ${assigneeEmail}`;
    }

    return `${actorEmail} снял ответственного`;
  }

  if (eventType === "workflow_state") {
    const workflowState = resolveSignalWorkflowState(
      typeof eventPayload.workflowState === "string" ? eventPayload.workflowState : null
    );

    if (workflowState === "blocked") {
      return `${actorEmail} пометил сигнал как блокер`;
    }

    return `${actorEmail} обновил статус разбора`;
  }

  return `${actorEmail} открыл сигнал`;
}

export function formatSignalQueueAge(hours: number) {
  if (hours < 1) {
    return "<1ч";
  }

  const roundedHours = Math.round(hours);
  if (roundedHours < 24) {
    return `${roundedHours}ч`;
  }

  const days = Math.floor(roundedHours / 24);
  const dayHours = roundedHours % 24;

  return dayHours > 0 ? `${days}д ${dayHours}ч` : `${days}д`;
}

export function getSignalSlaPolicy(workflowState: SignalWorkflowState) {
  switch (workflowState) {
    case "blocked":
      return {
        warnHours: 4,
        targetHours: 12,
        healthyLabel: "Blocked под контролем",
        warningLabel: "Blocked близко к overdue",
        overdueLabel: "Blocked overdue",
      };
    case "handoff":
      return {
        warnHours: 12,
        targetHours: 24,
        healthyLabel: "Handoff в SLA",
        warningLabel: "Handoff близко к overdue",
        overdueLabel: "Handoff overdue",
      };
    case "in_progress":
      return {
        warnHours: 24,
        targetHours: 48,
        healthyLabel: "В работе",
        warningLabel: "В работе дольше нормы",
        overdueLabel: "Разбор overdue",
      };
    default:
      return {
        warnHours: 12,
        targetHours: 24,
        healthyLabel: "Новый сигнал",
        warningLabel: "Новый сигнал стареет",
        overdueLabel: "Новый сигнал overdue",
      };
  }
}

export function buildSignalAgingSummary({
  createdAt,
  workflowUpdatedAt,
  workflowState,
}: {
  createdAt: Date | string | null | undefined;
  workflowUpdatedAt: Date | string | null | undefined;
  workflowState: SignalWorkflowState;
}): SignalAgingSummary {
  const queueEnteredAt = workflowUpdatedAt ?? createdAt ?? null;
  const queueEnteredTime = queueEnteredAt ? new Date(queueEnteredAt).getTime() : Date.now();
  const queueAgeHours = Math.max(0, (Date.now() - queueEnteredTime) / (1000 * 60 * 60));
  const policy = getSignalSlaPolicy(workflowState);
  const queueAgeLabel = formatSignalQueueAge(queueAgeHours);

  if (queueAgeHours >= policy.targetHours) {
    return {
      queueEnteredAt,
      queueAgeHours,
      queueAgeLabel,
      slaTargetHours: policy.targetHours,
      slaWarnHours: policy.warnHours,
      slaState: "overdue",
      slaLabel: `${policy.overdueLabel} • ${queueAgeLabel}`,
    };
  }

  if (queueAgeHours >= policy.warnHours) {
    return {
      queueEnteredAt,
      queueAgeHours,
      queueAgeLabel,
      slaTargetHours: policy.targetHours,
      slaWarnHours: policy.warnHours,
      slaState: "warning",
      slaLabel: `${policy.warningLabel} • ${queueAgeLabel}`,
    };
  }

  return {
    queueEnteredAt,
    queueAgeHours,
    queueAgeLabel,
    slaTargetHours: policy.targetHours,
    slaWarnHours: policy.warnHours,
    slaState: "healthy",
    slaLabel: `${policy.healthyLabel} • ${queueAgeLabel}`,
  };
}

export function buildFocusedHref({
  path,
  nmId,
  signalType,
  signalTitle,
  signalId,
  focusTab,
}: {
  path: string;
  nmId?: number | null;
  signalType: string;
  signalTitle: string;
  signalId?: string;
  focusTab?: string;
}) {
  const params = new URLSearchParams();
  if (nmId) {
    params.set("focusNmId", String(nmId));
  }
  if (signalId) {
    params.set("signalId", signalId);
  }
  params.set("focusSignalType", normalizeSignalType(signalType));
  params.set("focusTitle", signalTitle);
  if (focusTab) {
    params.set("focusTab", focusTab);
  }

  return `${path}?${params.toString()}`;
}

export function buildSignalFixAction({
  type,
  nmId,
  signalTitle,
  signalId,
}: {
  type: string;
  nmId?: number | null;
  signalTitle: string;
  signalId: string;
}): SignalFixAction {
  const normalizedType = normalizeSignalType(type);

  if (normalizedType === "ads_leak") {
    return {
      label: "Проверить рекламу",
      href: buildFocusedHref({
        path: "/explorer",
        nmId,
        signalType: normalizedType,
        signalTitle,
        signalId,
        focusTab: "ads",
      }),
    };
  }

  if (normalizedType === "content_risk" || normalizedType === "seo_risk" || normalizedType === "conversion_drop") {
    return {
      label: normalizedType === "seo_risk" ? "Проверить SEO" : "Проверить карточку",
      href: buildFocusedHref({
        path: "/explorer",
        nmId,
        signalType: normalizedType,
        signalTitle,
        signalId,
        focusTab: "funnel",
      }),
    };
  }

  if (normalizedType === "stock_out") {
    return {
      label: "Проверить остатки",
      href: buildFocusedHref({
        path: "/explorer",
        nmId,
        signalType: normalizedType,
        signalTitle,
        signalId,
        focusTab: "orders",
      }),
    };
  }

  return {
    label: "Исправить экономику",
    href: buildFocusedHref({
      path: "/economics-v2",
      nmId,
      signalType: normalizedType,
      signalTitle,
      signalId,
    }),
  };
}
