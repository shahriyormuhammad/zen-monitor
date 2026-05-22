'use client';

import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { CircleHelp } from 'lucide-react';
import type { DashboardMetricKey } from '@/components/dashboard/KPICards';

type DashboardChartPoint = {
  day_date?: string;
  gross_revenue?: number | string;
  net_profit?: number | string;
  order_sum?: number | string;
  order_count?: number | string;
  buyout_count?: number | string;
  buyout_rate_pct?: number | string;
  gross_margin_pct?: number | string;
  net_margin_pct?: number | string;
  storage_amount?: number | string;
  conversion_pct?: number | string;
  impressions?: number | string;
  funnel_ctr_pct?: number | string;
  ads_amount?: number | string;
  ads_drr_pct?: number | string;
  localization_pct?: number | string;
  stocks_total?: number | string;
  spp_pct?: number | string;
};

type DashboardChartRow = DashboardChartPoint & Record<string, unknown>;
type ChartValueType = 'currency' | 'count' | 'percent';
type ChartSeriesKey = 'primary' | 'secondary' | 'comparison';

type MetricConfig = {
  title: string;
  subtitle: string;
  key: keyof DashboardChartPoint;
  valueType: ChartValueType;
  color: string;
  gradientId: string;
  secondaryKey?: keyof DashboardChartPoint;
  secondaryColor?: string;
  secondaryGradientId?: string;
};

const METRIC_CONFIG: Record<DashboardMetricKey, MetricConfig> = {
  revenue: {
    title: 'Выручка и прибыль до рекламы',
    subtitle: 'Дневная динамика выручки с линией чистой прибыли для контекста',
    key: 'gross_revenue',
    valueType: 'currency',
    color: '#10b981',
    gradientId: 'metric-gradient-revenue',
    secondaryKey: 'net_profit',
    secondaryColor: '#3b82f6',
    secondaryGradientId: 'metric-gradient-revenue-secondary',
  },
  profit: {
    title: 'Чистая прибыль по дням',
    subtitle: 'Дневная чистая прибыль с линией выручки для сравнения',
    key: 'net_profit',
    valueType: 'currency',
    color: '#3b82f6',
    gradientId: 'metric-gradient-profit',
    secondaryKey: 'gross_revenue',
    secondaryColor: '#10b981',
    secondaryGradientId: 'metric-gradient-profit-secondary',
  },
  orderSum: {
    title: 'Сумма заказов по дням',
    subtitle: 'Дневная сумма заказов (funnel с fallback на raw orders)',
    key: 'order_sum',
    valueType: 'currency',
    color: '#0891b2',
    gradientId: 'metric-gradient-order-sum',
  },
  orders: {
    title: 'Заказы по дням',
    subtitle: 'Количество заказов в день',
    key: 'order_count',
    valueType: 'count',
    color: '#8b5cf6',
    gradientId: 'metric-gradient-orders',
  },
  buyouts: {
    title: 'Выкупы по дням',
    subtitle: 'Количество выкупов в день',
    key: 'buyout_count',
    valueType: 'count',
    color: '#06b6d4',
    gradientId: 'metric-gradient-buyouts',
  },
  grossMargin: {
    title: 'Маржинальность по дням',
    subtitle: 'Доля прибыли до налога в выручке, %',
    key: 'gross_margin_pct',
    valueType: 'percent',
    color: '#f59e0b',
    gradientId: 'metric-gradient-gross-margin',
  },
  margin: {
    title: 'Рентабельность чистой прибыли по дням',
    subtitle: 'Доля чистой прибыли в выручке, %',
    key: 'net_margin_pct',
    valueType: 'percent',
    color: '#b45309',
    gradientId: 'metric-gradient-net-margin',
  },
  storage: {
    title: 'Хранение по дням',
    subtitle: 'Дневные расходы на хранение',
    key: 'storage_amount',
    valueType: 'currency',
    color: '#14b8a6',
    gradientId: 'metric-gradient-storage',
  },
  conversion: {
    title: 'Просмотр → заказ по дням',
    subtitle: 'Заказы / просмотры карточек WB, %',
    key: 'conversion_pct',
    valueType: 'percent',
    color: '#f43f5e',
    gradientId: 'metric-gradient-conversion',
  },
  impressions: {
    title: 'Показы по дням',
    subtitle: 'Показы карточек из воронки ЛК WB (на уровне кабинета), с CTR воронки',
    key: 'impressions',
    valueType: 'count',
    color: '#6366f1',
    gradientId: 'metric-gradient-impressions',
  },
  ads: {
    title: 'ДРР по дням',
    subtitle: 'Доля рекламных расходов от выручки, %',
    key: 'ads_drr_pct',
    valueType: 'percent',
    color: '#6366f1',
    gradientId: 'metric-gradient-ads',
  },
  localization: {
    title: 'Локализация по дням',
    subtitle: 'Последний пересчёт размещения остатков за день',
    key: 'localization_pct',
    valueType: 'percent',
    color: '#d946ef',
    gradientId: 'metric-gradient-localization',
  },
  stocks: {
    title: 'Остатки по дням',
    subtitle: 'Суммарные остатки WB по ежедневным snapshot',
    key: 'stocks_total',
    valueType: 'count',
    color: '#0ea5e9',
    gradientId: 'metric-gradient-stocks',
  },
  spp: {
    title: 'SPP по дням',
    subtitle: 'Дневной процент SPP по финансовым данным',
    key: 'spp_pct',
    valueType: 'percent',
    color: '#a855f7',
    gradientId: 'metric-gradient-spp',
  },
};

const SECONDARY_LABELS: Partial<Record<keyof DashboardChartPoint, string>> = {
  gross_revenue: 'Выручка',
  net_profit: 'Чистая прибыль',
};

function parseNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatByType(value: number, type: ChartValueType) {
  if (type === 'currency') {
    return `₽ ${Math.round(value).toLocaleString('ru-RU')}`;
  }

  if (type === 'percent') {
    return `${value.toFixed(1)}%`;
  }

  return Math.round(value).toLocaleString('ru-RU');
}

function formatDayLabel(value: unknown) {
  const dayDate = typeof value === 'string' ? value : '';
  const date = dayDate ? new Date(`${dayDate}T00:00:00`) : null;

  return date && !Number.isNaN(date.getTime())
    ? new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' }).format(date)
    : dayDate;
}


type PlotPoint = {
  index: number;
  x: number;
  y: number;
  value: number;
  label: string;
};

type PreparedChartRow = {
  name: string;
  comparisonName: string;
  primary: number | null;
  secondary: number | null;
  comparison: number | null;
};

type ChartGeometry = {
  primaryPath: string;
  primaryAreaPath: string;
  primaryPoints: PlotPoint[];
  secondaryPath: string | null;
  secondaryAreaPath: string | null;
  secondaryPoints: PlotPoint[];
  comparisonPath: string | null;
  comparisonPoints: PlotPoint[];
  yTicks: Array<{ value: number; label: string; y: number }>;
  xLabels: Array<{ label: string; x: number }>;
  plot: { top: number; right: number; bottom: number; left: number; width: number; height: number };
};

function getChartDomain(values: number[]) {
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const baseMin = rawMin >= 0 ? 0 : rawMin;
  const range = Math.max(rawMax - baseMin, Math.abs(rawMax) * 0.1, 1);
  const padding = range * 0.08;

  return {
    min: rawMin >= 0 ? 0 : baseMin - padding,
    max: rawMax + padding,
  };
}

function getY(value: number, min: number, max: number, top: number, height: number) {
  if (Math.abs(max - min) < 0.0001) {
    return top + height / 2;
  }

  return top + ((max - value) / (max - min)) * height;
}

function buildPlotPoints(
  rows: PreparedChartRow[],
  key: ChartSeriesKey,
  min: number,
  max: number,
  plot: ChartGeometry['plot'],
) {
  const step = rows.length > 1 ? plot.width / (rows.length - 1) : 0;

  return rows.flatMap((row, index) => {
    const value = row[key];
    if (value === null) {
      return [];
    }

    return [{
      index,
      x: plot.left + step * index,
      y: getY(value, min, max, plot.top, plot.height),
      value,
      label: row.name,
    }];
  });
}

function buildLinePath(points: PlotPoint[]) {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
}

function buildAreaPath(points: PlotPoint[], baselineY: number) {
  const linePath = buildLinePath(points);
  const first = points[0];
  const last = points.at(-1);

  if (!linePath || !first || !last) {
    return '';
  }

  return `${linePath} L ${last.x.toFixed(1)} ${baselineY.toFixed(1)} L ${first.x.toFixed(1)} ${baselineY.toFixed(1)} Z`;
}

function buildChartGeometry(
  rows: PreparedChartRow[],
  valueType: ChartValueType,
  width: number,
  height: number,
): ChartGeometry | null {
  const values = rows.flatMap((row) => (
    [row.primary, row.secondary, row.comparison].filter((value): value is number => value !== null)
  ));
  if (!values.length || width <= 0 || height <= 0) {
    return null;
  }

  const left = valueType === 'percent' ? 56 : 74;
  const plot = {
    top: 18,
    right: 24,
    bottom: 28,
    left,
    width: Math.max(width - left - 24, 1),
    height: Math.max(height - 18 - 28, 1),
  };
  const { min, max } = getChartDomain(values);
  const primaryPoints = buildPlotPoints(rows, 'primary', min, max, plot);
  const secondaryPoints = buildPlotPoints(rows, 'secondary', min, max, plot);
  const comparisonPoints = buildPlotPoints(rows, 'comparison', min, max, plot);
  const baselineY = getY(Math.max(min, 0), min, max, plot.top, plot.height);
  const yTicks = Array.from({ length: 4 }, (_, index) => {
    const value = min + ((max - min) * index) / 3;
    return {
      value,
      label: formatAxisValue(value, valueType),
      y: getY(value, min, max, plot.top, plot.height),
    };
  }).reverse();
  const xStep = rows.length > 1 ? plot.width / (rows.length - 1) : 0;
  const xLabelStep = Math.max(1, Math.ceil(rows.length / 6));
  const xLabels = rows
    .map((row, index) => ({ row, index }))
    .filter(({ index }) => index === 0 || index === rows.length - 1 || index % xLabelStep === 0)
    .map(({ row, index }) => ({
      label: row.name,
      x: plot.left + xStep * index,
    }));

  return {
    primaryPath: buildLinePath(primaryPoints),
    primaryAreaPath: buildAreaPath(primaryPoints, baselineY),
    primaryPoints,
    secondaryPath: secondaryPoints.length ? buildLinePath(secondaryPoints) : null,
    secondaryAreaPath: secondaryPoints.length ? buildAreaPath(secondaryPoints, baselineY) : null,
    secondaryPoints,
    comparisonPath: comparisonPoints.length ? buildLinePath(comparisonPoints) : null,
    comparisonPoints,
    yTicks,
    xLabels,
    plot,
  };
}

function formatAxisValue(value: number, type: ChartValueType) {
  if (type === 'percent') {
    return `${Math.round(value)}%`;
  }

  const absValue = Math.abs(value);
  if (absValue >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}м`;
  }

  if (absValue >= 1_000) {
    return `${Math.round(value / 100) / 10}к`;
  }

  return Math.round(value).toLocaleString('ru-RU');
}

function TooltipValueRow({
  color,
  label,
  value,
  dashed = false,
}: {
  color: string;
  label: string;
  value: string;
  dashed?: boolean;
}) {
  return (
    <div className="mt-2 flex items-center justify-between gap-3">
      <span className="flex min-w-0 items-center gap-2 font-semibold text-muted-foreground">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${dashed ? 'border bg-transparent' : ''}`}
          style={dashed ? { borderColor: color } : { backgroundColor: color }}
        />
        <span className="truncate">{label}</span>
      </span>
      <span className="shrink-0 font-black text-foreground">{value}</span>
    </div>
  );
}

export function PnLChart({
  data,
  comparisonData,
  comparisonPeriod,
  metric = 'revenue',
  density = 'regular',
  className = '',
  height,
}: {
  data: DashboardChartRow[];
  comparisonData?: DashboardChartRow[];
  comparisonPeriod?: { from: string; to: string } | null;
  metric?: DashboardMetricKey;
  density?: 'regular' | 'compact' | 'slim' | 'fill';
  className?: string;
  height?: number;
}) {
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const [chartSize, setChartSize] = useState({ width: 0, height: 0 });
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const config = METRIC_CONFIG[metric] ?? METRIC_CONFIG.revenue;

  const chartData = useMemo(() => {
    const previousRows = comparisonData ?? [];

    return (data ?? []).map((row, index) => {
      const previousRow = previousRows[index];
      const label = formatDayLabel(row.day_date);

      return {
        name: label,
        comparisonName: previousRow ? formatDayLabel(previousRow.day_date) : '',
        primary: parseNumber(row[config.key]),
        secondary: config.secondaryKey ? parseNumber(row[config.secondaryKey]) : null,
        comparison: previousRow ? parseNumber(previousRow[config.key]) : null,
      };
    });
  }, [comparisonData, config.key, config.secondaryKey, data]);

  const hasPrimaryValues = chartData.some((item) => item.primary !== null);
  const hasSecondaryValues = Boolean(config.secondaryKey) && chartData.some((item) => item.secondary !== null);
  const hasComparisonValues = chartData.some((item) => item.comparison !== null);
  const chartGeometry = useMemo(
    () => buildChartGeometry(chartData, config.valueType, chartSize.width, chartSize.height),
    [chartData, chartSize.height, chartSize.width, config.valueType],
  );
  const isCompactHeader = density === 'compact' || density === 'slim' || density === 'fill';
  const chartHeightClass = density === 'fill'
    ? (height ? 'min-h-0 flex-1' : 'h-[520px]')
    : density === 'slim'
    ? 'h-[218px]'
    : density === 'compact'
      ? 'h-[278px]'
      : 'h-[352px]';
  const rootClass = density === 'fill'
    ? 'dashboard-card flex min-h-[620px] flex-col overflow-hidden'
    : 'dashboard-card overflow-hidden';
  const activeRow = activeIndex !== null ? chartData[activeIndex] : null;
  const activePrimaryPoint = activeIndex !== null && chartGeometry
    ? chartGeometry.primaryPoints.find((point) => point.index === activeIndex) ?? null
    : null;
  const activeSecondaryPoint = activeIndex !== null && chartGeometry
    ? chartGeometry.secondaryPoints.find((point) => point.index === activeIndex) ?? null
    : null;
  const activeComparisonPoint = activeIndex !== null && chartGeometry
    ? chartGeometry.comparisonPoints.find((point) => point.index === activeIndex) ?? null
    : null;
  const activeX = activeIndex !== null && chartGeometry
    ? chartGeometry.plot.left + (chartData.length > 1 ? (chartGeometry.plot.width / (chartData.length - 1)) * activeIndex : 0)
    : null;
  const activeY = activePrimaryPoint?.y ?? activeComparisonPoint?.y ?? activeSecondaryPoint?.y ?? null;
  const tooltipLeft = activeX === null
    ? 0
    : Math.min(Math.max(activeX + 14, 8), Math.max(chartSize.width - 230, 8));
  const tooltipTop = activeY === null
    ? 0
    : Math.min(Math.max(activeY - 84, 8), Math.max(chartSize.height - 132, 8));
  const secondaryLabel = config.secondaryKey ? SECONDARY_LABELS[config.secondaryKey] ?? 'Контекст' : 'Контекст';

  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (!chartGeometry || chartData.length === 0) {
      return;
    }

    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0) {
      return;
    }

    const svgX = ((event.clientX - bounds.left) / bounds.width) * chartSize.width;
    const step = chartData.length > 1 ? chartGeometry.plot.width / (chartData.length - 1) : 0;
    const rawIndex = step > 0 ? Math.round((svgX - chartGeometry.plot.left) / step) : 0;
    const nextIndex = Math.min(Math.max(rawIndex, 0), chartData.length - 1);
    setActiveIndex(nextIndex);
  };

  useEffect(() => {
    const node = chartContainerRef.current;
    if (!node) {
      return;
    }

    const updateSize = () => {
      const nextWidth = node.clientWidth;
      const nextHeight = node.clientHeight;

      setChartSize((current) => {
        if (current.width === nextWidth && current.height === nextHeight) {
          return current;
        }

        return { width: nextWidth, height: nextHeight };
      });
    };

    updateSize();

    const observer = new ResizeObserver(() => {
      window.requestAnimationFrame(updateSize);
    });

    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div
      className={`${rootClass} ${className}`}
      style={density === 'fill' && height ? { height } : undefined}
    >
      <div className={`shrink-0 flex flex-col gap-3 px-5 pb-2 sm:flex-row sm:items-start sm:justify-between ${isCompactHeader ? 'pt-4' : 'pt-5'}`}>
        <div>
          <div className="group/help relative inline-flex items-center gap-2">
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-cyan-500 dark:text-cyan-300">
              Динамика
            </p>
            <CircleHelp className="h-3.5 w-3.5 text-muted-foreground/70" />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute left-0 top-6 z-50 w-[320px] rounded-2xl border border-border bg-popover p-3 text-[11px] leading-5 text-popover-foreground opacity-0 shadow-[var(--shadow-lg)] transition-opacity group-hover/help:opacity-100"
            >
              <p className="font-black text-cyan-500 dark:text-cyan-300">Как читать график</p>
              <p className="mt-1">
                Основная линия показывает выбранную KPI-карточку. Если у метрики есть связанная линия,
                она выводится рядом для сравнения: например, выручка против чистой прибыли.
              </p>
              <p className="mt-1 text-muted-foreground">
                Данные берутся из серверного агрегата `/api/views/dashboard` за активный период.
              </p>
            </div>
          </div>
          <h3 className={`mt-1 font-black tracking-tight text-foreground ${isCompactHeader ? 'text-lg' : 'text-xl'}`}>{config.title}</h3>
          <p className="mt-1 text-sm font-medium text-muted-foreground">{config.subtitle}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-subtle px-3 py-1 text-[11px] font-bold text-muted-foreground">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: config.color }} />
            Основная
          </span>
          {hasComparisonValues ? (
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-subtle px-3 py-1 text-[11px] font-bold text-muted-foreground">
              <span className="h-2 w-4 rounded-full border-t-2 border-dashed" style={{ borderColor: config.color }} />
              Прошлый период
            </span>
          ) : null}
          {hasSecondaryValues && config.secondaryColor ? (
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-subtle px-3 py-1 text-[11px] font-bold text-muted-foreground">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: config.secondaryColor }} />
              {secondaryLabel}
            </span>
          ) : null}
        </div>
      </div>
      <div ref={chartContainerRef} className={`relative w-full min-w-0 px-1 pb-2 ${chartHeightClass}`}>
        {chartSize.width > 0 && chartSize.height > 0 && hasPrimaryValues && chartGeometry ? (
          <>
            <svg
              width={chartSize.width}
              height={chartSize.height}
              viewBox={`0 0 ${chartSize.width} ${chartSize.height}`}
              role="img"
              aria-label={config.title}
              className="block h-full w-full touch-none overflow-visible"
              onPointerMove={handlePointerMove}
              onPointerLeave={() => setActiveIndex(null)}
            >
            <defs>
              <linearGradient id={config.gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={config.color} stopOpacity={0.25} />
                <stop offset="95%" stopColor={config.color} stopOpacity={0} />
              </linearGradient>
              {config.secondaryGradientId && config.secondaryColor ? (
                <linearGradient id={config.secondaryGradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={config.secondaryColor} stopOpacity={0.2} />
                  <stop offset="95%" stopColor={config.secondaryColor} stopOpacity={0} />
                </linearGradient>
              ) : null}
            </defs>
            {chartGeometry!.yTicks.map((tick) => (
              <g key={`y-${tick.label}-${tick.y}`}>
                <line
                  x1={chartGeometry!.plot.left}
                  x2={chartSize.width - chartGeometry!.plot.right}
                  y1={tick.y}
                  y2={tick.y}
                  stroke="var(--border)"
                  strokeDasharray="3 3"
                />
                <text
                  x={chartGeometry!.plot.left - 10}
                  y={tick.y + 4}
                  textAnchor="end"
                  fill="var(--muted-foreground)"
                  fontSize="11"
                  fontWeight="700"
                >
                  {tick.label}
                </text>
              </g>
            ))}
            {chartGeometry!.xLabels.map((tick) => (
              <text
                key={`x-${tick.label}-${tick.x}`}
                x={tick.x}
                y={chartSize.height - 5}
                textAnchor="middle"
                fill="var(--muted-foreground)"
                fontSize="11"
                fontWeight="700"
              >
                {tick.label}
              </text>
            ))}
            {chartGeometry!.primaryAreaPath ? (
              <path d={chartGeometry!.primaryAreaPath} fill={`url(#${config.gradientId})`} />
            ) : null}
            {chartGeometry!.secondaryAreaPath && config.secondaryGradientId ? (
              <path d={chartGeometry!.secondaryAreaPath} fill={`url(#${config.secondaryGradientId})`} />
            ) : null}
            {chartGeometry!.comparisonPath ? (
              <path
                d={chartGeometry!.comparisonPath}
                fill="none"
                stroke={config.color}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray="7 7"
                strokeOpacity="0.48"
              />
            ) : null}
            <path
              d={chartGeometry!.primaryPath}
              fill="none"
              stroke={config.color}
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {chartGeometry!.secondaryPath && config.secondaryColor ? (
              <path
                d={chartGeometry!.secondaryPath}
                fill="none"
                stroke={config.secondaryColor}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : null}
            {activeX !== null ? (
              <line
                x1={activeX}
                x2={activeX}
                y1={chartGeometry!.plot.top}
                y2={chartGeometry!.plot.top + chartGeometry!.plot.height}
                stroke="var(--muted-foreground)"
                strokeDasharray="4 4"
                strokeOpacity="0.42"
              />
            ) : null}
            {chartGeometry!.primaryPoints.map((point, index) => (
              <circle key={`primary-${index}-${point.x}`} cx={point.x} cy={point.y} r="3" fill={config.color}>
                <title>{`${point.label}: ${formatByType(point.value, config.valueType)}`}</title>
              </circle>
            ))}
            {chartGeometry!.comparisonPoints.map((point, index) => (
              <circle
                key={`comparison-${index}-${point.x}`}
                cx={point.x}
                cy={point.y}
                r="2.5"
                fill="var(--background)"
                stroke={config.color}
                strokeWidth="1.8"
                opacity="0.72"
              >
                <title>{`${point.label}: ${formatByType(point.value, config.valueType)}`}</title>
              </circle>
            ))}
            {chartGeometry!.secondaryPoints.map((point, index) => (
              <circle key={`secondary-${index}-${point.x}`} cx={point.x} cy={point.y} r="2.5" fill={config.secondaryColor ?? config.color}>
                <title>{`${point.label}: ${formatByType(point.value, config.valueType)}`}</title>
              </circle>
            ))}
            {activePrimaryPoint ? (
              <circle cx={activePrimaryPoint.x} cy={activePrimaryPoint.y} r="5.5" fill={config.color} stroke="var(--background)" strokeWidth="2" />
            ) : null}
            {activeComparisonPoint ? (
              <circle cx={activeComparisonPoint.x} cy={activeComparisonPoint.y} r="5" fill="var(--background)" stroke={config.color} strokeWidth="2.2" />
            ) : null}
            {activeSecondaryPoint && config.secondaryColor ? (
              <circle cx={activeSecondaryPoint.x} cy={activeSecondaryPoint.y} r="4.5" fill={config.secondaryColor} stroke="var(--background)" strokeWidth="2" />
            ) : null}
            <rect
              x={chartGeometry!.plot.left}
              y={chartGeometry!.plot.top}
              width={chartGeometry!.plot.width}
              height={chartGeometry!.plot.height}
              fill="transparent"
              pointerEvents="all"
            />
          </svg>
          {activeRow && activeX !== null && activeY !== null ? (
            <div
              className="pointer-events-none absolute z-20 w-[220px] rounded-xl border border-border bg-popover/95 px-3 py-2 text-xs text-popover-foreground shadow-[var(--shadow-lg)] backdrop-blur"
              style={{ left: tooltipLeft, top: tooltipTop }}
            >
              <div className="flex items-center justify-between gap-3">
                <p className="font-black text-foreground">{activeRow.name}</p>
                {comparisonPeriod ? (
                  <p className="text-[10px] font-bold text-muted-foreground">
                    пред. {comparisonPeriod.from} — {comparisonPeriod.to}
                  </p>
                ) : null}
              </div>
              {activeRow.primary !== null ? (
                <TooltipValueRow
                  color={config.color}
                  label="Основная"
                  value={formatByType(activeRow.primary, config.valueType)}
                />
              ) : null}
              {activeRow.comparison !== null ? (
                <TooltipValueRow
                  color={config.color}
                  label={`Прошлый период${activeRow.comparisonName ? ` · ${activeRow.comparisonName}` : ''}`}
                  value={formatByType(activeRow.comparison, config.valueType)}
                  dashed
                />
              ) : null}
              {activeRow.secondary !== null && hasSecondaryValues && config.secondaryColor ? (
                <TooltipValueRow
                  color={config.secondaryColor}
                  label={secondaryLabel}
                  value={formatByType(activeRow.secondary, config.valueType)}
                />
              ) : null}
            </div>
          ) : null}
        </>
        ) : (
          <div className="flex h-full w-full items-center justify-center px-6 text-center text-sm font-semibold text-muted-foreground">
            {chartSize.width > 0 && chartSize.height > 0
              ? 'Для выбранной метрики нет дневного ряда в текущем диапазоне.'
              : <div className="h-full w-full animate-pulse rounded-[1.5rem] bg-subtle" />}
          </div>
        )}
      </div>
    </div>
  );
}
