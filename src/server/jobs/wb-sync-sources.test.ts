import { describe, it, expect } from 'vitest';

import {
  WB_SYNC_SOURCE_SEQUENCE,
  WB_SYNC_FAST_SOURCES,
  WB_SYNC_MEDIUM_SOURCES,
  WB_SYNC_PRICE_SNAPSHOT_SOURCES,
  WB_SYNC_WEEKLY_FINANCE_RETRY_SOURCES,
  WB_SYNC_NIGHTLY_SOURCES,
} from './wb-sync-sources';

describe('WB_SYNC_SOURCE_SEQUENCE', () => {
  it('contains all expected source names', () => {
    expect(WB_SYNC_SOURCE_SEQUENCE).toContain('orders');
    expect(WB_SYNC_SOURCE_SEQUENCE).toContain('sales');
    expect(WB_SYNC_SOURCE_SEQUENCE).toContain('products');
    expect(WB_SYNC_SOURCE_SEQUENCE).toContain('ads');
    expect(WB_SYNC_SOURCE_SEQUENCE).toContain('realization_reports');
  });

  it('has no duplicate sources', () => {
    const unique = new Set(WB_SYNC_SOURCE_SEQUENCE);
    expect(unique.size).toBe(WB_SYNC_SOURCE_SEQUENCE.length);
  });

  it('has the correct total count of 18 sources', () => {
    expect(WB_SYNC_SOURCE_SEQUENCE).toHaveLength(18);
  });

  it('contains warehouse_remains for WB-side per-SKU volume', () => {
    expect(WB_SYNC_SOURCE_SEQUENCE).toContain('warehouse_remains');
  });
});

describe('WB_SYNC_FAST_SOURCES', () => {
  it('contains only high-priority sources', () => {
    expect(WB_SYNC_FAST_SOURCES).toContain('orders');
    expect(WB_SYNC_FAST_SOURCES).toContain('sales');
  });

  it('excludes ads to reduce daytime advertising sync pressure', () => {
    // Deliberately removed in commit 3d69325 "Reduce daytime advertising sync pressure".
    // Ads sync moved to lower frequency to ease load on the WB ads API during the day.
    expect(WB_SYNC_FAST_SOURCES).not.toContain('ads');
  });

  it('is a strict subset of WB_SYNC_SOURCE_SEQUENCE', () => {
    for (const source of WB_SYNC_FAST_SOURCES) {
      expect(WB_SYNC_SOURCE_SEQUENCE).toContain(source);
    }
  });

  it('does not include slow sources like realization_reports', () => {
    expect(WB_SYNC_FAST_SOURCES).not.toContain('realization_reports');
    expect(WB_SYNC_FAST_SOURCES).not.toContain('tariffs');
  });
});

describe('WB_SYNC_MEDIUM_SOURCES', () => {
  it('contains mid-tier sources', () => {
    expect(WB_SYNC_MEDIUM_SOURCES).toContain('stocks');
    expect(WB_SYNC_MEDIUM_SOURCES).toContain('prices');
    expect(WB_SYNC_MEDIUM_SOURCES).toContain('tariffs');
  });

  it('is a strict subset of WB_SYNC_SOURCE_SEQUENCE', () => {
    for (const source of WB_SYNC_MEDIUM_SOURCES) {
      expect(WB_SYNC_SOURCE_SEQUENCE).toContain(source);
    }
  });

  it('has no overlap with WB_SYNC_FAST_SOURCES', () => {
    const fastSet = new Set(WB_SYNC_FAST_SOURCES);
    for (const source of WB_SYNC_MEDIUM_SOURCES) {
      expect(fastSet.has(source)).toBe(false);
    }
  });
});

describe('WB_SYNC_NIGHTLY_SOURCES', () => {
  it('equals the full sequence', () => {
    expect(WB_SYNC_NIGHTLY_SOURCES).toEqual(WB_SYNC_SOURCE_SEQUENCE);
  });

  it('contains all fast and medium sources', () => {
    const nightlySet = new Set(WB_SYNC_NIGHTLY_SOURCES);
    for (const src of WB_SYNC_FAST_SOURCES) {
      expect(nightlySet.has(src)).toBe(true);
    }
    for (const src of WB_SYNC_MEDIUM_SOURCES) {
      expect(nightlySet.has(src)).toBe(true);
    }
  });
});

describe('WB_SYNC_PRICE_SNAPSHOT_SOURCES', () => {
  it('only fetches prices for the SPP history job', () => {
    expect(WB_SYNC_PRICE_SNAPSHOT_SOURCES).toEqual(['prices']);
  });
});

describe('WB_SYNC_WEEKLY_FINANCE_RETRY_SOURCES', () => {
  it('only retries weekly realization reports', () => {
    expect(WB_SYNC_WEEKLY_FINANCE_RETRY_SOURCES).toEqual(['realization_reports']);
  });
});
