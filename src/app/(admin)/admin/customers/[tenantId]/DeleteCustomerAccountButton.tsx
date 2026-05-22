'use client';

import { useState } from 'react';

import { deleteCustomerAccountAction } from './actions';

export function DeleteCustomerAccountButton({
  tenantId,
  tenantName,
}: {
  tenantId: string;
  tenantName: string;
}) {
  const [confirmation, setConfirmation] = useState('');
  const confirmed = confirmation.trim() === tenantId || confirmation.trim() === tenantName;

  return (
    <form
      action={deleteCustomerAccountAction}
      className="space-y-3 rounded-lg border border-rose-200 bg-rose-50 p-4 dark:border-rose-900/40 dark:bg-rose-950/20"
      onSubmit={(event) => {
        if (!confirmed || !window.confirm(`Полностью удалить аккаунт ${tenantName} и все данные кабинета?`)) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="tenantId" value={tenantId} />
      <div>
        <h2 className="text-base font-black text-rose-900 dark:text-rose-200">Удаление аккаунта</h2>
        <p className="mt-1 text-sm font-semibold leading-6 text-rose-800/80 dark:text-rose-200/80">
          Удалит кабинет, WB-токены, подписки, платежи, синхронизации и клиентские данные.
          Пользователи без других кабинетов будут удалены из приложения и Supabase Auth.
        </p>
      </div>
      <label className="block">
        <span className="text-xs font-bold uppercase tracking-[0.18em] text-rose-900 dark:text-rose-200">
          Для подтверждения введите ID кабинета
        </span>
        <input
          name="confirmation"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          placeholder={tenantId}
          className="mt-2 w-full rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm font-semibold text-foreground outline-none focus:border-rose-500 dark:border-rose-900/50 dark:bg-background"
        />
      </label>
      <button
        type="submit"
        disabled={!confirmed}
        className="rounded-lg bg-rose-700 px-4 py-2 text-sm font-black text-white hover:bg-rose-600 disabled:cursor-not-allowed disabled:bg-rose-300 disabled:text-white/80 dark:disabled:bg-rose-950"
      >
        Удалить аккаунт полностью
      </button>
    </form>
  );
}
