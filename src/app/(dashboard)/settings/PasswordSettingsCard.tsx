'use client';

import { useState, type FormEvent } from 'react';
import { CheckCircle2, KeyRound } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

const MIN_PASSWORD_LENGTH = 8;

export function PasswordSettingsCard() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const updatePassword = async (event: FormEvent) => {
    event.preventDefault();
    setMessage(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setStatus('error');
      setMessage(`Минимум ${MIN_PASSWORD_LENGTH} символов.`);
      return;
    }

    if (password !== confirmPassword) {
      setStatus('error');
      setMessage('Пароли не совпадают.');
      return;
    }

    setStatus('saving');
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setStatus('error');
      setMessage(error.message);
      return;
    }

    setPassword('');
    setConfirmPassword('');
    setStatus('success');
    setMessage('Пароль обновлён.');
  };

  return (
    <div className="rounded-[1.5rem] border border-slate-200/70 bg-white p-6 shadow-[0_4px_25px_rgba(15,23,42,0.03)] dark:border-slate-700/70 dark:bg-slate-800/50">
      <div className="mb-5 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/30 dark:text-slate-300">
          <KeyRound className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Пароль</h3>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Безопасность аккаунта</p>
        </div>
      </div>

      <form onSubmit={updatePassword} className="space-y-3">
        <input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Новый пароль"
          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium outline-none transition-all focus:border-slate-400 focus:bg-white dark:border-slate-700 dark:bg-slate-900/30 dark:text-slate-200 dark:focus:bg-slate-800"
        />
        <input
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          placeholder="Повторите пароль"
          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium outline-none transition-all focus:border-slate-400 focus:bg-white dark:border-slate-700 dark:bg-slate-900/30 dark:text-slate-200 dark:focus:bg-slate-800"
        />

        {message ? (
          <div className={`rounded-xl border px-3 py-2 text-xs font-semibold ${
            status === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-900/20 dark:text-emerald-300'
              : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800/40 dark:bg-rose-900/20 dark:text-rose-300'
          }`}>
            {message}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={status === 'saving' || !password || !confirmPassword}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white transition-all hover:bg-slate-800 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
        >
          {status === 'success' ? <CheckCircle2 className="h-4 w-4" /> : null}
          {status === 'saving' ? 'Обновление...' : status === 'success' ? 'Пароль обновлён' : 'Сменить пароль'}
        </button>
      </form>
    </div>
  );
}
