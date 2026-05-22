'use client';

import { Loader2 } from 'lucide-react';
import { normalizeDecimalInput } from '../helpers';

// Amber-tinted manual input — visible in both light and dark themes via alpha.
const MANUAL_INPUT_CLASS =
  'border-amber-500/50 bg-amber-500/15 placeholder:text-amber-700/70 dark:placeholder:text-amber-300/70 focus:border-amber-500 focus:bg-amber-500/20 focus:ring-amber-400/30';

export function NumberInput({
  value,
  placeholder,
  loading = false,
  onChange,
  onBlur,
  widthClass = 'w-28',
  inputClassName = MANUAL_INPUT_CLASS,
}: {
  value: string;
  placeholder: string;
  loading?: boolean;
  onChange: (next: string) => void;
  onBlur?: () => void;
  widthClass?: string;
  inputClassName?: string;
}) {
  return (
    <div className="inline-flex items-center gap-2">
      <input
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(normalizeDecimalInput(event.target.value))}
        onBlur={onBlur}
        className={`${widthClass} rounded-lg border px-3 py-2 text-right font-mono text-xs font-semibold text-foreground transition-all focus:outline-none focus:ring-4 ${inputClassName}`}
      />
      {loading ? <Loader2 className="h-4 w-4 animate-spin text-emerald-500" /> : null}
    </div>
  );
}
