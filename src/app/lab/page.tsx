import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  CircleDollarSign,
  Layers3,
  MessageSquareQuote,
  PackageSearch,
  TrendingUp,
  Users,
} from 'lucide-react';

export const metadata: Metadata = {
  title: 'Zen Monitor — лаборатория лендинга (варианты)',
  description: 'Сравнение направлений дизайна главной страницы.',
  robots: { index: false, follow: false },
};

const SIGNUP = '/signup';

/* Общие «боли» — одинаковый смысл во всех вариантах, чтобы сравнивать СТИЛЬ, а не текст. */
const PAINS = [
  { icon: CircleDollarSign, t: 'Выручка растёт — денег нет', d: 'Обороты вверх, а на счёте пусто. Где осела прибыль — непонятно.' },
  { icon: TrendingUp, t: 'Реклама жжёт бюджет вслепую', d: 'Какие кампании ушли в минус — видно только в конце месяца.' },
  { icon: Layers3, t: 'Десять выгрузок из WB', d: 'Продажи, реклама, остатки, комиссии — склеиваешь руками каждый раз.' },
  { icon: MessageSquareQuote, t: 'Отзывы без ответа', d: 'Вопросы копятся, рейтинг падает, следом проседает конверсия.' },
  { icon: PackageSearch, t: 'Остатки не там, где нужно', d: 'То дефицит на ходовом складе, то деньги заморожены в неликвиде.' },
  { icon: Users, t: 'Команда живёт в переписке', d: 'Задачи теряются в чатах: кто что проверил — никто не помнит.' },
] as const;

const VARIANTS = [
  { id: 'terminal', label: 'A · Терминал', hint: 'тёмный premium' },
  { id: 'trust', label: 'B · Светлый', hint: 'доверительный SaaS' },
  { id: 'bold', label: 'C · Смелый', hint: 'контраст / drenched' },
  { id: 'zen', label: 'D · Zen', hint: 'минимализм' },
] as const;

export default function LabPage() {
  return (
    <main className="bg-[oklch(0.15_0.02_265)]">
      <LabStyles />
      <VariantNav />
      <TerminalVariant />
      <TrustVariant />
      <BoldVariant />
      <ZenVariant />
      <footer className="border-t border-white/10 bg-[oklch(0.13_0.02_265)] px-6 py-10 text-center text-sm text-white/50">
        Витрина направлений. Скажи «вариант A/B/C/D» — добью полный лендинг (боли → цены → фишки) в выбранном стиле.
      </footer>
    </main>
  );
}

function VariantNav() {
  return (
    <nav className="sticky top-0 z-50 flex flex-wrap items-center gap-2 border-b border-white/10 bg-[oklch(0.15_0.02_265)]/85 px-4 py-2.5 backdrop-blur-xl sm:px-6">
      <span className="mr-1 font-mono text-[11px] uppercase tracking-[0.2em] text-white/40">Zen Lab</span>
      {VARIANTS.map((v) => (
        <a
          key={v.id}
          href={`#${v.id}`}
          className="group rounded-full border border-white/12 bg-white/[0.04] px-3 py-1.5 text-[12px] font-semibold text-white/80 transition-colors hover:border-cyan-300/40 hover:text-white"
        >
          {v.label}
          <span className="ml-1.5 hidden text-[10px] font-normal text-white/40 group-hover:text-cyan-200/70 sm:inline">
            {v.hint}
          </span>
        </a>
      ))}
    </nav>
  );
}

/* ========================================================== A — ТЕРМИНАЛ ==== */

function TerminalVariant() {
  const cursor = <span className="lab-cursor ml-0.5 inline-block h-[0.95em] w-[3px] translate-y-[2px] bg-cyan-300" aria-hidden />;
  return (
    <section id="terminal" className="lab-grid-bg relative overflow-hidden bg-[oklch(0.15_0.02_265)] px-4 py-20 text-white sm:px-6 lg:py-28">
      <div className="pointer-events-none absolute -left-32 -top-24 h-[420px] w-[420px] rounded-full bg-cyan-500/10 blur-[130px]" />
      <div className="pointer-events-none absolute -right-24 top-40 h-[380px] w-[380px] rounded-full bg-indigo-500/12 blur-[130px]" />
      <div className="relative mx-auto grid max-w-7xl items-center gap-14 lg:grid-cols-[1.04fr_0.96fr]">
        <div>
          <span className="inline-flex items-center gap-2 rounded-md border border-cyan-300/25 bg-cyan-300/[0.06] px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-cyan-200">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" /> wb · live control
          </span>
          <h1 className="mt-6 text-[2.5rem] font-extrabold leading-[1.04] tracking-[-0.035em] sm:text-[3.2rem]">
            Прибыль Wildberries<br />под <span className="text-cyan-300">контролем</span>{cursor}
          </h1>
          <p className="mt-6 max-w-lg font-mono text-[13px] leading-7 text-white/55">
            $ zen monitor --watch margins,ads,stock<br />
            <span className="text-emerald-300/90">→</span> один контур вместо десяти выгрузок. Не графики постфактум, а очередь решений.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href={SIGNUP} className="group inline-flex items-center gap-2 rounded-lg bg-cyan-300 px-5 py-3 text-[14px] font-bold text-[oklch(0.15_0.02_265)] transition-transform hover:-translate-y-0.5">
              Попробовать 3 дня <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <span className="font-mono text-[12px] text-white/40">без карты · подключение по API-токену</span>
          </div>
        </div>
        <TerminalConsole />
      </div>

      <div className="relative mx-auto mt-16 max-w-7xl">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-rose-300/80">// что прямо сейчас уводит деньги</p>
        <div className="mt-4 divide-y divide-white/8 overflow-hidden rounded-xl border border-white/10 bg-white/[0.025] font-mono">
          {PAINS.map((p, i) => (
            <div key={p.t} className="flex items-center gap-3 px-4 py-3 text-[13px]">
              <span className="text-white/30">{String(i + 1).padStart(2, '0')}</span>
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-rose-400" />
              <span className="font-semibold text-white">{p.t}</span>
              <span className="ml-auto hidden truncate text-[12px] font-normal text-white/45 md:block">{p.d}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function TerminalConsole() {
  return (
    <div className="relative">
      <div className="absolute -inset-4 -z-10 rounded-[2rem] bg-gradient-to-tr from-cyan-500/15 to-indigo-500/15 blur-2xl" />
      <div className="lab-sheen overflow-hidden rounded-2xl border border-white/12 bg-[oklch(0.12_0.02_265)] shadow-[0_40px_90px_-40px_rgba(8,145,178,0.55)]">
        <div className="flex items-center justify-between border-b border-white/8 px-4 py-2.5 font-mono text-[11px] text-white/45">
          <span>zen-monitor · обзор</span>
          <span className="flex items-center gap-1.5 text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300" /> live</span>
        </div>
        <div className="space-y-3 p-4">
          <div className="grid grid-cols-3 gap-2.5">
            {[
              { l: 'Чистая прибыль', v: '1,24 млн', d: '+18%', up: true },
              { l: 'ДРР', v: '9,4%', d: '−2,1пп', up: true },
              { l: 'Сигналы', v: '7', d: '2 просроч.', up: false },
            ].map((k) => (
              <div key={k.l} className="rounded-lg border border-white/8 bg-white/[0.03] p-2.5">
                <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-white/40">{k.l}</p>
                <p className="mt-1 text-[15px] font-bold tabular-nums">{k.v}</p>
                <p className={`font-mono text-[10px] ${k.up ? 'text-emerald-300' : 'text-amber-300'}`}>{k.d}</p>
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3.5">
            <div className="flex items-center justify-between">
              <p className="text-[12px] font-semibold text-white/80">Маржа · 14 дней</p>
              <p className="font-mono text-[11px] text-emerald-300">+12,4%</p>
            </div>
            <svg viewBox="0 0 300 70" className="mt-3 h-16 w-full" preserveAspectRatio="none">
              <defs>
                <linearGradient id="lab-spark" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgb(103 232 249)" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="rgb(103 232 249)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d="M0,55 L40,48 L75,52 L110,34 L150,40 L190,22 L230,28 L270,12 L300,8 L300,70 L0,70 Z" fill="url(#lab-spark)" />
              <path d="M0,55 L40,48 L75,52 L110,34 L150,40 L190,22 L230,28 L270,12 L300,8" fill="none" stroke="rgb(103 232 249)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
            <p className="mb-2 text-[12px] font-semibold text-white/80">Очередь владельца</p>
            {[
              { t: 'Утечка ДРР по 4 SKU', tag: 'блокер', c: 'bg-rose-400' },
              { t: 'Риск дефицита — Коледино', tag: 'сегодня', c: 'bg-amber-400' },
            ].map((r) => (
              <div key={r.t} className="mt-1.5 flex items-center justify-between rounded-md border border-white/8 bg-black/25 px-2.5 py-2">
                <span className="flex items-center gap-2 text-[12px] text-white"><span className={`h-1.5 w-1.5 rounded-full ${r.c}`} />{r.t}</span>
                <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-white/40">{r.tag}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ===================================================== B — СВЕТЛЫЙ ДОВЕРИЕ == */

function TrustVariant() {
  return (
    <section id="trust" className="relative overflow-hidden bg-[oklch(0.99_0.004_255)] px-4 py-20 text-[oklch(0.17_0.015_265)] sm:px-6 lg:py-28">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-indigo-400/40 to-transparent" />
      <div className="relative mx-auto grid max-w-7xl items-center gap-16 lg:grid-cols-[1fr_1fr]">
        <div className="lab-fadeup">
          <span className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-[12px] font-semibold text-indigo-700">
            Операционная аналитика Wildberries
          </span>
          <h1 className="mt-6 text-[2.5rem] font-black leading-[1.06] tracking-[-0.035em] sm:text-[3.3rem]">
            Прибыль под контролем, а не на ощущениях.
          </h1>
          <p className="mt-6 max-w-lg text-[17px] leading-8 text-slate-600">
            Продажи, реклама, юнит-экономика, остатки и отзывы — в одном спокойном рабочем контуре.
            Видно, что съедает маржу сегодня и что с этим делать.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href={SIGNUP} className="group inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3.5 text-[15px] font-bold text-white shadow-[0_14px_30px_-12px_rgba(79,70,229,0.7)] transition-transform hover:-translate-y-0.5">
              Попробовать 3 дня бесплатно <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link href="#bold" className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-5 py-3.5 text-[15px] font-semibold text-slate-700 transition-colors hover:border-indigo-300">
              Как это работает
            </Link>
          </div>
          <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-[14px] text-slate-500">
            <span>✓ 3 дня бесплатно</span><span>✓ Без банковской карты</span><span>✓ Подключение по токену WB</span>
          </div>
        </div>

        <div className="lab-fadeup" style={{ animationDelay: '120ms' }}>
          <div className="marketing-float relative rounded-[1.6rem] border border-slate-200 bg-white p-2.5 shadow-[0_44px_90px_-40px_rgba(30,41,59,0.4)]">
            <div className="rounded-[1.2rem] border border-slate-100 bg-[oklch(0.985_0.004_255)] p-4">
              <div className="flex items-center justify-between">
                <p className="text-[13px] font-bold">Обзор кабинета</p>
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">+18% прибыль</span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {[['Прибыль', '1,24 млн'], ['ДРР', '9,4%'], ['Маржа', '42%']].map(([l, v]) => (
                  <div key={l} className="rounded-xl border border-slate-100 bg-white p-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{l}</p>
                    <p className="mt-1 text-[15px] font-bold tabular-nums">{v}</p>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex h-20 items-end gap-1.5 rounded-xl border border-slate-100 bg-white p-3">
                {[40, 55, 38, 64, 50, 72, 90].map((h, i) => (
                  <div key={i} className="flex-1 rounded-t bg-indigo-500/85" style={{ height: `${h}%` }} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="relative mx-auto mt-16 max-w-7xl">
        <h2 className="text-[15px] font-bold text-slate-900">Знакомая картина</h2>
        <div className="mt-4 grid gap-x-10 gap-y-4 sm:grid-cols-2">
          {PAINS.map((p) => (
            <div key={p.t} className="flex items-start gap-3 border-b border-slate-100 pb-4">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-50 text-rose-600"><p.icon className="h-4 w-4" /></span>
              <div>
                <p className="text-[15px] font-semibold text-slate-900">{p.t}</p>
                <p className="mt-0.5 text-[13.5px] leading-6 text-slate-500">{p.d}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ======================================================== C — СМЕЛЫЙ ======== */

function BoldVariant() {
  const marquee = [...PAINS, ...PAINS];
  return (
    <section id="bold" className="relative overflow-hidden bg-[oklch(0.32_0.16_265)] px-4 py-20 text-white sm:px-6 lg:py-28">
      <div className="pointer-events-none absolute -right-20 -top-20 h-[460px] w-[460px] rounded-full bg-amber-300/20 blur-[120px]" />
      <div className="relative mx-auto max-w-7xl">
        <p className="font-mono text-[12px] font-semibold uppercase tracking-[0.25em] text-amber-200">Wildberries · контроль прибыли</p>
        <h1 className="mt-5 max-w-4xl text-[3rem] font-black leading-[0.98] tracking-[-0.04em] text-balance sm:text-[4.4rem]">
          Хватит собирать прибыль <span className="text-amber-300">по кускам.</span>
        </h1>
        <p className="mt-6 max-w-xl text-[18px] leading-8 text-white/75">
          Один экран вместо десяти выгрузок. Сигналы вместо графиков. Решения вместо отчётов.
        </p>
        <div className="mt-9 flex flex-wrap items-center gap-4">
          <Link href={SIGNUP} className="group inline-flex items-center gap-2 rounded-full bg-amber-300 px-7 py-4 text-[16px] font-black text-[oklch(0.25_0.12_265)] transition-transform hover:-translate-y-0.5">
            Забрать контроль <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
          </Link>
          <span className="text-[14px] font-semibold text-white/65">3 дня бесплатно · без карты</span>
        </div>
      </div>

      <div className="relative mt-16 overflow-hidden border-y border-white/15 py-4">
        <div className="lab-marquee flex w-max gap-8 whitespace-nowrap">
          {marquee.map((p, i) => (
            <span key={i} className="flex items-center gap-3 text-[20px] font-bold text-white/85 sm:text-[26px]">
              <span className="h-2 w-2 rounded-full bg-amber-300" /> {p.t}
            </span>
          ))}
        </div>
      </div>

      <div className="relative mx-auto mt-14 grid max-w-7xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PAINS.slice(0, 3).map((p, i) => (
          <div key={p.t} className={`rounded-3xl p-7 ${i === 1 ? 'bg-amber-300 text-[oklch(0.25_0.12_265)]' : 'bg-white/[0.07] text-white'}`}>
            <p.icon className="h-8 w-8" />
            <p className="mt-5 text-[22px] font-black leading-tight tracking-tight">{p.t}</p>
            <p className={`mt-2 text-[14px] leading-6 ${i === 1 ? 'text-[oklch(0.25_0.12_265)]/75' : 'text-white/65'}`}>{p.d}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ========================================================== D — ZEN ========= */

function ZenVariant() {
  return (
    <section id="zen" className="relative bg-[oklch(0.985_0.004_255)] px-4 py-28 text-[oklch(0.17_0.015_265)] sm:px-6 lg:py-40">
      <div className="mx-auto max-w-3xl text-center">
        <p className="text-[12px] font-medium uppercase tracking-[0.3em] text-teal-700/70">Zen Monitor</p>
        <h1 className="mx-auto mt-8 max-w-2xl text-[2.6rem] font-light leading-[1.1] tracking-[-0.02em] text-balance sm:text-[3.4rem]">
          Спокойный контроль над прибылью Wildberries.
        </h1>
        <p className="mx-auto mt-7 max-w-xl text-[17px] leading-8 text-slate-500">
          Никакого хаоса из вкладок и выгрузок. Только то, что важно сегодня — и одно ясное действие.
        </p>
        <div className="mt-12 flex flex-col items-center gap-5">
          <Link href={SIGNUP} className="group inline-flex items-center gap-2 rounded-full bg-[oklch(0.17_0.015_265)] px-8 py-4 text-[15px] font-semibold text-white transition-transform hover:-translate-y-0.5">
            Начать спокойно <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <span className="text-[13px] text-slate-400">3 дня бесплатно, без карты</span>
        </div>
      </div>

      <div className="mx-auto mt-20 flex max-w-md flex-col divide-y divide-slate-200/70 border-y border-slate-200/70">
        {PAINS.slice(0, 4).map((p) => (
          <div key={p.t} className="flex items-center gap-4 py-5">
            <p.icon className="h-5 w-5 shrink-0 text-teal-700/80" strokeWidth={1.5} />
            <p className="text-[15px] text-slate-600">{p.t}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ===================================================== scoped keyframes ===== */

function LabStyles() {
  const css = `
    .lab-grid-bg{background-image:linear-gradient(to right,rgba(255,255,255,.035) 1px,transparent 1px),linear-gradient(to bottom,rgba(255,255,255,.035) 1px,transparent 1px);background-size:38px 38px;}
    @keyframes lab-blink{0%,55%{opacity:1}56%,100%{opacity:0}}
    .lab-cursor{animation:lab-blink 1.1s step-end infinite}
    @keyframes lab-fadeup{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
    .lab-fadeup{animation:lab-fadeup .7s cubic-bezier(.22,1,.36,1) both}
    @keyframes lab-marquee{from{transform:translateX(0)}to{transform:translateX(-50%)}}
    .lab-marquee{animation:lab-marquee 26s linear infinite}
    @keyframes lab-sheen{0%{background-position:-160% 0}100%{background-position:260% 0}}
    .lab-sheen{position:relative}
    .lab-sheen::after{content:"";position:absolute;inset:0;border-radius:1rem;background:linear-gradient(115deg,transparent 40%,rgba(103,232,249,.10) 50%,transparent 60%);background-size:220% 100%;animation:lab-sheen 6s ease-in-out infinite;pointer-events:none}
    @media (prefers-reduced-motion: reduce){
      .lab-cursor,.lab-fadeup,.lab-marquee,.lab-sheen::after{animation:none!important}
      .lab-fadeup{opacity:1!important;transform:none!important}
    }
  `;
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}
