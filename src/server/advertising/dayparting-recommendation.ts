import type { AdvertisingHeatmapOptions, AdvertisingHeatmapPoint, AdvertisingHeatmapScope } from '@/server/analytics/advertising-heatmap';
import { getAdvertisingHeatmap } from '@/server/analytics/advertising-heatmap';

export type HeatmapDaypartingSlotReason =
  | 'profitable'
  | 'spend_without_revenue'
  | 'spend_without_orders'
  | 'high_acos'
  | 'insufficient_data';

export type HeatmapDaypartingSlot = {
  weekday: number;
  hour: number;
  enabled: boolean;
  reason: HeatmapDaypartingSlotReason;
  adSpend: number;
  revenue: number;
  orders: number;
  acosPct: number | null;
};

export type HeatmapDaypartingRecommendation = {
  generatedAt: string;
  status: 'ready' | 'insufficient_data';
  source: 'advertising_hourly_stats' | 'advertising_overview_daily';
  scope?: AdvertisingHeatmapScope;
  schedule: boolean[];
  activeHours: number;
  disabledHours: number;
  dataSlots: number;
  disabledSlots: HeatmapDaypartingSlot[];
  slots: HeatmapDaypartingSlot[];
  thresholds: {
    minSpendRub: number;
    noRevenueSpendRub: number;
    noOrderSpendRub: number;
    maxAcosPct: number;
    goodAcosPct: number;
  };
};

const DEFAULT_THRESHOLDS = {
  minSpendRub: 300,
  noRevenueSpendRub: 500,
  noOrderSpendRub: 700,
  maxAcosPct: 45,
  goodAcosPct: 25,
};

function slotIndex(weekday: number, hour: number) {
  return weekday * 24 + hour;
}

function isValidSlot(point: AdvertisingHeatmapPoint) {
  return point.hour !== null
    && point.weekday >= 0
    && point.weekday <= 6
    && point.hour >= 0
    && point.hour <= 23;
}

function classifySlot(
  point: AdvertisingHeatmapPoint,
  thresholds = DEFAULT_THRESHOLDS,
): Pick<HeatmapDaypartingSlot, 'enabled' | 'reason'> {
  if (point.revenue <= 0 && point.adSpend >= thresholds.noRevenueSpendRub) {
    return { enabled: false, reason: 'spend_without_revenue' };
  }

  if (point.orders <= 0 && point.adSpend >= thresholds.noOrderSpendRub) {
    return { enabled: false, reason: 'spend_without_orders' };
  }

  if (
    point.acosPct !== null
    && point.adSpend >= thresholds.minSpendRub
    && point.acosPct >= thresholds.maxAcosPct
  ) {
    return { enabled: false, reason: 'high_acos' };
  }

  if (point.orders > 0 && point.acosPct !== null && point.acosPct <= thresholds.goodAcosPct) {
    return { enabled: true, reason: 'profitable' };
  }

  return { enabled: true, reason: 'insufficient_data' };
}

export function buildHeatmapDaypartingRecommendation(input: {
  points: AdvertisingHeatmapPoint[];
  source: HeatmapDaypartingRecommendation['source'];
  scope?: AdvertisingHeatmapScope;
  generatedAt?: string;
  thresholds?: Partial<typeof DEFAULT_THRESHOLDS>;
}): HeatmapDaypartingRecommendation {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...input.thresholds };
  const schedule = Array.from({ length: 168 }, () => true);
  const slots: HeatmapDaypartingSlot[] = [];

  if (input.source !== 'advertising_hourly_stats') {
    return {
      generatedAt: input.generatedAt ?? new Date().toISOString(),
      status: 'insufficient_data',
      source: input.source,
      scope: input.scope,
      schedule,
      activeHours: 168,
      disabledHours: 0,
      dataSlots: 0,
      disabledSlots: [],
      slots: [],
      thresholds,
    };
  }

  for (const point of input.points) {
    if (!isValidSlot(point)) {
      continue;
    }

    const weekday = point.weekday;
    const hour = point.hour ?? 0;
    const decision = classifySlot(point, thresholds);
    schedule[slotIndex(weekday, hour)] = decision.enabled;
    slots.push({
      weekday,
      hour,
      enabled: decision.enabled,
      reason: decision.reason,
      adSpend: point.adSpend,
      revenue: point.revenue,
      orders: point.orders,
      acosPct: point.acosPct,
    });
  }

  const disabledSlots = slots.filter((slot) => !slot.enabled);
  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    status: slots.length > 0 ? 'ready' : 'insufficient_data',
    source: input.source,
    scope: input.scope,
    schedule,
    activeHours: schedule.filter(Boolean).length,
    disabledHours: schedule.filter((item) => !item).length,
    dataSlots: slots.length,
    disabledSlots,
    slots,
    thresholds,
  };
}

export async function getHeatmapDaypartingRecommendation(
  tenantId: string,
  dateFrom: Date,
  dateTo: Date,
  options?: AdvertisingHeatmapOptions,
) {
  const heatmap = await getAdvertisingHeatmap(tenantId, dateFrom, dateTo, options);
  return buildHeatmapDaypartingRecommendation({
    points: heatmap.points,
    source: heatmap.source,
    scope: heatmap.scope,
  });
}
