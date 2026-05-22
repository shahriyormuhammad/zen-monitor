import { redirect } from 'next/navigation'
import { Receipt } from 'lucide-react'
import { PasswordField } from '../_components/PasswordField'
import { login, requestPasswordReset } from './actions'

export default async function LoginPage(props: { searchParams: Promise<{ message?: string; mode?: string; messageType?: string }> }) {
  const searchParams = await props.searchParams;
  const isForgotMode = searchParams?.mode === 'forgot';
  const isSignupMode = searchParams?.mode === 'signup';
  const isForgotError = searchParams?.messageType === 'error';
  const isErrorMessage = !searchParams?.messageType || searchParams.messageType === 'error';
  const authTitle = isForgotMode ? 'Восстановление пароля' : 'Вход в кабинет';

  if (isSignupMode) {
    const params = new URLSearchParams();
    if (searchParams?.message) params.set('message', searchParams.message);
    if (searchParams?.messageType) params.set('messageType', searchParams.messageType);
    const query = params.toString();
    redirect(`/signup${query ? `?${query}` : ''}`);
  }

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-slate-50 px-4 py-8 dark:bg-slate-900">
      <div className="flex w-full max-w-sm flex-col items-center gap-6 rounded-2xl bg-white dark:bg-slate-800 p-8 shadow-[0_4px_20px_rgba(0,0,0,0.03)] border border-slate-200/60 dark:border-slate-700">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2.5 bg-emerald-50 rounded-xl">
             <Receipt className="w-6 h-6 text-emerald-600" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-800 dark:text-slate-100">
            {authTitle}
          </h1>
        </div>

        {isForgotMode ? (
          <form className="flex w-full flex-col gap-4">
            <p className="text-sm text-slate-600">
              Введите email, и мы отправим ссылку для установки нового пароля.
            </p>
            <div className="flex flex-col gap-1.5 text-sm">
              <label className="font-medium text-slate-700 dark:text-slate-300" htmlFor="forgot-email">Электронная почта</label>
              <input
                data-testid="forgot-email"
                className="rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-4 py-3 focus:outline-emerald-500 focus:border-emerald-500 transition-colors"
                id="forgot-email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="seller@wildberries.ru"
                required
              />
            </div>
            <button
              data-testid="forgot-submit"
              formAction={requestPasswordReset}
              className="rounded-xl bg-emerald-600 px-4 py-3 text-white font-semibold shadow-sm hover:bg-emerald-700 hover:shadow transition-all"
            >
              Отправить ссылку
            </button>
            <a
              className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 text-slate-700 font-medium hover:bg-slate-100 transition-colors text-center dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700"
              href="/login"
            >
              Вернуться ко входу
            </a>
            {searchParams?.message && (
              <p
                data-testid="login-message"
                className={`mt-2 p-3 rounded-lg text-sm font-medium text-center ${
                  isForgotError
                    ? 'bg-rose-50 border border-rose-100 text-rose-700 dark:bg-rose-900/20 dark:border-rose-800/40 dark:text-rose-300'
                    : 'bg-emerald-50 border border-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-800/40 dark:text-emerald-300'
                }`}
              >
                {searchParams.message}
              </p>
            )}
          </form>
        ) : (
          <form className="flex w-full flex-col gap-4">
            <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
              Войдите, чтобы продолжить работу с аналитикой и настройками кабинета.
            </p>
            <div className="flex flex-col gap-1.5 text-sm">
              <label className="font-medium text-slate-700 dark:text-slate-300" htmlFor="email">Электронная почта</label>
              <input data-testid="login-email" className="rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-4 py-3 focus:outline-emerald-500 focus:border-emerald-500 transition-colors" id="email" name="email" type="email" autoComplete="email" placeholder="seller@wildberries.ru" required />
            </div>
            <div className="mb-2">
              <PasswordField
                id="password"
                name="password"
                label="Пароль"
                autoComplete="current-password"
                testId="login-password"
                placeholder="Введите пароль"
              />
            </div>
            <button data-testid="login-submit" formAction={login} className="rounded-xl bg-emerald-600 px-4 py-3 text-white font-semibold shadow-sm hover:bg-emerald-700 hover:shadow transition-all">
              Войти в кабинет
            </button>
            <a className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 text-slate-700 font-medium hover:bg-slate-100 transition-colors text-center dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700" href="/signup">
              Создать аккаунт
            </a>
            <a className="text-sm text-center text-emerald-700 hover:text-emerald-800 transition-colors" href="/login?mode=forgot">
              Забыли пароль?
            </a>
            {searchParams?.message && (
              <p
                data-testid="login-message"
                className={`mt-2 p-3 rounded-lg text-sm font-medium text-center ${
                  isErrorMessage
                    ? 'bg-rose-50 border border-rose-100 text-rose-600 dark:bg-rose-900/20 dark:border-rose-800/40 dark:text-rose-300'
                    : 'bg-emerald-50 border border-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-800/40 dark:text-emerald-300'
                }`}
              >
                {searchParams.message}
              </p>
            )}
          </form>
        )}
      </div>
    </div>
  )
}
