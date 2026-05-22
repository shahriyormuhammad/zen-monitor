import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mocks ────────────────────────────────────────────────────────────────────

const mockRunRouteScanForAllTenants = vi.fn();
vi.mock('@/server/redistribution/route-scan', () => ({
  runRouteScanForAllTenants: (...args: unknown[]) => mockRunRouteScanForAllTenants(...args),
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

import { redistributionRouteScanJob } from './redistribution-route-scan';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeStep() {
  return {
    run: vi.fn((_name: string, fn: () => unknown) => fn()),
    sendEvent: vi.fn(),
    sleep: vi.fn(),
  };
}

// The job is created via inngest.createFunction so _handler holds the fn.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const handler = (redistributionRouteScanJob as unknown as { _handler: (...args: unknown[]) => Promise<any> })._handler;

// ── tests ─────────────────────────────────────────────────────────────────────

describe('redistributionRouteScanJob handler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls runRouteScanForAllTenants and returns its result merged with cron', async () => {
    const scanResult = {
      results: [{ tenantId: 't1', ok: true, message: 'ok', discoveredWarehouses: 3 }],
    };
    mockRunRouteScanForAllTenants.mockResolvedValue(scanResult);

    const step = makeStep();
    const result = await handler({ step });

    expect(mockRunRouteScanForAllTenants).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      cron: expect.any(String),
      results: scanResult.results,
    });
  });

  it('returns the cron field in the result', async () => {
    mockRunRouteScanForAllTenants.mockResolvedValue({ results: [] });
    const step = makeStep();
    const result = await handler({ step });

    expect(typeof result.cron).toBe('string');
    expect(result.cron.length).toBeGreaterThan(0);
  });

  it('propagates errors from runRouteScanForAllTenants', async () => {
    mockRunRouteScanForAllTenants.mockRejectedValue(new Error('DB down'));
    const step = makeStep();

    await expect(handler({ step })).rejects.toThrow('DB down');
  });

  it('wraps scan inside step.run', async () => {
    mockRunRouteScanForAllTenants.mockResolvedValue({ results: [] });
    const step = makeStep();

    await handler({ step });

    expect(step.run).toHaveBeenCalledWith(
      'redistribution-route-scan-all-tenants',
      expect.any(Function),
    );
  });
});
