'use client';

import { useEffect, useMemo, useState, useTransition, type ElementType } from 'react';
import { ArrowRight, BarChart3, Check, KeyRound, PackageCheck, RefreshCw, ShieldCheck, Store } from 'lucide-react';
import { useFormStatus } from 'react-dom';

import { completeOnboarding, selectOnboardingPlan } from './actions';

export type OnboardingPlanOption = {
  code: string;
  name: string;
  priceRub: number;
  billingPeriod: string;
  maxTenants: number | null;
  maxUsers: number | null;
};

type OnboardingSetupProps = {
  plans: OnboardingPlanOption[];
  defaultPlanCode: string | null;
  message?: string | null;
  messageType?: string | null;
};

const planLabels: Record<string, { title: string; tag: string; description: string; bullets: string[] }> = {
  solo: {
    title: 'Старт',
    tag: 'для первого магазина',
    description: 'Базовый контроль продаж, прибыли и ключевых цифр без сложной настройки.',
    bullets: ['1 магазин', 'основной дашборд', 'ручная себестоимость'],
  },
  growth: {
    title: 'Рост',
    tag: 'для ежедневной работы',
    description: 'Рабочий пакет для прибыли, рекламы, остатков и регулярных решений.',
    bullets: ['до 3 магазинов', 'реклама и остатки', 'сигналы по прибыли'],
  },
  team: {
    title: 'Команда',
    tag: 'для нескольких ролей',
    description: 'Командный доступ, распределение задач и контроль операционных контуров.',
    bullets: ['до 10 пользователей', 'командные роли', 'операционная очередь'],
  },
  ops: {
    title: 'Масштаб',
    tag: 'для большого ассортимента',
    description: 'Расширенный контур для нескольких магазинов, автоматизации и складских задач.',
    bullets: ['без лимита магазинов', 'автоматизация', 'перераспределение'],
  },
};

const setupSteps: Array<{ label: string; icon: ElementType<{ className?: string }> }> = [
  { label: 'Аккаунт создан', icon: ShieldCheck },
  { label: 'Пакет выбран', icon: PackageCheck },
  { label: 'WB-ключ подключен', icon: KeyRound },
  { label: 'Синхронизация в фоне', icon: RefreshCw },
];

function formatPlanTitle(plan: OnboardingPlanOption) {
  return planLabels[plan.code]?.title ?? plan.name;
}

function formatPrice(plan: OnboardingPlanOption) {
  if (plan.priceRub > 0) {
    return `${plan.priceRub.toLocaleString('ru-RU')} ₽/мес`;
  }

  return 'пробный запуск';
}

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-slate-950 px-5 text-sm font-black text-white transition hover:bg-slate-800 disabled:cursor-wait disabled:opacity-70 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
      disabled={pending}
      type="submit"
    >
      {pending ? (
        <>
          <RefreshCw className="h-4 w-4 animate-spin" />
          Подключаем
        </>
      ) : (
        <>
          Проверить и запустить
          <ArrowRight className="h-4 w-4" />
        </>
      )}
    </button>
  );
}

export function OnboardingSetup({ plans, defaultPlanCode, message, messageType }: OnboardingSetupProps) {
  const firstPlanCode = plans[0]?.code ?? '';
  const initialPlanCode = defaultPlanCode && plans.some((plan) => plan.code === defaultPlanCode)
    ? defaultPlanCode
    : firstPlanCode;
  const [selectedPlanCode, setSelectedPlanCode] = useState(initialPlanCode);
  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.code === selectedPlanCode) ?? plans[0] ?? null,
    [plans, selectedPlanCode],
  );
  const [, startPlanSelectionTransition] = useTransition();
  const isErrorMessage = !messageType || messageType === 'error';

  useEffect(() => {
    if (!selectedPlan?.code) return;

    startPlanSelectionTransition(() => {
      void selectOnboardingPlan(selectedPlan.code);
    });
  }, [selectedPlan?.code, startPlanSelectionTransition]);

  return (
    <main className="min-h-screen bg-[#f4f7fb] px-4 py-6 text-slate-950 dark:bg-[#050609] dark:text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto grid w-full max-w-6xl gap-6 lg:grid-cols-[300px_1fr]">
        <aside className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <p className="text-[11px] font-black uppercase tracking-[0.28em] text-cyan-700 dark:text-cyan-300">Настройка аккаунта</p>
          <h1 className="mt-3 text-2xl font-black tracking-tight">Подключите магазин и начните работу</h1>
          <p className="mt-3 text-sm font-medium leading-6 text-slate-600 dark:text-slate-300">
            Выберите пробный пакет, добавьте рабочий WB API-ключ, а первую загрузку данных мы запустим в фоне.
          </p>

          <div className="mt-6 space-y-3">
            {setupSteps.map(({ label, icon: Icon }, index) => (
              <div key={label} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/50">
                <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${index === 0 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-white text-cyan-700 dark:bg-slate-900 dark:text-cyan-300'}`}>
                  {index === 0 ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                </span>
                <span className="text-sm font-bold">{label}</span>
              </div>
            ))}
          </div>
        </aside>

        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-6">
          <form action={completeOnboarding} className="space-y-7">
            <input name="planCode" type="hidden" value={selectedPlan?.code ?? ''} />

            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-cyan-50 px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-cyan-700 dark:bg-cyan-900/20 dark:text-cyan-300">
                <PackageCheck className="h-4 w-4" />
                Шаг 1
              </div>
              <h2 className="mt-4 text-3xl font-black tracking-tight">Выберите пакет</h2>
              <p className="mt-2 text-sm font-medium leading-6 text-slate-600 dark:text-slate-300">
                Сейчас это пробный доступ. Финальную тарифную сетку утвердим отдельно, но выбор уже попадёт в админку и подписку.
              </p>

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                {plans.map((plan) => {
                  const meta = planLabels[plan.code];
                  const selected = plan.code === selectedPlanCode;

                  return (
                    <button
                      key={plan.code}
                      type="button"
                      onClick={() => setSelectedPlanCode(plan.code)}
                      className={`min-h-[220px] rounded-lg border p-5 text-left transition ${
                        selected
                          ? 'border-cyan-400 bg-cyan-50 shadow-[0_0_0_3px_rgba(34,211,238,0.18)] dark:border-cyan-500 dark:bg-cyan-950/30'
                          : 'border-slate-200 bg-slate-50 hover:border-cyan-300 dark:border-slate-800 dark:bg-slate-950/40'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                            {meta?.tag ?? 'пробный пакет'}
                          </p>
                          <h3 className="mt-2 text-2xl font-black tracking-tight">{formatPlanTitle(plan)}</h3>
                        </div>
                        <span className={`rounded-full border px-3 py-1 text-xs font-black ${selected ? 'border-cyan-300 bg-white text-cyan-800 dark:border-cyan-700 dark:bg-slate-900 dark:text-cyan-200' : 'border-slate-200 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'}`}>
                          {selected ? 'Выбран' : 'Выбрать'}
                        </span>
                      </div>
                      <p className="mt-4 text-sm font-medium leading-6 text-slate-600 dark:text-slate-300">
                        {meta?.description ?? 'Пакет для пробного запуска сервиса.'}
                      </p>
                      <p className="mt-4 text-lg font-black">{formatPrice(plan)}</p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {(meta?.bullets ?? [`${plan.maxTenants ?? 'несколько'} магазинов`, `${plan.maxUsers ?? 'несколько'} пользователей`]).map((item) => (
                          <span key={item} className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                            {item}
                          </span>
                        ))}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-5 border-t border-slate-200 pt-6 dark:border-slate-800 lg:grid-cols-[1fr_280px]">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">
                  <Store className="h-4 w-4" />
                  Шаг 2
                </div>
                <h2 className="mt-4 text-3xl font-black tracking-tight">Подключите Wildberries</h2>
                <p className="mt-2 text-sm font-medium leading-6 text-slate-600 dark:text-slate-300">
                  Нужен рабочий персональный API-ключ WB. Режим только чтение подходит для старта.
                </p>

                <div className="mt-5 space-y-4">
                  <label className="block text-sm font-bold">
                    Название магазина
                    <input
                      className="mt-2 h-12 w-full rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold outline-none focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
                      name="shopName"
                      placeholder="Например: Основной кабинет WB"
                      required
                    />
                  </label>
                  <label className="block text-sm font-bold">
                    WB API-ключ
                    <textarea
                      className="mt-2 min-h-28 w-full resize-y rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-semibold outline-none focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
                      name="wbToken"
                      placeholder="Вставьте API-ключ из кабинета продавца WB"
                      required
                    />
                  </label>
                </div>

                {message ? (
                  <p className={`mt-4 rounded-lg border p-3 text-sm font-bold ${
                    isErrorMessage
                      ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800/40 dark:bg-rose-900/20 dark:text-rose-300'
                      : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-900/20 dark:text-emerald-300'
                  }`}>
                    {message}
                  </p>
                ) : null}

                <div className="mt-5">
                  <SubmitButton />
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-950/45">
                <BarChart3 className="h-6 w-6 text-cyan-700 dark:text-cyan-300" />
                <h3 className="mt-4 text-base font-black">После запуска</h3>
                <div className="mt-4 space-y-3 text-sm font-medium leading-6 text-slate-600 dark:text-slate-300">
                  <p>Создадим пробную подписку по выбранному пакету.</p>
                  <p>Запустим первую синхронизацию без ожидания на этой странице.</p>
                  <p>Откроем стартовый кабинет с прогрессом и следующими действиями.</p>
                </div>
              </div>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}
