import { sql } from 'drizzle-orm';

import { requirePlatformAdmin } from '@/lib/auth/platform-admin';
import { resolveSubscriptionEntitlement, type EffectiveSubscriptionStatus } from '@/lib/billing/subscription';
import { db, withAdminContext } from '@/lib/db';
import { platformAuditLog } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

type OverviewStatsRow = {
  tenantCount: number;
  userCount: number;
  activeSubscriptions: number;
  trialingSubscriptions: number;
  pastDueSubscriptions: number;
  expiredSubscriptions: number;
  endingSoonSubscriptions: number;
  failedPaymentsLast30d: number;
  revenueLast30dRub: string | number | null;
  staleSyncTenants: number;
  invalidTokenTenants: number;
};

type LeadDeletionTargetRow = {
  id: string;
  leadId: string | null;
  email: string;
  userId: string | null;
  tenantId: string | null;
  tenantCount: number;
  tenantNames: string | null;
  source: string;
  status: string;
  createdAt: Date | string;
};

type TenantDeletionTargetRow = {
  tenantId: string;
  name: string;
  shopName: string | null;
  createdAt: Date | string;
  userCount: number;
  leadCount: number;
  subscriptionCount: number;
  paymentCount: number;
  syncRunCount: number;
  productCount: number;
};

type TenantDeletionMemberRow = {
  userId: string;
  email: string | null;
  tenantCount: number;
  fallbackTenantId: string | null;
  fallbackRole: string | null;
  isPlatformAdmin: boolean;
};

export type AdminCustomerDeletionResult = {
  tenantId: string;
  tenantName: string;
  deletedAppUsers: number;
  deletedAuthUsers: number;
  preservedAppUsers: number;
  authDeleteErrors: string[];
};

export type AdminOverview = {
  stats: {
    accountCount: number;
    tenantCount: number;
    userCount: number;
    activeSubscriptions: number;
    trialingSubscriptions: number;
    pastDueSubscriptions: number;
    expiredSubscriptions: number;
    endingSoonSubscriptions: number;
    failedPaymentsLast30d: number;
    revenueLast30dRub: number;
    staleSyncTenants: number;
    invalidTokenTenants: number;
  };
  endingSoon: AdminSubscriptionListItem[];
  latestAccounts: AdminAccountListItem[];
};

type CustomerListRow = {
  tenantId: string;
  name: string;
  shopName: string | null;
  createdAt: Date | string;
  wbTokenHealthStatus: string;
  wbTokenCheckedAt: Date | string | null;
  wbLkSessionStatus: string;
  wbLkSessionCheckedAt: Date | string | null;
  ownerEmails: string[] | null;
  usersCount: number;
  subscriptionId: string | null;
  subscriptionStatus: string | null;
  currentPeriodEnd: Date | string | null;
  trialEndsAt: Date | string | null;
  graceUntil: Date | string | null;
  planCode: string | null;
  planName: string | null;
  priceRub: string | number | null;
  latestSyncStatus: string | null;
  latestSyncAt: Date | string | null;
};

export type AdminCustomerListItem = {
  tenantId: string;
  name: string;
  shopName: string | null;
  createdAt: Date;
  ownerEmails: string[];
  usersCount: number;
  wbTokenHealthStatus: string;
  wbTokenCheckedAt: Date | null;
  wbLkSessionStatus: string;
  wbLkSessionCheckedAt: Date | null;
  subscription: {
    id: string | null;
    status: string | null;
    effectiveStatus: EffectiveSubscriptionStatus;
    hasAccess: boolean;
    reason: string;
    currentPeriodEnd: Date | null;
    trialEndsAt: Date | null;
    graceUntil: Date | null;
    planCode: string | null;
    planName: string | null;
    priceRub: number | null;
  };
  latestSync: {
    status: string | null;
    at: Date | null;
  };
};

export type AdminAccountListItem = {
  accountKey: string;
  ownerEmail: string | null;
  storeCount: number;
  createdAt: Date;
  stores: AdminCustomerListItem[];
};

type SubscriptionListRow = {
  subscriptionId: string;
  tenantId: string;
  tenantName: string;
  shopName: string | null;
  status: string;
  currentPeriodStart: Date | string | null;
  currentPeriodEnd: Date | string | null;
  trialEndsAt: Date | string | null;
  graceUntil: Date | string | null;
  cancelAtPeriodEnd: boolean;
  provider: string;
  planCode: string | null;
  planName: string | null;
  priceRub: string | number | null;
  ownerEmails: string[] | null;
};

export type AdminSubscriptionListItem = {
  subscriptionId: string;
  tenantId: string;
  tenantName: string;
  shopName: string | null;
  status: string;
  effectiveStatus: EffectiveSubscriptionStatus;
  hasAccess: boolean;
  reason: string;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  trialEndsAt: Date | null;
  graceUntil: Date | null;
  cancelAtPeriodEnd: boolean;
  provider: string;
  planCode: string | null;
  planName: string | null;
  priceRub: number | null;
  ownerEmails: string[];
};

type TenantDetailRow = {
  tenantId: string;
  name: string;
  shopName: string | null;
  taxType: string;
  taxRate: string | number;
  createdAt: Date | string;
  wbTokenHealthStatus: string;
  wbTokenCheckedAt: Date | string | null;
  wbLkPhone: string | null;
  wbLkSessionStatus: string;
  wbLkSessionCheckedAt: Date | string | null;
  notificationsEnabled: boolean;
  telegramChatId: number | null;
};

export type AdminTenantMember = {
  userId: string;
  email: string | null;
  role: string;
  joinedAt: Date | string;
};

export type AdminPaymentItem = {
  id: string;
  status: string;
  provider: string;
  providerPaymentId: string | null;
  amountRub: number;
  currency: string;
  paidAt: Date | string | null;
  dueAt: Date | string | null;
  createdAt: Date | string;
};

export type AdminSyncRunItem = {
  id: string;
  status: string;
  triggerSource: string;
  requestedAt: Date | string;
  startedAt: Date | string | null;
  finishedAt: Date | string | null;
  errorMessage: string | null;
};

export type AdminAuditItem = {
  id: string;
  actorUserId: string | null;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string | null;
  reason: string | null;
  createdAt: Date | string;
};

export type AdminLeadListItem = {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  source: string;
  status: string;
  selectedPlanCode: string | null;
  userId: string | null;
  tenantId: string | null;
  tenantName: string | null;
  tenantCount: number;
  tenantNames: string | null;
  isBackfilled: boolean;
  metadata: Record<string, unknown>;
  lastActivityAt: Date | string;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type AdminCustomerDetail = {
  tenant: TenantDetailRow;
  members: AdminTenantMember[];
  subscriptions: AdminSubscriptionListItem[];
  payments: AdminPaymentItem[];
  syncRuns: AdminSyncRunItem[];
  audit: AdminAuditItem[];
};

function toNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toRequiredNumber(value: string | number | null | undefined) {
  return toNumber(value) ?? 0;
}

function toDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toRequiredDate(value: Date | string | null | undefined) {
  return toDate(value) ?? new Date(0);
}

function asRows<T>(rows: unknown): T[] {
  return rows as T[];
}

function getCustomerAccountKey(customer: AdminCustomerListItem) {
  const ownerEmail = customer.ownerEmails[0]?.trim().toLowerCase();
  return ownerEmail || `tenant:${customer.tenantId}`;
}

function groupCustomersByAccount(customers: AdminCustomerListItem[]): AdminAccountListItem[] {
  const groups = new Map<string, AdminAccountListItem>();

  for (const customer of customers) {
    const accountKey = getCustomerAccountKey(customer);
    const existing = groups.get(accountKey);

    if (existing) {
      existing.stores.push(customer);
      existing.storeCount = existing.stores.length;
      if (customer.createdAt.getTime() > existing.createdAt.getTime()) {
        existing.createdAt = customer.createdAt;
      }
      continue;
    }

    groups.set(accountKey, {
      accountKey,
      ownerEmail: customer.ownerEmails[0] ?? null,
      storeCount: 1,
      createdAt: customer.createdAt,
      stores: [customer],
    });
  }

  return [...groups.values()]
    .map((account) => ({
      ...account,
      stores: account.stores.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    }))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

function mapCustomerRow(row: CustomerListRow): AdminCustomerListItem {
  const currentPeriodEnd = toDate(row.currentPeriodEnd);
  const trialEndsAt = toDate(row.trialEndsAt);
  const graceUntil = toDate(row.graceUntil);
  const entitlement = resolveSubscriptionEntitlement(row.subscriptionStatus
    ? {
        status: row.subscriptionStatus,
        currentPeriodEnd,
        trialEndsAt,
        graceUntil,
      }
    : null);

  return {
    tenantId: row.tenantId,
    name: row.name,
    shopName: row.shopName,
    createdAt: toRequiredDate(row.createdAt),
    ownerEmails: row.ownerEmails ?? [],
    usersCount: Number(row.usersCount ?? 0),
    wbTokenHealthStatus: row.wbTokenHealthStatus,
    wbTokenCheckedAt: toDate(row.wbTokenCheckedAt),
    wbLkSessionStatus: row.wbLkSessionStatus,
    wbLkSessionCheckedAt: toDate(row.wbLkSessionCheckedAt),
    subscription: {
      id: row.subscriptionId,
      status: row.subscriptionStatus,
      effectiveStatus: entitlement.effectiveStatus,
      hasAccess: entitlement.hasAccess,
      reason: entitlement.reason,
      currentPeriodEnd,
      trialEndsAt,
      graceUntil,
      planCode: row.planCode,
      planName: row.planName,
      priceRub: toNumber(row.priceRub),
    },
    latestSync: {
      status: row.latestSyncStatus,
      at: toDate(row.latestSyncAt),
    },
  };
}

function mapSubscriptionRow(row: SubscriptionListRow): AdminSubscriptionListItem {
  const currentPeriodStart = toDate(row.currentPeriodStart);
  const currentPeriodEnd = toDate(row.currentPeriodEnd);
  const trialEndsAt = toDate(row.trialEndsAt);
  const graceUntil = toDate(row.graceUntil);
  const entitlement = resolveSubscriptionEntitlement({
    status: row.status,
    currentPeriodEnd,
    trialEndsAt,
    graceUntil,
  });

  return {
    subscriptionId: row.subscriptionId,
    tenantId: row.tenantId,
    tenantName: row.tenantName,
    shopName: row.shopName,
    status: row.status,
    effectiveStatus: entitlement.effectiveStatus,
    hasAccess: entitlement.hasAccess,
    reason: entitlement.reason,
    currentPeriodStart,
    currentPeriodEnd,
    trialEndsAt,
    graceUntil,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    provider: row.provider,
    planCode: row.planCode,
    planName: row.planName,
    priceRub: toNumber(row.priceRub),
    ownerEmails: row.ownerEmails ?? [],
  };
}

async function loadCustomerRows(limit?: number) {
  const limitSql = typeof limit === 'number' ? sql`LIMIT ${limit}` : sql``;
  const rows = await withAdminContext(db, (tx) => tx.execute(sql<CustomerListRow>`
    WITH latest_subscription AS (
      SELECT DISTINCT ON (s.tenant_id)
        s.id,
        s.tenant_id,
        s.status,
        s.current_period_end,
        s.trial_ends_at,
        s.grace_until,
        p.code AS plan_code,
        p.name AS plan_name,
        p.price_rub
      FROM subscriptions s
      LEFT JOIN plans p ON p.id = s.plan_id
      ORDER BY s.tenant_id, s.created_at DESC
    ),
    latest_sync AS (
      SELECT DISTINCT ON (sr.tenant_id)
        sr.tenant_id,
        sr.status,
        COALESCE(sr.finished_at, sr.started_at, sr.requested_at) AS latest_sync_at
      FROM sync_runs sr
      ORDER BY sr.tenant_id, sr.requested_at DESC
    ),
    tenant_user_edges AS (
      SELECT ut.tenant_id, ut.user_id, ut.role, ut.created_at
      FROM user_tenants ut
      UNION ALL
      SELECT u.tenant_id, u.id AS user_id, 'owner'::varchar AS role, u.created_at
      FROM users u
      WHERE u.tenant_id IS NOT NULL
    ),
    tenant_users AS (
      SELECT
        tue.tenant_id,
        COUNT(DISTINCT tue.user_id)::int AS users_count,
        COALESCE(
          array_remove(array_agg(DISTINCT u.email ORDER BY u.email) FILTER (WHERE tue.role = 'owner'), NULL),
          ARRAY[]::varchar[]
        ) AS owner_emails
      FROM tenant_user_edges tue
      LEFT JOIN users u ON u.id = tue.user_id
      GROUP BY tue.tenant_id
    )
    SELECT
      t.id::text AS "tenantId",
      t.name,
      t.shop_name AS "shopName",
      t.created_at AS "createdAt",
      t.wb_token_health_status AS "wbTokenHealthStatus",
      t.wb_token_checked_at AS "wbTokenCheckedAt",
      t.wb_lk_session_status AS "wbLkSessionStatus",
      t.wb_lk_session_checked_at AS "wbLkSessionCheckedAt",
      COALESCE(tu.owner_emails, ARRAY[]::varchar[]) AS "ownerEmails",
      COALESCE(tu.users_count, 0)::int AS "usersCount",
      ls.id::text AS "subscriptionId",
      ls.status AS "subscriptionStatus",
      ls.current_period_end AS "currentPeriodEnd",
      ls.trial_ends_at AS "trialEndsAt",
      ls.grace_until AS "graceUntil",
      ls.plan_code AS "planCode",
      ls.plan_name AS "planName",
      ls.price_rub AS "priceRub",
      lsr.status AS "latestSyncStatus",
      lsr.latest_sync_at AS "latestSyncAt"
    FROM tenants t
    LEFT JOIN tenant_users tu ON tu.tenant_id = t.id
    LEFT JOIN latest_subscription ls ON ls.tenant_id = t.id
    LEFT JOIN latest_sync lsr ON lsr.tenant_id = t.id
    ORDER BY t.created_at DESC
    ${limitSql}
  `));

  return asRows<CustomerListRow>(rows).map(mapCustomerRow);
}

async function loadSubscriptionRows(status?: string, limit?: number) {
  const limitSql = typeof limit === 'number' ? sql`LIMIT ${limit}` : sql``;
  const normalizedStatus = status && status !== 'all' ? status : null;

  const rows = await withAdminContext(db, (tx) => tx.execute(sql<SubscriptionListRow>`
    WITH tenant_user_edges AS (
      SELECT ut.tenant_id, ut.user_id, ut.role, ut.created_at
      FROM user_tenants ut
      UNION ALL
      SELECT u.tenant_id, u.id AS user_id, 'owner'::varchar AS role, u.created_at
      FROM users u
      WHERE u.tenant_id IS NOT NULL
    ),
    tenant_users AS (
      SELECT
        tue.tenant_id,
        COALESCE(
          array_remove(array_agg(DISTINCT u.email ORDER BY u.email) FILTER (WHERE tue.role = 'owner'), NULL),
          ARRAY[]::varchar[]
        ) AS owner_emails
      FROM tenant_user_edges tue
      LEFT JOIN users u ON u.id = tue.user_id
      GROUP BY tue.tenant_id
    )
    SELECT
      s.id::text AS "subscriptionId",
      s.tenant_id::text AS "tenantId",
      t.name AS "tenantName",
      t.shop_name AS "shopName",
      s.status,
      s.current_period_start AS "currentPeriodStart",
      s.current_period_end AS "currentPeriodEnd",
      s.trial_ends_at AS "trialEndsAt",
      s.grace_until AS "graceUntil",
      s.cancel_at_period_end AS "cancelAtPeriodEnd",
      s.provider,
      p.code AS "planCode",
      p.name AS "planName",
      p.price_rub AS "priceRub",
      COALESCE(tu.owner_emails, ARRAY[]::varchar[]) AS "ownerEmails"
    FROM subscriptions s
    LEFT JOIN tenants t ON t.id = s.tenant_id
    LEFT JOIN plans p ON p.id = s.plan_id
    LEFT JOIN tenant_users tu ON tu.tenant_id = s.tenant_id
    WHERE (${normalizedStatus}::text IS NULL OR s.status = ${normalizedStatus})
    ORDER BY
      CASE WHEN s.current_period_end IS NULL THEN 1 ELSE 0 END,
      s.current_period_end ASC,
      s.created_at DESC
    ${limitSql}
  `));

  return asRows<SubscriptionListRow>(rows).map(mapSubscriptionRow);
}

export async function getAdminOverview(): Promise<AdminOverview> {
  await requirePlatformAdmin();

  const [statsRows, endingSoon, allCustomers] = await Promise.all([
    withAdminContext(db, (tx) => tx.execute(sql<OverviewStatsRow>`
      WITH latest_subscription AS (
        SELECT DISTINCT ON (s.tenant_id)
          s.tenant_id,
          s.status,
          s.current_period_end,
          s.grace_until,
          p.price_rub
        FROM subscriptions s
        LEFT JOIN plans p ON p.id = s.plan_id
        ORDER BY s.tenant_id, s.created_at DESC
      ),
      latest_sync AS (
        SELECT DISTINCT ON (sr.tenant_id)
          sr.tenant_id,
          COALESCE(sr.finished_at, sr.started_at, sr.requested_at) AS latest_sync_at
        FROM sync_runs sr
        ORDER BY sr.tenant_id, sr.requested_at DESC
      )
      SELECT
        (SELECT COUNT(*)::int FROM tenants) AS "tenantCount",
        (SELECT COUNT(*)::int FROM users) AS "userCount",
        COUNT(*) FILTER (WHERE ls.status = 'active')::int AS "activeSubscriptions",
        COUNT(*) FILTER (WHERE ls.status = 'trialing')::int AS "trialingSubscriptions",
        COUNT(*) FILTER (WHERE ls.status = 'past_due')::int AS "pastDueSubscriptions",
        COUNT(*) FILTER (WHERE ls.status IN ('expired', 'canceled'))::int AS "expiredSubscriptions",
        COUNT(*) FILTER (
          WHERE ls.current_period_end IS NOT NULL
            AND ls.current_period_end BETWEEN now() AND now() + interval '7 days'
        )::int AS "endingSoonSubscriptions",
        (
          SELECT COUNT(*)::int
          FROM payments p
          WHERE p.status IN ('canceled', 'failed')
            AND p.created_at >= now() - interval '30 days'
        ) AS "failedPaymentsLast30d",
        (
          SELECT COALESCE(SUM(p.amount_rub), 0)::numeric
          FROM payments p
          WHERE p.status = 'succeeded'
            AND p.paid_at >= now() - interval '30 days'
        ) AS "revenueLast30dRub",
        COUNT(*) FILTER (
          WHERE lsr.latest_sync_at IS NULL
             OR lsr.latest_sync_at < now() - interval '24 hours'
        )::int AS "staleSyncTenants",
        COUNT(*) FILTER (WHERE t.wb_token_health_status IN ('invalid', 'warning'))::int AS "invalidTokenTenants"
      FROM tenants t
      LEFT JOIN latest_subscription ls ON ls.tenant_id = t.id
      LEFT JOIN latest_sync lsr ON lsr.tenant_id = t.id
    `)),
    loadSubscriptionRows(undefined, 8),
    loadCustomerRows(),
  ]);

  const stats = asRows<OverviewStatsRow>(statsRows)[0];
  const accounts = groupCustomersByAccount(allCustomers);
  return {
    stats: {
      accountCount: accounts.length,
      tenantCount: Number(stats?.tenantCount ?? 0),
      userCount: Number(stats?.userCount ?? 0),
      activeSubscriptions: Number(stats?.activeSubscriptions ?? 0),
      trialingSubscriptions: Number(stats?.trialingSubscriptions ?? 0),
      pastDueSubscriptions: Number(stats?.pastDueSubscriptions ?? 0),
      expiredSubscriptions: Number(stats?.expiredSubscriptions ?? 0),
      endingSoonSubscriptions: Number(stats?.endingSoonSubscriptions ?? 0),
      failedPaymentsLast30d: Number(stats?.failedPaymentsLast30d ?? 0),
      revenueLast30dRub: toRequiredNumber(stats?.revenueLast30dRub),
      staleSyncTenants: Number(stats?.staleSyncTenants ?? 0),
      invalidTokenTenants: Number(stats?.invalidTokenTenants ?? 0),
    },
    endingSoon,
    latestAccounts: accounts.slice(0, 8),
  };
}

export async function listAdminAccounts() {
  await requirePlatformAdmin();
  return groupCustomersByAccount(await loadCustomerRows());
}

export async function listAdminCustomers() {
  await requirePlatformAdmin();
  return loadCustomerRows();
}

export async function listAdminSubscriptions(status?: string) {
  await requirePlatformAdmin();
  return loadSubscriptionRows(status);
}

export async function listAdminLeads(status?: string): Promise<AdminLeadListItem[]> {
  await requirePlatformAdmin();
  const normalizedStatus = status && status !== 'all' ? status : null;

  const rows = await withAdminContext(db, (tx) => tx.execute(sql<AdminLeadListItem>`
    WITH tenant_user_edges AS (
      SELECT ut.tenant_id, ut.user_id, ut.role, ut.created_at
      FROM user_tenants ut
      UNION ALL
      SELECT u.tenant_id, u.id AS user_id, 'owner'::varchar AS role, u.created_at
      FROM users u
      WHERE u.tenant_id IS NOT NULL
    ),
    user_tenants_rollup AS (
      SELECT
        tue.user_id,
        COUNT(DISTINCT tue.tenant_id)::int AS tenant_count,
        (array_agg(tue.tenant_id ORDER BY tue.created_at ASC))[1] AS primary_tenant_id,
        string_agg(DISTINCT COALESCE(t.shop_name, t.name), ', ' ORDER BY COALESCE(t.shop_name, t.name)) AS tenant_names
      FROM tenant_user_edges tue
      LEFT JOIN tenants t ON t.id = tue.tenant_id
      GROUP BY tue.user_id
    ),
    lead_rows AS (
      SELECT
        pl.id::text AS id,
        COALESCE(pl.email, u.email, '') AS email,
        pl.name,
        pl.phone,
        COALESCE(pl.source, 'auth') AS source,
        COALESCE(pl.status, 'registered') AS status,
        pl.selected_plan_code AS "selectedPlanCode",
        COALESCE(pl.user_id::text, u.id::text) AS "userId",
        COALESCE(pl.tenant_id::text, utr.primary_tenant_id::text) AS "tenantId",
        COALESCE(pl_tenant.name, primary_tenant.name) AS "tenantName",
        COALESCE(utr.tenant_count, CASE WHEN pl.tenant_id IS NULL THEN 0 ELSE 1 END)::int AS "tenantCount",
        COALESCE(utr.tenant_names, pl_tenant.name) AS "tenantNames",
        (pl.id IS NULL) AS "isBackfilled",
        COALESCE(pl.metadata, '{}'::jsonb) AS metadata,
        COALESCE(pl.last_activity_at, u.created_at) AS "lastActivityAt",
        COALESCE(pl.created_at, u.created_at) AS "createdAt",
        COALESCE(pl.updated_at, u.created_at) AS "updatedAt"
      FROM platform_leads pl
      LEFT JOIN users u
        ON pl.user_id = u.id
        OR (u.email IS NOT NULL AND lower(pl.email) = lower(u.email))
      LEFT JOIN user_tenants_rollup utr ON utr.user_id = u.id
      LEFT JOIN tenants primary_tenant ON primary_tenant.id = utr.primary_tenant_id
      LEFT JOIN tenants pl_tenant ON pl_tenant.id = pl.tenant_id
      UNION ALL
      SELECT
        'user:' || u.id::text AS id,
        COALESCE(u.email, '') AS email,
        NULL::varchar AS name,
        NULL::varchar AS phone,
        'auth'::varchar AS source,
        'registered'::varchar AS status,
        NULL::varchar AS "selectedPlanCode",
        u.id::text AS "userId",
        utr.primary_tenant_id::text AS "tenantId",
        primary_tenant.name AS "tenantName",
        COALESCE(utr.tenant_count, 0)::int AS "tenantCount",
        utr.tenant_names AS "tenantNames",
        true AS "isBackfilled",
        '{}'::jsonb AS metadata,
        u.created_at AS "lastActivityAt",
        u.created_at AS "createdAt",
        u.created_at AS "updatedAt"
      FROM users u
      LEFT JOIN user_tenants_rollup utr ON utr.user_id = u.id
      LEFT JOIN tenants primary_tenant ON primary_tenant.id = utr.primary_tenant_id
      WHERE u.email IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM platform_leads pl
          WHERE pl.user_id = u.id
             OR (u.email IS NOT NULL AND lower(pl.email) = lower(u.email))
        )
    )
    SELECT
      id,
      email,
      name,
      phone,
      source,
      status,
      "selectedPlanCode",
      "userId",
      "tenantId",
      "tenantName",
      "tenantCount",
      "tenantNames",
      "isBackfilled",
      metadata,
      "lastActivityAt",
      "createdAt",
      "updatedAt"
    FROM lead_rows
    WHERE (${normalizedStatus}::text IS NULL OR status = ${normalizedStatus})
    ORDER BY "lastActivityAt" DESC, "createdAt" DESC
  `));

  return asRows<AdminLeadListItem>(rows);
}

export async function deleteAdminLeadRegistration(input: {
  id?: string | null;
  userId?: string | null;
  email?: string | null;
}) {
  const admin = await requirePlatformAdmin(['owner']);
  const id = input.id?.trim() || null;
  const userId = input.userId?.trim() || null;
  const email = input.email?.trim().toLowerCase() || null;

  if (!id && !userId && !email) {
    throw new AppError('Не передан лид для удаления', 400);
  }

  const rows = await withAdminContext(db, (tx) => tx.execute(sql<LeadDeletionTargetRow>`
    WITH tenant_user_edges AS (
      SELECT ut.tenant_id, ut.user_id, ut.role, ut.created_at
      FROM user_tenants ut
      UNION ALL
      SELECT u.tenant_id, u.id AS user_id, 'owner'::varchar AS role, u.created_at
      FROM users u
      WHERE u.tenant_id IS NOT NULL
    ),
    user_tenants_rollup AS (
      SELECT
        tue.user_id,
        COUNT(DISTINCT tue.tenant_id)::int AS tenant_count,
        (array_agg(tue.tenant_id ORDER BY tue.created_at ASC))[1] AS primary_tenant_id,
        string_agg(DISTINCT COALESCE(t.shop_name, t.name), ', ' ORDER BY COALESCE(t.shop_name, t.name)) AS tenant_names
      FROM tenant_user_edges tue
      LEFT JOIN tenants t ON t.id = tue.tenant_id
      GROUP BY tue.user_id
    ),
    lead_rows AS (
      SELECT
        pl.id::text AS id,
        pl.id::text AS "leadId",
        COALESCE(pl.email, u.email, '') AS email,
        COALESCE(pl.user_id::text, u.id::text) AS "userId",
        COALESCE(pl.tenant_id::text, utr.primary_tenant_id::text) AS "tenantId",
        COALESCE(utr.tenant_count, CASE WHEN pl.tenant_id IS NULL THEN 0 ELSE 1 END)::int AS "tenantCount",
        COALESCE(utr.tenant_names, pl_tenant.name) AS "tenantNames",
        COALESCE(pl.source, 'auth') AS source,
        COALESCE(pl.status, 'registered') AS status,
        COALESCE(pl.created_at, u.created_at) AS "createdAt"
      FROM platform_leads pl
      LEFT JOIN users u
        ON pl.user_id = u.id
        OR (u.email IS NOT NULL AND lower(pl.email) = lower(u.email))
      LEFT JOIN user_tenants_rollup utr ON utr.user_id = u.id
      LEFT JOIN tenants pl_tenant ON pl_tenant.id = pl.tenant_id
      UNION ALL
      SELECT
        'user:' || u.id::text AS id,
        NULL::text AS "leadId",
        COALESCE(u.email, '') AS email,
        u.id::text AS "userId",
        utr.primary_tenant_id::text AS "tenantId",
        COALESCE(utr.tenant_count, 0)::int AS "tenantCount",
        utr.tenant_names AS "tenantNames",
        'auth'::varchar AS source,
        'registered'::varchar AS status,
        u.created_at AS "createdAt"
      FROM users u
      LEFT JOIN user_tenants_rollup utr ON utr.user_id = u.id
      WHERE u.email IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM platform_leads pl
          WHERE pl.user_id = u.id
             OR (u.email IS NOT NULL AND lower(pl.email) = lower(u.email))
        )
    )
    SELECT *
    FROM lead_rows
    WHERE (${id}::text IS NOT NULL AND id = ${id})
       OR (${userId}::text IS NOT NULL AND "userId" = ${userId})
       OR (${email}::text IS NOT NULL AND lower(email) = ${email})
    ORDER BY "createdAt" DESC
    LIMIT 1
  `));

  const target = asRows<LeadDeletionTargetRow>(rows)[0];
  if (!target) {
    throw new AppError('Регистрация не найдена', 404);
  }

  if (target.tenantId || target.tenantCount > 0) {
    throw new AppError('У этой регистрации уже есть магазин. Удаление таких аккаунтов нужно делать отдельной процедурой, чтобы не потерять клиентские данные.', 400);
  }

  if (target.userId) {
    const supabaseAdmin = createSupabaseAdminClient();
    if (!supabaseAdmin) {
      throw new AppError('Не настроен SUPABASE_SERVICE_ROLE_KEY: нельзя удалить пользователя из Supabase Auth.', 500);
    }

    const { error } = await supabaseAdmin.auth.admin.deleteUser(target.userId);
    if (error && !/not found/i.test(error.message)) {
      throw new AppError(`Supabase Auth не удалил пользователя: ${error.message}`, 500);
    }
  }

  await withAdminContext(db, async (tx) => {
    if (target.leadId) {
      await tx.execute(sql`DELETE FROM platform_leads WHERE id = ${target.leadId}::uuid`);
    } else {
      await tx.execute(sql`
        DELETE FROM platform_leads
        WHERE (${target.userId}::uuid IS NOT NULL AND user_id = ${target.userId}::uuid)
           OR lower(email) = lower(${target.email})
      `);
    }

    if (target.userId) {
      await tx.execute(sql`
        DELETE FROM users u
        WHERE u.id = ${target.userId}::uuid
          AND u.tenant_id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM user_tenants ut WHERE ut.user_id = u.id
          )
      `);
    }

    await tx.insert(platformAuditLog).values({
      actorUserId: admin.user.id,
      actorRole: admin.role,
      action: 'platform.lead.delete',
      entityType: 'platform_lead',
      entityId: target.leadId ?? target.userId ?? target.email,
      tenantId: null,
      before: {
        email: target.email,
        userId: target.userId,
        leadId: target.leadId,
        source: target.source,
        status: target.status,
        createdAt: target.createdAt,
      },
      after: null,
      reason: 'manual_admin_delete',
    });
  });

  return target;
}

function uuidSqlList(values: string[]) {
  return sql.join(values.map((value) => sql`${value}::uuid`), sql`, `);
}

function textSqlList(values: string[]) {
  return sql.join(values.map((value) => sql`${value}`), sql`, `);
}

export async function deleteAdminCustomerAccount(input: {
  tenantId: string;
  confirmation: string;
}): Promise<AdminCustomerDeletionResult> {
  const admin = await requirePlatformAdmin(['owner']);
  const tenantId = input.tenantId?.trim();
  const confirmation = input.confirmation?.trim();

  if (!tenantId) {
    throw new AppError('Не передан кабинет для удаления', 400);
  }

  const targetRows = await withAdminContext(db, (tx) => tx.execute(sql<TenantDeletionTargetRow>`
    SELECT
      t.id::text AS "tenantId",
      t.name,
      t.shop_name AS "shopName",
      t.created_at AS "createdAt",
      (
        SELECT COUNT(DISTINCT target_users.user_id)::int
        FROM (
          SELECT ut.user_id
          FROM user_tenants ut
          WHERE ut.tenant_id = t.id
          UNION
          SELECT u.id AS user_id
          FROM users u
          WHERE u.tenant_id = t.id
        ) target_users
      ) AS "userCount",
      (SELECT COUNT(*)::int FROM platform_leads pl WHERE pl.tenant_id = t.id) AS "leadCount",
      (SELECT COUNT(*)::int FROM subscriptions s WHERE s.tenant_id = t.id) AS "subscriptionCount",
      (SELECT COUNT(*)::int FROM payments p WHERE p.tenant_id = t.id) AS "paymentCount",
      (SELECT COUNT(*)::int FROM sync_runs sr WHERE sr.tenant_id = t.id) AS "syncRunCount",
      (SELECT COUNT(*)::int FROM products p WHERE p.tenant_id = t.id) AS "productCount"
    FROM tenants t
    WHERE t.id = ${tenantId}::uuid
    LIMIT 1
  `));

  const target = asRows<TenantDeletionTargetRow>(targetRows)[0];
  if (!target) {
    throw new AppError('Кабинет не найден', 404);
  }

  const tenantName = target.shopName || target.name;
  if (confirmation !== target.tenantId && confirmation !== tenantName) {
    throw new AppError('Для удаления введите точный ID кабинета или название магазина.', 400);
  }

  const memberRows = await withAdminContext(db, (tx) => tx.execute(sql<TenantDeletionMemberRow>`
    WITH target_users AS (
      SELECT ut.user_id
      FROM user_tenants ut
      WHERE ut.tenant_id = ${tenantId}::uuid
      UNION
      SELECT u.id AS user_id
      FROM users u
      WHERE u.tenant_id = ${tenantId}::uuid
    ),
    all_edges AS (
      SELECT ut.user_id, ut.tenant_id, ut.role, ut.created_at
      FROM user_tenants ut
      UNION ALL
      SELECT u.id AS user_id, u.tenant_id, u.role, u.created_at
      FROM users u
      WHERE u.tenant_id IS NOT NULL
    )
    SELECT
      tu.user_id::text AS "userId",
      u.email,
      COUNT(DISTINCT ae.tenant_id)::int AS "tenantCount",
      ((array_agg(ae.tenant_id ORDER BY ae.created_at ASC) FILTER (WHERE ae.tenant_id <> ${tenantId}::uuid))[1])::text AS "fallbackTenantId",
      (array_agg(ae.role ORDER BY ae.created_at ASC) FILTER (WHERE ae.tenant_id <> ${tenantId}::uuid))[1] AS "fallbackRole",
      EXISTS (
        SELECT 1
        FROM platform_admins pa
        WHERE pa.user_id = tu.user_id
          AND pa.status = 'active'
      ) AS "isPlatformAdmin"
    FROM target_users tu
    JOIN users u ON u.id = tu.user_id
    LEFT JOIN all_edges ae ON ae.user_id = tu.user_id
    GROUP BY tu.user_id, u.email
    ORDER BY u.created_at ASC
  `));

  const members = asRows<TenantDeletionMemberRow>(memberRows);
  const usersToDelete = members.filter((member) => !member.isPlatformAdmin && member.tenantCount <= 1);
  const userIdsToDelete = usersToDelete.map((member) => member.userId);
  const usersToFallback = members.filter((member) => !userIdsToDelete.includes(member.userId) && member.fallbackTenantId);
  const usersToDetach = members.filter((member) => !userIdsToDelete.includes(member.userId) && !member.fallbackTenantId);
  const emailsToDelete = usersToDelete
    .map((member) => member.email?.trim().toLowerCase())
    .filter((email): email is string => Boolean(email));

  if (userIdsToDelete.length > 0 && !createSupabaseAdminClient()) {
    throw new AppError('Не настроен SUPABASE_SERVICE_ROLE_KEY: нельзя удалить пользователей из Supabase Auth.', 500);
  }

  await withAdminContext(db, async (tx) => {
    await tx.insert(platformAuditLog).values({
      actorUserId: admin.user.id,
      actorRole: admin.role,
      action: 'platform.customer.delete',
      entityType: 'tenant',
      entityId: tenantId,
      tenantId,
      before: {
        tenant: target,
        members: members.map((member) => ({
          userId: member.userId,
          email: member.email,
          tenantCount: member.tenantCount,
          preserved: !userIdsToDelete.includes(member.userId),
          isPlatformAdmin: member.isPlatformAdmin,
        })),
        deletePlan: {
          appUsers: userIdsToDelete.length,
          authUsers: userIdsToDelete.length,
          preservedUsers: members.length - userIdsToDelete.length,
        },
      },
      after: null,
      reason: 'manual_admin_full_delete',
    });

    if (usersToFallback.length > 0) {
      await tx.execute(sql`
        WITH fallback(user_id, tenant_id, role) AS (
          VALUES ${sql.join(usersToFallback.map((member) => sql`(${member.userId}::uuid, ${member.fallbackTenantId}::uuid, ${member.fallbackRole ?? 'viewer'}::varchar)`), sql`, `)}
        )
        UPDATE users u
        SET tenant_id = fallback.tenant_id,
            role = fallback.role
        FROM fallback
        WHERE u.id = fallback.user_id
      `);
    }

    if (usersToDetach.length > 0) {
      await tx.execute(sql`
        UPDATE users
        SET tenant_id = NULL
        WHERE id IN (${uuidSqlList(usersToDetach.map((member) => member.userId))})
      `);
    }

    if (emailsToDelete.length > 0) {
      await tx.execute(sql`
        DELETE FROM platform_leads
        WHERE lower(email) IN (${textSqlList(emailsToDelete)})
      `);
    }

    await tx.execute(sql`
      DELETE FROM platform_leads
      WHERE tenant_id = ${tenantId}::uuid
      ${userIdsToDelete.length > 0 ? sql`OR user_id IN (${uuidSqlList(userIdsToDelete)})` : sql``}
    `);

    if (userIdsToDelete.length > 0) {
      await tx.execute(sql`
        DELETE FROM users
        WHERE id IN (${uuidSqlList(userIdsToDelete)})
      `);
    }

    await tx.execute(sql`
      DELETE FROM tenants
      WHERE id = ${tenantId}::uuid
    `);
  });

  const authDeleteErrors: string[] = [];
  const supabaseAdmin = createSupabaseAdminClient();
  if (supabaseAdmin) {
    for (const userId of userIdsToDelete) {
      const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (error && !/not found/i.test(error.message)) {
        authDeleteErrors.push(`${userId}: ${error.message}`);
      }
    }
  }

  return {
    tenantId,
    tenantName,
    deletedAppUsers: userIdsToDelete.length,
    deletedAuthUsers: userIdsToDelete.length - authDeleteErrors.length,
    preservedAppUsers: members.length - userIdsToDelete.length,
    authDeleteErrors,
  };
}

export async function getAdminCustomerDetail(tenantId: string): Promise<AdminCustomerDetail | null> {
  await requirePlatformAdmin();

  const [
    tenantRows,
    members,
    subscriptionRows,
    paymentsRows,
    syncRows,
    auditRows,
  ] = await Promise.all([
    withAdminContext(db, (tx) => tx.execute(sql<TenantDetailRow>`
      SELECT
        t.id::text AS "tenantId",
        t.name,
        t.shop_name AS "shopName",
        t.tax_type AS "taxType",
        t.tax_rate AS "taxRate",
        t.created_at AS "createdAt",
        t.wb_token_health_status AS "wbTokenHealthStatus",
        t.wb_token_checked_at AS "wbTokenCheckedAt",
        t.wb_lk_phone AS "wbLkPhone",
        t.wb_lk_session_status AS "wbLkSessionStatus",
        t.wb_lk_session_checked_at AS "wbLkSessionCheckedAt",
        t.notifications_enabled AS "notificationsEnabled",
        t.telegram_chat_id AS "telegramChatId"
      FROM tenants t
      WHERE t.id = ${tenantId}
      LIMIT 1
    `)),
    withAdminContext(db, (tx) => tx.execute(sql<AdminTenantMember>`
      SELECT
        ut.user_id::text AS "userId",
        u.email,
        ut.role,
        ut.created_at AS "joinedAt"
      FROM user_tenants ut
      LEFT JOIN users u ON u.id = ut.user_id
      WHERE ut.tenant_id = ${tenantId}
      ORDER BY
        CASE ut.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
        ut.created_at ASC
    `)),
    withAdminContext(db, (tx) => tx.execute(sql<SubscriptionListRow>`
      SELECT
        s.id::text AS "subscriptionId",
        s.tenant_id::text AS "tenantId",
        t.name AS "tenantName",
        t.shop_name AS "shopName",
        s.status,
        s.current_period_start AS "currentPeriodStart",
        s.current_period_end AS "currentPeriodEnd",
        s.trial_ends_at AS "trialEndsAt",
        s.grace_until AS "graceUntil",
        s.cancel_at_period_end AS "cancelAtPeriodEnd",
        s.provider,
        p.code AS "planCode",
        p.name AS "planName",
        p.price_rub AS "priceRub",
        ARRAY[]::varchar[] AS "ownerEmails"
      FROM subscriptions s
      LEFT JOIN tenants t ON t.id = s.tenant_id
      LEFT JOIN plans p ON p.id = s.plan_id
      WHERE s.tenant_id = ${tenantId}
      ORDER BY s.created_at DESC
      LIMIT 10
    `)),
    withAdminContext(db, (tx) => tx.execute(sql<AdminPaymentItem>`
      SELECT
        p.id::text,
        p.status,
        p.provider,
        p.provider_payment_id AS "providerPaymentId",
        p.amount_rub AS "amountRub",
        p.currency,
        p.paid_at AS "paidAt",
        p.due_at AS "dueAt",
        p.created_at AS "createdAt"
      FROM payments p
      WHERE p.tenant_id = ${tenantId}
      ORDER BY p.created_at DESC
      LIMIT 20
    `)),
    withAdminContext(db, (tx) => tx.execute(sql<AdminSyncRunItem>`
      SELECT
        sr.id::text,
        sr.status,
        sr.trigger_source AS "triggerSource",
        sr.requested_at AS "requestedAt",
        sr.started_at AS "startedAt",
        sr.finished_at AS "finishedAt",
        sr.error_message AS "errorMessage"
      FROM sync_runs sr
      WHERE sr.tenant_id = ${tenantId}
      ORDER BY sr.requested_at DESC
      LIMIT 15
    `)),
    withAdminContext(db, (tx) => tx.execute(sql<AdminAuditItem>`
      SELECT
        pal.id::text,
        pal.actor_user_id::text AS "actorUserId",
        pal.actor_role AS "actorRole",
        pal.action,
        pal.entity_type AS "entityType",
        pal.entity_id AS "entityId",
        pal.reason,
        pal.created_at AS "createdAt"
      FROM platform_audit_log pal
      WHERE pal.tenant_id = ${tenantId}
      ORDER BY pal.created_at DESC
      LIMIT 20
    `)),
  ]);

  const tenant = asRows<TenantDetailRow>(tenantRows)[0];
  if (!tenant) return null;

  const payments = asRows<AdminPaymentItem>(paymentsRows).map((payment) => ({
    ...payment,
    amountRub: toRequiredNumber(payment.amountRub),
  }));

  return {
    tenant,
    members: asRows<AdminTenantMember>(members),
    subscriptions: asRows<SubscriptionListRow>(subscriptionRows).map(mapSubscriptionRow),
    payments,
    syncRuns: asRows<AdminSyncRunItem>(syncRows),
    audit: asRows<AdminAuditItem>(auditRows),
  };
}
