'use client';

import { AlertTriangle, ArrowRight, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { SignalDashboardSlaSummary } from '@/lib/operator-signal-timeline';
import { cn } from '@/lib/utils';

type SummaryCard = {
  id: keyof SignalDashboardSlaSummary;
  title: string;
  description: string;
  icon: LucideIcon;
  accentClass: string;
};

const SUMMARY_CARDS: SummaryCard[] = [
  {
    id: 'overdueBlockedCount',
    title: 'Blocked overdue',
    description: 'Сигналы в blocked, которые уже вышли за SLA и требуют эскалации.',
    icon: AlertTriangle,
    accentClass: 'text-rose-600 bg-rose-50 border-rose-200 dark:text-rose-300 dark:bg-rose-900/20 dark:border-rose-800/40',
  },
  {
    id: 'overdueHandoffCount',
    title: 'Handoff overdue',
    description: 'Переданные сигналы, по которым owner/admin не дал обратную связь вовремя.',
    icon: ArrowRight,
    accentClass: 'text-amber-600 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-900/20 dark:border-amber-800/40',
  },
  {
    id: 'agingNeedsActionCount',
    title: 'Needs action aging',
    description: 'Рабочая очередь, где сигналы уже стареют и их нужно подтолкнуть до overdue.',
    icon: Zap,
    accentClass: 'text-blue-600 bg-blue-50 border-blue-200 dark:text-blue-300 dark:bg-blue-900/20 dark:border-blue-800/40',
  },
];

export function SignalSlaSummaryStrip({ summary }: { summary: SignalDashboardSlaSummary }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {SUMMARY_CARDS.map((card) => {
        const count = summary[card.id];
        const Icon = card.icon;
        const emphasized = count > 0;

        return (
          <div
            key={card.id}
            className={cn(
              'rounded-[2rem] border px-5 py-4 shadow-sm transition-colors',
              emphasized ? card.accentClass : 'border-slate-200 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400',
            )}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest opacity-70">{card.title}</p>
                <p className="mt-2 text-3xl font-black tracking-tight">{count}</p>
              </div>
              <div className={cn(
                'rounded-2xl border p-3',
                emphasized ? 'border-current/20 bg-white/60 dark:bg-white/10' : 'border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-700 dark:bg-slate-800',
              )}>
                <Icon className="h-5 w-5" />
              </div>
            </div>
            <p className="mt-3 text-xs font-medium leading-relaxed opacity-80">
              {card.description}
            </p>
          </div>
        );
      })}
    </div>
  );
}
