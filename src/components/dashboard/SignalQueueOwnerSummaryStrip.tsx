'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ArrowRightLeft, Clock3, Pin, Users } from 'lucide-react';

import type { SignalQueueOwnerSummary, SignalQueueView } from '@/lib/operator-signal-timeline';
import { getDefaultSortPresetForQueueView } from '@/lib/signal-queue-utils';
import { cn } from '@/lib/utils';

export function SignalQueueOwnerSummaryStrip({ summary }: { summary: SignalQueueOwnerSummary[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (summary.length === 0) {
    return null;
  }

  const activeOwnerQueue = searchParams.get('ownerQueue') ?? 'all';
  const activeOwnerQueueView = searchParams.get('ownerQueueView') ?? 'all';

  function openOwnerQueue(ownerUserId: string | null, queueView: SignalQueueView) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('ownerQueue', ownerUserId ?? 'unassigned');
    params.set('ownerQueueView', queueView);
    params.set('ownerQueueSort', getDefaultSortPresetForQueueView(queueView));
    const nextQuery = params.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  }

  return (
    <div className="rounded-[2rem] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-5 py-5 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Queue owners</p>
          <h3 className="mt-1 text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">Командная нагрузка по owner queues</h3>
        </div>
        <p className="text-[11px] font-medium leading-relaxed text-slate-500">
          Shared queues, pending SLA follow-ups и просрочка по закреплённым сигналам в одном срезе.
        </p>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-4">
        {summary.slice(0, 4).map((owner) => {
          const emphasized = owner.pendingOutcomesCount > 0 || owner.overdueAssignedCount > 0;
          const ownerKey = owner.ownerUserId ?? 'unassigned';

          return (
            <div
              key={owner.key}
              className={cn(
                'rounded-[1.5rem] border px-4 py-4 transition-colors',
                emphasized ? 'border-blue-200 bg-blue-50 dark:border-blue-800/40 dark:bg-blue-900/20' : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50',
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-900 dark:text-slate-100">{owner.label}</p>
                  <p className="mt-1 text-[11px] font-medium leading-relaxed text-slate-500">
                    {owner.teamDefaultName
                      ? `${owner.ownerUserId ? 'Owner default' : 'Team default'}: ${owner.teamDefaultName}`
                      : 'Нет default queue'}
                  </p>
                </div>
                <div className={cn(
                  'rounded-2xl border p-2.5',
                  emphasized ? 'border-blue-200 bg-white text-blue-700 dark:border-blue-800/40 dark:bg-blue-900/20 dark:text-blue-300' : 'border-slate-200 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400',
                )}>
                  <Users className="h-4 w-4" />
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <div className="rounded-2xl border border-white/80 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2">
                  <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-slate-400">
                    <ArrowRightLeft className="h-3 w-3" />
                    Pending
                  </span>
                  <span className="mt-1 block text-lg font-black tracking-tight text-slate-900 dark:text-slate-100">{owner.pendingOutcomesCount}</span>
                </div>
                <div className="rounded-2xl border border-white/80 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2">
                  <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-slate-400">
                    <Clock3 className="h-3 w-3" />
                    Overdue
                  </span>
                  <span className="mt-1 block text-lg font-black tracking-tight text-slate-900 dark:text-slate-100">{owner.overdueAssignedCount}</span>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                <span className="rounded-full bg-white dark:bg-slate-800 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-slate-600 dark:text-slate-400">
                  Assigned {owner.assignedSignalsCount}
                </span>
                <span className="rounded-full bg-white dark:bg-slate-800 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-slate-600 dark:text-slate-400">
                  Views {owner.teamViewsCount}
                </span>
                <span className="rounded-full bg-white dark:bg-slate-800 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-slate-600 dark:text-slate-400">
                  Runs {owner.recentRunsCount}
                </span>
                {owner.pinnedViewsCount ? (
                  <span className="rounded-full bg-white dark:bg-slate-800 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-slate-600 dark:text-slate-400">
                    <span className="inline-flex items-center gap-1">
                      <Pin className="h-3 w-3" />
                      {owner.pinnedViewsCount}
                    </span>
                  </span>
                ) : null}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                {([
                  ['needs_action', 'Needs action'],
                  ['awaiting_owner', 'Awaiting owner'],
                  ['blocked', 'Blocked'],
                  ['overdue_only', 'Overdue'],
                ] as const).map(([queueView, label]) => {
                  const active = activeOwnerQueue === ownerKey && activeOwnerQueueView === queueView;
                  return (
                    <button
                      key={`${owner.key}-${queueView}`}
                      type="button"
                      onClick={() => openOwnerQueue(owner.ownerUserId, queueView)}
                      className={cn(
                        'rounded-2xl border px-3 py-2 text-left transition-colors',
                        active ? 'border-blue-300 bg-white text-blue-700 dark:border-blue-800/40 dark:bg-blue-900/20 dark:text-blue-300' : 'border-white/80 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700',
                      )}
                    >
                      <span className="block text-[9px] font-bold uppercase tracking-widest text-slate-400">{label}</span>
                      <span className="mt-1 block text-base font-black tracking-tight">{owner.queueCounts[queueView]}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
