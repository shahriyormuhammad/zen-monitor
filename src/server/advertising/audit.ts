import { and, desc, eq, gte, lte } from 'drizzle-orm';

import { db } from '@/lib/db';
import { advertisingAuditLog } from '@/lib/db/schema';

export type AuditActionType =
  | 'bid_raise'
  | 'bid_lower'
  | 'pause_drr'
  | 'pause_stock'
  | 'pause_no_orders'
  | 'pause_low_cr'
  | 'dayparting_pause'
  | 'dayparting_resume'
  | 'dayparting_rule'
  | 'cap_reached'
  | 'kill_switch'
  | 'manual';

export interface AuditLogEntry {
  tenantId: string;
  campaignId?: number;
  nmId?: number;
  actionType: AuditActionType;
  objectType?: string;
  valueBefore?: unknown;
  valueAfter?: unknown;
  reason?: string;
  source?: string;
}

export async function writeAuditEntry(entry: AuditLogEntry) {
  const [row] = await db
    .insert(advertisingAuditLog)
    .values({
      tenantId: entry.tenantId,
      campaignId: entry.campaignId ?? null,
      nmId: entry.nmId ?? null,
      actionType: entry.actionType,
      objectType: entry.objectType ?? 'campaign',
      valueBefore: entry.valueBefore ?? null,
      valueAfter: entry.valueAfter ?? null,
      reason: entry.reason ?? null,
      source: entry.source ?? 'autopilot',
    })
    .returning();

  return row;
}

export interface AuditLogFilter {
  tenantId: string;
  actionType?: string;
  campaignId?: number;
  dateFrom?: Date;
  dateTo?: Date;
  limit?: number;
  offset?: number;
}

export async function getAuditLog(filter: AuditLogFilter) {
  const conditions = [eq(advertisingAuditLog.tenantId, filter.tenantId)];

  if (filter.actionType) {
    conditions.push(eq(advertisingAuditLog.actionType, filter.actionType));
  }
  if (filter.campaignId) {
    conditions.push(eq(advertisingAuditLog.campaignId, filter.campaignId));
  }
  if (filter.dateFrom) {
    conditions.push(gte(advertisingAuditLog.createdAt, filter.dateFrom));
  }
  if (filter.dateTo) {
    conditions.push(lte(advertisingAuditLog.createdAt, filter.dateTo));
  }

  const rows = await db
    .select()
    .from(advertisingAuditLog)
    .where(and(...conditions))
    .orderBy(desc(advertisingAuditLog.createdAt))
    .limit(filter.limit ?? 100)
    .offset(filter.offset ?? 0);

  return rows;
}

export async function rollbackBidChange(tenantId: string, auditEntryId: string) {
  const [entry] = await db
    .select()
    .from(advertisingAuditLog)
    .where(
      and(
        eq(advertisingAuditLog.id, auditEntryId),
        eq(advertisingAuditLog.tenantId, tenantId),
      ),
    );

  if (!entry) throw new Error('Запись аудита не найдена');
  if (entry.rolledBack) throw new Error('Действие уже откатано');
  if (!entry.actionType.startsWith('bid_')) {
    throw new Error('Откат доступен только для bid-изменений');
  }

  // valueBefore stores the full bid context for cluster-based rollback
  const prev = entry.valueBefore as {
    advertId: number;
    nmId: number;
    keyword: string;
    bid: number;
  } | null;

  if (!prev?.advertId || !prev.nmId || !prev.keyword || prev.bid == null) {
    throw new Error('Нет данных для отката (valueBefore отсутствует или неполный)');
  }

  // Mark as rolled back before WB API call (idempotency)
  await db
    .update(advertisingAuditLog)
    .set({ rolledBack: true, rolledBackAt: new Date() })
    .where(eq(advertisingAuditLog.id, auditEntryId));

  return {
    bids: [{ advertId: prev.advertId, nmId: prev.nmId, keyword: prev.keyword, bid: prev.bid }],
  };
}
