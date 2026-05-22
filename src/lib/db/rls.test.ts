import { describe, it, expect, vi } from 'vitest';
import { withTenantContext } from './index';

// drizzle sql`` tag returns an SQL<unknown> object — not a plain string.
// We verify the execute call receives an object that contains the tenant_id
// by checking JSON.stringify (queryChunks include the param value).

function makeMockDb() {
  const executeArgs: unknown[] = [];
  const mockTx = {
    execute: vi.fn().mockImplementation((q: unknown) => {
      executeArgs.push(q);
      return Promise.resolve([]);
    }),
  };
  const mockDb = {
    transaction: vi.fn().mockImplementation(async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)),
    _executeArgs: executeArgs,
    _mockTx: mockTx,
  };
  return mockDb;
}

describe('withTenantContext', () => {
  it('calls execute once with a sql object containing tenant_id', async () => {
    const tenantId = 'aabbccdd-0000-0000-0000-000000000001';
    const fakeDb = makeMockDb();

    const result = await withTenantContext(fakeDb as never, tenantId, async () => 'ok');

    expect(result).toBe('ok');
    expect(fakeDb._mockTx.execute).toHaveBeenCalledOnce();

    const calledArg = fakeDb._executeArgs[0];
    expect(JSON.stringify(calledArg)).toContain(tenantId);
  });

  it('passes through errors from fn', async () => {
    const fakeDb = makeMockDb();

    await expect(
      withTenantContext(fakeDb as never, 'any-uuid', async () => {
        throw new Error('db error');
      }),
    ).rejects.toThrow('db error');
  });

  it('passes different tenant_id per call', async () => {
    const db1 = makeMockDb();
    const db2 = makeMockDb();

    await withTenantContext(db1 as never, 'tenant-aaa-111', async () => {});
    await withTenantContext(db2 as never, 'tenant-bbb-222', async () => {});

    expect(JSON.stringify(db1._executeArgs[0])).toContain('tenant-aaa-111');
    expect(JSON.stringify(db2._executeArgs[0])).toContain('tenant-bbb-222');
  });
});
