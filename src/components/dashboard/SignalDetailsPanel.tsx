'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  BellRing,
  Boxes,
  CheckCircle2,
  Clock3,
  EyeOff,
  Info,
  Loader2,
  Package2,
  ShieldAlert,
  X,
} from 'lucide-react';
import {
  addSignalNote,
  applySignalHandoffPresetAction,
  assignSignalOwner,
  updateSignalWorkflowStateAction,
} from '@/app/(dashboard)/overview/actions';
import type {
  RecentSignalReview,
  SignalAgingSummary,
  SignalListItem,
  SignalReviewSource,
  SignalTimelineEntry,
  SignalTimelineEventType,
  SignalWorkflowState,
  SignalWorkflowSummary,
} from '@/lib/operator-signal-timeline';
import { buildSignalAssigneeRoleMap, getSignalEscalationPreset } from '@/lib/signal-queue-utils';
import { SIGNAL_HANDOFF_PRESETS, SIGNAL_NOTE_TEMPLATES } from '@/lib/signal-workflow-config';
import { cn } from '@/lib/utils';
import { OperatorState } from './OperatorState';

export type SignalDetail = {
  signal: {
    id: string;
    nmId: number | null;
    type: string;
    severity: 'critical' | 'high' | 'medium';
    title: string;
    description: string;
    impactRub?: string | null;
    status: string;
    createdAt: string | Date | null;
    aging: SignalAgingSummary;
  };
  workflow: SignalWorkflowSummary;
  product: {
    nmId: number;
    brand: string | null;
    vendorCode: string | null;
    category: string | null;
    photoUrl: string | null;
  } | null;
  content: {
    title: string | null;
    photosCount: number;
    hasVideo: boolean;
    characteristicsCount: number;
    updatedAt: string | Date | null;
  } | null;
  metrics: {
    soldQuantity: number;
    grossRevenue: number;
    netProfit: number;
    adSpend: number;
    logistics: number;
    currentStock: number;
    daysOfStock: number | null;
    views: number;
    carts: number;
  } | null;
  stocks: {
    total: number;
    warehouses: Array<{ warehouseName: string; amount: number }>;
  } | null;
  insights: Array<{
    label: string;
    value: string;
    tone: 'danger' | 'warning' | 'success' | 'default';
  }>;
  recommendations: Array<{
    label: string;
    description: string;
    href: string;
  }>;
  timeline: {
    latestEvent: SignalTimelineEntry | null;
    signalHistory: SignalTimelineEntry[];
    recentSignals: RecentSignalReview[];
    notes: SignalTimelineEntry[];
  };
};

function toDate(value: string | Date | null | undefined) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateTime(value: string | Date | null | undefined) {
  const date = toDate(value);
  if (!date) {
    return 'Не зафиксировано';
  }

  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatCurrency(value: number | string | null | undefined) {
  const num = Number(value ?? 0);
  return `${Math.round(num).toLocaleString('ru-RU')} ₽`;
}

function formatMetricValue(value: number | null | undefined, suffix = '') {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return 'Нет данных';
  }

  return `${Math.round(value).toLocaleString('ru-RU')}${suffix}`;
}

function getSeverityView(severity: SignalDetail['signal']['severity']) {
  switch (severity) {
    case 'critical':
      return {
        label: 'Критичный',
        icon: AlertCircle,
        tone: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800/40 dark:bg-rose-900/20 dark:text-rose-200',
        accent: 'text-rose-600 bg-rose-100 dark:text-rose-300 dark:bg-rose-900/30',
      };
    case 'high':
      return {
        label: 'Высокий',
        icon: AlertTriangle,
        tone: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-200',
        accent: 'text-amber-600 bg-amber-100 dark:text-amber-300 dark:bg-amber-900/30',
      };
    default:
      return {
        label: 'Средний',
        icon: Info,
        tone: 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800/40 dark:bg-blue-900/20 dark:text-blue-200',
        accent: 'text-blue-600 bg-blue-100 dark:text-blue-300 dark:bg-blue-900/30',
      };
  }
}

function getSignalTypeLabel(type: string) {
  switch (type) {
    case 'negative_margin':
    case 'margin_leak':
      return 'Отрицательная маржа';
    case 'ads_leak':
      return 'Рекламная утечка';
    case 'stock_out':
      return 'Прогноз остатка';
    case 'logistics_spike':
      return 'Логистическая аномалия';
    case 'content_risk':
      return 'Контентный риск';
    case 'seo_risk':
      return 'SEO-риск';
    case 'conversion_drop':
      return 'Просадка конверсии';
    default:
      return 'Операционный сигнал';
  }
}

function getInsightToneClass(tone: SignalDetail['insights'][number]['tone']) {
  switch (tone) {
    case 'danger':
      return 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800/40 dark:bg-rose-900/20 dark:text-rose-200';
    case 'warning':
      return 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-200';
    case 'success':
      return 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/40 dark:bg-emerald-900/20 dark:text-emerald-200';
    default:
      return 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300';
  }
}

function getReviewSourceLabel(source: SignalReviewSource) {
  switch (source) {
    case 'economics':
      return 'Юнит-экономика';
    case 'explorer':
      return 'Проводник данных';
    default:
      return 'Обзор';
  }
}

function getActorRoleLabel(role: string) {
  switch (role) {
    case 'owner':
      return 'Владелец';
    case 'admin':
      return 'Админ';
    default:
      return 'Наблюдатель';
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
      return 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/40 dark:bg-emerald-900/20 dark:text-emerald-200';
    case 'handoff':
      return 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800/40 dark:bg-blue-900/20 dark:text-blue-200';
    case 'blocked':
      return 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800/40 dark:bg-rose-900/20 dark:text-rose-200';
    default:
      return 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300';
  }
}

function getTimelineEventLabel(eventType: SignalTimelineEventType) {
  switch (eventType) {
    case 'note':
      return 'Комментарий';
    case 'assignment':
      return 'Ответственный';
    case 'workflow_state':
      return 'Статус разбора';
    default:
      return 'Просмотр';
  }
}

function getAssigneeLabel(email: string | null | undefined, userId: string | null | undefined) {
  if (email) {
    return email;
  }

  if (userId) {
    return `user:${userId.slice(0, 8)}`;
  }

  return 'Не назначен';
}

function DetailsLoadingState() {
  return (
    <div data-testid="signal-details-loading" className="space-y-4">
      <div className="h-24 animate-pulse rounded-[2rem] bg-slate-100" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="h-28 animate-pulse rounded-[2rem] bg-slate-100" />
        <div className="h-28 animate-pulse rounded-[2rem] bg-slate-100" />
      </div>
      <div className="h-40 animate-pulse rounded-[2rem] bg-slate-100" />
    </div>
  );
}

export function SignalDetailsPanel({
  open,
  detail,
  tenantId,
  signalId,
  openedFrom,
  isLoading,
  error,
  canManage,
  canComment,
  isMutating,
  onClose,
  onOpenRecentSignal,
  onResolve,
  onIgnore,
}: {
  open: boolean;
  detail: SignalDetail | null | undefined;
  tenantId: string | null;
  signalId: string | null;
  openedFrom: SignalReviewSource;
  isLoading: boolean;
  error: Error | null;
  canManage: boolean;
  canComment: boolean;
  isMutating: boolean;
  onClose: () => void;
  onOpenRecentSignal: (signalId: string) => void;
  onResolve: () => void;
  onIgnore: () => void;
}) {
  const queryClient = useQueryClient();
  const panelRef = useRef<HTMLElement>(null);
  const [drafts, setDrafts] = useState<
    Record<
      string,
      {
        assigneeDraft?: string;
        workflowDraft?: SignalWorkflowState;
        noteDraft?: string;
      }
    >
  >({});
  const activeSignalKey = detail?.signal.id ?? signalId ?? 'pending-signal';
  const activeDraft = drafts[activeSignalKey];
  const assigneeDraft = activeDraft?.assigneeDraft ?? detail?.workflow.assigneeUserId ?? '';
  const workflowDraft = activeDraft?.workflowDraft ?? detail?.workflow.workflowState ?? 'new';
  const noteDraft = activeDraft?.noteDraft ?? '';

  const updateActiveDraft = (
    patch: Partial<{
      assigneeDraft: string;
      workflowDraft: SignalWorkflowState;
      noteDraft: string;
    }>
  ) => {
    setDrafts((current) => ({
      ...current,
      [activeSignalKey]: {
        ...current[activeSignalKey],
        ...patch,
      },
    }));
  };

  const clearActiveDraftFields = (...fields: Array<'assigneeDraft' | 'workflowDraft' | 'noteDraft'>) => {
    setDrafts((current) => {
      const currentDraft = current[activeSignalKey];
      if (!currentDraft) {
        return current;
      }

      const next = { ...current };
      const nextDraft = { ...currentDraft };
      for (const field of fields) {
        delete nextDraft[field];
      }

      if (Object.keys(nextDraft).length === 0) {
        delete next[activeSignalKey];
      } else {
        next[activeSignalKey] = nextDraft;
      }

      return next;
    });
  };

  const handleClose = useCallback(() => {
    setDrafts({});
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleClose();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, handleClose]);

  useEffect(() => {
    if (!open || !panelRef.current) {
      return;
    }

    const panel = panelRef.current;
    const focusableSelectors = [
      'a[href]', 'button:not([disabled])', 'input:not([disabled])',
      'select:not([disabled])', 'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(', ');

    const focusableElements = () => Array.from(panel.querySelectorAll<HTMLElement>(focusableSelectors));

    const onTab = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const elements = focusableElements();
      if (elements.length === 0) return;
      const first = elements[0]!;
      const last = elements[elements.length - 1]!;
      if (event.shiftKey) {
        if (document.activeElement === first) {
          event.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    const firstFocusable = focusableElements()[0];
    firstFocusable?.focus();

    panel.addEventListener('keydown', onTab);
    return () => panel.removeEventListener('keydown', onTab);
  }, [open]);

  const invalidateSignalQueries = async () => {
    if (!tenantId) {
      return;
    }

    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['signals', tenantId] }),
      queryClient.invalidateQueries({ queryKey: ['signal-detail', tenantId, signalId] }),
      queryClient.invalidateQueries({ queryKey: ['signal-notifications', tenantId] }),
    ]);
  };

  const assignMutation = useMutation({
    mutationFn: async (nextAssigneeUserId: string) => {
      if (!tenantId || !signalId) {
        throw new Error('Signal context is unavailable');
      }

      return assignSignalOwner(tenantId, signalId, nextAssigneeUserId || null, openedFrom);
    },
    onSuccess: async () => {
      clearActiveDraftFields('assigneeDraft');
      await invalidateSignalQueries();
    },
  });

  const workflowMutation = useMutation({
    mutationFn: async (nextWorkflowState: SignalWorkflowState) => {
      if (!tenantId || !signalId) {
        throw new Error('Signal context is unavailable');
      }

      return updateSignalWorkflowStateAction(tenantId, signalId, nextWorkflowState, openedFrom);
    },
    onSuccess: async () => {
      clearActiveDraftFields('workflowDraft');
      await invalidateSignalQueries();
    },
  });

  const noteMutation = useMutation({
    mutationFn: async (noteBody: string) => {
      if (!tenantId || !signalId) {
        throw new Error('Signal context is unavailable');
      }

      return addSignalNote(tenantId, signalId, noteBody, openedFrom);
    },
    onSuccess: async () => {
      clearActiveDraftFields('noteDraft');
      await invalidateSignalQueries();
    },
  });

  const presetMutation = useMutation({
    mutationFn: async (payload: {
      assigneeUserId?: string | null;
      workflowState: SignalWorkflowState;
      noteBody: string;
    }) => {
      if (!tenantId || !signalId) {
        throw new Error('Signal context is unavailable');
      }

      return applySignalHandoffPresetAction(tenantId, signalId, payload, openedFrom);
    },
    onSuccess: async () => {
      clearActiveDraftFields('assigneeDraft', 'workflowDraft', 'noteDraft');
      await invalidateSignalQueries();
    },
  });

  if (!open) {
    return null;
  }

  const severity = detail ? getSeverityView(detail.signal.severity) : null;
  const SeverityIcon = severity?.icon ?? ShieldAlert;
  const impactRub = detail?.signal.impactRub ? Number(detail.signal.impactRub) : 0;
  const isWorkflowMutating = assignMutation.isPending || workflowMutation.isPending || noteMutation.isPending || presetMutation.isPending;
  const detailAssigneeRoleById = detail ? buildSignalAssigneeRoleMap(detail.workflow.availableAssignees) : {};
  const escalationPreset = detail ? getSignalEscalationPreset({
    id: detail.signal.id,
    nmId: detail.signal.nmId,
    type: detail.signal.type,
    severity: detail.signal.severity,
    title: detail.signal.title,
    description: detail.signal.description,
    impactRub: detail.signal.impactRub,
    createdAt: detail.signal.createdAt,
    workflowState: detail.workflow.workflowState,
    assigneeUserId: detail.workflow.assigneeUserId,
    assigneeEmail: detail.workflow.assigneeEmail,
    status: detail.signal.status,
    workflowUpdatedAt: detail.workflow.workflowUpdatedAt,
    aging: detail.signal.aging,
    lastEscalation: null,
  } satisfies SignalListItem, detailAssigneeRoleById) : null;

  return (
    <div
      className="fixed inset-0 z-[120] flex justify-end bg-slate-950/45 backdrop-blur-sm"
      data-testid="signal-details-backdrop"
      onClick={handleClose}
    >
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Детали сигнала"
        data-testid="signal-details-drawer"
        onClick={(event) => event.stopPropagation()}
        className="flex h-full w-full max-w-2xl flex-col overflow-hidden border-l border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-2xl dark:shadow-slate-900"
      >
        <div className="border-b border-slate-100 px-6 py-5 sm:px-8">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-4">
              <div className={cn('rounded-[1.25rem] p-3', severity?.accent ?? 'bg-slate-100 text-slate-600')}>
                <SeverityIcon className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  {severity ? (
                    <span className={cn('rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-widest', severity.tone)}>
                      {severity.label}
                    </span>
                  ) : null}
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
                    {detail ? getSignalTypeLabel(detail.signal.type) : 'Сигнал'}
                  </span>
                  {detail?.signal.nmId ? (
                    <span className="rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                      NM {detail.signal.nmId}
                    </span>
                  ) : null}
                </div>
                <h2 data-testid="signal-details-title" className="text-xl font-bold leading-tight text-slate-900">
                  {detail?.signal.title ?? 'Загрузка деталей сигнала'}
                </h2>
                <p className="mt-2 text-sm font-medium leading-relaxed text-slate-500">
                  {detail?.signal.description ?? 'Собираем продуктовый контекст и аналитические метрики по выбранному сигналу.'}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleClose}
              data-testid="signal-details-close"
              aria-label="Закрыть"
              className="rounded-2xl p-2 text-slate-300 transition-colors hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6 sm:px-8">
          {isLoading && !detail ? <DetailsLoadingState /> : null}

          {!isLoading && error ? (
            <div data-testid="signal-details-error">
              <OperatorState
                icon={AlertCircle}
                tone="danger"
                title="Не удалось загрузить детали сигнала"
                description={error.message}
                secondaryText="Список сигналов остаётся доступным, но detail-модель по выбранной карточке сейчас недоступна."
              />
            </div>
          ) : null}

          {!isLoading && !error && detail ? (
            <div data-testid="signal-details-content" className="space-y-6">
              <div className="rounded-[2rem] border border-slate-200 bg-slate-50/70 p-5 dark:border-slate-700 dark:bg-slate-800/30">
                <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
                  <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-[1.5rem] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                    {detail.product?.photoUrl ? (
                      <Image
                        src={detail.product.photoUrl}
                        alt={detail.content?.title ?? detail.signal.title}
                        fill
                        sizes="112px"
                        className="object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-slate-300">
                        <Package2 className="h-10 w-10" />
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1 space-y-3">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Карточка / SKU</p>
                      <p className="mt-1 text-base font-bold text-slate-900">
                        {detail.content?.title || detail.product?.brand || detail.signal.title}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs font-medium text-slate-500">
                        {detail.product?.vendorCode ? <span>Артикул: {detail.product.vendorCode}</span> : null}
                        {detail.product?.category ? <span>Категория: {detail.product.category}</span> : null}
                        <span>Создан: {formatDateTime(detail.signal.createdAt)}</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="rounded-[1.5rem] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Оценка влияния</p>
                        <p className="mt-2 text-lg font-bold text-slate-900">
                          {impactRub !== 0 ? formatCurrency(Math.abs(impactRub)) : 'Требуется проверка'}
                        </p>
                        <p className="mt-1 text-xs font-medium text-slate-500">
                          {impactRub < 0 ? 'Сигнал уже влияет на прибыль отрицательно.' : 'Сигнал требует ручной оценки на основе карточки и продаж.'}
                        </p>
                      </div>

                      <div className="rounded-[1.5rem] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Остаток и запас</p>
                        <p className="mt-2 text-lg font-bold text-slate-900">
                          {detail.stocks ? formatMetricValue(detail.stocks.total, ' шт.') : 'Нет данных'}
                        </p>
                        <p className="mt-1 text-xs font-medium text-slate-500">
                          {detail.metrics?.daysOfStock !== null && detail.metrics?.daysOfStock !== undefined
                            ? `При текущей скорости хватит примерно на ${Math.round(detail.metrics.daysOfStock)} дн.`
                            : 'Прогноз по запасу появится после накопления данных по продажам и остаткам.'}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <section data-testid="signal-operator-memory" className="space-y-3">
                <div className="flex items-center gap-2">
                  <Clock3 className="h-4 w-4 text-slate-500" />
                  <h3 className="text-sm font-bold uppercase tracking-widest text-slate-500">Командный разбор</h3>
                </div>
                <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,260px)_1fr]">
                  <div className="rounded-[1.5rem] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Текущий workflow</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className={cn('rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-widest', getWorkflowStateClass(detail.workflow.workflowState))}>
                        {getWorkflowStateLabel(detail.workflow.workflowState)}
                      </span>
                      <span className="rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                        В очереди {detail.signal.aging.queueAgeLabel}
                      </span>
                      <span className={cn(
                        'rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-widest',
                        detail.signal.aging.slaState === 'overdue'
                          ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800/40 dark:bg-rose-900/20 dark:text-rose-300'
                          : detail.signal.aging.slaState === 'warning'
                            ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-300'
                            : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-900/20 dark:text-emerald-300',
                      )}>
                        {detail.signal.aging.slaLabel}
                      </span>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
                        {detail.signal.status === 'active' ? 'Активен' : detail.signal.status}
                      </span>
                    </div>
                    <p className="mt-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Ответственный</p>
                    <p className="mt-2 text-base font-bold text-slate-900">
                      {getAssigneeLabel(detail.workflow.assigneeEmail, detail.workflow.assigneeUserId)}
                    </p>
                    <p className="mt-1 text-xs font-medium text-slate-500">
                      {detail.workflow.workflowUpdatedAt
                        ? `Обновлено ${detail.workflow.workflowUpdatedByEmail ?? 'неизвестным пользователем'} • ${formatDateTime(detail.workflow.workflowUpdatedAt)}`
                        : 'Workflow ещё не трогали вручную. Сигнал ждёт первого разбора.'}
                    </p>
                  </div>

                  <div className="rounded-[1.5rem] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Недавно разобранные сигналы</p>
                    {detail.timeline.recentSignals.length ? (
                      <div className="mt-3 space-y-2">
                        {detail.timeline.recentSignals.map((item) => (
                          <button
                            key={item.signalId}
                            type="button"
                            data-testid="recent-signal-review"
                            onClick={() => onOpenRecentSignal(item.signalId)}
                            disabled={!item.isActive}
                            className={cn(
                              'flex w-full items-center justify-between gap-3 rounded-[1.25rem] border px-4 py-3 text-left transition-colors',
                              item.isActive
                                ? 'border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/50 dark:hover:border-slate-600 dark:hover:bg-slate-700/50'
                                : 'cursor-not-allowed border-slate-100 bg-slate-50/50 opacity-70 dark:border-slate-800 dark:bg-slate-800/30'
                            )}
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-bold text-slate-900">{item.title}</p>
                              <p className="mt-1 text-[11px] font-medium text-slate-500">
                                {item.nmId ? `NM ${item.nmId} • ` : ''}
                                {item.actorEmail} • {getTimelineEventLabel(item.eventType)} • {formatDateTime(item.createdAt)}
                              </p>
                            </div>
                            <span className="shrink-0 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                              {item.isActive ? 'Открыть' : 'Не активен'}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-3 text-sm font-medium leading-relaxed text-slate-500">
                        После переходов в экономику или проводник данных здесь появится короткая история последних разобранных сигналов.
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,280px)_1fr]">
                  <div className="rounded-[1.5rem] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Назначение</p>
                    <div className="mt-3 space-y-3">
                      <select
                        value={assigneeDraft}
                        onChange={(event) => updateActiveDraft({ assigneeDraft: event.target.value })}
                        disabled={!canManage || isWorkflowMutating}
                        data-testid="signal-assignee-select"
                        className="w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-300 outline-none transition focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:bg-slate-50 dark:disabled:bg-slate-700"
                      >
                        <option value="">Без ответственного</option>
                        {detail.workflow.availableAssignees.map((member) => (
                          <option key={member.userId} value={member.userId}>
                            {getAssigneeLabel(member.email, member.userId)} ({getActorRoleLabel(member.role)})
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        data-testid="signal-assign-save"
                        onClick={() => assignMutation.mutate(assigneeDraft)}
                        disabled={!canManage || isWorkflowMutating || assigneeDraft === (detail.workflow.assigneeUserId ?? '')}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {assignMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        Сохранить ответственного
                      </button>
                    </div>
                  </div>

                  <div className="rounded-[1.5rem] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Статус разбора / handoff</p>
                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                      <select
                        value={workflowDraft}
                        onChange={(event) => updateActiveDraft({ workflowDraft: event.target.value as SignalWorkflowState })}
                        disabled={!canManage || isWorkflowMutating}
                        data-testid="signal-workflow-select"
                        className="w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-300 outline-none transition focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:bg-slate-50 dark:disabled:bg-slate-700"
                      >
                        <option value="new">Новый</option>
                        <option value="in_progress">В работе</option>
                        <option value="handoff">Передан</option>
                        <option value="blocked">Блокер</option>
                      </select>
                      <button
                        type="button"
                        data-testid="signal-workflow-save"
                        onClick={() => workflowMutation.mutate(workflowDraft)}
                        disabled={!canManage || isWorkflowMutating || workflowDraft === detail.workflow.workflowState}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {workflowMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        Обновить
                      </button>
                    </div>
                    <p className="mt-3 text-sm font-medium leading-relaxed text-slate-500">
                      Используйте `Передан`, когда сигнал ушёл другому человеку или команде, и `Блокер`, когда разбор завис без внешнего действия.
                    </p>
                    {canManage && escalationPreset ? (
                      <button
                        type="button"
                        onClick={() => presetMutation.mutate({
                          assigneeUserId: assigneeDraft ? assigneeDraft : detail.workflow.assigneeUserId ?? undefined,
                          workflowState: escalationPreset.workflowState,
                          noteBody: escalationPreset.noteBody,
                        })}
                        disabled={isWorkflowMutating}
                        data-testid={`signal-escalation-preset-${escalationPreset.id}`}
                        className="mt-3 inline-flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-700 transition-colors hover:bg-amber-100 disabled:opacity-60 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-300 dark:hover:bg-amber-900/30"
                      >
                        {presetMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}
                        {escalationPreset.label}
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-[1.5rem] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Комментарии по сигналу</p>
                    {noteMutation.error || presetMutation.error ? (
                      <span className="text-[11px] font-medium text-rose-600">
                        {noteMutation.error?.message ?? presetMutation.error?.message}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-3 space-y-3">
                    <div className="flex flex-wrap gap-2">
                      {SIGNAL_NOTE_TEMPLATES.map((template) => (
                        <button
                          key={template.id}
                          type="button"
                          onClick={() => updateActiveDraft({ noteDraft: template.body })}
                          disabled={!canComment || isWorkflowMutating}
                          data-testid={`signal-note-template-${template.id}`}
                          className="rounded-full border border-slate-200 px-3 py-1.5 text-[11px] font-bold text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {template.label}
                        </button>
                      ))}
                    </div>
                    <textarea
                      value={noteDraft}
                      onChange={(event) => updateActiveDraft({ noteDraft: event.target.value })}
                      disabled={!canComment || isWorkflowMutating}
                      data-testid="signal-note-input"
                      rows={3}
                      placeholder="Например: проверили карточку, передали дизайнеру, ждём новую SEO-обложку до завтра."
                      className="w-full rounded-[1.5rem] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-300 outline-none transition focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:bg-slate-50 dark:disabled:bg-slate-700"
                    />
                    <div className="flex justify-end">
                      <button
                        type="button"
                        data-testid="signal-note-submit"
                        onClick={() => noteMutation.mutate(noteDraft)}
                        disabled={!canComment || isWorkflowMutating || noteDraft.trim().length < 3}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {noteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        Добавить комментарий
                      </button>
                    </div>
                  </div>

                  {canManage ? (
                    <div className="mt-4 rounded-[1.25rem] border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Handoff presets</p>
                          <p className="mt-1 text-xs font-medium leading-relaxed text-slate-500">
                            Используют текущий draft по ответственному из блока назначения, если он выбран.
                          </p>
                        </div>
                        {presetMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : null}
                      </div>
                      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                        {SIGNAL_HANDOFF_PRESETS.map((preset) => (
                          <button
                            key={preset.id}
                            type="button"
                            onClick={() => presetMutation.mutate({
                              assigneeUserId: assigneeDraft ? assigneeDraft : undefined,
                              workflowState: preset.workflowState,
                              noteBody: preset.noteBody,
                            })}
                            disabled={!canManage || isWorkflowMutating}
                            data-testid={`signal-handoff-preset-${preset.id}`}
                            className="rounded-[1.25rem] border border-slate-200 bg-white px-4 py-3 text-left transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700/50"
                          >
                            <p className="text-sm font-bold text-slate-900">{preset.label}</p>
                            <p className="mt-1 text-[11px] font-medium leading-relaxed text-slate-500">
                              {preset.description}
                            </p>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {detail.timeline.notes.length ? (
                    <div className="mt-4 space-y-3">
                      {detail.timeline.notes.map((note) => (
                        <div
                          key={note.id}
                          data-testid="signal-note-entry"
                          className="rounded-[1.25rem] border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/50"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-bold text-slate-900">{note.actorEmail}</p>
                            <span className="text-[11px] font-medium text-slate-500">{formatDateTime(note.createdAt)}</span>
                          </div>
                          <p className="mt-2 text-sm font-medium leading-relaxed text-slate-600">{note.eventBody}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-4 text-sm font-medium leading-relaxed text-slate-500">
                      Комментариев пока нет. Первый note появится здесь и останется видимым для всей команды.
                    </p>
                  )}
                </div>

                <div className="rounded-[1.5rem] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Последние разборы этого сигнала</p>
                  {detail.timeline.signalHistory.length ? (
                    <div className="mt-3 space-y-2">
                      {detail.timeline.signalHistory.map((event) => (
                        <div
                          key={event.id}
                          data-testid="signal-timeline-entry"
                          className="flex items-center justify-between gap-3 rounded-[1.25rem] bg-slate-50 px-4 py-3 dark:bg-slate-800/50"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold text-slate-900">{getTimelineEventLabel(event.eventType)} • {event.actorEmail}</p>
                            <p className="mt-1 text-[11px] font-medium text-slate-500">
                              {getReviewSourceLabel(event.openedFrom)} • {getActorRoleLabel(event.actorRole)}
                            </p>
                            {event.eventBody ? (
                              <p className="mt-2 text-sm font-medium leading-relaxed text-slate-600">{event.eventBody}</p>
                            ) : null}
                          </div>
                          <span className="shrink-0 text-[11px] font-medium text-slate-500">
                            {formatDateTime(event.createdAt)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-sm font-medium leading-relaxed text-slate-500">
                      История этого сигнала пока пуста. Первый просмотр создаст запись автоматически.
                    </p>
                  )}
                </div>
              </section>

              {detail.insights.length > 0 ? (
                <section className="space-y-3">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4 text-slate-500" />
                    <h3 className="text-sm font-bold uppercase tracking-widest text-slate-500">Что именно видит система</h3>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {detail.insights.map((insight) => (
                      <div
                        key={`${insight.label}-${insight.value}`}
                        className={cn('rounded-[1.5rem] border p-4', getInsightToneClass(insight.tone))}
                      >
                        <p className="text-[10px] font-bold uppercase tracking-widest">{insight.label}</p>
                        <p className="mt-2 text-base font-bold">{insight.value}</p>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-slate-500" />
                  <h3 className="text-sm font-bold uppercase tracking-widest text-slate-500">Контекст по SKU за 14 дней</h3>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-[1.5rem] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Выручка</p>
                    <p className="mt-2 text-lg font-bold text-slate-900">
                      {detail.metrics ? formatCurrency(detail.metrics.grossRevenue) : 'Нет данных'}
                    </p>
                  </div>
                  <div className="rounded-[1.5rem] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Чистая прибыль</p>
                    <p className="mt-2 text-lg font-bold text-slate-900">
                      {detail.metrics ? formatCurrency(detail.metrics.netProfit) : 'Нет данных'}
                    </p>
                  </div>
                  <div className="rounded-[1.5rem] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Реклама</p>
                    <p className="mt-2 text-lg font-bold text-slate-900">
                      {detail.metrics ? formatCurrency(detail.metrics.adSpend) : 'Нет данных'}
                    </p>
                  </div>
                  <div className="rounded-[1.5rem] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Логистика</p>
                    <p className="mt-2 text-lg font-bold text-slate-900">
                      {detail.metrics ? formatCurrency(detail.metrics.logistics) : 'Нет данных'}
                    </p>
                  </div>
                  <div className="rounded-[1.5rem] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Просмотры / корзины</p>
                    <p className="mt-2 text-lg font-bold text-slate-900">
                      {detail.metrics
                        ? `${detail.metrics.views.toLocaleString('ru-RU')} / ${detail.metrics.carts.toLocaleString('ru-RU')}`
                        : 'Нет данных'}
                    </p>
                  </div>
                  <div className="rounded-[1.5rem] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Продано</p>
                    <p className="mt-2 text-lg font-bold text-slate-900">
                      {detail.metrics ? formatMetricValue(detail.metrics.soldQuantity, ' шт.') : 'Нет данных'}
                    </p>
                  </div>
                </div>
              </section>

              {detail.content ? (
                <section className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Clock3 className="h-4 w-4 text-slate-500" />
                    <h3 className="text-sm font-bold uppercase tracking-widest text-slate-500">Контент карточки</h3>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="rounded-[1.5rem] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Фотографии / видео</p>
                      <p className="mt-2 text-lg font-bold text-slate-900">
                        {detail.content.photosCount} фото / {detail.content.hasVideo ? 'есть видео' : 'без видео'}
                      </p>
                      <p className="mt-1 text-xs font-medium text-slate-500">
                        Последнее обновление metadata: {formatDateTime(detail.content.updatedAt)}
                      </p>
                    </div>
                    <div className="rounded-[1.5rem] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Характеристики</p>
                      <p className="mt-2 text-lg font-bold text-slate-900">{detail.content.characteristicsCount} шт.</p>
                      <p className="mt-1 text-xs font-medium text-slate-500">
                        Подходит для контентных и SEO-проверок без ухода в WB кабинет.
                      </p>
                    </div>
                  </div>
                </section>
              ) : null}

              {detail.stocks?.warehouses.length ? (
                <section className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Boxes className="h-4 w-4 text-slate-500" />
                    <h3 className="text-sm font-bold uppercase tracking-widest text-slate-500">Разбивка по складам</h3>
                  </div>
                  <div className="space-y-2 rounded-[2rem] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
                    {detail.stocks.warehouses.map((warehouse) => (
                      <div
                        key={`${warehouse.warehouseName}-${warehouse.amount}`}
                        className="flex items-center justify-between rounded-[1.25rem] bg-slate-50 px-4 py-3 text-sm font-medium text-slate-600 dark:bg-slate-800/50 dark:text-slate-400"
                      >
                        <span className="truncate pr-3">{warehouse.warehouseName}</span>
                        <span className="shrink-0 font-bold text-slate-900">{warehouse.amount.toLocaleString('ru-RU')} шт.</span>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <ArrowRight className="h-4 w-4 text-slate-500" />
                  <h3 className="text-sm font-bold uppercase tracking-widest text-slate-500">Следующие действия</h3>
                </div>
                <div className="space-y-3">
                  {detail.recommendations.map((recommendation) => (
                    <Link
                      key={`${recommendation.href}-${recommendation.label}`}
                      href={recommendation.href}
                      data-testid="signal-recommendation-link"
                      className="group flex items-start justify-between gap-4 rounded-[2rem] border border-slate-200 bg-white p-4 transition-colors hover:border-slate-300 hover:bg-slate-50"
                    >
                      <div>
                        <p className="text-sm font-bold text-slate-900">{recommendation.label}</p>
                        <p className="mt-1 text-xs font-medium leading-relaxed text-slate-500">{recommendation.description}</p>
                      </div>
                      <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-700" />
                    </Link>
                  ))}
                </div>
              </section>
            </div>
          ) : null}
        </div>

        <div className="border-t border-slate-100 bg-white px-6 py-5 sm:px-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs font-medium text-slate-500">
              {canManage
                ? 'Можно сразу закрыть сигнал, если проблема уже обработана, или скрыть его как операционный шум.'
                : 'У вас режим просмотра. Сигнал можно изучать, но управлять его статусом нельзя.'}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={onIgnore}
                disabled={isMutating || !canManage}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <EyeOff className="h-4 w-4" />
                Скрыть сигнал
              </button>
              <button
                type="button"
                onClick={onResolve}
                disabled={isMutating || !canManage}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isMutating ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Отметить как обработанный
              </button>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
