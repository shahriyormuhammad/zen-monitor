import { createHash } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import { db, withTenantContext } from '@/lib/db';
import { idempotencyKeys } from '@/lib/db/schema';
import { AppError, getErrorStatus } from '@/lib/errors';
import { logger } from '@/lib/logger';

const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
const MAX_KEY_LENGTH = 255;

/**
 * Hash the request body so we can detect replays with different payloads.
 */
function hashBody(body: string): string {
  return createHash('sha256').update(body).digest('hex');
}

/**
 * Extract tenantId from the active_tenant_id cookie or parsed body JSON.
 * Falls back to empty string if missing.
 */
function extractTenantId(request: NextRequest, bodyText: string): string {
  const fromCookie = request.cookies.get('active_tenant_id')?.value;
  if (fromCookie) return fromCookie;

  try {
    const parsed = JSON.parse(bodyText);
    if (typeof parsed?.tenantId === 'string' && parsed.tenantId) {
      return parsed.tenantId;
    }
  } catch {
    // Body is not JSON — no tenantId available
  }
  return '';
}

type RouteHandler = (
  request: NextRequest,
  context: { params: Promise<Record<string, string>> }
) => Promise<NextResponse>;

/**
 * Wraps a POST route handler with idempotency support.
 *
 * If the request includes an `Idempotency-Key` header:
 * - Checks for an existing record with the same key + tenantId
 * - If found and request hash matches → returns the cached response
 * - If found but hash differs → returns 422 (payload mismatch)
 * - If not found → executes the handler, caches the response, returns it
 *
 * If no header is present, the handler executes normally without caching.
 */
export function withIdempotencyKey(handler: RouteHandler): RouteHandler {
  return async (request, context) => {
    try {
      const idempotencyKey = request.headers.get(IDEMPOTENCY_KEY_HEADER);

      if (!idempotencyKey) {
        return handler(request, context);
      }

      if (idempotencyKey.length > MAX_KEY_LENGTH) {
        return NextResponse.json(
          { error: `Idempotency-Key exceeds ${MAX_KEY_LENGTH} characters` },
          { status: 400 },
        );
      }

      // Read body once, then create a clone for the downstream handler
      const bodyText = await request.text();

      const tenantId = extractTenantId(request, bodyText);
      if (!tenantId) {
        // Cannot scope without tenantId — run handler without caching
        const freshRequest = new NextRequest(request.url, {
          method: request.method,
          headers: request.headers,
          body: bodyText,
        });
        return handler(freshRequest, context);
      }
      const requestHash = hashBody(bodyText);

      // Check for existing cached response
      const existing = await withTenantContext(db, tenantId, (tx) =>
        tx.query.idempotencyKeys.findFirst({
          where: and(
            eq(idempotencyKeys.key, idempotencyKey),
            eq(idempotencyKeys.tenantId, tenantId),
          ),
        }),
      );

      if (existing) {
        if (existing.requestHash !== requestHash) {
          return NextResponse.json(
            { error: 'Idempotency-Key already used with a different request body' },
            { status: 422 },
          );
        }
        return NextResponse.json(existing.responseBody, {
          status: existing.responseStatus,
        });
      }

      // Build a new Request with the already-consumed body so the handler can read it
      const freshRequest = new NextRequest(request.url, {
        method: request.method,
        headers: request.headers,
        body: bodyText,
      });

      const response = await handler(freshRequest, context);

      // Cache the response (best-effort — don't break the original response on cache failure)
      try {
        const responseBody = await response.clone().json();
        await withTenantContext(db, tenantId, (tx) =>
          tx.insert(idempotencyKeys).values({
            key: idempotencyKey,
            tenantId,
            requestHash,
            responseStatus: response.status,
            responseBody,
          }).onConflictDoNothing(),
        );
      } catch {
        // If caching fails (e.g. response is not JSON), skip silently
      }

      return response;
    } catch (error) {
      const isAppError = error instanceof AppError;
      if (!isAppError) {
        logger.error({
          err: error,
          method: request.method,
          path: new URL(request.url).pathname,
        }, 'Unhandled idempotency middleware error');
      }
      return NextResponse.json(
        { error: isAppError ? error.message : 'Internal Server Error' },
        { status: getErrorStatus(error) },
      );
    }
  };
}
