import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

import { withRateLimit } from './rate-limit';

function makeRequest(path: string, ip = '127.0.0.1', tenantId?: string) {
  const headers: Record<string, string> = { 'x-forwarded-for': ip };
  if (tenantId) {
    headers.cookie = `active_tenant_id=${tenantId}`;
  }
  return new NextRequest(`http://localhost${path}`, {
    method: 'GET',
    headers,
  });
}

const routeContext = { params: Promise.resolve({}) };

describe('withRateLimit', () => {
  const handler = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    handler.mockResolvedValue(NextResponse.json({ ok: true }));
  });

  it('allows requests under the limit', async () => {
    const wrapped = withRateLimit(handler, { per: 'ip', limit: 3, window: 60 });

    for (let i = 0; i < 3; i++) {
      const res = await wrapped(makeRequest('/test', `10.0.0.${i + 10}`), routeContext);
      expect(res.status).toBe(200);
    }
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it('returns 429 when limit exceeded', async () => {
    const wrapped = withRateLimit(handler, { per: 'ip', limit: 2, window: 60 });
    const ip = '192.168.1.100';

    await wrapped(makeRequest('/test-429', ip), routeContext);
    await wrapped(makeRequest('/test-429', ip), routeContext);
    const res = await wrapped(makeRequest('/test-429', ip), routeContext);

    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toBe('Too Many Requests');
    expect(res.headers.get('Retry-After')).toBeTruthy();
  });

  it('uses tenant scope from the active_tenant_id cookie', async () => {
    const wrapped = withRateLimit(handler, { per: 'tenant', limit: 1, window: 60 });

    const res1 = await wrapped(makeRequest('/test-tenant', '127.0.0.1', 't1'), routeContext);
    expect(res1.status).toBe(200);

    const res2 = await wrapped(makeRequest('/test-tenant', '127.0.0.1', 't1'), routeContext);
    expect(res2.status).toBe(429);

    // Different tenant should not be limited
    const res3 = await wrapped(makeRequest('/test-tenant', '127.0.0.1', 't2'), routeContext);
    expect(res3.status).toBe(200);
  });

  it('falls back to IP for tenant scope when cookie absent', async () => {
    const wrapped = withRateLimit(handler, { per: 'tenant', limit: 1, window: 60 });

    const res1 = await wrapped(makeRequest('/test-tenant-fallback', '10.20.30.40'), routeContext);
    expect(res1.status).toBe(200);

    const res2 = await wrapped(makeRequest('/test-tenant-fallback', '10.20.30.40'), routeContext);
    expect(res2.status).toBe(429);
  });

  it('different paths have separate limits', async () => {
    const wrapped = withRateLimit(handler, { per: 'ip', limit: 1, window: 60 });
    const ip = '10.10.10.10';

    const res1 = await wrapped(makeRequest('/path-a', ip), routeContext);
    expect(res1.status).toBe(200);

    const res2 = await wrapped(makeRequest('/path-b', ip), routeContext);
    expect(res2.status).toBe(200);
  });
});
