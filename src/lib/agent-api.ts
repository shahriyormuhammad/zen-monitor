import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

import { AppError } from '@/lib/errors';

export const AGENT_REPORTS = [
  'dashboard_summary',
  'unit_economics_summary',
  'sync_status',
  'cost_snapshot',
  'cost_breakdown_detail',
  'cost_warehouse_delivery_config',
  'sales_funnel_summary',
  'advertising_by_nm_summary',
  'stocks_summary',
  'stock_history',
  'oos_history',
  'reviews_summary',
  'questions_summary',
  'card_content_summary',
  'card_group_summary',
  'price_history',
  'advertising_campaigns',
  'advertising_campaign_stats',
  'search_positions_summary',
  'competitor_cards_summary',
  'ab_tests_summary',
  'finance_realization_detail',
  'orders_sales_summary',
  'fulfillment_summary',
  'tariffs_rules_summary',
  'worker_artifacts_summary',
  'niche_category_summary',
] as const;

export type AgentReportId = (typeof AGENT_REPORTS)[number];

export const PROCIFRY_ROLES = [
  'read_all_wb_digitization',
  'write_analysis',
  'write_tasks',
  'write_drafts',
  'write_scenarios',
  'request_approval',
  'execute_approved_actions',
  'admin_methodology',
] as const;

export const PROCIFRY_WORKERS = [
  'wb-data-integrator',
  'wb-economics-analyst',
  'wb-ads-analyst',
  'wb-assortment-ops',
  'wb-seo-card-analyst',
  'wb-competitor-analyst',
  'wb-creative-designer',
  'wb-creative-performance-analyst',
  'wb-pricing-promo-analyst',
  'wb-reviews-qna-manager',
  'wb-market-watchdog',
  'wb-niche-researcher',
  'wb-report-compiler',
  'wb-growth-manager',
  'wb-packaging-buyout',
  'wb-chief',
  'wb-data',
  'wb-economics',
  'wb-ads',
  'wb-content',
  'wb-ops',
  'wb-reviews',
  'wb-market',
  'wb-procifry-operator',
  'procifry-action-executor',
] as const;

export const PROCIFRY_RESOURCE_TYPES = [
  'read_request',
  'analysis',
  'diagnostic',
  'task',
  'draft',
  'scenario',
  'approval_request',
  'source_status',
  'tag',
  'eval',
  'lesson',
  'sanity_test',
  'recommendation',
  'report',
  'plan',
  'external_action',
] as const;

export const PROCIFRY_ACCESS_MODES = [
  'read_only',
  'draft',
  'approval_required',
  'executed',
] as const;

export const PROCIFRY_CONFIDENCE_LEVELS = [
  'confirmed',
  'partial',
  'stale',
  'missing',
] as const;

export type ProcifryRole = (typeof PROCIFRY_ROLES)[number];
export type ProcifryWorkerId = (typeof PROCIFRY_WORKERS)[number];
export type ProcifryResourceType = (typeof PROCIFRY_RESOURCE_TYPES)[number];
export type ProcifryAccessMode = (typeof PROCIFRY_ACCESS_MODES)[number];
export type ProcifryConfidence = (typeof PROCIFRY_CONFIDENCE_LEVELS)[number];

type WorkerPolicy = {
  safeWriteTypes: readonly ProcifryResourceType[];
  approvalActionTypes: readonly string[];
  readReports: readonly AgentReportId[] | '*';
};

type JarvisProcifryWorkerId = Extract<
  ProcifryWorkerId,
  | 'wb-chief'
  | 'wb-data'
  | 'wb-economics'
  | 'wb-ads'
  | 'wb-content'
  | 'wb-ops'
  | 'wb-reviews'
  | 'wb-market'
>;
type LegacyProcifryWorkerId = Exclude<ProcifryWorkerId, JarvisProcifryWorkerId>;

const ALL_READ_REPORTS = '*' as const;

const COMMON_SAFE_WRITES = [
  'tag',
  'eval',
  'lesson',
  'sanity_test',
] as const satisfies readonly ProcifryResourceType[];

const LEGACY_PROCIFRY_WORKER_POLICIES: Record<LegacyProcifryWorkerId, WorkerPolicy> = {
  'wb-data-integrator': {
    safeWriteTypes: ['source_status', 'diagnostic', 'task', ...COMMON_SAFE_WRITES],
    approvalActionTypes: ['heavy_backfill', 'sync_run', 'vitrine_change'],
    readReports: ALL_READ_REPORTS,
  },
  'wb-economics-analyst': {
    safeWriteTypes: ['analysis', 'scenario', 'recommendation', 'task', ...COMMON_SAFE_WRITES],
    approvalActionTypes: ['cost_update', 'warehouse_delivery_cost_update', 'unit_economics_indices_update', 'tax_methodology_change', 'baseline_formula_change'],
    readReports: [
      'unit_economics_summary',
      'cost_snapshot',
      'cost_breakdown_detail',
      'cost_warehouse_delivery_config',
      'advertising_by_nm_summary',
      'advertising_campaign_stats',
      'price_history',
      'finance_realization_detail',
    ],
  },
  'wb-ads-analyst': {
    safeWriteTypes: ['analysis', 'diagnostic', 'recommendation', 'task', 'scenario', ...COMMON_SAFE_WRITES],
    approvalActionTypes: ['ad_bid_change', 'ad_budget_change', 'campaign_launch', 'campaign_stop'],
    readReports: [
      'advertising_by_nm_summary',
      'advertising_campaigns',
      'advertising_campaign_stats',
      'ab_tests_summary',
      'card_group_summary',
      'sales_funnel_summary',
    ],
  },
  'wb-assortment-ops': {
    safeWriteTypes: ['analysis', 'recommendation', 'task', 'draft', 'scenario', ...COMMON_SAFE_WRITES],
    approvalActionTypes: ['fulfillment_stock_update', 'supply_create', 'stock_transfer', 'purchase_order', 'warehouse_plan_change'],
    readReports: [
      'stocks_summary',
      'stock_history',
      'oos_history',
      'orders_sales_summary',
      'fulfillment_summary',
    ],
  },
  'wb-seo-card-analyst': {
    safeWriteTypes: ['analysis', 'draft', 'recommendation', 'task', ...COMMON_SAFE_WRITES],
    approvalActionTypes: ['card_title_update', 'card_description_update', 'card_characteristics_update'],
    readReports: [
      'card_content_summary',
      'search_positions_summary',
      'competitor_cards_summary',
      'sales_funnel_summary',
      'reviews_summary',
      'questions_summary',
    ],
  },
  'wb-competitor-analyst': {
    safeWriteTypes: ['analysis', 'recommendation', 'task', ...COMMON_SAFE_WRITES],
    approvalActionTypes: [],
    readReports: [
      'competitor_cards_summary',
      'search_positions_summary',
      'card_group_summary',
      'price_history',
    ],
  },
  'wb-creative-designer': {
    safeWriteTypes: ['draft', 'recommendation', 'task', ...COMMON_SAFE_WRITES],
    approvalActionTypes: ['card_media_upload'],
    readReports: [
      'card_content_summary',
      'reviews_summary',
      'questions_summary',
      'competitor_cards_summary',
      'sales_funnel_summary',
    ],
  },
  'wb-creative-performance-analyst': {
    safeWriteTypes: ['analysis', 'recommendation', 'task', 'eval', ...COMMON_SAFE_WRITES],
    approvalActionTypes: ['creative_winner_apply', 'card_media_change'],
    readReports: [
      'ab_tests_summary',
      'sales_funnel_summary',
      'card_content_summary',
      'advertising_campaign_stats',
    ],
  },
  'wb-pricing-promo-analyst': {
    safeWriteTypes: ['analysis', 'diagnostic', 'scenario', 'recommendation', 'task', ...COMMON_SAFE_WRITES],
    approvalActionTypes: ['seller_price_change', 'discount_change', 'promo_participation'],
    readReports: [
      'price_history',
      'competitor_cards_summary',
      'unit_economics_summary',
      'cost_breakdown_detail',
      'sales_funnel_summary',
    ],
  },
  'wb-reviews-qna-manager': {
    safeWriteTypes: ['analysis', 'draft', 'task', ...COMMON_SAFE_WRITES],
    approvalActionTypes: ['review_reply_publish', 'question_reply_publish', 'review_complaint', 'points_for_reviews_start'],
    readReports: ['reviews_summary', 'questions_summary'],
  },
  'wb-market-watchdog': {
    safeWriteTypes: ['analysis', 'recommendation', 'task', ...COMMON_SAFE_WRITES],
    approvalActionTypes: ['methodology_change', 'formula_change'],
    readReports: ['sync_status', 'tariffs_rules_summary'],
  },
  'wb-niche-researcher': {
    safeWriteTypes: ['analysis', 'scenario', 'recommendation', 'task', ...COMMON_SAFE_WRITES],
    approvalActionTypes: ['purchase_decision', 'supplier_choice', 'product_launch'],
    readReports: [
      'niche_category_summary',
      'competitor_cards_summary',
      'search_positions_summary',
      'sales_funnel_summary',
      'price_history',
    ],
  },
  'wb-report-compiler': {
    safeWriteTypes: ['report', 'plan', 'task', ...COMMON_SAFE_WRITES],
    approvalActionTypes: [],
    readReports: ALL_READ_REPORTS,
  },
  'wb-growth-manager': {
    safeWriteTypes: ['analysis', 'plan', 'task', 'recommendation', ...COMMON_SAFE_WRITES],
    approvalActionTypes: [
      'heavy_backfill',
      'sync_run',
      'cost_update',
      'warehouse_delivery_cost_update',
      'unit_economics_indices_update',
      'tax_methodology_change',
      'baseline_formula_change',
      'ad_bid_change',
      'ad_budget_change',
      'campaign_launch',
      'campaign_stop',
      'supply_create',
      'stock_transfer',
      'purchase_order',
      'warehouse_plan_change',
      'fulfillment_stock_update',
      'card_title_update',
      'card_description_update',
      'card_characteristics_update',
      'card_media_upload',
      'creative_winner_apply',
      'card_media_change',
      'seller_price_change',
      'discount_change',
      'promo_participation',
      'review_reply_publish',
      'question_reply_publish',
      'review_complaint',
      'points_for_reviews_start',
      'methodology_change',
      'formula_change',
      'purchase_decision',
      'supplier_choice',
      'product_launch',
      'packaging_change',
      'bundle_change',
    ],
    readReports: ALL_READ_REPORTS,
  },
  'wb-packaging-buyout': {
    safeWriteTypes: ['analysis', 'draft', 'recommendation', 'task', ...COMMON_SAFE_WRITES],
    approvalActionTypes: ['packaging_change', 'bundle_change'],
    readReports: [
      'reviews_summary',
      'stocks_summary',
      'stock_history',
      'finance_realization_detail',
      'sales_funnel_summary',
    ],
  },
  'wb-procifry-operator': {
    safeWriteTypes: [
      'analysis',
      'diagnostic',
      'source_status',
      'task',
      'plan',
      'draft',
      'scenario',
      'recommendation',
      'report',
      ...COMMON_SAFE_WRITES,
    ],
    approvalActionTypes: [
      'warehouse_delivery_cost_update',
      'unit_economics_indices_update',
      'fulfillment_stock_update',
    ],
    readReports: ALL_READ_REPORTS,
  },
  'procifry-action-executor': {
    safeWriteTypes: ['external_action', ...COMMON_SAFE_WRITES],
    approvalActionTypes: ['*'],
    readReports: ['sync_status'],
  },
};

const PROCIFRY_WORKER_POLICIES: Record<ProcifryWorkerId, WorkerPolicy> = {
  ...LEGACY_PROCIFRY_WORKER_POLICIES,
  'wb-chief': {
    ...LEGACY_PROCIFRY_WORKER_POLICIES['wb-growth-manager'],
    readReports: ALL_READ_REPORTS,
  },
  'wb-data': {
    ...LEGACY_PROCIFRY_WORKER_POLICIES['wb-data-integrator'],
    readReports: ALL_READ_REPORTS,
  },
  'wb-economics': {
    ...LEGACY_PROCIFRY_WORKER_POLICIES['wb-economics-analyst'],
    readReports: ALL_READ_REPORTS,
  },
  'wb-ads': {
    ...LEGACY_PROCIFRY_WORKER_POLICIES['wb-ads-analyst'],
    readReports: ALL_READ_REPORTS,
  },
  'wb-content': {
    ...LEGACY_PROCIFRY_WORKER_POLICIES['wb-seo-card-analyst'],
    readReports: ALL_READ_REPORTS,
  },
  'wb-ops': {
    ...LEGACY_PROCIFRY_WORKER_POLICIES['wb-assortment-ops'],
    readReports: ALL_READ_REPORTS,
  },
  'wb-reviews': {
    ...LEGACY_PROCIFRY_WORKER_POLICIES['wb-reviews-qna-manager'],
    readReports: ALL_READ_REPORTS,
  },
  'wb-market': {
    ...LEGACY_PROCIFRY_WORKER_POLICIES['wb-niche-researcher'],
    readReports: ALL_READ_REPORTS,
  },
};

export type AgentApiClient = {
  id: string;
  key: string;
  reports: AgentReportId[] | null;
  tenantIds: string[] | null;
  cabinetOids: string[] | null;
  workerId: ProcifryWorkerId | null;
  roles: ProcifryRole[] | null;
};

const agentReportSchema = z.enum(AGENT_REPORTS);
const procifryRoleSchema = z.enum(PROCIFRY_ROLES);
const procifryWorkerSchema = z.enum(PROCIFRY_WORKERS);
const agentClientSchema = z.object({
  id: z.string().trim().min(1),
  key: z.string().trim().min(16),
  reports: z.union([z.literal('*'), z.array(agentReportSchema)]).optional(),
  tenantIds: z.union([z.literal('*'), z.array(z.string().uuid())]).optional(),
  cabinetOids: z.union([z.literal('*'), z.array(z.string().trim().min(1))]).optional(),
  workerId: procifryWorkerSchema.optional(),
  roles: z.union([z.literal('*'), z.array(procifryRoleSchema)]).optional(),
});

function splitCsv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeReports(value: '*' | AgentReportId[] | undefined): AgentReportId[] | null {
  if (!value || value === '*') {
    return null;
  }
  return [...value];
}

function normalizeTenantIds(value: '*' | string[] | undefined): string[] | null {
  if (!value || value === '*') {
    return null;
  }
  return [...value];
}

function normalizeCabinetOids(value: '*' | string[] | undefined): string[] | null {
  if (!value || value === '*') {
    return null;
  }
  return [...value];
}

function normalizeRoles(value: '*' | ProcifryRole[] | undefined): ProcifryRole[] | null {
  if (value === '*') {
    return null;
  }
  return [...(value ?? [])];
}

function parseReportCsv(value: string | undefined): AgentReportId[] | null {
  const entries = splitCsv(value);
  if (entries.length === 0) {
    return null;
  }
  return entries.map((entry) => agentReportSchema.parse(entry));
}

function parseTenantIdCsv(value: string | undefined): string[] | null {
  const entries = splitCsv(value);
  if (entries.length === 0) {
    return null;
  }
  return entries.map((entry) => z.string().uuid().parse(entry));
}

function parseCabinetOidCsv(value: string | undefined): string[] | null {
  const entries = splitCsv(value);
  return entries.length === 0 ? null : entries;
}

function parseRoleCsv(value: string | undefined): ProcifryRole[] {
  const entries = splitCsv(value);
  return entries.map((entry) => procifryRoleSchema.parse(entry));
}

function parseJsonClients(raw: string): AgentApiClient[] {
  const parsed = z.array(agentClientSchema).parse(JSON.parse(raw));
  return parsed.map((client) => ({
    id: client.id,
    key: client.key,
    reports: normalizeReports(client.reports),
    tenantIds: normalizeTenantIds(client.tenantIds),
    cabinetOids: normalizeCabinetOids(client.cabinetOids),
    workerId: client.workerId ?? null,
    roles: normalizeRoles(client.roles),
  }));
}

export function parseAgentApiClients(
  env: NodeJS.ProcessEnv = process.env,
): AgentApiClient[] {
  const rawClients = env.AGENT_API_CLIENTS?.trim();
  if (rawClients) {
    try {
      return parseJsonClients(rawClients);
    } catch {
      throw new AppError('Agent API is misconfigured', 503);
    }
  }

  const key = env.AGENT_API_KEY?.trim();
  if (!key) {
    return [];
  }

  try {
    return [
      {
        id: env.AGENT_API_CLIENT_ID?.trim() || 'default',
        key,
        reports: parseReportCsv(env.AGENT_API_ALLOWED_REPORTS),
        tenantIds: parseTenantIdCsv(env.AGENT_API_ALLOWED_TENANT_IDS),
        cabinetOids: parseCabinetOidCsv(env.AGENT_API_ALLOWED_CABINET_OIDS),
        workerId: env.AGENT_API_WORKER_ID?.trim()
          ? procifryWorkerSchema.parse(env.AGENT_API_WORKER_ID.trim())
          : null,
        roles: parseRoleCsv(env.AGENT_API_ROLES),
      },
    ];
  } catch {
    throw new AppError('Agent API is misconfigured', 503);
  }
}

function safeKeyEquals(expected: string, actual: string) {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, actualBuffer);
}

function readAgentApiKey(request: Request): string | null {
  const authorization = request.headers.get('authorization')?.trim();
  if (authorization?.toLowerCase().startsWith('bearer ')) {
    const token = authorization.slice(7).trim();
    return token || null;
  }

  const headerKey = request.headers.get('x-agent-api-key')?.trim();
  return headerKey || null;
}

export function requireAgentApiClient(
  request: Request,
  env: NodeJS.ProcessEnv = process.env,
): AgentApiClient {
  const clients = parseAgentApiClients(env);
  if (clients.length === 0) {
    throw new AppError('Agent API is not configured', 503);
  }

  const incomingKey = readAgentApiKey(request);
  if (!incomingKey) {
    throw new AppError('Unauthorized', 401);
  }

  const client = clients.find((item) => safeKeyEquals(item.key, incomingKey));
  if (!client) {
    throw new AppError('Unauthorized', 401);
  }

  return client;
}

export function assertAgentClientAccess(
  client: AgentApiClient,
  report: AgentReportId,
  tenantIdOrIds: string | string[] | null | undefined,
) {
  if (client.reports && !client.reports.includes(report)) {
    const workerPolicy = client.workerId ? PROCIFRY_WORKER_POLICIES[client.workerId] : null;
    const workerAllowsReport = workerPolicy?.readReports === '*'
      || Boolean(workerPolicy?.readReports.includes(report));
    if (!workerAllowsReport || !clientHasRole(client, 'read_all_wb_digitization')) {
      throw new AppError('Report not allowed for this client', 403);
    }
  }

  if (!client.tenantIds) {
    return;
  }

  const requestedTenantIds = Array.isArray(tenantIdOrIds)
    ? tenantIdOrIds
    : tenantIdOrIds
      ? [tenantIdOrIds]
      : [];

  for (const tenantId of requestedTenantIds) {
    if (!client.tenantIds.includes(tenantId)) {
      throw new AppError('Tenant not allowed for this client', 403);
    }
  }
}

export function assertAgentTenantAccess(
  client: AgentApiClient,
  tenantIdOrIds: string | string[] | null | undefined,
) {
  const requestedTenantIds = Array.isArray(tenantIdOrIds)
    ? tenantIdOrIds
    : tenantIdOrIds
      ? [tenantIdOrIds]
      : [];

  assertClientTenantAccess(client, requestedTenantIds);
}

export function assertAgentWorkerReportAccess(
  client: AgentApiClient,
  report: AgentReportId,
) {
  if (!client.workerId) {
    return;
  }

  const policy = PROCIFRY_WORKER_POLICIES[client.workerId];
  if (!policy) {
    throw new AppError('Unknown Procifry worker_id', 400);
  }
  if (policy.readReports === '*') {
    return;
  }
  if (!policy.readReports.includes(report)) {
    throw new AppError('Report not allowed for this worker', 403);
  }
}

function assertClientTenantAccess(
  client: AgentApiClient,
  tenantIds: readonly string[],
) {
  if (!client.tenantIds) {
    return;
  }

  for (const tenantId of tenantIds) {
    if (!client.tenantIds.includes(tenantId)) {
      throw new AppError('Tenant not allowed for this client', 403);
    }
  }
}

function clientHasRole(client: AgentApiClient, role: ProcifryRole) {
  return client.roles === null || client.roles.includes(role);
}

function requireClientRole(client: AgentApiClient, role: ProcifryRole) {
  if (!clientHasRole(client, role)) {
    throw new AppError(`Role required: ${role}`, 403);
  }
}

function requiredRoleForResource(resourceType: ProcifryResourceType): ProcifryRole {
  switch (resourceType) {
    case 'read_request':
      return 'read_all_wb_digitization';
    case 'task':
    case 'plan':
      return 'write_tasks';
    case 'draft':
      return 'write_drafts';
    case 'scenario':
      return 'write_scenarios';
    case 'approval_request':
      return 'request_approval';
    case 'external_action':
      return 'execute_approved_actions';
    case 'analysis':
    case 'diagnostic':
    case 'source_status':
    case 'tag':
    case 'eval':
    case 'lesson':
    case 'sanity_test':
    case 'recommendation':
    case 'report':
      return 'write_analysis';
    default: {
      const exhaustiveCheck: never = resourceType;
      return exhaustiveCheck;
    }
  }
}

export function assertProcifryClientAccess(
  client: AgentApiClient,
  request: {
    workerId: ProcifryWorkerId;
    tenantIds: readonly string[];
    cabinetOid: string;
    multiTenant: boolean;
    resourceType: ProcifryResourceType;
    accessMode: ProcifryAccessMode;
    actionType?: string | null;
    approvalId?: string | null;
    allowAutonomousExternalAction?: boolean;
  },
) {
  const tenantIds = [...new Set(request.tenantIds.filter(Boolean))];
  if (tenantIds.length === 0) {
    throw new AppError('tenantId is required', 400);
  }
  if (tenantIds.length > 1 && !request.multiTenant) {
    throw new AppError('multi_tenant=true is required for multi-tenant Procifry requests', 400);
  }

  assertClientTenantAccess(client, tenantIds);

  if (client.cabinetOids && !client.cabinetOids.includes(request.cabinetOid)) {
    throw new AppError('Cabinet not allowed for this client', 403);
  }

  if (client.workerId && client.workerId !== request.workerId) {
    throw new AppError('worker_id does not match this API client', 403);
  }

  if (!client.workerId && !clientHasRole(client, 'execute_approved_actions')) {
    throw new AppError('Procifry API client must be bound to a worker_id', 403);
  }

  const workerPolicy = PROCIFRY_WORKER_POLICIES[request.workerId];
  if (!workerPolicy) {
    throw new AppError('Unknown Procifry worker_id', 400);
  }

  if (request.accessMode === 'read_only') {
    if (request.resourceType !== 'read_request') {
      throw new AppError('read_only requests must use resource_type=read_request', 400);
    }
    requireClientRole(client, 'read_all_wb_digitization');
    return;
  }

  const requiredRole = requiredRoleForResource(request.resourceType);
  requireClientRole(client, requiredRole);

  const workerCanWriteResource = workerPolicy.safeWriteTypes.includes(request.resourceType)
    || request.resourceType === 'approval_request'
    || request.resourceType === 'external_action';
  if (!workerCanWriteResource) {
    throw new AppError('Resource type is not allowed for this worker', 403);
  }

  if (request.resourceType === 'approval_request') {
    if (request.accessMode !== 'approval_required') {
      throw new AppError('approval_request must use access_mode=approval_required', 400);
    }
    const actionType = request.actionType?.trim();
    if (!actionType) {
      throw new AppError('action_type is required for approval_request', 400);
    }
    if (
      !workerPolicy.approvalActionTypes.includes('*')
      && !workerPolicy.approvalActionTypes.includes(actionType)
    ) {
      throw new AppError('Approval action is not allowed for this worker', 403);
    }
  }

  if (request.resourceType === 'external_action' || request.accessMode === 'executed') {
    if (request.resourceType !== 'external_action' || request.accessMode !== 'executed') {
      throw new AppError('executed requests must use resource_type=external_action and access_mode=executed', 400);
    }
    requireClientRole(client, 'execute_approved_actions');
    if (!request.approvalId && !request.allowAutonomousExternalAction) {
      throw new AppError('approval_id is required for executed actions', 400);
    }
  }
}
