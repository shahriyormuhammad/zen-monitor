'use client';

/**
 * 4 charts that accompany the weekly plan, rendered with Recharts.
 *
 *   - OrdersChart      → план / факт по неделям (area + dashed line)
 *   - StockChart       → остаток на складе (bar, цвет — по дням запаса)
 *   - ProfitChart      → прибыль накопленная + кассовая (две линии)
 *   - DRRChart         → ДРР % с цель / предел линиями
 *
 * All four share a common color palette and tiny defaults so callers can
 * just <OrdersChart rows={rows} />.
 */

import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart,
  Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip,
  XAxis, YAxis,
} from 'recharts';
import type { WeeklyRow } from './WeeklyPlanTable';

const EMERALD = '#10b981';
const SLATE = '#0f172a';
const CYAN = '#06b6d4';
const ORANGE = '#f97316';
const AMBER = '#f59e0b';
const RED = '#ef4444';

/** Reused tick style for all chart axes. Plain object to satisfy recharts SVG props. */
const tickProps: { fontSize: number; fill: string } = { fontSize: 10, fill: '#64748b' };

function chartData(rows: WeeklyRow[]) {
  return rows.map((r) => ({
    week: `W${r.wk}`,
    plan: r.planOrders,
    fact: r.factOrders ?? null,
    stock: r.stockPlan,
    stockDays: r.stockDays,
    cumProfit: r.cumProfit,
    cumCash: r.cumCash,
    drr: r.drrPlan,
    season: r.seasonCoef * 100,
  }));
}

/* ── 1) Orders plan vs fact ────────────────────────────── */

export function OrdersChart({ rows, height = 180 }: { rows: WeeklyRow[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={chartData(rows)} margin={{ top: 6, right: 10, left: -16, bottom: 0 }}>
        <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
        <XAxis dataKey="week" tick={tickProps} interval={5} />
        <YAxis tick={tickProps} width={36} />
        <Tooltip cursor={{ stroke: EMERALD }} />
        <Area type="monotone" dataKey="plan" name="План" stroke={EMERALD} fill={EMERALD} fillOpacity={0.18} strokeWidth={2} />
        <Line type="monotone" dataKey="fact" name="Факт" stroke={SLATE} strokeWidth={1.6} strokeDasharray="4 3" dot={false} />
        <Legend verticalAlign="bottom" iconType="square" wrapperStyle={{ fontSize: 10 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/* ── 2) Stock on warehouse ─────────────────────────────── */

export function StockChart({ rows, height = 180 }: { rows: WeeklyRow[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={chartData(rows)} margin={{ top: 6, right: 10, left: -16, bottom: 0 }}>
        <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
        <XAxis dataKey="week" tick={tickProps} interval={5} />
        <YAxis tick={tickProps} width={36} />
        <Tooltip />
        <Bar dataKey="stock" name="Остаток" radius={[3, 3, 0, 0]}>
          {chartData(rows).map((d, i) => {
            const tone = d.stockDays != null && d.stockDays <= 7 ? RED
              : d.stockDays != null && d.stockDays <= 14 ? AMBER
                : EMERALD;
            return <Cell key={i} fill={tone} fillOpacity={0.7} />;
          })}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ── 3) Profit cumulative + cash ────────────────────────── */

export function ProfitChart({ rows, height = 180 }: { rows: WeeklyRow[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={chartData(rows)} margin={{ top: 6, right: 10, left: -16, bottom: 0 }}>
        <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
        <XAxis dataKey="week" tick={tickProps} interval={5} />
        <YAxis tick={tickProps} width={48} tickFormatter={(v) => Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}K` : `${v}`} />
        <Tooltip />
        <Area type="monotone" dataKey="cumProfit" name="Прибыль накоп." stroke={EMERALD} fill={EMERALD} fillOpacity={0.14} strokeWidth={2} />
        <Line type="monotone" dataKey="cumCash" name="Кассовая" stroke={SLATE} strokeWidth={1.6} strokeDasharray="4 3" dot={false} />
        <Legend verticalAlign="bottom" iconType="square" wrapperStyle={{ fontSize: 10 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/* ── 4) DRR % with target / limit ───────────────────────── */

export function DRRChart({
  rows, target = 12, limit = 18, height = 180,
}: { rows: WeeklyRow[]; target?: number; limit?: number; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={chartData(rows)} margin={{ top: 6, right: 10, left: -16, bottom: 0 }}>
        <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
        <XAxis dataKey="week" tick={tickProps} interval={5} />
        <YAxis tick={tickProps} width={36} domain={[0, 20]} />
        <Tooltip />
        <ReferenceLine y={target} stroke={EMERALD} strokeDasharray="4 3" label={{ value: 'Цель', position: 'insideRight', fontSize: 10, fill: EMERALD }} />
        <ReferenceLine y={limit} stroke={RED} strokeDasharray="4 3" label={{ value: 'Предел', position: 'insideRight', fontSize: 10, fill: RED }} />
        <Line type="monotone" dataKey="drr" name="ДРР" stroke={ORANGE} strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/* ── 5) Seasonality ─────────────────────────────────────── */

export function SeasonalityChart({ rows, height = 180 }: { rows: WeeklyRow[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={chartData(rows)} margin={{ top: 6, right: 10, left: -16, bottom: 0 }}>
        <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
        <XAxis dataKey="week" tick={tickProps} interval={5} />
        <YAxis tick={tickProps} width={36} domain={[0, 170]} tickFormatter={(v) => `${v}%`} />
        <Tooltip formatter={(value) => (typeof value === 'number' ? `${value.toFixed(0)}%` : `${value}`)} />
        <Area type="monotone" dataKey="season" name="Коэф сезона" stroke={CYAN} fill={CYAN} fillOpacity={0.16} strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
