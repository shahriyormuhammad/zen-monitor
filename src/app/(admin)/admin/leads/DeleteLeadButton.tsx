'use client';

import { deleteLeadRegistrationAction } from './actions';

export function DeleteLeadButton({
  id,
  userId,
  email,
  disabled,
}: {
  id: string;
  userId: string | null;
  email: string;
  disabled: boolean;
}) {
  return (
    <form
      action={deleteLeadRegistrationAction}
      onSubmit={(event) => {
        if (disabled || !window.confirm(`Удалить регистрацию ${email}? Email сможет зарегистрироваться заново.`)) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="email" value={email} />
      {userId ? <input type="hidden" name="userId" value={userId} /> : null}
      <button
        type="submit"
        disabled={disabled}
        className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:border-border disabled:bg-subtle disabled:text-muted-foreground dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-300"
        title={disabled ? 'У регистрации есть магазин. Откройте карточку кабинета и используйте полное удаление аккаунта.' : 'Удалить регистрацию без магазина'}
      >
        Удалить
      </button>
    </form>
  );
}
