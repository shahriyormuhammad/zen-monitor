import { describe, expect, it, vi } from 'vitest';

import { callWbAdsApi } from './ads-api-call';

describe('callWbAdsApi', () => {
  it('returns the value when the underlying call succeeds', async () => {
    const result = await callWbAdsApi('test.op', async () => 42, { tenantId: 't1' });
    expect(result).toBe(42);
  });

  it('returns null and logs a warning on error', async () => {
    const { logger } = await import('@/lib/logger');
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const boom = new Error('boom');
    const result = await callWbAdsApi('test.op', async () => { throw boom; }, {
      tenantId: 't1',
      advertId: 123,
      nmId: 456,
    });
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [ctx, message] = warnSpy.mock.calls[0] ?? [];
    expect(ctx).toMatchObject({ tenantId: 't1', advertId: 123, nmId: 456, operation: 'test.op' });
    expect(String(message)).toContain('test.op');
    warnSpy.mockRestore();
  });

  it('propagates rejected non-Error values without crashing', async () => {
    const { logger } = await import('@/lib/logger');
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const result = await callWbAdsApi('test.op', async () => { throw 'string error'; }, { tenantId: 't' });
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
