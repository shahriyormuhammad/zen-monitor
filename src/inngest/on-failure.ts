import { db } from '@/lib/db';
import { bot } from '@/server/bot/service';
import { logger } from '@/lib/logger';

const opsChatId = process.env.TELEGRAM_OPS_CHAT_ID?.trim();

/**
 * Shared onFailure handler for Inngest functions.
 * Sends sanitized Telegram alerts when a function exhausts all retries.
 *
 * Usage: pass as `onFailure` in createFunction config.
 */
export async function handleInngestFailure({
  event,
  error,
}: {
  event: { name: string; data: Record<string, unknown> };
  error: Error;
}) {
  const functionName = event.data?.functionId as string | undefined ?? event.name;
  const tenantId = event.data?.tenantId as string | undefined;
  const errorMessage = error?.message ?? 'Unknown error';

  logger.error({ functionName, tenantId: tenantId ?? null, errorMessage }, 'Inngest function exhausted all retries');

  // If we have a tenantId and a working bot, alert via Telegram
  if (tenantId && bot) {
    try {
      const tenant = await db.query.tenants.findFirst({
        where: (t, { eq }) => eq(t.id, tenantId),
        columns: { telegramChatId: true, notificationsEnabled: true },
      });

      if (tenant?.telegramChatId && tenant.notificationsEnabled) {
        await bot.api.sendMessage(
          tenant.telegramChatId,
          [
            `⚠️ <b>Фоновая задача завершилась с ошибкой</b>`,
            ``,
            `Мы уже видим проблему в логах. Повтори действие позже или напиши в поддержку, если данные не обновятся.`,
            `<b>Время:</b> ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`,
          ].join('\n'),
          { parse_mode: 'HTML' }
        );
      }
    } catch (alertError) {
      logger.error({ err: alertError, tenantId }, 'Failed to send Telegram failure alert');
    }
  }

  // Cron/system jobs without tenantId must not broadcast internal errors to all tenant chats.
  if (!tenantId && bot && opsChatId) {
    try {
      await bot.api.sendMessage(
        opsChatId,
        [
          `⚠️ <b>Фоновая задача завершилась с ошибкой</b>`,
          ``,
          `Детали записаны в серверные логи.`,
          `<b>Время:</b> ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`,
        ].join('\n'),
        { parse_mode: 'HTML' }
      );
    } catch (alertError) {
      logger.error({ err: alertError }, 'Failed to send broadcast Telegram failure alert');
    }
  }
}
