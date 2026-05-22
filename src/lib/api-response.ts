import { NextRequest, NextResponse } from 'next/server';

import { AppError, getErrorStatus } from '@/lib/auth/tenant-access';
import { logger } from '@/lib/logger';

type NextRouteContext = { params: Promise<Record<string, string>> };

// Use NextRequest so handlers typed with either Request or NextRequest are accepted
// (contravariance: a handler expecting the broader Request also satisfies this type)
type RouteHandler = (
  request: NextRequest,
  context: NextRouteContext
) => Promise<NextResponse>;

/**
 * Wraps a route handler with unified error handling.
 * - AppError messages are forwarded to the client as-is.
 * - All other exceptions are logged server-side and return a generic
 *   "Internal Server Error" message so internal details never leak.
 */
export function apiRoute(handler: RouteHandler): RouteHandler {
  return async (request: NextRequest, context: NextRouteContext): Promise<NextResponse> => {
    try {
      return await handler(request, context);
    } catch (error: unknown) {
      const isAppError = error instanceof AppError;
      if (!isAppError) {
        logger.error({ err: error, method: request.method, path: new URL(request.url).pathname }, 'Unhandled API error');
      }
      return NextResponse.json(
        { error: isAppError ? error.message : 'Internal Server Error' },
        { status: getErrorStatus(error) }
      );
    }
  };
}
