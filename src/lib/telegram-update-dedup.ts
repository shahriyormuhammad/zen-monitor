/**
 * P3-39: Telegram update_id replay protection.
 *
 * Telegram webhooks are delivered at-least-once and may retry for up to 24 hours.
 * This module deduplicates incoming updates by storing their update_id in Postgres.
 *
 * Strategy:
 *  - INSERT INTO telegram_processed_updates (update_id) … ON CONFLICT DO NOTHING
 *  - Returns true  → first time we see this update_id (process it)
 *  - Returns false → duplicate (skip it)
 *  - Periodic cleanup deletes rows older than 25 h (safely outside Telegram's 24 h window)
 */

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

/** How long to keep processed update_ids (slightly over Telegram's 24 h retry window). */
const RETENTION_HOURS = 25;

/** Run cleanup roughly every N calls to avoid a background job dependency. */
const CLEANUP_EVERY_N = 500;
let callCount = 0;

/**
 * Mark an update_id as processed.
 *
 * @returns true  — update is new, caller should process it
 * @returns false — duplicate, caller should skip silently
 */
export async function markTelegramUpdate(updateId: number): Promise<boolean> {
  try {
    // Atomic INSERT … ON CONFLICT DO NOTHING RETURNING update_id
    // result.length = 1 → new row inserted → process
    // result.length = 0 → conflict (duplicate) → skip
    const result = await db.execute(
      sql`INSERT INTO telegram_processed_updates (update_id)
          VALUES (${updateId})
          ON CONFLICT (update_id) DO NOTHING
          RETURNING update_id`
    );

    const inserted = result.length > 0;

    // Periodic stale-row cleanup (fire-and-forget, failures are non-fatal)
    if (++callCount % CLEANUP_EVERY_N === 0) {
      void cleanupStaleUpdates();
    }

    return inserted;
  } catch (err) {
    // If the dedup check fails (e.g. DB hiccup), log and allow processing to proceed
    // rather than silently dropping a legitimate update.
    logger.warn({ err, updateId }, "[telegram-dedup] markTelegramUpdate failed, allowing update through");
    return true;
  }
}

async function cleanupStaleUpdates(): Promise<void> {
  try {
    await db.execute(
      sql`DELETE FROM telegram_processed_updates
          WHERE processed_at < now() - interval '${sql.raw(String(RETENTION_HOURS))} hours'`
    );
  } catch (err) {
    logger.warn({ err }, "[telegram-dedup] cleanup failed");
  }
}
