import { inngest } from "@/inngest/client";
import { handleInngestFailure } from "@/inngest/on-failure";
import { db, withTenantContext } from "@/lib/db";
import { tenants } from "@/lib/db/schema";
import { decryptIfNeeded } from "@/lib/encryption";
import { logger } from "@/lib/logger";
import { wbApi } from "@/lib/wb-api";
import { WbApiError } from "@/lib/wb-api/client";
import { WB_TOKEN_PREFLIGHT_EVENT } from "@/server/wb-token-preflight-event";
import { eq } from "drizzle-orm";

type WbTokenPreflightCategory =
  | "ok"
  | "wb_token_invalid"
  | "wb_auth_failed"
  | "wb_upstream_error"
  | "network_error"
  | "unknown_error";

type WbTokenPreflightCheck = {
  key: "statistics" | "content" | "prices" | "ads";
  label: string;
  ok: boolean;
  category: WbTokenPreflightCategory;
  message: string;
  statusCode?: number;
};

type WbTokenPreflightResult = {
  ok: boolean;
  healthStatus: "healthy" | "warning" | "invalid";
  savePolicy: "pass" | "warning_required";
  source: "stored";
  checkedAt: string;
  title: string;
  message: string;
  checks: WbTokenPreflightCheck[];
};

function classifyTokenCheckError(error: unknown): Omit<WbTokenPreflightCheck, "key" | "label"> {
  if (error instanceof WbApiError) {
    const statusCode = error.status;

    if (statusCode === 401) {
      return {
        ok: false,
        category: "wb_token_invalid",
        statusCode,
        message: "WB отклонил токен.",
      };
    }

    if (statusCode === 403) {
      return {
        ok: false,
        category: "wb_auth_failed",
        statusCode,
        message: "У токена нет доступа к этому контуру.",
      };
    }

    if (typeof statusCode === "number" && (statusCode >= 500 || statusCode === 429)) {
      return {
        ok: false,
        category: "wb_upstream_error",
        statusCode,
        message: "WB API временно недоступен или ограничил частоту запросов.",
      };
    }

    return {
      ok: false,
      category: "unknown_error",
      statusCode,
      message: error.message || "WB API вернул ошибку.",
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  if (/fetch failed|ECONN|ETIMEDOUT|ENOTFOUND|network/i.test(message)) {
    return {
      ok: false,
      category: "network_error",
      message: "Не удалось достучаться до WB API.",
    };
  }

  return {
    ok: false,
    category: "unknown_error",
    message: "Проверка завершилась неизвестной ошибкой.",
  };
}

async function runTokenCheck(
  check: {
    key: WbTokenPreflightCheck["key"];
    label: WbTokenPreflightCheck["label"];
    run: () => Promise<unknown>;
  },
): Promise<WbTokenPreflightCheck> {
  try {
    await check.run();
    return {
      key: check.key,
      label: check.label,
      ok: true,
      category: "ok",
      message: "Контур доступен.",
    };
  } catch (error) {
    return {
      key: check.key,
      label: check.label,
      ...classifyTokenCheckError(error),
    };
  }
}

async function runStoredTokenPreflight(token: string): Promise<WbTokenPreflightResult> {
  const dateFrom = new Date().toISOString();
  const checks = await Promise.all([
    runTokenCheck({
      key: "statistics",
      label: "Statistics API",
      run: () => wbApi.getOrders(token, dateFrom, dateFrom),
    }),
    runTokenCheck({
      key: "content",
      label: "Content API",
      run: () => wbApi.getCardsListPage(token, { limit: 1 }),
    }),
    runTokenCheck({
      key: "prices",
      label: "Prices API",
      run: () => wbApi.getPrices(token, 1),
    }),
    runTokenCheck({
      key: "ads",
      label: "Advertising API",
      run: () => wbApi.getAdCampaigns(token),
    }),
  ]);

  const passedChecks = checks.filter((check) => check.ok).length;
  const totalChecks = checks.length;
  const allFailedWithInvalidToken = checks.every((check) => check.category === "wb_token_invalid");
  const allFailedWithAuth = checks.every((check) => check.category === "wb_auth_failed" || check.category === "wb_token_invalid");
  const checkedAt = new Date().toISOString();

  if (passedChecks === totalChecks) {
    return {
      ok: true,
      healthStatus: "healthy",
      savePolicy: "pass",
      source: "stored",
      checkedAt,
      title: "Сохранённый токен прошёл preflight",
      message: "Все ключевые контуры WB ответили без ошибок. Можно запускать синхронизацию.",
      checks,
    };
  }

  if (allFailedWithInvalidToken || allFailedWithAuth) {
    return {
      ok: false,
      healthStatus: "invalid",
      savePolicy: "warning_required",
      source: "stored",
      checkedAt,
      title: "WB API не авторизовал запросы",
      message: "Проверка не прошла ни по одному из ключевых контуров. Проверьте токен и его права доступа.",
      checks,
    };
  }

  return {
    ok: false,
    healthStatus: "warning",
    savePolicy: "warning_required",
    source: "stored",
    checkedAt,
    title: "Токен проходит preflight частично",
    message: `Из ${totalChecks} контуров WB ответили без ошибок только ${passedChecks}. Синхронизация может завершиться частично с ошибками.`,
    checks,
  };
}

export const wbTokenPreflightJob = inngest.createFunction(
  {
    id: "wb-token-preflight",
    name: "WB Token Preflight",
    concurrency: [{ limit: 1, key: "event.data.tenantId" }],
    onFailure: handleInngestFailure,
    triggers: [{ event: WB_TOKEN_PREFLIGHT_EVENT }],
  },
  async ({ event, step }) => {
    const tenantId = event.data.tenantId as string | undefined;
    if (!tenantId) {
      throw new Error("tenantId is required");
    }

    const tenant = await step.run("load-tenant-token", async () => {
      return db.query.tenants.findFirst({
        where: eq(tenants.id, tenantId),
      });
    });

    if (!tenant?.wbApiToken) {
      return { ok: false, tenantId, skipped: true, reason: "missing_token" };
    }

    const token = decryptIfNeeded(tenant.wbApiToken);
    const result = await step.run("run-token-preflight", async () => runStoredTokenPreflight(token));

    await step.run("persist-token-health", async () => {
      await withTenantContext(db, tenantId, async (tx) => {
        await tx.update(tenants)
          .set({
            wbTokenHealthStatus: result.healthStatus,
            wbTokenCheckedAt: new Date(result.checkedAt),
            wbTokenHealthSummary: result,
          })
          .where(eq(tenants.id, tenantId));
      });
    });

    logger.info({ tenantId, healthStatus: result.healthStatus }, "[WB Token] Background preflight completed");
    return { ok: result.ok, tenantId, healthStatus: result.healthStatus };
  },
);
