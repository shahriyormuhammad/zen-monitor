import { describe, expect, it } from 'vitest';

import { computeAdvertisingHourlyDelta } from './hourly-stats';

describe('computeAdvertisingHourlyDelta', () => {
  it('does not assign historical cumulative spend to the first observed hour', () => {
    expect(computeAdvertisingHourlyDelta({
      adSpend: 1200,
      views: 1000,
      clicks: 40,
      orderCount: 3,
      orderSum: 5000,
    }, null)).toEqual({
      firstSnapshot: true,
      adSpend: 0,
      views: 0,
      clicks: 0,
      orderCount: 0,
      orderSum: 0,
    });
  });

  it('stores only positive deltas between cumulative snapshots', () => {
    expect(computeAdvertisingHourlyDelta({
      adSpend: 1350.49,
      views: 1200,
      clicks: 45,
      orderCount: 4,
      orderSum: 6200.3,
    }, {
      adSpend: 1200.11,
      views: 1000,
      clicks: 40,
      orderCount: 3,
      orderSum: 5000,
    })).toEqual({
      firstSnapshot: false,
      adSpend: 150.38,
      views: 200,
      clicks: 5,
      orderCount: 1,
      orderSum: 1200.3,
    });
  });

  it('clamps negative revisions to zero', () => {
    expect(computeAdvertisingHourlyDelta({
      adSpend: 900,
      views: 900,
      clicks: 30,
      orderCount: 2,
      orderSum: 4000,
    }, {
      adSpend: 1000,
      views: 950,
      clicks: 35,
      orderCount: 3,
      orderSum: 4500,
    })).toMatchObject({
      firstSnapshot: false,
      adSpend: 0,
      views: 0,
      clicks: 0,
      orderCount: 0,
      orderSum: 0,
    });
  });
});
