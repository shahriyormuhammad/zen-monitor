import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRunAdvertisingDecisionAutopilot = vi.fn();

vi.mock('@/server/advertising/decision-autopilot', () => ({
  runAdvertisingDecisionAutopilot: (...args: unknown[]) => mockRunAdvertisingDecisionAutopilot(...args),
}));

vi.mock('@/inngest/client', () => ({
  inngest: {
    createFunction: (_opts: unknown, handler: unknown) => ({ _handler: handler }),
  },
}));

vi.mock('@/inngest/on-failure', () => ({
  handleInngestFailure: vi.fn(),
}));

import { advertisingDecisionAutopilotJob } from './advertising-decision-autopilot';

const handler = (advertisingDecisionAutopilotJob as unknown as {
  _handler: () => Promise<unknown>;
})._handler;

describe('advertisingDecisionAutopilotJob handler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('runs the decision autopilot executor', async () => {
    mockRunAdvertisingDecisionAutopilot.mockResolvedValue({
      checked: 1,
      processed: 1,
      applied: 1,
      failed: 0,
      results: [],
    });

    const result = await handler();

    expect(mockRunAdvertisingDecisionAutopilot).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ checked: 1, processed: 1, applied: 1, failed: 0 });
  });

  it('propagates executor errors to Inngest retry/onFailure', async () => {
    mockRunAdvertisingDecisionAutopilot.mockRejectedValue(new Error('executor failed'));

    await expect(handler()).rejects.toThrow('executor failed');
  });
});
