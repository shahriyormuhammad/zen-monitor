import {
  pgTable,
  uuid,
  varchar,
  date,
  timestamp,
  bigint,
  integer,
  numeric,
  boolean,
  text,
  jsonb,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { SignalNotificationPreferences } from '@/lib/operator-signal-timeline';
import type { TenantAccessPreset, TenantFeaturePermissions } from '@/lib/auth/feature-access';

export const mvRefreshRuns = pgTable('mv_refresh_runs', {
  mvName: text('mv_name').primaryKey(),
  lastRefreshedAt: timestamp('last_refreshed_at', { withTimezone: true }).defaultNow().notNull(),
});

export const tenants = pgTable('tenants', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  shopName: varchar('shop_name', { length: 255 }),
  taxType: varchar('tax_type', { length: 50 }).default('usn_income').notNull(),
  taxRate: numeric('tax_rate', { precision: 5, scale: 2 }).default('6.00').notNull(),
  vatMode: varchar('vat_mode', { length: 50 }).default('none').notNull(),
  vatRate: numeric('vat_rate', { precision: 5, scale: 2 }).default('0.00').notNull(),
  wbApiToken: text('wb_api_token').notNull(),
  wbTokenHealthStatus: varchar('wb_token_health_status', { length: 50 }).default('unknown').notNull(),
  wbTokenCheckedAt: timestamp('wb_token_checked_at', { withTimezone: true }),
  wbTokenHealthSummary: jsonb('wb_token_health_summary').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  wbLkPhone: varchar('wb_lk_phone', { length: 32 }),
  wbLkSessionStatus: varchar('wb_lk_session_status', { length: 50 }).default('unknown').notNull(),
  wbLkSessionCheckedAt: timestamp('wb_lk_session_checked_at', { withTimezone: true }),
  wbLkSessionError: text('wb_lk_session_error'),
  wbLkStorageStatePath: text('wb_lk_storage_state_path'),
  wbLkStorageState: text('wb_lk_storage_state'),
  wbLkStorageStateRefreshedAt: timestamp('wb_lk_storage_state_refreshed_at', { withTimezone: true }),
  // WBTokenV3 — постоянный токен полного доступа к ЛК (не истекает по WB).
  // Извлекается из cookies после успешной авторизации, шифруется тем же ключом
  // что и storage_state. Используется для HTTP-запросов в ЛК без Playwright.
  wbLkTokenV3: text('wb_lk_token_v3'),
  wbLkTokenV3RefreshedAt: timestamp('wb_lk_token_v3_refreshed_at', { withTimezone: true }),
  telegramChatId: bigint('telegram_chat_id', { mode: 'number' }),
  notificationsEnabled: boolean('notifications_enabled').default(true).notNull(),
  reviewsAutoReplyEnabled: boolean('reviews_auto_reply_enabled').default(false).notNull(),
  telegramSignalNotificationPrefs: jsonb('telegram_signal_notification_prefs')
    .$type<SignalNotificationPreferences>()
    .default(sql`'{"note":true,"assignment":true,"blocked":true}'::jsonb`)
    .notNull(),
  advertisingAutopilotEnabled: boolean('advertising_autopilot_enabled').default(true).notNull(),
  advertisingAutopilotMode: varchar('advertising_autopilot_mode', { length: 24 }).default('advisor').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey(), // Соответствует auth.uid()
  email: varchar('email', { length: 255 }),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }), // Active tenant
  role: varchar('role', { length: 50 }).default('viewer').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  usersTenantIdx: index('users_tenant_idx').on(table.tenantId),
}));

export const userTenants = pgTable('user_tenants', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 50 }).default('owner').notNull(),
  accessPreset: varchar('access_preset', { length: 50 }).$type<TenantAccessPreset>().default('all').notNull(),
  featurePermissions: jsonb('feature_permissions')
    .$type<Partial<TenantFeaturePermissions>>()
    .default(sql`'{}'::jsonb`)
    .notNull(),
  inAppSignalNotificationPrefs: jsonb('in_app_signal_notification_prefs')
    .$type<SignalNotificationPreferences>()
    .default(sql`'{"note":true,"assignment":true,"blocked":true}'::jsonb`)
    .notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  userTenantIdx: uniqueIndex('user_tenant_unique_idx').on(table.userId, table.tenantId),
}));

export const telegramChatLinks = pgTable('telegram_chat_links', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  chatId: bigint('chat_id', { mode: 'number' }).notNull(),
  chatType: varchar('chat_type', { length: 32 }).default('private').notNull(),
  telegramUserId: bigint('telegram_user_id', { mode: 'number' }),
  telegramUsername: varchar('telegram_username', { length: 255 }),
  status: varchar('status', { length: 32 }).default('active').notNull(),
  linkedByUserId: uuid('linked_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, (table) => ({
  telegramChatLinksActiveChatIdx: uniqueIndex('telegram_chat_links_active_chat_uidx')
    .on(table.chatId)
    .where(sql`${table.status} = 'active'`),
  telegramChatLinksTenantStatusIdx: index('telegram_chat_links_tenant_status_idx')
    .on(table.tenantId, table.status),
  telegramChatLinksUserIdx: index('telegram_chat_links_user_idx')
    .on(table.telegramUserId),
}));

export const telegramLinkTokens = pgTable('telegram_link_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 128 }).notNull(),
  status: varchar('status', { length: 32 }).default('pending').notNull(),
  createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  usedChatId: bigint('used_chat_id', { mode: 'number' }),
  usedTelegramUserId: bigint('used_telegram_user_id', { mode: 'number' }),
  usedTelegramUsername: varchar('used_telegram_username', { length: 255 }),
}, (table) => ({
  telegramLinkTokensHashIdx: uniqueIndex('telegram_link_tokens_hash_uidx')
    .on(table.tokenHash),
  telegramLinkTokensTenantStatusIdx: index('telegram_link_tokens_tenant_status_idx')
    .on(table.tenantId, table.status, table.expiresAt),
}));

export const platformAdmins = pgTable('platform_admins', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 50 }).default('readonly').notNull(),
  status: varchar('status', { length: 50 }).default('active').notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  platformAdminsUserIdx: uniqueIndex('platform_admins_user_idx').on(table.userId),
  platformAdminsStatusRoleIdx: index('platform_admins_status_role_idx').on(table.status, table.role),
}));

export const plans = pgTable('plans', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: varchar('code', { length: 50 }).notNull(),
  name: varchar('name', { length: 120 }).notNull(),
  priceRub: numeric('price_rub', { precision: 12, scale: 2 }).default('0').notNull(),
  billingPeriod: varchar('billing_period', { length: 20 }).default('month').notNull(),
  maxTenants: integer('max_tenants'),
  maxUsers: integer('max_users'),
  features: jsonb('features').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  plansCodeIdx: uniqueIndex('plans_code_idx').on(table.code),
  plansActiveIdx: index('plans_active_idx').on(table.isActive, table.code),
}));

export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  planId: uuid('plan_id').notNull().references(() => plans.id),
  status: varchar('status', { length: 50 }).default('trialing').notNull(),
  currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  graceUntil: timestamp('grace_until', { withTimezone: true }),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').default(false).notNull(),
  canceledAt: timestamp('canceled_at', { withTimezone: true }),
  provider: varchar('provider', { length: 50 }).default('manual').notNull(),
  providerCustomerId: varchar('provider_customer_id', { length: 255 }),
  providerSubscriptionId: varchar('provider_subscription_id', { length: 255 }),
  providerPaymentMethodId: varchar('provider_payment_method_id', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  subscriptionsTenantStatusIdx: index('subscriptions_tenant_status_idx').on(table.tenantId, table.status, table.currentPeriodEnd),
  subscriptionsProviderIdx: index('subscriptions_provider_idx').on(table.provider, table.providerSubscriptionId),
}));

export const payments = pgTable('payments', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  subscriptionId: uuid('subscription_id').references(() => subscriptions.id, { onDelete: 'set null' }),
  provider: varchar('provider', { length: 50 }).default('manual').notNull(),
  providerPaymentId: varchar('provider_payment_id', { length: 255 }),
  idempotencyKey: varchar('idempotency_key', { length: 255 }),
  amountRub: numeric('amount_rub', { precision: 12, scale: 2 }).default('0').notNull(),
  currency: varchar('currency', { length: 3 }).default('RUB').notNull(),
  status: varchar('status', { length: 50 }).default('pending').notNull(),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  dueAt: timestamp('due_at', { withTimezone: true }),
  failureCode: varchar('failure_code', { length: 120 }),
  failureMessage: text('failure_message'),
  rawPayload: jsonb('raw_payload').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  paymentsTenantStatusIdx: index('payments_tenant_status_idx').on(table.tenantId, table.status, table.createdAt),
  paymentsSubscriptionIdx: index('payments_subscription_idx').on(table.subscriptionId, table.createdAt),
  paymentsProviderPaymentIdx: uniqueIndex('payments_provider_payment_idx').on(table.provider, table.providerPaymentId),
  paymentsIdempotencyIdx: uniqueIndex('payments_idempotency_idx').on(table.provider, table.idempotencyKey),
}));

export const billingEvents = pgTable('billing_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  provider: varchar('provider', { length: 50 }).notNull(),
  providerEventId: varchar('provider_event_id', { length: 255 }).notNull(),
  eventType: varchar('event_type', { length: 120 }).notNull(),
  paymentId: uuid('payment_id').references(() => payments.id, { onDelete: 'set null' }),
  subscriptionId: uuid('subscription_id').references(() => subscriptions.id, { onDelete: 'set null' }),
  processingStatus: varchar('processing_status', { length: 50 }).default('received').notNull(),
  rawPayload: jsonb('raw_payload').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  errorMessage: text('error_message'),
  receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
}, (table) => ({
  billingEventsProviderEventIdx: uniqueIndex('billing_events_provider_event_idx').on(table.provider, table.providerEventId),
  billingEventsStatusReceivedIdx: index('billing_events_status_received_idx').on(table.processingStatus, table.receivedAt),
}));

export const platformLeads = pgTable('platform_leads', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).notNull(),
  name: varchar('name', { length: 255 }),
  phone: varchar('phone', { length: 64 }),
  source: varchar('source', { length: 120 }).default('site').notNull(),
  status: varchar('status', { length: 50 }).default('registered').notNull(),
  selectedPlanCode: varchar('selected_plan_code', { length: 50 }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  note: text('note'),
  lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  platformLeadsEmailIdx: uniqueIndex('platform_leads_email_idx').on(table.email),
  platformLeadsStatusActivityIdx: index('platform_leads_status_activity_idx').on(table.status, table.lastActivityAt),
  platformLeadsTenantIdx: index('platform_leads_tenant_idx').on(table.tenantId),
  platformLeadsUserIdx: index('platform_leads_user_idx').on(table.userId),
}));

export const platformAuditLog = pgTable('platform_audit_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  actorRole: varchar('actor_role', { length: 50 }).notNull(),
  action: varchar('action', { length: 120 }).notNull(),
  entityType: varchar('entity_type', { length: 120 }).notNull(),
  entityId: varchar('entity_id', { length: 255 }),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
  before: jsonb('before').$type<Record<string, unknown> | null>(),
  after: jsonb('after').$type<Record<string, unknown> | null>(),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  platformAuditTenantCreatedIdx: index('platform_audit_tenant_created_idx').on(table.tenantId, table.createdAt),
  platformAuditActorCreatedIdx: index('platform_audit_actor_created_idx').on(table.actorUserId, table.createdAt),
  platformAuditEntityIdx: index('platform_audit_entity_idx').on(table.entityType, table.entityId, table.createdAt),
}));

export const platformImpersonationSessions = pgTable('platform_impersonation_sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  actorRole: varchar('actor_role', { length: 50 }).notNull(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  reason: varchar('reason', { length: 120 }).notNull(),
  note: text('note'),
  status: varchar('status', { length: 50 }).default('active').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
}, (table) => ({
  platformImpersonationActorActiveIdx: index('platform_impersonation_actor_active_idx')
    .on(table.actorUserId, table.status, table.expiresAt),
  platformImpersonationTenantStartedIdx: index('platform_impersonation_tenant_started_idx')
    .on(table.tenantId, table.startedAt),
}));

export const syncRuns = pgTable('sync_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  requestedBy: uuid('requested_by').references(() => users.id, { onDelete: 'set null' }),
  triggerSource: varchar('trigger_source', { length: 50 }).default('manual').notNull(),
  status: varchar('status', { length: 50 }).default('pending').notNull(),
  dateFrom: timestamp('date_from', { withTimezone: true }),
  dateTo: timestamp('date_to', { withTimezone: true }),
  requestedAt: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  summary: jsonb('summary').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  errorMessage: text('error_message'),
}, (table) => ({
  syncRunsTenantRequestedIdx: index('sync_runs_tenant_requested_idx').on(table.tenantId, table.requestedAt),
  syncRunsStatusIdx: index('sync_runs_status_idx').on(table.status),
}));

export const redistributionRuns = pgTable('redistribution_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  triggerSource: varchar('trigger_source', { length: 50 }).default('scheduled_daily').notNull(),
  status: varchar('status', { length: 50 }).default('planned').notNull(),
  requestedFrom: timestamp('requested_from', { withTimezone: true }).notNull(),
  requestedTo: timestamp('requested_to', { withTimezone: true }).notNull(),
  snapshotDate: timestamp('snapshot_date', { withTimezone: true }),
  snapshotPeriodFrom: timestamp('snapshot_period_from', { withTimezone: true }),
  snapshotPeriodTo: timestamp('snapshot_period_to', { withTimezone: true }),
  requestedDateWindowDays: integer('requested_date_window_days').default(0).notNull(),
  effectiveDateWindowDays: integer('effective_date_window_days').default(0).notNull(),
  windowAligned: boolean('window_aligned').default(true).notNull(),
  methodology: varchar('methodology', { length: 120 }).notNull(),
  recommendationCount: integer('recommendation_count').default(0).notNull(),
  skuCount: integer('sku_count').default(0).notNull(),
  transferUnits: integer('transfer_units').default(0).notNull(),
  estimatedSavingsRub: numeric('estimated_savings_rub', { precision: 15, scale: 2 }).default('0').notNull(),
  currentKrpPct: numeric('current_krp_pct', { precision: 8, scale: 2 }).default('0').notNull(),
  simulatedKrpPct: numeric('simulated_krp_pct', { precision: 8, scale: 2 }).default('0').notNull(),
  currentLocalSharePct: numeric('current_local_share_pct', { precision: 8, scale: 2 }).default('0').notNull(),
  simulatedLocalSharePct: numeric('simulated_local_share_pct', { precision: 8, scale: 2 }).default('0').notNull(),
  assumptions: jsonb('assumptions').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  notes: jsonb('notes').$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
  csvFilePath: text('csv_file_path'),
  csvFileName: varchar('csv_file_name', { length: 255 }),
  csvChecksumSha256: varchar('csv_checksum_sha256', { length: 64 }),
  csvGeneratedAt: timestamp('csv_generated_at', { withTimezone: true }),
  telegramSentAt: timestamp('telegram_sent_at', { withTimezone: true }),
  telegramMessageId: bigint('telegram_message_id', { mode: 'number' }),
  rpaRequestedAt: timestamp('rpa_requested_at', { withTimezone: true }),
  rpaStartedAt: timestamp('rpa_started_at', { withTimezone: true }),
  rpaFinishedAt: timestamp('rpa_finished_at', { withTimezone: true }),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  redistributionRunsTenantCreatedIdx: index('redistribution_runs_tenant_created_idx').on(table.tenantId, table.createdAt),
  redistributionRunsTenantStatusIdx: index('redistribution_runs_tenant_status_idx').on(table.tenantId, table.status, table.createdAt),
  redistributionRunsTenantWindowIdx: index('redistribution_runs_tenant_window_idx').on(table.tenantId, table.requestedFrom, table.requestedTo),
}));

export const redistributionItems = pgTable('redistribution_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  runId: uuid('run_id').notNull().references(() => redistributionRuns.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  status: varchar('status', { length: 50 }).default('planned').notNull(),
  nmId: bigint('nm_id', { mode: 'number' }).notNull(),
  vendorCode: varchar('vendor_code', { length: 255 }),
  brand: varchar('brand', { length: 255 }),
  sizeName: varchar('size_name', { length: 64 }).notNull(),
  chrtId: bigint('chrt_id', { mode: 'number' }),
  fromRegionName: varchar('from_region_name', { length: 255 }).notNull(),
  fromWarehouse: varchar('from_warehouse', { length: 255 }).notNull(),
  fromOfficeId: bigint('from_office_id', { mode: 'number' }),
  toRegionName: varchar('to_region_name', { length: 255 }).notNull(),
  toWarehouse: varchar('to_warehouse', { length: 255 }).notNull(),
  toOfficeId: bigint('to_office_id', { mode: 'number' }),
  transferUnits: integer('transfer_units').notNull(),
  priorityScore: numeric('priority_score', { precision: 12, scale: 2 }).default('0').notNull(),
  estimatedSavingsRub: numeric('estimated_savings_rub', { precision: 15, scale: 2 }).default('0').notNull(),
  currentLocalSharePct: numeric('current_local_share_pct', { precision: 8, scale: 2 }).default('0').notNull(),
  simulatedLocalSharePct: numeric('simulated_local_share_pct', { precision: 8, scale: 2 }).default('0').notNull(),
  currentKrpPct: numeric('current_krp_pct', { precision: 8, scale: 2 }).default('0').notNull(),
  simulatedKrpPct: numeric('simulated_krp_pct', { precision: 8, scale: 2 }).default('0').notNull(),
  fromCoverageDaysBefore: numeric('from_coverage_days_before', { precision: 10, scale: 2 }),
  toCoverageDaysBefore: numeric('to_coverage_days_before', { precision: 10, scale: 2 }),
  applicationComment: text('application_comment'),
  executionNote: text('execution_note'),
  executedAt: timestamp('executed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  redistributionItemsRunIdx: index('redistribution_items_run_idx').on(table.runId, table.status),
  redistributionItemsTenantStatusIdx: index('redistribution_items_tenant_status_idx').on(table.tenantId, table.status, table.createdAt),
  redistributionItemsTenantNmIdx: index('redistribution_items_tenant_nm_idx').on(table.tenantId, table.nmId, table.createdAt),
}));

export const redistributionWarehouseRegistry = pgTable('redistribution_warehouse_registry', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  warehouseName: varchar('warehouse_name', { length: 255 }).notNull(),
  officeId: bigint('office_id', { mode: 'number' }),
  source: varchar('source', { length: 50 }).default('stock_snapshot').notNull(),
  status: varchar('status', { length: 50 }).default('active').notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
  removedAt: timestamp('removed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  redistributionWarehouseRegistryTenantWarehouseIdx: uniqueIndex('redistribution_warehouse_registry_tenant_warehouse_idx')
    .on(table.tenantId, table.warehouseName),
  redistributionWarehouseRegistryTenantStatusIdx: index('redistribution_warehouse_registry_tenant_status_idx')
    .on(table.tenantId, table.status, table.lastSeenAt),
}));

export const redistributionRouteAvailability = pgTable('redistribution_route_availability', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  fromWarehouse: varchar('from_warehouse', { length: 255 }).notNull(),
  toWarehouse: varchar('to_warehouse', { length: 255 }).notNull(),
  status: varchar('status', { length: 50 }).default('unknown').notNull(),
  reason: text('reason'),
  source: varchar('source', { length: 50 }).default('rpa_modal').notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow().notNull(),
  lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  lastRunId: uuid('last_run_id').references(() => redistributionRuns.id, { onDelete: 'set null' }),
  successCount: integer('success_count').default(0).notNull(),
  failCount: integer('fail_count').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  redistributionRouteAvailabilityTenantRouteIdx: uniqueIndex('redistribution_route_availability_tenant_route_idx')
    .on(table.tenantId, table.fromWarehouse, table.toWarehouse),
  redistributionRouteAvailabilityTenantStatusIdx: index('redistribution_route_availability_tenant_status_idx')
    .on(table.tenantId, table.status, table.lastCheckedAt),
  redistributionRouteAvailabilityTenantExpiresIdx: index('redistribution_route_availability_tenant_expires_idx')
    .on(table.tenantId, table.expiresAt),
}));

export const redistributionRouteAvailabilityEvents = pgTable('redistribution_route_availability_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  fromWarehouse: varchar('from_warehouse', { length: 255 }).notNull(),
  toWarehouse: varchar('to_warehouse', { length: 255 }).notNull(),
  status: varchar('status', { length: 50 }).default('unknown').notNull(),
  reason: text('reason'),
  source: varchar('source', { length: 50 }).default('rpa_modal').notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  observedAt: timestamp('observed_at', { withTimezone: true }).defaultNow().notNull(),
  runId: uuid('run_id').references(() => redistributionRuns.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  redistributionRouteAvailabilityEventsTenantObservedIdx: index('redistribution_route_availability_events_tenant_observed_idx')
    .on(table.tenantId, table.observedAt),
  redistributionRouteAvailabilityEventsTenantRouteObservedIdx: index('redistribution_route_availability_events_tenant_route_observed_idx')
    .on(table.tenantId, table.fromWarehouse, table.toWarehouse, table.observedAt),
  redistributionRouteAvailabilityEventsTenantStatusObservedIdx: index('redistribution_route_availability_events_tenant_status_observed_idx')
    .on(table.tenantId, table.status, table.observedAt),
  redistributionRouteAvailabilityEventsTenantSourceObservedIdx: index('redistribution_route_availability_events_tenant_source_observed_idx')
    .on(table.tenantId, table.source, table.observedAt),
}));

export const redistributionSlotMonitorRuns = pgTable('redistribution_slot_monitor_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  triggerSource: varchar('trigger_source', { length: 50 }).default('scheduler').notNull(),
  mode: varchar('mode', { length: 50 }).default('unknown').notNull(),
  status: varchar('status', { length: 50 }).default('completed').notNull(),
  skipped: boolean('skipped').default(false).notNull(),
  message: text('message'),
  autoSubmit: boolean('auto_submit').default(true).notNull(),
  maxRoutesPerTenant: integer('max_routes_per_tenant'),
  probedItems: integer('probed_items').default(0).notNull(),
  openedSlots: integer('opened_slots').default(0).notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  redistributionSlotMonitorRunsTenantStartedIdx: index('redistribution_slot_monitor_runs_tenant_started_idx')
    .on(table.tenantId, table.startedAt),
  redistributionSlotMonitorRunsTenantStatusStartedIdx: index('redistribution_slot_monitor_runs_tenant_status_started_idx')
    .on(table.tenantId, table.status, table.startedAt),
  redistributionSlotMonitorRunsTenantSkippedStartedIdx: index('redistribution_slot_monitor_runs_tenant_skipped_started_idx')
    .on(table.tenantId, table.skipped, table.startedAt),
}));

export const invitations = pgTable('invitations', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  email: varchar('email', { length: 255 }).notNull(),
  role: varchar('role', { length: 50 }).default('viewer').notNull(),
  accessPreset: varchar('access_preset', { length: 50 }).$type<TenantAccessPreset>().default('viewer').notNull(),
  featurePermissions: jsonb('feature_permissions')
    .$type<Partial<TenantFeaturePermissions>>()
    .default(sql`'{}'::jsonb`)
    .notNull(),
  token: varchar('token', { length: 255 }).notNull(),
  invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
  status: varchar('status', { length: 50 }).default('pending').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  inviteTokenIdx: uniqueIndex('invitation_token_idx').on(table.token),
  inviteEmailTenantIdx: uniqueIndex('invitation_email_tenant_idx').on(table.email, table.tenantId),
}));

export const riskSignals = pgTable('risk_signals', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  signalKey: varchar('signal_key', { length: 160 }).notNull(),
  nmId: bigint('nm_id', { mode: 'number' }), // null for tenant-wide signals
  type: varchar('type', { length: 100 }).notNull(), // 'logistics_spike', 'negative_margin', 'stock_out', 'content_risk', etc.
  severity: varchar('severity', { length: 50 }).default('medium').notNull(), // 'critical', 'high', 'medium'
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description').notNull(),
  impactRub: numeric('impact_rub', { precision: 15, scale: 2 }).default('0'),
  status: varchar('status', { length: 50 }).default('active').notNull(), // 'active', 'resolved', 'ignored'
  workflowState: varchar('workflow_state', { length: 50 }).default('new').notNull(),
  assigneeUserId: uuid('assignee_user_id').references(() => users.id, { onDelete: 'set null' }),
  assigneeEmail: varchar('assignee_email', { length: 255 }),
  workflowUpdatedAt: timestamp('workflow_updated_at', { withTimezone: true }),
  workflowUpdatedByUserId: uuid('workflow_updated_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  workflowUpdatedByEmail: varchar('workflow_updated_by_email', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
}, (table) => ({
  riskTenantSignalKeyIdx: uniqueIndex('risk_tenant_signal_key_idx').on(table.tenantId, table.signalKey),
  riskTenantIdx: index('risk_tenant_idx').on(table.tenantId),
  riskNmIdx: index('risk_nm_idx').on(table.nmId),
  riskAssigneeIdx: index('risk_assignee_idx').on(table.tenantId, table.assigneeUserId),
  riskTenantStatusCreatedIdx: index('risk_tenant_status_created_idx').on(table.tenantId, table.status, table.createdAt),
  riskTenantStatusWorkflowIdx: index('risk_tenant_status_workflow_idx').on(table.tenantId, table.status, table.workflowState, table.createdAt),
  riskTenantStatusAssigneeIdx: index('risk_tenant_status_assignee_idx').on(table.tenantId, table.status, table.assigneeUserId, table.createdAt),
}));

export const signalOperatorTimeline = pgTable('signal_operator_timeline', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  signalId: uuid('signal_id').notNull().references(() => riskSignals.id, { onDelete: 'cascade' }),
  actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  actorEmail: varchar('actor_email', { length: 255 }).notNull(),
  actorRole: varchar('actor_role', { length: 50 }).default('viewer').notNull(),
  eventType: varchar('event_type', { length: 50 }).default('view').notNull(),
  openedFrom: varchar('opened_from', { length: 50 }).default('overview').notNull(),
  eventBody: text('event_body'),
  eventPayload: jsonb('event_payload').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  signalTimelineSignalCreatedIdx: index('signal_operator_timeline_signal_created_idx').on(table.tenantId, table.signalId, table.createdAt),
  signalTimelineTenantCreatedIdx: index('signal_operator_timeline_tenant_created_idx').on(table.tenantId, table.createdAt),
  signalTimelineEventIdx: index('signal_operator_timeline_event_idx').on(table.tenantId, table.eventType, table.createdAt),
}));

export const signalNotificationReceipts = pgTable('signal_notification_receipts', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  eventId: uuid('event_id').notNull().references(() => signalOperatorTimeline.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  readAt: timestamp('read_at', { withTimezone: true }),
  acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  signalNotificationReceiptUniqueIdx: uniqueIndex('signal_notification_receipt_unique_idx').on(table.tenantId, table.eventId, table.userId),
  signalNotificationReceiptUserIdx: index('signal_notification_receipt_user_idx').on(table.tenantId, table.userId, table.createdAt),
  signalNotificationReceiptAckIdx: index('signal_notification_receipt_ack_idx').on(table.tenantId, table.userId, table.acknowledgedAt),
}));

export const signalSavedViews = pgTable('signal_saved_views', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 120 }).notNull(),
  sharedOwnerUserId: uuid('shared_owner_user_id').references(() => users.id, { onDelete: 'set null' }),
  sharedOwnerEmail: varchar('shared_owner_email', { length: 255 }),
  scope: varchar('scope', { length: 20 }).default('private').notNull(),
  queueView: varchar('queue_view', { length: 50 }).default('all').notNull(),
  assigneeFilter: varchar('assignee_filter', { length: 64 }).default('all').notNull(),
  workflowFilter: varchar('workflow_filter', { length: 50 }).default('all').notNull(),
  sortPreset: varchar('sort_preset', { length: 50 }).default('severity').notNull(),
  isPinned: boolean('is_pinned').default(false).notNull(),
  isDefault: boolean('is_default').default(false).notNull(),
  position: integer('position').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  signalSavedViewsUserUpdatedIdx: index('signal_saved_views_user_updated_idx').on(table.tenantId, table.userId, table.updatedAt),
  signalSavedViewsUserDefaultIdx: index('signal_saved_views_user_default_idx').on(table.tenantId, table.userId, table.isDefault),
  signalSavedViewsScopePositionIdx: index('signal_saved_views_scope_position_idx').on(table.tenantId, table.scope, table.isPinned, table.position),
  signalSavedViewsUserNameIdx: uniqueIndex('signal_saved_views_user_name_idx').on(table.tenantId, table.userId, table.name),
}));

export const signalAutomationRuns = pgTable('signal_automation_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  automationType: varchar('automation_type', { length: 50 }).default('sla').notNull(),
  automationSource: varchar('automation_source', { length: 50 }).default('manual').notNull(),
  triggerType: varchar('trigger_type', { length: 50 }).default('ad_hoc').notNull(),
  triggerLabel: varchar('trigger_label', { length: 120 }),
  actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  actorEmail: varchar('actor_email', { length: 255 }).notNull(),
  actorRole: varchar('actor_role', { length: 50 }).default('viewer').notNull(),
  savedViewId: uuid('saved_view_id').references(() => signalSavedViews.id, { onDelete: 'set null' }),
  savedViewName: varchar('saved_view_name', { length: 120 }),
  sharedOwnerUserId: uuid('shared_owner_user_id').references(() => users.id, { onDelete: 'set null' }),
  sharedOwnerEmail: varchar('shared_owner_email', { length: 255 }),
  targetSignalCount: integer('target_signal_count').default(0).notNull(),
  eligibleCount: integer('eligible_count').default(0).notNull(),
  affectedCount: integer('affected_count').default(0).notNull(),
  skippedCount: integer('skipped_count').default(0).notNull(),
  appliedPresets: jsonb('applied_presets').$type<Array<{ presetId: string; count: number }>>().default(sql`'[]'::jsonb`).notNull(),
  status: varchar('status', { length: 50 }).default('completed').notNull(),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
}, (table) => ({
  signalAutomationRunsTenantCreatedIdx: index('signal_automation_runs_tenant_created_idx').on(table.tenantId, table.createdAt),
  signalAutomationRunsTenantStatusIdx: index('signal_automation_runs_tenant_status_idx').on(table.tenantId, table.status, table.createdAt),
  signalAutomationRunsSavedViewIdx: index('signal_automation_runs_saved_view_idx').on(table.tenantId, table.savedViewId, table.createdAt),
}));

export const signalAutomationControlEvents = pgTable('signal_automation_control_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  eventType: varchar('event_type', { length: 50 }).notNull(),
  automationType: varchar('automation_type', { length: 50 }).default('sla').notNull(),
  automationSource: varchar('automation_source', { length: 50 }).default('manual').notNull(),
  triggerType: varchar('trigger_type', { length: 50 }).default('ad_hoc').notNull(),
  triggerLabel: varchar('trigger_label', { length: 120 }),
  actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  actorEmail: varchar('actor_email', { length: 255 }).notNull(),
  actorRole: varchar('actor_role', { length: 50 }).default('viewer').notNull(),
  savedViewId: uuid('saved_view_id').references(() => signalSavedViews.id, { onDelete: 'set null' }),
  savedViewName: varchar('saved_view_name', { length: 120 }),
  sharedOwnerUserId: uuid('shared_owner_user_id').references(() => users.id, { onDelete: 'set null' }),
  sharedOwnerEmail: varchar('shared_owner_email', { length: 255 }),
  linkedEventId: uuid('linked_event_id'),
  automationRunId: uuid('automation_run_id').references(() => signalAutomationRuns.id, { onDelete: 'set null' }),
  targetType: varchar('target_type', { length: 50 }),
  reason: text('reason'),
  suppressUntil: timestamp('suppress_until', { withTimezone: true }),
  targetSignalCount: integer('target_signal_count').default(0).notNull(),
  eligibleCount: integer('eligible_count').default(0).notNull(),
  affectedCount: integer('affected_count').default(0).notNull(),
  skippedCount: integer('skipped_count').default(0).notNull(),
  awaitingOutcomeCount: integer('awaiting_outcome_count').default(0).notNull(),
  matchedSuppressionCount: integer('matched_suppression_count').default(0).notNull(),
  appliedPresets: jsonb('applied_presets').$type<Array<{ presetId: string; count: number }>>().default(sql`'[]'::jsonb`).notNull(),
  status: varchar('status', { length: 50 }).default('completed').notNull(),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  signalAutomationControlEventsTenantCreatedIdx: index('signal_automation_control_events_tenant_created_idx').on(table.tenantId, table.createdAt),
  signalAutomationControlEventsEventTypeIdx: index('signal_automation_control_events_event_type_idx').on(table.tenantId, table.eventType, table.createdAt),
  signalAutomationControlEventsRunIdx: index('signal_automation_control_events_run_idx').on(table.tenantId, table.automationRunId, table.createdAt),
  signalAutomationControlEventsLinkedIdx: index('signal_automation_control_events_linked_idx').on(table.tenantId, table.linkedEventId, table.createdAt),
}));

export const signalAutomationSuppressions = pgTable('signal_automation_suppressions', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  targetType: varchar('target_type', { length: 50 }).notNull(),
  savedViewId: uuid('saved_view_id').references(() => signalSavedViews.id, { onDelete: 'cascade' }),
  savedViewName: varchar('saved_view_name', { length: 120 }),
  sharedOwnerUserId: uuid('shared_owner_user_id').references(() => users.id, { onDelete: 'cascade' }),
  sharedOwnerEmail: varchar('shared_owner_email', { length: 255 }),
  reason: text('reason'),
  suppressUntil: timestamp('suppress_until', { withTimezone: true }),
  actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  actorEmail: varchar('actor_email', { length: 255 }).notNull(),
  actorRole: varchar('actor_role', { length: 50 }).default('viewer').notNull(),
  clearedAt: timestamp('cleared_at', { withTimezone: true }),
  clearedByUserId: uuid('cleared_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  clearedByEmail: varchar('cleared_by_email', { length: 255 }),
  clearedByRole: varchar('cleared_by_role', { length: 50 }),
  clearReason: text('clear_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  signalAutomationSuppressionsTenantTargetIdx: index('signal_automation_suppressions_tenant_target_idx').on(table.tenantId, table.targetType, table.createdAt),
  signalAutomationSuppressionsSavedViewIdx: index('signal_automation_suppressions_saved_view_idx').on(table.tenantId, table.savedViewId),
  signalAutomationSuppressionsOwnerIdx: index('signal_automation_suppressions_owner_idx').on(table.tenantId, table.sharedOwnerUserId),
  signalAutomationSuppressionsActiveIdx: index('signal_automation_suppressions_active_idx').on(table.tenantId, table.targetType, table.clearedAt, table.suppressUntil, table.createdAt),
}));

export const rawApiProductMetadata = pgTable('raw_api_product_metadata', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  nmId: bigint('nm_id', { mode: 'number' }).notNull(),
  title: varchar('title', { length: 255 }),
  description: text('description'),
  photosCount: integer('photos_count').default(0).notNull(),
  hasVideo: boolean('has_video').default(false).notNull(),
  characteristicsCount: integer('characteristics_count').default(0).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  metadataTenantNmIdx: uniqueIndex('metadata_tenant_nm_idx').on(table.tenantId, table.nmId),
}));

export const products = pgTable('products', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  nmId: bigint('nm_id', { mode: 'number' }).notNull(),
  vendorCode: varchar('vendor_code', { length: 255 }).notNull(),
  barcode: varchar('barcode', { length: 255 }),
  brand: varchar('brand', { length: 255 }),
  category: varchar('category', { length: 255 }),
  photoUrl: text('photo_url'),
  isHidden: boolean('is_hidden').default(false).notNull(),
  isArchived: boolean('is_archived').default(false).notNull(),
  // WB-side volume in litres from /api/v1/warehouse_remains (the same number
  // that appears as «Объём, л» in the cabinet's xlsx export). Reflects the
  // packaging volume WB charges logistics/storage on, including combo SKUs.
  // Set by the warehouse-remains sync; null until the first sync.
  wbWarehouseVolumeLiters: numeric('wb_warehouse_volume_liters', { precision: 8, scale: 3 }),
  wbWarehouseVolumeUpdatedAt: timestamp('wb_warehouse_volume_updated_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  tenantNmIdIdx: uniqueIndex('products_tenant_nm_id_idx').on(table.tenantId, table.nmId),
}));

export const unitEconomicsConfigs = pgTable('unit_economics_configs', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  nmId: bigint('nm_id', { mode: 'number' }).notNull(),
  costPrice: numeric('cost_price', { precision: 12, scale: 2 }).notNull(),
  effectiveFrom: timestamp('effective_from', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  tenantNmIdDateIdx: uniqueIndex('config_historical_idx').on(table.tenantId, table.nmId, table.effectiveFrom),
}));

export const unitEconomicsManualInputs = pgTable('unit_economics_manual_inputs', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  nmId: bigint('nm_id', { mode: 'number' }).notNull(),
  manualFields: jsonb('manual_fields').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  tenantNmManualIdx: uniqueIndex('unit_economics_manual_inputs_tenant_nm_idx').on(table.tenantId, table.nmId),
  tenantUpdatedIdx: index('unit_economics_manual_inputs_tenant_updated_idx').on(table.tenantId, table.updatedAt),
}));

export const tenantUnitEconomicsIndices = pgTable('tenant_unit_economics_indices', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  effectiveWeek: date('effective_week').notNull(),
  localityIndex: numeric('locality_index', { precision: 8, scale: 4 }).default('1').notNull(),
  irpPercent: numeric('irp_percent', { precision: 8, scale: 4 }).default('0').notNull(),
  source: varchar('source', { length: 32 }).default('manual').notNull(),
  rawData: jsonb('raw_data').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  tenantUnitEconomicsIndicesTenantWeekIdx: uniqueIndex('tenant_unit_economics_indices_tenant_week_idx').on(table.tenantId, table.effectiveWeek),
  tenantUnitEconomicsIndicesTenantFetchedIdx: index('tenant_unit_economics_indices_tenant_fetched_idx').on(table.tenantId, table.fetchedAt),
}));

// stockPlanningInputs (legacy 1-row-per-SKU planning inputs) was dropped in
// P87 Stage 6, migration 0063. The data model is replaced by:
//   - own_stock_batches + own_stock_movements (own warehouse with full history)
//   - production_orders + production_order_lines (in-transit / in-production
//     with multi-SKU batches and lifecycle).

export const ausnMonthlyInputs = pgTable('ausn_monthly_inputs', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  month: date('month').notNull(),
  taxObject: varchar('tax_object', { length: 32 }).default('income').notNull(),
  bankIncome: numeric('bank_income', { precision: 14, scale: 2 }).default('0').notNull(),
  bankIncomeReturn: numeric('bank_income_return', { precision: 14, scale: 2 }).default('0').notNull(),
  bankExpense: numeric('bank_expense', { precision: 14, scale: 2 }).default('0').notNull(),
  bankExpenseReturn: numeric('bank_expense_return', { precision: 14, scale: 2 }).default('0').notNull(),
  otherExpenses: numeric('other_expenses', { precision: 14, scale: 2 }).default('0').notNull(),
  notes: text('notes'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  ausnMonthlyTenantMonthIdx: uniqueIndex('ausn_monthly_inputs_tenant_month_idx').on(table.tenantId, table.month),
  ausnMonthlyTenantUpdatedIdx: index('ausn_monthly_inputs_tenant_updated_idx').on(table.tenantId, table.updatedAt),
}));

export const ausnDocumentRows = pgTable('ausn_document_rows', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  month: date('month').notNull(),
  documentType: varchar('document_type', { length: 40 }).notNull(),
  amount: numeric('amount', { precision: 14, scale: 2 }).default('0').notNull(),
  title: text('title'),
  documentDate: date('document_date'),
  source: text('source'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  ausnDocumentRowsTenantMonthIdx: index('ausn_document_rows_tenant_month_idx').on(table.tenantId, table.month),
  ausnDocumentRowsTenantTypeMonthIdx: index('ausn_document_rows_tenant_type_month_idx').on(table.tenantId, table.documentType, table.month),
}));

export const financeAccounts = pgTable('finance_accounts', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 160 }).notNull(),
  type: varchar('type', { length: 32 }).default('bank').notNull(),
  currency: varchar('currency', { length: 8 }).default('RUB').notNull(),
  openingBalance: numeric('opening_balance', { precision: 14, scale: 2 }).default('0').notNull(),
  openingBalanceDate: date('opening_balance_date').default(sql`CURRENT_DATE`).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  sortOrder: integer('sort_order').default(100).notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  financeAccountsTenantNameIdx: uniqueIndex('finance_accounts_tenant_name_idx').on(table.tenantId, table.name),
  financeAccountsTenantTypeIdx: index('finance_accounts_tenant_type_idx').on(table.tenantId, table.type, table.isActive),
}));

export const financeCategories = pgTable('finance_categories', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 180 }).notNull(),
  kind: varchar('kind', { length: 32 }).default('expense').notNull(),
  cashflowSection: varchar('cashflow_section', { length: 32 }).default('operating').notNull(),
  pnlSection: varchar('pnl_section', { length: 32 }).default('opex').notNull(),
  isSystem: boolean('is_system').default(false).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  sortOrder: integer('sort_order').default(100).notNull(),
  color: varchar('color', { length: 32 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  financeCategoriesTenantNameIdx: uniqueIndex('finance_categories_tenant_name_idx').on(table.tenantId, table.name),
  financeCategoriesTenantKindIdx: index('finance_categories_tenant_kind_idx').on(table.tenantId, table.kind, table.isActive),
}));

export const financeTransactions = pgTable('finance_transactions', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  economicDate: date('economic_date'),
  operationType: varchar('operation_type', { length: 32 }).notNull(),
  status: varchar('status', { length: 24 }).default('actual').notNull(),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  currency: varchar('currency', { length: 8 }).default('RUB').notNull(),
  fromAccountId: uuid('from_account_id').references(() => financeAccounts.id, { onDelete: 'set null' }),
  toAccountId: uuid('to_account_id').references(() => financeAccounts.id, { onDelete: 'set null' }),
  categoryId: uuid('category_id').references(() => financeCategories.id, { onDelete: 'set null' }),
  counterparty: varchar('counterparty', { length: 255 }),
  description: text('description'),
  sourceType: varchar('source_type', { length: 40 }).default('manual').notNull(),
  sourceId: text('source_id'),
  externalId: text('external_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  financeTransactionsTenantOccurredIdx: index('finance_transactions_tenant_occurred_idx').on(table.tenantId, table.occurredAt),
  financeTransactionsTenantStatusIdx: index('finance_transactions_tenant_status_idx').on(table.tenantId, table.status, table.occurredAt),
  financeTransactionsTenantCategoryIdx: index('finance_transactions_tenant_category_idx').on(table.tenantId, table.categoryId, table.occurredAt),
  financeTransactionsFromAccountIdx: index('finance_transactions_from_account_idx').on(table.fromAccountId, table.occurredAt),
  financeTransactionsToAccountIdx: index('finance_transactions_to_account_idx').on(table.toAccountId, table.occurredAt),
}));

export const financeDebts = pgTable('finance_debts', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 180 }).notNull(),
  debtType: varchar('debt_type', { length: 32 }).default('loan').notNull(),
  status: varchar('status', { length: 24 }).default('active').notNull(),
  counterparty: varchar('counterparty', { length: 255 }),
  principalAmount: numeric('principal_amount', { precision: 14, scale: 2 }).notNull(),
  outstandingAmount: numeric('outstanding_amount', { precision: 14, scale: 2 }).notNull(),
  currency: varchar('currency', { length: 8 }).default('RUB').notNull(),
  openedAt: date('opened_at').default(sql`CURRENT_DATE`).notNull(),
  dueAt: date('due_at'),
  interestRatePercent: numeric('interest_rate_percent', { precision: 7, scale: 3 }),
  accountId: uuid('account_id').references(() => financeAccounts.id, { onDelete: 'set null' }),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  financeDebtsTenantStatusIdx: index('finance_debts_tenant_status_idx').on(table.tenantId, table.status, table.dueAt),
  financeDebtsTenantTypeIdx: index('finance_debts_tenant_type_idx').on(table.tenantId, table.debtType),
}));

export const financeBudgetItems = pgTable('finance_budget_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  periodMonth: date('period_month').notNull(),
  name: varchar('name', { length: 180 }).notNull(),
  direction: varchar('direction', { length: 16 }).default('outflow').notNull(),
  plannedAmount: numeric('planned_amount', { precision: 14, scale: 2 }).notNull(),
  actualAmount: numeric('actual_amount', { precision: 14, scale: 2 }).default('0').notNull(),
  categoryId: uuid('category_id').references(() => financeCategories.id, { onDelete: 'set null' }),
  accountId: uuid('account_id').references(() => financeAccounts.id, { onDelete: 'set null' }),
  dueAt: date('due_at'),
  status: varchar('status', { length: 24 }).default('planned').notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  financeBudgetItemsTenantMonthIdx: index('finance_budget_items_tenant_month_idx').on(table.tenantId, table.periodMonth),
  financeBudgetItemsTenantStatusIdx: index('finance_budget_items_tenant_status_idx').on(table.tenantId, table.status, table.dueAt),
}));

export const rawApiRealizationReports = pgTable('raw_api_realization_reports', {
  rrdId: bigint('rrd_id', { mode: 'number' }).notNull(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  realizationreportId: bigint('realizationreport_id', { mode: 'number' }).notNull(),
  dateFrom: timestamp('date_from', { withTimezone: true }).notNull(),
  dateTo: timestamp('date_to', { withTimezone: true }).notNull(),
  saleDt: timestamp('sale_dt', { withTimezone: true }),
  srid: varchar('srid', { length: 255 }).default('').notNull(),
  docTypeName: text('doc_type_name').default('').notNull(),
  supplierOperName: text('supplier_oper_name').default('').notNull(),
  bonusTypeName: text('bonus_type_name').default('').notNull(),
  rebillLogisticOrg: text('rebill_logistic_org').default('').notNull(),
  officeName: varchar('office_name', { length: 255 }),
  nmId: bigint('nm_id', { mode: 'number' }).notNull(),
  quantity: integer('quantity').default(0).notNull(),
  retailAmount: numeric('retail_amount', { precision: 12, scale: 2 }).default('0').notNull(),
  commissionAmount: numeric('commission_amount', { precision: 12, scale: 2 }).default('0').notNull(),
  deliveryRub: numeric('delivery_rub', { precision: 12, scale: 2 }).default('0').notNull(),
  boxDeliveryBase: numeric('box_delivery_base', { precision: 12, scale: 2 }).default('0').notNull(),
  boxDeliveryLiter: numeric('box_delivery_liter', { precision: 12, scale: 2 }).default('0').notNull(),
  boxStorageBase: numeric('box_storage_base', { precision: 12, scale: 2 }).default('0').notNull(),
  boxStorageLiter: numeric('box_storage_liter', { precision: 12, scale: 2 }).default('0').notNull(),
  storageFeeRub: numeric('storage_fee_rub', { precision: 12, scale: 2 }).default('0').notNull(),
  penaltyRub: numeric('penalty_rub', { precision: 12, scale: 2 }).default('0').notNull(),
  sppRub: numeric('spp_rub', { precision: 12, scale: 2 }).default('0').notNull(),
  paymentScheduleRub: numeric('payment_schedule_rub', { precision: 12, scale: 2 }).default('0').notNull(),
  ppvzForPay: numeric('ppvz_for_pay', { precision: 12, scale: 2 }).default('0').notNull(),
  deduction: numeric('deduction', { precision: 12, scale: 2 }).default('0').notNull(),
  additionalPayment: numeric('additional_payment', { precision: 12, scale: 2 }).default('0').notNull(),
  acquiringFee: numeric('acquiring_fee', { precision: 12, scale: 2 }).default('0').notNull(),
  returnAmount: numeric('return_amount', { precision: 12, scale: 2 }).default('0').notNull(),
  retailPriceWithdiscRub: numeric('retail_price_withdisc_rub', { precision: 12, scale: 2 }).default('0').notNull(),
  acceptance: numeric('acceptance', { precision: 12, scale: 2 }).default('0').notNull(),
  cashbackAmount: numeric('cashback_amount', { precision: 12, scale: 2 }).default('0').notNull(),
  ppvzSppPrc: numeric('ppvz_spp_prc', { precision: 8, scale: 4 }).default('0').notNull(),
  ppvzKvwPrcBase: numeric('ppvz_kvw_prc_base', { precision: 8, scale: 4 }).default('0').notNull(),
  ppvzKvwPrc: numeric('ppvz_kvw_prc', { precision: 8, scale: 4 }).default('0').notNull(),
  fixationStartDate: date('fixation_start_date'),
  fixationEndDate: date('fixation_end_date'),
  isPaidDeliveryService: boolean('is_paid_delivery_service'),
  fixedWarehouseCoefficient: numeric('fixed_warehouse_coefficient', { precision: 10, scale: 4 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  realizationTenantRrdIdUnique: uniqueIndex('raw_api_realization_reports_tenant_rrd_id_unique')
    .on(table.tenantId, table.rrdId),
  realizationTenantDateIdx: index('realization_tenant_date_idx')
    .on(table.tenantId, table.dateFrom, table.dateTo),
  realizationTenantNmDateIdx: index('realization_tenant_nm_date_idx')
    .on(table.tenantId, table.nmId, table.dateFrom),
  realizationTenantSaleDtIdx: index('realization_tenant_sale_dt_idx')
    .on(table.tenantId, table.saleDt),
  realizationTenantNmSaleDtIdx: index('realization_tenant_nm_sale_dt_idx')
    .on(table.tenantId, table.nmId, table.saleDt),
  realizationTenantSridIdx: index('realization_tenant_srid_idx')
    .on(table.tenantId, table.srid)
    .where(sql`${table.srid} <> ''`),
  realizationTenantNmFixationIdx: index('realization_tenant_nm_fixation_idx')
    .on(table.tenantId, table.nmId, table.fixationStartDate, table.fixationEndDate, table.fixedWarehouseCoefficient)
    .where(sql`${table.fixationStartDate} IS NOT NULL AND ${table.fixationEndDate} IS NOT NULL AND COALESCE(${table.deliveryRub}, 0) > 0`),
  realizationTenantNmOfficeFixationIdx: index('realization_tenant_nm_office_fixation_idx')
    .on(table.tenantId, table.nmId, table.officeName, table.fixationStartDate, table.fixationEndDate)
    .where(sql`${table.officeName} IS NOT NULL AND ${table.fixationStartDate} IS NOT NULL AND ${table.fixationEndDate} IS NOT NULL AND COALESCE(${table.deliveryRub}, 0) > 0`),
}));

export const rawApiOrders = pgTable('raw_api_orders', {
  srid: varchar('srid', { length: 255 }).notNull(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  nmId: bigint('nm_id', { mode: 'number' }).notNull(),
  date: timestamp('date', { withTimezone: true }).notNull(),
  totalPrice: numeric('total_price', { precision: 12, scale: 2 }).default('0').notNull(),
  isCancel: boolean('is_cancel').default(false).notNull(),
  warehouseName: varchar('warehouse_name', { length: 255 }),
  warehouseType: varchar('warehouse_type', { length: 120 }),
  countryName: varchar('country_name', { length: 128 }),
  oblastOkrugName: varchar('oblast_okrug_name', { length: 255 }),
  regionName: varchar('region_name', { length: 255 }),
  supplierArticle: varchar('supplier_article', { length: 255 }),
  barcode: varchar('barcode', { length: 255 }),
  category: varchar('category', { length: 255 }),
  subject: varchar('subject', { length: 255 }),
  brand: varchar('brand', { length: 255 }),
  techSize: varchar('tech_size', { length: 64 }),
  incomeId: bigint('income_id', { mode: 'number' }),
  spp: numeric('spp', { precision: 8, scale: 2 }),
  finishedPrice: numeric('finished_price', { precision: 12, scale: 2 }),
  priceWithDisc: numeric('price_with_disc', { precision: 12, scale: 2 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  ordersTenantSridUnique: uniqueIndex('raw_api_orders_tenant_srid_unique')
    .on(table.tenantId, table.srid),
  ordersTenantDateIdx: index('orders_tenant_date_idx').on(table.tenantId, table.date),
  ordersTenantNmDateIdx: index('orders_tenant_nm_date_idx').on(table.tenantId, table.nmId, table.date),
  ordersTenantDateActiveIdx: index('orders_tenant_date_active_idx')
    .on(table.tenantId, table.date)
    .where(sql`${table.isCancel} = false`),
  ordersTenantNmWarehouseDateIdx: index('orders_tenant_nm_warehouse_date_idx')
    .on(table.tenantId, table.nmId, table.warehouseName, table.date)
    .where(sql`${table.isCancel} = false AND ${table.warehouseName} IS NOT NULL`),
}));

export const rawApiAdCosts = pgTable('raw_api_ad_costs', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  nmId: bigint('nm_id', { mode: 'number' }).notNull(),
  date: timestamp('date', { withTimezone: true }).notNull(),
  amount: numeric('amount', { precision: 12, scale: 2 }).default('0').notNull(),
  orderCount: integer('order_count').default(0).notNull(),
  orderSum: numeric('order_sum', { precision: 12, scale: 2 }).default('0').notNull(),
  views: integer('views').default(0).notNull(),
  clicks: integer('clicks').default(0).notNull(),
  type: varchar('type', { length: 100 }), // Unified Promotion, Search, etc.
  placement: varchar('placement', { length: 255 }), // Search, Catalog, Recommendations, etc.
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  tenantNmDateTypeIdx: uniqueIndex('ad_costs_composite_idx').on(table.tenantId, table.nmId, table.date, table.placement),
  adCostsTenantDateIdx: index('ad_costs_tenant_date_idx').on(table.tenantId, table.date),
}));

export const rawApiAdClusters = pgTable('raw_api_ad_clusters', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  nmId: bigint('nm_id', { mode: 'number' }).notNull(),
  date: timestamp('date', { withTimezone: true }).notNull(),
  cluster: varchar('cluster', { length: 500 }).notNull(),
  views: integer('views').default(0).notNull(),
  clicks: integer('clicks').default(0).notNull(),
  ctr: numeric('ctr', { precision: 12, scale: 4 }).default('0').notNull(),
  amount: numeric('amount', { precision: 12, scale: 2 }).default('0').notNull(),
  orderCount: integer('order_count').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  tenantNmDateClusterIdx: uniqueIndex('ad_clusters_composite_idx').on(table.tenantId, table.nmId, table.date, table.cluster),
}));

export const advertisingHourlyStats = pgTable('advertising_hourly_stats', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  advertId: bigint('advert_id', { mode: 'number' }).default(0).notNull(),
  nmId: bigint('nm_id', { mode: 'number' }).notNull(),
  statDate: date('stat_date').notNull(),
  statHour: timestamp('stat_hour', { withTimezone: true }).notNull(),
  adSpend: numeric('ad_spend', { precision: 12, scale: 2 }).default('0').notNull(),
  views: integer('views').default(0).notNull(),
  clicks: integer('clicks').default(0).notNull(),
  orderCount: integer('order_count').default(0).notNull(),
  orderSum: numeric('order_sum', { precision: 12, scale: 2 }).default('0').notNull(),
  cumulativeAdSpend: numeric('cumulative_ad_spend', { precision: 12, scale: 2 }).default('0').notNull(),
  cumulativeViews: integer('cumulative_views').default(0).notNull(),
  cumulativeClicks: integer('cumulative_clicks').default(0).notNull(),
  cumulativeOrderCount: integer('cumulative_order_count').default(0).notNull(),
  cumulativeOrderSum: numeric('cumulative_order_sum', { precision: 12, scale: 2 }).default('0').notNull(),
  source: varchar('source', { length: 64 }).default('adv_v3_fullstats_delta').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  advertisingHourlyStatsTenantNmHourSourceIdx: uniqueIndex('advertising_hourly_stats_tenant_nm_hour_source_uidx')
    .on(table.tenantId, table.advertId, table.nmId, table.statHour, table.source),
  advertisingHourlyStatsTenantDateHourIdx: index('advertising_hourly_stats_tenant_date_hour_idx')
    .on(table.tenantId, table.statDate, table.statHour),
  advertisingHourlyStatsTenantAdvertDateHourIdx: index('advertising_hourly_stats_tenant_advert_date_hour_idx')
    .on(table.tenantId, table.advertId, table.statDate, table.statHour),
}));

export const advertisingClusterActions = pgTable('advertising_cluster_actions', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  advertId: bigint('advert_id', { mode: 'number' }).notNull(),
  nmId: bigint('nm_id', { mode: 'number' }).notNull(),
  cluster: varchar('cluster', { length: 500 }).notNull(),
  action: varchar('action', { length: 32 }).notNull(), // exclude | include
  status: varchar('status', { length: 32 }).default('success').notNull(), // success | failed
  beforeMinusCount: integer('before_minus_count').default(0).notNull(),
  afterMinusCount: integer('after_minus_count').default(0).notNull(),
  errorMessage: text('error_message'),
  meta: jsonb('meta').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  advertisingClusterActionsTenantIdx: index('advertising_cluster_actions_tenant_idx')
    .on(table.tenantId, table.createdAt),
  advertisingClusterActionsTenantNmClusterIdx: index('advertising_cluster_actions_tenant_nm_cluster_idx')
    .on(table.tenantId, table.nmId, table.cluster, table.createdAt),
  advertisingClusterActionsTenantAdvertIdx: index('advertising_cluster_actions_tenant_advert_idx')
    .on(table.tenantId, table.advertId, table.createdAt),
}));

export const advertisingBidChanges = pgTable('advertising_bid_changes', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  strategyId: uuid('strategy_id'),
  runId: uuid('run_id'),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  source: varchar('source', { length: 32 }).default('manual').notNull(), // manual | batch | auto
  advertId: bigint('advert_id', { mode: 'number' }).notNull(),
  nmId: bigint('nm_id', { mode: 'number' }).notNull(),
  cluster: varchar('cluster', { length: 500 }).notNull(),
  previousBid: integer('previous_bid'),
  nextBid: integer('next_bid'),
  status: varchar('status', { length: 32 }).default('applied').notNull(), // applied | preview | failed | skipped | guardrail_blocked
  reason: text('reason'),
  // Deterministic key for Inngest-step idempotency: {runId}:{nmId}:{cluster}.
  // NULL allowed for pre-existing rows; new writes should always populate it.
  idempotencyKey: varchar('idempotency_key', { length: 255 }),
  metrics: jsonb('metrics').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  advertisingBidChangesTenantIdx: index('advertising_bid_changes_tenant_idx')
    .on(table.tenantId, table.createdAt),
  advertisingBidChangesTenantSourceIdx: index('advertising_bid_changes_tenant_source_idx')
    .on(table.tenantId, table.source, table.createdAt),
  advertisingBidChangesTenantStrategyIdx: index('advertising_bid_changes_tenant_strategy_idx')
    .on(table.tenantId, table.strategyId, table.createdAt),
  advertisingBidChangesTenantRunIdx: index('advertising_bid_changes_tenant_run_idx')
    .on(table.tenantId, table.runId, table.createdAt),
  advertisingBidChangesIdempotencyIdx: uniqueIndex('advertising_bid_changes_idempotency_uidx')
    .on(table.tenantId, table.idempotencyKey),
}));

export const advertisingAutoBidStrategies = pgTable('advertising_auto_bid_strategies', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  name: varchar('name', { length: 160 }).notNull(),
  advertId: bigint('advert_id', { mode: 'number' }).notNull(),
  nmId: bigint('nm_id', { mode: 'number' }).notNull(),
  isEnabled: boolean('is_enabled').default(true).notNull(),
  dryRun: boolean('dry_run').default(false).notNull(),
  targetAcosPct: numeric('target_acos_pct', { precision: 8, scale: 2 }).default('25').notNull(),
  biddingMode: varchar('bidding_mode', { length: 16 }).default('drr').notNull(),
  targetCpmRub: numeric('target_cpm_rub', { precision: 10, scale: 2 }).default('200').notNull(),
  targetRoas: numeric('target_roas', { precision: 8, scale: 2 }).default('4').notNull(),
  minOrders: integer('min_orders').default(2).notNull(),
  maxCpcRub: numeric('max_cpc_rub', { precision: 10, scale: 2 }).default('80').notNull(),
  minBid: integer('min_bid').default(100).notNull(),
  maxBid: integer('max_bid').default(5000).notNull(),
  stepUpPct: numeric('step_up_pct', { precision: 8, scale: 2 }).default('10').notNull(),
  stepDownPct: numeric('step_down_pct', { precision: 8, scale: 2 }).default('10').notNull(),
  lookbackDays: integer('lookback_days').default(7).notNull(),
  intervalMinutes: integer('interval_minutes').default(60).notNull(),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  nextRunAt: timestamp('next_run_at', { withTimezone: true }),
  lastStatus: varchar('last_status', { length: 32 }),
  lastSummary: jsonb('last_summary').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  guardrailConfig: jsonb('guardrail_config').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  lastBidChangedAt: timestamp('last_bid_changed_at', { withTimezone: true }),
  strategyStartedAt: timestamp('strategy_started_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  advertisingAutoBidStrategiesTenantIdx: index('advertising_auto_bid_strategies_tenant_idx')
    .on(table.tenantId, table.createdAt),
  advertisingAutoBidStrategiesTenantEnabledIdx: index('advertising_auto_bid_strategies_tenant_enabled_idx')
    .on(table.tenantId, table.isEnabled, table.nextRunAt),
  advertisingAutoBidStrategiesTenantAdvertNmIdx: index('advertising_auto_bid_strategies_tenant_advert_nm_idx')
    .on(table.tenantId, table.advertId, table.nmId, table.updatedAt),
}));

export const advertisingAutoBidRuns = pgTable('advertising_auto_bid_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  strategyId: uuid('strategy_id').notNull().references(() => advertisingAutoBidStrategies.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  triggerSource: varchar('trigger_source', { length: 32 }).default('manual').notNull(), // manual | scheduled
  status: varchar('status', { length: 32 }).default('running').notNull(), // running | success | failed | skipped
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  summary: jsonb('summary').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  errorMessage: text('error_message'),
}, (table) => ({
  advertisingAutoBidRunsTenantIdx: index('advertising_auto_bid_runs_tenant_idx')
    .on(table.tenantId, table.startedAt),
  advertisingAutoBidRunsStrategyIdx: index('advertising_auto_bid_runs_strategy_idx')
    .on(table.strategyId, table.startedAt),
  advertisingAutoBidRunsTenantStatusIdx: index('advertising_auto_bid_runs_tenant_status_idx')
    .on(table.tenantId, table.status, table.startedAt),
}));

export const advertisingGuardrailEvents = pgTable('advertising_guardrail_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  strategyId: uuid('strategy_id').notNull().references(() => advertisingAutoBidStrategies.id, { onDelete: 'cascade' }),
  runId: uuid('run_id').references(() => advertisingAutoBidRuns.id, { onDelete: 'set null' }),
  trigger: varchar('trigger', { length: 64 }).notNull(),
  cluster: varchar('cluster', { length: 255 }),
  context: jsonb('context').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  advertisingGuardrailEventsTenantIdx: index('advertising_guardrail_events_tenant_idx')
    .on(table.tenantId, table.createdAt),
  advertisingGuardrailEventsStrategyIdx: index('advertising_guardrail_events_strategy_idx')
    .on(table.strategyId, table.createdAt),
}));

export const advertisingBidPacingRules = pgTable('advertising_bid_pacing_rules', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  name: varchar('name', { length: 160 }).notNull(),
  advertId: bigint('advert_id', { mode: 'number' }).notNull(),
  nmId: bigint('nm_id', { mode: 'number' }).notNull(),
  isEnabled: boolean('is_enabled').default(true).notNull(),
  dryRun: boolean('dry_run').default(true).notNull(),
  dailyBudgetRub: numeric('daily_budget_rub', { precision: 12, scale: 2 }).default('0').notNull(),
  softCapPct: numeric('soft_cap_pct', { precision: 8, scale: 2 }).default('85').notNull(),
  stepDownPct: numeric('step_down_pct', { precision: 8, scale: 2 }).default('20').notNull(),
  minBid: integer('min_bid').default(100).notNull(),
  maxBid: integer('max_bid').default(5000).notNull(),
  daypartHours: jsonb('daypart_hours').$type<number[]>().default(sql`'[]'::jsonb`).notNull(),
  timezone: varchar('timezone', { length: 64 }).default('Europe/Moscow').notNull(),
  intervalMinutes: integer('interval_minutes').default(20).notNull(),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  nextRunAt: timestamp('next_run_at', { withTimezone: true }),
  lastStatus: varchar('last_status', { length: 32 }),
  lastSummary: jsonb('last_summary').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  advertisingBidPacingRulesTenantIdx: index('advertising_bid_pacing_rules_tenant_idx')
    .on(table.tenantId, table.createdAt),
  advertisingBidPacingRulesTenantEnabledIdx: index('advertising_bid_pacing_rules_tenant_enabled_idx')
    .on(table.tenantId, table.isEnabled, table.nextRunAt),
  advertisingBidPacingRulesTenantAdvertNmIdx: index('advertising_bid_pacing_rules_tenant_advert_nm_idx')
    .on(table.tenantId, table.advertId, table.nmId, table.updatedAt),
}));

export const advertisingBidPortfolios = pgTable('advertising_bid_portfolios', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  name: varchar('name', { length: 160 }).notNull(),
  brandFilter: varchar('brand_filter', { length: 255 }),
  nmIds: jsonb('nm_ids').$type<number[]>().default(sql`'[]'::jsonb`).notNull(),
  isEnabled: boolean('is_enabled').default(true).notNull(),
  dryRun: boolean('dry_run').default(true).notNull(),
  targetAcosPct: numeric('target_acos_pct', { precision: 8, scale: 2 }).default('25').notNull(),
  minOrders: integer('min_orders').default(2).notNull(),
  maxCpcRub: numeric('max_cpc_rub', { precision: 10, scale: 2 }).default('80').notNull(),
  dailyBudgetRub: numeric('daily_budget_rub', { precision: 12, scale: 2 }).default('0').notNull(),
  minBid: integer('min_bid').default(100).notNull(),
  maxBid: integer('max_bid').default(5000).notNull(),
  stepUpPct: numeric('step_up_pct', { precision: 8, scale: 2 }).default('10').notNull(),
  stepDownPct: numeric('step_down_pct', { precision: 8, scale: 2 }).default('10').notNull(),
  lookbackDays: integer('lookback_days').default(7).notNull(),
  intervalMinutes: integer('interval_minutes').default(60).notNull(),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  nextRunAt: timestamp('next_run_at', { withTimezone: true }),
  lastStatus: varchar('last_status', { length: 32 }),
  lastSummary: jsonb('last_summary').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  advertisingBidPortfoliosTenantIdx: index('advertising_bid_portfolios_tenant_idx')
    .on(table.tenantId, table.createdAt),
  advertisingBidPortfoliosTenantEnabledIdx: index('advertising_bid_portfolios_tenant_enabled_idx')
    .on(table.tenantId, table.isEnabled, table.nextRunAt),
  advertisingBidPortfoliosTenantUpdatedIdx: index('advertising_bid_portfolios_tenant_updated_idx')
    .on(table.tenantId, table.updatedAt),
}));

export const rawApiFunnelStats = pgTable('raw_api_funnel_stats', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  nmId: bigint('nm_id', { mode: 'number' }).notNull(),
  date: timestamp('date', { withTimezone: true }).notNull(),
  periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
  periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
  openCardCount: integer('open_card_count').default(0).notNull(),
  addToCartCount: integer('add_to_cart_count').default(0).notNull(),
  orderCount: integer('order_count').default(0).notNull(),
  orderSum: numeric('order_sum', { precision: 12, scale: 2 }).default('0').notNull(),
  buyoutCount: integer('buyout_count').default(0).notNull(),
  buyoutSum: numeric('buyout_sum', { precision: 12, scale: 2 }).default('0').notNull(),
  cancelCount: integer('cancel_count').default(0).notNull(),
  cancelSum: numeric('cancel_sum', { precision: 12, scale: 2 }).default('0').notNull(),
  avgPrice: numeric('avg_price', { precision: 12, scale: 2 }).default('0').notNull(),
  addToCartPercent: numeric('add_to_cart_percent', { precision: 8, scale: 2 }).default('0').notNull(),
  cartToOrderPercent: numeric('cart_to_order_percent', { precision: 8, scale: 2 }).default('0').notNull(),
  orderToBuyoutPercent: numeric('order_to_buyout_percent', { precision: 8, scale: 2 }).default('0').notNull(),
  // Доля локальных заказов от WB API (statistic.selected.localizationPercent),
  // 0..100. NULL до первого WB sync с расширенным парсингом — потребителям нужно
  // фолбэчить на ручной ввод. См. resolveIrpFromLocalization() в economics/constants.ts.
  localizationPercent: numeric('localization_percent', { precision: 6, scale: 2 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  funnelStatsTenantNmPeriodIdx: uniqueIndex('funnel_stats_tenant_nm_period_idx').on(table.tenantId, table.nmId, table.periodStart, table.periodEnd),
  funnelStatsTenantPeriodIdx: index('funnel_stats_tenant_period_idx').on(table.tenantId, table.periodStart, table.periodEnd),
  funnelStatsTenantDailyIdx: index('funnel_stats_tenant_daily_idx')
    .on(table.tenantId, table.periodStart, table.nmId)
    .where(sql`${table.periodStart} = ${table.periodEnd}`),
}));

// Дневная воронка продаж из ЛК WB (seller-content sales-funnel/report → chart.byDay).
// Содержит ПОКАЗЫ (view_count), которых нет в официальном API nm-report. Уровень
// кабинета (не по nmId): один ряд на tenant+день. Источник — ЛК-сессия (серый доступ),
// см. src/server/wb/lk-sales-funnel.ts.
export const rawApiSalesFunnelDaily = pgTable('raw_api_sales_funnel_daily', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  date: timestamp('date', { withTimezone: true }).notNull(),
  viewCount: bigint('view_count', { mode: 'number' }).default(0).notNull(),
  openCardCount: bigint('open_card_count', { mode: 'number' }).default(0).notNull(),
  addToCartCount: bigint('add_to_cart_count', { mode: 'number' }).default(0).notNull(),
  addToWishlistCount: bigint('add_to_wishlist_count', { mode: 'number' }).default(0).notNull(),
  orderCount: bigint('order_count', { mode: 'number' }).default(0).notNull(),
  orderSum: numeric('order_sum', { precision: 14, scale: 2 }).default('0').notNull(),
  buyoutCount: bigint('buyout_count', { mode: 'number' }).default(0).notNull(),
  buyoutSum: numeric('buyout_sum', { precision: 14, scale: 2 }).default('0').notNull(),
  cancelCount: bigint('cancel_count', { mode: 'number' }).default(0).notNull(),
  cancelSum: numeric('cancel_sum', { precision: 14, scale: 2 }).default('0').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  salesFunnelDailyTenantDateIdx: uniqueIndex('sales_funnel_daily_tenant_date_idx').on(table.tenantId, table.date),
}));

// ПОКАЗЫ по каждому товару (nmId) по дням. WB отдаёт per-nm только за период
// (groups[].itemsGroup в sales-funnel/report), без разбивки по дням — поэтому
// синк бьёт report c currentPeriod = один день и пишет per-nm за этот день.
// Уровень SKU; для группы/кабинета суммируем. См. src/server/wb/lk-sales-funnel.ts.
export const rawApiSalesFunnelNmDaily = pgTable('raw_api_sales_funnel_nm_daily', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  nmId: bigint('nm_id', { mode: 'number' }).notNull(),
  date: timestamp('date', { withTimezone: true }).notNull(),
  viewCount: bigint('view_count', { mode: 'number' }).default(0).notNull(),
  openCardCount: bigint('open_card_count', { mode: 'number' }).default(0).notNull(),
  addToCartCount: bigint('add_to_cart_count', { mode: 'number' }).default(0).notNull(),
  orderCount: bigint('order_count', { mode: 'number' }).default(0).notNull(),
  orderSum: numeric('order_sum', { precision: 14, scale: 2 }).default('0').notNull(),
  buyoutCount: bigint('buyout_count', { mode: 'number' }).default(0).notNull(),
  buyoutSum: numeric('buyout_sum', { precision: 14, scale: 2 }).default('0').notNull(),
  cancelCount: bigint('cancel_count', { mode: 'number' }).default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  salesFunnelNmDailyTenantNmDateIdx: uniqueIndex('sales_funnel_nm_daily_tenant_nm_date_idx').on(table.tenantId, table.nmId, table.date),
  salesFunnelNmDailyTenantDateIdx: index('sales_funnel_nm_daily_tenant_date_idx').on(table.tenantId, table.date),
}));

export const rawApiStocks = pgTable('raw_api_stocks', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  nmId: bigint('nm_id', { mode: 'number' }).notNull(),
  warehouseName: varchar('warehouse_name', { length: 255 }).notNull(),
  amount: integer('amount').default(0).notNull(),
  inWayToClient: integer('in_way_to_client').default(0).notNull(),
  inWayFromClient: integer('in_way_from_client').default(0).notNull(),
  date: timestamp('date', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  tenantNmWarehouseIdx: uniqueIndex('stocks_composite_idx').on(table.tenantId, table.nmId, table.warehouseName),
}));

export const rawApiStockOffices = pgTable('raw_api_stock_offices', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  snapshotDate: timestamp('snapshot_date', { withTimezone: true }).notNull(),
  periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
  periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
  stockType: varchar('stock_type', { length: 16 }).default('wb').notNull(),
  regionName: varchar('region_name', { length: 255 }).notNull(),
  officeId: bigint('office_id', { mode: 'number' }),
  officeName: varchar('office_name', { length: 255 }).notNull(),
  ordersCount: numeric('orders_count', { precision: 14, scale: 2 }).default('0').notNull(),
  ordersSum: numeric('orders_sum', { precision: 14, scale: 2 }).default('0').notNull(),
  buyoutCount: numeric('buyout_count', { precision: 14, scale: 2 }).default('0').notNull(),
  buyoutSum: numeric('buyout_sum', { precision: 14, scale: 2 }).default('0').notNull(),
  stockCount: integer('stock_count').default(0).notNull(),
  stockSum: numeric('stock_sum', { precision: 14, scale: 2 }).default('0').notNull(),
  toClientCount: integer('to_client_count').default(0).notNull(),
  fromClientCount: integer('from_client_count').default(0).notNull(),
  lostOrdersCount: numeric('lost_orders_count', { precision: 14, scale: 2 }).default('0').notNull(),
  lostOrdersSum: numeric('lost_orders_sum', { precision: 14, scale: 2 }).default('0').notNull(),
  avgStockTurnoverDays: numeric('avg_stock_turnover_days', { precision: 10, scale: 2 }),
  saleRateDays: numeric('sale_rate_days', { precision: 10, scale: 2 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  stockOfficesCompositeIdx: uniqueIndex('stock_offices_composite_idx').on(
    table.tenantId,
    table.snapshotDate,
    table.stockType,
    table.regionName,
    table.officeId,
    table.officeName,
  ),
  stockOfficesPeriodIdx: index('stock_offices_period_idx').on(table.tenantId, table.periodStart, table.periodEnd),
}));

export const rawApiStockSizes = pgTable('raw_api_stock_sizes', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  snapshotDate: timestamp('snapshot_date', { withTimezone: true }).notNull(),
  periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
  periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
  stockType: varchar('stock_type', { length: 16 }).default('wb').notNull(),
  nmId: bigint('nm_id', { mode: 'number' }).notNull(),
  sizeName: varchar('size_name', { length: 64 }).notNull(),
  chrtId: bigint('chrt_id', { mode: 'number' }),
  regionName: varchar('region_name', { length: 255 }).notNull(),
  officeId: bigint('office_id', { mode: 'number' }),
  officeName: varchar('office_name', { length: 255 }).notNull(),
  ordersCount: numeric('orders_count', { precision: 14, scale: 2 }).default('0').notNull(),
  ordersSum: numeric('orders_sum', { precision: 14, scale: 2 }).default('0').notNull(),
  buyoutCount: numeric('buyout_count', { precision: 14, scale: 2 }).default('0').notNull(),
  buyoutSum: numeric('buyout_sum', { precision: 14, scale: 2 }).default('0').notNull(),
  stockCount: integer('stock_count').default(0).notNull(),
  stockSum: numeric('stock_sum', { precision: 14, scale: 2 }).default('0').notNull(),
  toClientCount: integer('to_client_count').default(0).notNull(),
  fromClientCount: integer('from_client_count').default(0).notNull(),
  lostOrdersCount: numeric('lost_orders_count', { precision: 14, scale: 2 }).default('0').notNull(),
  lostOrdersSum: numeric('lost_orders_sum', { precision: 14, scale: 2 }).default('0').notNull(),
  avgStockTurnoverDays: numeric('avg_stock_turnover_days', { precision: 10, scale: 2 }),
  saleRateDays: numeric('sale_rate_days', { precision: 10, scale: 2 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  stockSizesCompositeIdx: uniqueIndex('stock_sizes_composite_idx').on(
    table.tenantId,
    table.snapshotDate,
    table.stockType,
    table.nmId,
    table.sizeName,
    table.chrtId,
    table.regionName,
    table.officeId,
    table.officeName,
  ),
  stockSizesNmPeriodIdx: index('stock_sizes_nm_period_idx').on(table.tenantId, table.nmId, table.periodStart, table.periodEnd),
}));

export const wbTariffSnapshots = pgTable('wb_tariff_snapshots', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  tariffType: varchar('tariff_type', { length: 32 }).notNull(), // 'acceptance' | 'box' | 'return'
  snapshotDate: varchar('snapshot_date', { length: 10 }).notNull(), // YYYY-MM-DD
  data: jsonb('data').notNull(), // Array of tariff items
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  wbTariffSnapshotIdx: uniqueIndex('wb_tariff_snapshot_idx').on(table.tenantId, table.tariffType, table.snapshotDate),
}));

export const wbCategoryCommissionSnapshots = pgTable('wb_category_commission_snapshots', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  snapshotDate: varchar('snapshot_date', { length: 10 }).notNull(),
  data: jsonb('data').notNull(), // Array of WbCategoryCommissionItem
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  wbCategoryCommissionIdx: uniqueIndex('wb_category_commission_idx').on(table.tenantId, table.snapshotDate),
}));

export const rawApiRegionSales = pgTable('raw_api_region_sales', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  nmId: bigint('nm_id', { mode: 'number' }).notNull(),
  foName: varchar('fo_name', { length: 255 }).notNull(),
  regionName: varchar('region_name', { length: 255 }).notNull(),
  countryName: varchar('country_name', { length: 128 }).default('').notNull(),
  saleQty: integer('sale_qty').default(0).notNull(),
  saleCostPrice: numeric('sale_cost_price', { precision: 14, scale: 2 }).default('0').notNull(),
  saleCostPricePerc: numeric('sale_cost_price_perc', { precision: 8, scale: 4 }).default('0').notNull(),
  periodFrom: timestamp('period_from', { withTimezone: true }).notNull(),
  periodTo: timestamp('period_to', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  regionSalesTenantPeriodIdx: index('region_sales_tenant_period_idx').on(table.tenantId, table.periodFrom, table.periodTo),
  regionSalesTenantNmFoIdx: index('region_sales_tenant_nm_fo_idx').on(table.tenantId, table.nmId, table.foName),
}));

export const rawApiPaidStorage = pgTable('raw_api_paid_storage', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  date: timestamp('date', { withTimezone: true }).notNull(),
  warehouseName: varchar('warehouse_name', { length: 255 }),
  nmId: bigint('nm_id', { mode: 'number' }).notNull(),
  storageAmount: numeric('storage_amount', { precision: 12, scale: 2 }).default('0').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  tenantNmWarehouseDateIdx: uniqueIndex('paid_storage_composite_idx').on(table.tenantId, table.nmId, table.warehouseName, table.date),
  paidStorageTenantDateIdx: index('paid_storage_tenant_date_idx').on(table.tenantId, table.date),
}));

export const rawApiSales = pgTable('raw_api_sales', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  saleId: varchar('sale_id', { length: 255 }).notNull(),
  nmId: bigint('nm_id', { mode: 'number' }).notNull(),
  date: timestamp('date', { withTimezone: true }).notNull(),
  priceWithDiscount: numeric('price_with_discount', { precision: 12, scale: 2 }).default('0').notNull(),
  warehouseName: varchar('warehouse_name', { length: 255 }),
  isStorno: boolean('is_storno').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  tenantNmSaleIdIdx: uniqueIndex('sales_composite_v2_idx').on(table.tenantId, table.nmId, table.saleId),
  salesTenantDateIdx: index('sales_tenant_date_idx').on(table.tenantId, table.date),
  salesTenantDateActiveIdx: index('sales_tenant_date_active_idx')
    .on(table.tenantId, table.date)
    .where(sql`${table.isStorno} = false`),
}));

export const rawApiPrices = pgTable('raw_api_prices', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  nmId: bigint('nm_id', { mode: 'number' }).notNull(),
  price: numeric('price', { precision: 12, scale: 2 }).notNull(),
  discount: integer('discount').default(0).notNull(),
  spp: integer('spp').default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  tenantNmPriceIdx: uniqueIndex('tenant_nm_price_idx').on(table.tenantId, table.nmId),
}));

export const rawApiPriceSnapshots = pgTable('raw_api_price_snapshots', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  nmId: bigint('nm_id', { mode: 'number' }).notNull(),
  snapshotAt: timestamp('snapshot_at', { withTimezone: true }).notNull(),
  snapshotDate: date('snapshot_date').notNull(),
  snapshotSlot: varchar('snapshot_slot', { length: 32 }).notNull(),
  price: numeric('price', { precision: 12, scale: 2 }).notNull(),
  discount: integer('discount').default(0).notNull(),
  spp: integer('spp').default(0).notNull(),
  sellerPriceAfterDiscount: numeric('seller_price_after_discount', { precision: 12, scale: 2 }).default('0').notNull(),
  customerPrice: numeric('customer_price', { precision: 12, scale: 2 }).default('0').notNull(),
  priceAfterSpp: numeric('price_after_spp', { precision: 12, scale: 2 }).default('0').notNull(),
  impliedSpp: numeric('implied_spp', { precision: 8, scale: 4 }).default('0').notNull(),
  publicPriceSource: varchar('public_price_source', { length: 32 }).default('wb_card_v4').notNull(),
  publicDest: varchar('public_dest', { length: 32 }).default('-1257786').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  priceSnapshotsTenantNmSlotIdx: uniqueIndex('price_snapshots_tenant_nm_slot_idx')
    .on(table.tenantId, table.nmId, table.snapshotDate, table.snapshotSlot),
  priceSnapshotsTenantTimeIdx: index('price_snapshots_tenant_time_idx').on(table.tenantId, table.snapshotAt),
  priceSnapshotsTenantNmTimeIdx: index('price_snapshots_tenant_nm_time_idx').on(table.tenantId, table.nmId, table.snapshotAt),
}));

export const productGroups = pgTable('product_groups', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const dynamicsGroupEvents = pgTable('dynamics_group_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  groupId: uuid('group_id').notNull().references(() => productGroups.id, { onDelete: 'cascade' }),
  eventDate: date('event_date').notNull(),
  eventType: varchar('event_type', { length: 32 }).default('note').notNull(),
  status: varchar('status', { length: 32 }).default('open').notNull(),
  title: varchar('title', { length: 180 }).notNull(),
  body: text('body'),
  assignee: varchar('assignee', { length: 120 }),
  dueDate: date('due_date'),
  checkDate: date('check_date'),
  createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdByEmail: varchar('created_by_email', { length: 255 }),
  payload: jsonb('payload').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  dynamicsGroupEventsTenantGroupDateIdx: index('dynamics_group_events_tenant_group_date_idx')
    .on(table.tenantId, table.groupId, table.eventDate),
  dynamicsGroupEventsTenantStatusDueIdx: index('dynamics_group_events_tenant_status_due_idx')
    .on(table.tenantId, table.status, table.dueDate),
  dynamicsGroupEventsTenantCreatedIdx: index('dynamics_group_events_tenant_created_idx')
    .on(table.tenantId, table.createdAt),
}));

export const idempotencyKeys = pgTable('idempotency_keys', {
  id: uuid('id').defaultRandom().primaryKey(),
  key: varchar('key', { length: 255 }).notNull(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  requestHash: varchar('request_hash', { length: 64 }).notNull(),
  responseStatus: integer('response_status').notNull(),
  responseBody: jsonb('response_body').$type<unknown>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  idempotencyKeyTenantIdx: uniqueIndex('idempotency_key_tenant_idx').on(table.key, table.tenantId),
}));

// P3-39: Telegram update_id replay protection
// Stores processed update_ids for 24 h (Telegram max retry window).
export const telegramProcessedUpdates = pgTable('telegram_processed_updates', {
  updateId: bigint('update_id', { mode: 'number' }).primaryKey(),
  processedAt: timestamp('processed_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  processedAtIdx: index('telegram_processed_updates_processed_at_idx').on(table.processedAt),
}));

// Production pipeline: header-уровень партии («один заказ у поставщика»).
// Может содержать много SKU — см. productionOrderLines.
export const productionOrders = pgTable('production_orders', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  // Человеко-читаемый заголовок партии («Контейнер #2024-12-15 Yiwu»).
  title: varchar('title', { length: 255 }),
  // Status flow: ordered → in_production → shipped → customs → delivered
  status: varchar('status', { length: 32 }).default('ordered').notNull(),
  orderedAt: timestamp('ordered_at', { withTimezone: true }).defaultNow().notNull(),
  productionStartedAt: timestamp('production_started_at', { withTimezone: true }),
  shippedAt: timestamp('shipped_at', { withTimezone: true }),
  customsAt: timestamp('customs_at', { withTimezone: true }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  estimatedDeliveryAt: timestamp('estimated_delivery_at', { withTimezone: true }),
  trackingNumber: varchar('tracking_number', { length: 255 }),
  supplierName: varchar('supplier_name', { length: 255 }),
  // Валюта закупки (по умолчанию RUB; если поставщик в Китае — USD/CNY).
  currency: varchar('currency', { length: 8 }).default('RUB').notNull(),
  // Общие на партию: распределяются на line items пропорционально стоимости.
  shippingCost: numeric('shipping_cost', { precision: 14, scale: 2 }).default('0').notNull(),
  customsCost: numeric('customs_cost', { precision: 14, scale: 2 }).default('0').notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  tenantStatusIdx: index('production_orders_tenant_status_idx').on(table.tenantId, table.status),
}));

// Draft/new products ordered before a WB card exists. They can later be linked
// to a real WB nmId without losing production / own-stock history.
export const procifryDraftSkus = pgTable('procifry_draft_skus', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  cabinetOid: varchar('cabinet_oid', { length: 64 }),
  source: varchar('source', { length: 64 }).default('procifry-agent').notNull(),
  sourceKey: varchar('source_key', { length: 255 }),
  externalSkuKey: varchar('external_sku_key', { length: 255 }),
  supplierArticle: varchar('supplier_article', { length: 255 }),
  sourceArticle: varchar('source_article', { length: 255 }),
  title: text('title').notNull(),
  comment: text('comment'),
  variant: varchar('variant', { length: 255 }),
  color: varchar('color', { length: 255 }),
  imageUrl: text('image_url'),
  attachmentUrl: text('attachment_url'),
  status: varchar('status', { length: 32 }).default('draft').notNull(),
  linkedNmId: bigint('linked_nm_id', { mode: 'number' }),
  payload: jsonb('payload').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  tenantSourceExternalIdx: uniqueIndex('procifry_draft_skus_tenant_source_external_idx')
    .on(table.tenantId, table.sourceKey, table.externalSkuKey)
    .where(sql`${table.externalSkuKey} IS NOT NULL`),
  tenantStatusIdx: index('procifry_draft_skus_tenant_status_idx').on(table.tenantId, table.status, table.updatedAt),
  tenantLinkedNmIdx: index('procifry_draft_skus_tenant_linked_nm_idx').on(table.tenantId, table.linkedNmId),
  tenantSupplierIdx: index('procifry_draft_skus_tenant_supplier_idx').on(table.tenantId, table.supplierArticle, table.sourceArticle),
}));

// Одна строка в партии = один SKU. Партия может содержать любое количество.
export const productionOrderLines = pgTable('production_order_lines', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  productionOrderId: uuid('production_order_id').notNull()
    .references(() => productionOrders.id, { onDelete: 'cascade' }),
  nmId: bigint('nm_id', { mode: 'number' }),
  draftSkuId: uuid('draft_sku_id').references(() => procifryDraftSkus.id, { onDelete: 'set null' }),
  quantity: integer('quantity').notNull(),
  // Сколько фактически принято (для partial receipts).
  receivedQuantity: integer('received_quantity').default(0).notNull(),
  costPerUnit: numeric('cost_per_unit', { precision: 12, scale: 2 }),
  totalCost: numeric('total_cost', { precision: 14, scale: 2 }),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  tenantNmIdx: index('production_order_lines_tenant_nm_idx').on(table.tenantId, table.nmId),
  tenantDraftSkuIdx: index('production_order_lines_tenant_draft_sku_idx').on(table.tenantId, table.draftSkuId),
  orderIdx: index('production_order_lines_order_idx').on(table.productionOrderId),
}));

// Свой склад: партия товара лежит у продавца (после поступления из Китая или
// ручного прихода). Replaces legacy `stock_planning_inputs.own_stock` (одно
// число на nmId без истории).
export const ownStockBatches = pgTable('own_stock_batches', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  nmId: bigint('nm_id', { mode: 'number' }),
  draftSkuId: uuid('draft_sku_id').references(() => procifryDraftSkus.id, { onDelete: 'set null' }),
  // 'own' — склад продавца в РФ, 'china' — готовый товар на складе в Китае.
  stockLocation: varchar('stock_location', { length: 16 }).default('own').notNull(),
  // Сколько единиц поступило в эту партию (immutable).
  receivedQuantity: integer('received_quantity').notNull(),
  // Сколько осталось на складе сейчас (decreases on shipments / write-offs).
  remainingQuantity: integer('remaining_quantity').notNull(),
  // Себестоимость единицы по этой партии (включая распределённые shipping/customs).
  costPerUnit: numeric('cost_per_unit', { precision: 12, scale: 2 }),
  // 'production_order' (приход из Китая) | 'manual' (ручной).
  sourceType: varchar('source_type', { length: 32 }).default('manual').notNull(),
  sourceProductionOrderId: uuid('source_production_order_id')
    .references(() => productionOrders.id, { onDelete: 'set null' }),
  receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  tenantNmIdx: index('own_stock_batches_tenant_nm_idx').on(table.tenantId, table.nmId),
  tenantDraftSkuIdx: index('own_stock_batches_tenant_draft_sku_idx').on(table.tenantId, table.draftSkuId),
  tenantLocationNmIdx: index('own_stock_batches_tenant_location_nm_idx').on(table.tenantId, table.stockLocation, table.nmId),
  tenantReceivedIdx: index('own_stock_batches_tenant_received_idx').on(table.tenantId, table.receivedAt),
}));

// Журнал движений: каждое поступление и расход — отдельная запись.
// Позволяет строить историю и audit trail.
export const ownStockMovements = pgTable('own_stock_movements', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  batchId: uuid('batch_id').references(() => ownStockBatches.id, { onDelete: 'set null' }),
  nmId: bigint('nm_id', { mode: 'number' }),
  draftSkuId: uuid('draft_sku_id').references(() => procifryDraftSkus.id, { onDelete: 'set null' }),
  stockLocation: varchar('stock_location', { length: 16 }).default('own').notNull(),
  // Положительное — приход, отрицательное — расход.
  deltaQuantity: integer('delta_quantity').notNull(),
  // 'receipt' | 'shipped_to_wb' | 'fbs_sale' | 'write_off' | 'inventory_adjust'.
  reason: varchar('reason', { length: 32 }).notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  tenantNmIdx: index('own_stock_movements_tenant_nm_idx').on(table.tenantId, table.nmId),
  tenantDraftSkuIdx: index('own_stock_movements_tenant_draft_sku_idx').on(table.tenantId, table.draftSkuId),
  tenantLocationCreatedIdx: index('own_stock_movements_tenant_location_created_idx').on(table.tenantId, table.stockLocation, table.createdAt),
  tenantCreatedIdx: index('own_stock_movements_tenant_created_idx').on(table.tenantId, table.createdAt),
  batchIdx: index('own_stock_movements_batch_idx').on(table.batchId),
}));

// WB FBW поставки: idempotent учёт автоматических списаний со своего склада.
// Принятая WB строка поставки списывает local stock один раз; затем
// acceptedQuantity сверяется с wbQuantity и может отправить Telegram-алерт.
export const wbSupplyWriteoffs = pgTable('wb_supply_writeoffs', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  supplyKey: varchar('supply_key', { length: 80 }).notNull(),
  lineKey: varchar('line_key', { length: 180 }).notNull(),
  supplyId: bigint('supply_id', { mode: 'number' }),
  preorderId: bigint('preorder_id', { mode: 'number' }),
  isPreorder: boolean('is_preorder').default(false).notNull(),
  statusId: integer('status_id'),
  nmId: bigint('nm_id', { mode: 'number' }).notNull(),
  barcode: varchar('barcode', { length: 255 }).default('').notNull(),
  vendorCode: varchar('vendor_code', { length: 255 }),
  warehouseName: varchar('warehouse_name', { length: 255 }),
  actualWarehouseName: varchar('actual_warehouse_name', { length: 255 }),
  supplyDate: timestamp('supply_date', { withTimezone: true }),
  factDate: timestamp('fact_date', { withTimezone: true }),
  wbQuantity: integer('wb_quantity').default(0).notNull(),
  localWrittenOffQuantity: integer('local_written_off_quantity').default(0).notNull(),
  acceptedQuantity: integer('accepted_quantity'),
  unloadingQuantity: integer('unloading_quantity'),
  readyForSaleQuantity: integer('ready_for_sale_quantity'),
  writeOffStatus: varchar('write_off_status', { length: 32 }).default('pending').notNull(),
  writeOffError: text('write_off_error'),
  writtenOffAt: timestamp('written_off_at', { withTimezone: true }),
  writeOffErrorNotifiedAt: timestamp('write_off_error_notified_at', { withTimezone: true }),
  discrepancyQuantity: integer('discrepancy_quantity'),
  discrepancyStatus: varchar('discrepancy_status', { length: 32 }).default('pending').notNull(),
  discrepancyNotifiedAt: timestamp('discrepancy_notified_at', { withTimezone: true }),
  rawSupply: jsonb('raw_supply').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  rawGoods: jsonb('raw_goods').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  tenantLineIdx: uniqueIndex('wb_supply_writeoffs_tenant_line_idx').on(table.tenantId, table.lineKey),
  tenantSupplyIdx: index('wb_supply_writeoffs_tenant_supply_idx').on(table.tenantId, table.supplyKey),
  tenantStatusIdx: index('wb_supply_writeoffs_tenant_status_idx')
    .on(table.tenantId, table.writeOffStatus, table.discrepancyStatus, table.lastSeenAt),
}));

export const productGroupMembers = pgTable('product_group_members', {
  id: uuid('id').defaultRandom().primaryKey(),
  groupId: uuid('group_id').notNull().references(() => productGroups.id, { onDelete: 'cascade' }),
  nmId: bigint('nm_id', { mode: 'number' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  groupNmUniqueIdx: uniqueIndex('group_nm_unique_idx').on(table.groupId, table.nmId),
}));

export const salesPlanVersions = pgTable('sales_plan_versions', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 180 }).notNull(),
  periodStart: date('period_start').notNull(),
  periodEnd: date('period_end').notNull(),
  status: varchar('status', { length: 24 }).default('active').notNull(),
  grain: varchar('grain', { length: 16 }).default('day').notNull(),
  sourceType: varchar('source_type', { length: 32 }).default('manual').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  salesPlanVersionsTenantPeriodIdx: index('sales_plan_versions_tenant_period_idx')
    .on(table.tenantId, table.periodStart, table.periodEnd),
  salesPlanVersionsTenantStatusIdx: index('sales_plan_versions_tenant_status_idx')
    .on(table.tenantId, table.status, table.periodEnd),
}));

export const salesPlanLines = pgTable('sales_plan_lines', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  planId: uuid('plan_id').notNull().references(() => salesPlanVersions.id, { onDelete: 'cascade' }),
  planDate: date('plan_date').notNull(),
  groupId: uuid('group_id').references(() => productGroups.id, { onDelete: 'set null' }),
  nmId: bigint('nm_id', { mode: 'number' }),
  plannedOrders: integer('planned_orders').default(0).notNull(),
  plannedBuyouts: integer('planned_buyouts').default(0).notNull(),
  plannedRevenue: numeric('planned_revenue', { precision: 14, scale: 2 }).default('0').notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  salesPlanLinesTenantPlanDateIdx: index('sales_plan_lines_tenant_plan_date_idx')
    .on(table.tenantId, table.planId, table.planDate),
  salesPlanLinesTenantDateIdx: index('sales_plan_lines_tenant_date_idx')
    .on(table.tenantId, table.planDate),
  salesPlanLinesTenantGroupDateIdx: index('sales_plan_lines_tenant_group_date_idx')
    .on(table.tenantId, table.groupId, table.planDate),
  salesPlanLinesTenantNmDateIdx: index('sales_plan_lines_tenant_nm_date_idx')
    .on(table.tenantId, table.nmId, table.planDate),
}));

export const salesPlanSeasons = pgTable('sales_plan_seasons', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  planId: uuid('plan_id').notNull().references(() => salesPlanVersions.id, { onDelete: 'cascade' }),
  groupId: uuid('group_id').references(() => productGroups.id, { onDelete: 'set null' }),
  name: varchar('name', { length: 160 }).notNull(),
  seasonStart: date('season_start').notNull(),
  seasonEnd: date('season_end').notNull(),
  demandMultiplier: numeric('demand_multiplier', { precision: 8, scale: 3 }).default('1').notNull(),
  targetStockDays: integer('target_stock_days').default(30).notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  salesPlanSeasonsTenantPeriodIdx: index('sales_plan_seasons_tenant_period_idx')
    .on(table.tenantId, table.seasonStart, table.seasonEnd),
  salesPlanSeasonsPlanIdx: index('sales_plan_seasons_plan_idx').on(table.planId),
}));

// P66: Advertising balance cache — snapshot from WB API
export const advertisingBalanceSnapshots = pgTable('advertising_balance_snapshots', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  realMoney: numeric('real_money', { precision: 14, scale: 2 }).notNull(),
  bonusSum: numeric('bonus_sum', { precision: 14, scale: 2 }).default('0').notNull(),
  bonusPercent: integer('bonus_percent').default(0).notNull(),
  bonusExpiresAt: timestamp('bonus_expires_at', { withTimezone: true }),
  syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  balanceSnapshotsTenantIdx: index('advertising_balance_snapshots_tenant_idx').on(table.tenantId, table.syncedAt),
}));

// P66: Per-tenant auto-refill settings
export const advertisingAutoRefillSettings = pgTable('advertising_auto_refill_settings', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().unique().references(() => tenants.id, { onDelete: 'cascade' }),
  enabled: boolean('enabled').default(false).notNull(),
  campaignId: bigint('campaign_id', { mode: 'number' }),
  thresholdRub: numeric('threshold_rub', { precision: 12, scale: 2 }).default('500').notNull(),
  topUpAmountRub: numeric('top_up_amount_rub', { precision: 12, scale: 2 }).default('2000').notNull(),
  dailyCapRub: numeric('daily_cap_rub', { precision: 12, scale: 2 }).default('10000').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// P66: Auto-refill execution log (guardrail enforcement)
export const advertisingAutoRefillLogs = pgTable('advertising_auto_refill_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  campaignId: bigint('campaign_id', { mode: 'number' }).notNull(),
  amountRub: numeric('amount_rub', { precision: 12, scale: 2 }).notNull(),
  triggeredBy: varchar('triggered_by', { length: 16 }).default('auto').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  autoRefillLogsTenantIdx: index('advertising_auto_refill_logs_tenant_idx').on(table.tenantId, table.createdAt),
}));

// P67: Dayparting schedule rules (boolean[168] = 24h × 7 days, Mon=0)
export const advertisingDaypartingRules = pgTable('advertising_dayparting_rules', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  campaignId: bigint('campaign_id', { mode: 'number' }).notNull(),
  schedule: boolean('schedule').array().notNull().default(sql`'{}'::boolean[]`),
  templateName: varchar('template_name', { length: 64 }),
  enabled: boolean('enabled').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  daypartingRulesTenantIdx: index('advertising_dayparting_rules_tenant_idx').on(table.tenantId, table.enabled),
  daypartingRulesTenantCampaignUidx: uniqueIndex('advertising_dayparting_rules_tenant_campaign_uidx').on(table.tenantId, table.campaignId),
}));

// P67: Audit log for all autopilot actions with rollback support
export const advertisingAuditLog = pgTable('advertising_audit_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  campaignId: bigint('campaign_id', { mode: 'number' }),
  nmId: bigint('nm_id', { mode: 'number' }),
  actionType: varchar('action_type', { length: 32 }).notNull(),
  objectType: varchar('object_type', { length: 32 }).notNull().default('campaign'),
  valueBefore: jsonb('value_before'),
  valueAfter: jsonb('value_after'),
  reason: text('reason'),
  rolledBack: boolean('rolled_back').default(false).notNull(),
  rolledBackAt: timestamp('rolled_back_at', { withTimezone: true }),
  rolledBackBy: uuid('rolled_back_by').references(() => tenants.id, { onDelete: 'set null' }),
  source: varchar('source', { length: 32 }).notNull().default('autopilot'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  auditLogTenantIdx: index('advertising_audit_log_tenant_idx').on(table.tenantId, table.createdAt),
  auditLogTenantCampaignIdx: index('advertising_audit_log_tenant_campaign_idx').on(table.tenantId, table.campaignId, table.createdAt),
  auditLogTenantTypeIdx: index('advertising_audit_log_tenant_type_idx').on(table.tenantId, table.actionType, table.createdAt),
}));

export const procifryApprovalRequests = pgTable('procifry_approval_requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  workerId: varchar('worker_id', { length: 80 }).notNull(),
  clientId: varchar('client_id', { length: 120 }).notNull(),
  cabinetOid: varchar('cabinet_oid', { length: 120 }).notNull(),
  actionType: varchar('action_type', { length: 120 }).notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  payload: jsonb('payload').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  source: varchar('source', { length: 120 }).notNull(),
  sourceUpdatedAt: timestamp('source_updated_at', { withTimezone: true }).notNull(),
  periodFrom: timestamp('period_from', { withTimezone: true }).notNull(),
  periodTo: timestamp('period_to', { withTimezone: true }).notNull(),
  confidence: varchar('confidence', { length: 32 }).notNull(),
  status: varchar('status', { length: 32 }).default('requested').notNull(),
  decidedBy: varchar('decided_by', { length: 255 }),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  executedAt: timestamp('executed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  procifryApprovalTenantStatusIdx: index('procifry_approval_tenant_status_idx').on(table.tenantId, table.status, table.createdAt),
  procifryApprovalTenantWorkerIdx: index('procifry_approval_tenant_worker_idx').on(table.tenantId, table.workerId, table.createdAt),
  procifryApprovalTenantActionIdx: index('procifry_approval_tenant_action_idx').on(table.tenantId, table.actionType, table.createdAt),
}));

export const procifryWorkerArtifacts = pgTable('procifry_worker_artifacts', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  workerId: varchar('worker_id', { length: 80 }).notNull(),
  clientId: varchar('client_id', { length: 120 }).notNull(),
  cabinetOid: varchar('cabinet_oid', { length: 120 }).notNull(),
  artifactType: varchar('artifact_type', { length: 80 }).notNull(),
  actionType: varchar('action_type', { length: 120 }),
  accessMode: varchar('access_mode', { length: 32 }).notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  body: text('body'),
  payload: jsonb('payload').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  tags: jsonb('tags').$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
  source: varchar('source', { length: 120 }).notNull(),
  sourceUpdatedAt: timestamp('source_updated_at', { withTimezone: true }).notNull(),
  periodFrom: timestamp('period_from', { withTimezone: true }).notNull(),
  periodTo: timestamp('period_to', { withTimezone: true }).notNull(),
  confidence: varchar('confidence', { length: 32 }).notNull(),
  approvalRequestId: uuid('approval_request_id').references(() => procifryApprovalRequests.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  procifryArtifactsTenantCreatedIdx: index('procifry_artifacts_tenant_created_idx').on(table.tenantId, table.createdAt),
  procifryArtifactsTenantWorkerIdx: index('procifry_artifacts_tenant_worker_idx').on(table.tenantId, table.workerId, table.createdAt),
  procifryArtifactsTenantTypeIdx: index('procifry_artifacts_tenant_type_idx').on(table.tenantId, table.artifactType, table.createdAt),
  procifryArtifactsApprovalIdx: index('procifry_artifacts_approval_idx').on(table.tenantId, table.approvalRequestId),
}));

export const procifryAgentAuditLog = pgTable('procifry_agent_audit_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  tenantIds: jsonb('tenant_ids').$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
  multiTenant: boolean('multi_tenant').default(false).notNull(),
  workerId: varchar('worker_id', { length: 80 }).notNull(),
  clientId: varchar('client_id', { length: 120 }).notNull(),
  cabinetOid: varchar('cabinet_oid', { length: 120 }).notNull(),
  periodFrom: timestamp('period_from', { withTimezone: true }).notNull(),
  periodTo: timestamp('period_to', { withTimezone: true }).notNull(),
  source: varchar('source', { length: 120 }).notNull(),
  sourceUpdatedAt: timestamp('source_updated_at', { withTimezone: true }).notNull(),
  confidence: varchar('confidence', { length: 32 }).notNull(),
  accessMode: varchar('access_mode', { length: 32 }).notNull(),
  resourceType: varchar('resource_type', { length: 80 }).notNull(),
  actionType: varchar('action_type', { length: 120 }),
  outcome: varchar('outcome', { length: 32 }).default('accepted').notNull(),
  artifactId: uuid('artifact_id').references(() => procifryWorkerArtifacts.id, { onDelete: 'set null' }),
  approvalRequestId: uuid('approval_request_id').references(() => procifryApprovalRequests.id, { onDelete: 'set null' }),
  requestPayload: jsonb('request_payload').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  responsePayload: jsonb('response_payload').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  procifryAuditTenantCreatedIdx: index('procifry_audit_tenant_created_idx').on(table.tenantId, table.createdAt),
  procifryAuditTenantWorkerIdx: index('procifry_audit_tenant_worker_idx').on(table.tenantId, table.workerId, table.createdAt),
  procifryAuditTenantResourceIdx: index('procifry_audit_tenant_resource_idx').on(table.tenantId, table.resourceType, table.createdAt),
  procifryAuditApprovalIdx: index('procifry_audit_approval_idx').on(table.tenantId, table.approvalRequestId, table.createdAt),
}));

export const procifrySearchPositions = pgTable('procifry_search_positions', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  cabinetOid: varchar('cabinet_oid', { length: 120 }).notNull(),
  observedDate: date('observed_date').notNull(),
  keyword: text('keyword').notNull(),
  nmId: bigint('nm_id', { mode: 'number' }).notNull(),
  position: integer('position'),
  frequency: integer('frequency'),
  impressions: integer('impressions'),
  organicOrAd: varchar('organic_or_ad', { length: 32 }),
  source: varchar('source', { length: 120 }).notNull(),
  sourceUpdatedAt: timestamp('source_updated_at', { withTimezone: true }).notNull(),
  confidence: varchar('confidence', { length: 32 }).default('confirmed').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  procifrySearchPositionsTenantDateIdx: index('procifry_search_positions_tenant_date_idx').on(table.tenantId, table.observedDate, table.nmId),
  procifrySearchPositionsTenantKeywordIdx: index('procifry_search_positions_tenant_keyword_idx').on(table.tenantId, table.keyword, table.observedDate),
}));

export const procifryCompetitorCards = pgTable('procifry_competitor_cards', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  cabinetOid: varchar('cabinet_oid', { length: 120 }).notNull(),
  observedDate: date('observed_date').notNull(),
  ourNmId: bigint('our_nm_id', { mode: 'number' }),
  competitorNmId: bigint('competitor_nm_id', { mode: 'number' }).notNull(),
  keyword: text('keyword'),
  subject: text('subject'),
  title: text('title'),
  brand: text('brand'),
  price: numeric('price', { precision: 14, scale: 2 }),
  rating: numeric('rating', { precision: 4, scale: 2 }),
  reviewsCount: integer('reviews_count'),
  ordersCount: integer('orders_count'),
  revenue: numeric('revenue', { precision: 14, scale: 2 }),
  stockQty: integer('stock_qty'),
  photos: jsonb('photos').$type<unknown[]>().default(sql`'[]'::jsonb`).notNull(),
  videos: jsonb('videos').$type<unknown[]>().default(sql`'[]'::jsonb`).notNull(),
  positions: jsonb('positions').$type<unknown[]>().default(sql`'[]'::jsonb`).notNull(),
  source: varchar('source', { length: 120 }).notNull(),
  sourceUpdatedAt: timestamp('source_updated_at', { withTimezone: true }).notNull(),
  confidence: varchar('confidence', { length: 32 }).default('confirmed').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  procifryCompetitorCardsTenantDateIdx: index('procifry_competitor_cards_tenant_date_idx').on(table.tenantId, table.observedDate, table.ourNmId),
  procifryCompetitorCardsTenantCompetitorIdx: index('procifry_competitor_cards_tenant_competitor_idx').on(table.tenantId, table.competitorNmId, table.observedDate),
}));

export const procifryAbTests = pgTable('procifry_ab_tests', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  cabinetOid: varchar('cabinet_oid', { length: 120 }).notNull(),
  testId: varchar('test_id', { length: 120 }).notNull(),
  nmId: bigint('nm_id', { mode: 'number' }).notNull(),
  variant: varchar('variant', { length: 120 }).notNull(),
  periodFrom: date('period_from').notNull(),
  periodTo: date('period_to').notNull(),
  impressions: integer('impressions').default(0).notNull(),
  clicks: integer('clicks').default(0).notNull(),
  ctr: numeric('ctr', { precision: 10, scale: 4 }),
  carts: integer('carts').default(0).notNull(),
  orders: integer('orders').default(0).notNull(),
  revenue: numeric('revenue', { precision: 14, scale: 2 }),
  profit: numeric('profit', { precision: 14, scale: 2 }),
  significance: numeric('significance', { precision: 10, scale: 4 }),
  status: varchar('status', { length: 40 }).default('unknown').notNull(),
  source: varchar('source', { length: 120 }).notNull(),
  sourceUpdatedAt: timestamp('source_updated_at', { withTimezone: true }).notNull(),
  confidence: varchar('confidence', { length: 32 }).default('confirmed').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  procifryAbTestsTenantPeriodIdx: index('procifry_ab_tests_tenant_period_idx').on(table.tenantId, table.periodFrom, table.periodTo, table.nmId),
  procifryAbTestsTenantTestIdx: index('procifry_ab_tests_tenant_test_idx').on(table.tenantId, table.testId, table.nmId),
}));

export const wbFeedbackSnapshots = pgTable('wb_feedback_snapshots', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  itemType: varchar('item_type', { length: 16 }).notNull(),
  wbItemId: varchar('wb_item_id', { length: 160 }).notNull(),
  nmId: bigint('nm_id', { mode: 'number' }),
  rating: integer('rating'),
  text: text('text'),
  answerText: text('answer_text'),
  isAnswered: boolean('is_answered').default(false).notNull(),
  answerOutcome: varchar('answer_outcome', { length: 32 }).default('unknown').notNull(),
  productName: text('product_name'),
  brandName: text('brand_name'),
  userName: text('user_name'),
  createdAtWb: timestamp('created_at_wb', { withTimezone: true }),
  sourceUpdatedAt: timestamp('source_updated_at', { withTimezone: true }).defaultNow().notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  wbFeedbackSnapshotsUniqueIdx: uniqueIndex('wb_feedback_snapshots_unique_idx').on(table.tenantId, table.itemType, table.wbItemId),
  wbFeedbackSnapshotsTenantTypeDateIdx: index('wb_feedback_snapshots_tenant_type_date_idx').on(table.tenantId, table.itemType, table.createdAtWb),
  wbFeedbackSnapshotsTenantNmIdx: index('wb_feedback_snapshots_tenant_nm_idx').on(table.tenantId, table.nmId, table.createdAtWb),
}));
