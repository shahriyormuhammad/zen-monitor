'use server';

import { eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { tenants } from '@/lib/db/schema';
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
