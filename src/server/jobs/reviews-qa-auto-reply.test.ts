import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mocks ────────────────────────────────────────────────────────────────────

const mockRunDueReviewsQaAutoReplies = vi.fn();
vi.mock('@/server/reviews-qa/auto-reply', () => ({
  runDueReviewsQaAutoReplies: (...args: unknown[]) => mockRunDueReviewsQaAutoReplies(...args),
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

import { reviewsQaAutoReplyJob } from './reviews-qa-auto-reply';

// The job is created via inngest.createFunction so _handler holds the fn.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const handler = (reviewsQaAutoReplyJob as unknown as { _handler: (...args: unknown[]) => Promise<any> })._handler;

// ── tests ─────────────────────────────────────────────────────────────────────

describe('reviewsQaAutoReplyJob handler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the result of runDueReviewsQaAutoReplies on happy path', async () => {
    const fakeResult = {
      scannedTenants: 3,
      skippedDueToLock: 0,
      queuedReviews: 12,
      attempted: 10,
    };
    mockRunDueReviewsQaAutoReplies.mockResolvedValue(fakeResult);

    const result = await handler();

    expect(mockRunDueReviewsQaAutoReplies).toHaveBeenCalledOnce();
    expect(result).toEqual(fakeResult);
  });

  it('returns zero counts when no tenants have auto-reply enabled', async () => {
    const emptyResult = {
      scannedTenants: 0,
      skippedDueToLock: 0,
      queuedReviews: 0,
      attempted: 0,
    };
    mockRunDueReviewsQaAutoReplies.mockResolvedValue(emptyResult);

    const result = await handler();

    expect(result.scannedTenants).toBe(0);
    expect(result.attempted).toBe(0);
  });

  it('propagates errors thrown by runDueReviewsQaAutoReplies', async () => {
    mockRunDueReviewsQaAutoReplies.mockRejectedValue(new Error('WB API timeout'));

    await expect(handler()).rejects.toThrow('WB API timeout');
  });

  it('calls the underlying helper exactly once per invocation', async () => {
    mockRunDueReviewsQaAutoReplies.mockResolvedValue({ scannedTenants: 1, skippedDueToLock: 0, queuedReviews: 0, attempted: 0 });
    await handler();
    await handler();

    expect(mockRunDueReviewsQaAutoReplies).toHaveBeenCalledTimes(2);
  });
});
