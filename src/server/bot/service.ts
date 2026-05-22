import { Bot, InputFile } from "grammy";
import type { CommandContext, Context } from "grammy";
import { db, withAdminContext } from "@/lib/db";
import { telegramChatLinks, telegramLinkTokens, tenants } from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";
import type { SignalNotificationItem } from "@/lib/operator-signal-timeline";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { buildAgentReport } from "@/server/agent/reports";
import { hashTelegramLinkToken, normalizeTelegramStartToken } from "@/lib/telegram-link-token";
import {
  assertReportCommandChatType,
  buildAgentHelpMessage,
  formatAgentReportMessage,
  parseAdsCommandArgs,
  parseDashboardCommandArgs,
  parseReviewsCommandArgs,
  parseStockCommandArgs,
  parseUnitEconomicsCommandArgs,
} from "@/server/bot/agent-commands";

const token = process.env.TELEGRAM_BOT_TOKEN;
const appBaseUrl = process.env.APP_BASE_URL ?? "https://enterprise-analytics.v-wb.ru";
const allowGroupReportCommands = process.env.TELEGRAM_ALLOW_GROUP_REPORT_COMMANDS === "true";
const opsChatId = process.env.TELEGRAM_OPS_CHAT_ID ? Number(process.env.TELEGRAM_OPS_CHAT_ID) : null;
const MAIN_MENU_KEYBOARD = {
  keyboard: [
    [{ text: "📊 Сводка" }, { text: "🔄 Статус" }],
    [{ text: "💬 Отзывы" }, { text: "🧮 Юнит-экономика" }],
    [{ text: "📦 Остатки" }, { text: "📣 Реклама" }],
    [{ text: "🆘 Поддержка" }, { text: "❓ Помощь" }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};

// Инициализируем бота только если есть валидный токен
export const bot = token && !token.includes("your_bot_token")
  ? new Bot(token)
  : null;

if (bot) {
  const replyWithMenu = (
    ctx: Context,
    text: string,
    options: Parameters<Context["reply"]>[1] = {},
  ) => ctx.reply(text, {
    ...options,
    reply_markup: MAIN_MENU_KEYBOARD,
  });

  const normalizeTextCommand = (value: string) =>
    value
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

  const consumeTelegramLinkToken = async (ctx: CommandContext<Context>, rawToken: string) => {
    const token = normalizeTelegramStartToken(rawToken);
    if (!token) {
      throw new AppError("Ссылка привязки некорректна или повреждена. Создай новую ссылку в настройках кабинета.", 400);
    }

    if (ctx.chat.type !== "private") {
      throw new AppError("Привязка кабинета выполняется только в личном чате с ботом.", 403);
    }

    if (!ctx.from?.id) {
      throw new AppError("Telegram не передал пользователя. Повтори /start в личном чате.", 400);
    }

    const telegramUser = ctx.from;
    const tokenHash = hashTelegramLinkToken(token);
    const now = new Date();

    return withAdminContext(db, async (tx) => {
      const [linkToken] = await tx.select({
        id: telegramLinkTokens.id,
        tenantId: telegramLinkTokens.tenantId,
        tenantName: tenants.name,
        shopName: tenants.shopName,
      })
        .from(telegramLinkTokens)
        .innerJoin(tenants, eq(telegramLinkTokens.tenantId, tenants.id))
        .where(and(
          eq(telegramLinkTokens.tokenHash, tokenHash),
          eq(telegramLinkTokens.status, "pending"),
          sql`${telegramLinkTokens.expiresAt} > now()`,
        ))
        .limit(1);

      if (!linkToken) {
        throw new AppError("Ссылка привязки истекла или уже использована. Создай новую ссылку в настройках кабинета.", 400);
      }

      const [existingLink] = await tx.select({
        id: telegramChatLinks.id,
        tenantId: telegramChatLinks.tenantId,
      })
        .from(telegramChatLinks)
        .where(and(
          eq(telegramChatLinks.chatId, ctx.chat.id),
          eq(telegramChatLinks.status, "active"),
        ))
        .limit(1);

      if (existingLink && existingLink.tenantId !== linkToken.tenantId) {
        throw new AppError("Этот Telegram уже привязан к другому кабинету. Сначала отвяжи старую связь в настройках кабинета.", 409);
      }

      const telegramUsername = telegramUser.username ?? null;
      if (existingLink) {
        await tx.update(telegramChatLinks)
          .set({
            chatType: ctx.chat.type,
            telegramUserId: telegramUser.id,
            telegramUsername,
            revokedAt: null,
          })
          .where(eq(telegramChatLinks.id, existingLink.id));
      } else {
        await tx.insert(telegramChatLinks).values({
          tenantId: linkToken.tenantId,
          chatId: ctx.chat.id,
          chatType: ctx.chat.type,
          telegramUserId: telegramUser.id,
          telegramUsername,
          status: "active",
        });
      }

      await tx.update(telegramLinkTokens)
        .set({
          status: "used",
          usedAt: now,
          usedChatId: ctx.chat.id,
          usedTelegramUserId: telegramUser.id,
          usedTelegramUsername: telegramUsername,
        })
        .where(eq(telegramLinkTokens.id, linkToken.id));

      await tx.update(tenants)
        .set({ telegramChatId: ctx.chat.id })
        .where(eq(tenants.id, linkToken.tenantId));

      return {
        tenantId: linkToken.tenantId,
        label: linkToken.shopName ?? linkToken.tenantName,
      };
    });
  };

  const resolveTenantForChat = async (chatId: number) => {
    const linkedTenants = await withAdminContext(db, (tx) =>
      tx.select({
        id: tenants.id,
        name: tenants.name,
        shopName: tenants.shopName,
      })
        .from(telegramChatLinks)
        .innerJoin(tenants, eq(telegramChatLinks.tenantId, tenants.id))
        .where(and(
          eq(telegramChatLinks.chatId, chatId),
          eq(telegramChatLinks.status, "active"),
        ))
        .limit(2)
    );

    if (linkedTenants.length > 1) {
      return {
        ok: false as const,
        reason: "ambiguous",
        tenants: linkedTenants,
      };
    }

    if (linkedTenants.length === 1) {
      return {
        ok: true as const,
        tenant: linkedTenants[0]!,
      };
    }

    const legacyTenants = await withAdminContext(db, (tx) =>
      tx.select({
        id: tenants.id,
        name: tenants.name,
        shopName: tenants.shopName,
      })
        .from(tenants)
        .where(eq(tenants.telegramChatId, chatId))
        .limit(2)
    );

    if (legacyTenants.length === 0) {
      return {
        ok: false as const,
        reason: "not_linked",
      };
    }

    if (legacyTenants.length > 1) {
      return {
        ok: false as const,
        reason: "ambiguous",
        tenants: legacyTenants,
      };
    }

    return {
      ok: true as const,
      tenant: legacyTenants[0]!,
    };
  };

  const ensureTenantForChat = async (chatId: number) => {
    const resolved = await resolveTenantForChat(chatId);
    if (resolved.ok) {
      return resolved.tenant;
    }

    if (resolved.reason === "ambiguous") {
      const tenantsLabel = (resolved.tenants ?? [])
        .map((tenant) => `${tenant.shopName ?? tenant.name} (${tenant.id})`)
        .join(", ");
      throw new AppError(`Этот чат привязан к нескольким кабинетам: ${tenantsLabel}. Оставь один chat ID на один кабинет.`, 400);
    }

    throw new AppError(
      `Этот чат не привязан к кабинету. Укажи ID чата ${chatId} в настройках кабинета или создай новую ссылку привязки.`,
      400,
    );
  };

  const replyWithReport = async (
    ctx: Context,
    reportRequest: Parameters<typeof buildAgentReport>[0],
  ) => {
    if (!ctx.chat) {
      throw new AppError("Не удалось определить чат Telegram.", 400);
    }

    assertReportCommandChatType(ctx.chat.type, {
      allowGroupReportCommands,
    });

    const chatId = ctx.chat.id;
    const tenant = await ensureTenantForChat(chatId);
    const report = await buildAgentReport({
      ...reportRequest,
      tenantId: tenant.id,
    });

    return replyWithMenu(
      ctx,
      formatAgentReportMessage(report, buildAbsoluteAppUrl),
      {
        parse_mode: "HTML",
        link_preview_options: {
          is_disabled: true,
        },
      },
    );
  };

  const buildDaysDateRangeParams = (days: number) => {
    const to = new Date();
    const from = new Date(to);
    from.setDate(to.getDate() - days + 1);
    return {
      dateFrom: from.toISOString().slice(0, 10),
      dateTo: to.toISOString().slice(0, 10),
    };
  };

  bot.command("start", async (ctx) => {
    const startToken = ctx.match.trim();
    if (startToken) {
      try {
        const linked = await consumeTelegramLinkToken(ctx, startToken);
        await replyWithMenu(
          ctx,
          `Готово. Telegram привязан к кабинету: ${linked.label}.\n\nВыбери действие кнопкой ниже.`,
        );
      } catch (error: unknown) {
        const message = error instanceof AppError
          ? error.message
          : "Не удалось привязать Telegram. Создай новую ссылку в настройках кабинета и повтори.";
        await replyWithMenu(ctx, message);
      }
      return;
    }

    const resolved = await resolveTenantForChat(ctx.chat.id);
    if (resolved.ok) {
      await replyWithMenu(
        ctx,
        `👋 Привет! Кабинет уже привязан: ${resolved.tenant.shopName ?? resolved.tenant.name}.\n\nВыбери действие кнопкой ниже.`,
      );
      return;
    }

    await replyWithMenu(
      ctx,
      `👋 *Привет! Это ПроЦифры Ассистент.*\n\n` +
      `ID этого чата: \`${ctx.chat.id}\`\n\n` +
      `Чтобы включить отчёты и уведомления, привяжи Telegram в настройках личного кабинета ПроЦифры.`,
      { parse_mode: "Markdown" }
    );
  });

  bot.command("help", async (ctx) => {
    await replyWithMenu(ctx, buildAgentHelpMessage(ctx.chat.id), {
      parse_mode: "HTML",
      link_preview_options: {
        is_disabled: true,
      },
    });
  });

  bot.command("dashboard", async (ctx) => {
    try {
      const { days } = parseDashboardCommandArgs(ctx.match);
      await replyWithReport(ctx, {
        tenantId: "",
        report: "dashboard_summary",
        params: { days },
      });
    } catch (error: unknown) {
      const message = error instanceof AppError
        ? error.message
        : "Не удалось сформировать сводку. Повтори команду позже.";
      await replyWithMenu(ctx, message);
    }
  });

  const handleUnitEconomicsCommand = async (ctx: CommandContext<Context>) => {
    try {
      const { nmId, days } = parseUnitEconomicsCommandArgs(ctx.match);
      await replyWithReport(ctx, {
        tenantId: "",
        report: "unit_economics_summary",
        params: { nmId, days },
      });
    } catch (error: unknown) {
      const message = error instanceof AppError
        ? error.message
        : "Не удалось сформировать юнит-экономику. Повтори команду позже.";
      await replyWithMenu(ctx, message);
    }
  };

  bot.command("unit", handleUnitEconomicsCommand);
  bot.command("economics", handleUnitEconomicsCommand);

  bot.command("sync", async (ctx) => {
    try {
      await replyWithReport(ctx, {
        tenantId: "",
        report: "sync_status",
      });
    } catch (error: unknown) {
      const message = error instanceof AppError
        ? error.message
        : "Не удалось получить статус синков. Повтори команду позже.";
      await replyWithMenu(ctx, message);
    }
  });

  bot.command("stock", async (ctx) => {
    try {
      const { nmId } = parseStockCommandArgs(ctx.match);
      await replyWithReport(ctx, {
        tenantId: "",
        report: "stocks_summary",
        params: { nmId, limit: 10 },
      });
    } catch (error: unknown) {
      const message = error instanceof AppError
        ? error.message
        : "Не удалось получить остатки. Повтори команду позже.";
      await replyWithMenu(ctx, message);
    }
  });

  bot.command("ads", async (ctx) => {
    try {
      const { nmId, days } = parseAdsCommandArgs(ctx.match);
      await replyWithReport(ctx, {
        tenantId: "",
        report: "advertising_by_nm_summary",
        params: {
          nmId,
          ...buildDaysDateRangeParams(days),
        },
      });
    } catch (error: unknown) {
      const message = error instanceof AppError
        ? error.message
        : "Не удалось получить рекламный отчет. Повтори команду позже.";
      await replyWithMenu(ctx, message);
    }
  });

  bot.command("reviews", async (ctx) => {
    try {
      const { limit } = parseReviewsCommandArgs(ctx.match);
      await replyWithReport(ctx, {
        tenantId: "",
        report: "reviews_summary",
        params: {
          answerStatus: "not_answered",
          limit,
        },
      });
    } catch (error: unknown) {
      const message = error instanceof AppError
        ? error.message
        : "Не удалось получить отзывы. Повтори команду позже.";
      await replyWithMenu(ctx, message);
    }
  });

  bot.command("support", async (ctx) => {
    try {
      assertReportCommandChatType(ctx.chat.type, {
        allowGroupReportCommands,
      });
      const tenant = await ensureTenantForChat(ctx.chat.id);
      const text = ctx.match.trim();
      if (!text) {
        throw new AppError("Напиши вопрос после слова «Поддержка». Например: «Поддержка не вижу остатки за сегодня».", 400);
      }

      if (!opsChatId || Number.isNaN(opsChatId)) {
        await replyWithMenu(ctx, "Чат поддержки пока не настроен. Напиши оператору напрямую или повтори позже.");
        return;
      }

      const fromLabel = ctx.from
        ? `${ctx.from.username ? `@${ctx.from.username}` : ctx.from.id}`
        : String(ctx.chat.id);
      await bot.api.sendMessage(
        opsChatId,
        [
          "<b>Обращение из Telegram</b>",
          `Кабинет: <code>${escapeHtml(tenant.shopName ?? tenant.name)}</code>`,
          `ID чата: <code>${ctx.chat.id}</code>`,
          `От: <code>${escapeHtml(fromLabel)}</code>`,
          "",
          escapeHtml(text.slice(0, 2000)),
        ].join("\n"),
        { parse_mode: "HTML" },
      );
      await replyWithMenu(ctx, "Обращение отправлено оператору.");
    } catch (error: unknown) {
      const message = error instanceof AppError
        ? error.message
        : "Не удалось отправить обращение. Повтори позже.";
      await replyWithMenu(ctx, message);
    }
  });

  const handleSupportText = async (ctx: Context, text: string) => {
    try {
      assertReportCommandChatType(ctx.chat?.type, {
        allowGroupReportCommands,
      });
      if (!ctx.chat) {
        throw new AppError("Не удалось определить чат Telegram.", 400);
      }
      const tenant = await ensureTenantForChat(ctx.chat.id);

      if (!opsChatId || Number.isNaN(opsChatId)) {
        await replyWithMenu(ctx, "Чат поддержки пока не настроен. Напиши оператору напрямую или повтори позже.");
        return;
      }

      const fromLabel = ctx.from
        ? `${ctx.from.username ? `@${ctx.from.username}` : ctx.from.id}`
        : String(ctx.chat.id);
      await bot.api.sendMessage(
        opsChatId,
        [
          "<b>Обращение из Telegram</b>",
          `Кабинет: <code>${escapeHtml(tenant.shopName ?? tenant.name)}</code>`,
          `ID чата: <code>${ctx.chat.id}</code>`,
          `От: <code>${escapeHtml(fromLabel)}</code>`,
          "",
          escapeHtml(text.slice(0, 2000)),
        ].join("\n"),
        { parse_mode: "HTML" },
      );
      await replyWithMenu(ctx, "Обращение отправлено оператору.");
    } catch (error: unknown) {
      const message = error instanceof AppError
        ? error.message
        : "Не удалось отправить обращение. Повтори позже.";
      await replyWithMenu(ctx, message);
    }
  };

  const promptForArticle = async (ctx: Context, label: "unit" | "stock" | "ads" | "support") => {
    const prompts = {
      unit: "Напиши: «Юнит 12345678». Можно добавить период: «Юнит 12345678 14».",
      stock: "Напиши: «Остатки 12345678».",
      ads: "Напиши: «Реклама 12345678». Можно добавить период: «Реклама 12345678 14».",
      support: "Напиши вопрос после слова «Поддержка». Например: «Поддержка не вижу остатки за сегодня».",
    };
    await replyWithMenu(ctx, prompts[label]);
  };

  bot.on("message:text", async (ctx) => {
    const rawText = ctx.message.text.trim();
    if (!rawText || rawText.startsWith("/")) {
      return;
    }

    const normalized = normalizeTextCommand(rawText);
    const parts = normalized.split(" ");
    const head = parts[0] ?? "";
    const args = parts.slice(1).join(" ");

    try {
      if (head === "сводка") {
        const { days } = parseDashboardCommandArgs(args);
        await replyWithReport(ctx, {
          tenantId: "",
          report: "dashboard_summary",
          params: { days },
        });
        return;
      }

      if (normalized === "статус" || normalized === "синхронизации" || normalized === "статус синхронизаций") {
        await replyWithReport(ctx, {
          tenantId: "",
          report: "sync_status",
        });
        return;
      }

      if (head === "отзывы") {
        const { limit } = parseReviewsCommandArgs(args);
        await replyWithReport(ctx, {
          tenantId: "",
          report: "reviews_summary",
          params: {
            answerStatus: "not_answered",
            limit,
          },
        });
        return;
      }

      if (normalized === "юнит" || normalized === "юнит экономика") {
        await promptForArticle(ctx, "unit");
        return;
      }

      if (head === "юнит") {
        const unitArgs = parts[1] === "экономика" ? parts.slice(2).join(" ") : args;
        const { nmId, days } = parseUnitEconomicsCommandArgs(unitArgs);
        await replyWithReport(ctx, {
          tenantId: "",
          report: "unit_economics_summary",
          params: { nmId, days },
        });
        return;
      }

      if (normalized === "остатки") {
        await promptForArticle(ctx, "stock");
        return;
      }

      if (head === "остатки") {
        const { nmId } = parseStockCommandArgs(args);
        await replyWithReport(ctx, {
          tenantId: "",
          report: "stocks_summary",
          params: { nmId, limit: 10 },
        });
        return;
      }

      if (normalized === "реклама") {
        await promptForArticle(ctx, "ads");
        return;
      }

      if (head === "реклама") {
        const { nmId, days } = parseAdsCommandArgs(args);
        await replyWithReport(ctx, {
          tenantId: "",
          report: "advertising_by_nm_summary",
          params: {
            nmId,
            ...buildDaysDateRangeParams(days),
          },
        });
        return;
      }

      if (normalized === "помощь") {
        await replyWithMenu(ctx, buildAgentHelpMessage(ctx.chat.id), {
          parse_mode: "HTML",
          link_preview_options: {
            is_disabled: true,
          },
        });
        return;
      }

      if (normalized === "поддержка") {
        await promptForArticle(ctx, "support");
        return;
      }

      if (head === "поддержка") {
        const supportText = rawText.replace(/^[^\p{L}\p{N}]*поддержка[\s:,-]*/iu, "").trim();
        await handleSupportText(ctx, supportText);
        return;
      }

      await replyWithMenu(
        ctx,
        "Я пока понимаю кнопки ниже и короткие команды текстом: «Сводка», «Отзывы», «Статус», «Остатки 12345678», «Реклама 12345678», «Юнит 12345678».\n\nДля вопроса оператору напиши: «Поддержка текст вопроса».",
      );
    } catch (error: unknown) {
      const message = error instanceof AppError
        ? error.message
        : "Не удалось выполнить действие. Повтори позже.";
      await replyWithMenu(ctx, message);
    }
  });
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function buildAbsoluteAppUrl(href: string) {
  return new URL(href, appBaseUrl).toString();
}

type BotSignalPayload = {
  severity: "critical" | "high" | "medium";
  title: string;
  vendorCode: string;
  nmId: string;
  description: string;
  action: string;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeSignalPayload(signal: unknown): BotSignalPayload | null {
  if (!signal || typeof signal !== "object") {
    return null;
  }

  const source = signal as Record<string, unknown>;
  const severity = source.severity === "critical" || source.severity === "high" ? source.severity : "medium";
  const title = typeof source.title === "string" && source.title.trim().length > 0
    ? source.title.trim()
    : "Новый сигнал";
  const description = typeof source.description === "string" && source.description.trim().length > 0
    ? source.description.trim()
    : "Требуется проверка сигнала.";
  const action = typeof source.action === "string" && source.action.trim().length > 0
    ? source.action.trim()
    : "Откройте карточку сигнала и проверьте детали.";
  const vendorCode = typeof source.vendorCode === "string" && source.vendorCode.trim().length > 0
    ? source.vendorCode.trim()
    : "—";
  const nmId = typeof source.nmId === "number" || typeof source.nmId === "string"
    ? String(source.nmId)
    : "—";

  return {
    severity,
    title,
    description,
    action,
    vendorCode,
    nmId,
  };
}

export class BotService {
  /**
   * Отправить уведомление о сигнале (утечке) в Telegram
   */
  static async sendSignal(tenantId: string, signal: unknown) {
    if (!bot) {
      logger.warn("[Bot Service] Bot not initialized (missing token)");
      return;
    }

    const tenant = await db.query.tenants.findFirst({
        where: eq(tenants.id, tenantId)
    });

    if (!tenant?.telegramChatId || !tenant.notificationsEnabled) {
      return;
    }

    const normalizedSignal = normalizeSignalPayload(signal);
    if (!normalizedSignal) {
      logger.warn("[Bot Service] Failed to send signal: payload has invalid format");
      return;
    }

    const emoji = normalizedSignal.severity === "critical"
      ? "🔴"
      : normalizedSignal.severity === "high"
      ? "🟠"
      : "🔵";

    const message =
      `${emoji} *ВНИМАНИЕ: ${normalizedSignal.title.toUpperCase()}*\n\n` +
      `📦 Артикул: \`${normalizedSignal.vendorCode}\` (${normalizedSignal.nmId})\n` +
      `⚠️ *Проблема:* ${normalizedSignal.description}\n\n` +
      `💡 *Предложение:* ${normalizedSignal.action}\n\n` +
      `🔗 [Открыть аналитику этого товара](${buildAbsoluteAppUrl("/economics")})`;

    try {
      await bot.api.sendMessage(tenant.telegramChatId, message, { parse_mode: "Markdown" });
    } catch (error: unknown) {
      logger.error({ err: error, tenantId }, "[Bot Service] Failed to send message");
    }
  }

  static async sendSignalCollaborationEvent(
    tenantId: string,
    notification: Pick<
      SignalNotificationItem,
      | "signalId"
      | "signalTitle"
      | "signalSeverity"
      | "signalNmId"
      | "actorEmail"
      | "eventType"
      | "eventBody"
      | "summary"
      | "href"
      | "assigneeEmail"
      | "isSlaNotification"
    >
  ) {
    if (!bot) {
      logger.warn("[Bot Service] Bot not initialized (missing token)");
      return;
    }

    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
    });

    if (!tenant?.telegramChatId || !tenant.notificationsEnabled) {
      return;
    }

    const emoji =
      notification.isSlaNotification
        ? "🚨"
        : notification.eventType === "note"
        ? "💬"
        : notification.eventType === "assignment"
          ? "👤"
          : "⛔";

    const messageParts = [
      `${emoji} <b>Командный сигнал</b>`,
      `<b>${escapeHtml(notification.signalTitle)}</b>`,
      notification.signalNmId ? `NM: <code>${notification.signalNmId}</code>` : null,
      `Событие: ${escapeHtml(notification.summary)}`,
      `Инициатор: <code>${escapeHtml(notification.actorEmail)}</code>`,
      notification.assigneeEmail ? `Ответственный: <code>${escapeHtml(notification.assigneeEmail)}</code>` : null,
      notification.eventBody ? `Комментарий: ${escapeHtml(notification.eventBody.slice(0, 400))}` : null,
      `<a href="${escapeHtml(buildAbsoluteAppUrl(notification.href))}">Открыть сигнал</a>`,
    ].filter(Boolean);

    try {
      await bot.api.sendMessage(tenant.telegramChatId, messageParts.join("\n"), {
        parse_mode: "HTML",
        link_preview_options: {
          is_disabled: true,
        },
      });
    } catch (error: unknown) {
      logger.error({ err: error, tenantId, signalId: notification.signalId }, "[Bot Service] Failed to send collaboration message");
    }
  }

  static async sendRedistributionDigest(
    tenantId: string,
    payload: {
      generatedAt: string;
      summary: {
        estimatedSavingsRub: number;
        currentKrpPct: number;
        simulatedKrpPct: number;
        transferUnits: number;
        recommendationCount: number;
      };
      recommendations: Array<{
        nmId: number;
        vendorCode: string | null;
        sizeName: string;
        fromWarehouse: string;
        toWarehouse: string;
        transferUnits: number;
      }>;
      csvFilePath?: string | null;
      csvFileName?: string | null;
    },
  ): Promise<{ sent: boolean; messageId: number | null; mode: "message" | "document"; error?: string }> {
    if (!bot) {
      logger.warn("[Bot Service] Bot not initialized (missing token)");
      return { sent: false, messageId: null, mode: "message", error: "bot_not_initialized" };
    }

    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
    });

    if (!tenant?.telegramChatId || !tenant.notificationsEnabled) {
      return { sent: false, messageId: null, mode: "message", error: "notifications_disabled" };
    }

    if (!payload.recommendations.length) {
      return { sent: false, messageId: null, mode: "message", error: "empty_recommendations" };
    }

    const formatRub = (value: number) => new Intl.NumberFormat("ru-RU", {
      maximumFractionDigits: 0,
    }).format(value);

    const generatedDateLabel = new Date(payload.generatedAt).toLocaleString("ru-RU", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "Europe/Moscow",
    });

    const recommendationLines = payload.recommendations
      .slice(0, 7)
      .map((recommendation, index) => {
        const skuLabel = recommendation.vendorCode
          ? `${escapeHtml(recommendation.vendorCode)} (<code>${recommendation.nmId}</code>)`
          : `NM <code>${recommendation.nmId}</code>`;
        return `${index + 1}. ${skuLabel}, р-р ${escapeHtml(recommendation.sizeName)}: <b>${recommendation.transferUnits} шт</b> ${escapeHtml(recommendation.fromWarehouse)} → ${escapeHtml(recommendation.toWarehouse)}`;
      });

    const message = [
      "🌅 <b>Утренний план перераспределения</b>",
      `Сформировано: <code>${escapeHtml(generatedDateLabel)}</code>`,
      `Рекомендации: <b>${payload.summary.recommendationCount}</b>, объём: <b>${payload.summary.transferUnits} шт</b>`,
      `КРП (факт): <code>${payload.summary.currentKrpPct.toFixed(2)}%</code> → <code>${payload.summary.simulatedKrpPct.toFixed(2)}%</code>`,
      `Потенциальная экономия: <b>${formatRub(payload.summary.estimatedSavingsRub)} ₽</b>`,
      "",
      "<b>Топ перемещений:</b>",
      ...recommendationLines,
      "",
      `<a href="${escapeHtml(buildAbsoluteAppUrl("/redistribution"))}">Открыть вкладку перераспределения</a>`,
    ].join("\n");

    try {
      if (payload.csvFilePath) {
        const caption = [
          "📄 <b>CSV заявок на перемещение</b>",
          `Рекомендации: <b>${payload.summary.recommendationCount}</b>, объём: <b>${payload.summary.transferUnits} шт</b>`,
          `Экономия: <b>${formatRub(payload.summary.estimatedSavingsRub)} ₽</b>`,
        ].join("\n");

        const document = new InputFile(payload.csvFilePath, payload.csvFileName ?? undefined);
        const response = await bot.api.sendDocument(tenant.telegramChatId, document, {
          caption,
          parse_mode: "HTML",
        });

        await bot.api.sendMessage(tenant.telegramChatId, message, {
          parse_mode: "HTML",
          link_preview_options: {
            is_disabled: true,
          },
        });

        return {
          sent: true,
          messageId: response.message_id,
          mode: "document",
        };
      }

      await bot.api.sendMessage(tenant.telegramChatId, message, {
        parse_mode: "HTML",
        link_preview_options: {
          is_disabled: true,
        },
      });
      return {
        sent: true,
        messageId: null,
        mode: "message",
      };
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      logger.error({ err: error, tenantId }, "[Bot Service] Failed to send redistribution digest");
      return {
        sent: false,
        messageId: null,
        mode: payload.csvFilePath ? "document" : "message",
        error: message,
      };
    }
  }
}
