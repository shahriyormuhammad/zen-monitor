import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => Promise.resolve({ auth: { getUser: mockGetUser } }),
}));

const mockPlatformAdminsFindFirst = vi.fn();
vi.mock('@/lib/db', () => {
  const txStub = {
    query: {
      platformAdmins: { findFirst: (...args: unknown[]) => mockPlatformAdminsFindFirst(...args) },
    },
  };

  return {
    db: txStub,
    withAdminContext: async (
      _database: unknown,
      fn: (tx: typeof txStub) => Promise<unknown>,
    ) => fn(txStub),
  };
});

import { requirePlatformAdmin } from './platform-admin';

const USER_ID = 'user-uuid-1';

function authedUser() {
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID, email: 'admin@example.com' } }, error: null });
}

function anonUser() {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
}

describe('requirePlatformAdmin', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws 401 when user is not authenticated', async () => {
    anonUser();

    await expect(requirePlatformAdmin()).rejects.toMatchObject({ status: 401 });
  });

  it('throws 403 when user is not an active platform admin', async () => {
    authedUser();
    mockPlatformAdminsFindFirst.mockResolvedValue(undefined);

    await expect(requirePlatformAdmin()).rejects.toMatchObject({
      status: 403,
      message: 'Platform admin access denied',
    });
  });

  it('throws 403 when platform role is not allowed', async () => {
    authedUser();
    mockPlatformAdminsFindFirst.mockResolvedValue({ userId: USER_ID, role: 'readonly', status: 'active' });

    await expect(requirePlatformAdmin(['owner', 'finance'])).rejects.toMatchObject({ status: 403 });
  });

  it('returns user, access and typed role for an allowed platform admin', async () => {
    authedUser();
    mockPlatformAdminsFindFirst.mockResolvedValue({ userId: USER_ID, role: 'finance', status: 'active' });

    const result = await requirePlatformAdmin(['owner', 'finance']);

    expect(result.user.id).toBe(USER_ID);
    expect(result.role).toBe('finance');
    expect(result.access.status).toBe('active');
  });
});

