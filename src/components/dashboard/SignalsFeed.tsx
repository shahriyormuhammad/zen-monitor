'use client';

import { useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BellRing,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  EyeOff,
  Filter,
  Info,
  Loader2,
  Pin,
  Star,
  Zap,
} from 'lucide-react';
import { useStore } from '@/store/useStore';
import {
  bulkAddSignalNoteAction,
  bulkAssignSignalOwner,
  bulkApplySignalHandoffPresetAction,
  captureSignalFollowUpResolutionAction,
  bulkUpdateSignalStatusAction,
  bulkUpdateSignalWorkflowStateAction,
  deleteSignalSavedViewAction,
  previewSignalSlaAutomationAction,
  resolveSignal,
  ignoreSignal,
  moveSignalSavedViewAction,
  runSignalSlaAutomationAction,
  runSignalSlaFollowUpAction,
  saveSignalSavedViewAction,
  setDefaultSignalSavedViewAction,
  toggleSignalAutomationSuppressionAction,
  togglePinSignalSavedViewAction,
  updateSignalSavedViewAction,
} from '@/app/(dashboard)/overview/actions';
import type {
  SignalAutomationControlEvent,
  SignalAutomationDryRunPreview,
  SignalAutomationRunDetail,
  SignalAutomationRun,
  SignalFeedResponse,
  SignalListItem,
  SignalAutomationSuppression,
  SignalAutomationSuppressionTarget,
  SignalFollowUpResolution,
  SignalQueueView,
  SignalQueueOwnerSummary,
  SignalSavedViewScope,
  SignalSavedView,
  SignalEscalationOutcome,
  SignalSortPreset,
  SignalSlaState,
  SignalWorkflowState,
} from '@/lib/operator-signal-timeline';
import { resolveSignalQueueView, resolveSignalReviewSource, resolveSignalSortPreset } from '@/lib/operator-signal-timeline';
import { buildSignalAssigneeRoleMap, buildSignalQueueOwnerSummaries, buildSignalQueueRebalanceSuggestion, getDefaultSortPresetForQueueView, getSignalEscalationPreset, matchesSignalQueueView, matchesSignalSlaQueuePreset, sortSignals } from '@/lib/signal-queue-utils';
import { SIGNAL_HANDOFF_PRESETS, SIGNAL_NOTE_TEMPLATES, SIGNAL_SLA_QUEUE_PRESETS } from '@/lib/signal-workflow-config';
import { cn } from '@/lib/utils';
import { getWbPhotoUrl } from '@/lib/wb-api/wb-photos';
import { OperatorState } from './OperatorState';
import { SignalDetailsPanel, type SignalDetail } from './SignalDetailsPanel';

function getReturnChipLabel(source: ReturnType<typeof resolveSignalReviewSource>) {
  switch (source) {
    case 'economics':
      return 'Возврат из экономики';
    case 'explorer':
      return 'Возврат из проводника';
    default:
      return 'Возврат к сигналу';
  }
}

function getWorkflowStateLabel(state: SignalWorkflowState) {
  switch (state) {
    case 'in_progress':
      return 'В работе';
    case 'handoff':
      return 'Передан';
    case 'blocked':
      return 'Блокер';
    default:
      return 'Новый';
  }
}

function getWorkflowStateClass(state: SignalWorkflowState) {
  switch (state) {
    case 'in_progress':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-900/20 dark:text-emerald-300';
    case 'handoff':
      return 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800/40 dark:bg-blue-900/20 dark:text-blue-300';
    case 'blocked':
      return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800/40 dark:bg-rose-900/20 dark:text-rose-300';
    default:
      return 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400';
  }
}

function getAssigneeLabel(email: string | null | undefined, userId: string | null | undefined) {
  if (email) {
    return email;
  }

  if (userId) {
    return `user:${userId.slice(0, 8)}`;
  }

  return 'Без ответственного';
}

function matchesQueueOwnerFilter(ownerUserId: string | null | undefined, filter: string) {
  if (filter === 'all') {
    return true;
  }

  if (filter === 'unassigned') {
    return !ownerUserId;
  }

  return ownerUserId === filter;
}

function getSavedViewDefaultLabel(view: SignalSavedView) {
  if (!view.isTeamDefault) {
    return view.isDefault ? 'My default' : null;
  }

  return view.sharedOwnerUserId ? 'Owner default' : 'Team default';
}

function getSavedViewOwnerFilterValue(view: Pick<SignalSavedView, 'scope' | 'sharedOwnerUserId'>) {
  if (view.scope !== 'team') {
    return null;
  }

  return view.sharedOwnerUserId ?? 'unassigned';
}

function getSlaStateClass(slaState: SignalSlaState) {
  switch (slaState) {
    case 'overdue':
      return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800/40 dark:bg-rose-900/20 dark:text-rose-300';
    case 'warning':
      return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-300';
    default:
      return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-900/20 dark:text-emerald-300';
  }
}

function getSlaCardClass(slaState: SignalSlaState) {
  switch (slaState) {
    case 'overdue':
      return 'ring-2 ring-rose-200 ring-offset-2 ring-offset-slate-50';
    case 'warning':
      return 'ring-1 ring-amber-200 ring-offset-2 ring-offset-slate-50';
    default:
      return '';
  }
}

function formatRunDateTime(value: string | Date) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function getEscalationOutcomeClass(outcome: SignalEscalationOutcome) {
  switch (outcome) {
    case 'resolved':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-900/20 dark:text-emerald-300';
    case 'ignored':
      return 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-700 dark:text-slate-400';
    case 'progressed':
      return 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800/40 dark:bg-blue-900/20 dark:text-blue-300';
    default:
      return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-300';
  }
}

function getEscalationOutcomeText(outcome: SignalEscalationOutcome) {
  switch (outcome) {
    case 'resolved':
      return 'Resolved';
    case 'ignored':
      return 'Ignored';
    case 'progressed':
      return 'Progressed';
    default:
      return 'Pending';
  }
}

function getFollowUpResolutionText(resolution: SignalFollowUpResolution) {
  switch (resolution) {
    case 'action_taken':
      return 'Action taken';
    case 'no_action':
      return 'No action';
    default:
      return 'Acknowledged';
  }
}

function getFollowUpResolutionClass(resolution: SignalFollowUpResolution) {
  switch (resolution) {
    case 'action_taken':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-900/20 dark:text-emerald-300';
    case 'no_action':
      return 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-700 dark:text-slate-400';
    default:
      return 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800/40 dark:bg-blue-900/20 dark:text-blue-300';
  }
}

function getSuppressionLabel(suppression: SignalAutomationSuppression) {
  if (suppression.targetType === 'saved_view') {
    return suppression.savedViewName ? `View: ${suppression.savedViewName}` : 'Saved view';
  }

  return suppression.sharedOwnerEmail ? `Owner: ${suppression.sharedOwnerEmail}` : 'Queue owner';
}

function getSuppressionStatusText(suppression: SignalAutomationSuppression) {
  switch (suppression.status) {
    case 'cleared':
      return 'Cleared';
    case 'expired':
      return 'Expired';
    default:
      return 'Active';
  }
}

function getSuppressionStatusClass(suppression: SignalAutomationSuppression) {
  switch (suppression.status) {
    case 'cleared':
      return 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400';
    case 'expired':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300';
    default:
      return 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300';
  }
}

function formatSuppressionUntil(value: string | Date | null) {
  if (!value) {
    return 'До ручного снятия';
  }

  return formatRunDateTime(value);
}

function getAutomationControlEventText(event: SignalAutomationControlEvent) {
  return event.eventType === 'preview' ? 'Preview' : 'Execute';
}

function getAutomationControlEventClass(event: SignalAutomationControlEvent) {
  if (event.status === 'failed') {
    return 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300';
  }

  return event.eventType === 'preview'
    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
    : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300';
}

function buildSlaAutomationContextKey(payload: {
  signalIds: string[];
  queuePresetId?: string | null;
  triggerLabel?: string | null;
  savedViewId?: string | null;
  sharedOwnerUserId?: string | null;
}) {
  return [
    payload.savedViewId ?? 'no-view',
    payload.sharedOwnerUserId ?? 'no-owner',
    payload.queuePresetId ?? 'no-preset',
    payload.triggerLabel ?? 'no-label',
    [...payload.signalIds].sort().join(','),
  ].join('|');
}

function resolveSuppressionUntilIso(windowPreset: string) {
  const hours = windowPreset === '4h'
    ? 4
    : windowPreset === '24h'
      ? 24
      : windowPreset === '72h'
        ? 72
        : null;

  if (!hours) {
    return null;
  }

  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

const SIGNAL_QUEUE_VIEWS: Array<{
  id: SignalQueueView;
  label: string;
  description: string;
}> = [
  {
    id: 'all',
    label: 'Все активные',
    description: 'Полный active feed без операторской сегментации.',
  },
  {
    id: 'needs_action',
    label: 'Needs action',
    description: 'Новые, в работе и handoff не на owner/admin.',
  },
  {
    id: 'blocked',
    label: 'Blocked',
    description: 'Сигналы, которые упёрлись во внешний блокер.',
  },
  {
    id: 'awaiting_owner',
    label: 'Awaiting owner',
    description: 'Handoff на owner/admin для решения или апрува.',
  },
  {
    id: 'overdue_only',
    label: 'Overdue only',
    description: 'Только сигналы, которые уже вышли за свой SLA.',
  },
];

const SIGNAL_SORT_PRESETS: Array<{
  id: SignalSortPreset;
  label: string;
  description: string;
}> = [
  {
    id: 'severity',
    label: 'Severity + SLA',
    description: 'Сначала critical/high, затем SLA и возраст очереди.',
  },
  {
    id: 'sla_pressure',
    label: 'SLA pressure',
    description: 'Сначала overdue/warning, затем тяжесть сигнала.',
  },
  {
    id: 'newest',
    label: 'Newest touched',
    description: 'Сначала недавно обновлённые workflow/свежие сигналы.',
  },
];

type SignalsFeedProps = {
  surface?: 'simple' | 'full';
};

export function SignalsFeed({ surface = 'full' }: SignalsFeedProps) {
  const isSimpleSurface = surface === 'simple';
  const { tenantId } = useStore();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const returnSignalId = searchParams.get('signalId');
  const returnSource = resolveSignalReviewSource(searchParams.get('signalReturnFrom'));
  const ownerQueueRouteFilter = searchParams.get('ownerQueue');
  const ownerQueueRouteView = resolveSignalQueueView(searchParams.get('ownerQueueView'));
  const ownerQueueRouteSort = resolveSignalSortPreset(searchParams.get('ownerQueueSort'));
  const [manualSelectedSignalId, setManualSelectedSignalId] = useState<string | null>(null);
  const [manualQueueView, setManualQueueView] = useState<SignalQueueView | null>(null);
  const [manualAssigneeFilter, setManualAssigneeFilter] = useState<string | null>(null);
  const [manualWorkflowFilter, setManualWorkflowFilter] = useState<'all' | SignalWorkflowState | null>(null);
  const [manualSortPreset, setManualSortPreset] = useState<SignalSortPreset | null>(null);
  const [manualQueueOwnerFilter, setManualQueueOwnerFilter] = useState<string | null>(null);
  const [manualSavedViewScope, setManualSavedViewScope] = useState<SignalSavedViewScope | null>(null);
  const [manualSharedOwnerUserId, setManualSharedOwnerUserId] = useState<string | null>(null);
  const [savedViewNameDraft, setSavedViewNameDraft] = useState('');
  const [expandedAutomationRunId, setExpandedAutomationRunId] = useState<string | null>(null);
  const [latestDryRunPreview, setLatestDryRunPreview] = useState<SignalAutomationDryRunPreview | null>(null);
  const [latestDryRunContextKey, setLatestDryRunContextKey] = useState<string | null>(null);
  const [suppressionReasonDraft, setSuppressionReasonDraft] = useState('');
  const [suppressionWindowDraft, setSuppressionWindowDraft] = useState<'manual' | '4h' | '24h' | '72h'>('24h');
  const [automationHealthNow] = useState(() => Date.now());
  const [selectedSignalIds, setSelectedSignalIds] = useState<string[]>([]);
  const [bulkAssigneeDraft, setBulkAssigneeDraft] = useState<string>('');
  const [bulkWorkflowDraft, setBulkWorkflowDraft] = useState<SignalWorkflowState>('handoff');
  const [bulkNoteDraft, setBulkNoteDraft] = useState('');
  const selectedSignalId = returnSignalId ?? manualSelectedSignalId;
  const queryClient = useQueryClient();

  const { data: signalFeed, isLoading, error, refetch } = useQuery<SignalFeedResponse, Error>({
    queryKey: ['signals', tenantId],
    queryFn: async () => {
      if (!tenantId) {
        return {
          signals: [],
          availableAssignees: [],
          savedViews: [],
          automationRuns: [],
          automationSuppressions: [],
          automationControlEvents: [],
        };
      }

      const res = await fetch(`/api/views/dashboard/signals`);
      if (!res.ok) {
        return {
          signals: [],
          availableAssignees: [],
          savedViews: [],
          automationRuns: [],
          automationSuppressions: [],
          automationControlEvents: [],
        };
      }

      return res.json();
    },
    enabled: !!tenantId,
  });

  const availableAssignees = useMemo(
    () => signalFeed?.availableAssignees ?? [],
    [signalFeed?.availableAssignees],
  );
  const savedViews = useMemo(
    () => signalFeed?.savedViews ?? [],
    [signalFeed?.savedViews],
  );
  const automationRuns = useMemo(
    () => signalFeed?.automationRuns ?? [],
    [signalFeed?.automationRuns],
  );
  const automationSuppressions = useMemo(
    () => signalFeed?.automationSuppressions ?? [],
    [signalFeed?.automationSuppressions],
  );
  const activeAutomationSuppressions = useMemo(
    () => automationSuppressions.filter((suppression) => suppression.status === 'active'),
    [automationSuppressions],
  );
  const automationControlEvents = useMemo(
    () => signalFeed?.automationControlEvents ?? [],
    [signalFeed?.automationControlEvents],
  );
  const assigneeRoleById = useMemo(
    () => buildSignalAssigneeRoleMap(availableAssignees),
    [availableAssignees],
  );
  const personalDefaultSavedView = savedViews.find((view) => view.isDefault) ?? null;
  const ownerQueueRouteActive = Boolean(ownerQueueRouteFilter && ownerQueueRouteView);
  const ownerLaneDefaultSavedView = !ownerQueueRouteActive && manualQueueOwnerFilter && manualQueueOwnerFilter !== 'all'
    ? savedViews.find((view) =>
      view.isTeamDefault
        && (view.sharedOwnerUserId ?? 'unassigned') === manualQueueOwnerFilter
    ) ?? null
    : null;
  const teamDefaultSavedView = savedViews.find((view) => view.isTeamDefault && !view.sharedOwnerUserId) ?? null;
  const effectiveDefaultSavedView = personalDefaultSavedView ?? ownerLaneDefaultSavedView ?? teamDefaultSavedView ?? null;
  const resolvedOwnerQueueRouteView = ownerQueueRouteView ?? 'all';
  const queueOwnerFilter = ownerQueueRouteActive
    ? (ownerQueueRouteFilter === 'all' ? 'all' : (ownerQueueRouteFilter ?? 'all'))
    : (
      manualQueueOwnerFilter
      ?? (
        effectiveDefaultSavedView?.scope === 'team' && effectiveDefaultSavedView.sharedOwnerUserId
          ? effectiveDefaultSavedView.sharedOwnerUserId
          : 'all'
      )
    );
  const queueView = ownerQueueRouteActive
    ? resolvedOwnerQueueRouteView
    : (manualQueueView ?? effectiveDefaultSavedView?.queueView ?? 'all');
  const assigneeFilter = ownerQueueRouteActive
    ? 'all'
    : (manualAssigneeFilter ?? effectiveDefaultSavedView?.assigneeFilter ?? 'all');
  const workflowFilter = ownerQueueRouteActive
    ? 'all'
    : (manualWorkflowFilter ?? effectiveDefaultSavedView?.workflowFilter ?? 'all');
  const sortPreset = ownerQueueRouteActive
    ? (ownerQueueRouteSort ?? getDefaultSortPresetForQueueView(resolvedOwnerQueueRouteView))
    : (manualSortPreset ?? effectiveDefaultSavedView?.sortPreset ?? 'severity');
  const sortedSignals = useMemo(
    () => sortSignals(signalFeed?.signals ?? [], sortPreset),
    [signalFeed?.signals, sortPreset],
  );
  const ownerScopedSignals = useMemo(
    () => sortedSignals.filter((signal) => matchesQueueOwnerFilter(signal.assigneeUserId, queueOwnerFilter)),
    [queueOwnerFilter, sortedSignals],
  );

  const filteredSignals = ownerScopedSignals.filter((signal) => {
    const matchesQueue = matchesSignalQueueView(signal, queueView, assigneeRoleById);
    const matchesAssignee =
      assigneeFilter === 'all'
        ? true
        : assigneeFilter === 'unassigned'
          ? !signal.assigneeUserId
          : signal.assigneeUserId === assigneeFilter;

    const matchesWorkflow = workflowFilter === 'all' ? true : signal.workflowState === workflowFilter;

    return matchesQueue && matchesAssignee && matchesWorkflow;
  });

  const workflowCounts = useMemo(() => {
    return ownerScopedSignals.reduce<Record<SignalWorkflowState, number>>((acc, signal) => {
      acc[signal.workflowState] += 1;
      return acc;
    }, {
      new: 0,
      in_progress: 0,
      handoff: 0,
      blocked: 0,
    });
  }, [ownerScopedSignals]);
  const queueCounts = useMemo(() => {
    return {
      all: ownerScopedSignals.length,
      needs_action: ownerScopedSignals.filter((signal) => matchesSignalQueueView(signal, 'needs_action', assigneeRoleById)).length,
      blocked: ownerScopedSignals.filter((signal) => matchesSignalQueueView(signal, 'blocked', assigneeRoleById)).length,
      awaiting_owner: ownerScopedSignals.filter((signal) => matchesSignalQueueView(signal, 'awaiting_owner', assigneeRoleById)).length,
      overdue_only: ownerScopedSignals.filter((signal) => matchesSignalQueueView(signal, 'overdue_only', assigneeRoleById)).length,
    } satisfies Record<SignalQueueView, number>;
  }, [assigneeRoleById, ownerScopedSignals]);
  const privateSavedViews = useMemo(
    () => savedViews.filter((view) => view.scope === 'private'),
    [savedViews],
  );
  const teamSavedViews = useMemo(
    () => savedViews.filter((view) => view.scope === 'team'),
    [savedViews],
  );
  const queueOwnerOptions = useMemo(() => {
    const owners = new Map<string, { userId: string | null; email: string | null }>();

    availableAssignees.forEach((member) => {
      owners.set(member.userId, {
        userId: member.userId,
        email: member.email ?? null,
      });
    });

    teamSavedViews.forEach((view) => {
      if (!view.sharedOwnerUserId) {
        return;
      }

      owners.set(view.sharedOwnerUserId, {
        userId: view.sharedOwnerUserId,
        email: view.sharedOwnerEmail ?? null,
      });
    });

    automationRuns.forEach((run) => {
      if (!run.sharedOwnerUserId) {
        return;
      }

      owners.set(run.sharedOwnerUserId, {
        userId: run.sharedOwnerUserId,
        email: run.sharedOwnerEmail ?? null,
      });
    });

    return Array.from(owners.values()).sort((left, right) =>
      getAssigneeLabel(left.email, left.userId).localeCompare(getAssigneeLabel(right.email, right.userId), 'ru-RU'),
    );
  }, [automationRuns, availableAssignees, teamSavedViews]);
  const filteredTeamSavedViews = useMemo(
    () => teamSavedViews.filter((view) => matchesQueueOwnerFilter(view.sharedOwnerUserId, queueOwnerFilter)),
    [queueOwnerFilter, teamSavedViews],
  );
  const filteredAutomationRuns = useMemo(
    () => automationRuns.filter((run) => matchesQueueOwnerFilter(run.sharedOwnerUserId, queueOwnerFilter)),
    [automationRuns, queueOwnerFilter],
  );
  const filteredAutomationControlEvents = useMemo(
    () => automationControlEvents.filter((event) => matchesQueueOwnerFilter(event.sharedOwnerUserId, queueOwnerFilter)),
    [automationControlEvents, queueOwnerFilter],
  );
  const filteredAutomationSuppressions = useMemo(
    () => automationSuppressions.filter((suppression) => matchesQueueOwnerFilter(suppression.sharedOwnerUserId, queueOwnerFilter)),
    [automationSuppressions, queueOwnerFilter],
  );
  const automationControlEventById = useMemo(
    () => new Map(automationControlEvents.map((event) => [event.id, event])),
    [automationControlEvents],
  );
  const automationHealth = useMemo(() => {
    const recentWindowMs = 48 * 60 * 60 * 1000;
    const recentRuns = automationRuns.filter((run) => automationHealthNow - new Date(run.createdAt).getTime() <= recentWindowMs);
    const recentControlEvents = automationControlEvents.filter((event) => automationHealthNow - new Date(event.createdAt).getTime() <= recentWindowMs);
    const latestRunAt = automationRuns[0]?.createdAt ?? null;
    const latestSuccessfulRunAt = automationRuns.find((run) => run.status === 'completed')?.createdAt ?? null;
    const latestFailedRunAt = automationRuns.find((run) => run.status === 'failed')?.createdAt ?? null;
    const latestFollowUpAt = automationRuns
      .map((run) => run.lastFollowUpAt)
      .filter((value): value is string | Date => Boolean(value))
      .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ?? null;
    const latestEscalationAlertAt = automationRuns
      .map((run) => run.lastEscalationAlertAt)
      .filter((value): value is string | Date => Boolean(value))
      .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ?? null;

    return {
      recentRunsCount: recentRuns.length,
      recentFailedRunsCount: recentRuns.filter((run) => run.status === 'failed').length,
      recentScheduledRunsCount: recentRuns.filter((run) => run.automationSource === 'scheduled').length,
      recentPendingRunsCount: recentRuns.filter((run) => run.outcomeCounts.pending > 0).length,
      recentAwaitingOutcomeRunsCount: recentRuns.filter((run) => run.awaitingExplicitOutcomeCount > 0).length,
      recentEscalatedRunsCount: recentRuns.filter((run) => run.escalationAlertCount > 0).length,
      recentEscalationAlertsCount: recentRuns.reduce((sum, run) => sum + run.escalationAlertCount, 0),
      recentPreviewsCount: recentControlEvents.filter((event) => event.eventType === 'preview').length,
      recentManualExecutionsCount: recentControlEvents.filter((event) => event.eventType === 'execute').length,
      latestRunAt,
      latestSuccessfulRunAt,
      latestFailedRunAt,
      latestFollowUpAt,
      latestEscalationAlertAt,
      activeSuppressionsCount: activeAutomationSuppressions.length,
      suppressedSavedViewsCount: activeAutomationSuppressions.filter((suppression) => suppression.targetType === 'saved_view').length,
      suppressedQueueOwnersCount: activeAutomationSuppressions.filter((suppression) => suppression.targetType === 'queue_owner').length,
    };
  }, [activeAutomationSuppressions, automationControlEvents, automationHealthNow, automationRuns]);
  const pinnedSavedViews = useMemo(
    () => savedViews.filter((view) => view.isPinned),
    [savedViews],
  );
  const filteredPinnedSavedViews = useMemo(
    () => pinnedSavedViews.filter((view) => view.scope !== 'team' || matchesQueueOwnerFilter(view.sharedOwnerUserId, queueOwnerFilter)),
    [pinnedSavedViews, queueOwnerFilter],
  );
  const queueOwnerSummaries = useMemo<SignalQueueOwnerSummary[]>(
    () => buildSignalQueueOwnerSummaries({
      signals: sortedSignals,
      savedViews: teamSavedViews,
      automationRuns,
      assignees: availableAssignees,
    }),
    [automationRuns, availableAssignees, sortedSignals, teamSavedViews],
  );
  const ownerRebalanceSuggestions = useMemo(
    () => Object.fromEntries(
      queueOwnerSummaries
        .filter((summary) => Boolean(summary.ownerUserId))
        .map((summary) => [
          summary.key,
          buildSignalQueueRebalanceSuggestion({
            targetOwnerUserId: summary.ownerUserId,
            signals: sortedSignals,
            ownerSummaries: queueOwnerSummaries,
            assigneeRoleById,
          }),
        ]),
    ) as Record<string, ReturnType<typeof buildSignalQueueRebalanceSuggestion>>,
    [assigneeRoleById, queueOwnerSummaries, sortedSignals],
  );
  const getSavedViewSuppression = (savedViewId: string | null | undefined) => activeAutomationSuppressions.find((suppression) =>
    suppression.targetType === 'saved_view' && suppression.savedViewId === savedViewId
  ) ?? null;
  const getQueueOwnerSuppression = (sharedOwnerUserId: string | null | undefined) => activeAutomationSuppressions.find((suppression) =>
    suppression.targetType === 'queue_owner' && suppression.sharedOwnerUserId === sharedOwnerUserId
  ) ?? null;
  const groupedTeamSavedViews = useMemo(() => {
    const groups = new Map<string, { key: string; label: string; views: SignalSavedView[] }>();

    filteredTeamSavedViews.forEach((view) => {
      const key = view.sharedOwnerUserId ?? 'unassigned';
      const group = groups.get(key) ?? {
        key,
        label: getAssigneeLabel(view.sharedOwnerEmail, view.sharedOwnerUserId),
        views: [],
      };
      group.views.push(view);
      groups.set(key, group);
    });

    return Array.from(groups.values()).sort((left, right) => left.label.localeCompare(right.label, 'ru-RU'));
  }, [filteredTeamSavedViews]);
  const slaQueuePresetCounts = useMemo(
    () => Object.fromEntries(
      SIGNAL_SLA_QUEUE_PRESETS.map((preset) => ([
        preset.id,
        ownerScopedSignals.filter((signal) => matchesSignalSlaQueuePreset(signal, preset, assigneeRoleById)).length,
      ])),
    ) as Record<(typeof SIGNAL_SLA_QUEUE_PRESETS)[number]['id'], number>,
    [assigneeRoleById, ownerScopedSignals],
  );
  const selectedVisibleSignalIds = filteredSignals
    .filter((signal) => selectedSignalIds.includes(signal.id))
    .map((signal) => signal.id);

  const selectedSignalOpenedFrom =
    returnSignalId === selectedSignalId && returnSource ? returnSource : 'overview';

  function clearReturnSignalContext() {
    if (!returnSignalId && !returnSource) {
      return;
    }

    const params = new URLSearchParams(searchParams.toString());
    params.delete('signalId');
    params.delete('signalReturnFrom');

    const nextQuery = params.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  }

  function clearOwnerQueueRoutePreset() {
    if (!ownerQueueRouteFilter && !ownerQueueRouteView && !ownerQueueRouteSort) {
      return;
    }

    const params = new URLSearchParams(searchParams.toString());
    params.delete('ownerQueue');
    params.delete('ownerQueueView');
    params.delete('ownerQueueSort');

    const nextQuery = params.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  }

  function openSignal(signalId: string) {
    if (returnSignalId && signalId !== returnSignalId) {
      clearReturnSignalContext();
    }

    setManualSelectedSignalId(signalId);
  }

  function closeSignalDetails() {
    setManualSelectedSignalId(null);
    clearReturnSignalContext();
  }

  function toggleSignalSelection(signalId: string) {
    setSelectedSignalIds((current) =>
      current.includes(signalId) ? current.filter((id) => id !== signalId) : [...current, signalId]
    );
  }

  function clearBulkSelection() {
    setSelectedSignalIds([]);
  }

  const signalDetailsQuery = useQuery<SignalDetail | null, Error>({
    queryKey: ['signal-detail', tenantId, selectedSignalId, selectedSignalOpenedFrom],
    queryFn: async () => {
      if (!tenantId || !selectedSignalId) {
        return null;
      }

      const url = new URL(`/api/views/dashboard/signals/${selectedSignalId}`, window.location.origin);
      url.searchParams.set('openedFrom', selectedSignalOpenedFrom);

      const res = await fetch(url.toString());
      const payload = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(payload?.error ?? 'Не удалось загрузить детали сигнала');
      }

      return payload as SignalDetail;
    },
    enabled: Boolean(tenantId && selectedSignalId),
  });

  const automationRunDetailQuery = useQuery<SignalAutomationRunDetail | null, Error>({
    queryKey: ['signal-automation-run', tenantId, expandedAutomationRunId],
    queryFn: async () => {
      if (!tenantId || !expandedAutomationRunId) {
        return null;
      }

      const res = await fetch(`/api/views/dashboard/signals/automation-runs/${expandedAutomationRunId}`);
      const payload = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(payload?.error ?? 'Не удалось загрузить automation run');
      }

      return payload as SignalAutomationRunDetail;
    },
    enabled: Boolean(tenantId && expandedAutomationRunId),
  });

  const { userRole } = useStore();
  const canManage = userRole !== 'viewer';
  const canComment = Boolean(userRole);

  const invalidateSignalQueries = async (signalId?: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['signals', tenantId] }),
      queryClient.invalidateQueries({ queryKey: ['signal-notifications', tenantId] }),
      queryClient.invalidateQueries({ queryKey: ['signal-automation-run', tenantId] }),
      signalId
        ? queryClient.invalidateQueries({ queryKey: ['signal-detail', tenantId, signalId] })
        : Promise.resolve(),
    ]);
  };

  const resolveMutation = useMutation({
    mutationFn: (signalId: string) => resolveSignal(tenantId!, signalId),
    onSuccess: async (_, signalId) => {
      await invalidateSignalQueries(signalId);
      if (selectedSignalId === signalId) {
        setManualSelectedSignalId(null);
        clearReturnSignalContext();
      }
    }
  });

  const ignoreMutation = useMutation({
    mutationFn: (signalId: string) => ignoreSignal(tenantId!, signalId),
    onSuccess: async (_, signalId) => {
      await invalidateSignalQueries(signalId);
      if (selectedSignalId === signalId) {
        setManualSelectedSignalId(null);
        clearReturnSignalContext();
      }
    }
  });

  const bulkAssignMutation = useMutation({
    mutationFn: async (assigneeUserId: string) => {
      return bulkAssignSignalOwner(tenantId!, selectedVisibleSignalIds, assigneeUserId || null, 'overview');
    },
    onSuccess: async () => {
      clearBulkSelection();
      await invalidateSignalQueries(selectedSignalId ?? undefined);
    },
  });

  const bulkWorkflowMutation = useMutation({
    mutationFn: async (nextWorkflowState: SignalWorkflowState) => {
      return bulkUpdateSignalWorkflowStateAction(tenantId!, selectedVisibleSignalIds, nextWorkflowState, 'overview');
    },
    onSuccess: async () => {
      clearBulkSelection();
      await invalidateSignalQueries(selectedSignalId ?? undefined);
    },
  });

  const bulkStatusMutation = useMutation({
    mutationFn: async (status: 'resolved' | 'ignored') => {
      return bulkUpdateSignalStatusAction(tenantId!, selectedVisibleSignalIds, status);
    },
    onSuccess: async () => {
      clearBulkSelection();
      if (selectedSignalId && selectedSignalIds.includes(selectedSignalId)) {
        setManualSelectedSignalId(null);
        clearReturnSignalContext();
      }
      await invalidateSignalQueries(selectedSignalId ?? undefined);
    },
  });

  const bulkNoteMutation = useMutation({
    mutationFn: async (noteBody: string) => {
      return bulkAddSignalNoteAction(tenantId!, selectedVisibleSignalIds, noteBody, 'overview');
    },
    onSuccess: async () => {
      setBulkNoteDraft('');
      await invalidateSignalQueries(selectedSignalId ?? undefined);
    },
  });

  const bulkPresetMutation = useMutation({
    mutationFn: async (payload: {
      assigneeUserId?: string | null;
      workflowState: SignalWorkflowState;
      noteBody: string;
    }) => {
      return bulkApplySignalHandoffPresetAction(tenantId!, selectedVisibleSignalIds, payload, 'overview');
    },
    onSuccess: async () => {
      setBulkNoteDraft('');
      clearBulkSelection();
      await invalidateSignalQueries(selectedSignalId ?? undefined);
    },
  });

  const ownerQueueShortcutMutation = useMutation({
    mutationFn: async (payload: {
      signalIds: string[];
      assigneeUserId: string;
      workflowState: SignalWorkflowState;
      noteBody: string;
      clearSelection?: boolean;
    }) => {
      return bulkApplySignalHandoffPresetAction(tenantId!, payload.signalIds, {
        assigneeUserId: payload.assigneeUserId,
        workflowState: payload.workflowState,
        noteBody: payload.noteBody,
      }, 'overview');
    },
    onSuccess: async (_, payload) => {
      if (payload.clearSelection) {
        clearBulkSelection();
      }
      await invalidateSignalQueries(selectedSignalId ?? undefined);
    },
  });

  const saveViewMutation = useMutation({
    mutationFn: async () => {
      return saveSignalSavedViewAction(tenantId!, {
        name: resolvedSavedViewName,
        scope: savedViewScopeDraft,
        queueView,
        assigneeFilter,
        workflowFilter,
        sortPreset,
        sharedOwnerUserId: savedViewScopeDraft === 'team' ? savedViewSharedOwnerDraft || null : null,
      });
    },
    onSuccess: async () => {
      await invalidateSignalQueries(selectedSignalId ?? undefined);
    },
  });

  const updateViewMutation = useMutation({
    mutationFn: async (savedViewId: string) => {
      return updateSignalSavedViewAction(tenantId!, savedViewId, {
        name: resolvedSavedViewName,
        scope: savedViewScopeDraft,
        queueView,
        assigneeFilter,
        workflowFilter,
        sortPreset,
        sharedOwnerUserId: savedViewScopeDraft === 'team' ? savedViewSharedOwnerDraft || null : null,
      });
    },
    onSuccess: async () => {
      await invalidateSignalQueries(selectedSignalId ?? undefined);
    },
  });

  const deleteViewMutation = useMutation({
    mutationFn: async (savedViewId: string) => {
      return deleteSignalSavedViewAction(tenantId!, savedViewId);
    },
    onSuccess: async () => {
      await invalidateSignalQueries(selectedSignalId ?? undefined);
    },
  });

  const defaultViewMutation = useMutation({
    mutationFn: async (payload: { savedViewId: string; isDefault: boolean }) => {
      return setDefaultSignalSavedViewAction(tenantId!, payload.savedViewId, payload.isDefault);
    },
    onSuccess: async () => {
      await invalidateSignalQueries(selectedSignalId ?? undefined);
    },
  });

  const pinViewMutation = useMutation({
    mutationFn: async (payload: { savedViewId: string; isPinned: boolean }) => {
      return togglePinSignalSavedViewAction(tenantId!, payload.savedViewId, payload.isPinned);
    },
    onSuccess: async () => {
      await invalidateSignalQueries(selectedSignalId ?? undefined);
    },
  });

  const moveViewMutation = useMutation({
    mutationFn: async (payload: { savedViewId: string; direction: 'up' | 'down' }) => {
      return moveSignalSavedViewAction(tenantId!, payload.savedViewId, payload.direction);
    },
    onSuccess: async () => {
      await invalidateSignalQueries(selectedSignalId ?? undefined);
    },
  });

  const saveSlaQueueViewMutation = useMutation({
    mutationFn: async (presetId: (typeof SIGNAL_SLA_QUEUE_PRESETS)[number]['id']) => {
      const preset = SIGNAL_SLA_QUEUE_PRESETS.find((item) => item.id === presetId);
      if (!preset) {
        throw new Error('SLA preset не найден');
      }

      return saveSignalSavedViewAction(tenantId!, {
        name: preset.savedViewName,
        scope: canManage ? savedViewScopeDraft : 'private',
        queueView: preset.queueView,
        assigneeFilter: 'all',
        workflowFilter: preset.workflowFilter,
        sortPreset: preset.sortPreset,
        sharedOwnerUserId: canManage && savedViewScopeDraft === 'team' ? savedViewSharedOwnerDraft || null : null,
      });
    },
    onSuccess: async () => {
      await invalidateSignalQueries(selectedSignalId ?? undefined);
    },
  });

  const escalationMutation = useMutation({
    mutationFn: async (payload: {
      signalId: string;
      assigneeUserId?: string | null;
      workflowState: SignalWorkflowState;
      noteBody: string;
    }) => {
      return bulkApplySignalHandoffPresetAction(
        tenantId!,
        [payload.signalId],
        {
          assigneeUserId: payload.assigneeUserId,
          workflowState: payload.workflowState,
          noteBody: payload.noteBody,
        },
        'overview',
      );
    },
    onSuccess: async (_, payload) => {
      await invalidateSignalQueries(payload.signalId);
    },
  });

  const slaAutomationMutation = useMutation({
    mutationFn: async (payload: {
      signalIds: string[];
      queuePresetId?: string | null;
      triggerLabel?: string | null;
    }) => {
      const sharedOwnerUserId = activeSavedView?.sharedOwnerUserId ?? (queueOwnerFilter !== 'all' && queueOwnerFilter !== 'unassigned' ? queueOwnerFilter : null);
      const contextKey = buildSlaAutomationContextKey({
        signalIds: payload.signalIds,
        queuePresetId: payload.queuePresetId ?? null,
        triggerLabel: payload.triggerLabel ?? null,
        savedViewId: activeSavedView?.id ?? null,
        sharedOwnerUserId,
      });

      return runSignalSlaAutomationAction(tenantId!, payload.signalIds, 'overview', {
        savedViewId: activeSavedView?.id ?? null,
        sharedOwnerUserId,
        queuePresetId: payload.queuePresetId ?? null,
        triggerLabel: payload.triggerLabel ?? null,
        previewControlEventId: latestDryRunPreview?.controlEventId && latestDryRunContextKey === contextKey
          ? latestDryRunPreview.controlEventId
          : null,
      });
    },
    onSuccess: async () => {
      setLatestDryRunPreview(null);
      setLatestDryRunContextKey(null);
      clearBulkSelection();
      await invalidateSignalQueries(selectedSignalId ?? undefined);
    },
  });

  const slaFollowUpMutation = useMutation({
    mutationFn: async (runId: string) => {
      return runSignalSlaFollowUpAction(tenantId!, runId, 'overview');
    },
    onSuccess: async () => {
      await invalidateSignalQueries(selectedSignalId ?? undefined);
    },
  });
  const slaPreviewMutation = useMutation({
    mutationFn: async (payload: {
      signalIds: string[];
      queuePresetId?: string | null;
      triggerLabel?: string | null;
    }) => {
      return previewSignalSlaAutomationAction(tenantId!, payload.signalIds, 'overview', {
        savedViewId: activeSavedView?.id ?? null,
        sharedOwnerUserId: activeSavedView?.sharedOwnerUserId ?? (queueOwnerFilter !== 'all' && queueOwnerFilter !== 'unassigned' ? queueOwnerFilter : null),
        queuePresetId: payload.queuePresetId ?? null,
        triggerLabel: payload.triggerLabel ?? null,
      });
    },
    onSuccess: (preview, payload) => {
      setLatestDryRunPreview(preview);
      setLatestDryRunContextKey(buildSlaAutomationContextKey({
        signalIds: payload.signalIds,
        queuePresetId: payload.queuePresetId ?? null,
        triggerLabel: payload.triggerLabel ?? null,
        savedViewId: activeSavedView?.id ?? null,
        sharedOwnerUserId: activeSavedView?.sharedOwnerUserId ?? (queueOwnerFilter !== 'all' && queueOwnerFilter !== 'unassigned' ? queueOwnerFilter : null),
      }));
    },
  });
  const followUpResolutionMutation = useMutation({
    mutationFn: async (payload: {
      signalId: string;
      sourceAutomationRunId: string;
      followUpBatchId: string;
      resolution: SignalFollowUpResolution;
    }) => {
      return captureSignalFollowUpResolutionAction(tenantId!, payload.signalId, payload, 'overview');
    },
    onSuccess: async (_, payload) => {
      await invalidateSignalQueries(payload.signalId);
    },
  });
  const suppressionMutation = useMutation({
    mutationFn: async (payload: {
      targetType: SignalAutomationSuppressionTarget;
      savedViewId?: string | null;
      sharedOwnerUserId?: string | null;
      isSuppressed: boolean;
      reason?: string | null;
      suppressUntil?: string | null;
      clearReason?: string | null;
    }) => {
      return toggleSignalAutomationSuppressionAction(tenantId!, payload);
    },
    onSuccess: async () => {
      setLatestDryRunPreview(null);
      setLatestDryRunContextKey(null);
      await invalidateSignalQueries(selectedSignalId ?? undefined);
    },
  });

  if (isLoading) return <div className="animate-pulse h-32 bg-slate-100 rounded-3xl mb-8" />;
  if (error) {
    return (
      <div className="mb-8">
        <OperatorState
          icon={AlertCircle}
          tone="danger"
          title="Не удалось загрузить сигналы"
          description={error.message}
          actionLabel="Повторить запрос"
          action={refetch}
        />
      </div>
    );
  }

  if (!sortedSignals.length) {
    return (
      <div className="mb-8">
        <OperatorState
          icon={CheckCircle2}
          tone="success"
          title="Активных сигналов сейчас нет"
          description="На выбранном диапазоне система не видит критичных или высоких отклонений, которые требуют немедленного действия."
          secondaryText="Это не гарантия отсутствия проблем, а состояние текущего набора данных"
        />
      </div>
    );
  }

  const isAnyMutationPending = resolveMutation.isPending || ignoreMutation.isPending;
  const hasActiveFilters = ownerQueueRouteActive
    || manualQueueView !== null
    || manualAssigneeFilter !== null
    || manualWorkflowFilter !== null
    || manualSortPreset !== null
    || manualQueueOwnerFilter !== null;
  const isBulkMutating = bulkAssignMutation.isPending
    || bulkWorkflowMutation.isPending
    || bulkStatusMutation.isPending
    || bulkNoteMutation.isPending
    || bulkPresetMutation.isPending
    || ownerQueueShortcutMutation.isPending;
  const isSavedViewMutating = saveViewMutation.isPending
    || updateViewMutation.isPending
    || deleteViewMutation.isPending
    || defaultViewMutation.isPending
    || pinViewMutation.isPending
    || moveViewMutation.isPending;
  const isSlaOperationsMutating = saveSlaQueueViewMutation.isPending || slaAutomationMutation.isPending;
  const isSlaPreviewMutating = slaPreviewMutation.isPending;
  const isSlaFollowUpMutating = slaFollowUpMutation.isPending;
  const isFollowUpResolutionMutating = followUpResolutionMutation.isPending;
  const isSuppressionMutating = suppressionMutation.isPending;
  const suppressionReason = suppressionReasonDraft.trim();
  const suppressionUntilIso = resolveSuppressionUntilIso(suppressionWindowDraft);
  const canCreateSuppression = suppressionReason.length >= 3;
  const isAllVisibleSelected = filteredSignals.length > 0 && filteredSignals.every((signal) => selectedSignalIds.includes(signal.id));
  const activeSavedView = (
    !ownerQueueRouteActive
      && manualQueueView === null
      && manualAssigneeFilter === null
      && manualWorkflowFilter === null
      && manualSortPreset === null
      ? effectiveDefaultSavedView
      : null
  ) ?? savedViews.find((view) =>
    view.queueView === queueView
      && view.assigneeFilter === assigneeFilter
      && view.workflowFilter === workflowFilter
      && view.sortPreset === sortPreset
      && (
        view.scope === 'team'
          ? (view.sharedOwnerUserId ?? 'unassigned') === queueOwnerFilter
          : queueOwnerFilter === 'all'
      )
  ) ?? null;
  const isEditingSavedView = Boolean(activeSavedView?.canEdit);
  const savedViewScopeDraft = manualSavedViewScope
    ?? (ownerQueueRouteActive ? 'team' : null)
    ?? (isEditingSavedView ? activeSavedView?.scope : 'private')
    ?? 'private';
  const savedViewSharedOwnerDraft = (
    manualSharedOwnerUserId
    ?? (ownerQueueRouteActive && ownerQueueRouteFilter && ownerQueueRouteFilter !== 'all' && ownerQueueRouteFilter !== 'unassigned'
      ? ownerQueueRouteFilter
      : null)
    ?? (isEditingSavedView ? activeSavedView?.sharedOwnerUserId : null)
    ?? (savedViewScopeDraft === 'team' && queueOwnerFilter !== 'all' && queueOwnerFilter !== 'unassigned' ? queueOwnerFilter : null)
    ?? ''
  );
  const resolvedSavedViewName = savedViewNameDraft.trim() || activeSavedView?.name || '';
  const savedViewInputValue = savedViewNameDraft || activeSavedView?.name || '';

  function applySavedView(view: SignalSavedView) {
    clearOwnerQueueRoutePreset();
    setManualQueueView(view.queueView);
    setManualAssigneeFilter(view.assigneeFilter);
    setManualWorkflowFilter(view.workflowFilter);
    setManualSortPreset(view.sortPreset);
    setManualQueueOwnerFilter(getSavedViewOwnerFilterValue(view));
    setManualSavedViewScope(view.canEdit ? view.scope : 'private');
    setManualSharedOwnerUserId(view.sharedOwnerUserId ?? '');
    setSavedViewNameDraft(view.name);
  }

  function applySlaQueuePreset(presetId: (typeof SIGNAL_SLA_QUEUE_PRESETS)[number]['id']) {
    clearOwnerQueueRoutePreset();
    const preset = SIGNAL_SLA_QUEUE_PRESETS.find((item) => item.id === presetId);
    if (!preset) {
      return;
    }

    setManualQueueView(preset.queueView);
    setManualAssigneeFilter('all');
    setManualWorkflowFilter(preset.workflowFilter);
    setManualSortPreset(preset.sortPreset);
    setManualQueueOwnerFilter(null);
    setManualSharedOwnerUserId(null);
    setSavedViewNameDraft(preset.savedViewName);
  }

  function getSignalIdsForSlaPreset(presetId: (typeof SIGNAL_SLA_QUEUE_PRESETS)[number]['id']) {
    const preset = SIGNAL_SLA_QUEUE_PRESETS.find((item) => item.id === presetId);
    if (!preset) {
      return [];
    }

    return ownerScopedSignals
      .filter((signal) => matchesSignalSlaQueuePreset(signal, preset, assigneeRoleById))
      .map((signal) => signal.id);
  }

  function applyOwnerQueuePreset(ownerUserId: string | null, nextQueueView: SignalQueueView) {
    clearOwnerQueueRoutePreset();
    setManualQueueOwnerFilter(ownerUserId ?? 'unassigned');
    setManualQueueView(nextQueueView);
    setManualAssigneeFilter('all');
    setManualWorkflowFilter('all');
    setManualSortPreset(getDefaultSortPresetForQueueView(nextQueueView));
    setManualSavedViewScope('team');
    setManualSharedOwnerUserId(ownerUserId);
    if (!savedViewNameDraft.trim()) {
      const ownerLabel = getAssigneeLabel(
        queueOwnerSummaries.find((summary) => summary.ownerUserId === ownerUserId)?.ownerEmail ?? null,
        ownerUserId,
      );
      const queueLabel = SIGNAL_QUEUE_VIEWS.find((queue) => queue.id === nextQueueView)?.label ?? 'Queue';
      setSavedViewNameDraft(`${ownerLabel} • ${queueLabel}`);
    }
  }

  function buildOwnerQueueShortcutNote(targetOwnerLabel: string) {
    const sourceLabel = queueOwnerFilter === 'all'
      ? null
      : queueOwnerSummaries.find((summary) => summary.key === queueOwnerFilter)?.label
        ?? (queueOwnerFilter === 'unassigned' ? 'Без owner' : null);

    if (sourceLabel) {
      return `Queue handoff: передаю выбранные сигналы из очереди ${sourceLabel} в очередь ${targetOwnerLabel}. После разбора зафиксируйте результат в timeline.`;
    }

    return `Queue handoff: передаю выбранные сигналы в очередь ${targetOwnerLabel}. После разбора зафиксируйте результат в timeline.`;
  }

  function buildOwnerRebalanceNote(targetOwnerLabel: string, sourceOwnerLabel: string, count: number) {
    return `Workload rebalance: перенаправляю ${count} сигнал(ов) из очереди ${sourceOwnerLabel} в очередь ${targetOwnerLabel}, чтобы выровнять нагрузку и не потерять SLA coverage.`;
  }

  if (isSimpleSurface) {
    const urgentCount = ownerScopedSignals.filter((signal) => signal.severity === 'critical' || signal.aging.slaState === 'overdue').length;
    const unassignedCount = ownerScopedSignals.filter((signal) => !signal.assigneeUserId).length;
    const simpleQueueViews: Array<{ id: SignalQueueView; label: string; count: number; title: string }> = [
      { id: 'all', label: 'Все', count: queueCounts.all, title: 'Все активные задачи' },
      { id: 'needs_action', label: 'К делу', count: queueCounts.needs_action, title: 'Новые и рабочие задачи без ожидания владельца' },
      { id: 'overdue_only', label: 'Горит', count: queueCounts.overdue_only, title: 'Задачи, которые вышли за срок реакции' },
      { id: 'blocked', label: 'Блокер', count: queueCounts.blocked, title: 'Задачи с внешним блокером' },
    ];

    const clearSimpleFilters = () => {
      clearOwnerQueueRoutePreset();
      setManualQueueView(null);
      setManualAssigneeFilter(null);
      setManualWorkflowFilter(null);
      setManualSortPreset(null);
      setManualQueueOwnerFilter(null);
      setManualSavedViewScope(null);
      setManualSharedOwnerUserId(null);
      setSavedViewNameDraft('');
    };

    return (
      <>
        <div className="mb-10 space-y-4">
          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-wrap gap-2">
                {simpleQueueViews.map((queue) => {
                  const active = queueView === queue.id;

                  return (
                    <button
                      key={queue.id}
                      type="button"
                      title={queue.title}
                      onClick={() => {
                        clearOwnerQueueRoutePreset();
                        setManualQueueView(queue.id);
                      }}
                      data-testid={`signal-queue-view-${queue.id}`}
                      className={cn(
                        'inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-sm font-bold transition-colors',
                        active
                          ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-950'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700',
                      )}
                    >
                      <span>{queue.label}</span>
                      <span className={cn(
                        'rounded-full px-2 py-0.5 text-[10px] font-black',
                        active ? 'bg-white/15 text-current' : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300',
                      )}>
                        {queue.count}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 xl:w-[34rem]">
                <label className="block">
                  <span className="sr-only">Ответственный</span>
                  <select
                    value={assigneeFilter}
                    onChange={(event) => setManualAssigneeFilter(event.target.value)}
                    data-testid="signal-assignee-filter"
                    className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    <option value="all">Все ответственные</option>
                    <option value="unassigned">Без ответственного</option>
                    {availableAssignees.map((member) => (
                      <option key={member.userId} value={member.userId}>
                        {getAssigneeLabel(member.email, member.userId)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="sr-only">Статус</span>
                  <select
                    value={workflowFilter}
                    onChange={(event) => setManualWorkflowFilter(event.target.value as 'all' | SignalWorkflowState)}
                    data-testid="signal-workflow-filter"
                    className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    <option value="all">Все статусы</option>
                    <option value="new">Новый</option>
                    <option value="in_progress">В работе</option>
                    <option value="handoff">Передан</option>
                    <option value="blocked">Блокер</option>
                  </select>
                </label>

                <label className="block">
                  <span className="sr-only">Сортировка</span>
                  <select
                    value={sortPreset}
                    onChange={(event) => setManualSortPreset(event.target.value as SignalSortPreset)}
                    data-testid="signal-sort-filter"
                    className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    <option value="severity">Сначала важные</option>
                    <option value="sla_pressure">Сначала горящие</option>
                    <option value="newest">Сначала свежие</option>
                  </select>
                </label>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] font-bold text-slate-500 dark:text-slate-400">
              <span className="rounded-full bg-slate-100 px-3 py-1 dark:bg-slate-700">Показано {filteredSignals.length} из {sortedSignals.length}</span>
              <span className="rounded-full bg-rose-50 px-3 py-1 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300">Срочно {urgentCount}</span>
              <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">Без ответственного {unassignedCount}</span>
              {returnSignalId ? (
                <span data-testid="return-to-signal-chip" className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">
                  {getReturnChipLabel(returnSource)}
                </span>
              ) : null}
              {hasActiveFilters ? (
                <button
                  type="button"
                  onClick={clearSimpleFilters}
                  className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-bold text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                >
                  <Filter className="h-3 w-3" />
                  Сбросить
                </button>
              ) : null}
            </div>
          </section>

          {filteredSignals.length ? (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
              {filteredSignals.map((signal: SignalListItem) => {
                const isCritical = signal.severity === 'critical';
                const isHigh = signal.severity === 'high';
                const isResolvePending = resolveMutation.isPending && resolveMutation.variables === signal.id;
                const isIgnorePending = ignoreMutation.isPending && ignoreMutation.variables === signal.id;
                const isPending = isResolvePending || isIgnorePending;
                const impactRub = parseFloat(signal.impactRub || '0');
                const productImageUrl = signal.photoUrl?.trim() || (signal.nmId ? getWbPhotoUrl(signal.nmId) : '');
                const productLabel = signal.vendorCode || signal.brand || (signal.nmId ? `WB ${signal.nmId}` : 'Товар');
                const primaryActionHref = signal.primaryActionHref || '#';
                const primaryActionLabel = signal.primaryActionLabel || 'Разобрать';

                return (
                  <article
                    key={signal.id}
                    className={cn(
                      'group flex min-h-[240px] flex-col rounded-lg border bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow-md dark:bg-slate-800',
                      isCritical
                        ? 'border-rose-200 dark:border-rose-800/50'
                        : isHigh
                          ? 'border-amber-200 dark:border-amber-800/50'
                          : 'border-slate-200 dark:border-slate-700',
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900">
                          {productImageUrl ? (
                            <Image
                              src={productImageUrl}
                              alt={productLabel}
                              width={64}
                              height={64}
                              className="h-full w-full object-cover"
                              loading="lazy"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-[10px] font-black uppercase text-slate-300">
                              Фото
                            </div>
                          )}
                        </div>
                        <div className="min-w-0">
                        <div className="mb-3 flex flex-wrap items-center gap-2">
                          <span className={cn(
                            'inline-flex h-7 items-center rounded-full px-2.5 text-[10px] font-black uppercase',
                            isCritical
                              ? 'bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300'
                              : isHigh
                                ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300'
                                : 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300',
                          )}>
                            {isCritical ? 'Критично' : isHigh ? 'Важно' : 'Проверить'}
                          </span>
                          {signal.nmId ? (
                            <span className="text-[11px] font-bold text-slate-400">WB {signal.nmId}</span>
                          ) : null}
                        </div>
                        <h3 className="text-base font-black leading-snug text-slate-950 dark:text-slate-100">
                          {signal.title}
                        </h3>
                        {signal.vendorCode || signal.brand ? (
                          <p className="mt-1 truncate text-xs font-bold text-slate-400">
                            {[signal.vendorCode, signal.brand].filter(Boolean).join(' · ')}
                          </p>
                        ) : null}
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => resolveMutation.mutate(signal.id)}
                          disabled={isPending || !canManage}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 transition hover:bg-emerald-50 hover:text-emerald-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-emerald-900/20"
                          title="Исправлено"
                        >
                          {isResolvePending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => ignoreMutation.mutate(signal.id)}
                          disabled={isPending || !canManage}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 transition hover:bg-slate-100 hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-slate-700"
                          title="Скрыть"
                        >
                          {isIgnorePending ? <Loader2 className="h-4 w-4 animate-spin" /> : <EyeOff className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>

                    <p className="mt-3 flex-1 text-sm font-medium leading-relaxed text-slate-600 dark:text-slate-300">
                      {signal.description}
                    </p>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase ${getWorkflowStateClass(signal.workflowState)}`}>
                        {getWorkflowStateLabel(signal.workflowState)}
                      </span>
                      <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase ${getSlaStateClass(signal.aging.slaState)}`}>
                        {signal.aging.slaLabel}
                      </span>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-bold text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
                        {signal.aging.queueAgeLabel}
                      </span>
                      <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-bold text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                        {getAssigneeLabel(signal.assigneeEmail, signal.assigneeUserId)}
                      </span>
                    </div>

                    <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-100 pt-4 dark:border-slate-700">
                      <div className="min-w-0">
                        <p className="text-[10px] font-bold uppercase text-slate-400">Влияние</p>
                        <p className={cn('mt-0.5 truncate text-sm font-black', isCritical ? 'text-rose-600' : 'text-slate-800 dark:text-slate-100')}>
                          {impactRub !== 0 ? `${Math.abs(impactRub).toLocaleString('ru-RU')} ₽` : 'проверить'}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          aria-haspopup="dialog"
                          data-testid="signal-details-trigger"
                          onClick={() => openSignal(signal.id)}
                          className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-black text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                          title="Открыть детали сигнала"
                        >
                          Детали
                        </button>
                        <Link
                          href={primaryActionHref}
                          prefetch={false}
                          data-testid="signal-fix-link"
                          className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-black text-white transition hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-white"
                        >
                          {primaryActionLabel}
                          <ArrowRight className="h-4 w-4" />
                        </Link>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800">
              <OperatorState
                icon={Filter}
                tone="warning"
                title="По выбранным фильтрам задач нет"
                description="Снимите часть ограничений, чтобы увидеть другие активные сигналы."
                actionLabel={hasActiveFilters ? 'Сбросить фильтры' : undefined}
                action={hasActiveFilters ? clearSimpleFilters : undefined}
              />
            </div>
          )}
        </div>

        <SignalDetailsPanel
          open={Boolean(selectedSignalId)}
          detail={signalDetailsQuery.data}
          tenantId={tenantId}
          signalId={selectedSignalId}
          openedFrom={selectedSignalOpenedFrom}
          isLoading={signalDetailsQuery.isLoading}
          error={signalDetailsQuery.error}
          canManage={canManage}
          canComment={canComment}
          isMutating={isAnyMutationPending}
          onClose={closeSignalDetails}
          onOpenRecentSignal={openSignal}
          onResolve={() => {
            if (selectedSignalId) {
              resolveMutation.mutate(selectedSignalId);
            }
          }}
          onIgnore={() => {
            if (selectedSignalId) {
              ignoreMutation.mutate(selectedSignalId);
            }
          }}
        />
      </>
    );
  }

  return (
    <>
      <div className="space-y-4 mb-10">
        <div className="flex items-center gap-2 mb-4 px-2">
          <Zap className="w-5 h-5 text-amber-500 fill-amber-500" />
          <h2 className="text-lg font-bold text-slate-800 tracking-tight dark:text-slate-100">Очередь задач</h2>
          <span className="bg-slate-100 text-slate-500 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
            {filteredSignals.length} из {sortedSignals.length}
          </span>
          {returnSignalId ? (
            <span
              data-testid="return-to-signal-chip"
              className="border border-emerald-200 bg-emerald-50 text-emerald-700 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider dark:border-emerald-800/40 dark:bg-emerald-900/20 dark:text-emerald-300"
            >
              {getReturnChipLabel(returnSource)}
            </span>
          ) : null}
        </div>

        <div className="rounded-[2rem] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 shadow-sm">
          <div className="space-y-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Рабочие очереди</p>
              <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-5">
                {SIGNAL_QUEUE_VIEWS.map((queue) => {
                  const active = queueView === queue.id;

                  return (
                    <button
                      key={queue.id}
                      type="button"
                      onClick={() => {
                        clearOwnerQueueRoutePreset();
                        setManualQueueView(queue.id);
                      }}
                      data-testid={`signal-queue-view-${queue.id}`}
                      className={cn(
                        'rounded-[1.5rem] border px-4 py-4 text-left transition-colors',
                        active
                          ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800/40 dark:bg-emerald-900/20'
                          : 'border-slate-200 bg-slate-50 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/50 dark:hover:bg-slate-700/50',
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-bold text-slate-900">{queue.label}</p>
                        <span className={cn(
                          'rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest',
                          active ? 'bg-emerald-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400',
                        )}>
                          {queueCounts[queue.id]}
                        </span>
                      </div>
                      <p className="mt-2 text-[11px] font-medium leading-relaxed text-slate-500">
                        {queue.description}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Sort presets</p>
                  <p className="mt-1 text-xs font-medium leading-relaxed text-slate-500">
                    SLA pressure можно сохранять в saved view и использовать как отдельную рабочую очередь.
                  </p>
                </div>
                <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-3">
                  {SIGNAL_SORT_PRESETS.map((preset) => {
                    const active = sortPreset === preset.id;

                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => {
                          clearOwnerQueueRoutePreset();
                          setManualSortPreset(preset.id);
                        }}
                        data-testid={`signal-sort-preset-${preset.id}`}
                        className={cn(
                          'rounded-[1.25rem] border px-4 py-3 text-left transition-colors',
                          active ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800/40 dark:bg-emerald-900/20' : 'border-slate-200 bg-white hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700/50',
                        )}
                      >
                        <p className="text-sm font-bold text-slate-900">{preset.label}</p>
                        <p className="mt-1 text-[11px] font-medium leading-relaxed text-slate-500">
                          {preset.description}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">SLA operations</p>
                  <p className="mt-1 text-xs font-medium leading-relaxed text-slate-500">
                    Overdue queues можно открыть как готовый preset, сохранить как saved view и прогнать server-side SLA automation по всей пачке.
                  </p>
                </div>
                <div className="grid flex-1 grid-cols-1 gap-3 xl:grid-cols-3">
                  {SIGNAL_SLA_QUEUE_PRESETS.map((preset) => {
                    const count = slaQueuePresetCounts[preset.id]!;
                    const signalIds = getSignalIdsForSlaPreset(preset.id);
                    const active = queueView === preset.queueView && workflowFilter === preset.workflowFilter && sortPreset === preset.sortPreset;

                    return (
                      <div
                        key={preset.id}
                        className={cn(
                          'rounded-[1.25rem] border px-4 py-4',
                          active ? 'border-amber-300 bg-amber-50 dark:border-amber-800/40 dark:bg-amber-900/20' : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800',
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-bold text-slate-900">{preset.label}</p>
                            <p className="mt-1 text-[11px] font-medium leading-relaxed text-slate-500">
                              {preset.description}
                            </p>
                          </div>
                          <span className={cn(
                            'rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest',
                            count > 0 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500',
                          )}>
                            {count}
                          </span>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => applySlaQueuePreset(preset.id)}
                            className="inline-flex items-center rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-[11px] font-bold text-slate-700 dark:text-slate-300 transition-colors hover:bg-slate-50 dark:hover:bg-slate-700"
                          >
                            Открыть queue
                          </button>
                          <button
                            type="button"
                            onClick={() => saveSlaQueueViewMutation.mutate(preset.id)}
                            disabled={isSlaOperationsMutating}
                            className="inline-flex items-center rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-[11px] font-bold text-slate-700 dark:text-slate-300 transition-colors hover:bg-slate-50 dark:hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {saveSlaQueueViewMutation.isPending ? 'Сохранение...' : 'Сохранить view'}
                          </button>
                          {canManage ? (
                            <button
                              type="button"
                              onClick={() => slaPreviewMutation.mutate({
                                signalIds,
                                queuePresetId: preset.id,
                                triggerLabel: preset.label,
                              })}
                              disabled={isSlaOperationsMutating || isSlaPreviewMutating || signalIds.length === 0}
                              className="inline-flex items-center rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-[11px] font-bold text-slate-700 dark:text-slate-300 transition-colors hover:bg-slate-50 dark:hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {isSlaPreviewMutating ? 'Считаю...' : 'Dry-run preview'}
                            </button>
                          ) : null}
                          {canManage ? (
                            <button
                              type="button"
                              onClick={() => slaAutomationMutation.mutate({
                                signalIds,
                                queuePresetId: preset.id,
                                triggerLabel: preset.label,
                              })}
                              disabled={isSlaOperationsMutating || signalIds.length === 0}
                              className="inline-flex items-center rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-700 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-300 dark:hover:bg-amber-900/30"
                            >
                              {slaAutomationMutation.isPending ? 'Эскалация...' : 'Запустить SLA automation'}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="rounded-[1.5rem] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
              <div className="flex flex-col gap-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Automation runs</p>
                  <p className="mt-1 text-xs font-medium leading-relaxed text-slate-500">
                    Журнал SLA automation: источник запуска, привязка к saved view/queue owner, pending follow-up и outcome по каждому run.
                  </p>
                </div>
                <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
                  <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(16rem,20rem)_1fr]">
                    <label className="block">
                      <span className="mb-2 inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                        Queue owner
                      </span>
                      <select
                        value={queueOwnerFilter}
                        onChange={(event) => {
                          clearOwnerQueueRoutePreset();
                          setManualQueueOwnerFilter(event.target.value === 'all' ? null : event.target.value);
                        }}
                        className="w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-300 outline-none transition focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100"
                      >
                        <option value="all">Все owner queues</option>
                        <option value="unassigned">Без owner</option>
                        {queueOwnerOptions.map((owner) => (
                          <option key={owner.userId ?? owner.email ?? 'queue-owner'} value={owner.userId ?? 'unassigned'}>
                            {getAssigneeLabel(owner.email, owner.userId)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {queueOwnerSummaries.length ? queueOwnerSummaries.map((summary) => {
                        const active = queueOwnerFilter === (summary.ownerUserId ?? 'unassigned');
                        const ownerSuppression = getQueueOwnerSuppression(summary.ownerUserId);
                        const rebalanceSuggestion = ownerRebalanceSuggestions[summary.key] ?? null;
                        const canHandoffSelected = Boolean(summary.ownerUserId && selectedVisibleSignalIds.length);

                        return (
                          <div
                            key={summary.key}
                            className={cn(
                              'rounded-[1.25rem] border px-4 py-3 text-left transition-colors',
                              active ? 'border-blue-300 bg-blue-50 dark:border-blue-800/40 dark:bg-blue-900/20' : 'border-slate-200 bg-white hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700/50',
                            )}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <button
                                  type="button"
                                  onClick={() => {
                                    clearOwnerQueueRoutePreset();
                                    setManualQueueOwnerFilter(active ? null : (summary.ownerUserId ?? 'unassigned'));
                                  }}
                                  className="min-w-0 text-left"
                                >
                                  <p className="truncate text-sm font-bold text-slate-900">{summary.label}</p>
                                </button>
                                <p className="mt-1 text-[11px] font-medium leading-relaxed text-slate-500">
                                  {summary.teamViewsCount} team view • {summary.recentRunsCount} recent run • {summary.pendingOutcomesCount} pending
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                {ownerSuppression ? (
                                  <span className="rounded-full bg-rose-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-rose-700">
                                    Suppressed
                                  </span>
                                ) : null}
                                {active ? (
                                  <span className="rounded-full bg-blue-600 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-white">
                                    active
                                  </span>
                                ) : null}
                              </div>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-1.5">
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] uppercase tracking-widest text-slate-600">
                                Assigned {summary.assignedSignalsCount}
                              </span>
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] uppercase tracking-widest text-slate-600">
                                Overdue {summary.overdueAssignedCount}
                              </span>
                              {summary.pinnedViewsCount ? (
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] uppercase tracking-widest text-slate-600">
                                  Pinned {summary.pinnedViewsCount}
                                </span>
                              ) : null}
                              {summary.teamDefaultName ? (
                                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] uppercase tracking-widest text-amber-700">
                                  {summary.ownerUserId ? 'Owner default' : 'Team default'}: {summary.teamDefaultName}
                                </span>
                              ) : null}
                            </div>
                            <div className="mt-3 grid grid-cols-2 gap-2">
                              {([
                                ['needs_action', 'Needs action'],
                                ['awaiting_owner', 'Awaiting owner'],
                                ['blocked', 'Blocked'],
                                ['overdue_only', 'Overdue'],
                              ] as const).map(([nextQueueView, label]) => {
                                const presetActive = active && queueView === nextQueueView;
                                return (
                                  <button
                                    key={`${summary.key}-${nextQueueView}`}
                                    type="button"
                                    onClick={() => applyOwnerQueuePreset(summary.ownerUserId, nextQueueView)}
                                    className={cn(
                                      'rounded-2xl border px-3 py-2 text-left transition-colors',
                                      presetActive
                                        ? 'border-blue-300 bg-white text-blue-700'
                                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-white dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300 dark:hover:bg-slate-800',
                                    )}
                                  >
                                    <span className="block text-[9px] font-bold uppercase tracking-widest text-slate-400">{label}</span>
                                    <span className="mt-1 block text-sm font-black tracking-tight">{summary.queueCounts[nextQueueView]}</span>
                                  </button>
                                );
                              })}
                            </div>
                            {canManage && summary.ownerUserId ? (
                              <div className="mt-3 space-y-2">
                                <div className="flex flex-wrap justify-end gap-2">
                                  <button
                                    type="button"
                                    onClick={() => ownerQueueShortcutMutation.mutate({
                                      signalIds: selectedVisibleSignalIds,
                                      assigneeUserId: summary.ownerUserId!,
                                      workflowState: 'handoff',
                                      noteBody: buildOwnerQueueShortcutNote(summary.label),
                                      clearSelection: true,
                                    })}
                                    disabled={!canHandoffSelected || isBulkMutating}
                                    className="inline-flex items-center gap-1.5 rounded-2xl border border-blue-200 bg-blue-50 px-3 py-2 text-[11px] font-bold text-blue-700 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-blue-800/40 dark:bg-blue-900/20 dark:text-blue-300 dark:hover:bg-blue-900/30"
                                    title={canHandoffSelected
                                      ? `Передать выбранные сигналы в очередь ${summary.label}`
                                      : 'Сначала выберите сигналы в текущем queue'}
                                  >
                                    <ArrowRight className="h-3.5 w-3.5" />
                                    Selected to owner
                                  </button>
                                  {rebalanceSuggestion ? (
                                    <button
                                      type="button"
                                      onClick={() => ownerQueueShortcutMutation.mutate({
                                        signalIds: rebalanceSuggestion.signalIds,
                                        assigneeUserId: summary.ownerUserId!,
                                        workflowState: 'handoff',
                                        noteBody: buildOwnerRebalanceNote(summary.label, rebalanceSuggestion.sourceOwnerLabel, rebalanceSuggestion.count),
                                      })}
                                      disabled={isBulkMutating}
                                      className="inline-flex items-center gap-1.5 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-bold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-800/40 dark:bg-emerald-900/20 dark:text-emerald-300 dark:hover:bg-emerald-900/30"
                                      title={`Перераспределить ${rebalanceSuggestion.count} сигнал(ов) из очереди ${rebalanceSuggestion.sourceOwnerLabel}`}
                                    >
                                      <ArrowRight className="h-3.5 w-3.5" />
                                      Balance {rebalanceSuggestion.count}
                                    </button>
                                  ) : null}
                                </div>
                                {rebalanceSuggestion ? (
                                  <p className="text-right text-[10px] font-medium leading-relaxed text-slate-500">
                                    Быстрый баланс: взять {rebalanceSuggestion.count} needs action из очереди {rebalanceSuggestion.sourceOwnerLabel}.
                                  </p>
                                ) : null}
                                <div className="flex justify-end">
                                  <button
                                    type="button"
                                    onClick={() => suppressionMutation.mutate({
                                      targetType: 'queue_owner',
                                      sharedOwnerUserId: summary.ownerUserId,
                                      isSuppressed: Boolean(ownerSuppression),
                                      reason: ownerSuppression ? null : suppressionReason,
                                      suppressUntil: ownerSuppression ? null : suppressionUntilIso,
                                      clearReason: ownerSuppression ? suppressionReason || null : null,
                                    })}
                                    disabled={isSuppressionMutating || (!ownerSuppression && !canCreateSuppression)}
                                    className={cn(
                                      'inline-flex items-center gap-1.5 rounded-2xl border px-3 py-2 text-[11px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                                      ownerSuppression
                                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800/40 dark:bg-emerald-900/20 dark:text-emerald-300 dark:hover:bg-emerald-900/30'
                                        : 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-800/40 dark:bg-rose-900/20 dark:text-rose-300 dark:hover:bg-rose-900/30',
                                    )}
                                  >
                                    <EyeOff className="h-3.5 w-3.5" />
                                    {ownerSuppression ? 'Возобновить owner automation' : 'Suppress owner automation'}
                                  </button>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        );
                      }) : (
                        <div className="rounded-[1.25rem] border border-dashed border-slate-200 bg-white px-4 py-3 text-[11px] font-medium leading-relaxed text-slate-500">
                          Team owner summary появится, когда в team views или automation runs будет назначен queue owner.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(20rem,24rem)_1fr]">
                  <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Automation health</p>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] font-medium text-slate-600">
                      <div className="rounded-2xl bg-white px-3 py-3">
                        <span className="block text-[9px] font-bold uppercase tracking-widest text-slate-400">Runs 48h</span>
                        <span className="mt-1 block text-sm font-bold text-slate-800">{automationHealth.recentRunsCount}</span>
                      </div>
                      <div className="rounded-2xl bg-white px-3 py-3">
                        <span className="block text-[9px] font-bold uppercase tracking-widest text-slate-400">Failed 48h</span>
                        <span className="mt-1 block text-sm font-bold text-slate-800">{automationHealth.recentFailedRunsCount}</span>
                      </div>
                      <div className="rounded-2xl bg-white px-3 py-3">
                        <span className="block text-[9px] font-bold uppercase tracking-widest text-slate-400">Pending runs</span>
                        <span className="mt-1 block text-sm font-bold text-slate-800">{automationHealth.recentPendingRunsCount}</span>
                      </div>
                      <div className="rounded-2xl bg-white px-3 py-3">
                        <span className="block text-[9px] font-bold uppercase tracking-widest text-slate-400">Suppressed</span>
                        <span className="mt-1 block text-sm font-bold text-slate-800">{automationHealth.activeSuppressionsCount}</span>
                      </div>
                      <div className="rounded-2xl bg-white px-3 py-3">
                        <span className="block text-[9px] font-bold uppercase tracking-widest text-slate-400">Previews 48h</span>
                        <span className="mt-1 block text-sm font-bold text-slate-800">{automationHealth.recentPreviewsCount}</span>
                      </div>
                      <div className="rounded-2xl bg-white px-3 py-3">
                        <span className="block text-[9px] font-bold uppercase tracking-widest text-slate-400">Awaiting outcome</span>
                        <span className="mt-1 block text-sm font-bold text-slate-800">{automationHealth.recentAwaitingOutcomeRunsCount}</span>
                      </div>
                    </div>
                    <div className="mt-3 space-y-1.5 text-[11px] font-medium leading-relaxed text-slate-500">
                      <p>
                        Последний run: {automationHealth.latestRunAt ? formatRunDateTime(automationHealth.latestRunAt) : 'ещё не запускался'}
                      </p>
                      <p>
                        Последний success: {automationHealth.latestSuccessfulRunAt ? formatRunDateTime(automationHealth.latestSuccessfulRunAt) : 'нет успешных run'}
                      </p>
                      <p>
                        Последний failure: {automationHealth.latestFailedRunAt ? formatRunDateTime(automationHealth.latestFailedRunAt) : 'нет fail run'}
                      </p>
                      <p>
                        Последний follow-up: {automationHealth.latestFollowUpAt ? formatRunDateTime(automationHealth.latestFollowUpAt) : 'ещё не было'}
                      </p>
                      <p>
                        Последний escalation alert: {automationHealth.latestEscalationAlertAt ? formatRunDateTime(automationHealth.latestEscalationAlertAt) : 'ещё не было'}
                      </p>
                      <p>
                        Manual executes 48h: {automationHealth.recentManualExecutionsCount} • Awaiting explicit outcome runs: {automationHealth.recentAwaitingOutcomeRunsCount}
                      </p>
                      <p>
                        Escalation alerts 48h: {automationHealth.recentEscalationAlertsCount} • Runs with alerts: {automationHealth.recentEscalatedRunsCount}
                      </p>
                      <p>
                        Saved view suppressions: {automationHealth.suppressedSavedViewsCount} • Owner suppressions: {automationHealth.suppressedQueueOwnersCount}
                      </p>
                    </div>
                    {canManage ? (
                      <div className="mt-4 rounded-2xl border border-slate-200 bg-white px-3 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Suppression policy</p>
                        <p className="mt-1 text-[11px] font-medium leading-relaxed text-slate-500">
                          Reason и suppress-until будут применены к следующему suppress действию из owner/view карточек.
                        </p>
                        <div className="mt-3 space-y-3">
                          <label className="block">
                            <span className="mb-2 inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                              Reason
                            </span>
                            <input
                              value={suppressionReasonDraft}
                              onChange={(event) => setSuppressionReasonDraft(event.target.value)}
                              placeholder="Например: maintenance window, noisy queue, manual triage"
                              className="w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-300 outline-none transition focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100"
                            />
                          </label>
                          <label className="block">
                            <span className="mb-2 inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                              Suppress until
                            </span>
                            <select
                              value={suppressionWindowDraft}
                              onChange={(event) => setSuppressionWindowDraft(event.target.value as typeof suppressionWindowDraft)}
                              className="w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-300 outline-none transition focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100"
                            >
                              <option value="4h">4 часа</option>
                              <option value="24h">24 часа</option>
                              <option value="72h">72 часа</option>
                              <option value="manual">До ручного снятия</option>
                            </select>
                          </label>
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Dry-run preview</p>
                        <p className="mt-1 text-xs font-medium leading-relaxed text-slate-500">
                          Preview считает eligible/skipped и preset mix без создания automation run. Используйте его перед ручным SLA запуском по queue preset.
                        </p>
                      </div>
                      {latestDryRunPreview?.matchedSuppressions.length ? (
                        <span className="rounded-full bg-rose-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-rose-700">
                          Suppressed context
                        </span>
                      ) : null}
                    </div>
                    {latestDryRunPreview ? (
                      <div className="mt-3 space-y-3">
                        <div className="grid grid-cols-2 gap-2 text-[11px] font-medium text-slate-600 sm:grid-cols-4">
                          <div className="rounded-2xl bg-white px-3 py-3">
                            <span className="block text-[9px] font-bold uppercase tracking-widest text-slate-400">Target</span>
                            <span className="mt-1 block text-sm font-bold text-slate-800">{latestDryRunPreview.targetSignalCount}</span>
                          </div>
                          <div className="rounded-2xl bg-white px-3 py-3">
                            <span className="block text-[9px] font-bold uppercase tracking-widest text-slate-400">Eligible</span>
                            <span className="mt-1 block text-sm font-bold text-slate-800">{latestDryRunPreview.eligibleCount}</span>
                          </div>
                          <div className="rounded-2xl bg-white px-3 py-3">
                            <span className="block text-[9px] font-bold uppercase tracking-widest text-slate-400">Skipped</span>
                            <span className="mt-1 block text-sm font-bold text-slate-800">{latestDryRunPreview.skippedCount}</span>
                          </div>
                          <div className="rounded-2xl bg-white px-3 py-3">
                            <span className="block text-[9px] font-bold uppercase tracking-widest text-slate-400">Presets</span>
                            <span className="mt-1 block text-sm font-bold text-slate-800">{latestDryRunPreview.appliedPresets.length}</span>
                          </div>
                        </div>
                        {latestDryRunPreview.controlEventId ? (
                          <p className="text-[11px] font-medium leading-relaxed text-slate-500">
                            Preview записан в governance history и будет связан с manual execute, если запуск сделать из того же контекста.
                          </p>
                        ) : null}
                        {latestDryRunPreview.appliedPresets.length ? (
                          <div className="flex flex-wrap gap-1.5">
                            {latestDryRunPreview.appliedPresets.map((preset) => (
                              <span
                                key={`preview-${preset.presetId}`}
                                className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-600"
                              >
                                {preset.presetId} {preset.count}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="text-[11px] font-medium leading-relaxed text-slate-500">
                            В текущем preview не найдено ни одного eligible escalation preset.
                          </p>
                        )}
                        {latestDryRunPreview.matchedSuppressions.length ? (
                          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-3 dark:border-rose-800/40 dark:bg-rose-900/20">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-rose-700 dark:text-rose-300">Matched suppressions</p>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {latestDryRunPreview.matchedSuppressions.map((suppression) => (
                                <span
                                  key={`preview-suppression-${suppression.id}`}
                                  className="rounded-full border border-rose-200 bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-rose-700"
                                >
                                  {getSuppressionLabel(suppression)} • {getSuppressionStatusText(suppression)}
                                </span>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <p className="mt-3 text-[11px] font-medium leading-relaxed text-slate-500">
                        Пока нет preview. Запустите `Dry-run preview` на одной из SLA queue cards выше.
                      </p>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                  <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Governance history</p>
                        <p className="mt-1 text-xs font-medium leading-relaxed text-slate-500">
                          Manual preview и execute теперь идут в одной цепочке. Execute показывает, был ли он запущен из последнего dry-run.
                        </p>
                      </div>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-600">
                        {filteredAutomationControlEvents.length}
                      </span>
                    </div>
                    {filteredAutomationControlEvents.length ? (
                      <div className="mt-3 space-y-2">
                        {filteredAutomationControlEvents.map((event) => {
                          const linkedEvent = event.linkedEventId ? automationControlEventById.get(event.linkedEventId) ?? null : null;

                          return (
                            <div key={event.id} className="rounded-2xl border border-slate-200 bg-white px-3 py-3">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="truncate text-[12px] font-bold text-slate-800">
                                    {event.triggerLabel ?? event.savedViewName ?? (event.eventType === 'preview' ? 'Manual preview' : 'Manual execute')}
                                  </p>
                                  <p className="mt-1 text-[11px] font-medium leading-relaxed text-slate-500">
                                    {event.actorEmail} • {formatRunDateTime(event.createdAt)}
                                  </p>
                                  {linkedEvent ? (
                                    <p className="mt-1 text-[10px] font-medium leading-relaxed text-slate-500">
                                      Из preview {formatRunDateTime(linkedEvent.createdAt)}
                                    </p>
                                  ) : null}
                                </div>
                                <div className="flex flex-wrap items-center justify-end gap-2">
                                  <span className={cn(
                                    'rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest',
                                    getAutomationControlEventClass(event),
                                  )}>
                                    {getAutomationControlEventText(event)}
                                  </span>
                                  <span className={cn(
                                    'rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest',
                                    event.status === 'failed' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600',
                                  )}>
                                    {event.status}
                                  </span>
                                </div>
                              </div>
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
                                  Target {event.targetSignalCount}
                                </span>
                                <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
                                  Eligible {event.eligibleCount}
                                </span>
                                <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
                                  Applied {event.affectedCount}
                                </span>
                                <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
                                  Skipped {event.skippedCount}
                                </span>
                                {event.matchedSuppressionCount ? (
                                  <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-rose-700 dark:border-rose-800/40 dark:bg-rose-900/20 dark:text-rose-300">
                                    Suppressions {event.matchedSuppressionCount}
                                  </span>
                                ) : null}
                                {event.savedViewName ? (
                                  <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-600">
                                    View: {event.savedViewName}
                                  </span>
                                ) : null}
                                {event.sharedOwnerEmail ? (
                                  <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-600">
                                    Owner: {event.sharedOwnerEmail}
                                  </span>
                                ) : null}
                              </div>
                              {event.errorMessage ? (
                                <p className="mt-2 text-[11px] font-medium leading-relaxed text-rose-600">
                                  {event.errorMessage}
                                </p>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="mt-3 text-[11px] font-medium leading-relaxed text-slate-500">
                        Manual governance history пока пустой. Сначала сделайте dry-run preview или manual execute.
                      </p>
                    )}
                  </div>
                  <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Suppression audit</p>
                        <p className="mt-1 text-xs font-medium leading-relaxed text-slate-500">
                          Здесь живёт lifecycle suppression: reason, until и кто снял ограничение. История не теряется после unsuppress.
                        </p>
                      </div>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-600">
                        {filteredAutomationSuppressions.length}
                      </span>
                    </div>
                    {filteredAutomationSuppressions.length ? (
                      <div className="mt-3 space-y-2">
                        {filteredAutomationSuppressions.slice(0, 8).map((suppression) => (
                          <div key={suppression.id} className="rounded-2xl border border-slate-200 bg-white px-3 py-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate text-[12px] font-bold text-slate-800">{getSuppressionLabel(suppression)}</p>
                                <p className="mt-1 text-[11px] font-medium leading-relaxed text-slate-500">
                                  {suppression.actorEmail} • {formatRunDateTime(suppression.createdAt)}
                                </p>
                              </div>
                              <span className={cn(
                                'rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest',
                                getSuppressionStatusClass(suppression),
                              )}>
                                {getSuppressionStatusText(suppression)}
                              </span>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
                                Until {formatSuppressionUntil(suppression.suppressUntil)}
                              </span>
                              {suppression.reason ? (
                                <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
                                  Reason: {suppression.reason}
                                </span>
                              ) : null}
                              {suppression.clearedByEmail ? (
                                <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
                                  Cleared by {suppression.clearedByEmail}
                                </span>
                              ) : null}
                            </div>
                            {suppression.clearedAt ? (
                              <p className="mt-2 text-[11px] font-medium leading-relaxed text-slate-500">
                                Cleared {formatRunDateTime(suppression.clearedAt)}
                                {suppression.clearReason ? ` • ${suppression.clearReason}` : ''}
                              </p>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-3 text-[11px] font-medium leading-relaxed text-slate-500">
                        Пока нет suppression history для выбранного owner context.
                      </p>
                    )}
                  </div>
                </div>
                {filteredAutomationRuns.length ? (
                  <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                    {filteredAutomationRuns.map((run: SignalAutomationRun) => {
                      const isExpanded = expandedAutomationRunId === run.id;
                      const runDetail = isExpanded ? automationRunDetailQuery.data : null;
                      const isRunDetailLoading = isExpanded && automationRunDetailQuery.isLoading;
                      const runDetailError = isExpanded ? automationRunDetailQuery.error : null;

                      return (
                        <div key={run.id} className="rounded-[1.25rem] border border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-700 dark:bg-slate-800/50">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-bold text-slate-900">
                                {run.triggerLabel ?? run.savedViewName ?? (run.automationSource === 'scheduled' ? 'Scheduled SLA sweep' : 'Ad hoc SLA automation')}
                              </p>
                              <p className="mt-1 text-[11px] font-medium leading-relaxed text-slate-500">
                                {run.actorEmail} • {formatRunDateTime(run.createdAt)}
                              </p>
                            </div>
                            <span className={cn(
                              'rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest',
                              run.status === 'failed'
                                ? 'bg-rose-100 text-rose-700'
                                : run.status === 'running'
                                  ? 'bg-amber-100 text-amber-700'
                                  : 'bg-emerald-100 text-emerald-700',
                            )}>
                              {run.status}
                            </span>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            <span className={cn(
                              'rounded-full px-2 py-0.5 text-[9px] uppercase tracking-widest',
                              run.automationSource === 'scheduled' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600',
                            )}>
                              {run.automationSource === 'scheduled' ? 'Scheduled' : 'Manual'}
                            </span>
                            {run.savedViewName ? (
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] uppercase tracking-widest text-slate-600">
                                View: {run.savedViewName}
                              </span>
                            ) : null}
                            {run.sharedOwnerEmail ? (
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] uppercase tracking-widest text-slate-600">
                                Owner: {run.sharedOwnerEmail}
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] font-medium text-slate-600 sm:grid-cols-4">
                            <div className="rounded-2xl bg-white px-3 py-2">
                              <span className="block text-[9px] font-bold uppercase tracking-widest text-slate-400">Target</span>
                              <span className="mt-1 block text-sm font-bold text-slate-800">{run.targetSignalCount}</span>
                            </div>
                            <div className="rounded-2xl bg-white px-3 py-2">
                              <span className="block text-[9px] font-bold uppercase tracking-widest text-slate-400">Eligible</span>
                              <span className="mt-1 block text-sm font-bold text-slate-800">{run.eligibleCount}</span>
                            </div>
                            <div className="rounded-2xl bg-white px-3 py-2">
                              <span className="block text-[9px] font-bold uppercase tracking-widest text-slate-400">Applied</span>
                              <span className="mt-1 block text-sm font-bold text-slate-800">{run.affectedCount}</span>
                            </div>
                            <div className="rounded-2xl bg-white px-3 py-2">
                              <span className="block text-[9px] font-bold uppercase tracking-widest text-slate-400">Skipped</span>
                              <span className="mt-1 block text-sm font-bold text-slate-800">{run.skippedCount}</span>
                            </div>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {(['pending', 'progressed', 'resolved', 'ignored'] as SignalEscalationOutcome[]).map((outcome) => {
                              const count = run.outcomeCounts[outcome];
                              if (!count) {
                                return null;
                              }

                              return (
                                <span
                                  key={`${run.id}-${outcome}`}
                                  className={cn(
                                    'rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest',
                                    getEscalationOutcomeClass(outcome),
                                  )}
                                >
                                  {getEscalationOutcomeText(outcome)} {count}
                                </span>
                              );
                            })}
                            {run.followUpCount ? (
                              <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-blue-700 dark:border-blue-800/40 dark:bg-blue-900/20 dark:text-blue-300">
                                Follow-ups {run.followUpCount}
                              </span>
                            ) : null}
                            {run.followUpWaveCount ? (
                              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-600">
                                Waves {run.followUpWaveCount}
                              </span>
                            ) : null}
                            {run.escalationAlertCount ? (
                              <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-rose-700">
                                Escalation alerts {run.escalationAlertCount}
                              </span>
                            ) : null}
                            {run.escalationWaveCount ? (
                              <span className="rounded-full border border-rose-200 bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-rose-700">
                                Escalation waves {run.escalationWaveCount}
                              </span>
                            ) : null}
                            {run.awaitingExplicitOutcomeCount ? (
                              <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-amber-700 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-300">
                                Awaiting explicit outcome {run.awaitingExplicitOutcomeCount}
                              </span>
                            ) : null}
                            {(['acknowledged', 'action_taken', 'no_action'] as SignalFollowUpResolution[]).map((resolution) => {
                              const count = run.followUpResolutionCounts[resolution];
                              if (!count) {
                                return null;
                              }

                              return (
                                <span
                                  key={`${run.id}-resolution-${resolution}`}
                                  className={cn(
                                    'rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest',
                                    getFollowUpResolutionClass(resolution),
                                  )}
                                >
                                  {getFollowUpResolutionText(resolution)} {count}
                                </span>
                              );
                            })}
                            {run.lastFollowUpAt ? (
                              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-600">
                                Last reminder {formatRunDateTime(run.lastFollowUpAt)}
                              </span>
                            ) : null}
                            {run.lastEscalationAlertAt ? (
                              <span className="rounded-full border border-rose-200 bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-rose-700">
                                Last escalation {formatRunDateTime(run.lastEscalationAlertAt)}
                              </span>
                            ) : null}
                            {run.latestFollowUpResolutionAt ? (
                              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-600">
                                Last resolution {formatRunDateTime(run.latestFollowUpResolutionAt)}
                              </span>
                            ) : null}
                          </div>
                          {run.latestFollowUpWave ? (
                            <div className="mt-3 rounded-2xl border border-blue-200 bg-blue-50 px-3 py-3 dark:border-blue-800/40 dark:bg-blue-900/20">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="text-[10px] font-bold uppercase tracking-widest text-blue-700 dark:text-blue-300">Latest follow-up wave</p>
                                  <p className="mt-1 text-[11px] font-medium leading-relaxed text-blue-800">
                                    {run.latestFollowUpWave.actorEmail} • {formatRunDateTime(run.latestFollowUpWave.createdAt)} • {run.latestFollowUpWave.targetCount} сигналов
                                  </p>
                                </div>
                              </div>
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {(['pending', 'progressed', 'resolved', 'ignored'] as SignalEscalationOutcome[]).map((outcome) => {
                                  const count = run.latestFollowUpWave?.outcomeCounts[outcome] ?? 0;
                                  if (!count) {
                                    return null;
                                  }

                                  return (
                                    <span
                                      key={`${run.id}-follow-up-wave-${outcome}`}
                                      className={cn(
                                        'rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest',
                                        getEscalationOutcomeClass(outcome),
                                      )}
                                    >
                                      {getEscalationOutcomeText(outcome)} {count}
                                    </span>
                                  );
                                })}
                                {(['acknowledged', 'action_taken', 'no_action'] as SignalFollowUpResolution[]).map((resolution) => {
                                  const count = run.latestFollowUpWave?.resolutionCounts[resolution] ?? 0;
                                  if (!count) {
                                    return null;
                                  }

                                  return (
                                    <span
                                      key={`${run.id}-latest-follow-up-resolution-${resolution}`}
                                      className={cn(
                                        'rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest',
                                        getFollowUpResolutionClass(resolution),
                                      )}
                                    >
                                      {getFollowUpResolutionText(resolution)} {count}
                                    </span>
                                  );
                                })}
                                {run.latestFollowUpWave.awaitingExplicitOutcomeCount ? (
                                  <span className="rounded-full border border-amber-200 bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-amber-700">
                                    Awaiting explicit outcome {run.latestFollowUpWave.awaitingExplicitOutcomeCount}
                                  </span>
                                ) : null}
                                {run.latestFollowUpWave.escalationAlertCount ? (
                                  <span className="rounded-full border border-rose-200 bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-rose-700">
                                    Escalations {run.latestFollowUpWave.escalationAlertCount}
                                  </span>
                                ) : null}
                                {run.latestFollowUpWave.lastEscalationAlertAt ? (
                                  <span className="rounded-full border border-rose-200 bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-rose-700">
                                    Last escalation {formatRunDateTime(run.latestFollowUpWave.lastEscalationAlertAt)}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          ) : null}
                          <div className="mt-3 flex items-center justify-between gap-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setExpandedAutomationRunId((current) => current === run.id ? null : run.id)}
                                className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-bold text-slate-700 transition-colors hover:bg-slate-100"
                              >
                                {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                                {isExpanded ? 'Скрыть сигналы' : 'Детали run'}
                              </button>
                              {canManage && run.outcomeCounts.pending > 0 ? (
                                <button
                                  type="button"
                                  onClick={() => slaFollowUpMutation.mutate(run.id)}
                                  disabled={isSlaFollowUpMutating}
                                  className="inline-flex items-center gap-1.5 rounded-2xl border border-blue-200 bg-blue-50 px-3 py-2 text-[11px] font-bold text-blue-700 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-blue-800/40 dark:bg-blue-900/20 dark:text-blue-300 dark:hover:bg-blue-900/30"
                                >
                                  <BellRing className="h-3.5 w-3.5" />
                                  {isSlaFollowUpMutating ? 'Напоминаю...' : 'Напомнить pending'}
                                </button>
                              ) : null}
                            </div>
                            <div className="text-right">
                              {run.finishedAt ? (
                                <span className="block text-[10px] font-bold uppercase tracking-widest text-slate-400">
                                  Finished {formatRunDateTime(run.finishedAt)}
                                </span>
                              ) : null}
                              {run.lastFollowUpAt ? (
                                <span className="mt-1 block text-[10px] font-bold uppercase tracking-widest text-slate-400">
                                  Follow-up {formatRunDateTime(run.lastFollowUpAt)}
                                </span>
                              ) : null}
                              {run.lastEscalationAlertAt ? (
                                <span className="mt-1 block text-[10px] font-bold uppercase tracking-widest text-rose-400">
                                  Escalation {formatRunDateTime(run.lastEscalationAlertAt)}
                                </span>
                              ) : null}
                            </div>
                          </div>
                          {run.errorMessage ? (
                            <p className="mt-3 text-[11px] font-medium leading-relaxed text-rose-600">
                              {run.errorMessage}
                            </p>
                          ) : null}
                          {isExpanded ? (
                            <div className="mt-4 rounded-[1.25rem] border border-slate-200 bg-white p-3">
                              {isRunDetailLoading ? (
                                <div className="animate-pulse rounded-2xl bg-slate-100 p-4 text-sm text-slate-400">
                                  Загружаю сигналы automation run...
                                </div>
                              ) : runDetailError ? (
                                <p className="text-[11px] font-medium leading-relaxed text-rose-600">
                                  {runDetailError.message}
                                </p>
                              ) : runDetail?.signals.length ? (
                                <div className="space-y-3">
                                  {runDetail.followUpWaves.length ? (
                                    <div className="rounded-2xl border border-blue-200 bg-blue-50 px-3 py-3 dark:border-blue-800/40 dark:bg-blue-900/20">
                                      <p className="text-[10px] font-bold uppercase tracking-widest text-blue-700 dark:text-blue-300">Follow-up waves</p>
                                      <div className="mt-3 space-y-2">
                                        {runDetail.followUpWaves.map((wave, index) => (
                                          <div key={`${run.id}-wave-${wave.batchId}`} className="rounded-2xl border border-blue-200/60 bg-white px-3 py-3">
                                            <div className="flex items-start justify-between gap-3">
                                              <div>
                                                <p className="text-[11px] font-bold uppercase tracking-widest text-slate-700">
                                                  Wave {runDetail.followUpWaves.length - index}
                                                </p>
                                                <p className="mt-1 text-[11px] font-medium leading-relaxed text-slate-500">
                                                  {wave.actorEmail} • {formatRunDateTime(wave.createdAt)} • {wave.targetCount} сигналов
                                                </p>
                                                {wave.latestResolutionAt ? (
                                                  <p className="mt-1 text-[10px] font-medium leading-relaxed text-slate-500">
                                                    Latest explicit outcome: {formatRunDateTime(wave.latestResolutionAt)}
                                                  </p>
                                                ) : null}
                                              </div>
                                              <span className={cn(
                                                'rounded-full px-2 py-0.5 text-[9px] uppercase tracking-widest',
                                                wave.automationSource === 'scheduled' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600',
                                              )}>
                                                {wave.automationSource === 'scheduled' ? 'Scheduled' : 'Manual'}
                                              </span>
                                            </div>
                                            <div className="mt-2 flex flex-wrap gap-1.5">
                                              {(['pending', 'progressed', 'resolved', 'ignored'] as SignalEscalationOutcome[]).map((outcome) => {
                                                const count = wave.outcomeCounts[outcome];
                                                if (!count) {
                                                  return null;
                                                }

                                                return (
                                                  <span
                                                    key={`${wave.batchId}-${outcome}`}
                                                    className={cn(
                                                      'rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest',
                                                      getEscalationOutcomeClass(outcome),
                                                    )}
                                                  >
                                                    {getEscalationOutcomeText(outcome)} {count}
                                                  </span>
                                                );
                                              })}
                                              {(['acknowledged', 'action_taken', 'no_action'] as SignalFollowUpResolution[]).map((resolution) => {
                                                const count = wave.resolutionCounts[resolution];
                                                if (!count) {
                                                  return null;
                                                }

                                                return (
                                                  <span
                                                    key={`${wave.batchId}-${resolution}`}
                                                    className={cn(
                                                      'rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest',
                                                      getFollowUpResolutionClass(resolution),
                                                    )}
                                                  >
                                                    {getFollowUpResolutionText(resolution)} {count}
                                                  </span>
                                                );
                                              })}
                                              {wave.awaitingExplicitOutcomeCount ? (
                                                <span className="rounded-full border border-amber-200 bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-amber-700">
                                                  Awaiting explicit outcome {wave.awaitingExplicitOutcomeCount}
                                                </span>
                                              ) : null}
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  ) : null}
                                  {runDetail.signals.map((signal) => (
                                    <div key={`${run.id}-${signal.signalId}`} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 dark:border-slate-700 dark:bg-slate-800/50">
                                      <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                          <p className="truncate text-[12px] font-bold text-slate-800">{signal.title}</p>
                                          <p className="mt-1 text-[11px] font-medium leading-relaxed text-slate-500">
                                            {signal.noteBody ?? 'SLA note without body'} • {formatRunDateTime(signal.createdAt)}
                                          </p>
                                        </div>
                                        <button
                                          type="button"
                                          onClick={() => openSignal(signal.signalId)}
                                          className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] font-bold text-slate-700 transition-colors hover:bg-slate-100"
                                        >
                                          Открыть
                                          <ArrowRight className="h-3 w-3" />
                                        </button>
                                      </div>
                                      <div className="mt-2 flex flex-wrap gap-1.5">
                                        <span className={cn(
                                          'rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest',
                                          getWorkflowStateClass(signal.workflowState),
                                        )}>
                                          {getWorkflowStateLabel(signal.workflowState)}
                                        </span>
                                        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-600">
                                          {getAssigneeLabel(signal.assigneeEmail, signal.assigneeUserId)}
                                        </span>
                                        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest ${getSlaStateClass(signal.aging.slaState)}`}>
                                          {signal.aging.slaLabel}
                                        </span>
                                        <span className={cn(
                                          'rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest',
                                          getEscalationOutcomeClass(signal.outcome),
                                        )}>
                                          {signal.outcomeLabel}
                                        </span>
                                        {signal.presetId ? (
                                          <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-600">
                                            {signal.presetId}
                                          </span>
                                        ) : null}
                                        {signal.followUpCount ? (
                                          <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-blue-700 dark:border-blue-800/40 dark:bg-blue-900/20 dark:text-blue-300">
                                            Follow-ups {signal.followUpCount}
                                          </span>
                                        ) : null}
                                        {signal.escalationAlertCount ? (
                                          <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-rose-700 dark:border-rose-800/40 dark:bg-rose-900/20 dark:text-rose-300">
                                            Escalations {signal.escalationAlertCount}
                                          </span>
                                        ) : null}
                                        {signal.lastFollowUpAt ? (
                                          <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-600">
                                            Reminder {formatRunDateTime(signal.lastFollowUpAt)}
                                          </span>
                                        ) : null}
                                        {signal.lastEscalationAlertAt ? (
                                          <span className="rounded-full border border-rose-200 bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-rose-700">
                                            Escalated {formatRunDateTime(signal.lastEscalationAlertAt)}
                                          </span>
                                        ) : null}
                                        {signal.awaitingFollowUpOutcome ? (
                                          <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-amber-700 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-300">
                                            Awaiting explicit outcome
                                          </span>
                                        ) : null}
                                        {signal.followUpResolution ? (
                                          <span className={cn(
                                            'rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest',
                                            getFollowUpResolutionClass(signal.followUpResolution.resolution),
                                          )}>
                                            {getFollowUpResolutionText(signal.followUpResolution.resolution)}
                                          </span>
                                        ) : null}
                                      </div>
                                      {canComment && signal.latestFollowUpBatchId ? (
                                        <div className="mt-3 flex flex-wrap gap-2">
                                          {(['acknowledged', 'action_taken', 'no_action'] as SignalFollowUpResolution[]).map((resolution) => (
                                            <button
                                              key={`${signal.signalId}-${resolution}`}
                                              type="button"
                                              onClick={() => followUpResolutionMutation.mutate({
                                                signalId: signal.signalId,
                                                sourceAutomationRunId: run.id,
                                                followUpBatchId: signal.latestFollowUpBatchId!,
                                                resolution,
                                              })}
                                              disabled={isFollowUpResolutionMutating}
                                              className={cn(
                                                'inline-flex items-center rounded-2xl border px-3 py-2 text-[11px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                                                getFollowUpResolutionClass(resolution),
                                              )}
                                            >
                                              {getFollowUpResolutionText(resolution)}
                                            </button>
                                          ))}
                                        </div>
                                      ) : null}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-[11px] font-medium leading-relaxed text-slate-500">
                                  Для этого run не найдено связанных SLA note events.
                                </p>
                              )}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs font-medium text-slate-500">
                    {queueOwnerFilter === 'all'
                      ? 'Пока нет записанных SLA automation runs. Первый manual run или scheduled sweep появится здесь автоматически.'
                      : 'Для выбранного queue owner пока нет SLA automation runs.'}
                  </p>
                )}
              </div>
            </div>

            <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Saved views</p>
                    <p className="mt-1 text-xs font-medium leading-relaxed text-slate-500">
                      Сохраняют ваш рабочий preset: queue view + assignee filter + workflow filter + sort preset. Team views дополнительно живут в owner-очередях.
                    </p>
                    {effectiveDefaultSavedView ? (
                      <p className="mt-2 text-[11px] font-medium leading-relaxed text-slate-500">
                        Автоприменяется{' '}
                        <span className="font-bold text-slate-700">
                          {effectiveDefaultSavedView.name}
                        </span>
                        {effectiveDefaultSavedView.isTeamDefault
                          ? effectiveDefaultSavedView.sharedOwnerUserId
                            ? ` как owner default для ${effectiveDefaultSavedView.sharedOwnerEmail ?? 'выбранной owner queue'}.`
                            : ' как team default fallback.'
                          : ' как ваш personal default.'}
                      </p>
                    ) : null}
                  </div>
                  {filteredPinnedSavedViews.length ? (
                    <div className="space-y-2">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Pinned shortcuts</p>
                      <div className="flex flex-wrap gap-2">
                        {filteredPinnedSavedViews.map((view) => {
                          const active = activeSavedView?.id === view.id;
                          const suppression = getSavedViewSuppression(view.id);

                          return (
                            <button
                              key={view.id}
                              type="button"
                              onClick={() => applySavedView(view)}
                              className={cn(
                                'inline-flex items-center gap-2 rounded-full border px-3 py-2 text-left transition-colors',
                                active
                                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-900/20 dark:text-emerald-300'
                                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700/50',
                              )}
                            >
                              <Pin className={cn('h-3.5 w-3.5', view.isPinned ? 'fill-current' : '')} />
                              <span className="text-[11px] font-bold">{view.name}</span>
                              {view.scope === 'team' ? (
                                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[9px] uppercase tracking-widest text-blue-700">
                                  Team
                                </span>
                              ) : null}
                              {view.scope === 'team' && view.sharedOwnerEmail ? (
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] uppercase tracking-widest text-slate-600">
                                  Owner: {view.sharedOwnerEmail}
                                </span>
                              ) : null}
                              {suppression ? (
                                <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[9px] uppercase tracking-widest text-rose-700">
                                  Suppressed
                                </span>
                              ) : null}
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] uppercase tracking-widest text-slate-600">
                                {view.sortPreset === 'sla_pressure' ? 'SLA sort' : view.sortPreset === 'newest' ? 'Newest' : 'Severity'}
                              </span>
                              {getSavedViewDefaultLabel(view) ? (
                                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] uppercase tracking-widest text-amber-700">
                                  {getSavedViewDefaultLabel(view)}
                                </span>
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                  {savedViews.length ? (
                    <div className="space-y-3">
                      {privateSavedViews.length ? (
                        <div className="space-y-2">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">My views</p>
                          <div className="grid grid-cols-1 gap-2">
                            {privateSavedViews.map((view) => {
                              const active = activeSavedView?.id === view.id;
                              const suppression = getSavedViewSuppression(view.id);

                              return (
                                <div
                                  key={view.id}
                                  className={cn(
                                    'rounded-[1.25rem] border px-3 py-3',
                                    active ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800/40 dark:bg-emerald-900/20' : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800',
                                  )}
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <button
                                      type="button"
                                      onClick={() => applySavedView(view)}
                                      data-testid={`saved-signal-view-${view.id}`}
                                      className="min-w-0 text-left"
                                    >
                                      <p className="truncate text-[12px] font-bold text-slate-800">{view.name}</p>
                                      <div className="mt-1 flex flex-wrap gap-1.5">
                                        {getSavedViewDefaultLabel(view) ? (
                                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] uppercase tracking-widest text-amber-700">
                                            {getSavedViewDefaultLabel(view)}
                                          </span>
                                        ) : null}
                                        {view.isPinned ? (
                                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] uppercase tracking-widest text-slate-600">
                                            Pinned
                                          </span>
                                        ) : null}
                                        {suppression ? (
                                          <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[9px] uppercase tracking-widest text-rose-700">
                                            Suppressed
                                          </span>
                                        ) : null}
                                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] uppercase tracking-widest text-slate-600">
                                          {view.sortPreset === 'sla_pressure' ? 'SLA sort' : view.sortPreset === 'newest' ? 'Newest' : 'Severity'}
                                        </span>
                                      </div>
                                    </button>

                                    <div className="flex items-center gap-1">
                                      {view.canSetDefault ? (
                                        <button
                                          type="button"
                                          onClick={() => defaultViewMutation.mutate({ savedViewId: view.id, isDefault: !view.isDefault })}
                                          disabled={isSavedViewMutating}
                                          data-testid={`toggle-default-saved-signal-view-${view.id}`}
                                          title={view.isDefault ? 'Снять personal default' : 'Сделать personal default'}
                                          className={cn(
                                            'inline-flex items-center justify-center rounded-full p-1 transition-colors disabled:opacity-60',
                                            view.isDefault ? 'text-amber-500 hover:text-amber-600' : 'text-slate-300 hover:text-slate-500',
                                          )}
                                        >
                                          <Star className={cn('h-3.5 w-3.5', view.isDefault ? 'fill-current' : '')} />
                                        </button>
                                      ) : null}
                                      {view.canTogglePin ? (
                                        <button
                                          type="button"
                                          onClick={() => pinViewMutation.mutate({ savedViewId: view.id, isPinned: !view.isPinned })}
                                          disabled={isSavedViewMutating}
                                          data-testid={`toggle-pin-saved-signal-view-${view.id}`}
                                          title={view.isPinned ? 'Убрать pin' : 'Закрепить'}
                                          className={cn(
                                            'inline-flex items-center justify-center rounded-full p-1 transition-colors disabled:opacity-60',
                                            view.isPinned ? 'text-slate-700 hover:text-slate-900' : 'text-slate-300 hover:text-slate-500',
                                          )}
                                        >
                                          <Pin className={cn('h-3.5 w-3.5', view.isPinned ? 'fill-current' : '')} />
                                        </button>
                                      ) : null}
                                      {canManage ? (
                                        <button
                                          type="button"
                                          onClick={() => suppressionMutation.mutate({
                                            targetType: 'saved_view',
                                            savedViewId: view.id,
                                            isSuppressed: Boolean(suppression),
                                            reason: suppression ? null : suppressionReason,
                                            suppressUntil: suppression ? null : suppressionUntilIso,
                                            clearReason: suppression ? suppressionReason || null : null,
                                          })}
                                          disabled={isSuppressionMutating || (!suppression && !canCreateSuppression)}
                                          title={suppression ? 'Возобновить automation для view' : 'Подавить automation для view'}
                                          className={cn(
                                            'inline-flex items-center justify-center rounded-full p-1 transition-colors disabled:opacity-60',
                                            suppression ? 'text-rose-600 hover:text-emerald-700' : 'text-slate-300 hover:text-rose-600',
                                          )}
                                        >
                                          <EyeOff className="h-3.5 w-3.5" />
                                        </button>
                                      ) : null}
                                      {view.canReorder ? (
                                        <>
                                          <button
                                            type="button"
                                            onClick={() => moveViewMutation.mutate({ savedViewId: view.id, direction: 'up' })}
                                            disabled={isSavedViewMutating}
                                            className="inline-flex items-center justify-center rounded-full p-1 text-slate-300 transition-colors hover:text-slate-500 disabled:opacity-60"
                                            title="Сдвинуть вверх"
                                          >
                                            <ArrowUp className="h-3.5 w-3.5" />
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => moveViewMutation.mutate({ savedViewId: view.id, direction: 'down' })}
                                            disabled={isSavedViewMutating}
                                            className="inline-flex items-center justify-center rounded-full p-1 text-slate-300 transition-colors hover:text-slate-500 disabled:opacity-60"
                                            title="Сдвинуть вниз"
                                          >
                                            <ArrowDown className="h-3.5 w-3.5" />
                                          </button>
                                        </>
                                      ) : null}
                                      {view.canDelete ? (
                                        <button
                                          type="button"
                                          onClick={() => deleteViewMutation.mutate(view.id)}
                                          disabled={isSavedViewMutating}
                                          data-testid={`delete-saved-signal-view-${view.id}`}
                                          className="text-[11px] font-bold text-slate-400 transition-colors hover:text-rose-600 disabled:opacity-60"
                                        >
                                          ×
                                        </button>
                                      ) : null}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}

                      {filteredTeamSavedViews.length ? (
                        <div className="space-y-2">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Team views by owner</p>
                          <div className="space-y-3">
                            {groupedTeamSavedViews.map((group) => (
                              <div key={group.key} className="space-y-2">
                                <div className="flex items-center justify-between gap-3">
                                  <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">{group.label}</p>
                                  {canManage ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setManualSavedViewScope('team');
                                        setManualSharedOwnerUserId(group.key === 'unassigned' ? null : group.key);
                                        if (!savedViewNameDraft.trim()) {
                                          setSavedViewNameDraft(`Queue: ${group.label}`);
                                        }
                                      }}
                                      className="text-[10px] font-bold uppercase tracking-widest text-blue-600 transition-colors hover:text-blue-700"
                                    >
                                      New owner view
                                    </button>
                                  ) : null}
                                </div>
                                <div className="grid grid-cols-1 gap-2">
                                  {group.views.map((view) => {
                                    const active = activeSavedView?.id === view.id;
                                    const suppression = getSavedViewSuppression(view.id);

                                    return (
                                      <div
                                        key={view.id}
                                        className={cn(
                                          'rounded-[1.25rem] border px-3 py-3',
                                          active ? 'border-blue-300 bg-blue-50 dark:border-blue-800/40 dark:bg-blue-900/20' : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800',
                                        )}
                                      >
                                        <div className="flex items-start justify-between gap-3">
                                          <button
                                            type="button"
                                            onClick={() => applySavedView(view)}
                                            data-testid={`saved-signal-view-${view.id}`}
                                            className="min-w-0 text-left"
                                          >
                                            <p className="truncate text-[12px] font-bold text-slate-800">{view.name}</p>
                                            <div className="mt-1 flex flex-wrap gap-1.5">
                                              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[9px] uppercase tracking-widest text-blue-700">
                                                Team
                                              </span>
                                              {view.isTeamDefault ? (
                                                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] uppercase tracking-widest text-amber-700">
                                                  {getSavedViewDefaultLabel(view)}
                                                </span>
                                              ) : null}
                                              {view.isPinned ? (
                                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] uppercase tracking-widest text-slate-600">
                                                  Pinned
                                                </span>
                                              ) : null}
                                              {suppression ? (
                                                <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[9px] uppercase tracking-widest text-rose-700">
                                                  Suppressed
                                                </span>
                                              ) : null}
                                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] uppercase tracking-widest text-slate-600">
                                                {view.sortPreset === 'sla_pressure' ? 'SLA sort' : view.sortPreset === 'newest' ? 'Newest' : 'Severity'}
                                              </span>
                                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] uppercase tracking-widest text-slate-600">
                                                {view.sharedOwnerEmail ? `Owner: ${view.sharedOwnerEmail}` : view.ownerEmail ?? 'creator hidden'}
                                              </span>
                                            </div>
                                          </button>

                                          <div className="flex items-center gap-1">
                                            {view.canSetTeamDefault ? (
                                              <button
                                                type="button"
                                                onClick={() => defaultViewMutation.mutate({ savedViewId: view.id, isDefault: !view.isTeamDefault })}
                                                disabled={isSavedViewMutating}
                                                className={cn(
                                                  'inline-flex items-center justify-center rounded-full p-1 transition-colors disabled:opacity-60',
                                                  view.isTeamDefault ? 'text-amber-500 hover:text-amber-600' : 'text-slate-300 hover:text-slate-500',
                                                )}
                                                title={view.isTeamDefault
                                                  ? `Снять ${view.sharedOwnerUserId ? 'owner default' : 'team default'}`
                                                  : `Сделать ${view.sharedOwnerUserId ? 'owner default' : 'team default'}`}
                                              >
                                                <Star className={cn('h-3.5 w-3.5', view.isTeamDefault ? 'fill-current' : '')} />
                                              </button>
                                            ) : null}
                                            {view.canTogglePin ? (
                                              <button
                                                type="button"
                                                onClick={() => pinViewMutation.mutate({ savedViewId: view.id, isPinned: !view.isPinned })}
                                                disabled={isSavedViewMutating}
                                                className={cn(
                                                  'inline-flex items-center justify-center rounded-full p-1 transition-colors disabled:opacity-60',
                                                  view.isPinned ? 'text-slate-700 hover:text-slate-900' : 'text-slate-300 hover:text-slate-500',
                                                )}
                                                title={view.isPinned ? 'Убрать pin' : 'Закрепить'}
                                              >
                                                <Pin className={cn('h-3.5 w-3.5', view.isPinned ? 'fill-current' : '')} />
                                              </button>
                                            ) : null}
                                            {canManage ? (
                                              <button
                                                type="button"
                                                onClick={() => suppressionMutation.mutate({
                                                  targetType: 'saved_view',
                                                  savedViewId: view.id,
                                                  isSuppressed: Boolean(suppression),
                                                  reason: suppression ? null : suppressionReason,
                                                  suppressUntil: suppression ? null : suppressionUntilIso,
                                                  clearReason: suppression ? suppressionReason || null : null,
                                                })}
                                                disabled={isSuppressionMutating || (!suppression && !canCreateSuppression)}
                                                title={suppression ? 'Возобновить automation для team view' : 'Подавить automation для team view'}
                                                className={cn(
                                                  'inline-flex items-center justify-center rounded-full p-1 transition-colors disabled:opacity-60',
                                                  suppression ? 'text-rose-600 hover:text-emerald-700' : 'text-slate-300 hover:text-rose-600',
                                                )}
                                              >
                                                <EyeOff className="h-3.5 w-3.5" />
                                              </button>
                                            ) : null}
                                            {view.canReorder ? (
                                              <>
                                                <button
                                                  type="button"
                                                  onClick={() => moveViewMutation.mutate({ savedViewId: view.id, direction: 'up' })}
                                                  disabled={isSavedViewMutating}
                                                  className="inline-flex items-center justify-center rounded-full p-1 text-slate-300 transition-colors hover:text-slate-500 disabled:opacity-60"
                                                  title="Сдвинуть вверх"
                                                >
                                                  <ArrowUp className="h-3.5 w-3.5" />
                                                </button>
                                                <button
                                                  type="button"
                                                  onClick={() => moveViewMutation.mutate({ savedViewId: view.id, direction: 'down' })}
                                                  disabled={isSavedViewMutating}
                                                  className="inline-flex items-center justify-center rounded-full p-1 text-slate-300 transition-colors hover:text-slate-500 disabled:opacity-60"
                                                  title="Сдвинуть вниз"
                                                >
                                                  <ArrowDown className="h-3.5 w-3.5" />
                                                </button>
                                              </>
                                            ) : null}
                                            {view.canDelete ? (
                                              <button
                                                type="button"
                                                onClick={() => deleteViewMutation.mutate(view.id)}
                                                disabled={isSavedViewMutating}
                                                className="text-[11px] font-bold text-slate-400 transition-colors hover:text-rose-600 disabled:opacity-60"
                                              >
                                                ×
                                              </button>
                                            ) : null}
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {teamSavedViews.length > 0 && !filteredTeamSavedViews.length && queueOwnerFilter !== 'all' ? (
                        <p className="text-[11px] font-medium leading-relaxed text-slate-500">
                          Для выбранного queue owner пока нет team views. Можно создать новый owner-specific view из формы справа.
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <p className="text-xs font-medium text-slate-500">
                      Пока нет сохранённых видов. Сохраните свой queue preset или соберите team view для общей очереди.
                    </p>
                  )}
                </div>

                <div className="w-full max-w-md space-y-3">
                  <input
                    value={savedViewInputValue}
                    onChange={(event) => setSavedViewNameDraft(event.target.value)}
                    disabled={isSavedViewMutating}
                    data-testid="save-signal-view-name"
                    placeholder="Например: Очередь владельца"
                    className="w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-300 outline-none transition focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100"
                  />
                  <p className="text-[11px] font-medium leading-relaxed text-slate-500">
                    {activeSavedView
                      ? isEditingSavedView
                        ? 'Редактируете сохранённый вид: можно менять имя, scope и текущий preset. Для shared view звезда управляет либо global team default, либо owner default внутри конкретной owner queue.'
                        : 'Этот team view доступен только для применения. Можно сохранить private clone с текущим preset.'
                      : 'Текущий preset сохранится как новый view. Team view доступен всей команде, а shared view со звездой станет либо global team fallback, либо owner default внутри своей queue.'}
                  </p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-2 inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                        Scope
                      </span>
                      <select
                        value={savedViewScopeDraft}
                        onChange={(event) => {
                          const nextScope = event.target.value as SignalSavedViewScope;
                          setManualSavedViewScope(nextScope);
                          if (nextScope !== 'team') {
                            setManualSharedOwnerUserId(null);
                          }
                        }}
                        disabled={isSavedViewMutating}
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 outline-none transition focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100 disabled:bg-slate-50"
                      >
                        <option value="private">Private</option>
                        <option value="team" disabled={!canManage}>Team shared</option>
                      </select>
                    </label>
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Sort preset</p>
                      <p className="mt-2 text-sm font-bold text-slate-800">
                        {sortPreset === 'sla_pressure' ? 'SLA pressure' : sortPreset === 'newest' ? 'Newest touched' : 'Severity + SLA'}
                      </p>
                    </div>
                  </div>
                  {savedViewScopeDraft === 'team' ? (
                    <label className="block">
                      <span className="mb-2 inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                        Queue owner
                      </span>
                      <select
                        value={savedViewSharedOwnerDraft}
                        onChange={(event) => setManualSharedOwnerUserId(event.target.value || null)}
                        disabled={isSavedViewMutating || !canManage}
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 outline-none transition focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100 disabled:bg-slate-50"
                      >
                        <option value="">Без owner</option>
                        {availableAssignees.map((member) => (
                          <option key={member.userId} value={member.userId}>
                            {getAssigneeLabel(member.email, member.userId)}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      if (activeSavedView && isEditingSavedView) {
                        updateViewMutation.mutate(activeSavedView.id);
                        return;
                      }

                      saveViewMutation.mutate();
                    }}
                    disabled={isSavedViewMutating || resolvedSavedViewName.length < 2}
                    data-testid={activeSavedView && isEditingSavedView ? 'update-signal-view' : 'save-signal-view'}
                    className="inline-flex w-full items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {saveViewMutation.isPending || updateViewMutation.isPending
                      ? 'Сохранение...'
                      : activeSavedView && isEditingSavedView
                        ? 'Сохранить изменения вида'
                        : activeSavedView
                          ? 'Сохранить как новый view'
                          : 'Сохранить текущий вид'}
                  </button>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-2 inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  <Filter className="h-3.5 w-3.5" />
                  Ответственный
                </span>
                <select
                  value={assigneeFilter}
                  onChange={(event) => setManualAssigneeFilter(event.target.value)}
                  data-testid="signal-assignee-filter"
                  className="w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-300 outline-none transition focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100"
                >
                  <option value="all">Все сигналы</option>
                  <option value="unassigned">Без ответственного</option>
                  {availableAssignees.map((member) => (
                    <option key={member.userId} value={member.userId}>
                      {getAssigneeLabel(member.email, member.userId)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-2 inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  <Filter className="h-3.5 w-3.5" />
                  Workflow
                </span>
                <select
                  value={workflowFilter}
                  onChange={(event) => setManualWorkflowFilter(event.target.value as 'all' | SignalWorkflowState)}
                  data-testid="signal-workflow-filter"
                  className="w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-300 outline-none transition focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100"
                >
                  <option value="all">Все статусы</option>
                  <option value="new">Новый</option>
                  <option value="in_progress">В работе</option>
                  <option value="handoff">Передан</option>
                  <option value="blocked">Блокер</option>
                </select>
              </label>
            </div>

            {hasActiveFilters ? (
                  <button
                type="button"
                onClick={() => {
                  clearOwnerQueueRoutePreset();
                  setManualQueueView(null);
                  setManualAssigneeFilter(null);
                  setManualWorkflowFilter(null);
                  setManualSortPreset(null);
                  setManualQueueOwnerFilter(null);
                  setManualSavedViewScope(null);
                  setManualSharedOwnerUserId(null);
                  setSavedViewNameDraft('');
                }}
                className="inline-flex items-center justify-center rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50"
              >
                Сбросить фильтры
              </button>
            ) : null}
          </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {([
              ['new', workflowCounts.new],
              ['in_progress', workflowCounts.in_progress],
              ['handoff', workflowCounts.handoff],
              ['blocked', workflowCounts.blocked],
            ] as Array<[SignalWorkflowState, number]>).map(([state, count]) => (
              <span
                key={state}
                className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${getWorkflowStateClass(state)}`}
              >
                {getWorkflowStateLabel(state)}: {count}
              </span>
            ))}
          </div>
        </div>

        {canManage ? (
          <div className="rounded-[2rem] border border-slate-200 bg-slate-950 p-4 text-white shadow-sm">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Bulk triage</p>
                  <p className="mt-1 text-sm font-medium text-slate-200">
                    Выбрано {selectedSignalIds.length} сигналов. Массово назначайте ответственного, делайте handoff и закрывайте пачки без захода в каждый drawer.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (isAllVisibleSelected) {
                        setSelectedSignalIds((current) => current.filter((id) => !filteredSignals.some((signal) => signal.id === id)));
                        return;
                      }

                      setSelectedSignalIds((current) => Array.from(new Set([...current, ...filteredSignals.map((signal) => signal.id)])));
                    }}
                    className="inline-flex items-center justify-center rounded-2xl border border-slate-700 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-slate-800"
                  >
                    {isAllVisibleSelected ? 'Снять выбор с видимых' : 'Выбрать все видимые'}
                  </button>
                  {selectedSignalIds.length ? (
                    <button
                      type="button"
                      onClick={clearBulkSelection}
                      className="inline-flex items-center justify-center rounded-2xl border border-slate-700 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-slate-800"
                    >
                      Очистить выбор
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,240px)_auto_minmax(0,220px)_auto_auto_auto]">
                <select
                  value={bulkAssigneeDraft}
                  onChange={(event) => setBulkAssigneeDraft(event.target.value)}
                  disabled={isBulkMutating}
                  data-testid="bulk-assignee-select"
                  className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm font-medium text-slate-100 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-900"
                >
                  <option value="">Без ответственного</option>
                  {availableAssignees.map((member) => (
                    <option key={member.userId} value={member.userId}>
                      {getAssigneeLabel(member.email, member.userId)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => bulkAssignMutation.mutate(bulkAssigneeDraft)}
                  disabled={!selectedVisibleSignalIds.length || isBulkMutating}
                  className="inline-flex items-center justify-center rounded-2xl bg-white px-4 py-3 text-sm font-bold text-slate-900 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {bulkAssignMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Назначить'}
                </button>

                <select
                  value={bulkWorkflowDraft}
                  onChange={(event) => setBulkWorkflowDraft(event.target.value as SignalWorkflowState)}
                  disabled={isBulkMutating}
                  data-testid="bulk-workflow-select"
                  className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm font-medium text-slate-100 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-900"
                >
                  <option value="new">Новый</option>
                  <option value="in_progress">В работе</option>
                  <option value="handoff">Передан</option>
                  <option value="blocked">Блокер</option>
                </select>
                <button
                  type="button"
                  onClick={() => bulkWorkflowMutation.mutate(bulkWorkflowDraft)}
                  disabled={!selectedVisibleSignalIds.length || isBulkMutating}
                  className="inline-flex items-center justify-center rounded-2xl bg-white px-4 py-3 text-sm font-bold text-slate-900 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {bulkWorkflowMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Применить статус'}
                </button>
                <button
                  type="button"
                  onClick={() => bulkStatusMutation.mutate('resolved')}
                  disabled={!selectedVisibleSignalIds.length || isBulkMutating}
                  className="inline-flex items-center justify-center rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {bulkStatusMutation.isPending && bulkStatusMutation.variables === 'resolved' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Resolve'}
                </button>
                <button
                  type="button"
                  onClick={() => bulkStatusMutation.mutate('ignored')}
                  disabled={!selectedVisibleSignalIds.length || isBulkMutating}
                  className="inline-flex items-center justify-center rounded-2xl border border-slate-700 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {bulkStatusMutation.isPending && bulkStatusMutation.variables === 'ignored' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Ignore'}
                </button>
              </div>

              <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_auto]">
                <div className="space-y-3">
                  <textarea
                    value={bulkNoteDraft}
                    onChange={(event) => setBulkNoteDraft(event.target.value)}
                    disabled={isBulkMutating}
                    data-testid="bulk-note-textarea"
                    rows={3}
                    placeholder="Общий комментарий для всех выбранных сигналов: что проверено, кому передано, чего ждём дальше."
                    className="w-full rounded-[1.5rem] border border-slate-700 bg-slate-900 px-4 py-3 text-sm font-medium text-slate-100 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-900"
                  />
                  <div className="flex flex-wrap gap-2">
                    {SIGNAL_NOTE_TEMPLATES.map((template) => (
                      <button
                        key={template.id}
                        type="button"
                        onClick={() => setBulkNoteDraft(template.body)}
                        disabled={isBulkMutating}
                        className="rounded-full border border-slate-700 px-3 py-1.5 text-[11px] font-bold text-slate-200 transition-colors hover:bg-slate-800 disabled:opacity-60"
                      >
                        {template.label}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => bulkNoteMutation.mutate(bulkNoteDraft)}
                  disabled={!selectedVisibleSignalIds.length || isBulkMutating || bulkNoteDraft.trim().length < 3}
                  className="inline-flex items-center justify-center rounded-2xl border border-emerald-400 bg-emerald-500/10 px-4 py-3 text-sm font-bold text-emerald-100 transition-colors hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {bulkNoteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Добавить note'}
                </button>
              </div>

              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    Handoff presets
                  </p>
                  <p className="text-[11px] font-medium text-slate-400">
                    Preset использует выбранного выше assignee, если он указан.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
                  {SIGNAL_HANDOFF_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => bulkPresetMutation.mutate({
                        assigneeUserId: bulkAssigneeDraft ? bulkAssigneeDraft : undefined,
                        workflowState: preset.workflowState,
                        noteBody: preset.noteBody,
                      })}
                      disabled={!selectedVisibleSignalIds.length || isBulkMutating}
                      data-testid={`bulk-preset-${preset.id}`}
                      className="rounded-[1.5rem] border border-slate-700 bg-slate-900 px-4 py-4 text-left transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <p className="text-sm font-bold text-white">{preset.label}</p>
                      <p className="mt-1 text-[11px] font-medium leading-relaxed text-slate-400">
                        {preset.description}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {filteredSignals.length ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredSignals.map((signal: SignalListItem) => {
            const isCritical = signal.severity === 'critical';
            const isHigh = signal.severity === 'high';
            const isResolvePending = resolveMutation.isPending && resolveMutation.variables === signal.id;
            const isIgnorePending = ignoreMutation.isPending && ignoreMutation.variables === signal.id;
            const escalationPreset = getSignalEscalationPreset(signal, assigneeRoleById);
            const isEscalationPending = escalationMutation.isPending && escalationMutation.variables?.signalId === signal.id;
            const isPending = isResolvePending || isIgnorePending;
            const impactRub = parseFloat(signal.impactRub || '0');
            const isSelected = selectedSignalIds.includes(signal.id);

            return (
              <div
                key={signal.id}
                className={cn(
                  'group relative overflow-hidden rounded-[2rem] border bg-white p-6 transition-all hover:-translate-y-1 hover:shadow-xl',
                  isSelected ? 'ring-2 ring-emerald-300 ring-offset-2 ring-offset-slate-50' : null,
                  getSlaCardClass(signal.aging.slaState),
                  isCritical
                    ? 'border-rose-200 bg-rose-50/30 dark:border-rose-800/40 dark:bg-rose-900/10'
                    : isHigh
                      ? 'border-amber-200 bg-amber-50/20 dark:border-amber-800/40 dark:bg-amber-900/10'
                      : 'border-slate-200 shadow-sm',
                )}
              >
                <div className="flex justify-between items-start mb-4">
                  <div className={`p-2.5 rounded-2xl ${
                    isCritical ? 'bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-300' :
                    isHigh ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300' :
                    'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300'
                  }`}>
                    {isCritical ? <AlertCircle className="w-6 h-6" /> :
                     isHigh ? <AlertTriangle className="w-6 h-6" /> :
                     <Info className="w-6 h-6" />}
                  </div>

                  <div className="flex items-center gap-1">
                    {canManage ? (
                      <label className="inline-flex items-center justify-center rounded-xl p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSignalSelection(signal.id)}
                          data-testid="signal-bulk-checkbox"
                          className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                        />
                      </label>
                    ) : null}
                    <button
                      onClick={() => resolveMutation.mutate(signal.id)}
                      disabled={isPending || !canManage}
                      className="p-2 text-slate-300 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-all dark:hover:bg-emerald-900/20"
                      title="Исправлено"
                    >
                      {isResolvePending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => ignoreMutation.mutate(signal.id)}
                      disabled={isPending || !canManage}
                      className="p-2 text-slate-300 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-all"
                      title="Скрыть"
                    >
                      {isIgnorePending ? <Loader2 className="w-4 h-4 animate-spin" /> : <EyeOff className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <h3 className="font-bold text-slate-900 mb-1.5 group-hover:text-emerald-700 transition-colors text-sm">
                  {signal.title}
                </h3>
                <p className="text-[11px] text-slate-500 leading-relaxed mb-5 font-medium">
                  {signal.description}
                </p>

                <div className="mb-5 flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${getWorkflowStateClass(signal.workflowState)}`}>
                    {getWorkflowStateLabel(signal.workflowState)}
                  </span>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[10px] font-bold tracking-wide text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
                    {getAssigneeLabel(signal.assigneeEmail, signal.assigneeUserId)}
                  </span>
                  <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                    В очереди {signal.aging.queueAgeLabel}
                  </span>
                  <span className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${getSlaStateClass(signal.aging.slaState)}`}>
                    {signal.aging.slaLabel}
                  </span>
                  {signal.lastEscalation ? (
                    <span className={cn(
                      'rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-widest',
                      getEscalationOutcomeClass(signal.lastEscalation.outcome),
                    )}>
                      {signal.lastEscalation.outcomeLabel}
                    </span>
                  ) : null}
                </div>

                <div className="flex items-center justify-between pt-4 border-t border-slate-100 mt-auto">
                  <div className="flex flex-col">
                    <span className="text-[8px] uppercase font-bold text-slate-400 tracking-widest mb-0.5">Влияние</span>
                    <span className={`text-xs font-bold font-mono ${isCritical ? 'text-rose-600' : 'text-slate-700'}`}>
                      {impactRub !== 0 ? `${Math.abs(impactRub).toLocaleString('ru-RU')} ₽` : 'Аналитика'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {canManage && escalationPreset ? (
                      <button
                        type="button"
                        onClick={() => escalationMutation.mutate({
                          signalId: signal.id,
                          assigneeUserId: signal.assigneeUserId ?? undefined,
                          workflowState: escalationPreset.workflowState,
                          noteBody: escalationPreset.noteBody,
                        })}
                        disabled={isPending || isEscalationPending}
                        data-testid={`signal-escalation-${signal.id}`}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-[10px] font-bold text-amber-700 transition-colors hover:bg-amber-100 disabled:opacity-60 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-300 dark:hover:bg-amber-900/30"
                        title={escalationPreset.description}
                      >
                        {isEscalationPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BellRing className="h-3.5 w-3.5" />}
                        Эскалация
                      </button>
                    ) : null}
                    <button
                      type="button"
                      aria-haspopup="dialog"
                      data-testid="signal-details-trigger"
                      onClick={() => openSignal(signal.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 rounded-xl text-slate-500 text-[10px] font-bold group-hover:bg-slate-900 group-hover:text-white transition-all shadow-sm dark:bg-slate-800/50 dark:text-slate-400 dark:group-hover:bg-slate-700 dark:group-hover:text-white"
                    >
                      {canManage ? 'Детали' : 'Просмотр'}
                      <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                    </button>
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-[2rem] border border-slate-200 bg-white p-6">
            <OperatorState
              icon={Filter}
              tone="warning"
              title="По выбранным фильтрам сигналов нет"
              description="Снимите часть ограничений или поменяйте assignee/workflow, чтобы увидеть другие активные сигналы."
              actionLabel={hasActiveFilters ? 'Сбросить фильтры' : undefined}
              action={hasActiveFilters ? () => {
                setManualQueueView(null);
                setManualAssigneeFilter(null);
                setManualWorkflowFilter(null);
                setManualSortPreset(null);
                setManualSavedViewScope(null);
                setManualSharedOwnerUserId(null);
                setSavedViewNameDraft('');
              } : undefined}
            />
          </div>
        )}
      </div>

      <SignalDetailsPanel
        open={Boolean(selectedSignalId)}
        detail={signalDetailsQuery.data}
        tenantId={tenantId}
        signalId={selectedSignalId}
        openedFrom={selectedSignalOpenedFrom}
        isLoading={signalDetailsQuery.isLoading}
        error={signalDetailsQuery.error}
        canManage={canManage}
        canComment={canComment}
        isMutating={isAnyMutationPending}
        onClose={closeSignalDetails}
        onOpenRecentSignal={openSignal}
        onResolve={() => {
          if (selectedSignalId) {
            resolveMutation.mutate(selectedSignalId);
          }
        }}
        onIgnore={() => {
          if (selectedSignalId) {
            ignoreMutation.mutate(selectedSignalId);
          }
        }}
      />
    </>
  );
}
