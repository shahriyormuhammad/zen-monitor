import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, BellRing, Receipt, ShieldCheck, Store } from 'lucide-react';
import { PasswordField } from '../_components/PasswordField';
import { signup } from '../login/actions';

export const metadata: Metadata = {
  title: 'Регистрация — Про Цифры',
  description: 'Создание аккаунта в сервисе контроля прибыли Вайлдберриз.',
};

const attributionFields = [
  'source',
  'ref',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
] as const;

type SignupSearchParams = {
  message?: string;
  messageType?: string;
} & Partial<Record<(typeof attributionFields)[number], string>>;

const onboardingSteps = [
  {
    title: 'Создаём аккаунт',
    description: 'Фиксируем контакт и источник заявки в админке.',
    icon: ShieldCheck,
  },
  {
    title: 'Выбираем пакет',
    description: 'После приветствия выбираете пробный пакет перед подключением WB.',
    icon: Store,
  },
  {
    title: 'Запускаем данные',
    description: 'Подключаем WB-ключ, создаём trial и запускаем первую синхронизацию.',
    icon: BellRing,
  },
] as const;

export default async function SignupPage(props: { searchParams: Promise<SignupSearchParams> }) {
  const searchParams = await props.searchParams;
  const isErrorMessage = !searchParams?.messageType || searchParams.messageType === 'error';

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 dark:bg-slate-950 dark:text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] w-full max-w-5xl items-center gap-8 lg:grid-cols-[0.95fr_1.05fr]">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_18px_60px_rgba(15,23,42,0.06)] dark:border-slate-800 dark:bg-slate-900 sm:p-8">
          <Link href="/" className="inline-flex items-center gap-3">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-900/25 dark:text-emerald-300">
              <Receipt className="h-6 w-6" />
            </span>
            <span>
              <span className="block text-lg font-black">Про Цифры</span>
              <span className="block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                Контроль прибыли ВБ
              </span>
            </span>
          </Link>

          <h1 className="mt-8 text-3xl font-black tracking-tight sm:text-4xl">
            Регистрация без лишних шагов
          </h1>
          <p className="mt-4 text-base leading-7 text-slate-600 dark:text-slate-300">
            Сначала создаём аккаунт, затем выбираем пробный пакет, подключаем Wildberries и сразу запускаем данные в фоне.
          </p>

          <div className="mt-8 space-y-4">
            {onboardingSteps.map((step, index) => (
              <div key={step.title} className="flex gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/45">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-emerald-700 shadow-sm dark:bg-slate-900 dark:text-emerald-300">
                  <step.icon className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Шаг {index + 1}</p>
                  <h2 className="mt-1 text-sm font-bold text-slate-950 dark:text-white">{step.title}</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">{step.description}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_18px_60px_rgba(15,23,42,0.06)] dark:border-slate-800 dark:bg-slate-900 sm:p-8">
          <div className="mb-6">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-300">Новый аккаунт</p>
            <h2 className="mt-2 text-2xl font-black tracking-tight">Создать аккаунт</h2>
          </div>

          <form className="flex flex-col gap-4">
            {attributionFields.map((field) => (
              <input key={field} type="hidden" name={field} value={searchParams?.[field] ?? ''} />
            ))}

            <div className="flex flex-col gap-1.5 text-sm">
              <label className="font-medium text-slate-700 dark:text-slate-300" htmlFor="signup-name">
                Имя
              </label>
              <input
                data-testid="signup-name"
                className="rounded-xl border border-slate-200 px-4 py-3 transition-colors focus:border-emerald-500 focus:outline-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                id="signup-name"
                name="name"
                type="text"
                autoComplete="name"
                placeholder="Иван"
                required
              />
            </div>

            <div className="flex flex-col gap-1.5 text-sm">
              <label className="font-medium text-slate-700 dark:text-slate-300" htmlFor="signup-email">
                Электронная почта
              </label>
              <input
                data-testid="signup-email"
                className="rounded-xl border border-slate-200 px-4 py-3 transition-colors focus:border-emerald-500 focus:outline-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                id="signup-email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="seller@wildberries.ru"
                required
              />
            </div>

            <div className="flex flex-col gap-1.5 text-sm">
              <label className="font-medium text-slate-700 dark:text-slate-300" htmlFor="signup-phone">
                Телефон
              </label>
              <input
                data-testid="signup-phone"
                className="rounded-xl border border-slate-200 px-4 py-3 transition-colors focus:border-emerald-500 focus:outline-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                id="signup-phone"
                name="phone"
                type="tel"
                autoComplete="tel"
                placeholder="+7 999 123-45-67"
                required
              />
            </div>

            <PasswordField
              id="signup-password"
              name="password"
              label="Пароль"
              autoComplete="new-password"
              testId="signup-password"
            />

            <PasswordField
              id="signup-confirm-password"
              name="confirmPassword"
              label="Подтвердите пароль"
              autoComplete="new-password"
              testId="signup-confirm-password"
              placeholder="Повторите пароль"
            />

            <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-medium leading-6 text-slate-600 dark:border-slate-800 dark:bg-slate-950/45 dark:text-slate-300">
              <input
                name="termsAccepted"
                type="checkbox"
                required
                className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span>Я принимаю условия сервиса и обработку данных для создания аккаунта.</span>
            </label>

            <button
              data-testid="signup-submit"
              formAction={signup}
              className="mt-2 inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 font-semibold text-white shadow-sm transition-all hover:bg-emerald-700 hover:shadow"
            >
              Создать аккаунт
              <ArrowRight className="h-4 w-4" />
            </button>

            <Link
              className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-center font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              href="/login"
            >
              Уже есть аккаунт
            </Link>

            {searchParams?.message ? (
              <p
                data-testid="signup-message"
                className={`rounded-lg p-3 text-center text-sm font-medium ${
                  isErrorMessage
                    ? 'border border-rose-100 bg-rose-50 text-rose-600 dark:border-rose-800/40 dark:bg-rose-900/20 dark:text-rose-300'
                    : 'border border-emerald-100 bg-emerald-50 text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-900/20 dark:text-emerald-300'
                }`}
              >
                {searchParams.message}
              </p>
            ) : null}
          </form>
        </section>
      </div>
    </main>
  );
}
