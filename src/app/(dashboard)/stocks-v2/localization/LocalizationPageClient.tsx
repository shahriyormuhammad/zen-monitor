'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Info,
  LineChart as LineChartIcon,
  Loader2,
  MapPin,
  Target,
  TrendingUp,
} from 'lucide-react';
import { Area, AreaChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { OperatorState } from '@/components/dashboard/OperatorState';
import { formatNumber, formatPercent } from '@/components/economics/helpers';
import { resolveIrpFromLocalization } from '@/components/economics/constants';
import type {
  StocksV2LocalizationTrendPoint,
  StocksV2Payload,
  StockSkuRow,
} from '@/server/analytics/stocks-v2/types';

const TARGET_LOCALIZATION = 60;
const KRP_TIERS: Array<{ range: string; lower: number; upper: number; krp: number }> = [
  { range: '< 5%', lower: 0, upper: 5, krp: 2.5 },
  { range: '5–10%', lower: 5, upper: 10, krp: 2.45 },
  { range: '10–15%', lower: 10, upper: 15, krp: 2.35 },
  { range: '15–20%', lower: 15, upper: 20, krp: 2.3 },
  { range: '20–25%', lower: 20, upper: 25, krp: 2.25 },
  { range: '25–30%', lower: 25, upper: 30, krp: 2.2 },
  { range: '30–35%', lower: 30, upper: 35, krp: 2.15 },
  { range: '35–45%', lower: 35, upper: 45, krp: 2.1 },
  { range: '45–55%', lower: 45, upper: 55, krp: 2.05 },
  { range: '55–60%', lower: 55, upper: 60, krp: 2.0 },
  { range: '≥ 60%', lower: 60, upper: 100, krp: 0 },
];

function HeroTile({
  icon: Icon,
  iconClass,
  label,
  primary,
  secondary,
  tone = 'default',
}: {
  icon: React.ElementType;
  iconClass: string;
  label: string;
  primary: React.ReactNode;
  secondary: React.ReactNode;
  tone?: 'ok' | 'warning' | 'critical' | 'default';
}) {
  const border =
    tone === 'ok'
      ? 'border-emerald-500/40 bg-emerald-500/5'
      : tone === 'warning'
        ? 'border-amber-500/40 bg-amber-500/5'
        : tone === 'critical'
          ? 'border-rose-500/40 bg-rose-500/5'
          : 'border-border bg-card';
  return (
    <div className={`rounded-2xl border ${border} px-5 py-4 shadow-sm`}>
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className={`h-4 w-4 ${iconClass}`} />
        {label}
      </div>
      <div className="mt-2 text-3xl font-bold tabular-nums text-foreground">{primary}</div>
      <div className="mt-1 text-xs text-muted-foreground">{secondary}</div>
    </div>
  );
}

function TrendChart({ data }: { data: StocksV2LocalizationTrendPoint[] }) {
  const firstPoint = data?.[0];
  const lastPoint = data?.[data.length - 1];
  if (!data || data.length < 2 || !firstPoint || !lastPoint) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
        <LineChartIcon className="mr-2 inline h-3.5 w-3.5 text-emerald-500" />
        График «как менялась локализация» появится через пару недель — нужно
        накопить хотя бы 2 еженедельных снимка от WB. Сейчас точек: {data?.length ?? 0}.
      </div>
    );
  }
  const delta = lastPoint.ilPercent - firstPoint.ilPercent;
  const deltaTone =
    Math.abs(delta) < 1
      ? 'text-muted-foreground'
      : delta > 0
        ? 'text-emerald-700 dark:text-emerald-400'
        : 'text-rose-700 dark:text-rose-400';
  const deltaSign = delta > 0 ? '+' : delta < 0 ? '' : '±';
  // Шкала Y: от 0 до max(60, max+10) чтобы цель ≥60% всегда была видна.
  const maxIl = Math.max(60, ...data.map((p) => p.ilPercent)) + 5;
  const formatted = data.map((p) => ({
    ...p,
    label: new Date(p.weekStart).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }),
  }));
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <LineChartIcon className="h-4 w-4 text-emerald-500" />
          Как менялась локализация — {data.length} недель
        </div>
        <div className={`text-xs font-bold tabular-nums ${deltaTone}`}>
          {deltaSign}
          {formatPercent(delta, 1)} за {data.length} нед
        </div>
      </div>
      <div className="h-44 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={formatted} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="ilGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgb(16 185 129)" stopOpacity={0.35} />
                <stop offset="100%" stopColor="rgb(16 185 129)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: 'currentColor' }}
              axisLine={false}
              tickLine={false}
              className="text-muted-foreground"
            />
            <YAxis
              domain={[0, Math.ceil(maxIl)]}
              tick={{ fontSize: 10, fill: 'currentColor' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `${v}%`}
              width={36}
              className="text-muted-foreground"
            />
            <ReferenceLine
              y={60}
              stroke="rgb(16 185 129)"
              strokeDasharray="4 4"
              label={{ value: 'цель 60%', position: 'right', fill: 'rgb(16 185 129)', fontSize: 10 }}
            />
            <Tooltip
              contentStyle={{
                background: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ color: 'hsl(var(--foreground))', fontWeight: 600 }}
              formatter={(value, _name, item) => {
                const num = typeof value === 'number' ? value : Number(value ?? 0);
                const nmCount =
                  (item as { payload?: { nmCount?: number } }).payload?.nmCount ?? 0;
                return [`${num.toFixed(1)}% (${nmCount} SKU)`, 'ИЛ'];
              }}
            />
            <Area
              type="monotone"
              dataKey="ilPercent"
              stroke="rgb(16 185 129)"
              strokeWidth={2}
              fill="url(#ilGrad)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground">
        Среднее по всем активным товарам. Зелёная пунктирная линия — цель 60%, выше неё
        WB не берёт доплату. Хорошо когда график растёт.
      </div>
    </div>
  );
}

function KrpScale({ currentLocalization }: { currentLocalization: number | null }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-foreground">
        <TrendingUp className="h-4 w-4 text-emerald-500" />
        Сколько вы доплачиваете WB при разной локализации
      </div>
      <div className="mb-3 text-xs text-muted-foreground">
        Левый столбец — какая у вас локализация. Цифра внизу — на сколько % WB
        накручивает цену товара в логистике. Чем больше товаров рядом с покупателями
        — тем меньше доплата. С 60% доплата вообще пропадает.
      </div>
      <div className="grid grid-cols-11 gap-0.5 overflow-hidden rounded-lg border border-border">
        {KRP_TIERS.map((tier) => {
          const isActive =
            currentLocalization != null &&
            currentLocalization >= tier.lower &&
            (tier.upper === 100 ? currentLocalization >= 60 : currentLocalization < tier.upper);
          const isTarget = tier.upper === 100;
          const tone = isActive
            ? isTarget
              ? 'bg-emerald-500/30 ring-2 ring-emerald-500'
              : 'bg-amber-500/30 ring-2 ring-amber-500'
            : isTarget
              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'bg-muted/40';
          return (
            <div
              key={tier.range}
              className={`flex flex-col items-center justify-center px-1 py-2 text-center text-[10px] ${tone}`}
              title={`Если ${tier.range} заказов локальные — WB добавит ${tier.krp}% к цене товара`}
            >
              <div className="font-semibold text-muted-foreground">{tier.range}</div>
              <div className="mt-0.5 text-sm font-bold text-foreground tabular-nums">
                {tier.krp === 0 ? '0%' : `${tier.krp.toFixed(2).replace('.', ',')}%`}
              </div>
              {isActive ? (
                <div className="mt-0.5 text-[9px] font-bold uppercase text-amber-700 dark:text-amber-300">
                  Вы здесь
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RegionsTable({ regions }: { regions: StocksV2Payload['regions'] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (!regions || regions.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
        Региональных данных пока нет — после первой синхронизации с WB здесь появится разрез по ФО.
      </div>
    );
  }
  const totalStock = regions.reduce((s, r) => s + r.wbStockInDistrict, 0) || 1;
  const totalDemand = regions.reduce((s, r) => s + r.demandShare, 0) || 1;

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <MapPin className="h-4 w-4 text-emerald-500" />
          Где у вас покупают и где лежат товары
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          Россия делится на 7 больших регионов (округов). Если в регионе много покупают,
          но мало лежит — товары везут издалека и WB берёт с вас доплату.
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2 text-left font-semibold">Регион</th>
              <th className="px-3 py-2 text-right font-semibold">Покупают тут</th>
              <th className="px-3 py-2 text-right font-semibold">Лежит тут</th>
              <th className="px-3 py-2 text-right font-semibold">Разница</th>
              <th className="px-4 py-2 text-left font-semibold">Какие склады</th>
            </tr>
          </thead>
          <tbody>
            {regions.map((r) => {
              const demandPct = (r.demandShare / totalDemand) * 100;
              const stockPct = totalStock > 0 ? (r.wbStockInDistrict / totalStock) * 100 : 0;
              const delta = stockPct - demandPct;
              const deltaTone =
                delta < -10
                  ? 'text-rose-700 dark:text-rose-400'
                  : delta < -3
                    ? 'text-amber-700 dark:text-amber-400'
                    : delta > 10
                      ? 'text-sky-700 dark:text-sky-400'
                      : 'text-emerald-700 dark:text-emerald-400';
              const isOpen = expanded === r.foName;
              const hasWarehouses = r.warehouseNames.length > 0;
              return (
                <tr key={r.foName} className="border-b border-border last:border-b-0 hover:bg-muted/30">
                  <td className="px-4 py-2.5 font-medium text-foreground">{r.foName}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    <div className="flex flex-col items-end">
                      <span className="font-semibold">{formatPercent(demandPct, 0)}</span>
                      <div className="mt-0.5 h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-emerald-500/70"
                          style={{ width: `${Math.min(100, demandPct)}%` }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    <div className="flex flex-col items-end">
                      <span className="font-semibold">
                        {formatPercent(stockPct, 0)}{' '}
                        <span className="text-xs text-muted-foreground">
                          ({formatNumber(r.wbStockInDistrict, 0)} шт)
                        </span>
                      </span>
                      <div className="mt-0.5 h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-sky-500/70"
                          style={{ width: `${Math.min(100, stockPct)}%` }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className={`px-3 py-2.5 text-right font-bold tabular-nums ${deltaTone}`}>
                    {delta >= 0 ? '+' : ''}
                    {formatPercent(delta, 0)}
                  </td>
                  <td className="px-4 py-2.5">
                    {hasWarehouses ? (
                      <button
                        type="button"
                        onClick={() => setExpanded(isOpen ? null : r.foName)}
                        className="flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-300"
                      >
                        {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                        {r.warehouseNames.length} {r.warehouseNames.length === 1 ? 'склад' : 'склад(ов)'}
                      </button>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                    {isOpen && hasWarehouses ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {r.warehouseNames.map((w) => (
                          <span
                            key={w}
                            className="rounded-md border border-border bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground"
                          >
                            {w}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="border-t border-border bg-muted/30 px-4 py-2 text-[11px] text-muted-foreground">
        <span className="text-rose-700 dark:text-rose-400">Минус</span> — в этом регионе
        покупают много, а лежит мало (надо туда довезти). <span className="text-sky-700 dark:text-sky-400">Плюс</span>
        {' '}— наоборот, лежит много, а покупают мало (можно увезти оттуда).
      </div>
    </div>
  );
}

function WorstSkuTable({ items }: { items: StockSkuRow[] }) {
  const worst = useMemo(() => {
    return items
      .filter((it) => it.localizationPercent != null && it.avgDailyDemand > 0)
      .sort((a, b) => (a.localizationPercent ?? 100) - (b.localizationPercent ?? 100))
      .slice(0, 10);
  }, [items]);

  if (worst.length === 0) {
    return null;
  }
  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <AlertTriangle className="h-4 w-4 text-rose-500" />
          10 товаров, которые везут дальше всех
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          У этих товаров меньше всего заказов с ближайшего склада — значит за них
          вы переплачиваете больше всего.
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2 text-left font-semibold">Артикул</th>
              <th className="px-3 py-2 text-left font-semibold">Бренд</th>
              <th className="px-3 py-2 text-right font-semibold">Заказов рядом</th>
              <th className="px-3 py-2 text-right font-semibold">Доплата</th>
              <th className="px-3 py-2 text-right font-semibold">Заказов в день</th>
              <th className="px-3 py-2 text-right font-semibold">Лежит на WB</th>
            </tr>
          </thead>
          <tbody>
            {worst.map((it) => {
              const loc = it.localizationPercent ?? 0;
              const krp = resolveIrpFromLocalization(loc);
              const locTone =
                loc < 20
                  ? 'text-rose-700 dark:text-rose-400'
                  : loc < 40
                    ? 'text-amber-700 dark:text-amber-400'
                    : 'text-emerald-700 dark:text-emerald-400';
              return (
                <tr key={it.nmId} className="border-b border-border last:border-b-0 hover:bg-muted/30">
                  <td className="px-4 py-2 font-medium text-foreground">
                    {it.vendorCode ?? `nm ${it.nmId}`}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{it.brand ?? '—'}</td>
                  <td className={`px-3 py-2 text-right font-bold tabular-nums ${locTone}`}>
                    {formatPercent(loc, 1)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {krp === 0 ? '0%' : `${krp.toFixed(2).replace('.', ',')}%`}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {formatNumber(it.avgDailyDemand, 2)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {formatNumber(it.wbStock, 0)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function LocalizationPageClient({ tenantId }: { tenantId: string }) {
  const { data, isLoading, error, refetch } = useQuery<StocksV2Payload | null, Error>({
    queryKey: ['stocks-v2-localization', tenantId],
    queryFn: async () => {
      const response = await fetch(
        `/api/views/stocks-v2?targetDays=30&leadTimeDays=46&demandPeriodDays=30`,
        { cache: 'no-store' },
      );
      if (!response.ok) throw new Error('Не удалось загрузить остатки');
      return response.json();
    },
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
  });

  if (isLoading) {
    return (
      <div className="flex h-[55vh] flex-col items-center justify-center gap-4 text-emerald-600">
        <Loader2 className="h-10 w-10 animate-spin" />
        <p className="animate-pulse font-medium text-muted-foreground">Считаем локализацию…</p>
      </div>
    );
  }
  if (error) {
    return (
      <OperatorState
        icon={AlertTriangle}
        tone="danger"
        title="Не удалось загрузить локализацию"
        description={error.message}
        actionLabel="Повторить запрос"
        action={refetch}
      />
    );
  }
  if (!data) {
    return (
      <OperatorState
        icon={MapPin}
        tone="default"
        title="Данных пока нет"
        description="После первой синхронизации с WB здесь появится разрез по локализации."
      />
    );
  }

  const { kpi, regions, items } = data;
  const il = kpi.avgLocalizationPercent;
  const krp = il != null ? resolveIrpFromLocalization(il) : null;
  const toTarget = il != null ? Math.max(0, TARGET_LOCALIZATION - il) : null;
  const ilProgress = il != null ? Math.min(100, (il / TARGET_LOCALIZATION) * 100) : 0;

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 space-y-4 pb-10 duration-500">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/stocks-v2"
            prefetch={false}
            className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Дашборд
          </Link>
        </div>
        <Link
          href="/redistribution"
          prefetch={false}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-600"
        >
          📦 Что куда везти <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {/* Hero KPIs */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <HeroTile
          icon={TrendingUp}
          iconClass="text-emerald-500"
          label="Заказы рядом с покупателем"
          primary={il != null ? formatPercent(il, 1) : '—'}
          secondary={
            il != null ? (
              <div className="mt-1 space-y-1.5">
                <div className="flex items-center gap-2">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full ${il >= TARGET_LOCALIZATION ? 'bg-emerald-500' : 'bg-amber-500'}`}
                      style={{ width: `${ilProgress}%` }}
                    />
                  </div>
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    нужно {TARGET_LOCALIZATION}%
                  </span>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Из 100 заказов {Math.round(il)} закрываются ближайшим складом, остальные везут издалека
                </div>
              </div>
            ) : (
              'нет данных от WB'
            )
          }
          tone={il == null ? 'default' : il >= TARGET_LOCALIZATION ? 'ok' : 'warning'}
        />
        <HeroTile
          icon={TrendingUp}
          iconClass={krp === 0 ? 'text-emerald-500' : 'text-amber-500'}
          label="Доплата за дальность"
          primary={krp != null ? (krp === 0 ? '0%' : `${krp.toFixed(2).replace('.', ',')}%`) : '—'}
          secondary={
            krp == null
              ? 'нет данных'
              : krp === 0
                ? 'WB не берёт с вас доплату — отлично'
                : 'WB добавляет столько % к цене каждого товара в логистике'
          }
          tone={krp == null ? 'default' : krp === 0 ? 'ok' : 'warning'}
        />
        <HeroTile
          icon={Target}
          iconClass="text-sky-500"
          label="Сколько до нулевой доплаты"
          primary={
            toTarget != null
              ? toTarget === 0
                ? '0%'
                : `+${toTarget.toFixed(1)}%`
              : '—'
          }
          secondary={
            toTarget == null
              ? 'нет данных'
              : toTarget === 0
                ? 'вы уже на цели — WB не берёт доплату за дальность'
                : 'если поднимете до 60% — WB перестанет брать доплату (базовая логистика останется)'
          }
          tone={toTarget == null ? 'default' : toTarget === 0 ? 'ok' : 'default'}
        />
      </div>

      {/* Trend chart — динамика ИЛ за 13 недель */}
      <TrendChart data={data.localizationTrend ?? []} />

      {/* KRP scale */}
      <KrpScale currentLocalization={il} />

      {/* Regions table — главное */}
      <RegionsTable regions={regions} />

      {/* Worst SKUs */}
      <WorstSkuTable items={items} />

      {/* CTA */}
      <div className="rounded-2xl border-2 border-emerald-500/40 bg-emerald-500/5 px-5 py-4 text-center">
        <div className="text-sm font-semibold text-foreground">
          Видите перекос (где-то «минус», где-то «плюс»)? Программа сама посчитает, что и куда перевезти,
          чтобы платить меньше. Покажет цифрами, сколько сэкономите.
        </div>
        <Link
          href="/redistribution"
          prefetch={false}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-600"
        >
          📦 Что куда везти <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      {/* Info block */}
      <div className="flex items-start gap-2 rounded-xl border border-dashed border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-500" />
        <div className="space-y-2">
          <p>
            <b>Что такое локализация.</b> Покупатель из Сибири заказывает у вас расчёску.
            Если расчёска уже лежит на сибирском складе WB — это «локальный» (близкий) заказ.
            Если её везут из Москвы — «дальний». Доля близких из всех ваших заказов и
            называется локализацией. <span className="opacity-70">(в WB её зовут «индекс локализации» или ИЛ)</span>
          </p>
          <p>
            <b>Зачем повышать.</b> Если у вас близких заказов меньше 60%, WB добавляет
            от 2% до 2.5% к цене каждого товара в логистике. Чем меньше локализация — тем
            больше доплата. <span className="opacity-70">(WB зовёт эту доплату КРП или ИРП — действует с 23 марта 2026)</span>
          </p>
          <p>
            <b>Что делать.</b> Везти товары на склады там, где их покупают. Не держать всё
            в одной Москве, если у вас покупают по всей России.
          </p>
          <p>
            <b>Как часто обновляется.</b> WB пересчитывает каждый понедельник, смотрит на
            последние 13 недель.
          </p>
          <a
            href="https://seller.wildberries.ru/instructions/ru/ru/material/sales-distribution-index"
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 font-medium text-emerald-700 hover:underline dark:text-emerald-300"
          >
            Подробное объяснение от WB <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
    </div>
  );
}
