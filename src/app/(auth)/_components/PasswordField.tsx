'use client';

import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

type PasswordFieldProps = {
  id: string;
  name: string;
  label: string;
  autoComplete: string;
  testId?: string;
  placeholder?: string;
  required?: boolean;
};

export function PasswordField({
  id,
  name,
  label,
  autoComplete,
  testId,
  placeholder = 'Минимум 8 символов',
  required = true,
}: PasswordFieldProps) {
  const [isVisible, setIsVisible] = useState(false);
  const labelText = isVisible ? 'Скрыть пароль' : 'Показать пароль';
  const Icon = isVisible ? EyeOff : Eye;

  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <label className="font-medium text-slate-700 dark:text-slate-300" htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <input
          data-testid={testId}
          className="w-full rounded-xl border border-slate-200 px-4 py-3 pr-12 transition-colors focus:border-emerald-500 focus:outline-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          id={id}
          name={name}
          type={isVisible ? 'text' : 'password'}
          autoComplete={autoComplete}
          placeholder={placeholder}
          required={required}
        />
        <button
          type="button"
          aria-label={labelText}
          title={labelText}
          className="absolute right-2 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 focus:outline-emerald-500 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100"
          onClick={() => setIsVisible((value) => !value)}
        >
          <Icon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
