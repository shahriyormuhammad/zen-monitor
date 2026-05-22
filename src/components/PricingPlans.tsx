'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check } from 'lucide-react';

const SIGNUP_HREF = '/signup';

type PeriodId = 'month' | 'half' | 'year';

type Period = {
  id: PeriodId;
  label: string;
  months: number;
  discount: number;
};

const periods: readonly Period[] = [
  { id: 'month', label: 'Помесячно', months: 1, discount: 0 },
  { id: 'half', label: '6 месяцев', months: 6, discount: 0.2 },
  { id: 'year', label: '12 месяцев', months: 12, discount: 0.35 },
];

type Tier = {
  name: string;
  audience: string;
  description: string;
  monthly: number;
  features: readonly string[];
  highlight: boolean;
};

const tiers: readonly Tier[] = [
  {
    name: 'Старт',
    audience: 'Первый кабинет',
    description: 'Чтобы наконец увидеть реальную прибыль и сигналы без ручной склейки таблиц.',
    monthly: 1490,
    features: [
      '1 кабинет Wildberries',
      'Обзор, сигналы и план продаж',
      'Юнит-экономика и контроль рекламы',
      'Отзывы и вопросы',
    ],
    highlight: false,
  },
  {
    name: 'Рост',
    audience: 'Масштабирование',
    description: 'Для продавца, который упёрся в ручной разбор ассортимента, рекламы и экономики.',
    monthly: 3490,
    features: [
      'До 3 кабинетов',
      'Автопилот рекламы и Decision Center',
      'SEO-аудит и работа с карточками',
      'Перераспределение остатков',
      'Финансовый учёт',
    ],
    highlight: true,
  },
  {
    name: 'Команда',
    audience: 'Владелец и операторы',
    description: 'Для команды, которая работает через очереди владельца и передачу задач.',
    monthly: 6990,
    features: [
      'Всё из тарифа «Рост»',
      'До 6 кабинетов',
      'Роли и общие представления',
      'Очереди и передача задач',
      'Уведомления в Telegram',
    ],
    highlight: false,
  },
  {
    name: 'Операции',
    audience: 'Сложная операционка',
    description: 'Для контуров, где критичны маршруты, автоматизация и внедрение с поддержкой.',
    monthly: 12990,
    features: [
      'Всё из тарифа «Команда»',
      'Кабинеты и команды без лимита',
      'Приоритетная поддержка при запуске',
      'Помощь с настройкой автопилота',
      'Сценарии под автоматизацию',
    ],
    highlight: false,
  },
];

// Deterministic RU formatting (no Intl) so SSR and client output match exactly.
const formatRub = (value: number) => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const perMonthPrice = (monthly: number, discount: number) =>
  Math.round((monthly * (1 - discount)) / 10) * 10;

export function PricingPlans() {
  const [periodId, setPeriodId] = useState<PeriodId>('month');
  const period = periods.find((item) => item.id === periodId) ?? periods[0]!;

  return (
    <div className="mt-10">
      <div className="flex justify-center">
        <div
          role="tablist"
          aria-label="Срок подписки"
          className="inline-flex rounded-2xl border border-border/70 bg-card/80 p-1 shadow-[var(--shadow-xs)] backdrop-blur-sm"
        >
          {periods.map((item) => {
            const active = item.id === periodId;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setPeriodId(item.id)}
                className={`rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors sm:px-5 ${
                  active
                    ? 'bg-indigo-600 text-white shadow-[0_10px_24px_-12px_rgba(79,70,229,0.85)]'
                    : 'text-slate-600 hover:text-indigo-500 dark:text-slate-300'
                }`}
              >
                {item.label}
                {item.discount > 0 ? (
                  <span
                    className={`ml-1.5 text-xs font-bold ${
                      active ? 'text-cyan-200' : 'text-emerald-600 dark:text-emerald-400'
                    }`}
                  >
                    −{Math.round(item.discount * 100)}%
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-9 grid grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-4">
        {tiers.map((tier) => (
          <PlanCard key={tier.name} tier={tier} period={period} />
        ))}
      </div>

      <p className="mt-8 text-center text-sm text-slate-500 dark:text-slate-400">
        Все тарифы — 3 дня бесплатно, без банковской карты. Цена указана за месяц; скидка −20% при оплате за
        6 месяцев и −35% за год.
      </p>
    </div>
  );
}

function PlanCard({ tier, period }: { tier: Tier; period: Period }) {
  const { name, audience, description, monthly, features, highlight } = tier;
  const perMonth = perMonthPrice(monthly, period.discount);
  const total = perMonth * period.months;
  const discounted = period.discount > 0;

  return (
    <div
      className={`relative flex flex-col overflow-hidden rounded-[1.9rem] border p-6 shadow-[var(--shadow-sm)] backdrop-blur-sm ${
        highlight ? 'border-indigo-500/40 text-white' : 'border-border/60 bg-card/80 text-foreground'
      }`}
      style={
        highlight
          ? {
              backgroundImage:
                'linear-gradient(160deg, rgb(30 27 75 / 0.98), rgb(15 23 42 / 0.97) 52%, rgb(8 51 68 / 0.96))',
            }
          : undefined
      }
    >
      {highlight ? (
        <>
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-indigo-400 via-violet-400 to-cyan-400" />
          <span className="absolute right-5 top-5 rounded-full bg-cyan-400/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-cyan-200">
            Популярный
          </span>
        </>
      ) : null}

      <p
        className={`text-xs font-semibold uppercase tracking-[0.16em] ${
          highlight ? 'text-cyan-200' : 'text-indigo-600 dark:text-indigo-300'
        }`}
      >
        {audience}
      </p>
      <h3 className="mt-3 text-2xl font-black tracking-[-0.03em]">{name}</h3>
      <p className={`mt-3 text-sm leading-6 ${highlight ? 'text-white/70' : 'text-slate-600 dark:text-slate-300'}`}>
        {description}
      </p>

      <div className="mt-5">
        <div className="flex items-end gap-1.5">
          <span className="whitespace-nowrap text-[2.1rem] font-black leading-none tracking-[-0.03em]">
            {formatRub(perMonth)} ₽
          </span>
          <span className={`pb-1 text-sm font-medium ${highlight ? 'text-white/60' : 'text-slate-500 dark:text-slate-400'}`}>
            / мес
          </span>
        </div>
        <div className="mt-2 flex min-h-[1.25rem] items-center gap-2 text-xs">
          {discounted ? (
            <>
              <span className={highlight ? 'text-white/45 line-through' : 'text-slate-400 line-through'}>
                {formatRub(monthly)} ₽
              </span>
              <span
                className={`rounded-md px-1.5 py-0.5 font-bold ${
                  highlight ? 'bg-cyan-400/20 text-cyan-200' : 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400'
                }`}
              >
                −{Math.round(period.discount * 100)}%
              </span>
            </>
          ) : (
            <span className={highlight ? 'text-white/55' : 'text-slate-500 dark:text-slate-400'}>
              при ежемесячной оплате
            </span>
          )}
        </div>
        {discounted ? (
          <p className={`mt-1 text-xs ${highlight ? 'text-white/55' : 'text-slate-500 dark:text-slate-400'}`}>
            {formatRub(total)} ₽ за {period.months} мес
          </p>
        ) : (
          <p className="mt-1 text-xs text-transparent select-none" aria-hidden>
            .
          </p>
        )}
      </div>

      <ul
        className={`mt-5 flex-1 space-y-3 border-t border-dashed pt-5 ${
          highlight ? 'border-white/15' : 'border-border/70'
        }`}
      >
        {features.map((feature) => (
          <li key={feature} className="flex items-start gap-2.5 text-sm">
            <span
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                highlight ? 'bg-cyan-400/20 text-cyan-200' : 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-300'
              }`}
            >
              <Check className="h-3 w-3" strokeWidth={3} />
            </span>
            <span className={highlight ? 'text-white/85' : 'text-slate-700 dark:text-slate-200'}>{feature}</span>
          </li>
        ))}
      </ul>

      <div className="mt-7">
        {highlight ? (
          <Link
            href={SIGNUP_HREF}
            className="group inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white px-5 text-sm font-semibold text-slate-950 transition-all duration-300 hover:-translate-y-0.5 hover:bg-cyan-100"
          >
            Попробовать 3 дня бесплатно
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        ) : (
          <Link
            href={SIGNUP_HREF}
            className="group inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-border/80 bg-card/70 px-5 text-sm font-semibold text-slate-700 transition-all duration-300 hover:-translate-y-0.5 hover:border-indigo-500/35 hover:text-indigo-500 dark:text-slate-200"
          >
            Попробовать 3 дня бесплатно
            <ArrowRight className="h-4 w-4" />
          </Link>
        )}
      </div>
    </div>
  );
}
