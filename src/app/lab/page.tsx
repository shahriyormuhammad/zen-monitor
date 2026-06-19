'use client';

import { useState } from 'react';
import {
  AlertTriangle,
  ArrowDownToLine,
  Check,
  ChevronRight,
  Download,
  MapPin,
  PackageCheck,
  TrendingDown,
  Truck,
} from 'lucide-react';

/* ─────────────────────────────────────────────────────────── mock data ─── */

type Status = 'critical' | 'deficit' | 'ok' | 'over';

const OKRUGA: { key: string; whs: string; ship: number; status: Status; loc: number; geo: number; fact: number }[] = [
  { key: 'Северо-Запад', whs: 'Шушары', ship: 156, status: 'critical', loc: 42, geo: 1343, fact: 479 },
  { key: 'Урал', whs: 'ЕКБ-Перспективный', ship: 255, status: 'deficit', loc: 55, geo: 3381, fact: 2207 },
  { key: 'Юг', whs: 'Краснодар · Невинномысск', ship: 368, status: 'deficit', loc: 58, geo: 2960, fact: 2310 },
  { key: 'Центр', whs: 'Электросталь · Тула', ship: 616, status: 'deficit', loc: 71, geo: 7649, fact: 6557 },
  { key: 'Поволжье', whs: 'Казань · Новосемейкино', ship: 320, status: 'ok', loc: 64, geo: 2706, fact: 2640 },
];

const WAREHOUSES: { name: string; ship: number; tone: string }[] = [
  { name: 'Электросталь', ship: 372, tone: 'bg-indigo-500' },
  { name: 'Тула', ship: 244, tone: 'bg-indigo-400' },
  { name: 'ЕКБ-Перспективный', ship: 255, tone: 'bg-sky-500' },
  { name: 'Новосемейкино', ship: 220, tone: 'bg-emerald-500' },
  { name: 'Краснодар', ship: 200, tone: 'bg-amber-500' },
  { name: 'Невинномысск', ship: 168, tone: 'bg-amber-400' },
  { name: 'Шушары', ship: 156, tone: 'bg-rose-500' },
  { name: 'Сарапул', ship: 100, tone: 'bg-violet-500' },
];

const SKU = [
  { art: 'A1115-8 ТН-9', size: '43', wh: 'Электросталь', geo: 64, fact: 65, stock: 1, days: 13, krp: 0, ship: 13 },
  { art: 'A1115-8 ТН-9', size: '40', wh: 'Электросталь', geo: 46, fact: 67, stock: 10, days: 32, krp: 0, ship: 0 },
  { art: 'A1115-14 ТН-9', size: '44', wh: 'Шушары', geo: 54, fact: 5, stock: 0, days: 0, krp: 2.05, ship: 41 },
  { art: 'A1115-14 ТН-9', size: '43', wh: 'Шушары', geo: 38, fact: 4, stock: 0, days: 0, krp: 2.05, ship: 30 },
  { art: 'A722-12 ТН-9', size: '41', wh: 'Краснодар', geo: 31, fact: 8, stock: 2, days: 9, krp: 1.20, ship: 24 },
  { art: 'A722-12 ТН-9', size: '42', wh: 'Казань', geo: 11, fact: 30, stock: 211, days: 202, krp: 0, ship: 0 },
  { art: 'A528-2 ТН-15', size: '40', wh: 'ЕКБ-Перспективный', geo: 49, fact: 9, stock: 1, days: 6, krp: 2.05, ship: 38 },
  { art: 'A528-2 ТН-15', size: '41', wh: 'Новосемейкино', geo: 28, fact: 24, stock: 18, days: 31, krp: 0, ship: 5 },
] as const;

const TOTAL = OKRUGA.reduce((s, o) => s + o.ship, 0);
const IL = 1.08;
const IRP = 1.59;
const DEFICIT_COUNT = OKRUGA.filter((o) => o.status === 'critical' || o.status === 'deficit').length;

const statusMeta: Record<Status, { label: string; text: string; chip: string; dot: string }> = {
  critical: { label: 'острый дефицит', text: 'text-rose-600 dark:text-rose-300', chip: 'bg-rose-50 dark:bg-rose-400/15', dot: 'bg-rose-500' },
  deficit: { label: 'дефицит', text: 'text-amber-600 dark:text-amber-300', chip: 'bg-amber-50 dark:bg-amber-400/15', dot: 'bg-amber-500' },
  ok: { label: 'в норме', text: 'text-emerald-600 dark:text-emerald-300', chip: 'bg-emerald-50 dark:bg-emerald-400/15', dot: 'bg-emerald-500' },
  over: { label: 'перетарка', text: 'text-slate-500', chip: 'bg-subtle', dot: 'bg-slate-400' },
};

const fmt = (n: number) => n.toLocaleString('ru-RU');

const VARIANTS = [
  { id: 'A', name: 'Действие по округам' },
  { id: 'B', name: 'Гео-баланс' },
  { id: 'C', name: 'Один ответ' },
  { id: 'D', name: 'Дашборд' },
  { id: 'E', name: 'Тёмный терминал' },
] as const;

/* ──────────────────────────────────────────────────────────────── page ─── */

export default function SupplyLab() {
  const [v, setV] = useState<(typeof VARIANTS)[number]['id']>('A');
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-2.5 sm:px-6">
          <span className="mr-1 text-[12px] font-bold text-muted-foreground">Поставки · слепки дизайна</span>
          {VARIANTS.map((x) => (
            <button
              key={x.id}
              type="button"
              onClick={() => setV(x.id)}
              className={`rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
                v === x.id ? 'bg-indigo-600 text-white' : 'border border-border text-slate-600 hover:border-indigo-300 dark:text-slate-300'
              }`}
            >
              {x.id} · {x.name}
            </button>
          ))}
        </div>
      </div>

      {v === 'A' && <VariantA />}
      {v === 'B' && <VariantB />}
      {v === 'C' && <VariantC />}
      {v === 'D' && <VariantD />}
      {v === 'E' && <VariantE />}
    </div>
  );
}

/* ════════════════════════════════════════════════ A — Действие по округам ═ */

function VariantA() {
  return (
    <Wrap>
      <TopLine />
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[13px] font-semibold text-indigo-600 dark:text-indigo-400">План поставки · 30 дней</p>
          <h1 className="mt-1 text-[2rem] font-black tracking-tight">Отгрузить {fmt(TOTAL)} шт</h1>
          <p className="mt-1 text-[14px] text-muted-foreground">по {OKRUGA.length} округам · {DEFICIT_COUNT} в дефиците · цель — поднять локализацию</p>
        </div>
        <ShipBtn />
      </header>

      <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[...OKRUGA].sort((a, b) => b.ship - a.ship).map((o) => {
          const m = statusMeta[o.status];
          return (
            <div key={o.key} className="rounded-2xl border border-border bg-card p-5 transition-shadow hover:shadow-[var(--shadow-md)]">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-[14px] font-bold"><MapPin className="h-4 w-4 text-muted-foreground" />{o.key}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${m.chip} ${m.text}`}>{m.label}</span>
              </div>
              <p className="mt-3 text-[28px] font-black tabular-nums">{fmt(o.ship)} <span className="text-[14px] font-semibold text-muted-foreground">шт</span></p>
              <p className="text-[12.5px] text-muted-foreground">{o.whs}</p>
              <div className="mt-3">
                <div className="flex items-center justify-between text-[11px] text-muted-foreground"><span>локализация</span><span className="font-semibold">{o.loc}%</span></div>
                <Bar value={o.loc} />
              </div>
            </div>
          );
        })}
      </div>

      <FullTable />
    </Wrap>
  );
}

/* ═══════════════════════════════════════════════════════ B — Гео-баланс ══ */

function VariantB() {
  const max = Math.max(...OKRUGA.map((o) => o.geo));
  return (
    <Wrap>
      <TopLine />
      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        <aside className="rounded-2xl border border-border bg-card p-6">
          <p className="text-[13px] font-semibold text-muted-foreground">К отгрузке за 30 дней</p>
          <p className="mt-1 text-[2.4rem] font-black leading-none tabular-nums">{fmt(TOTAL)}</p>
          <p className="text-[13px] text-muted-foreground">штук по {OKRUGA.length} округам</p>
          <div className="mt-5 space-y-3">
            <Gauge label="Индекс локализации (ИЛ)" value={IL} target={1.0} />
            <Gauge label="Индекс распред. (ИРП)" value={IRP} target={0.0} />
          </div>
          <ShipBtn full />
        </aside>

        <div className="rounded-2xl border border-border bg-card p-6">
          <p className="text-[14px] font-bold">Баланс по округам — где спрос не закрыт локально</p>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">Гео-заказы (нужно) против факт-отгрузок (есть). Разрыв = нелокальные заказы → растят индексы.</p>
          <div className="mt-5 space-y-4">
            {[...OKRUGA].sort((a, b) => (b.geo - b.fact) - (a.geo - a.fact)).map((o) => {
              const gap = o.geo - o.fact;
              const m = statusMeta[o.status];
              return (
                <div key={o.key}>
                  <div className="flex items-center justify-between text-[13px]">
                    <span className="font-semibold">{o.key}</span>
                    <span className={`font-semibold ${m.text}`}>+{fmt(o.ship)} шт · разрыв {fmt(gap)}</span>
                  </div>
                  <div className="mt-1.5 h-3 overflow-hidden rounded-full bg-subtle">
                    <div className="h-full rounded-full bg-indigo-500/30" style={{ width: `${(o.geo / max) * 100}%` }}>
                      <div className={`h-full rounded-full ${m.dot}`} style={{ width: `${(o.fact / o.geo) * 100}%` }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-4 flex items-center gap-1.5 text-[11.5px] text-muted-foreground"><span className="h-2 w-2 rounded-full bg-indigo-500/40" /> гео-заказы (нужно) · <span className="h-2 w-2 rounded-full bg-rose-500" /> факт (закрыто локально)</p>
        </div>
      </div>
      <FullTable />
    </Wrap>
  );
}

/* ═══════════════════════════════════════════════════════ C — Один ответ ══ */

function VariantC() {
  return (
    <Wrap>
      <TopLine />
      <div className="grid items-center gap-10 py-6 lg:grid-cols-[1fr_360px]">
        <div>
          <p className="text-[14px] font-semibold text-muted-foreground">На 30 дней нужно отгрузить</p>
          <p className="mt-2 text-[5rem] font-black leading-[0.95] tabular-nums">{fmt(TOTAL)}</p>
          <p className="text-[15px] text-muted-foreground">штук · {DEFICIT_COUNT} округа в дефиците</p>
          <div className="mt-7 space-y-2.5">
            <p className="text-[13px] font-semibold">Куда срочно:</p>
            {[...OKRUGA].filter((o) => o.status !== 'ok').sort((a, b) => statusRank(b) - statusRank(a)).slice(0, 3).map((o) => {
              const m = statusMeta[o.status];
              return (
                <div key={o.key} className="flex items-center gap-3">
                  <span className={`h-2.5 w-2.5 rounded-full ${m.dot}`} />
                  <span className="text-[15px] font-semibold">{o.key}</span>
                  <span className="text-[13px] text-muted-foreground">{o.whs}</span>
                  <span className="ml-auto text-[15px] font-black tabular-nums">{fmt(o.ship)} шт</span>
                </div>
              );
            })}
          </div>
          <ShipBtn />
        </div>
        <Donut />
      </div>
      <FullTable />
    </Wrap>
  );
}

/* ════════════════════════════════════════════════════════ D — Дашборд ════ */

function VariantD() {
  const max = Math.max(...WAREHOUSES.map((w) => w.ship));
  return (
    <Wrap>
      <TopLine />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi icon={ArrowDownToLine} label="К отгрузке, 30 дн" value={`${fmt(TOTAL)} шт`} accent />
        <Kpi icon={AlertTriangle} label="Округов в дефиците" value={`${DEFICIT_COUNT} из ${OKRUGA.length}`} tone="amber" />
        <Kpi icon={TrendingDown} label="Индекс локализации" value={IL.toFixed(2)} sub="цель ≤ 1.00" tone="rose" />
        <Kpi icon={TrendingDown} label="Индекс распред. (ИРП)" value={IRP.toFixed(2)} sub="цель 0.00" tone="rose" />
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-[1.4fr_1fr]">
        <div className="rounded-2xl border border-border bg-card p-6">
          <p className="text-[14px] font-bold">Сколько и куда отгрузить — по складам</p>
          <div className="mt-5 space-y-2.5">
            {[...WAREHOUSES].sort((a, b) => b.ship - a.ship).map((w) => (
              <div key={w.name} className="flex items-center gap-3">
                <span className="w-36 shrink-0 truncate text-[13px] text-slate-600 dark:text-slate-300">{w.name}</span>
                <div className="h-6 flex-1 overflow-hidden rounded-md bg-subtle">
                  <div className={`flex h-full items-center justify-end rounded-md ${w.tone} px-2 text-[11px] font-bold text-white`} style={{ width: `${(w.ship / max) * 100}%` }}>{w.ship}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-6">
          <p className="text-[14px] font-bold">Локализация по округам</p>
          <div className="mt-5 space-y-3.5">
            {OKRUGA.map((o) => (
              <div key={o.key}>
                <div className="flex items-center justify-between text-[12.5px]"><span>{o.key}</span><span className="font-semibold">{o.loc}%</span></div>
                <Bar value={o.loc} />
              </div>
            ))}
          </div>
          <p className="mt-4 text-[11.5px] text-muted-foreground">Порог 60% → наценка ИРП снимается.</p>
        </div>
      </div>
      <FullTable />
    </Wrap>
  );
}

/* ═══════════════════════════════════════════════════ E — Тёмный терминал ═ */

function VariantE() {
  const max = Math.max(...WAREHOUSES.map((w) => w.ship));
  return (
    <div className="bg-[oklch(0.16_0.02_265)] text-white">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-cyan-300">supply · 30d plan</p>
            <h1 className="mt-2 text-[2.2rem] font-extrabold tracking-tight">Отгрузить <span className="text-cyan-300">{fmt(TOTAL)}</span> шт</h1>
            <p className="mt-1 font-mono text-[12px] text-white/50">ИЛ {IL.toFixed(2)} · ИРП {IRP.toFixed(2)} · дефицит {DEFICIT_COUNT}/{OKRUGA.length} округов</p>
          </div>
          <button type="button" className="inline-flex items-center gap-2 rounded-lg bg-cyan-300 px-4 py-2.5 text-[13px] font-bold text-[oklch(0.16_0.02_265)]">
            <Download className="h-4 w-4" /> Файлы для WB
          </button>
        </div>

        <div className="mt-7 grid gap-3 lg:grid-cols-[1fr_1fr]">
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-white/45">отгрузить по складам</p>
            <div className="mt-4 space-y-2">
              {[...WAREHOUSES].sort((a, b) => b.ship - a.ship).map((w) => (
                <div key={w.name} className="flex items-center gap-3 font-mono text-[12px]">
                  <span className="w-36 shrink-0 truncate text-white/70">{w.name}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/8">
                    <div className="h-full rounded-full bg-cyan-300" style={{ width: `${(w.ship / max) * 100}%` }} />
                  </div>
                  <span className="w-10 text-right font-bold text-white tabular-nums">{w.ship}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-white/45">округа · разрыв локальности</p>
            <div className="mt-3 divide-y divide-white/8">
              {[...OKRUGA].sort((a, b) => statusRank(b) - statusRank(a)).map((o) => (
                <div key={o.key} className="flex items-center gap-3 py-2.5 font-mono text-[12.5px]">
                  <span className={`h-1.5 w-1.5 rounded-full ${statusMeta[o.status].dot}`} />
                  <span className="font-semibold">{o.key}</span>
                  <span className="text-white/40">{o.loc}%</span>
                  <span className="ml-auto font-bold text-cyan-200">+{o.ship}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <FullTable dark />
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────────────── shared pieces ───── */

function Wrap({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</div>;
}

function TopLine() {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-1 text-[12.5px] text-muted-foreground">
      <span className="font-semibold text-foreground">Skinshop · Wildberries</span>
      <span>период анализа 30 дн</span>
      <span>горизонт 30 дн</span>
      <span className="flex items-center gap-1.5">ИЛ <b className="text-foreground">{IL.toFixed(2)}</b> · ИРП <b className="text-foreground">{IRP.toFixed(2)}</b></span>
    </div>
  );
}

function ShipBtn({ full = false }: { full?: boolean }) {
  return (
    <button type="button" className={`mt-5 inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-[14px] font-bold text-white transition-colors hover:bg-indigo-700 ${full ? 'w-full' : ''}`}>
      <Truck className="h-4 w-4" /> Собрать поставку
      <ChevronRight className="h-4 w-4" />
    </button>
  );
}

function Bar({ value }: { value: number }) {
  const tone = value >= 60 ? 'bg-emerald-500' : value >= 50 ? 'bg-amber-500' : 'bg-rose-500';
  return (
    <div className="mt-1 h-2 overflow-hidden rounded-full bg-subtle">
      <div className={`h-full rounded-full ${tone} transition-[width] duration-500`} style={{ width: `${value}%` }} />
    </div>
  );
}

function Gauge({ label, value, target }: { label: string; value: number; target: number }) {
  const bad = value > target + 0.01;
  return (
    <div className="rounded-xl border border-border bg-subtle px-3 py-2.5">
      <div className="flex items-center justify-between text-[12px]"><span className="text-muted-foreground">{label}</span><span className={`font-black tabular-nums ${bad ? 'text-rose-600 dark:text-rose-300' : 'text-emerald-600 dark:text-emerald-300'}`}>{value.toFixed(2)}</span></div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">цель {target.toFixed(2)} · {bad ? 'переплата за логистику' : 'в норме'}</p>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, sub, accent = false, tone }: { icon: typeof Truck; label: string; value: string; sub?: string; accent?: boolean; tone?: 'amber' | 'rose' }) {
  const ic = accent ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-400/15 dark:text-indigo-300' : tone === 'amber' ? 'bg-amber-50 text-amber-600 dark:bg-amber-400/15 dark:text-amber-300' : tone === 'rose' ? 'bg-rose-50 text-rose-600 dark:bg-rose-400/15 dark:text-rose-300' : 'bg-subtle text-slate-600';
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <span className={`inline-flex h-9 w-9 items-center justify-center rounded-xl ${ic}`}><Icon className="h-4 w-4" /></span>
      <p className="mt-3 text-[24px] font-black tabular-nums">{value}</p>
      <p className="text-[12.5px] text-muted-foreground">{label}</p>
      {sub ? <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

function Donut() {
  const total = WAREHOUSES.reduce((s, w) => s + w.ship, 0);
  let acc = 0;
  const colors = ['#6366f1', '#818cf8', '#0ea5e9', '#10b981', '#f59e0b', '#fbbf24', '#f43f5e', '#8b5cf6'];
  const segs = WAREHOUSES.map((w, i) => {
    const frac = w.ship / total;
    const seg = { color: colors[i % colors.length], from: acc, to: acc + frac, w };
    acc += frac;
    return seg;
  });
  const grad = segs.map((s) => `${s.color} ${(s.from * 100).toFixed(1)}% ${(s.to * 100).toFixed(1)}%`).join(', ');
  return (
    <div className="mx-auto">
      <div className="relative h-[260px] w-[260px] rounded-full" style={{ background: `conic-gradient(${grad})` }}>
        <div className="absolute inset-[26%] flex flex-col items-center justify-center rounded-full bg-card text-center shadow-[var(--shadow-sm)]">
          <p className="text-[26px] font-black leading-none tabular-nums">{fmt(total)}</p>
          <p className="text-[11px] text-muted-foreground">шт по 8 складам</p>
        </div>
      </div>
    </div>
  );
}

function statusRank(o: { status: Status }) {
  return { critical: 3, deficit: 2, ok: 1, over: 0 }[o.status];
}

/* ─── полная таблица «как у них, но красивее» ─────────────────────────────── */

function FullTable({ dark = false }: { dark?: boolean }) {
  const headBg = dark ? 'bg-white/[0.04] text-white/55' : 'bg-subtle text-muted-foreground';
  const border = dark ? 'border-white/10' : 'border-border';
  const rowHover = dark ? 'hover:bg-white/[0.03]' : 'hover:bg-subtle';
  return (
    <section className={`mt-10 overflow-hidden rounded-2xl border ${border} ${dark ? 'bg-white/[0.02]' : 'bg-card'}`}>
      <div className={`flex items-center justify-between gap-3 border-b ${border} px-5 py-3.5`}>
        <div>
          <p className="text-[14px] font-bold">Полная таблица · товар × склад</p>
          <p className={`text-[12px] ${dark ? 'text-white/45' : 'text-muted-foreground'}`}>Если хочешь убедиться сам — все цифры по каждому размеру и складу.</p>
        </div>
        <button type="button" className={`inline-flex items-center gap-1.5 rounded-lg border ${border} px-3 py-1.5 text-[12px] font-semibold ${dark ? 'text-white/80' : 'text-slate-600 dark:text-slate-300'}`}><Download className="h-3.5 w-3.5" /> Excel</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-[13px]">
          <thead className={`text-left text-[11px] font-semibold uppercase tracking-wide ${headBg}`}>
            <tr>
              {['Артикул', 'Размер', 'Склад', 'Гео-заказы', 'Факт', 'Остаток', 'Хватит, дн', 'КРП', 'Отгрузить'].map((h) => (
                <th key={h} className="px-4 py-2.5 font-semibold last:text-right">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className={`divide-y ${border}`}>
            {SKU.map((r, i) => {
              const problem = r.krp > 1;
              const action = r.ship > 0;
              return (
                <tr key={i} className={`${rowHover} transition-colors`}>
                  <td className="px-4 py-2.5 font-semibold">{r.art}</td>
                  <td className={`px-4 py-2.5 tabular-nums ${dark ? 'text-white/70' : 'text-muted-foreground'}`}>{r.size}</td>
                  <td className={`px-4 py-2.5 ${dark ? 'text-white/70' : 'text-muted-foreground'}`}>{r.wh}</td>
                  <td className="px-4 py-2.5 tabular-nums">{r.geo}</td>
                  <td className={`px-4 py-2.5 tabular-nums ${dark ? 'text-white/60' : 'text-muted-foreground'}`}>{r.fact}</td>
                  <td className="px-4 py-2.5 tabular-nums">{r.stock}</td>
                  <td className="px-4 py-2.5 tabular-nums">{r.days || '—'}</td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${problem ? 'bg-rose-50 text-rose-600 dark:bg-rose-400/15 dark:text-rose-300' : dark ? 'text-white/50' : 'text-muted-foreground'}`}>{r.krp.toFixed(2)}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {action
                      ? <span className="inline-flex items-center gap-1 font-black tabular-nums text-indigo-600 dark:text-indigo-300"><ArrowDownToLine className="h-3.5 w-3.5" />{r.ship}</span>
                      : <span className={`inline-flex items-center gap-1 ${dark ? 'text-white/35' : 'text-muted-foreground'}`}><Check className="h-3.5 w-3.5" />ок</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className={`flex items-center gap-2 border-t ${border} px-5 py-2.5 text-[11.5px] ${dark ? 'text-white/45' : 'text-muted-foreground'}`}>
        <PackageCheck className="h-3.5 w-3.5" /> Показаны топ-строки · в реале фильтры, сортировка и настройка колонок — но по умолчанию виден ответ, а не 236 колонок.
      </div>
    </section>
  );
}
