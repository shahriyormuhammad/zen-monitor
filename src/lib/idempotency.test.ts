import { createHash } from 'node:crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// Mock the database module before importing the module under test
const mockFindFirst = vi.fn();
const mockInsert = vi.fn();
const mockOnConflictDoNothing = vi.fn();

vi.mock('@/lib/db', () => {
  const txStub = {
    query: {
      idempotencyKeys: {
        findFirst: (...args: unknown[]) => mockFindFirst(...args),
      },
    },
    insert: (...args: unknown[]) => {
      mockInsert(...args);
      return { values: () => ({ onConflictDoNothing: mockOnConflictDoNothing }) };
    },
  };
  return {
    db: txStub,
    withTenantContext: async (
      _database: unknown,
      _tenantId: string,
      fn: (tx: typeof txStub) => Promise<unknown>,
    ) => fn(txStub),
  };
});

vi.mock('@/lib/db/schema', () => ({
  idempotencyKeys: { key: 'key', tenantId: 'tenant_id' },
}));

import { withIdempotencyKey } from './idempotency';

const routeContext = { params: Promise.resolve({}) };

function makeRequest(url: string, body: object, idempotencyKey?: string) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (idempotencyKey) {
    headers.set('idempotency-key', idempotencyKey);
  }
  // Parse tenantId from legacy `?tenantId=` to inject into the cookie for
  // backwards-compatible test URLs. Tests that want to exercise the
  // cookie-only path can drop the query param.
  try {
    const parsed = new URL(url);
    const qpTenantId = parsed.searchParams.get('tenantId');
    if (qpTenantId) {
      headers.set('cookie', `active_tenant_id=${qpTenantId}`);
    }
  } catch {
    // URL parse failure — test is exercising malformed input
  }
  return new NextRequest(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('withIdempotencyKey', () => {
  const innerHandler = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    innerHandler.mockResolvedValue(
      NextResponse.json({ ok: true, id: 'abc' }, { status: 200 })
    );
  });

  it('passes through when no Idempotency-Key header', async () => {
    const wrapped = withIdempotencyKey(innerHandler);
    const req = makeRequest('http://localhost/api/test?tenantId=t1', { foo: 1 });

    await wrapped(req, routeContext);

    expect(innerHandler).toHaveBeenCalledTimes(1);
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it('returns cached response when key exists with matching hash', async () => {
    const body = { foo: 1 };
    const hash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    mockFindFirst.mockResolvedValue({
      requestHash: hash,
      responseStatus: 200,
      responseBody: { ok: true, id: 'cached' },
    });

    const wrapped = withIdempotencyKey(innerHandler);
    const req = makeRequest('http://localhost/api/test?tenantId=t1', body, 'key-1');

    const response = await wrapped(req, routeContext);
    const json = await response.json();

    expect(json).toEqual({ ok: true, id: 'cached' });
    expect(response.status).toBe(200);
    expect(innerHandler).not.toHaveBeenCalled();
  });

  it('returns 422 when key exists with different hash', async () => {
    mockFindFirst.mockResolvedValue({
      requestHash: 'different-hash',
      responseStatus: 200,
      responseBody: { ok: true },
    });

    const wrapped = withIdempotencyKey(innerHandler);
    const req = makeRequest('http://localhost/api/test?tenantId=t1', { foo: 1 }, 'key-1');

    const response = await wrapped(req, routeContext);

    expect(response.status).toBe(422);
    expect(innerHandler).not.toHaveBeenCalled();
  });

  it('calls handler and caches response when key is new', async () => {
    mockFindFirst.mockResolvedValue(null);

    const wrapped = withIdempotencyKey(innerHandler);
    const req = makeRequest('http://localhost/api/test?tenantId=t1', { foo: 1 }, 'key-2');

    const response = await wrapped(req, routeContext);
    const json = await response.json();

    expect(json).toEqual({ ok: true, id: 'abc' });
    expect(innerHandler).toHaveBeenCalledTimes(1);
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });

  it('extracts tenantId from body when not in URL', async () => {
    mockFindFirst.mockResolvedValue(null);

    const wrapped = withIdempotencyKey(innerHandler);
    const req = makeRequest('http://localhost/api/test', { tenantId: 't2', foo: 1 }, 'key-3');

    await wrapped(req, routeContext);

    expect(innerHandler).toHaveBeenCalledTimes(1);
    expect(mockFindFirst).toHaveBeenCalledTimes(1);
  });

  it('rejects key longer than 255 chars', async () => {
    const wrapped = withIdempotencyKey(innerHandler);
    const longKey = 'x'.repeat(256);
    const req = makeRequest('http://localhost/api/test?tenantId=t1', { foo: 1 }, longKey);

    const response = await wrapped(req, routeContext);

    expect(response.status).toBe(400);
    expect(innerHandler).not.toHaveBeenCalled();
  });
});
