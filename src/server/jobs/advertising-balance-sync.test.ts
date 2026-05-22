import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mocks ────────────────────────────────────────────────────────────────────

const mockDbSelect = vi.fn();
vi.mock('@/lib/db', () => {
  const selectBuilder = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockImplementation(function (this: unknown) {
      return mockDbSelect();
    }),
  };
  return {
    db: {
      select: vi.fn(() => selectBuilder),
    },
  };
});

// Drizzle helpers referenced in the job
vi.mock('drizzle-orm', () => ({
  ne: vi.fn((_col: unknown, _val: unknown) => ({ type: 'ne' })),
}));

vi.mock('@/lib/db/schema', () => ({
  tenants: { id: 'id', wbTokenHealthStatus: 'wbTokenHealthStatus' },
}));

const mockSyncAdvertisingBalance = vi.fn();
vi.mock('@/server/advertising/balance', () => ({
  syncAdvertisingBalance: (...args: unknown[]) => mockSyncAdvertisingBalance(...args),
}));

vi.mock('@/inngest/client', () => ({
  inngest: {
    createFunction: (_opts: unknown, handler: unknown) => ({ _handler: handler }),
  },
}));

vi.mock('@/inngest/on-failure', () => ({
  handleInngestFailure: vi.fn(),
}));

// ── import after mocks ────────────────────────────────────────────────────────

import { advertisingBalanceSyncJob } from './advertising-balance-sync';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeStep() {
  return {
    run: vi.fn(async (_name: string, fn: () => unknown) => {
      // First call returns tenants list; subsequent calls execute per-tenant fn
      return fn();
    }),
    sendEvent: vi.fn(),
    sleep: vi.fn(),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const handler = (advertisingBalanceSyncJob as unknown as { _handler: (...args: unknown[]) => Promise<any> })._handler;

// ── tests ─────────────────────────────────────────────────────────────────────

describe('advertisingBalanceSyncJob handler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns synced=0, skipped=0 when no active tenants', async () => {
    mockDbSelect.mockResolvedValue([]);
    mockSyncAdvertisingBalance.mockResolvedValue(undefined);

    const step = makeStep();
    const result = await handler({ step });

    expect(result).toEqual({ synced: 0, skipped: 0 });
    expect(mockSyncAdvertisingBalance).not.toHaveBeenCalled();
  });

  it('increments synced count for each successful tenant', async () => {
    const tenants = [{ id: 't1' }, { id: 't2' }];
    mockDbSelect.mockResolvedValue(tenants);
    mockSyncAdvertisingBalance.mockResolvedValue(undefined);

    const step = makeStep();
    const result = await handler({ step });

    expect(result.synced).toBe(2);
    expect(result.skipped).toBe(0);
  });

  it('increments skipped count when syncAdvertisingBalance throws', async () => {
    const tenants = [{ id: 't1' }, { id: 't2' }];
    mockDbSelect.mockResolvedValue(tenants);
    // First tenant succeeds, second throws
    mockSyncAdvertisingBalance
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('balance API error'));

    const step = makeStep();
    const result = await handler({ step });

    expect(result.synced).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it('calls syncAdvertisingBalance with the tenant id', async () => {
    const tenants = [{ id: 'tenant-abc' }];
    mockDbSelect.mockResolvedValue(tenants);
    mockSyncAdvertisingBalance.mockResolvedValue(undefined);

    const step = makeStep();
    await handler({ step });

    expect(mockSyncAdvertisingBalance).toHaveBeenCalledWith('tenant-abc');
  });

  it('processes all tenants even if DB returns many entries', async () => {
    const tenants = Array.from({ length: 5 }, (_, i) => ({ id: `tenant-${i}` }));
    mockDbSelect.mockResolvedValue(tenants);
    mockSyncAdvertisingBalance.mockResolvedValue(undefined);

    const step = makeStep();
    const result = await handler({ step });

    expect(result.synced).toBe(5);
    expect(result.skipped).toBe(0);
    expect(mockSyncAdvertisingBalance).toHaveBeenCalledTimes(5);
  });
});
