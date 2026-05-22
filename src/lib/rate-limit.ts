import { NextRequest, NextResponse } from 'next/server';

/**
 * Simple in-memory sliding-window rate limiter.
 * Suitable for single-instance deployments (no Redis needed).
 *
 * Each bucket stores request timestamps within the current window.
 * Expired entries are pruned on access. A periodic sweep prevents
 * memory growth from abandoned keys.
 */

type RateLimitBucket = {
  timestamps: number[];
};

const store = new Map<string, RateLimitBucket>();

// Sweep stale buckets every 60s
const SWEEP_INTERVAL_MS = 60_000;
let lastSweep = Date.now();

function sweep(windowMs: number) {
  const now = Date.now();
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;

  const cutoff = now - windowMs;
  for (const [key, bucket] of store) {
    bucket.timestamps = bucket.timestamps.filter((t) => t > cutoff);
    if (bucket.timestamps.length === 0) {
      store.delete(key);
    }
  }
}

function isRateLimited(key: string, limit: number, windowMs: number): { limited: boolean; remaining: number; resetMs: number } {
  const now = Date.now();
  const cutoff = now - windowMs;

  let bucket = store.get(key);
  if (!bucket) {
    bucket = { timestamps: [] };
    store.set(key, bucket);
  }

  // Prune expired timestamps
  bucket.timestamps = bucket.timestamps.filter((t) => t > cutoff);

  if (bucket.timestamps.length >= limit) {
    const oldestInWindow = bucket.timestamps[0]!;
    return {
      limited: true,
      remaining: 0,
      resetMs: oldestInWindow + windowMs - now,
    };
  }

  bucket.timestamps.push(now);
  return {
    limited: false,
    remaining: limit - bucket.timestamps.length,
    resetMs: windowMs,
  };
}

type RateLimitScope = 'ip' | 'tenant';

interface RateLimitConfig {
  /** Scope key: 'ip' extracts from headers, 'tenant' from the active_tenant_id cookie */
  per: RateLimitScope;
  /** Max requests within the window */
  limit: number;
  /** Window in seconds (default: 60) */
  window?: number;
}

function extractKey(request: NextRequest, scope: RateLimitScope): string {
  if (scope === 'tenant') {
    const tenantId = request.cookies.get('active_tenant_id')?.value;
    if (tenantId) return `tenant:${tenantId}`;
    // Fall back to IP if no cookie (unauthenticated caller)
  }

  // IP extraction: check forwarded headers, fall back to remote address
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
  return `ip:${ip}`;
}

type NextRouteContext = { params: Promise<Record<string, string>> };
type RouteHandler = (request: NextRequest, context: NextRouteContext) => Promise<NextResponse | Response>;

/**
 * Wraps a route handler with rate limiting.
 *
 * Returns 429 with Retry-After header when the limit is exceeded.
 */
export function withRateLimit(handler: RouteHandler, config: RateLimitConfig): RouteHandler {
  const windowMs = (config.window ?? 60) * 1000;

  return async (request, context) => {
    const key = `${request.nextUrl.pathname}:${extractKey(request, config.per)}`;

    sweep(windowMs);

    const result = isRateLimited(key, config.limit, windowMs);

    if (result.limited) {
      const retryAfter = Math.ceil(result.resetMs / 1000);
      return NextResponse.json(
        { error: 'Too Many Requests' },
        {
          status: 429,
          headers: {
            'Retry-After': String(retryAfter),
            'X-RateLimit-Limit': String(config.limit),
            'X-RateLimit-Remaining': '0',
          },
        }
      );
    }

    return handler(request, context);
  };
}
