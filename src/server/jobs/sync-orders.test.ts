import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mocks ────────────────────────────────────────────────────────────────────
// All vi.mock factories must be self-contained (no closures over outer `let/const`)
// because Vitest hoists them to the top of the file.

vi.mock('@/lib/db', () => {
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  const insert = vi.fn().mockReturnValue({ values });

  const where = vi.fn().mockImplementation(function (this: unknown) {
    return (global as Record<string, unknown>).__mockDbSelectResult__;
  });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });

  const mockDb = { select, insert };
  (global as Record<string, unknown>).__mockDb__ = { select, insert, _onConflictDoUpdate: onConflictDoUpdate, _values: values, _where: where };
  return {
    db: mockDb,
    withTenantContext: vi.fn(
      async (_db: unknown, _tenantId: string, fn: (tx: unknown) => Promise<unknown>) => fn(mockDb),
    ),
  };
});

vi.mock('@/lib/db/schema', () => ({
  tenants: { id: 'id', wbTokenHealthStatus: 'wbTokenHealthStatus' },
  rawApiOrders: { tenantId: 'tenantId', srid: 'srid', isCancel: 'isCancel', totalPrice: 'totalPrice' },
}));

vi.mock('drizzle-orm', () => ({
  sql: vi.fn(() => ({ type: 'sql' })),
  ne: vi.fn(() => ({ type: 'ne' })),
}));

vi.mock('@/lib/wb-api', () => ({
  wbApi: {
    getOrders: vi.fn(),
  },
}));

vi.mock('@/lib/encryption', () => ({
  decryptIfNeeded: vi.fn((v: string) => v),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock('date-fns', async () => {
  const actual = await vi.importActual<typeof import('date-fns')>('date-fns');
  return {
    ...actual,
    format: vi.fn(() => '2026-04-01'),
    subDays: vi.fn(() => new Date('2026-03-18')),
  };
});

vi.mock('@/inngest/client', () => ({
  inngest: {
    createFunction: (_opts: unknown, handler: unknown) => ({ _handler: handler }),
  },
}));

vi.mock('@/inngest/on-failure', () => ({
  handleInngestFailure: vi.fn(),
}));

// ── import after mocks ────────────────────────────────────────────────────────

import { syncOrdersJob } from './sync-orders';
import { wbApi } from '@/lib/wb-api';
import { decryptIfNeeded } from '@/lib/encryption';

const handler = (syncOrdersJob as unknown as { _handler: (...args: unknown[]) => unknown })._handler;

// ── helpers ───────────────────────────────────────────────────────────────────

function setDbTenants(tenants: unknown[]) {
  (global as Record<string, unknown>).__mockDbSelectResult__ = Promise.resolve(tenants);
}

function getDbMock() {
  return (global as Record<string, unknown>).__mockDb__ as {
    select: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    _onConflictDoUpdate: ReturnType<typeof vi.fn>;
    _values: ReturnType<typeof vi.fn>;
    _where: ReturnType<typeof vi.fn>;
  };
}

function makeStep() {
  return {
    run: vi.fn(async (_name: string, fn: () => unknown) => fn()),
    sendEvent: vi.fn(),
    sleep: vi.fn(),
  };
}

function makeOrder(srid: string) {
  return { srid, nmId: 100, date: '2026-04-01T00:00:00Z', totalPrice: 999, isCancel: false };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('syncOrdersJob handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDbMock()._onConflictDoUpdate.mockResolvedValue(undefined);
  });

  it('skips tenants without wbApiToken', async () => {
    setDbTenants([{ id: 't1', wbApiToken: null }]);

    const step = makeStep();
    await handler({ step });

    expect(wbApi.getOrders).not.toHaveBeenCalled();
  });

  it('calls wbApi.getOrders and inserts rows for a tenant with a token', async () => {
    setDbTenants([{ id: 't1', wbApiToken: 'plain-token' }]);
    vi.mocked(wbApi.getOrders).mockResolvedValue([makeOrder('srid-1'), makeOrder('srid-2')] as never);
    vi.mocked(decryptIfNeeded).mockReturnValue('plain-token');

    const step = makeStep();
    await handler({ step });

    expect(wbApi.getOrders).toHaveBeenCalledWith('plain-token', '2026-04-01', '2026-04-01');
    expect(getDbMock()._values).toHaveBeenCalled();
    expect(getDbMock()._onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ target: ['tenantId', 'srid'] }),
    );
  });

  it('does not insert when getOrders returns empty array', async () => {
    setDbTenants([{ id: 't1', wbApiToken: 'token' }]);
    vi.mocked(wbApi.getOrders).mockResolvedValue([] as never);

    const step = makeStep();
    await handler({ step });

    expect(getDbMock()._values).not.toHaveBeenCalled();
  });

  it('re-throws error from getOrders so Inngest can retry', async () => {
    setDbTenants([{ id: 't1', wbApiToken: 'token' }]);
    vi.mocked(wbApi.getOrders).mockRejectedValue(new Error('WB 503') as never);

    const step = makeStep();
    await expect(handler({ step })).rejects.toThrow('WB 503');
  });

  it('processes multiple tenants independently', async () => {
    setDbTenants([
      { id: 't1', wbApiToken: 'token-1' },
      { id: 't2', wbApiToken: 'token-2' },
    ]);
    vi.mocked(wbApi.getOrders).mockResolvedValue([makeOrder('srid-a')] as never);

    const step = makeStep();
    await handler({ step });

    expect(wbApi.getOrders).toHaveBeenCalledTimes(2);
  });

  it('chunks 2500 orders into two inserts (2000 + 500)', async () => {
    const bigOrders = Array.from({ length: 2500 }, (_, i) => makeOrder(`srid-${i}`));
    setDbTenants([{ id: 't1', wbApiToken: 'tok' }]);
    vi.mocked(wbApi.getOrders).mockResolvedValue(bigOrders as never);

    const step = makeStep();
    await handler({ step });

    const db = getDbMock();
    expect(db._values).toHaveBeenCalledTimes(2);
    const first = db._values.mock.calls[0]![0] as unknown[];
    const second = db._values.mock.calls[1]![0] as unknown[];
    expect(first).toHaveLength(2000);
    expect(second).toHaveLength(500);
  });

  it('passes ne(wbTokenHealthStatus, "invalid") filter to the query', async () => {
    setDbTenants([]);

    const step = makeStep();
    await handler({ step });

    const { ne: neMock } = await import('drizzle-orm');
    expect(neMock).toHaveBeenCalledWith(
      expect.anything(),
      'invalid',
    );
    expect(getDbMock()._where).toHaveBeenCalled();
  });
});
