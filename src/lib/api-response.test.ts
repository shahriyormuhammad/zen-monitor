import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn() },
}));

import { apiRoute } from './api-response';
import { AppError } from './errors';

function makeRequest(path = '/api/test') {
  return new NextRequest(`http://localhost${path}`, { method: 'GET' });
}

const routeContext = { params: Promise.resolve({}) };

describe('apiRoute', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes through successful handler response', async () => {
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }, { status: 200 }));
    const wrapped = apiRoute(handler);
    const res = await wrapped(makeRequest(), routeContext);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('forwards AppError message and status to client', async () => {
    const handler = vi.fn().mockRejectedValue(new AppError('Access denied', 403));
    const wrapped = apiRoute(handler);
    const res = await wrapped(makeRequest(), routeContext);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Access denied' });
  });

  it('scrubs generic Error — returns 500 and generic message', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('DB connection failed: password=secret'));
    const wrapped = apiRoute(handler);
    const res = await wrapped(makeRequest(), routeContext);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Internal Server Error' });
  });

  it('scrubs non-Error throws', async () => {
    const handler = vi.fn().mockRejectedValue('raw string throw');
    const wrapped = apiRoute(handler);
    const res = await wrapped(makeRequest(), routeContext);
    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Internal Server Error');
  });
});
