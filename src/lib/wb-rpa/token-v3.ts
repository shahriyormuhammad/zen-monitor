/**
 * Извлечение и сохранение WBTokenV3 — постоянного токена доступа к ЛК
 * продавца (не истекает по WB design). Используется как Bearer для HTTP-
 * запросов в ЛК, минуя Playwright.
 *
 * WB кладёт токен в куку `WBTokenV3` после успешной авторизации
 * (домен `.wildberries.ru` / `seller.wildberries.ru`).
 */

import { eq } from 'drizzle-orm';
import type { BrowserContext, Cookie } from 'playwright';

import { db } from '@/lib/db';
import { tenants } from '@/lib/db/schema';
import { decrypt, encrypt } from '@/lib/encryption';
import { logger } from '@/lib/logger';

const WB_TOKEN_V3_COOKIE = 'WBTokenV3';

/** Ищет WBTokenV3 в массиве cookies с любого домена WB. */
export function findWbTokenV3InCookies(cookies: readonly Cookie[]): string | null {
  for (const cookie of cookies) {
    if (cookie.name === WB_TOKEN_V3_COOKIE && cookie.value) {
      return cookie.value;
    }
  }
  return null;
}

/**
 * Снимает WBTokenV3 с живого Playwright context'а, шифрует и сохраняет в БД.
 * Возвращает true если токен был найден и сохранён, false если не нашли.
 */
export async function extractAndPersistWbTokenV3(
  tenantId: string,
  context: BrowserContext,
): Promise<boolean> {
  const cookies = await context.cookies();
  const token = findWbTokenV3InCookies(cookies);
  if (!token) {
    logger.warn({ tenantId, cookieCount: cookies.length }, '[wb-token-v3] WBTokenV3 не найден в cookies');
    return false;
  }
  const encrypted = encrypt(token);
  await db.update(tenants)
    .set({
      wbLkTokenV3: encrypted,
      wbLkTokenV3RefreshedAt: new Date(),
    })
    .where(eq(tenants.id, tenantId));
  logger.info({ tenantId, tokenLength: token.length }, '[wb-token-v3] токен извлечён и сохранён');
  return true;
}

/**
 * Загружает расшифрованный WBTokenV3 для tenant'а. Возвращает null если
 * токен отсутствует или не удалось расшифровать. НЕ проверяет валидность —
 * это должен делать вызывающий через тестовый запрос.
 */
export async function loadWbTokenV3(tenantId: string): Promise<{
  token: string;
  refreshedAt: Date | null;
} | null> {
  const [row] = await db.select({
    token: tenants.wbLkTokenV3,
    refreshedAt: tenants.wbLkTokenV3RefreshedAt,
  })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  if (!row || !row.token) return null;

  try {
    const plaintext = decrypt(row.token);
    return { token: plaintext, refreshedAt: row.refreshedAt };
  } catch (error) {
    logger.error({ err: error, tenantId }, '[wb-token-v3] decrypt failed');
    return null;
  }
}

/** Удалить токен (например, при logout или сменe пароля юзером). */
export async function clearWbTokenV3(tenantId: string): Promise<void> {
  await db.update(tenants)
    .set({ wbLkTokenV3: null, wbLkTokenV3RefreshedAt: null })
    .where(eq(tenants.id, tenantId));
}
