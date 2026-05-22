import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mocks ────────────────────────────────────────────────────────────────────

const mockListTenantsForDigest = vi.fn();
const mockBuildAndSendDigestForTenant = vi.fn();

vi.mock('@/server/advertising/advisor-digest', () => ({
  listTenantsForDigest: (...args: unknown[]) => mockListTenantsForDigest(...args),
  buildAndSendDigestForTenant: (...args: unknown[]) => mockBuildAndSendDigestForTenant(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
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

import { advertisingAdvisorDigestJob } from './advertising-advisor-digest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const handler = (advertisingAdvisorDigestJob as unknown as { _handler: (...args: unknown[]) => Promise<any> })._handler;

// ── helpers ───────────────────────────────────────────────────────────────────

function makeStep() {
  return {
    run: vi.fn(async (_name: string, fn: () => unknown) => fn()),
    sendEvent: vi.fn(),
    sleep: vi.fn(),
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('advertisingAdvisorDigestJob handler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns totalTenants=0, sent=0, skipped=0 when tenant list is empty', async () => {
    mockListTenantsForDigest.mockResolvedValue([]);

    const step = makeStep();
    const result = await handler({ step });

    expect(result).toEqual({ totalTenants: 0, sent: 0, skipped: 0 });
    expect(mockBuildAndSendDigestForTenant).not.toHaveBeenCalled();
  });

  it('increments sent when digest is sent successfully', async () => {
    mockListTenantsForDigest.mockResolvedValue(['t1', 't2']);
    mockBuildAndSendDigestForTenant.mockResolvedValue({ status: 'sent', totalNmIds: 5 });

    const step = makeStep();
    const result = await handler({ step });

    expect(result.totalTenants).toBe(2);
    expect(result.sent).toBe(2);
    expect(result.skipped).toBe(0);
  });

  it('increments skipped when digest status is skipped', async () => {
    mockListTenantsForDigest.mockResolvedValue(['t1']);
    mockBuildAndSendDigestForTenant.mockResolvedValue({ status: 'skipped', reason: 'no_changes' });

    const step = makeStep();
    const result = await handler({ step });

    expect(result.sent).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('treats thrown error as skipped (catches internally)', async () => {
    mockListTenantsForDigest.mockResolvedValue(['t1']);
    mockBuildAndSendDigestForTenant.mockRejectedValue(new Error('Telegram unreachable'));

    const step = makeStep();
    const result = await handler({ step });

    // The job catches and returns { status: 'skipped', reason: 'send_failed' }
    expect(result.sent).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('handles mixed results: some sent, some skipped', async () => {
    mockListTenantsForDigest.mockResolvedValue(['t1', 't2', 't3']);
    mockBuildAndSendDigestForTenant
      .mockResolvedValueOnce({ status: 'sent', totalNmIds: 3 })
      .mockResolvedValueOnce({ status: 'skipped', reason: 'no_chat_id' })
      .mockRejectedValueOnce(new Error('timeout'));

    const step = makeStep();
    const result = await handler({ step });

    expect(result.totalTenants).toBe(3);
    expect(result.sent).toBe(1);
    expect(result.skipped).toBe(2);
  });

  it('calls listTenantsForDigest inside step.run named list-tenants', async () => {
    mockListTenantsForDigest.mockResolvedValue([]);

    const step = makeStep();
    await handler({ step });

    expect(step.run).toHaveBeenCalledWith('list-tenants', expect.any(Function));
  });
});
