import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const createdSessionId = '11111111-1111-4111-8111-111111111111';
  const tenantId = '22222222-2222-4222-8222-222222222222';
  const userId = '33333333-3333-4333-8333-333333333333';

  return {
    createdSessionId,
    tenantId,
    userId,
    requirePlatformAdmin: vi.fn(),
    setPlatformImpersonationCookie: vi.fn(),
    clearPlatformImpersonationCookie: vi.fn(),
    getActivePlatformImpersonationSessionForUser: vi.fn(),
    setActiveTenantCookie: vi.fn(),
    clearActiveTenantCookie: vi.fn(),
    tenantFindFirst: vi.fn(),
    updateWhere: vi.fn(),
    updateSet: vi.fn(() => ({ where: vi.fn() })),
    update: vi.fn(),
    sessionInsertPayload: vi.fn(),
    auditInsertPayload: vi.fn(),
  };
});

h.update.mockImplementation(() => ({ set: h.updateSet }));
h.updateSet.mockImplementation(() => ({ where: h.updateWhere }));

vi.mock('@/lib/auth/platform-admin', () => ({
  requirePlatformAdmin: (...args: unknown[]) => h.requirePlatformAdmin(...args),
}));

vi.mock('@/lib/auth/platform-impersonation-session', () => ({
  PLATFORM_IMPERSONATION_TTL_SECONDS: 7200,
  setPlatformImpersonationCookie: (...args: unknown[]) => h.setPlatformImpersonationCookie(...args),
  clearPlatformImpersonationCookie: (...args: unknown[]) => h.clearPlatformImpersonationCookie(...args),
  getActivePlatformImpersonationSessionForUser: (...args: unknown[]) => h.getActivePlatformImpersonationSessionForUser(...args),
}));

vi.mock('@/lib/auth/tenant-access', () => ({
  setActiveTenantCookie: (...args: unknown[]) => h.setActiveTenantCookie(...args),
  clearActiveTenantCookie: (...args: unknown[]) => h.clearActiveTenantCookie(...args),
}));

vi.mock('@/lib/db', () => {
  const txStub = {
    query: {
      tenants: {
        findFirst: (...args: unknown[]) => h.tenantFindFirst(...args),
      },
    },
    update: (...args: unknown[]) => h.update(...args),
    insert: () => ({
      values: (payload: Record<string, unknown>) => {
        if (payload.action) {
          h.auditInsertPayload(payload);
          return Promise.resolve([]);
        }

        h.sessionInsertPayload(payload);
        return {
          returning: () => Promise.resolve([{
            id: h.createdSessionId,
            tenantId: h.tenantId,
            reason: payload.reason,
            note: payload.note,
            startedAt: new Date('2026-05-14T10:00:00Z'),
            expiresAt: payload.expiresAt,
          }]),
        };
      },
    }),
  };

  return {
    db: txStub,
    withAdminContext: async (_database: unknown, fn: (tx: typeof txStub) => Promise<unknown>) => fn(txStub),
  };
});

import { beginPlatformImpersonation } from './platform-impersonation-admin';

describe('beginPlatformImpersonation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.update.mockImplementation(() => ({ set: h.updateSet }));
    h.updateSet.mockImplementation(() => ({ where: h.updateWhere }));
    h.requirePlatformAdmin.mockResolvedValue({
      user: { id: h.userId },
      role: 'support',
      access: { role: 'support', status: 'active' },
    });
    h.tenantFindFirst.mockResolvedValue({ id: h.tenantId, name: 'Client' });
  });

  it('creates a read-only view session, sets cookies and writes audit log', async () => {
    const session = await beginPlatformImpersonation({
      tenantId: h.tenantId,
      reason: 'owner_request',
      note: 'Проверка по просьбе клиента',
    });

    expect(session.id).toBe(h.createdSessionId);
    expect(h.sessionInsertPayload).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: h.userId,
      actorRole: 'support',
      tenantId: h.tenantId,
      reason: 'owner_request',
      note: 'Проверка по просьбе клиента',
    }));
    expect(h.auditInsertPayload).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: h.userId,
      actorRole: 'support',
      action: 'platform.impersonation.start',
      entityType: 'platform_impersonation_session',
      entityId: h.createdSessionId,
      tenantId: h.tenantId,
      reason: 'owner_request: Проверка по просьбе клиента',
    }));
    expect(h.setPlatformImpersonationCookie).toHaveBeenCalledWith(h.createdSessionId);
    expect(h.setActiveTenantCookie).toHaveBeenCalledWith(h.tenantId);
  });
});
