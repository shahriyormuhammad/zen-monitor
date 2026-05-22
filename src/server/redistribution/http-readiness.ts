import {
  checkTenantWbLkRefreshFlow,
  type WbLkRefreshFlowCheckResult,
} from "@/server/wb/lk-refresh-flow";

export type RedistributionHttpReadinessStatus = "ready" | "needs_login" | "warning" | "blocked";
export type RedistributionHttpReadinessNextAction = "continue" | "reauth" | "retry_later" | "inspect";

export type RedistributionHttpReadiness = {
  tenantId: string;
  checkedAt: string;
  status: RedistributionHttpReadinessStatus;
  ok: boolean;
  canUseHttp: boolean;
  nextAction: RedistributionHttpReadinessNextAction;
  code: string;
  message: string;
  rootVersion: string | null;
  tokenTtlSeconds: number | null;
  tokenExpiresAt: string | null;
  authHttpStatus: number | null;
  readOnlyHttpStatus: number | null;
};

const LOGIN_REQUIRED_CODES = new Set([
  "missing_storage_state",
  "storage_decrypt_failed",
  "missing_authorizev3",
  "missing_modern_cookies",
  "missing_cookies",
]);

const RETRY_LATER_CODES = new Set([
  "auth_token_network_error",
  "read_only_probe_network_error",
]);

export function toRedistributionHttpReadiness(
  check: WbLkRefreshFlowCheckResult,
): RedistributionHttpReadiness {
  if (check.ok) {
    return {
      tenantId: check.tenantId,
      checkedAt: check.checkedAt,
      status: "ready",
      ok: true,
      canUseHttp: true,
      nextAction: "continue",
      code: check.code,
      message: "HTTP-контур WB ЛК готов: auth/token и read-only probe прошли.",
      rootVersion: check.rootVersion,
      tokenTtlSeconds: check.tokenTtlSeconds,
      tokenExpiresAt: check.tokenExpiresAt,
      authHttpStatus: check.authHttpStatus,
      readOnlyHttpStatus: check.readOnlyHttpStatus,
    };
  }

  if (LOGIN_REQUIRED_CODES.has(check.code)) {
    return {
      tenantId: check.tenantId,
      checkedAt: check.checkedAt,
      status: "needs_login",
      ok: false,
      canUseHttp: false,
      nextAction: "reauth",
      code: check.code,
      message: `Нужен повторный вход в WB ЛК: ${check.message}`,
      rootVersion: check.rootVersion,
      tokenTtlSeconds: null,
      tokenExpiresAt: null,
      authHttpStatus: check.authHttpStatus,
      readOnlyHttpStatus: check.readOnlyHttpStatus,
    };
  }

  if (RETRY_LATER_CODES.has(check.code)) {
    return {
      tenantId: check.tenantId,
      checkedAt: check.checkedAt,
      status: "warning",
      ok: false,
      canUseHttp: false,
      nextAction: "retry_later",
      code: check.code,
      message: `WB ЛК временно не подтвердил HTTP-доступ: ${check.message}`,
      rootVersion: check.rootVersion,
      tokenTtlSeconds: null,
      tokenExpiresAt: null,
      authHttpStatus: check.authHttpStatus,
      readOnlyHttpStatus: check.readOnlyHttpStatus,
    };
  }

  const needsReauth = check.status === "invalid";
  return {
    tenantId: check.tenantId,
    checkedAt: check.checkedAt,
    status: needsReauth ? "blocked" : "warning",
    ok: false,
    canUseHttp: false,
    nextAction: needsReauth ? "reauth" : "inspect",
    code: check.code,
    message: needsReauth
      ? `HTTP-контур WB ЛК заблокирован: ${check.message}`
      : `HTTP-контур WB ЛК требует проверки: ${check.message}`,
    rootVersion: check.rootVersion,
    tokenTtlSeconds: null,
    tokenExpiresAt: null,
    authHttpStatus: check.authHttpStatus,
    readOnlyHttpStatus: check.readOnlyHttpStatus,
  };
}

export async function checkRedistributionHttpReadiness(
  tenantId: string,
  options?: {
    persistHealth?: boolean;
    timeoutMs?: number;
  },
): Promise<RedistributionHttpReadiness> {
  const check = await checkTenantWbLkRefreshFlow(tenantId, {
    persistHealth: options?.persistHealth ?? false,
    timeoutMs: options?.timeoutMs,
  });
  return toRedistributionHttpReadiness(check);
}
