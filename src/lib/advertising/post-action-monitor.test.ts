import { describe, expect, it } from 'vitest';

import {
  evaluateAdvertisingPostAction,
  type AdvertisingPostActionStats,
} from './post-action-monitor';

const emptyScope = {
  type: 'group' as const,
  nmIds: [101, 102],
  groupId: 'group-1',
  groupName: 'Малышки',
};

function stats(input: Partial<AdvertisingPostActionStats>): AdvertisingPostActionStats {
  return {
    adSpend: input.adSpend ?? 0,
    revenue: input.revenue ?? 0,
    orders: input.orders ?? 0,
    clicks: input.clicks ?? 0,
    views: input.views ?? 0,
    cpcRub: input.cpcRub ?? null,
    cpoRub: input.cpoRub ?? null,
    drrPct: input.drrPct ?? null,
    roas: input.roas ?? null,
    rows: input.rows ?? 1,
  };
}

describe('evaluateAdvertisingPostAction', () => {
  it('keeps a lowered bid when orders hold and spend falls', () => {
    const report = evaluateAdvertisingPostAction({
      changeId: 'change-1',
      checkedAt: new Date('2026-05-14T10:00:00.000Z'),
      horizonHours: 6,
      source: 'auto',
      previousBid: 500,
      nextBid: 450,
      scope: emptyScope,
      before: stats({ adSpend: 900, revenue: 6000, orders: 6, clicks: 120 }),
      after: stats({ adSpend: 650, revenue: 6200, orders: 6, clicks: 110 }),
      autoRollbackEligible: true,
    });

    expect(report.direction).toBe('lower');
    expect(report.outcome).toBe('improved');
    expect(report.recommendation).toBe('keep');
    expect(report.delta.adSpend).toBe(-250);
    expect(report.summary).toContain('экономия');
  });

  it('asks for rollback when a raised bid spends more without extra orders', () => {
    const report = evaluateAdvertisingPostAction({
      changeId: 'change-2',
      checkedAt: new Date('2026-05-14T10:00:00.000Z'),
      horizonHours: 6,
      source: 'auto',
      previousBid: 500,
      nextBid: 550,
      scope: emptyScope,
      before: stats({ adSpend: 600, revenue: 5000, orders: 5, clicks: 100 }),
      after: stats({ adSpend: 950, revenue: 4900, orders: 5, clicks: 145 }),
      autoRollbackEligible: true,
    });

    expect(report.direction).toBe('raise');
    expect(report.outcome).toBe('worse');
    expect(report.recommendation).toBe('rollback');
    expect(report.rollback.status).toBe('skipped');
  });

  it('marks empty before and after windows as insufficient data', () => {
    const report = evaluateAdvertisingPostAction({
      changeId: 'change-3',
      checkedAt: new Date('2026-05-14T10:00:00.000Z'),
      horizonHours: 2,
      source: 'manual',
      previousBid: 500,
      nextBid: 550,
      scope: emptyScope,
      before: stats({ rows: 0 }),
      after: stats({ rows: 0 }),
      autoRollbackEligible: false,
    });

    expect(report.outcome).toBe('insufficient_data');
    expect(report.recommendation).toBe('watch');
  });
});
