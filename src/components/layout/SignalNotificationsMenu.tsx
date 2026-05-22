'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, CheckCheck, Loader2, MessageSquareText, UserRoundCog, AlertOctagon, AlertTriangle } from 'lucide-react';

import {
  acknowledgeSignalNotificationsAction,
  markSignalNotificationsReadAction,
} from '@/app/(dashboard)/overview/actions';
import type { SignalNotificationItem, SignalNotificationsResponse } from '@/lib/operator-signal-timeline';
import { useStore } from '@/store/useStore';

function formatDateTime(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Недавно';
  }

  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function getNotificationIcon(notification: SignalNotificationItem) {
  if (notification.isSlaNotification) {
    return AlertTriangle;
  }

  const { eventType } = notification;
  switch (eventType) {
    case 'note':
      return MessageSquareText;
    case 'assignment':
      return UserRoundCog;
    default:
      return AlertOctagon;
  }
}

function getSeverityClass(severity: SignalNotificationItem['signalSeverity']) {
  switch (severity) {
    case 'critical':
      return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800/40 dark:bg-rose-900/20 dark:text-rose-300';
    case 'high':
      return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-300';
    default:
      return 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800/40 dark:bg-blue-900/20 dark:text-blue-300';
  }
}

export function SignalNotificationsMenu() {
  const { tenantId } = useStore();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<SignalNotificationsResponse, Error>({
    queryKey: ['signal-notifications', tenantId],
    queryFn: async () => {
      const res = await fetch(`/api/views/dashboard/signal-notifications`);
      if (!res.ok) {
        throw new Error('Не удалось загрузить командные уведомления');
      }
      return res.json();
    },
    enabled: Boolean(tenantId),
    refetchInterval: 30_000,
  });

  const markReadMutation = useMutation({
    mutationFn: async (eventIds: string[]) => {
      if (!tenantId || eventIds.length === 0) {
        return null;
      }

      return markSignalNotificationsReadAction(tenantId, eventIds);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['signal-notifications', tenantId] });
    },
  });

  const acknowledgeMutation = useMutation({
    mutationFn: async (eventIds: string[]) => {
      if (!tenantId || eventIds.length === 0) {
        return null;
      }

      return acknowledgeSignalNotificationsAction(tenantId, eventIds);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['signal-notifications', tenantId] });
    },
  });

  const notifications = useMemo(() => data?.notifications ?? [], [data]);
  const unreadCount = data?.unreadCount ?? 0;
  const unreadEventIds = useMemo(
    () => notifications.filter((notification) => !notification.isRead).map((notification) => notification.eventId),
    [notifications],
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open || unreadEventIds.length === 0 || markReadMutation.isPending) {
      return;
    }

    markReadMutation.mutate(unreadEventIds);
  }, [markReadMutation, open, unreadEventIds]);

  if (!tenantId) {
    return null;
  }

  const visibleCount = unreadCount > 9 ? '9+' : String(unreadCount);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        data-testid="signal-notifications-button"
        className="relative inline-flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100"
      >
        {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}
        {unreadCount ? (
          <span className="absolute -right-1 -top-1 inline-flex min-w-4 items-center justify-center rounded-full bg-emerald-600 px-1 py-0.5 text-[9px] font-bold text-white">
            {visibleCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-10 z-30 w-[26rem] rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-[0_18px_60px_rgba(15,23,42,0.18)] dark:border-slate-700 dark:bg-slate-800 dark:shadow-[0_18px_60px_rgba(0,0,0,0.36)]">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <p className="text-sm font-bold text-slate-900">Командные сигналы</p>
              <p className="text-xs font-medium text-slate-500">Новые note, reassignment, blocked и SLA-эскалации по активным сигналам.</p>
            </div>
            <div className="flex items-center gap-2">
              {notifications.length ? (
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                  {unreadCount} unread
                </span>
              ) : null}
              {notifications.length ? (
                <button
                  type="button"
                  onClick={() => acknowledgeMutation.mutate(notifications.map((notification) => notification.eventId))}
                  disabled={acknowledgeMutation.isPending}
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-3 py-2 text-[11px] font-bold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {acknowledgeMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}
                  Подтвердить всё
                </button>
              ) : null}
            </div>
          </div>

          {notifications.length ? (
            <div className="mt-3 max-h-[26rem] space-y-3 overflow-y-auto pr-1">
              {notifications.map((notification) => {
                const Icon = getNotificationIcon(notification);

                return (
                  <div
                    key={notification.eventId}
                    data-testid="signal-notification-item"
                    className={`rounded-[1.35rem] border px-4 py-3 transition-colors ${
                      notification.isRead
                        ? 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50'
                        : 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-800/40 dark:bg-emerald-900/20'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className="mt-0.5 rounded-2xl bg-white dark:bg-slate-800 p-2 text-slate-500 dark:text-slate-400 shadow-sm">
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest ${getSeverityClass(notification.signalSeverity)}`}>
                              {notification.signalSeverity}
                            </span>
                            {notification.isSlaNotification ? (
                              <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-amber-700 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-300">
                                SLA
                              </span>
                            ) : null}
                            {notification.signalNmId ? (
                              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                                NM {notification.signalNmId}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-2 truncate text-sm font-bold text-slate-900">{notification.signalTitle}</p>
                          <p className="mt-1 text-xs font-medium leading-relaxed text-slate-600">{notification.summary}</p>
                          {notification.eventBody ? (
                            <p className="mt-2 line-clamp-2 text-xs font-medium leading-relaxed text-slate-500">
                              {notification.eventBody}
                            </p>
                          ) : null}
                          <div className="mt-3 flex items-center gap-2">
                            <Link
                              href={notification.href}
                              onClick={() => setOpen(false)}
                              className="inline-flex items-center rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-[11px] font-bold text-slate-700 dark:text-slate-300 transition-colors hover:bg-slate-50 dark:hover:bg-slate-700"
                            >
                              Открыть сигнал
                            </Link>
                            <button
                              type="button"
                              onClick={() => acknowledgeMutation.mutate([notification.eventId])}
                              disabled={acknowledgeMutation.isPending}
                              data-testid="signal-notification-ack"
                              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-[11px] font-bold text-slate-700 dark:text-slate-300 transition-colors hover:bg-slate-50 dark:hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              <CheckCheck className="h-3.5 w-3.5" />
                              Принято
                            </button>
                          </div>
                        </div>
                      </div>
                      <span className="shrink-0 text-[11px] font-medium text-slate-400">
                        {formatDateTime(notification.createdAt)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="py-8 text-center">
              <p className="text-sm font-bold text-slate-800">Новых командных событий нет</p>
              <p className="mt-1 text-xs font-medium leading-relaxed text-slate-500">
                Здесь появятся note, reassignment, blocked и SLA-эскалации от других операторов.
              </p>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
