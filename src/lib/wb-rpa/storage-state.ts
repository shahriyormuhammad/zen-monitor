import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { eq } from 'drizzle-orm';
import type { BrowserContext } from 'playwright';

import { db } from '@/lib/db';
import { tenants } from '@/lib/db/schema';
import { decrypt, encrypt } from '@/lib/encryption';
import { logger } from '@/lib/logger';

/**
 * Hard limit для удаления legacy file-based сессий (90 дней). Для in-DB
 * сессий жёсткого TTL больше нет — сессия живёт пока WB-куки внутри живые.
 * Валидность определяем по реальному запросу, а не по таймстампу.
 */
export const STORAGE_STATE_HARD_TTL_DAYS = 90;
export const STORAGE_STATE_HARD_TTL_MS = STORAGE_STATE_HARD_TTL_DAYS * 24 * 60 * 60 * 1000;

/** Soft-порог: после стольких дней показываем UI-warning «давно не обновлялось». */
export const STORAGE_STATE_STALE_DAYS = 30;
export const STORAGE_STATE_STALE_MS = STORAGE_STATE_STALE_DAYS * 24 * 60 * 60 * 1000;

export type StorageStateSession = {
  tempPath: string;
  cleanup: () => Promise<void>;
};

export type SessionFreshness = {
  ageDays: number;
  status: 'fresh' | 'stale' | 'very-old' | 'missing';
};

export function getSessionFreshness(refreshedAt: Date | null | undefined): SessionFreshness {
  if (!refreshedAt) return { ageDays: Infinity, status: 'missing' };
  const ageMs = Date.now() - refreshedAt.getTime();
  const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
  if (ageMs > STORAGE_STATE_HARD_TTL_MS) return { ageDays, status: 'very-old' };
  if (ageMs > STORAGE_STATE_STALE_MS) return { ageDays, status: 'stale' };
  return { ageDays, status: 'fresh' };
}

/**
 * @deprecated Используется только для удаления legacy файловых сессий старше
 *   90 дней. Для активных сессий жёсткого TTL нет — Playwright обновляет
 *   куки при каждом использовании, и сессия живёт пока WB её не отзовёт.
 */
export function isStorageStateExpired(refreshedAt: Date | null | undefined): boolean {
  if (!refreshedAt) return true;
  return Date.now() - refreshedAt.getTime() > STORAGE_STATE_HARD_TTL_MS;
}

async function writeTempStorageStateFile(payload: string): Promise<StorageStateSession> {
  const dir = await mkdtemp(join(tmpdir(), 'wb-rpa-session-'));
  const tempPath = join(dir, `${randomBytes(8).toString('hex')}.json`);
  await writeFile(tempPath, payload, { encoding: 'utf-8', mode: 0o600 });
  return {
    tempPath,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Загружает сохранённую WB-сессию для tenant'а в одноразовый временный файл.
 * Возвращает null, если сессия отсутствует, истёк TTL (7 дней), или не удалось расшифровать.
 * Вызывающий обязан вызвать cleanup() в finally, чтобы удалить временный файл.
 */
export async function loadStorageStateSession(tenantId: string): Promise<StorageStateSession | null> {
  const [row] = await db.select({
    wbLkStorageState: tenants.wbLkStorageState,
    wbLkStorageStateRefreshedAt: tenants.wbLkStorageStateRefreshedAt,
    wbLkStorageStatePath: tenants.wbLkStorageStatePath,
  })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  if (!row) {
    return null;
  }

  if (row.wbLkStorageState) {
    // Жёсткий TTL убран — сессия живёт пока WB-куки внутри валидны. Если
    // сессия совсем древняя (>90 дней), всё-таки чистим как мусор.
    if (isStorageStateExpired(row.wbLkStorageStateRefreshedAt)) {
      logger.warn({ tenantId, refreshedAt: row.wbLkStorageStateRefreshedAt }, '[wb-rpa.storage-state] removing very-old session (>90d)');
      await db.update(tenants)
        .set({ wbLkStorageState: null, wbLkStorageStateRefreshedAt: null })
        .where(eq(tenants.id, tenantId));
      return null;
    }
    let plaintext: string;
    try {
      plaintext = decrypt(row.wbLkStorageState);
    } catch (error) {
      logger.error({ err: error, tenantId }, '[wb-rpa.storage-state] не удалось расшифровать сессию');
      return null;
    }
    return writeTempStorageStateFile(plaintext);
  }

  const legacyPath = row.wbLkStorageStatePath;
  if (!legacyPath || !(await fileExists(legacyPath))) {
    return null;
  }

  try {
    const legacyStat = await stat(legacyPath);
    if (Date.now() - legacyStat.mtimeMs > STORAGE_STATE_HARD_TTL_MS) {
      await unlink(legacyPath).catch(() => {});
      await db.update(tenants)
        .set({ wbLkStorageStatePath: null })
        .where(eq(tenants.id, tenantId));
      return null;
    }
    const plaintext = await readFile(legacyPath, 'utf-8');
    const encrypted = encrypt(plaintext);
    await db.update(tenants)
      .set({
        wbLkStorageState: encrypted,
        wbLkStorageStateRefreshedAt: legacyStat.mtime,
        wbLkStorageStatePath: null,
      })
      .where(eq(tenants.id, tenantId));
    await unlink(legacyPath).catch(() => {});
    return writeTempStorageStateFile(plaintext);
  } catch (error) {
    logger.error({ err: error, tenantId }, '[wb-rpa.storage-state] legacy migration failed');
    return null;
  }
}

/**
 * Снимает storageState с живого Playwright context'а, шифрует и сохраняет в БД.
 * Файл на диске не создаётся.
 */
export async function persistStorageStateFromContext(
  tenantId: string,
  context: BrowserContext,
): Promise<void> {
  const state = await context.storageState();
  const payload = JSON.stringify(state);
  const encrypted = encrypt(payload);
  await db.update(tenants)
    .set({
      wbLkStorageState: encrypted,
      wbLkStorageStateRefreshedAt: new Date(),
      wbLkStorageStatePath: null,
    })
    .where(eq(tenants.id, tenantId));
}
