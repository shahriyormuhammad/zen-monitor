'use client';

import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';

type OperatorStateTone = 'default' | 'warning' | 'danger' | 'success';

const toneStyles: Record<OperatorStateTone, string> = {
  default: 'border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300',
  warning: 'border-amber-200 bg-amber-50/60 text-amber-900 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-200',
  danger: 'border-rose-200 bg-rose-50/60 text-rose-900 dark:border-rose-800/40 dark:bg-rose-900/20 dark:text-rose-200',
  success: 'border-emerald-200 bg-emerald-50/60 text-emerald-900 dark:border-emerald-800/40 dark:bg-emerald-900/20 dark:text-emerald-200',
};

const iconToneStyles: Record<OperatorStateTone, string> = {
  default: 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400',
  warning: 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400',
  danger: 'bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-400',
  success: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400',
};

interface OperatorStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  tone?: OperatorStateTone;
  actionLabel?: string;
  actionHref?: string;
  action?: () => void;
  actionDisabled?: boolean;
  secondaryText?: string;
}

export function OperatorState({
  icon: Icon,
  title,
  description,
  tone = 'default',
  actionLabel,
  actionHref,
  action,
  actionDisabled = false,
  secondaryText,
}: OperatorStateProps) {
  const actionClassName = 'inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white transition-all hover:bg-black disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <div className={`rounded-[2rem] border p-8 shadow-sm ${toneStyles[tone]}`}>
      <div className={`mb-5 flex h-14 w-14 items-center justify-center rounded-2xl ${iconToneStyles[tone]}`}>
        <Icon className="h-7 w-7" />
      </div>

      <h3 className="text-xl font-bold tracking-tight">{title}</h3>
      <p className="mt-2 max-w-2xl text-sm font-medium leading-relaxed text-inherit/80">{description}</p>

      {(actionLabel || secondaryText) && (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          {actionLabel && actionHref ? (
            <Link href={actionHref} className={actionClassName}>
              {actionLabel}
            </Link>
          ) : null}

          {actionLabel && action ? (
            <button type="button" onClick={action} disabled={actionDisabled} className={actionClassName}>
              {actionLabel}
            </button>
          ) : null}

          {secondaryText ? (
            <span className="text-xs font-bold uppercase tracking-widest text-inherit/60">{secondaryText}</span>
          ) : null}
        </div>
      )}
    </div>
  );
}
