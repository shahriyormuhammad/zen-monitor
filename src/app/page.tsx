import type { Metadata } from 'next';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import {
  ArrowRight,
  BadgePercent,
  BellRing,
  Boxes,
  Check,
  ChevronRight,
  CircleDollarSign,
  Clock,
  Crown,
  Gauge,
  Layers3,
  Link2,
  MessageSquareQuote,
  PackageSearch,
  Play,
  Plug,
  Radar,
  ReceiptText,
  ScanSearch,
  Send,
  ShieldCheck,
  Sparkles,
  Star,
  Target,
  TrendingUp,
  TriangleAlert,
  Users,
  Wallet,
} from 'lucide-react';

import { PricingPlans } from '@/components/PricingPlans';
import { ThemeToggle } from '@/components/ThemeToggle';
import { ZenMonitorLogo } from '@/components/brand/ZenMonitorLogo';

export const metadata: Metadata = {
  title: 'Zen Monitor — операционная аналитика для продавцов Wildberries',
  description:
    'Прибыль, реклама с автопилотом, сигналы риска, отзывы, остатки и работа команды для селлеров Wildberries — в одном рабочем контуре. Не отчёты, а очередь решений.',
};

const SIGNUP_HREF = '/signup';
const LOGIN_HREF = '/login';
const TELEGRAM_CHANNEL_HREF = 'https://t.me/pro_cifry_wb';
const TELEGRAM_GROUP_HREF = 'https://t.me/pro_cifry_wb_chat';
const TELEGRAM_BOT_HREF = 'https://t.me/pro_cifry_wb_bot';
const TELEGRAM_DEV_HREF = 'https://t.me/vitea_b';

const telegramLinks = [
  { label: 'Канал', href: TELEGRAM_CHANNEL_HREF },
  { label: 'Группа', href: TELEGRAM_GROUP_HREF },
  { label: 'Бот', href: TELEGRAM_BOT_HREF },
  { label: 'Разработчик', href: TELEGRAM_DEV_HREF },
] as const;

/* ============================================================== data ====== */

const navLinks = [
  { label: 'Возможности', href: '#capabilities' },
  { label: 'Внутри продукта', href: '#features' },
  { label: 'Отзывы', href: '#testimonials' },
  { label: 'Тарифы', href: '#pricing' },
  { label: 'Вопросы', href: '#faq' },
] as const;

const heroAssurances = ['3 дня бесплатно', 'Без банковской карты', 'Подключение по API-токену WB'] as const;

const stats = [
  { value: '15', label: 'рабочих разделов в едином контуре' },
  { value: '7', label: 'типов сигналов риска по товарам' },
  { value: '3', label: 'режима управления рекламой' },
  { value: '1', label: 'вход для всех кабинетов и команды' },
] as const;

const problems = [
  {
    icon: CircleDollarSign,
    title: 'Выручка растёт — денег нет',
    text: 'Обороты идут вверх, а на расчётном счёте пусто. Где именно осела прибыль — непонятно.',
  },
  {
    icon: TrendingUp,
    title: 'Реклама жжёт бюджет вслепую',
    text: 'Кампании крутятся, но какие из них давно ушли в минус — видно только в конце месяца.',
  },
  {
    icon: Layers3,
    title: 'Десять выгрузок из Wildberries',
    text: 'Продажи, реклама, остатки, комиссии — в разных файлах, которые каждый раз склеиваешь руками.',
  },
  {
    icon: MessageSquareQuote,
    title: 'Отзывы остаются без ответа',
    text: 'Вопросы и отзывы копятся, рейтинг карточки проседает, а следом падает и конверсия.',
  },
  {
    icon: PackageSearch,
    title: 'Остатки не там, где нужно',
    text: 'То дефицит на ходовом складе, то деньги заморожены в неликвиде на дальнем.',
  },
  {
    icon: Users,
    title: 'Команда живёт в переписке',
    text: 'Задачи теряются в чатах: никто не помнит, что уже проверено и кто за это отвечал.',
  },
] as const;

type Tone = 'indigo' | 'violet' | 'cyan' | 'sky' | 'emerald' | 'amber' | 'rose' | 'fuchsia';

const toneTile: Record<Tone, string> = {
  indigo: 'bg-indigo-500/10 text-indigo-600 dark:bg-indigo-400/15 dark:text-indigo-300',
  violet: 'bg-violet-500/10 text-violet-600 dark:bg-violet-400/15 dark:text-violet-300',
  cyan: 'bg-cyan-500/10 text-cyan-600 dark:bg-cyan-400/15 dark:text-cyan-300',
  sky: 'bg-sky-500/10 text-sky-600 dark:bg-sky-400/15 dark:text-sky-300',
  emerald: 'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-300',
  amber: 'bg-amber-500/10 text-amber-600 dark:bg-amber-400/15 dark:text-amber-300',
  rose: 'bg-rose-500/10 text-rose-600 dark:bg-rose-400/15 dark:text-rose-300',
  fuchsia: 'bg-fuchsia-500/10 text-fuchsia-600 dark:bg-fuchsia-400/15 dark:text-fuchsia-300',
};

type Capability = {
  id: string;
  icon: LucideIcon;
  tone: Tone;
  span: string;
  title: string;
  text: string;
  chips: readonly string[];
  featured?: boolean;
};

const capabilities: readonly Capability[] = [
  {
    id: 'cap-signals',
    icon: Radar,
    tone: 'indigo',
    span: 'sm:col-span-2 lg:col-span-4',
    featured: true,
    title: 'Сигналы и очереди',
    text: 'Платформа сама находит проблемы и складывает их в очереди владельца — со сроком, ответственным и историей действий. Вы не ищете, что сломалось, а разбираете готовый список.',
    chips: ['Маржа', 'Реклама', 'Остатки', 'Логистика', 'Контент', 'SEO', 'Конверсия'],
  },
  {
    id: 'cap-economics',
    icon: ReceiptText,
    tone: 'emerald',
    span: 'lg:col-span-2',
    title: 'Юнит-экономика',
    text: 'Чистая прибыль и маржа по каждому SKU с учётом себестоимости, тарифов Wildberries и ручных расходов.',
    chips: ['Себестоимость', 'Тарифы WB', 'Маржа %'],
  },
  {
    id: 'cap-ads',
    icon: TrendingUp,
    tone: 'sky',
    span: 'lg:col-span-2',
    title: 'Реклама с автопилотом',
    text: 'Управление кампаниями в трёх режимах — от подсказок до полного автопилота с ограничителями.',
    chips: ['Советник', 'Полуавтомат', 'Автопилот'],
  },
  {
    id: 'cap-reviews',
    icon: MessageSquareQuote,
    tone: 'violet',
    span: 'lg:col-span-2',
    title: 'Отзывы и вопросы',
    text: 'Единая очередь, черновики ответов от ИИ с выбором тона и публикация прямо в кабинет Wildberries.',
    chips: ['ИИ-черновики', 'Тон ответа', 'Автоответы'],
  },
  {
    id: 'cap-finance',
    icon: Wallet,
    tone: 'cyan',
    span: 'lg:col-span-2',
    title: 'Финансы',
    text: 'Счета и кассы, операции, кредиты и долги, бюджеты план-факт — личная бухгалтерия продавца.',
    chips: ['Счета и кассы', 'Долги', 'План-факт'],
  },
  {
    id: 'cap-redistribution',
    icon: Boxes,
    tone: 'amber',
    span: 'lg:col-span-2',
    title: 'Перераспределение',
    text: 'Ребаланс товара между складами Wildberries: где дефицит, где неликвид и сколько сэкономит логистика.',
    chips: ['Склады', 'Логистика', 'Экспорт'],
  },
  {
    id: 'cap-seo',
    icon: ScanSearch,
    tone: 'fuchsia',
    span: 'lg:col-span-2',
    title: 'SEO-аудит карточек',
    text: 'Аудит карточек по приоритетам P0–P3 и ИИ-улучшение заголовков и описаний с применением в Wildberries.',
    chips: ['P0–P3', 'ИИ-тексты', 'Применить'],
  },
  {
    id: 'cap-stocks',
    icon: PackageSearch,
    tone: 'rose',
    span: 'lg:col-span-2',
    title: 'Остатки и закупки',
    text: 'Статусы остатков, запас в днях и готовый лист закупок — без дефицита и перезатарки.',
    chips: ['Запас в днях', 'Статусы', 'Лист закупок'],
  },
  {
    id: 'cap-overview',
    icon: Gauge,
    tone: 'indigo',
    span: 'lg:col-span-3',
    title: 'Обзор и план продаж',
    text: 'KPI кабинета, топ и аутсайдеры ассортимента, выручка по складам и план-факт продаж на одном экране.',
    chips: ['KPI и PnL', 'Топ товаров', 'План-факт'],
  },
  {
    id: 'cap-team',
    icon: Users,
    tone: 'violet',
    span: 'lg:col-span-3',
    title: 'Команда и роли',
    text: 'Роли владельца, администратора и наблюдателя, общие представления, передача задач и уведомления в Telegram.',
    chips: ['Роли доступа', 'Общие представления', 'Telegram'],
  },
];

const howSteps = [
  {
    n: '01',
    icon: Plug,
    title: 'Создайте аккаунт',
    text: 'Регистрация занимает минуту. Банковская карта на старте не нужна.',
  },
  {
    n: '02',
    icon: Link2,
    title: 'Подключите кабинет Wildberries',
    text: 'Токен проходит предварительную проверку, и платформа начинает синхронизировать продажи, рекламу, остатки и отзывы.',
  },
  {
    n: '03',
    icon: Radar,
    title: 'Получите рабочий контур',
    text: 'Обзор, сигналы, экономика и реклама наполняются вашими данными. Видно, что съедает маржу уже сегодня.',
  },
  {
    n: '04',
    icon: Users,
    title: 'Подключите команду',
    text: 'Роли, приглашения, общие представления и уведомления в Telegram — каждый работает в своей очереди.',
  },
] as const;

const audience = [
  {
    icon: Crown,
    title: 'Владелец одного кабинета',
    text: 'Видит, какие товары дают прибыль, где проседает реклама и какие сигналы требуют внимания сегодня.',
  },
  {
    icon: Layers3,
    title: 'Продавец в фазе роста',
    text: 'Держит несколько кабинетов, ассортимент, юнит-экономику и распределение остатков без ручного хаоса.',
  },
  {
    icon: Users,
    title: 'Команда и операторы',
    text: 'Работают через очереди владельца, передачу задач и уведомления — а не через потерянные сообщения.',
  },
] as const;

const videoHighlights = ['Реальный интерфейс', 'Сигналы и очереди', 'Реклама и автопилот', 'Юнит-экономика'] as const;

// TODO: плейсхолдер-отзывы — заменить на реальные перед публичным запуском
const testimonials = [
  {
    name: 'Анна Кравцова',
    role: 'Селлер, одежда · 1 кабинет',
    quote:
      'На первой неделе «Zen Monitor» показал две кампании, которые жгли бюджет в минус. Отключила — маржа выросла на 12%.',
  },
  {
    name: 'Дмитрий Соловьёв',
    role: 'Владелец бренда · 3 кабинета',
    quote:
      'Раньше считал прибыль в Excel по полдня. Теперь чистая прибыль по каждому товару собирается сразу, без ручной сводки.',
  },
  {
    name: 'Марина Лебедева',
    role: 'Менеджер маркетплейсов',
    quote:
      'Очереди владельца убрали хаос в команде: видно, кто что взял и что просрочено. Задачи перестали теряться в чатах.',
  },
  {
    name: 'Игорь Пантелеев',
    role: 'Селлер, электроника',
    quote:
      'Сигнал о риске дефицита пришёл за три дня до нуля на складе. Успел отгрузить и не потерял продажи на витрине.',
  },
  {
    name: 'Ольга Жукова',
    role: 'Начинающий селлер',
    quote:
      'Боялась, что аналитика — это сложно. Подключила кабинет за пару минут и сразу увидела, что съедает прибыль.',
  },
  {
    name: 'Сергей Минин',
    role: 'Руководитель отдела Wildberries',
    quote:
      'Автопилот рекламы держит ДРР в цели сам, а журнал действий виден целиком. Команда занимается товаром, а не ставками.',
  },
] as const;

const faqItems = [
  {
    question: 'Что нужно для запуска?',
    answer:
      'Создайте аккаунт, войдите и подключите кабинет Wildberries по токену. Дальше платформа сама синхронизирует продажи, рекламу, остатки и отзывы — и наполняет обзор, сигналы и экономику вашими данными.',
  },
  {
    question: 'Нужно ли что-то устанавливать?',
    answer:
      '«Zen Monitor» работает в браузере — устанавливать ничего не нужно. Уведомления о рабочих событиях дополнительно приходят в Telegram.',
  },
  {
    question: 'Подойдёт ли продукт для одного кабинета?',
    answer:
      'Да. Ценность не в количестве кабинетов, а в том, что прибыль, реклама, риски и действия собираются в один рабочий ритм. С одним кабинетом эффект виден сразу.',
  },
  {
    question: 'Насколько безопасно подключение кабинета?',
    answer:
      'Кабинет подключается через защищённый контур приложения. Токен проходит предварительную проверку, доступ к данным ограничен проверками кабинета и роли, а данные разных кабинетов изолированы друг от друга.',
  },
  {
    question: 'Реклама правда работает на автопилоте?',
    answer:
      'Да, но под контролем. Есть три режима: подсказки в режиме советника, безопасный полуавтомат и полный автопилот с ограничителями. Каждое действие фиксируется в журнале, а автопилот можно отключить в любой момент.',
  },
  {
    question: 'Это просто аналитика или есть рабочие сценарии?',
    answer:
      'Рабочие сценарии встроены: очереди с ответственными, история действий, передача задач, повторные проверки, черновики ответов и переходы из сигнала прямо в нужный экран.',
  },
  {
    question: 'Можно ли работать командой?',
    answer:
      'Да. Есть роли владельца, администратора и наблюдателя, приглашения, общие представления и линии владельца — продукт рассчитан и на одного человека, и на команду операторов.',
  },
] as const;

const footerColumns = [
  {
    title: 'Продукт',
    links: [
      { label: 'Возможности', href: '#capabilities' },
      { label: 'Внутри продукта', href: '#features' },
      { label: 'Отзывы', href: '#testimonials' },
      { label: 'Тарифы', href: '#pricing' },
    ],
  },
  {
    title: 'Контур',
    links: [
      { label: 'Сигналы и очереди', href: '#features' },
      { label: 'Реклама и автопилот', href: '#features' },
      { label: 'Юнит-экономика', href: '#features' },
      { label: 'Частые вопросы', href: '#faq' },
    ],
  },
  {
    title: 'Аккаунт',
    links: [
      { label: 'Создать аккаунт', href: SIGNUP_HREF },
      { label: 'Войти в кабинет', href: LOGIN_HREF },
    ],
  },
] as const;

/* ============================================================== page ====== */

export default function HomePage() {
  return (
    <main className="relative overflow-hidden bg-background text-foreground">
      <BackgroundDecor />
      <SiteHeader />
      <Hero />
      <StatStrip />
      <ProblemSection />
      <CapabilitiesSection />
      <FeaturesSection />
      <VideoSection />
      <HowSection />
      <AudienceSection />
      <TestimonialsSection />
      <PricingSection />
      <FaqSection />
      <FinalCta />
      <SiteFooter />
    </main>
  );
}

/* =========================================================== chrome ======== */

function BackgroundDecor() {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[1150px] overflow-hidden">
      <div className="marketing-aurora absolute -left-40 -top-44 h-[480px] w-[480px] rounded-full bg-indigo-500/20 blur-[130px] dark:bg-indigo-500/25" />
      <div className="marketing-aurora-slow absolute -right-32 -top-28 h-[440px] w-[440px] rounded-full bg-cyan-400/20 blur-[130px] dark:bg-cyan-400/20" />
      <div className="absolute left-1/2 top-[440px] h-[380px] w-[640px] -translate-x-1/2 rounded-full bg-violet-500/12 blur-[140px]" />
      <div className="absolute inset-x-0 top-0 h-[620px] bg-gradient-to-b from-indigo-500/[0.05] to-transparent dark:from-indigo-500/[0.09]" />
    </div>
  );
}

function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6 lg:px-8">
        <Link href="/" className="flex min-w-0 items-center gap-2.5">
          <BrandMark />
          <div className="min-w-0">
            <p className="whitespace-nowrap text-sm font-bold tracking-tight text-slate-950 dark:text-white">
              Про&nbsp;Цифры
            </p>
            <p className="hidden text-[11px] tracking-[0.16em] text-slate-500 dark:text-slate-400 sm:block">
              КОНТРОЛЬ ПРИБЫЛИ WB
            </p>
          </div>
        </Link>

        <nav className="hidden items-center gap-7 text-sm text-slate-600 dark:text-slate-300 lg:flex">
          {navLinks.map((link) => (
            <Link key={link.href} href={link.href} className="transition-colors hover:text-indigo-500">
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <div className="hidden sm:block">
            <ThemeToggle />
          </div>
          <Link
            href={LOGIN_HREF}
            className="hidden h-10 items-center rounded-xl border border-border/80 bg-card/70 px-4 text-sm font-semibold text-slate-700 transition-colors hover:border-indigo-500/35 hover:text-indigo-500 dark:text-slate-200 sm:inline-flex"
          >
            Войти
          </Link>
          <PrimaryButton href={SIGNUP_HREF} size="sm">
            Регистрация
          </PrimaryButton>
        </div>
      </div>
    </header>
  );
}

function BrandMark() {
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl">
      <ZenMonitorLogo size={40} />
    </span>
  );
}

/* ============================================================== hero ======= */

function Hero() {
  return (
    <section className="relative">
      <div className="mx-auto grid grid-cols-1 max-w-7xl gap-14 px-4 pb-12 pt-12 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-10 lg:px-8 lg:pb-20 lg:pt-20">
        <div className="max-w-2xl">
          <span className="inline-flex items-center gap-2 rounded-full border border-indigo-500/25 bg-indigo-500/10 px-3.5 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-indigo-600 dark:border-indigo-400/25 dark:bg-indigo-400/10 dark:text-indigo-300">
            <Sparkles className="h-3.5 w-3.5" />
            Операционная аналитика Wildberries
          </span>

          <h1 className="mt-6 text-[2.45rem] font-black leading-[1.05] tracking-[-0.035em] text-slate-950 dark:text-white sm:text-5xl lg:text-[3.4rem]">
            Прибыль Wildberries{' '}
            <span className="bg-gradient-to-r from-indigo-500 via-violet-500 to-cyan-400 bg-clip-text text-transparent">
              под контролем
            </span>
            , а не на ощущениях.
          </h1>

          <p className="mt-6 max-w-xl text-base leading-7 text-slate-600 dark:text-slate-300 sm:text-lg sm:leading-8">
            «Zen Monitor» сводит продажи, рекламу, юнит-экономику, остатки и отзывы в один рабочий контур. Не очередная
            панель с графиками — а очередь решений: что съедает маржу сегодня, кто за это отвечает и что уже сделано.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <PrimaryButton href={SIGNUP_HREF}>
              Попробовать 3 дня бесплатно
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </PrimaryButton>
            <SecondaryButton href="#how">
              Как это работает
              <ChevronRight className="h-4 w-4" />
            </SecondaryButton>
          </div>

          <ul className="mt-7 flex flex-wrap gap-x-5 gap-y-2.5">
            {heroAssurances.map((item) => (
              <li key={item} className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-300">
                  <Check className="h-3 w-3" strokeWidth={3} />
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative">
          <HeroConsole />
        </div>
      </div>
    </section>
  );
}

function HeroConsole() {
  return (
    <div className="relative mx-auto w-full max-w-xl lg:max-w-none">
      <div className="absolute -inset-6 -z-10 rounded-[2.6rem] bg-gradient-to-tr from-indigo-500/25 via-violet-500/12 to-cyan-400/25 blur-2xl" />

      <div className="marketing-float">
        <div className="marketing-panel-grid overflow-hidden rounded-[1.6rem] border border-white/10 shadow-[0_44px_100px_-34px_rgba(49,46,129,0.75)]">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-rose-400/80" />
              <span className="h-2.5 w-2.5 rounded-full bg-amber-400/80" />
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
              <span className="ml-2.5 text-xs font-medium text-white/65">Zen Monitor — Обзор кабинета</span>
            </div>
            <span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-200">
              <span className="relative flex h-1.5 w-1.5">
                <span className="marketing-pulse-ring absolute inset-0 rounded-full bg-emerald-400" />
                <span className="relative h-1.5 w-1.5 rounded-full bg-emerald-400" />
              </span>
              Live
            </span>
          </div>

          <div className="space-y-3 p-4">
            <div className="grid grid-cols-3 gap-2.5">
              <ConsoleKpi label="Чистая прибыль" value="1,24 млн ₽" delta="+18%" positive />
              <ConsoleKpi label="ДРР" value="9,4%" delta="−2,1 пп" positive />
              <ConsoleKpi label="Сигналы" value="7" delta="2 просроч." warn />
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3.5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-white/80">Очередь владельца</p>
                <span className="text-[10px] uppercase tracking-[0.14em] text-white/40">на сегодня</span>
              </div>
              <div className="mt-2.5 space-y-1.5">
                <ConsoleQueueRow tone="rose" title="Утечка ДРР по 4 SKU" tag="блокер" />
                <ConsoleQueueRow tone="amber" title="Риск дефицита — Коледино" tag="владелец" />
                <ConsoleQueueRow tone="sky" title="Падение конверсии −18%" tag="передать" />
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3.5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-white/80">Маржа по дням</p>
                <span className="text-[10px] font-semibold text-emerald-300">+12,4% к неделе</span>
              </div>
              <div className="mt-3 flex h-16 items-end gap-1.5">
                {[44, 60, 38, 67, 52, 74, 92].map((h, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-t bg-gradient-to-t from-indigo-500/35 to-cyan-400/85"
                    style={{ height: `${h}%` }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="marketing-float-delayed absolute -bottom-5 -right-4 hidden w-52 rounded-2xl border border-white/10 bg-slate-900/95 p-3.5 shadow-[0_24px_50px_-18px_rgba(15,23,42,0.85)] backdrop-blur sm:block">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-500/20 text-violet-300">
              <Sparkles className="h-3.5 w-3.5" />
            </span>
            <p className="text-xs font-semibold text-white">Черновик ИИ готов</p>
          </div>
          <p className="mt-2 text-[11px] leading-5 text-white/55">
            12 отзывов без ответа · ответ сгенерирован, ждёт проверки
          </p>
        </div>
      </div>
    </div>
  );
}

function ConsoleKpi({
  label,
  value,
  delta,
  positive = false,
  warn = false,
}: {
  label: string;
  value: string;
  delta: string;
  positive?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-2.5">
      <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-white/40">{label}</p>
      <p className="mt-1.5 text-base font-bold text-white">{value}</p>
      <p
        className={`mt-0.5 text-[10px] font-semibold ${
          warn ? 'text-amber-300' : positive ? 'text-emerald-300' : 'text-white/55'
        }`}
      >
        {delta}
      </p>
    </div>
  );
}

function ConsoleQueueRow({ tone, title, tag }: { tone: 'rose' | 'amber' | 'sky'; title: string; tag: string }) {
  const dot = { rose: 'bg-rose-400', amber: 'bg-amber-400', sky: 'bg-sky-400' }[tone];
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/20 px-2.5 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
        <p className="truncate text-xs font-medium text-white">{title}</p>
      </div>
      <span className="shrink-0 text-[9px] uppercase tracking-[0.12em] text-white/40">{tag}</span>
    </div>
  );
}

/* ============================================================== stats ====== */

function StatStrip() {
  return (
    <div className="mx-auto max-w-7xl px-4 pb-8 sm:px-6 lg:px-8 lg:pb-12">
      <dl className="grid grid-cols-2 overflow-hidden rounded-3xl border border-border/60 bg-card/80 shadow-[var(--shadow-sm)] backdrop-blur-sm lg:grid-cols-4">
        {stats.map((stat, index) => (
          <div
            key={stat.label}
            className={`flex flex-col gap-1.5 p-6 ${index % 2 === 1 ? 'border-l border-border/60' : ''} ${
              index >= 2 ? 'border-t border-border/60' : ''
            } lg:border-t-0 ${index !== 0 ? 'lg:border-l lg:border-border/60' : ''}`}
          >
            <dt className="text-3xl font-black tracking-[-0.03em] text-slate-950 dark:text-white sm:text-4xl">
              <span className="bg-gradient-to-r from-indigo-500 to-cyan-400 bg-clip-text text-transparent">
                {stat.value}
              </span>
            </dt>
            <dd className="text-sm leading-6 text-slate-600 dark:text-slate-400">{stat.label}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* ============================================================ problem ====== */

function ProblemSection() {
  return (
    <Section>
      <SectionHeading
        eyebrow="Знакомая картина"
        eyebrowIcon={TriangleAlert}
        title="Продажи есть. Контроля — нет."
        description="Стандартная аналитика показывает графики постфактум. Но продавцу нужно не «посмотреть цифры», а понять, что прямо сейчас уводит деньги — и что с этим делать."
      />
      <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {problems.map((problem) => (
          <div
            key={problem.title}
            className="rounded-3xl border border-border/60 bg-card/80 p-6 shadow-[var(--shadow-xs)] backdrop-blur-sm transition-colors hover:border-rose-500/30"
          >
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-600 dark:bg-rose-400/15 dark:text-rose-300">
              <problem.icon className="h-5 w-5" />
            </span>
            <h3 className="mt-4 text-base font-semibold text-slate-950 dark:text-white">{problem.title}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{problem.text}</p>
          </div>
        ))}
      </div>
      <div className="mt-8 flex items-start gap-3 rounded-3xl border border-indigo-500/25 bg-indigo-500/[0.07] p-5 sm:items-center sm:p-6">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-indigo-500/15 text-indigo-600 dark:text-indigo-300">
          <ArrowRight className="h-5 w-5" />
        </span>
        <p className="text-sm leading-6 text-slate-700 dark:text-slate-200 sm:text-base">
          «Zen Monitor» убирает ручную склейку выгрузок и превращает разрозненные данные в{' '}
          <span className="font-semibold text-slate-950 dark:text-white">приоритеты и конкретные действия</span>.
        </p>
      </div>
    </Section>
  );
}

/* ======================================================= capabilities ===== */

function CapabilitiesSection() {
  return (
    <Section id="capabilities">
      <SectionHeading
        eyebrow="Возможности"
        eyebrowIcon={Layers3}
        title="Один контур вместо десятка вкладок и таблиц"
        description="15 рабочих разделов связаны между собой: сигнал ведёт в экономику, экономика — в рекламу, реклама — в карточку. Это не набор виджетов, а единая операционная система кабинета."
      />
      <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
        {capabilities.map((cap) => (
          <CapabilityCard key={cap.id} capability={cap} />
        ))}
      </div>
    </Section>
  );
}

function CapabilityCard({ capability }: { capability: Capability }) {
  const { icon: Icon, tone, span, title, text, chips, featured } = capability;
  return (
    <article
      className={`group relative flex flex-col overflow-hidden rounded-3xl border p-6 shadow-[var(--shadow-xs)] backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-[var(--shadow-lg)] ${span} ${
        featured
          ? 'border-indigo-500/25 bg-gradient-to-br from-indigo-500/[0.08] via-card/85 to-cyan-400/[0.07] hover:border-indigo-500/40'
          : 'border-border/60 bg-card/80 hover:border-indigo-500/30'
      }`}
    >
      <div className="flex items-center justify-between">
        <span className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl ${toneTile[tone]}`}>
          <Icon className="h-6 w-6" />
        </span>
        {featured ? (
          <span className="rounded-full border border-indigo-500/25 bg-indigo-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-indigo-600 dark:text-indigo-300">
            Ядро продукта
          </span>
        ) : null}
      </div>

      <h3 className="mt-5 text-lg font-bold tracking-tight text-slate-950 dark:text-white">{title}</h3>
      <p className="mt-2 flex-1 text-sm leading-6 text-slate-600 dark:text-slate-300">{text}</p>

      <div className="mt-5 flex flex-wrap gap-1.5">
        {chips.map((chip) => (
          <span
            key={chip}
            className="rounded-lg border border-border/70 bg-background/55 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:text-slate-300"
          >
            {chip}
          </span>
        ))}
      </div>
    </article>
  );
}

/* ========================================================== features ====== */

function FeaturesSection() {
  return (
    <Section id="features">
      <SectionHeading
        eyebrow="Внутри продукта"
        eyebrowIcon={Target}
        title="Три слоя, на которых держится контроль"
        description="Сигналы говорят, куда смотреть. Экономика — сколько вы реально зарабатываете. Реклама — что с этим делать. Ниже — как эти слои выглядят в работе."
      />

      <div className="mt-14 space-y-16 lg:space-y-24">
        <Spotlight
          eyebrow="Сигналы и очереди"
          eyebrowIcon={Radar}
          title="Не дашборд, а очередь решений"
          text="Платформа сама находит отрицательную маржу, утечки рекламы, риск дефицита, всплески логистики, контентные и поисковые риски — и складывает их в очереди с владельцем, сроком и историей. Вы не ищете, что сломалось. Вы разбираете список."
          points={[
            '7 типов сигналов: маржа, реклама, остатки, логистика, контент, SEO, конверсия',
            'Очереди владельца: требует действия, заблокировано, ждёт решения, просрочено',
            'История, заметки и передача задачи прямо внутри сигнала',
          ]}
          visual={<SignalsBoard />}
        />
        <Spotlight
          reverse
          eyebrow="Реклама и автопилот"
          eyebrowIcon={TrendingUp}
          title="Рекламой нужно управлять, а не смотреть на график"
          text="Decision Center показывает, какие кампании усилить, какие срезать и какие остановить — с привязкой к прибыли, а не только к ДРР. Выберите режим: подсказки, безопасный полуавтомат или полный автопилот с ограничителями и журналом каждого действия."
          points={[
            'Три режима: Советник, Полуавтомат, Автопилот с ограничителями',
            'Decision Center с привязкой решений к прибыли, не только к ДРР',
            'Расписание показов по часам и аудит каждого действия автопилота',
          ]}
          visual={<AdsBoard />}
        />
        <Spotlight
          eyebrow="Юнит-экономика"
          eyebrowIcon={ReceiptText}
          title="Реальная прибыль, а не строчка «выручка»"
          text="Таблица юнит-экономики собирает себестоимость, доставку в фулфилмент, логистику Wildberries, упаковку, комиссию и рекламу — и показывает чистую прибыль и маржу по каждому SKU. Там, где данных Wildberries не хватает, расходы задаются вручную."
          points={[
            'Полная себестоимость: закупка, доставка, фулфилмент, упаковка',
            'Актуальные тарифы Wildberries и индекс локализации региона',
            'Ручные расходы там, где выгрузки Wildberries молчат',
          ]}
          visual={<EconomicsBoard />}
        />
      </div>
    </Section>
  );
}

function Spotlight({
  reverse = false,
  eyebrow,
  eyebrowIcon: Icon,
  title,
  text,
  points,
  visual,
}: {
  reverse?: boolean;
  eyebrow: string;
  eyebrowIcon: LucideIcon;
  title: string;
  text: string;
  points: readonly string[];
  visual: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-2 lg:gap-16">
      <div className={reverse ? 'lg:order-2' : ''}>
        <span className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-card/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-indigo-600 dark:text-indigo-300">
          <Icon className="h-3.5 w-3.5" />
          {eyebrow}
        </span>
        <h3 className="mt-4 text-2xl font-black tracking-[-0.03em] text-slate-950 dark:text-white sm:text-3xl">
          {title}
        </h3>
        <p className="mt-4 text-base leading-7 text-slate-600 dark:text-slate-300">{text}</p>
        <ul className="mt-6 space-y-3">
          {points.map((point) => (
            <li key={point} className="flex items-start gap-3">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-500/15 text-indigo-600 dark:text-indigo-300">
                <Check className="h-3 w-3" strokeWidth={3} />
              </span>
              <span className="text-sm leading-6 text-slate-700 dark:text-slate-200">{point}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className={reverse ? 'lg:order-1' : ''}>
        <div className="relative">
          <div className="absolute -inset-5 -z-10 rounded-[2.2rem] bg-gradient-to-tr from-indigo-500/18 via-violet-500/10 to-cyan-400/18 blur-2xl" />
          {visual}
        </div>
      </div>
    </div>
  );
}

function BoardShell({
  icon: Icon,
  title,
  badge,
  children,
}: {
  icon: LucideIcon;
  title: string;
  badge: string;
  children: React.ReactNode;
}) {
  return (
    <div className="marketing-panel-grid overflow-hidden rounded-[1.6rem] border border-white/10 shadow-[0_38px_88px_-34px_rgba(49,46,129,0.7)]">
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-3.5">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-indigo-300" />
          <span className="text-sm font-semibold text-white">{title}</span>
        </div>
        <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-indigo-200">
          {badge}
        </span>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function SignalsBoard() {
  const types = ['Маржа', 'Реклама', 'Остатки', 'Логистика', 'Контент', 'SEO', 'Конверсия'];
  const rows = [
    {
      icon: TrendingUp,
      tone: 'rose' as const,
      title: 'Утечка ДРР по 4 SKU',
      meta: 'Кабинет «Малышки» · реклама',
      sla: 'просрочено 2 ч',
    },
    {
      icon: PackageSearch,
      tone: 'amber' as const,
      title: 'Риск дефицита — склад Коледино',
      meta: 'Худи оверсайз · запас 3 дня',
      sla: 'на сегодня',
    },
    {
      icon: TriangleAlert,
      tone: 'sky' as const,
      title: 'Падение конверсии −18%',
      meta: 'Платье миди · поисковый риск',
      sla: 'ждёт решения',
    },
  ];
  const iconTone = {
    rose: 'bg-rose-500/15 text-rose-300',
    amber: 'bg-amber-500/15 text-amber-300',
    sky: 'bg-sky-500/15 text-sky-300',
  };
  const slaTone = {
    rose: 'bg-rose-500/15 text-rose-200',
    amber: 'bg-amber-500/15 text-amber-200',
    sky: 'bg-sky-500/15 text-sky-200',
  };

  return (
    <BoardShell icon={Radar} title="Очередь владельца" badge="7 активных">
      <div className="flex flex-wrap gap-1.5">
        {types.map((type, index) => (
          <span
            key={type}
            className={`rounded-lg border px-2 py-1 text-[11px] font-medium ${
              index === 0
                ? 'border-indigo-400/40 bg-indigo-400/15 text-indigo-100'
                : 'border-white/10 bg-white/5 text-white/55'
            }`}
          >
            {type}
          </span>
        ))}
      </div>
      <div className="mt-3.5 space-y-2.5">
        {rows.map((row) => (
          <div
            key={row.title}
            className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-3"
          >
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${iconTone[row.tone]}`}>
              <row.icon className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">{row.title}</p>
              <p className="truncate text-xs text-white/45">{row.meta}</p>
            </div>
            <span
              className={`flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold ${slaTone[row.tone]}`}
            >
              <Clock className="h-3 w-3" />
              {row.sla}
            </span>
          </div>
        ))}
      </div>
    </BoardShell>
  );
}

function AdsBoard() {
  const modes = ['Советник', 'Полуавтомат', 'Автопилот'];
  const campaigns = [
    { name: 'Автокампания · Худи оверсайз', drr: 'ДРР 8,2%', rec: 'Поднять ставку +12%', tone: 'emerald' as const },
    { name: 'Поиск · Платья миди', drr: 'ДРР 21,4%', rec: 'Срезать бюджет −30%', tone: 'amber' as const },
    { name: 'Каталог · Аксессуары', drr: 'ДРР 34,0%', rec: 'Поставить на паузу', tone: 'rose' as const },
  ];
  const recTone = {
    emerald: 'bg-emerald-500/15 text-emerald-200',
    amber: 'bg-amber-500/15 text-amber-200',
    rose: 'bg-rose-500/15 text-rose-200',
  };

  return (
    <BoardShell icon={Target} title="Decision Center" badge="9 рекомендаций">
      <div className="flex rounded-xl border border-white/10 bg-white/5 p-1">
        {modes.map((mode, index) => (
          <span
            key={mode}
            className={`flex-1 rounded-lg px-2 py-1.5 text-center text-[11px] font-semibold transition-colors ${
              index === 1 ? 'bg-indigo-500 text-white shadow-[0_8px_18px_-8px_rgba(79,70,229,0.95)]' : 'text-white/55'
            }`}
          >
            {mode}
          </span>
        ))}
      </div>
      <div className="mt-3.5 space-y-2.5">
        {campaigns.map((campaign) => (
          <div
            key={campaign.name}
            className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-3"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">{campaign.name}</p>
              <p className="text-xs text-white/45">{campaign.drr}</p>
            </div>
            <span className={`shrink-0 rounded-md px-2 py-1 text-[10px] font-semibold ${recTone[campaign.tone]}`}>
              {campaign.rec}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-3.5 flex items-center gap-1.5 text-[11px] text-white/45">
        <ShieldCheck className="h-3.5 w-3.5 text-emerald-300" />
        Каждое действие фиксируется в журнале — автопилот можно отключить в любой момент
      </p>
    </BoardShell>
  );
}

function EconomicsBoard() {
  const rows = [
    { label: 'Цена продажи', value: '2 490 ₽', base: true },
    { label: 'Закупка', value: '−640 ₽' },
    { label: 'Логистика WB', value: '−92 ₽' },
    { label: 'Комиссия 18%', value: '−448 ₽' },
    { label: 'Реклама', value: '−210 ₽' },
    { label: 'Упаковка и ФФ', value: '−45 ₽' },
  ];
  const composition = [
    { tone: 'bg-rose-400/80', width: '25.7%' },
    { tone: 'bg-amber-400/80', width: '3.7%' },
    { tone: 'bg-sky-400/80', width: '18.0%' },
    { tone: 'bg-violet-400/80', width: '8.4%' },
    { tone: 'bg-white/25', width: '1.8%' },
    { tone: 'bg-emerald-400/85', width: '42.4%' },
  ];

  return (
    <BoardShell icon={ReceiptText} title="Юнит-экономика" badge="SKU · Худи оверсайз">
      <div className="space-y-1">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between rounded-lg px-2.5 py-1.5 odd:bg-white/[0.03]">
            <span className={`text-xs ${row.base ? 'font-semibold text-white' : 'text-white/55'}`}>{row.label}</span>
            <span className={`text-xs font-semibold tabular-nums ${row.base ? 'text-white' : 'text-white/70'}`}>
              {row.value}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-3.5 flex items-center justify-between rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-3.5 py-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-200/80">Чистая прибыль</p>
          <p className="mt-0.5 text-xl font-black text-white">1 055 ₽</p>
        </div>
        <span className="rounded-lg bg-emerald-400/20 px-2.5 py-1.5 text-sm font-bold text-emerald-200">
          Маржа 42,4%
        </span>
      </div>

      <div className="mt-3 flex h-2 overflow-hidden rounded-full">
        {composition.map((segment, index) => (
          <div key={index} className={segment.tone} style={{ width: segment.width }} />
        ))}
      </div>
      <p className="mt-2 text-[11px] text-white/45">Структура цены: расходы и доля чистой прибыли</p>
    </BoardShell>
  );
}

/* ============================================================== video ===== */

function VideoSection() {
  return (
    <Section id="video">
      <SectionHeading
        center
        eyebrow="Видеообзор"
        eyebrowIcon={Play}
        title="«Zen Monitor» в работе — за пять минут"
        description="Короткий обзор: как устроен контур, где сигналы, реклама и юнит-экономика и как платформа помогает принимать решения каждый день."
      />
      {/* TODO: заменить плейсхолдер на встроенное видео (iframe RuTube / YouTube) */}
      <div className="mx-auto mt-10 max-w-4xl">
        <div className="marketing-panel-grid relative aspect-video overflow-hidden rounded-[1.75rem] border border-white/10 shadow-[0_40px_100px_-40px_rgba(49,46,129,0.7)]">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-indigo-500/12 via-transparent to-cyan-400/12" />
          <div className="relative flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
            <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-indigo-500 text-white shadow-[0_18px_44px_-12px_rgba(79,70,229,0.9)]">
              <span className="marketing-pulse-ring absolute inset-0 rounded-full bg-indigo-500" />
              <Play className="relative h-6 w-6 translate-x-0.5" fill="currentColor" />
            </span>
            <div>
              <p className="text-base font-semibold text-white">Видеообзор скоро появится</p>
              <p className="mt-1 text-sm text-white/55">
                Запись готовится — здесь будет встроенный плеер с обзором сервиса.
              </p>
            </div>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {videoHighlights.map((item) => (
            <span
              key={item}
              className="rounded-lg border border-border/70 bg-card/70 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300"
            >
              {item}
            </span>
          ))}
        </div>
      </div>
    </Section>
  );
}

/* =============================================================== how ======= */

function HowSection() {
  return (
    <Section id="how">
      <SectionHeading
        center
        eyebrow="С чего начать"
        eyebrowIcon={Plug}
        title="От регистрации до первых решений"
        description="Подключение кабинета не требует разработчиков и установки. Контур наполняется вашими данными автоматически."
      />
      <ol className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {howSteps.map((step) => (
          <li
            key={step.n}
            className="relative rounded-3xl border border-border/60 bg-card/80 p-6 shadow-[var(--shadow-xs)] backdrop-blur-sm"
          >
            <div className="flex items-center justify-between">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-500/10 text-indigo-600 dark:bg-indigo-400/15 dark:text-indigo-300">
                <step.icon className="h-5 w-5" />
              </span>
              <span className="text-2xl font-black text-border-strong">{step.n}</span>
            </div>
            <h3 className="mt-5 text-base font-semibold text-slate-950 dark:text-white">{step.title}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{step.text}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}

/* =========================================================== audience ===== */

function AudienceSection() {
  return (
    <Section>
      <div className="rounded-[2.25rem] border border-border/60 bg-card/70 p-6 shadow-[var(--shadow-sm)] backdrop-blur-sm sm:p-10">
        <SectionHeading
          eyebrow="Для кого это"
          eyebrowIcon={Users}
          title="Для тех, кто устал собирать прибыль по кускам"
        />
        <div className="mt-9 grid grid-cols-1 gap-4 lg:grid-cols-3">
          {audience.map((item) => (
            <div key={item.title} className="rounded-3xl border border-border/60 bg-background/55 p-6">
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-500/10 text-indigo-600 dark:bg-indigo-400/15 dark:text-indigo-300">
                <item.icon className="h-6 w-6" />
              </span>
              <h3 className="mt-5 text-lg font-bold tracking-tight text-slate-950 dark:text-white">{item.title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{item.text}</p>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

/* ========================================================= testimonials === */

function TestimonialsSection() {
  return (
    <Section id="testimonials">
      <SectionHeading
        center
        eyebrow="Отзывы"
        eyebrowIcon={Star}
        title="Что говорят продавцы"
        description="Живые впечатления селлеров и команд, которые уже перевели работу с кабинетом Wildberries в «Zen Monitor»."
      />
      <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {testimonials.map((item) => (
          <figure
            key={item.name}
            className="flex flex-col rounded-3xl border border-border/60 bg-card/80 p-6 shadow-[var(--shadow-xs)] backdrop-blur-sm"
          >
            <div className="flex gap-0.5">
              {[0, 1, 2, 3, 4].map((index) => (
                <Star key={index} className="h-4 w-4 fill-amber-400 text-amber-400" />
              ))}
            </div>
            <blockquote className="mt-4 flex-1 text-sm leading-7 text-slate-700 dark:text-slate-200">
              «{item.quote}»
            </blockquote>
            <figcaption className="mt-5 flex items-center gap-3 border-t border-border/60 pt-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-cyan-400 text-sm font-bold text-white">
                {item.name.slice(0, 1)}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-950 dark:text-white">{item.name}</p>
                <p className="truncate text-xs text-slate-500 dark:text-slate-400">{item.role}</p>
              </div>
            </figcaption>
          </figure>
        ))}
      </div>
    </Section>
  );
}

/* ============================================================ pricing ===== */

function PricingSection() {
  return (
    <Section id="pricing">
      <SectionHeading
        center
        eyebrow="Тарифы"
        eyebrowIcon={BadgePercent}
        title="Цена за охват — и скидка за срок"
        description="Тариф зависит от того, насколько сложен ваш контур: один кабинет, рост, команда или операционка. А чем длиннее срок подписки, тем ниже цена за месяц."
      />
      <PricingPlans />
    </Section>
  );
}

/* ================================================================ faq ===== */

function FaqSection() {
  return (
    <Section id="faq">
      <SectionHeading
        center
        eyebrow="Вопросы"
        eyebrowIcon={MessageSquareQuote}
        title="Коротко о том, что обычно спрашивают"
        description="На первом запуске важно не обещать лишнего, а честно отвечать про запуск, роли, безопасность и сценарии."
      />
      <div className="mx-auto mt-10 max-w-3xl rounded-[2rem] border border-border/60 bg-card/80 p-2.5 shadow-[var(--shadow-sm)] backdrop-blur-sm">
        {faqItems.map((item) => (
          <details
            key={item.question}
            name="faq"
            className="group rounded-[1.4rem] border border-transparent px-5 py-4 transition-colors open:border-border/70 open:bg-background/50"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-semibold text-slate-950 marker:hidden dark:text-white">
              {item.question}
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border/70 text-slate-400 transition-all duration-300 group-open:rotate-45 group-open:border-indigo-500/40 group-open:text-indigo-500">
                <span className="text-lg leading-none">+</span>
              </span>
            </summary>
            <p className="pr-10 pt-3.5 text-sm leading-7 text-slate-600 dark:text-slate-300">{item.answer}</p>
          </details>
        ))}
      </div>
    </Section>
  );
}

/* ============================================================ final cta ==== */

function FinalCta() {
  return (
    <section id="contact" className="mx-auto max-w-7xl px-4 pb-20 sm:px-6 lg:px-8">
      <div className="relative overflow-hidden rounded-[2.25rem] border border-indigo-500/25 px-6 py-10 text-white shadow-[0_36px_100px_-40px_rgba(49,46,129,0.65)] sm:px-10 lg:py-14">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(circle at 14% 18%, rgba(99,102,241,0.32), transparent 30%), radial-gradient(circle at 84% 24%, rgba(34,211,238,0.26), transparent 26%), linear-gradient(150deg, rgb(20 18 54 / 0.98), rgb(3 7 18 / 0.96))',
          }}
        />
        <div className="relative z-10 flex flex-col gap-9 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3.5 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200">
              <BellRing className="h-3.5 w-3.5" />
              3 дня бесплатно
            </span>
            <h2 className="mt-5 text-3xl font-black tracking-[-0.03em] sm:text-[2.6rem] sm:leading-[1.1]">
              Попробуйте «Zen Monitor» 3 дня бесплатно.
            </h2>
            <p className="mt-4 max-w-xl text-sm leading-7 text-white/70 sm:text-base">
              Зарегистрируйтесь, подключите кабинет Wildberries по API-токену и три дня пользуйтесь полным контуром
              на своих реальных данных. Банковская карта не нужна.
            </p>
            <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2">
              {['3 дня полного доступа', 'Без банковской карты', 'Подключение по API-токену WB'].map((item) => (
                <span key={item} className="flex items-center gap-1.5 text-xs text-white/65">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-300" />
                  {item}
                </span>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
            <Link
              href={SIGNUP_HREF}
              className="group inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-white px-6 text-sm font-semibold text-slate-950 transition-all duration-300 hover:-translate-y-0.5 hover:bg-cyan-100"
            >
              Попробовать 3 дня бесплатно
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link
              href={LOGIN_HREF}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-6 text-sm font-semibold text-white transition-colors hover:border-cyan-300/40 hover:text-cyan-100"
            >
              Войти в кабинет
              <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================================================= footer ===== */

function SiteFooter() {
  return (
    <footer className="border-t border-border/60 bg-card/40">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div className="max-w-sm">
            <div className="flex items-center gap-2.5">
              <BrandMark />
              <span className="text-sm font-bold tracking-tight text-slate-950 dark:text-white">Zen Monitor</span>
            </div>
            <p className="mt-4 text-sm leading-6 text-slate-600 dark:text-slate-400">
              Операционная аналитика для продавцов Wildberries: прибыль, реклама, сигналы риска, отзывы, остатки и
              работа команды в одном контуре.
            </p>
            <div className="mt-5 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <Send className="h-3.5 w-3.5" />
              Рабочие уведомления приходят в Telegram
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {telegramLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-border/80 bg-card/70 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:border-indigo-500/35 hover:text-indigo-500 dark:text-slate-200"
                >
                  <Send className="h-3.5 w-3.5" />
                  {link.label}
                </Link>
              ))}
            </div>
          </div>

          {footerColumns.map((column) => (
            <div key={column.title}>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                {column.title}
              </p>
              <ul className="mt-4 space-y-2.5">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-slate-600 transition-colors hover:text-indigo-500 dark:text-slate-300"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-border/60 pt-6 text-xs text-slate-500 dark:text-slate-400 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} Zen Monitor. Контроль прибыли Wildberries.</p>
          <p>Wildberries — товарный знак правообладателя. Продукт не аффилирован с маркетплейсом.</p>
        </div>
      </div>
    </footer>
  );
}

/* ============================================================== shared ===== */

function Section({ id, children, className }: { id?: string; children: React.ReactNode; className?: string }) {
  return (
    <section id={id} className={`mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24 ${className ?? ''}`}>
      {children}
    </section>
  );
}

function SectionHeading({
  eyebrow,
  eyebrowIcon: Icon,
  title,
  description,
  center = false,
}: {
  eyebrow: string;
  eyebrowIcon?: LucideIcon;
  title: string;
  description?: string;
  center?: boolean;
}) {
  return (
    <div className={`max-w-2xl ${center ? 'mx-auto text-center' : ''}`}>
      <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-500/20 bg-indigo-500/[0.08] px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-indigo-600 dark:border-indigo-400/20 dark:bg-indigo-400/10 dark:text-indigo-300">
        {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
        {eyebrow}
      </span>
      <h2 className="mt-4 text-3xl font-black tracking-[-0.035em] text-slate-950 dark:text-white sm:text-[2.5rem] sm:leading-[1.12]">
        {title}
      </h2>
      {description ? (
        <p className="mt-4 text-base leading-7 text-slate-600 dark:text-slate-300">{description}</p>
      ) : null}
    </div>
  );
}

function PrimaryButton({
  href,
  children,
  size = 'md',
}: {
  href: string;
  children: React.ReactNode;
  size?: 'sm' | 'md';
}) {
  return (
    <Link
      href={href}
      className={`group inline-flex items-center justify-center gap-2 rounded-2xl bg-indigo-600 font-semibold text-white shadow-[0_14px_34px_-12px_rgba(79,70,229,0.7)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-indigo-500 hover:shadow-[0_18px_42px_-12px_rgba(79,70,229,0.78)] ${
        size === 'sm' ? 'h-10 px-4 text-sm' : 'h-12 px-6 text-sm sm:text-[0.95rem]'
      }`}
    >
      {children}
    </Link>
  );
}

function SecondaryButton({
  href,
  children,
  full = false,
}: {
  href: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`group inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-border/80 bg-card/70 px-6 text-sm font-semibold text-slate-700 transition-all duration-300 hover:-translate-y-0.5 hover:border-indigo-500/35 hover:text-indigo-500 dark:text-slate-200 ${
        full ? 'w-full' : ''
      }`}
    >
      {children}
    </Link>
  );
}
