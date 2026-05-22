import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── mocks (must be hoisted before dynamic imports) ──────────────────────────

const mockGetUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => Promise.resolve({ auth: { getUser: mockGetUser } }),
}));

const mockUserTenantsFindFirst = vi.fn();
const mockProductGroupsFindFirst = vi.fn();
const mockPlatformImpersonationSessionsFindFirst = vi.fn();
vi.mock('@/lib/db', () => {
  const txStub = {
    query: {
      userTenants: { findFirst: (...a: unknown[]) => mockUserTenantsFindFirst(...a) },
      productGroups: { findFirst: (...a: unknown[]) => mockProductGroupsFindFirst(...a) },
      platformImpersonationSessions: { findFirst: (...a: unknown[]) => mockPlatformImpersonationSessionsFindFirst(...a) },
    },
  };
  return {
    db: txStub,
    withTenantContext: async (
      _database: unknown,
      _tenantId: string,
      fn: (tx: typeof txStub) => Promise<unknown>,
    ) => fn(txStub),
    withAdminContext: async (
      _database: unknown,
      fn: (tx: typeof txStub) => Promise<unknown>,
    ) => fn(txStub),
  };
});

const mockCookieGet = vi.fn();
vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ get: mockCookieGet }),
}));

// ── import after mocks ───────────────────────────────────────────────────────

import {
  requireTenantAccess,
  requireActiveTenant,
  requireTenantFeatureAccess,
  requireNonImpersonatedMutation,
  requireGroupAccess,
} from './tenant-access';

// ── helpers ──────────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-uuid-1';
const USER_ID = 'user-uuid-1';
const GROUP_ID = 'group-uuid-1';
const IMPERSONATION_SESSION_ID = '11111111-1111-4111-8111-111111111111';

function authedUser() {
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
}
function anonUser() {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
}

// ── tests ────────────────────────────────────────────────────────────────────

describe('requireTenantAccess', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws 400 when tenantId is empty', async () => {
    await expect(requireTenantAccess('')).rejects.toMatchObject({
      status: 400,
      message: 'Missing tenantId',
    });
  });

  it('throws 401 when user is not authenticated', async () => {
    anonUser();
    await expect(requireTenantAccess(TENANT_ID)).rejects.toMatchObject({ status: 401 });
  });

  it('throws 403 when user has no membership', async () => {
    authedUser();
    mockUserTenantsFindFirst.mockResolvedValue(undefined);
    await expect(requireTenantAccess(TENANT_ID)).rejects.toMatchObject({
      status: 403,
      message: 'Access denied',
    });
  });

  it('throws 403 when user role is not in allowedRoles', async () => {
    authedUser();
    mockUserTenantsFindFirst.mockResolvedValue({ userId: USER_ID, tenantId: TENANT_ID, role: 'viewer' });
    await expect(requireTenantAccess(TENANT_ID, ['owner', 'admin'])).rejects.toMatchObject({
      status: 403,
    });
  });

  it('returns user and access for valid membership', async () => {
    authedUser();
    const access = { userId: USER_ID, tenantId: TENANT_ID, role: 'admin' };
    mockUserTenantsFindFirst.mockResolvedValue(access);

    const result = await requireTenantAccess(TENANT_ID);
    expect(result.tenantId).toBe(TENANT_ID);
    expect(result.access.role).toBe('admin');
    expect(result.user.id).toBe(USER_ID);
  });

  it('allows viewer when no allowedRoles restriction passed', async () => {
    authedUser();
    mockUserTenantsFindFirst.mockResolvedValue({ userId: USER_ID, tenantId: TENANT_ID, role: 'viewer' });
    const result = await requireTenantAccess(TENANT_ID);
    expect(result.access.role).toBe('viewer');
  });

  it('allows platform admin to read tenant only with active impersonation session', async () => {
    authedUser();
    mockUserTenantsFindFirst.mockResolvedValue(undefined);
    mockCookieGet.mockImplementation((name: string) => (
      name === 'platform_impersonation_session_id'
        ? { value: IMPERSONATION_SESSION_ID }
        : undefined
    ));
    mockPlatformImpersonationSessionsFindFirst.mockResolvedValue({
      id: IMPERSONATION_SESSION_ID,
      actorUserId: USER_ID,
      actorRole: 'support',
      tenantId: TENANT_ID,
      reason: 'support_debug',
      note: null,
      status: 'active',
      startedAt: new Date('2026-05-14T10:00:00Z'),
      expiresAt: new Date('2026-05-14T12:00:00Z'),
    });

    const result = await requireTenantAccess(TENANT_ID);

    expect(result.tenantId).toBe(TENANT_ID);
    expect(result.access.role).toBe('owner');
    expect(result.access.isPlatformImpersonation).toBe(true);
  });

  it('checks manager feature permissions explicitly', async () => {
    authedUser();
    mockUserTenantsFindFirst.mockResolvedValue({
      userId: USER_ID,
      tenantId: TENANT_ID,
      role: 'manager',
      featurePermissions: { advertising: true },
    });

    await expect(requireTenantFeatureAccess(TENANT_ID, 'advertising')).resolves.toMatchObject({
      tenantId: TENANT_ID,
    });
    await expect(requireTenantFeatureAccess(TENANT_ID, 'finance')).rejects.toMatchObject({
      status: 403,
      message: 'Нет доступа к этому разделу',
    });
  });
});

describe('requireActiveTenant', () => {
  beforeEach(() => vi.clearAllMocks());

  function makeRequest(url: string) {
    return new NextRequest(url, { method: 'GET' });
  }

  it('reads tenant from cookie and ignores query param', async () => {
    mockCookieGet.mockReturnValue({ value: TENANT_ID });
    authedUser();
    mockUserTenantsFindFirst.mockResolvedValue({ userId: USER_ID, tenantId: TENANT_ID, role: 'owner' });

    const req = makeRequest(`http://localhost/api/x?tenantId=other-tenant`);
    const result = await requireActiveTenant(req);
    expect(result.tenantId).toBe(TENANT_ID);
  });

  it('throws 400 when cookie absent even if query param is present', async () => {
    mockCookieGet.mockReturnValue(undefined);
    authedUser();
    const req = makeRequest(`http://localhost/api/x?tenantId=qt-tenant`);
    await expect(requireActiveTenant(req)).rejects.toMatchObject({ status: 400 });
  });

  it('throws 400 when cookie absent and no query param', async () => {
    mockCookieGet.mockReturnValue(undefined);
    authedUser();
    const req = makeRequest('http://localhost/api/x');
    await expect(requireActiveTenant(req)).rejects.toMatchObject({ status: 400 });
  });

  it('guards api view routes by feature permission', async () => {
    mockCookieGet.mockReturnValue({ value: TENANT_ID });
    authedUser();
    mockUserTenantsFindFirst.mockResolvedValue({
      userId: USER_ID,
      tenantId: TENANT_ID,
      role: 'manager',
      featurePermissions: { advertising: true },
    });

    await expect(requireActiveTenant(makeRequest('http://localhost/api/views/advertising'))).resolves.toMatchObject({
      tenantId: TENANT_ID,
    });
    await expect(requireActiveTenant(makeRequest('http://localhost/api/views/profit-report'))).rejects.toMatchObject({
      status: 403,
    });
  });

  it('allows non-GET requests while platform admin impersonates tenant', async () => {
    mockCookieGet.mockImplementation((name: string) => {
      if (name === 'active_tenant_id') return { value: TENANT_ID };
      if (name === 'platform_impersonation_session_id') return { value: IMPERSONATION_SESSION_ID };
      return undefined;
    });
    authedUser();
    mockUserTenantsFindFirst.mockResolvedValue(undefined);
    mockPlatformImpersonationSessionsFindFirst.mockResolvedValue({
      id: IMPERSONATION_SESSION_ID,
      actorUserId: USER_ID,
      actorRole: 'support',
      tenantId: TENANT_ID,
      reason: 'support_debug',
      note: null,
      status: 'active',
      startedAt: new Date('2026-05-14T10:00:00Z'),
      expiresAt: new Date('2026-05-14T12:00:00Z'),
    });

    await expect(requireActiveTenant(makeRequest('http://localhost/api/views/advertising'), ['owner']))
      .resolves.toMatchObject({ tenantId: TENANT_ID });
    await expect(requireActiveTenant(new NextRequest('http://localhost/api/views/advertising', { method: 'POST' })))
      .resolves.toMatchObject({
        tenantId: TENANT_ID,
        access: {
          isPlatformImpersonation: true,
        },
      });
  });
});

describe('requireNonImpersonatedMutation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns impersonation context during active platform impersonation session', async () => {
    authedUser();
    mockCookieGet.mockImplementation((name: string) => (
      name === 'platform_impersonation_session_id'
        ? { value: IMPERSONATION_SESSION_ID }
        : undefined
    ));
    mockPlatformImpersonationSessionsFindFirst.mockResolvedValue({
      id: IMPERSONATION_SESSION_ID,
      actorUserId: USER_ID,
      actorRole: 'support',
      tenantId: TENANT_ID,
      reason: 'support_debug',
      note: null,
      status: 'active',
      startedAt: new Date('2026-05-14T10:00:00Z'),
      expiresAt: new Date('2026-05-14T12:00:00Z'),
    });

    await expect(requireNonImpersonatedMutation()).resolves.toMatchObject({
      user: { id: USER_ID },
      impersonation: {
        id: IMPERSONATION_SESSION_ID,
        tenantId: TENANT_ID,
      },
    });
  });

  it('returns user when not impersonating', async () => {
    authedUser();
    mockCookieGet.mockReturnValue(undefined);

    await expect(requireNonImpersonatedMutation()).resolves.toMatchObject({
      user: { id: USER_ID },
    });
  });
});

describe('requireGroupAccess', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws 400 when groupId is empty', async () => {
    await expect(requireGroupAccess('')).rejects.toMatchObject({ status: 400 });
  });

  it('throws 404 when group not found', async () => {
    mockProductGroupsFindFirst.mockResolvedValue(undefined);
    await expect(requireGroupAccess(GROUP_ID)).rejects.toMatchObject({
      status: 404,
      message: 'Group not found',
    });
  });

  it('delegates to requireTenantAccess and returns group', async () => {
    mockProductGroupsFindFirst.mockResolvedValue({ id: GROUP_ID, tenantId: TENANT_ID });
    authedUser();
    mockUserTenantsFindFirst.mockResolvedValue({ userId: USER_ID, tenantId: TENANT_ID, role: 'admin' });

    const result = await requireGroupAccess(GROUP_ID);
    expect(result.group.id).toBe(GROUP_ID);
    expect(result.tenantId).toBe(TENANT_ID);
  });
});
