import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  CircleDollarSign,
  Clock,
  Layers3,
  Link2,
  MessageSquareQuote,
  PackageSearch,
  Plug,
  Radar,
  ReceiptText,
  ShieldCheck,
  Target,
  TrendingUp,
  Users,
} from 'lucide-react';

import { PricingPlans } from '@/components/PricingPlans';
import { ThemeToggle } from '@/components/ThemeToggle';
import { ZenMonitorLogo } from '@/components/brand/ZenMonitorLogo';

export const metadata: Metadata = {
  title: 'Zen Monitor — лендинг (вариант Б)',
  description: 'Светлый доверительный лендинг: боли → цены → возможности.',
  robots: { index: false, follow: false },
};

const SIGNUP = '/signup';
const LOGIN = '/login';

const pains = [
  { icon: CircleDollarSign, t: 'Выручка растёт — денег нет', d: 'Обороты вверх, а на счёте пусто. Где осела прибыль — непонятно.' },
  { icon: TrendingUp, t: 'Реклама жжёт бюджет вслепую', d: 'Какие кампании ушли в минус — видно только в конце месяца.' },
  { icon: Layers3, t: 'Десять выгрузок из Wildberries', d: 'Продажи, реклама, остатки, комиссии — склеиваешь руками каждый раз.' },
  { icon: MessageSquareQuote, t: 'Отзывы остаются без ответа', d: 'Вопросы копятся, рейтинг падает, следом проседает конверсия.' },
  { icon: PackageSearch, t: 'Остатки не там, где нужно', d: 'То дефицит на ходовом складе, то деньги заморожены в неликвиде.' },
  { icon: Users, t: 'Команда живёт в переписке', d: 'Задачи теряются в чатах: кто что проверил — никто не помнит.' },
] as const;

const stats = [
  { v: '15', l: 'разделов в одном контуре' },
  { v: '7', l: 'типов сигналов риска' },
  { v: '3', l: 'режима управления рекламой' },
  { v: '1', l: 'вход для всех кабинетов' },
] as const;

const steps = [
  { n: '1', icon: Plug, t: 'Создайте аккаунт', d: 'Минута на регистрацию. Карта на старте не нужна.' },
  { n: '2', icon: Link2, t: 'Подключите кабинет WB', d: 'Токен проходит проверку, платформа синхронизирует данные.' },
  { n: '3', icon: Radar, t: 'Получите контур', d: 'Обзор, сигналы и экономика наполняются вашими цифрами.' },
  { n: '4', icon: Users, t: 'Подключите команду', d: 'Роли, очереди и уведомления — каждый в своей зоне.' },
] as const;

const faq = [
  { q: 'Что нужно для запуска?', a: 'Создать аккаунт и подключить кабинет Wildberries по API-токену. Дальше платформа сама синхронизирует продажи, рекламу, остатки и отзывы.' },
  { q: 'Нужно ли что-то устанавливать?', a: 'Нет, Zen Monitor работает в браузере. Уведомления о важных событиях дополнительно приходят в Telegram.' },
  { q: 'Подойдёт ли для одного кабинета?', a: 'Да. Ценность не в количестве кабинетов, а в том, что прибыль, реклама и риски собираются в один ритм. С одним кабинетом эффект виден сразу.' },
  { q: 'Насколько безопасно подключение?', a: 'Кабинет подключается через защищённый контур, токен проходит проверку, данные разных кабинетов изолированы друг от друга.' },
  { q: 'Реклама правда на автопилоте?', a: 'Да, под контролем: три режима — советник, безопасный полуавтомат и полный автопилот с ограничителями. Каждое действие фиксируется в журнале.' },
] as const;

export default function LandingB() {
  return (
    <div className="bg-background text-foreground">
      <RevealStyles />
      <Header />
      <main>
        <Hero />
        <TrustStrip />
        <Pains />
        <Pricing />
        <Features />
        <How />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}

/* ----------------------------------------------------------------- header -- */

function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <ZenMonitorLogo size={40} />
          <span className="text-[15px] font-bold tracking-tight">Zen Monitor</span>
        </Link>
        <nav className="hidden items-center gap-7 text-[14px] text-slate-600 dark:text-slate-300 md:flex">
          <a href="#pains" className="transition-colors hover:text-indigo-600">Проблема</a>
          <a href="#pricing" className="transition-colors hover:text-indigo-600">Тарифы</a>
          <a href="#features" className="transition-colors hover:text-indigo-600">Возможности</a>
          <a href="#faq" className="transition-colors hover:text-indigo-600">Вопросы</a>
        </nav>
        <div className="flex items-center gap-2">
          <div className="hidden sm:block"><ThemeToggle /></div>
          <Link href={LOGIN} className="hidden h-10 items-center rounded-xl border border-border px-4 text-[14px] font-semibold text-slate-700 transition-colors hover:border-indigo-300 dark:text-slate-200 sm:inline-flex">
            Войти
          </Link>
          <Cta href={SIGNUP} size="sm">Регистрация</Cta>
        </div>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------- hero -- */

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[560px]">
        <div className="absolute left-1/2 top-[-120px] h-[420px] w-[820px] -translate-x-1/2 rounded-full bg-indigo-500/[0.08] blur-[120px]" />
      </div>
      <div className="mx-auto grid max-w-6xl items-center gap-14 px-4 pb-10 pt-16 sm:px-6 lg:grid-cols-[1.02fr_0.98fr] lg:pb-16 lg:pt-24">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-[12px] font-semibold text-indigo-700 dark:border-indigo-400/25 dark:bg-indigo-400/10 dark:text-indigo-300">
            <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" /> Операционная аналитика Wildberries
          </span>
          <h1 className="mt-6 text-[2.5rem] font-black leading-[1.05] tracking-[-0.035em] sm:text-[3.3rem]">
            Прибыль Wildberries под <span className="text-indigo-600 dark:text-indigo-400">контролем</span>, а не на ощущениях.
          </h1>
          <p className="mt-6 max-w-xl text-[17px] leading-8 text-slate-600 dark:text-slate-300">
            Продажи, реклама, юнит-экономика, остатки и отзывы — в одном спокойном рабочем контуре.
            Не графики постфактум, а очередь решений: что съедает маржу сегодня и что с этим делать.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Cta href={SIGNUP}>
              Попробовать 3 дня бесплатно
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Cta>
            <a href="#features" className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-5 py-3.5 text-[15px] font-semibold text-slate-700 transition-colors hover:border-indigo-300 dark:text-slate-200">
              Как это работает
            </a>
          </div>
          <ul className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-[14px] text-slate-500 dark:text-slate-400">
            {['3 дня бесплатно', 'Без банковской карты', 'Подключение по API-токену WB'].map((x) => (
              <li key={x} className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-500" /> {x}
              </li>
            ))}
          </ul>
        </div>
        <HeroFrame />
      </div>
    </section>
  );
}

function HeroFrame() {
  return (
    <div className="reveal relative">
      <div className="marketing-float rounded-[1.5rem] border border-border bg-card p-2.5 shadow-[0_44px_90px_-44px_rgba(30,41,59,0.45)]">
        <div className="overflow-hidden rounded-[1.2rem] border border-border/70 bg-subtle">
          <div className="flex items-center gap-1.5 border-b border-border/70 px-4 py-2.5">
            <span className="h-2.5 w-2.5 rounded-full bg-rose-400/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
            <span className="ml-2 text-[12px] font-medium text-slate-500">Обзор кабинета</span>
            <span className="ml-auto rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300">live</span>
          </div>
          <div className="space-y-3 p-4">
            <div className="grid grid-cols-3 gap-2.5">
              {[['Чистая прибыль', '1,24 млн', '+18%'], ['ДРР', '9,4%', '−2,1 пп'], ['Маржа', '42%', '+4 пп']].map(([l, v, d]) => (
                <div key={l} className="rounded-xl border border-border/70 bg-card p-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{l}</p>
                  <p className="mt-1 text-[16px] font-bold tabular-nums">{v}</p>
                  <p className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">{d}</p>
                </div>
              ))}
            </div>
            <div className="rounded-xl border border-border/70 bg-card p-3.5">
              <div className="flex items-center justify-between">
                <p className="text-[12px] font-semibold">Очередь владельца · на сегодня</p>
                <span className="text-[11px] text-slate-400">7 активных</span>
              </div>
              <div className="mt-2.5 space-y-1.5">
                {[['Утечка ДРР по 4 SKU', 'bg-rose-500', 'блокер'], ['Риск дефицита — Коледино', 'bg-amber-500', 'сегодня'], ['Падение конверсии −18%', 'bg-sky-500', 'передать']].map(([t, c, tag]) => (
                  <div key={t} className="flex items-center justify-between rounded-lg border border-border/60 bg-subtle px-2.5 py-2">
                    <span className="flex items-center gap-2 text-[12.5px] font-medium"><span className={`h-1.5 w-1.5 rounded-full ${c}`} />{t}</span>
                    <span className="text-[10px] uppercase tracking-wide text-slate-400">{tag}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-border/70 bg-card p-3.5">
              <div className="flex items-center justify-between">
                <p className="text-[12px] font-semibold">Маржа по дням</p>
                <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">+12,4% к неделе</span>
              </div>
              <div className="mt-3 flex h-16 items-end gap-1.5">
                {[40, 55, 38, 64, 50, 72, 90].map((h, i) => (
                  <div key={i} className="flex-1 rounded-t bg-indigo-500/85" style={{ height: `${h}%` }} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ trust strip -- */

function TrustStrip() {
  return (
    <div className="mx-auto max-w-6xl px-4 pb-6 sm:px-6 lg:pb-10">
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.l} className="bg-card p-5">
            <dt className="text-[28px] font-black tracking-tight text-indigo-600 dark:text-indigo-400 sm:text-[32px]">{s.v}</dt>
            <dd className="mt-1 text-[13px] leading-5 text-slate-500 dark:text-slate-400">{s.l}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* ------------------------------------------------------------------ pains -- */

function Pains() {
  return (
    <Section id="pains">
      <Heading
        kicker="Знакомая картина"
        title="Продажи есть. Контроля — нет."
        sub="Обычная аналитика показывает графики постфактум. Продавцу нужно не «посмотреть цифры», а понять, что прямо сейчас уводит деньги — и что делать."
      />
      <div className="mt-10 grid gap-x-10 gap-y-1 sm:grid-cols-2">
        {pains.map((p) => (
          <div key={p.t} className="reveal flex items-start gap-4 border-b border-border/60 py-5">
            <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600 dark:bg-rose-400/15 dark:text-rose-300">
              <p.icon className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[16px] font-semibold">{p.t}</p>
              <p className="mt-1 text-[14px] leading-6 text-slate-500 dark:text-slate-400">{p.d}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="reveal mt-8 flex items-center gap-3 rounded-2xl border border-indigo-200 bg-indigo-50/70 p-5 dark:border-indigo-400/25 dark:bg-indigo-400/[0.07]">
        <ArrowRight className="h-5 w-5 shrink-0 text-indigo-600 dark:text-indigo-300" />
        <p className="text-[15px] leading-6 text-slate-700 dark:text-slate-200">
          Zen Monitor убирает ручную склейку выгрузок и превращает данные в <span className="font-semibold text-foreground">приоритеты и конкретные действия</span>.
        </p>
      </div>
    </Section>
  );
}

/* ---------------------------------------------------------------- pricing -- */

function Pricing() {
  return (
    <Section id="pricing">
      <Heading
        center
        kicker="Тарифы"
        title="Понятная цена за охват — и скидка за срок"
        sub="Тариф зависит от того, насколько сложен ваш контур. Чем длиннее подписка, тем ниже цена за месяц. Старт — 3 дня бесплатно, без карты."
      />
      <div className="reveal mt-10"><PricingPlans /></div>
    </Section>
  );
}

/* --------------------------------------------------------------- features -- */

const spotlights = [
  {
    icon: Radar,
    kicker: 'Сигналы и очереди',
    title: 'Не дашборд, а очередь решений',
    text: 'Платформа сама находит отрицательную маржу, утечки рекламы, риск дефицита и поисковые риски — и складывает их в очереди с владельцем, сроком и историей. Вы не ищете, что сломалось. Вы разбираете список.',
    points: ['7 типов сигналов: маржа, реклама, остатки, логистика, контент, SEO, конверсия', 'Очереди: требует действия, заблокировано, ждёт решения, просрочено', 'История и передача задачи прямо внутри сигнала'],
  },
  {
    icon: TrendingUp,
    kicker: 'Реклама и автопилот',
    title: 'Рекламой нужно управлять, а не смотреть на график',
    text: 'Decision Center показывает, какие кампании усилить, какие срезать и какие остановить — с привязкой к прибыли, а не только к ДРР. Выберите режим: подсказки, безопасный полуавтомат или полный автопилот с ограничителями.',
    points: ['Три режима: советник, полуавтомат, автопилот с лимитами', 'Решения привязаны к прибыли, а не только к ДРР', 'Журнал каждого действия — автопилот можно выключить в любой момент'],
  },
  {
    icon: ReceiptText,
    kicker: 'Юнит-экономика',
    title: 'Реальная прибыль, а не строчка «выручка»',
    text: 'Себестоимость, доставка в фулфилмент, логистика WB, упаковка, комиссия и реклама собираются в чистую прибыль и маржу по каждому SKU. Где данных WB не хватает — расходы задаются вручную.',
    points: ['Полная себестоимость: закупка, доставка, фулфилмент, упаковка', 'Актуальные тарифы Wildberries и индекс локализации', 'Ручные расходы там, где выгрузки молчат'],
  },
] as const;

function Features() {
  return (
    <Section id="features">
      <Heading
        center
        kicker="Возможности"
        title="Три слоя, на которых держится контроль"
        sub="Сигналы говорят, куда смотреть. Экономика — сколько вы реально зарабатываете. Реклама — что с этим делать."
      />
      <div className="mt-14 space-y-16 lg:space-y-24">
        {spotlights.map((s, i) => (
          <div key={s.title} className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
            <div className={`reveal ${i % 2 === 1 ? 'lg:order-2' : ''}`}>
              <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-indigo-600 dark:text-indigo-400">
                <s.icon className="h-4 w-4" /> {s.kicker}
              </span>
              <h3 className="mt-3 text-[1.6rem] font-black tracking-[-0.03em] sm:text-[1.9rem]">{s.title}</h3>
              <p className="mt-4 text-[16px] leading-7 text-slate-600 dark:text-slate-300">{s.text}</p>
              <ul className="mt-6 space-y-3">
                {s.points.map((pt) => (
                  <li key={pt} className="flex items-start gap-3 text-[14.5px] leading-6 text-slate-700 dark:text-slate-200">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-600 dark:bg-indigo-400/20 dark:text-indigo-300">✓</span>
                    {pt}
                  </li>
                ))}
              </ul>
            </div>
            <div className={`reveal ${i % 2 === 1 ? 'lg:order-1' : ''}`}>
              <FeatureBoard kind={i} />
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function FeatureBoard({ kind }: { kind: number }) {
  const head =
    kind === 0
      ? { icon: Radar, t: 'Очередь владельца', b: '7 активных' }
      : kind === 1
        ? { icon: Target, t: 'Decision Center', b: '9 рекомендаций' }
        : { icon: ReceiptText, t: 'Юнит-экономика', b: 'SKU · Худи' };
  const HeadIcon = head.icon;
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-[0_24px_60px_-40px_rgba(30,41,59,0.4)]">
      <div className="flex items-center justify-between border-b border-border/60 pb-3">
        <span className="flex items-center gap-2 text-[14px] font-semibold"><HeadIcon className="h-4 w-4 text-indigo-600 dark:text-indigo-400" /> {head.t}</span>
        <span className="rounded-full border border-border bg-subtle px-2.5 py-1 text-[11px] font-medium text-slate-500">{head.b}</span>
      </div>
      <div className="mt-3 space-y-2">
        {kind === 0 && [['Утечка ДРР по 4 SKU', 'реклама', 'text-rose-600', 'bg-rose-50 dark:bg-rose-400/15'], ['Риск дефицита — Коледино', 'запас 3 дня', 'text-amber-600', 'bg-amber-50 dark:bg-amber-400/15'], ['Падение конверсии −18%', 'поиск', 'text-sky-600', 'bg-sky-50 dark:bg-sky-400/15']].map(([t, m, col, bg]) => (
          <div key={t} className="flex items-center gap-3 rounded-xl border border-border/60 bg-subtle px-3 py-2.5">
            <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${bg} ${col}`}><Clock className="h-4 w-4" /></span>
            <div className="min-w-0 flex-1"><p className="truncate text-[13.5px] font-medium">{t}</p><p className="text-[11px] text-slate-400">{m}</p></div>
          </div>
        ))}
        {kind === 1 && (
          <>
            <div className="flex rounded-xl border border-border/60 bg-subtle p-1">
              {['Советник', 'Полуавтомат', 'Автопилот'].map((m, j) => (
                <span key={m} className={`flex-1 rounded-lg px-2 py-1.5 text-center text-[11.5px] font-semibold ${j === 1 ? 'bg-indigo-600 text-white' : 'text-slate-500'}`}>{m}</span>
              ))}
            </div>
            {[['Худи оверсайз', 'ДРР 8,2%', '+12% ставка', 'text-emerald-600'], ['Платья миди', 'ДРР 21,4%', '−30% бюджет', 'text-amber-600'], ['Аксессуары', 'ДРР 34,0%', 'на паузу', 'text-rose-600']].map(([n, drr, rec, col]) => (
              <div key={n} className="flex items-center justify-between rounded-xl border border-border/60 bg-subtle px-3 py-2.5">
                <div><p className="text-[13.5px] font-medium">{n}</p><p className="text-[11px] text-slate-400">{drr}</p></div>
                <span className={`text-[12px] font-semibold ${col}`}>{rec}</span>
              </div>
            ))}
          </>
        )}
        {kind === 2 && (
          <>
            {[['Цена продажи', '2 490 ₽'], ['Закупка', '−640 ₽'], ['Логистика WB', '−92 ₽'], ['Комиссия 18%', '−448 ₽'], ['Реклама', '−210 ₽']].map(([l, v], j) => (
              <div key={l} className="flex items-center justify-between px-1 text-[13px]">
                <span className={j === 0 ? 'font-semibold' : 'text-slate-500'}>{l}</span>
                <span className="font-semibold tabular-nums">{v}</span>
              </div>
            ))}
            <div className="mt-2 flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 dark:border-emerald-400/25 dark:bg-emerald-400/10">
              <div><p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Чистая прибыль</p><p className="text-[19px] font-black">1 055 ₽</p></div>
              <span className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[13px] font-bold text-white">Маржа 42%</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- how -- */

function How() {
  return (
    <Section id="how">
      <Heading center kicker="С чего начать" title="От регистрации до первых решений" sub="Без разработчиков и установки. Контур наполняется вашими данными автоматически." />
      <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s) => (
          <li key={s.n} className="reveal rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center justify-between">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-400/15 dark:text-indigo-300"><s.icon className="h-5 w-5" /></span>
              <span className="text-[22px] font-black text-border-strong">{s.n}</span>
            </div>
            <h3 className="mt-4 text-[15px] font-semibold">{s.t}</h3>
            <p className="mt-1.5 text-[13.5px] leading-6 text-slate-500 dark:text-slate-400">{s.d}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}

/* -------------------------------------------------------------------- faq -- */

function Faq() {
  return (
    <Section id="faq">
      <Heading center kicker="Вопросы" title="Частые вопросы" />
      <div className="mx-auto mt-10 max-w-3xl divide-y divide-border border-y border-border">
        {faq.map((f) => (
          <details key={f.q} className="group px-1 py-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[16px] font-semibold">
              {f.q}
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border text-slate-400 transition-transform group-open:rotate-45">+</span>
            </summary>
            <p className="mt-3 max-w-2xl text-[14.5px] leading-7 text-slate-600 dark:text-slate-300">{f.a}</p>
          </details>
        ))}
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------- final cta -- */

function FinalCta() {
  return (
    <Section>
      <div className="reveal relative overflow-hidden rounded-[2rem] border border-indigo-300/40 bg-indigo-600 px-6 py-14 text-center text-white sm:px-10 dark:bg-indigo-600">
        <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
        <h2 className="relative mx-auto max-w-2xl text-[1.9rem] font-black leading-tight tracking-[-0.03em] text-balance sm:text-[2.6rem]">
          Возьмите прибыль Wildberries под контроль уже сегодня
        </h2>
        <p className="relative mx-auto mt-4 max-w-xl text-[16px] leading-7 text-indigo-100">
          3 дня бесплатно, без банковской карты. Подключение по API-токену за пару минут.
        </p>
        <div className="relative mt-8 flex justify-center">
          <Link href={SIGNUP} className="group inline-flex items-center gap-2 rounded-xl bg-white px-6 py-4 text-[16px] font-bold text-indigo-700 transition-transform hover:-translate-y-0.5">
            Начать бесплатно <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </div>
    </Section>
  );
}

/* ----------------------------------------------------------------- footer -- */

function Footer() {
  return (
    <footer className="border-t border-border bg-subtle">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 sm:flex-row sm:px-6">
        <div className="flex items-center gap-2.5">
          <ZenMonitorLogo size={32} />
          <span className="text-[14px] font-bold">Zen Monitor</span>
        </div>
        <p className="text-[13px] text-slate-500">Операционная аналитика для продавцов Wildberries</p>
        <div className="flex items-center gap-3 text-[13px]">
          <Link href={LOGIN} className="font-semibold text-slate-600 hover:text-indigo-600 dark:text-slate-300">Войти</Link>
          <Link href={SIGNUP} className="font-semibold text-indigo-600">Регистрация</Link>
        </div>
      </div>
    </footer>
  );
}

/* --------------------------------------------------------------- helpers --- */

function Section({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
      {children}
    </section>
  );
}

function Heading({ kicker, title, sub, center = false }: { kicker: string; title: string; sub?: string; center?: boolean }) {
  return (
    <div className={`reveal max-w-2xl ${center ? 'mx-auto text-center' : ''}`}>
      <p className="text-[13px] font-semibold text-indigo-600 dark:text-indigo-400">{kicker}</p>
      <h2 className="mt-2 text-[2rem] font-black leading-[1.1] tracking-[-0.035em] text-balance sm:text-[2.5rem]">{title}</h2>
      {sub ? <p className={`mt-4 text-[16px] leading-7 text-slate-600 dark:text-slate-300 ${center ? 'mx-auto' : ''}`}>{sub}</p> : null}
    </div>
  );
}

function Cta({ href, children, size = 'md' }: { href: string; children: React.ReactNode; size?: 'sm' | 'md' }) {
  const pad = size === 'sm' ? 'h-10 px-4 text-[14px]' : 'px-5 py-3.5 text-[15px]';
  return (
    <Link
      href={href}
      className={`group inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 font-bold text-white shadow-[0_14px_30px_-12px_rgba(79,70,229,0.7)] transition-transform hover:-translate-y-0.5 ${pad}`}
    >
      {children}
    </Link>
  );
}

function RevealStyles() {
  const css = `
    @supports (animation-timeline: view()) {
      @media (prefers-reduced-motion: no-preference) {
        .reveal{opacity:0;animation:reveal-up .9s linear both;animation-timeline:view();animation-range:entry 0% cover 30%}
        @keyframes reveal-up{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:none}}
      }
    }
  `;
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}
