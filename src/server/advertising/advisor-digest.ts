import { and, desc, eq, gte, isNotNull, ne, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { readAdvertisingPostActionMonitor } from '@/lib/advertising/post-action-monitor';
import { advertisingBidChanges, tenants } from '@/lib/db/schema';
import { sendAdAlert } from '@/server/advertising/send-alert';

/**
 * Агрегирует изменения ставок за последние 24ч и формирует reason-строку
 * для одного артикула. Пример: «Применено 3, предложено 2» или «Предложил изменение».
 */
export function buildSuggestionReason(rows: Array<{ status: string; count: number }>): string {
  const applied = rows.find((r) => r.status === 'applied')?.count ?? 0;
  const preview = rows.find((r) => r.status === 'preview')?.count ?? 0;
  const failed = rows.find((r) => r.status === 'failed')?.count ?? 0;

  const parts: string[] = [];
  if (applied > 0) parts.push(`${applied} примен.`);
  if (preview > 0) parts.push(`${preview} предлож.`);
  if (failed > 0) parts.push(`${failed} с ошибкой`);
  return parts.length > 0 ? parts.join(', ') : 'без изменений';
}

export type AdvisorDigestResult =
  | { status: 'sent'; totalNmIds: number }
  | { status: 'skipped'; reason: 'no_changes' | 'no_chat_id' | 'send_failed' };

function buildOutcomeTotals(rows: Array<{ metrics: Record<string, unknown> | null }>) {
  return rows.reduce((totals, row) => {
    const report = readAdvertisingPostActionMonitor(row.metrics);
    if (!report) {
      return totals;
    }
    if (report.direction === 'lower' && report.outcome === 'improved') {
      totals.savingsRub += Math.max(0, Math.round(report.before.adSpend - report.after.adSpend));
    }
    if (report.direction === 'raise' && report.outcome === 'improved') {
      totals.extraOrders += Math.max(0, report.delta.orders);
    }
    if (report.recommendation === 'rollback' && report.rollback.status !== 'applied') {
      totals.rollbackCount += 1;
    }
    if (report.rollback.status === 'applied') {
      totals.rolledBackCount += 1;
    }
    return totals;
  }, {
    savingsRub: 0,
    extraOrders: 0,
    rollbackCount: 0,
    rolledBackCount: 0,
  });
}

/**
 * Собирает и отправляет `advisor_daily_digest` для одного тенанта.
 * Источник данных: `advertising_bid_changes` за последние 24ч.
 *
 * Если за окно не было ни одной записи — алерт не шлётся (skip).
 */
export async function buildAndSendDigestForTenant(
  tenantId: string,
  now: Date = new Date(),
): Promise<AdvisorDigestResult> {
  const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      nmId: advertisingBidChanges.nmId,
      status: advertisingBidChanges.status,
      count: sql<number>`count(*)::int`,
    })
    .from(advertisingBidChanges)
    .where(
      and(
        eq(advertisingBidChanges.tenantId, tenantId),
        gte(advertisingBidChanges.createdAt, windowStart),
        eq(advertisingBidChanges.source, 'auto'),
      ),
    )
    .groupBy(advertisingBidChanges.nmId, advertisingBidChanges.status);

  if (rows.length === 0) {
    return { status: 'skipped', reason: 'no_changes' };
  }

  const outcomeRows = await db
    .select({
      metrics: advertisingBidChanges.metrics,
    })
    .from(advertisingBidChanges)
    .where(
      and(
        eq(advertisingBidChanges.tenantId, tenantId),
        gte(advertisingBidChanges.createdAt, windowStart),
        eq(advertisingBidChanges.source, 'auto'),
      ),
    );

  // Группируем по nmId
  const byNmId = new Map<number, Array<{ status: string; count: number }>>();
  for (const row of rows) {
    const nmId = Number(row.nmId);
    const entry = byNmId.get(nmId) ?? [];
    entry.push({ status: String(row.status), count: Number(row.count) });
    byNmId.set(nmId, entry);
  }

  // Ранжируем nmId по суммарному числу изменений (desc)
  const ranked = [...byNmId.entries()]
    .map(([nmId, statuses]) => ({
      nmId,
      totalCount: statuses.reduce((s, r) => s + r.count, 0),
      reason: buildSuggestionReason(statuses),
    }))
    .sort((a, b) => b.totalCount - a.totalCount);

  const suggestions = ranked.map(({ nmId, reason }) => ({ nmId, reason }));
  const totalCount = ranked.reduce((s, r) => s + r.totalCount, 0);

  const result = await sendAdAlert(tenantId, {
    type: 'advisor_daily_digest',
    suggestions,
    totalCount,
    outcomes: buildOutcomeTotals(outcomeRows),
  });

  if (result.status === 'sent') {
    return { status: 'sent', totalNmIds: ranked.length };
  }
  if (result.status === 'skipped' && result.reason === 'no_chat_id') {
    return { status: 'skipped', reason: 'no_chat_id' };
  }
  return { status: 'skipped', reason: 'send_failed' };
}

/**
 * Список активных тенантов с хотя бы одной записью bid_changes за 24ч.
 * Отфильтровывает тенантов без `telegramChatId` на уровне БД — экономит вызовы.
 */
export async function listTenantsForDigest(now: Date = new Date()): Promise<string[]> {
  const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const rows = await db
    .selectDistinct({ tenantId: advertisingBidChanges.tenantId })
    .from(advertisingBidChanges)
    .innerJoin(tenants, eq(tenants.id, advertisingBidChanges.tenantId))
    .where(
      and(
        gte(advertisingBidChanges.createdAt, windowStart),
        eq(advertisingBidChanges.source, 'auto'),
        isNotNull(tenants.telegramChatId),
        ne(tenants.wbTokenHealthStatus, 'invalid'),
      ),
    )
    .orderBy(desc(advertisingBidChanges.tenantId));

  return rows.map((r) => r.tenantId);
}
