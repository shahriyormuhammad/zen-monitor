import { describe, expect, it } from 'vitest';

import {
  assertAgentClientAccess,
  assertAgentWorkerReportAccess,
  assertProcifryClientAccess,
  parseAgentApiClients,
  requireAgentApiClient,
} from './agent-api';
import type { AgentApiClient } from './agent-api';

function asEnv(value: Record<string, string>): NodeJS.ProcessEnv {
  return value as unknown as NodeJS.ProcessEnv;
}

function expectAppError(fn: () => unknown, expected: { status: number; message: string }) {
  try {
    fn();
    throw new Error('Expected function to throw');
  } catch (error) {
    expect(error).toMatchObject(expected);
  }
}

describe('parseAgentApiClients', () => {
  it('returns empty array when agent api is disabled', () => {
    expect(parseAgentApiClients({} as NodeJS.ProcessEnv)).toEqual([]);
  });

  it('parses simple single-key configuration', () => {
    const clients = parseAgentApiClients(asEnv({
      AGENT_API_KEY: 'very-secret-agent-key',
      AGENT_API_CLIENT_ID: 'telegram-main',
      AGENT_API_ALLOWED_REPORTS: 'dashboard_summary,unit_economics_summary,cost_breakdown_detail,sales_funnel_summary,advertising_by_nm_summary',
      AGENT_API_ALLOWED_TENANT_IDS: '11111111-1111-4111-8111-111111111111',
    }));

    expect(clients).toEqual([
      {
        id: 'telegram-main',
        key: 'very-secret-agent-key',
        reports: ['dashboard_summary', 'unit_economics_summary', 'cost_breakdown_detail', 'sales_funnel_summary', 'advertising_by_nm_summary'],
        tenantIds: ['11111111-1111-4111-8111-111111111111'],
        cabinetOids: null,
        workerId: null,
        roles: [],
      },
    ]);
  });

  it('parses advanced multi-client configuration from json', () => {
    const clients = parseAgentApiClients(asEnv({
      AGENT_API_CLIENTS: JSON.stringify([
        {
          id: 'telegram-main',
          key: 'very-secret-agent-key',
          reports: ['dashboard_summary'],
          tenantIds: '*',
          workerId: 'wb-data-integrator',
          roles: ['read_all_wb_digitization', 'write_analysis', 'write_tasks', 'request_approval'],
          cabinetOids: ['lavrov-main'],
        },
      ]),
    }));

    expect(clients).toEqual([
      {
        id: 'telegram-main',
        key: 'very-secret-agent-key',
        reports: ['dashboard_summary'],
        tenantIds: null,
        cabinetOids: ['lavrov-main'],
        workerId: 'wb-data-integrator',
        roles: ['read_all_wb_digitization', 'write_analysis', 'write_tasks', 'request_approval'],
      },
    ]);
  });
});

describe('assertAgentWorkerReportAccess', () => {
  it('allows report inside worker read scope', () => {
    expect(() =>
      assertAgentWorkerReportAccess({
        id: 'procifry-irina',
        key: 'very-secret-agent-key',
        reports: null,
        tenantIds: null,
        cabinetOids: null,
        workerId: 'wb-economics-analyst',
        roles: ['read_all_wb_digitization'],
      }, 'finance_realization_detail'),
    ).not.toThrow();
  });

  it('allows wb-content to read competitor cards for SEO comparisons', () => {
    expect(() =>
      assertAgentWorkerReportAccess({
        id: 'procifry-content',
        key: 'very-secret-agent-key',
        reports: null,
        tenantIds: null,
        cabinetOids: null,
        workerId: 'wb-content',
        roles: ['read_all_wb_digitization'],
      }, 'competitor_cards_summary'),
    ).not.toThrow();
  });

  it('allows wb-ads to read A/B tests for creative performance', () => {
    expect(() =>
      assertAgentWorkerReportAccess({
        id: 'procifry-ads',
        key: 'very-secret-agent-key',
        reports: null,
        tenantIds: null,
        cabinetOids: null,
        workerId: 'wb-ads',
        roles: ['read_all_wb_digitization'],
      }, 'ab_tests_summary'),
    ).not.toThrow();
  });

  it('rejects report outside worker read scope', () => {
    expectAppError(() =>
      assertAgentWorkerReportAccess({
        id: 'procifry-lena',
        key: 'very-secret-agent-key',
        reports: null,
        tenantIds: null,
        cabinetOids: null,
        workerId: 'wb-reviews-qna-manager',
        roles: ['read_all_wb_digitization'],
      }, 'price_history'),
    {
      status: 403,
      message: 'Report not allowed for this worker',
    });
  });
});

describe('requireAgentApiClient', () => {
  it('accepts bearer token', () => {
    const request = new Request('http://localhost/api/agent/v1/report', {
      method: 'POST',
      headers: {
        authorization: 'Bearer very-secret-agent-key',
      },
    });

    const client = requireAgentApiClient(request, asEnv({
      AGENT_API_KEY: 'very-secret-agent-key',
      AGENT_API_CLIENT_ID: 'telegram-main',
    }));

    expect(client.id).toBe('telegram-main');
  });

  it('rejects invalid token', () => {
    const request = new Request('http://localhost/api/agent/v1/report', {
      method: 'POST',
      headers: {
        'x-agent-api-key': 'wrong-key',
      },
    });

    expectAppError(() =>
      requireAgentApiClient(request, {
        AGENT_API_KEY: 'very-secret-agent-key',
      } as unknown as NodeJS.ProcessEnv),
    {
      status: 401,
      message: 'Unauthorized',
    });
  });
});

describe('assertAgentClientAccess', () => {
  const client: AgentApiClient = {
    id: 'telegram-main',
    key: 'very-secret-agent-key',
    reports: ['dashboard_summary'],
    tenantIds: ['11111111-1111-4111-8111-111111111111'],
    cabinetOids: null,
    workerId: null,
    roles: [],
  };

  it('allows configured report and tenant', () => {
    expect(() =>
      assertAgentClientAccess(client, 'dashboard_summary', '11111111-1111-4111-8111-111111111111'),
    ).not.toThrow();
  });

  it('allows multiple tenants when all are in allowlist', () => {
    expect(() =>
      assertAgentClientAccess(
        {
          ...client,
          tenantIds: [
            '11111111-1111-4111-8111-111111111111',
            '22222222-2222-4222-8222-222222222222',
          ],
        },
        'dashboard_summary',
        [
          '11111111-1111-4111-8111-111111111111',
          '22222222-2222-4222-8222-222222222222',
        ],
      ),
    ).not.toThrow();
  });

  it('rejects report outside allowlist', () => {
    expectAppError(() =>
      assertAgentClientAccess(client, 'sync_status', '11111111-1111-4111-8111-111111111111'),
    {
      status: 403,
      message: 'Report not allowed for this client',
    });
  });

  it('lets worker RBAC expand a stale per-client report allowlist', () => {
    expect(() =>
      assertAgentClientAccess({
        ...client,
        id: 'procifry-ads',
        reports: ['advertising_by_nm_summary'],
        workerId: 'wb-ads',
        roles: ['read_all_wb_digitization'],
      }, 'ab_tests_summary', '11111111-1111-4111-8111-111111111111'),
    ).not.toThrow();
  });

  it('rejects tenant outside allowlist', () => {
    expectAppError(() =>
      assertAgentClientAccess(client, 'dashboard_summary', '22222222-2222-4222-8222-222222222222'),
    {
      status: 403,
      message: 'Tenant not allowed for this client',
    });
  });

  it('rejects any tenant outside allowlist in multi-tenant request', () => {
    expectAppError(() =>
      assertAgentClientAccess(client, 'dashboard_summary', [
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
      ]),
    {
      status: 403,
      message: 'Tenant not allowed for this client',
    });
  });
});

describe('assertProcifryClientAccess', () => {
  const client: AgentApiClient = {
    id: 'procifry-dima',
    key: 'very-secret-agent-key',
    reports: null,
    tenantIds: ['11111111-1111-4111-8111-111111111111'],
    cabinetOids: ['lavrov-main'],
    workerId: 'wb-data-integrator',
    roles: ['read_all_wb_digitization', 'write_analysis', 'write_tasks', 'request_approval'],
  };

  it('allows a worker-safe diagnostic write', () => {
    expect(() =>
      assertProcifryClientAccess(client, {
        workerId: 'wb-data-integrator',
        tenantIds: ['11111111-1111-4111-8111-111111111111'],
        cabinetOid: 'lavrov-main',
        multiTenant: false,
        resourceType: 'diagnostic',
        accessMode: 'draft',
      }),
    ).not.toThrow();
  });

  it('allows economics approval requests for warehouse delivery cost updates', () => {
    expect(() =>
      assertProcifryClientAccess({
        ...client,
        id: 'procifry-irina',
        workerId: 'wb-economics-analyst',
        roles: ['read_all_wb_digitization', 'write_analysis', 'request_approval'],
      }, {
        workerId: 'wb-economics-analyst',
        tenantIds: ['11111111-1111-4111-8111-111111111111'],
        cabinetOid: 'lavrov-main',
        multiTenant: false,
        resourceType: 'approval_request',
        accessMode: 'approval_required',
        actionType: 'warehouse_delivery_cost_update',
      }),
    ).not.toThrow();
  });

  it('allows procifry operator to create configured approval actions', () => {
    expect(() =>
      assertProcifryClientAccess({
        ...client,
        id: 'procifry-operator',
        workerId: 'wb-procifry-operator',
        roles: ['read_all_wb_digitization', 'write_analysis', 'write_tasks', 'write_drafts', 'write_scenarios', 'request_approval'],
      }, {
        workerId: 'wb-procifry-operator',
        tenantIds: ['11111111-1111-4111-8111-111111111111'],
        cabinetOid: 'lavrov-main',
        multiTenant: false,
        resourceType: 'approval_request',
        accessMode: 'approval_required',
        actionType: 'unit_economics_indices_update',
      }),
    ).not.toThrow();
  });

  it('rejects procifry operator approval actions outside its scope', () => {
    expectAppError(() =>
      assertProcifryClientAccess({
        ...client,
        id: 'procifry-operator',
        workerId: 'wb-procifry-operator',
        roles: ['read_all_wb_digitization', 'write_analysis', 'write_tasks', 'write_drafts', 'write_scenarios', 'request_approval'],
      }, {
        workerId: 'wb-procifry-operator',
        tenantIds: ['11111111-1111-4111-8111-111111111111'],
        cabinetOid: 'lavrov-main',
        multiTenant: false,
        resourceType: 'approval_request',
        accessMode: 'approval_required',
        actionType: 'ad_bid_change',
      }),
    {
      status: 403,
      message: 'Approval action is not allowed for this worker',
    });
  });

  it('rejects tenant mixing without explicit multi_tenant flag', () => {
    expectAppError(() =>
      assertProcifryClientAccess({
        ...client,
        tenantIds: null,
      }, {
        workerId: 'wb-data-integrator',
        tenantIds: [
          '11111111-1111-4111-8111-111111111111',
          '22222222-2222-4222-8222-222222222222',
        ],
        cabinetOid: 'lavrov-main',
        multiTenant: false,
        resourceType: 'diagnostic',
        accessMode: 'draft',
      }),
    {
      status: 400,
      message: 'multi_tenant=true is required for multi-tenant Procifry requests',
    });
  });

  it('rejects a worker writing outside its scope', () => {
    expectAppError(() =>
      assertProcifryClientAccess(client, {
        workerId: 'wb-data-integrator',
        tenantIds: ['11111111-1111-4111-8111-111111111111'],
        cabinetOid: 'lavrov-main',
        multiTenant: false,
        resourceType: 'scenario',
        accessMode: 'draft',
      }),
    {
      status: 403,
      message: 'Role required: write_scenarios',
    });
  });

  it('rejects direct execution without approval_id', () => {
    expectAppError(() =>
      assertProcifryClientAccess({
        ...client,
        workerId: 'procifry-action-executor',
        roles: ['read_all_wb_digitization', 'execute_approved_actions'],
      }, {
        workerId: 'procifry-action-executor',
        tenantIds: ['11111111-1111-4111-8111-111111111111'],
        cabinetOid: 'lavrov-main',
        multiTenant: false,
        resourceType: 'external_action',
        accessMode: 'executed',
        actionType: 'ad_bid_change',
      }),
    {
      status: 400,
      message: 'approval_id is required for executed actions',
    });
  });

  it('allows only configured cabinet_oids', () => {
    expectAppError(() =>
      assertProcifryClientAccess(client, {
        workerId: 'wb-data-integrator',
        tenantIds: ['11111111-1111-4111-8111-111111111111'],
        cabinetOid: 'berbeka-main',
        multiTenant: false,
        resourceType: 'diagnostic',
        accessMode: 'draft',
      }),
    {
      status: 403,
      message: 'Cabinet not allowed for this client',
    });
  });
});
