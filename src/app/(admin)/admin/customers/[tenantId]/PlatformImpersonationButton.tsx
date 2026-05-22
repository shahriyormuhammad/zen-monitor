'use client';

import { useState } from 'react';

import { startPlatformImpersonation } from '../../impersonation-actions';

const reasons = [
  { value: 'support_debug', label: 'Разбор обращения' },
  { value: 'onboarding_help', label: 'Помощь с настройкой' },
  { value: 'billing_support', label: 'Проверка оплаты/подписки' },
  { value: 'incident_review', label: 'Инцидент или ошибка' },
  { value: 'owner_request', label: 'Просьба владельца' },
];

export function PlatformImpersonationButton({ tenantId }: { tenantId: string }) {
  const [open, setOpen] = useState(false);
  const action = startPlatformImpersonation.bind(null, tenantId);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg bg-foreground px-3 py-2 text-sm font-bold text-background hover:opacity-90"
      >
        Посмотреть кабинет
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4">
          <div className="w-full max-w-lg rounded-lg border border-border bg-card p-5 text-card-foreground shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-black text-foreground">Посмотреть кабинет клиента</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Откроем кабинет как клиентский владелец с полным доступом.
                  Старт, переключения и завершение сессии попадут в audit log.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg border border-border px-2.5 py-1.5 text-sm font-bold text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                Закрыть
              </button>
            </div>

            <form action={action} className="mt-5 space-y-4">
              <label className="block">
                <span className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
                  Причина
                </span>
                <select
                  name="reason"
                  required
                  className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-semibold text-foreground outline-none focus:border-cyan-500"
                  defaultValue="support_debug"
                >
                  {reasons.map((reason) => (
                    <option key={reason.value} value={reason.value}>
                      {reason.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
                  Комментарий
                </span>
                <textarea
                  name="note"
                  rows={4}
                  className="mt-2 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground outline-none focus:border-cyan-500"
                  placeholder="Например: клиент попросил проверить расхождение в отчёте"
                />
              </label>

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-bold text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-black text-white hover:bg-cyan-500"
                >
                  Открыть /overview
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
