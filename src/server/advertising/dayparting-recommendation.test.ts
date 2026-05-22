import { describe, expect, it } from 'vitest';

import type { AdvertisingHeatmapPoint } from '@/server/analytics/advertising-heatmap';
import { buildHeatmapDaypartingRecommendation } from './dayparting-recommendation';

function point(partial: Partial<AdvertisingHeatmapPoint>): AdvertisingHeatmapPoint {
  return {
    weekday: 0,
    hour: 10,
    day: null,
    adSpend: 0,
    revenue: 0,
    views: 0,
    clicks: 0,
    orders: 0,
    acosPct: null,
    cpc: null,
    ctrPct: null,
    ...partial,
  };
}

describe('buildHeatmapDaypartingRecommendation', () => {
  it('keeps unknown slots active and disables only bad hourly slots', () => {
    const result = buildHeatmapDaypartingRecommendation({
      source: 'advertising_hourly_stats',
      points: [
        point({ weekday: 0, hour: 10, adSpend: 600, revenue: 0, orders: 0 }),
        point({ weekday: 0, hour: 11, adSpend: 500, revenue: 3000, orders: 4, acosPct: 16.67 }),
      ],
    });

    expect(result.status).toBe('ready');
    expect(result.schedule[10]).toBe(false);
    expect(result.schedule[11]).toBe(true);
    expect(result.activeHours).toBe(167);
    expect(result.disabledSlots[0]).toMatchObject({
      weekday: 0,
      hour: 10,
      reason: 'spend_without_revenue',
    });
  });

  it('disables high ACOS slots with enough spend', () => {
    const result = buildHeatmapDaypartingRecommendation({
      source: 'advertising_hourly_stats',
      points: [
        point({ weekday: 2, hour: 18, adSpend: 400, revenue: 700, orders: 1, acosPct: 57.14 }),
      ],
    });

    expect(result.schedule[2 * 24 + 18]).toBe(false);
    expect(result.disabledSlots[0]?.reason).toBe('high_acos');
  });

  it('does not build hourly rules from daily fallback', () => {
    const result = buildHeatmapDaypartingRecommendation({
      source: 'advertising_overview_daily',
      points: [
        point({ hour: null, day: '2026-05-12', adSpend: 1000, revenue: 0 }),
      ],
    });

    expect(result.status).toBe('insufficient_data');
    expect(result.activeHours).toBe(168);
    expect(result.disabledHours).toBe(0);
  });
});
