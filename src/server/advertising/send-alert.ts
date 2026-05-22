import { eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { tenants } from '@/lib/db/schema';
import {
  formatAdAlert,
  markAlertSent,
  shouldThrottle,
  type AdAlertPayload,
  type ThrottleOptions,
} from '@/lib/advertising/notifications';
import { bot } from '@/server/bot/service';
import { logger } from '@/lib/logger';

const APP_BASE_URL = process.env.APP_BASE_URL ?? 'https://enterprise-analytics.v-wb.ru';

export type SendAdAlertResult =
  | { status: 'sent' }
  | { status: 'skipped'; reason: 'throttled' | 'no_chat_id' | 'bot_unavailable' | 'send_failed'; error?: string };

/**
 * Отправка рекламного алерта в Telegram (P70).
 *
 * Шаги:
 *  1. Бот инициализирован?
 *  2. Throttle по (tenantId, type) — для `balance_low`/`advisor_daily_digest`/`learning_period_ended`
 *  3. У тенанта есть `telegramChatId`?
 *  4. Формат сообщения (P69 explain + эмодзи + ссылка)
 *  5. `bot.api.sendMessage(chatId, text, { parse_mode })`
 *  6. `markAlertSent` при успехе (чтобы failed send не запечатывал throttle)
 */
export async function sendAdAlert(
  tenantId: string,
  payload: AdAlertPayload,
  throttleOptions?: ThrottleOptions,
): Promise<SendAdAlertResult> {
  if (!bot) {
    return { status: 'skipped', reason: 'bot_unavailable' };
  }

  if (shouldThrottle(tenantId, payload.type, Date.now(), throttleOptions)) {
    return { status: 'skipped', reason: 'throttled' };
  }

  const [tenant] = await db
    .select({ telegramChatId: tenants.telegramChatId })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  if (!tenant?.telegramChatId) {
    return { status: 'skipped', reason: 'no_chat_id' };
  }

  const { text, parseMode } = formatAdAlert(payload, { appBaseUrl: APP_BASE_URL });

  try {
    await bot.api.sendMessage(tenant.telegramChatId, text, {
      parse_mode: parseMode,
      link_preview_options: { is_disabled: true },
    });
    markAlertSent(tenantId, payload.type, Date.now(), { subkey: throttleOptions?.subkey });
    return { status: 'sent' };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ err: error, tenantId, alertType: payload.type }, '[sendAdAlert] Failed to send');
    return { status: 'skipped', reason: 'send_failed', error: errorMessage };
  }
}
