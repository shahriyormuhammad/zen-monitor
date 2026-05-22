'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Loader2 } from 'lucide-react';

import { formatMoney, formatNumber, formatPercent } from '../_shared/format';

type Props = {
  tenantId: string;
  fromParam: string;
  toParam: string;
};

type HeatmapPoint = {
  weekday: number;
  hour: number | null;
  day: string | null;
  adSpend: number;
  revenue: number;
  views: number;
  clicks: number;
  orders: number;
  acosPct: number | null;
  cpc: number | null;
  ctrPct: number | null;
};

type HeatmapResponse = {
  generatedAt: string;
  granularity: 'hourly' | 'daily';
  source: 'advertising_hourly_stats' | 'advertising_overview_daily';
  scope: {
    advertId: number | null;
    nmId: number | null;
    attributionScope: 'tenant' | 'campaign' | 'sku' | 'group';
    groupId: string | null;
    groupName: string | null;
    groupNmCount: number;
    matchedNmIds: number[];
  };
  points: HeatmapPoint[];
};

const WEEKDAY = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

function hourLabel(hour: number) {
  return `${hour}:00`;
}

function weekdayIndex(day: string) {
  const date = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return 0;
  }
  return (date.getUTCDay() + 6) % 7;
}

function dayLabel(day: string) {
  const date = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return day;
  }
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC',
  }).format(date);
}

function hasActivity(point: Pick<HeatmapPoint, 'adSpend' | 'revenue' | 'views' | 'clicks' | 'orders'>) {
  return point.adSpend > 0 || point.revenue > 0 || point.views > 0 || point.clicks > 0 || point.orders > 0;
}

function cellClass(point: Pick<HeatmapPoint, 'adSpend' | 'revenue' | 'acosPct'>) {
  if (point.adSpend <= 0 && point.revenue <= 0) {
    return 'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400';
  }
  if (point.revenue <= 0 && point.adSpend >= 500) {
    return 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-200';
  }
  if (point.acosPct !== null && point.acosPct <= 20) {
    return 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200';
  }
  if (point.acosPct !== null && point.acosPct <= 40) {
    return 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200';
  }
  return 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-200';
}

function summarizeWeekday(points: HeatmapPoint[]) {
  const spend = points.reduce((sum, point) => sum + point.adSpend, 0);
  const revenue = points.reduce((sum, point) => sum + point.revenue, 0);
  const days = points.length;
  const acosPct = revenue > 0 ? (spend / revenue) * 100 : null;
  return {
    spend,
    revenue,
    days,
    acosPct,
  };
}

function scopeLabel(scope: HeatmapResponse['scope'] | undefined) {
  if (!scope) return 'Весь кабинет';
  if (scope.attributionScope === 'group') return `Склейка: ${scope.groupName ?? 'без названия'}`;
  if (scope.attributionScope === 'sku') return scope.nmId ? `SKU nmId ${scope.nmId}` : 'SKU';
  if (scope.attributionScope === 'campaign') return scope.advertId ? `Кампания #${scope.advertId}` : 'Кампания';
  return 'Весь кабинет';
}

function isBadHour(point: HeatmapPoint) {
  return (point.revenue <= 0 && point.adSpend >= 500)
    || (point.orders <= 0 && point.adSpend >= 700)
    || (point.acosPct !== null && point.adSpend >= 300 && point.acosPct >= 45);
}

function hourPointLabel(point: HeatmapPoint) {
  return `${WEEKDAY[point.weekday] ?? '—'} ${hourLabel(point.hour ?? 0)}`;
}

export function AdvertisingHeatmap({ tenantId, fromParam, toParam }: Props) {
  const query = useQuery<HeatmapResponse | null, Error>({
    queryKey: ['advertising-heatmap', tenantId, fromParam, toParam],
    queryFn: async () => {
      const response = await fetch(`/api/views/advertising/heatmap?from=${fromParam}&to=${toParam}`, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('Не удалось собрать тепловую карту рекламы');
      }
      return response.json();
    },
    enabled: Boolean(tenantId),
  });

  const weekdayRows = useMemo(() => {
    const points = query.data?.points ?? [];
    return WEEKDAY.map((label, index) => {
      const rowPoints = points.filter((point) => (
        query.data?.granularity === 'hourly'
          ? point.weekday === index
          : point.day !== null && weekdayIndex(point.day) === index
      ));
      return {
        label,
        points: rowPoints,
        summary: summarizeWeekday(rowPoints),
      };
    });
  }, [query.data?.granularity, query.data?.points]);

  const isHourly = query.data?.granularity === 'hourly';
  const hourlyPoints = (query.data?.points ?? []).filter((point) => point.hour !== null);
  const bestHours = [...hourlyPoints]
    .filter((point) => point.orders > 0)
    .sort((left, right) => (
      right.orders - left.orders
      || (left.acosPct ?? 999) - (right.acosPct ?? 999)
      || right.revenue - left.revenue
    ))
    .slice(0, 3);
  const badHours = hourlyPoints.filter(isBadHour);

  if (query.isLoading) {
    return (
      <section className="flex min-h-[414px] items-center justify-center rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Собираем тепловую карту...
        </div>
      </section>
    );
  }

  if (query.error || weekdayRows.every((row) => row.points.length === 0)) {
    return null;
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="mb-3 flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
        <h2 className="flex items-center gap-2 text-base font-extrabold text-slate-900 dark:text-slate-100">
          <CalendarDays className="h-4 w-4 text-emerald-600" />
          Когда реклама работает
        </h2>
        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
          {isHourly
            ? 'Почасовой слой: в ячейке заказы за час МСК (пусто/0 = заказов не было или нет данных)'
            : 'Дневной fallback: расход, выручка и ДРР'}
        </p>
      </div>
      {isHourly ? (
        <div className="mb-3 grid gap-2 md:grid-cols-4">
          <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900/50">
            <p className="text-[11px] font-semibold uppercase text-slate-500">Слой</p>
            <p className="mt-1 text-sm font-black text-slate-900 dark:text-slate-100">{scopeLabel(query.data?.scope)}</p>
          </div>
          <div className="rounded-xl bg-emerald-50 p-3 dark:bg-emerald-950/30">
            <p className="text-[11px] font-semibold uppercase text-emerald-700 dark:text-emerald-300">Лучшие часы</p>
            <p className="mt-1 text-sm font-black text-slate-900 dark:text-slate-100">
              {bestHours.length > 0
                ? bestHours.map((point) => `${hourPointLabel(point)}: ${formatNumber(point.orders)}`).join(' · ')
                : 'нет'}
            </p>
          </div>
          <div className="rounded-xl bg-rose-50 p-3 dark:bg-rose-950/30">
            <p className="text-[11px] font-semibold uppercase text-rose-700 dark:text-rose-300">Плохие часы</p>
            <p className="mt-1 text-sm font-black text-slate-900 dark:text-slate-100">{formatNumber(badHours.length)}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900/50">
            <p className="text-[11px] font-semibold uppercase text-slate-500">Расчет</p>
            <p className="mt-1 text-sm font-black text-slate-900 dark:text-slate-100">Сумма за период, МСК</p>
          </div>
        </div>
      ) : null}
      {isHourly ? (
        <div className="overflow-x-auto">
          <div className="min-w-[820px] space-y-1">
            <div className="grid grid-cols-[64px_repeat(24,minmax(26px,1fr))] gap-1 pl-1 text-[10px] font-black text-slate-400">
              <span />
              {HOURS.map((hour) => (
                <span key={hour} className="text-center">{hourLabel(hour)}</span>
              ))}
            </div>
            {weekdayRows.map((row, weekday) => (
              <div key={row.label} className="grid grid-cols-[64px_repeat(24,minmax(26px,1fr))] gap-1">
                <div className="rounded-lg bg-slate-100 px-2 py-1.5 dark:bg-slate-900/50">
                  <p className="text-xs font-black text-slate-900 dark:text-slate-100">{row.label}</p>
                  <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">{formatMoney(row.summary.spend)}</p>
                </div>
                {HOURS.map((hour) => {
                  const point = row.points.find((item) => item.weekday === weekday && item.hour === hour) ?? {
                    weekday,
                    hour,
                    day: null,
                    adSpend: 0,
                    revenue: 0,
                    views: 0,
                    clicks: 0,
                    orders: 0,
                    acosPct: null,
                    cpc: null,
                    ctrPct: null,
                  } satisfies HeatmapPoint;
                  const active = hasActivity(point);
                  return (
                    <div
                      key={`${weekday}-${hour}`}
                      className={`flex h-9 items-center justify-center rounded-lg border text-center text-xs font-black ${cellClass(point)}`}
                      title={`${row.label} ${hourLabel(hour)} МСК · Расход ${formatMoney(point.adSpend)} · Заказы ${point.orders} · Выручка ${formatMoney(point.revenue)} · ДРР ${point.acosPct === null ? '—' : formatPercent(point.acosPct)}`}
                    >
                      {active ? point.orders : 0}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="grid gap-2 lg:grid-cols-7">
          {weekdayRows.map((row) => (
            <div key={row.label} className="space-y-2">
              <div className="rounded-xl bg-slate-100 px-3 py-2 dark:bg-slate-900/50">
                <p className="text-xs font-black text-slate-900 dark:text-slate-100">{row.label}</p>
                <p className="mt-0.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  {row.summary.days > 0
                    ? `${formatMoney(row.summary.spend)} · ${row.summary.acosPct === null ? 'ДРР —' : formatPercent(row.summary.acosPct)}`
                    : 'нет данных'}
                </p>
              </div>
              <div className="grid gap-1">
                {row.points.slice(-6).map((point) => (
                  <div
                    key={point.day}
                    className={`min-h-[74px] rounded-xl border p-2 ${cellClass(point)}`}
                    title={`Расход ${formatMoney(point.adSpend)} · Выручка ${formatMoney(point.revenue)}`}
                  >
                    <p className="text-[11px] font-black">{dayLabel(point.day ?? '')}</p>
                    <p className="mt-1 text-[11px] font-semibold">Заказы {point.orders}</p>
                    <p className="text-[11px] font-semibold">Расход {formatMoney(point.adSpend)}</p>
                    <p className="text-[11px] font-semibold">
                      {point.acosPct === null ? 'ДРР —' : `ДРР ${formatPercent(point.acosPct)}`}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
