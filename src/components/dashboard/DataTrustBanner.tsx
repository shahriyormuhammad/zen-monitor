'use client';

import { AlertTriangle, CheckCircle2, ShieldAlert } from 'lucide-react';
import type { DashboardDataTrustAudit } from '@/server/analytics/engine';
import type { ReactNode } from 'react';

const STATUS_VIEW: Record<DashboardDataTrustAudit['status'], {
  tone: string;
  icon: ReactNode;
  title: string;
}> = {
  ok: {
    tone: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800/40 dark:bg-emerald-900/20 dark:text-emerald-200',
    icon: <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />,
    title: 'Надёжность данных: ОК',
  },
  warning: {
    tone: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-200',
    icon: <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />,
    title: 'Надёжность данных: есть предупреждения',
  },
  critical: {
    tone: 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-800/40 dark:bg-rose-900/20 dark:text-rose-200',
    icon: <ShieldAlert className="h-5 w-5 text-rose-600 dark:text-rose-400" />,
    title: 'Надёжность данных: критично',
  },
};

function formatDeltaPct(value: number | null) {
  if (value === null || Number.isNaN(value)) {
    return 'н/д';
  }
  return `${value.toFixed(2)}%`;
}

export function DataTrustBanner({ audit }: { audit: DashboardDataTrustAudit }) {
  const view = STATUS_VIEW[audit.status];
  const topIssues = audit.checks
    .filter((check) => check.status !== 'ok')
    .slice(0, 3);

  return (
    <div className={`rounded-[2rem] border px-5 py-4 shadow-sm ${view.tone}`}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {view.icon}
            <h3 className="text-sm font-bold tracking-tight">{view.title}</h3>
          </div>
          <div className="rounded-full border border-current/20 bg-white/50 px-3 py-1 text-xs font-bold uppercase tracking-widest">
            score {audit.score}/100
          </div>
        </div>

        <p className="text-sm leading-relaxed opacity-90">
          Источники: реклама = <span className="font-semibold">{audit.sources.adsSource}</span>, topline ={' '}
          <span className="font-semibold">{audit.sources.toplineSource}</span>, режим ={' '}
          <span className="font-semibold">{audit.sources.calculationMode}</span>.
        </p>

        {topIssues.length > 0 ? (
          <div className="space-y-2">
            {topIssues.map((issue) => (
              <div key={issue.id} className="rounded-xl border border-current/15 bg-white/50 px-3 py-2">
                <div className="text-xs font-bold uppercase tracking-widest opacity-80">{issue.label}</div>
                <div className="mt-0.5 text-sm font-semibold">
                  {issue.actual}
                  {issue.deltaPct !== null ? ` • Δ ${formatDeltaPct(issue.deltaPct)}` : ''}
                </div>
                <div className="mt-0.5 text-xs opacity-80">{issue.details}</div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm font-medium">Критичных и предупреждающих расхождений не обнаружено.</p>
        )}

        {audit.blockers.length > 0 ? (
          <p className="text-xs font-semibold uppercase tracking-widest opacity-90">
            Блокеры: {audit.blockers.join(' • ')}
          </p>
        ) : null}
      </div>
    </div>
  );
}
