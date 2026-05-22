import { and, eq, gt, sql } from 'drizzle-orm';
import { cookies } from 'next/headers';

import { db, withAdminContext } from '@/lib/db';
import { platformImpersonationSessions } from '@/lib/db/schema';

export const PLATFORM_IMPERSONATION_COOKIE = 'platform_impersonation_session_id';
export const PLATFORM_IMPERSONATION_TTL_SECONDS = 60 * 60 * 2;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ActivePlatformImpersonationSession = {
  id: string;
  actorUserId: string | null;
  actorRole: string;
  tenantId: string;
  reason: string;
  note: string | null;
  status: string;
  startedAt: Date;
  expiresAt: Date;
};

export async function readPlatformImpersonationCookie() {
  const store = await cookies();
  const value = store.get(PLATFORM_IMPERSONATION_COOKIE)?.value ?? null;
  return value && UUID_RE.test(value) ? value : null;
}

export async function setPlatformImpersonationCookie(sessionId: string) {
  const store = await cookies();
  store.set(PLATFORM_IMPERSONATION_COOKIE, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: PLATFORM_IMPERSONATION_TTL_SECONDS,
  });
}

export async function clearPlatformImpersonationCookie() {
  const store = await cookies();
  store.delete(PLATFORM_IMPERSONATION_COOKIE);
}

export async function getActivePlatformImpersonationSessionForUser(userId: string) {
  const sessionId = await readPlatformImpersonationCookie();
  if (!sessionId) return null;

  const session = await withAdminContext(db, (tx) =>
    tx.query.platformImpersonationSessions.findFirst({
      where: and(
        eq(platformImpersonationSessions.id, sessionId),
        eq(platformImpersonationSessions.actorUserId, userId),
        eq(platformImpersonationSessions.status, 'active'),
        gt(platformImpersonationSessions.expiresAt, sql`now()`),
      ),
    }),
  );

  return (session ?? null) as ActivePlatformImpersonationSession | null;
}
