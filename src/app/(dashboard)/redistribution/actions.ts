'use server';

import { and, desc, eq, gte, sql } from 'drizzle-orm';

import { db, withTenantContext } from '@/lib/db';
import {
  redistributionItems,
  redistributionRouteAvailability,
  redistributionSlotMonitorRuns,
  tenants,
} from '@/lib/db/schema';
import { requireTenantAccess } from '@/lib/auth/tenant-access';
import { getSessionFreshness } from '@/lib/wb-rpa/storage-state';

export type RobotSessionStatus = {
  /** Есть ли в БД сохранённый storageState (cookies + localStorage) для Playwright-пути. */
  hasSession: boolean;
  /** Помечена ли сессия как рабочая в нашей БД (выставляется после успешного входа). */
  markedActive: boolean;
  /** Когда мы последний раз обновляли storageState. */
  refreshedAt: string | null;
  /** Свежесть сессии: fresh / stale / very-old / missing. */
  freshness: 'fresh' | 'stale' | 'very-old' | 'missing';
  /** Сколько дней назад обновлялась. */
  ageDays: number | null;
  /** Когда мы последний раз пробовали верифицировать сессию. */
  lastCheckedAt: string | null;
  /** Текст последней ошибки (если есть). */
  lastError: string | null;
  /** Привязанный номер телефона (для UI подсказки). */
  phone: string | null;
};

export async function getRobotSessionStatus(tenantId: string): Promise<RobotSessionStatus> {
  await requireTenantAccess(tenantId);

  const [row] = await db
    .select({
      phone: tenants.wbLkPhone,
      sessionStatus: tenants.wbLkSessionStatus,
      sessionCheckedAt: tenants.wbLkSessionCheckedAt,
      sessionError: tenants.wbLkSessionError,
      storageState: tenants.wbLkStorageState,
      storageRefreshedAt: tenants.wbLkStorageStateRefreshedAt,
      tokenV3: tenants.wbLkTokenV3,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  if (!row) {
    return {
      hasSession: false,
      markedActive: false,
      refreshedAt: null,
      freshness: 'missing',
      ageDays: null,
      lastCheckedAt: null,
      lastError: null,
      phone: null,
    };
  }

  const refreshedAt = row.storageRefreshedAt;
  const freshness = getSessionFreshness(refreshedAt);

  return {
    // WB убрал WBTokenV3 как long-lived cookie (теперь wbx-refresh + wbx-validation-key
    // на .wildberries.ru / .seller-auth.wildberries.ru). Для Playwright-пути
    // (текущая реализация перераспределения) достаточно storageState. Когда
    // будем мигрировать на HTTP — перепроектируем на refresh-flow и проверка
    // вернётся к наличию рабочего access-токена.
    hasSession: Boolean(row.storageState),
    markedActive: row.sessionStatus === 'healthy' || row.sessionStatus === 'active',
    refreshedAt: refreshedAt ? refreshedAt.toISOString() : null,
    freshness: freshness.status,
    ageDays: Number.isFinite(freshness.ageDays) ? freshness.ageDays : null,
    lastCheckedAt: row.sessionCheckedAt ? row.sessionCheckedAt.toISOString() : null,
    lastError: row.sessionError,
    phone: row.phone,
  };
}

import {
  getLocalizationBreakdown,
  type LocalizationBreakdown,
} from '@/server/analytics/localization-breakdown';

/** «Индекс локализации»: per-article local share + logistics impact. */
export async function loadLocalizationBreakdownAction(
  tenantId: string,
  windowDays = 91,
): Promise<LocalizationBreakdown> {
  await requireTenantAccess(tenantId);
  return getLocalizationBreakdown(tenantId, windowDays);
}

/**
 * Оперативный статус робота перераспределения: жив ли он (когда был последний
 * тик), в каком режиме, включена ли авто-отправка, сколько слотов нашёл/забрал,
 * очередь заявок и не заблокирован ли кабинет WB (401/403 → 72ч backoff).
 * Таблицы под RLS → читаем в tenant-контексте.
 */
export type RobotRuntimeStatus = {
  lastRunAt: string | null;
  lastMode: string | null;
  lastStatus: string | null;
  lastMessage: string | null;
  autoSubmit: boolean;
  forbidden: boolean;
  runs24h: number;
  openedSlots24h: number;
  openedSlots7d: number;
  probedLast: number;
  queue: { planned: number; queued: number; running: number; submitted: number; failed: number };
  routes: { status: string; count: number }[];
};

export async function getRobotRuntimeStatus(tenantId: string): Promise<RobotRuntimeStatus> {
  await requireTenantAccess(tenantId);

  return withTenantContext(db, tenantId, async (tx) => {
    const since24 = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [last] = await tx
      .select({
        createdAt: redistributionSlotMonitorRuns.createdAt,
        mode: redistributionSlotMonitorRuns.mode,
        status: redistributionSlotMonitorRuns.status,
        message: redistributionSlotMonitorRuns.message,
        autoSubmit: redistributionSlotMonitorRuns.autoSubmit,
        probedItems: redistributionSlotMonitorRuns.probedItems,
      })
      .from(redistributionSlotMonitorRuns)
      .where(eq(redistributionSlotMonitorRuns.tenantId, tenantId))
      .orderBy(desc(redistributionSlotMonitorRuns.createdAt))
      .limit(1);

    const [agg24] = await tx
      .select({
        runs: sql<number>`count(*)::int`,
        opened: sql<number>`coalesce(sum(${redistributionSlotMonitorRuns.openedSlots}), 0)::int`,
      })
      .from(redistributionSlotMonitorRuns)
      .where(and(
        eq(redistributionSlotMonitorRuns.tenantId, tenantId),
        gte(redistributionSlotMonitorRuns.createdAt, since24),
      ));

    const [agg7] = await tx
      .select({
        opened: sql<number>`coalesce(sum(${redistributionSlotMonitorRuns.openedSlots}), 0)::int`,
      })
      .from(redistributionSlotMonitorRuns)
      .where(and(
        eq(redistributionSlotMonitorRuns.tenantId, tenantId),
        gte(redistributionSlotMonitorRuns.createdAt, since7),
      ));

    const itemRows = await tx
      .select({ status: redistributionItems.status, c: sql<number>`count(*)::int` })
      .from(redistributionItems)
      .where(eq(redistributionItems.tenantId, tenantId))
      .groupBy(redistributionItems.status);

    const routeRows = await tx
      .select({ status: redistributionRouteAvailability.status, c: sql<number>`count(*)::int` })
      .from(redistributionRouteAvailability)
      .where(eq(redistributionRouteAvailability.tenantId, tenantId))
      .groupBy(redistributionRouteAvailability.status);

    const queue = { planned: 0, queued: 0, running: 0, submitted: 0, failed: 0 };
    for (const r of itemRows) {
      const c = Number(r.c) || 0;
      if (r.status === 'planned') queue.planned += c;
      else if (r.status === 'rpa_queued') queue.queued += c;
      else if (r.status === 'rpa_running') queue.running += c;
      else if (r.status === 'rpa_submitted') queue.submitted += c;
      else if (r.status === 'rpa_failed') queue.failed += c;
    }

    const msg = last?.message ?? null;
    const forbidden = Boolean(msg && /(forbidden|отключено|недоступно|\b401\b|\b403\b)/i.test(msg));

    return {
      lastRunAt: last?.createdAt ? last.createdAt.toISOString() : null,
      lastMode: last?.mode ?? null,
      lastStatus: last?.status ?? null,
      lastMessage: msg,
      autoSubmit: Boolean(last?.autoSubmit),
      forbidden,
      runs24h: Number(agg24?.runs) || 0,
      openedSlots24h: Number(agg24?.opened) || 0,
      openedSlots7d: Number(agg7?.opened) || 0,
      probedLast: Number(last?.probedItems) || 0,
      queue,
      routes: routeRows
        .map((r) => ({ status: r.status, count: Number(r.c) || 0 }))
        .sort((a, b) => b.count - a.count),
    };
  });
}
