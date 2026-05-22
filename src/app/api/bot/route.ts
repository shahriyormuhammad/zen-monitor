import { bot } from "@/server/bot/service";
import { NextRequest } from "next/server";
import type { Update } from "grammy/types";
import { timingSafeEqual } from "node:crypto";
import { withRateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { markTelegramUpdate } from "@/lib/telegram-update-dedup";

export const dynamic = 'force-dynamic';
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
const MIN_SECRET_LENGTH = 32;
let botInitPromise: Promise<void> | null = null;

function isWebhookSecretValid(incomingSecret: string | null): boolean {
  // Defence-in-depth: even if the module-level throw didn't fire, never accept without a secret
  if (!TELEGRAM_WEBHOOK_SECRET || !incomingSecret) {
    return false;
  }

  const incomingSecretBuffer = Buffer.from(incomingSecret);
  const expectedSecretBuffer = Buffer.from(TELEGRAM_WEBHOOK_SECRET);
  if (incomingSecretBuffer.length !== expectedSecretBuffer.length) {
    return false;
  }

  return timingSafeEqual(incomingSecretBuffer, expectedSecretBuffer);
}

async function ensureBotInitialized() {
  if (!bot) {
    return false;
  }

  if (!botInitPromise) {
    botInitPromise = bot.init().then(() => undefined).catch((err: unknown) => {
      botInitPromise = null;
      throw err;
    });
  }

  await botInitPromise;
  return true;
}

/**
 * Обработчик входящих обновлений от Telegram (Webhook)
 */
export const POST = withRateLimit(async (req: NextRequest) => {
  // P0-01: fail-closed in production — reject all requests if secret is missing or too short
  if (process.env.NODE_ENV === 'production' && (!TELEGRAM_WEBHOOK_SECRET || TELEGRAM_WEBHOOK_SECRET.length < MIN_SECRET_LENGTH)) {
    logger.error({ minLength: MIN_SECRET_LENGTH }, 'TELEGRAM_WEBHOOK_SECRET must be >= minLength chars in production');
    return new Response("Service Unavailable", { status: 503 });
  }

  const webhookSecret = req.headers.get('x-telegram-bot-api-secret-token');
  if (!isWebhookSecretValid(webhookSecret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!await ensureBotInitialized() || !bot) {
    return new Response("Bot not initialized", { status: 503 });
  }
  const activeBot = bot;

  try {
    const body = await req.json() as Update;

    // P3-39: replay protection — skip duplicate update_ids
    if (typeof body.update_id === 'number') {
      const isNew = await markTelegramUpdate(body.update_id);
      if (!isNew) {
        logger.info({ updateId: body.update_id }, '[bot] duplicate update_id, skipping');
        return new Response("OK", { status: 200 });
      }
    }

    // Telegram expects webhook ACKs quickly. Heavy report commands keep working
    // in the background and send their answer via Bot API when ready.
    setTimeout(() => {
      void activeBot.handleUpdate(body).catch((err: unknown) => {
        logger.error({ err, updateId: body.update_id ?? null }, 'Bot update handling failed');
      });
    }, 0);

    return new Response("OK", { status: 200 });
  } catch (err: unknown) {
    // P0-02: log full details server-side, return scrubbed response
    logger.error({ err }, 'Bot route error');
    return new Response("Internal Server Error", { status: 500 });
  }
}, { per: 'ip', limit: 60, window: 60 });

/**
 * GET метод для проверки работоспособности
 */
export async function GET() {
  return new Response(`Bot status: ${bot ? 'INITIALIZED' : 'WAITING_FOR_TOKEN'}`);
}
