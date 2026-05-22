import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mocks ────────────────────────────────────────────────────────────────────

const mockRunDueAdvertisingAutoBidStrategies = vi.fn();
const mockRunDueAdvertisingPacingRules = vi.fn();
const mockRunDueAdvertisingPortfolios = vi.fn();

vi.mock('@/server/advertising/workspace', () => ({
  runDueAdvertisingAutoBidStrategies: (...args: unknown[]) =>
    mockRunDueAdvertisingAutoBidStrategies(...args),
}));

vi.mock('@/server/advertising/pacing-portfolios', () => ({
  runDueAdvertisingPacingRules: (...args: unknown[]) =>
    mockRunDueAdvertisingPacingRules(...args),
  runDueAdvertisingPortfolios: (...args: unknown[]) =>
    mockRunDueAdvertisingPortfolios(...args),
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

import { advertisingAutoBidderJob } from './advertising-auto-bidder';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const handler = (advertisingAutoBidderJob as unknown as { _handler: (...args: unknown[]) => Promise<any> })._handler;

// ── tests ─────────────────────────────────────────────────────────────────────

describe('advertisingAutoBidderJob handler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns strategies, pacing, and portfolios results on happy path', async () => {
    mockRunDueAdvertisingAutoBidStrategies.mockResolvedValue({ checked: 2, results: [] });
    mockRunDueAdvertisingPacingRules.mockResolvedValue([]);
    mockRunDueAdvertisingPortfolios.mockResolvedValue([]);

    const result = await handler();

    expect(result).toEqual({
      strategies: { checked: 2, results: [] },
      pacing: [],
      portfolios: [],
    });
  });

  it('runs all three helpers in parallel (all called exactly once)', async () => {
    mockRunDueAdvertisingAutoBidStrategies.mockResolvedValue({ checked: 0, results: [] });
    mockRunDueAdvertisingPacingRules.mockResolvedValue([]);
    mockRunDueAdvertisingPortfolios.mockResolvedValue([]);

    await handler();

    expect(mockRunDueAdvertisingAutoBidStrategies).toHaveBeenCalledOnce();
    expect(mockRunDueAdvertisingPacingRules).toHaveBeenCalledOnce();
    expect(mockRunDueAdvertisingPortfolios).toHaveBeenCalledOnce();
  });

  it('propagates the error if one of the helpers rejects', async () => {
    mockRunDueAdvertisingAutoBidStrategies.mockRejectedValue(new Error('strategy error'));
    mockRunDueAdvertisingPacingRules.mockResolvedValue([]);
    mockRunDueAdvertisingPortfolios.mockResolvedValue([]);

    await expect(handler()).rejects.toThrow('strategy error');
  });

  it('returns empty arrays when no due strategies or rules exist', async () => {
    mockRunDueAdvertisingAutoBidStrategies.mockResolvedValue({ checked: 0, results: [] });
    mockRunDueAdvertisingPacingRules.mockResolvedValue([]);
    mockRunDueAdvertisingPortfolios.mockResolvedValue([]);

    const result = await handler();

    expect(result.strategies.checked).toBe(0);
    expect(result.pacing).toHaveLength(0);
    expect(result.portfolios).toHaveLength(0);
  });
});
