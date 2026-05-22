import { describe, expect, it } from "vitest";

import {
  toRedistributionHttpReadiness,
  type RedistributionHttpReadiness,
} from "./http-readiness";
import type { WbLkRefreshFlowCheckResult } from "@/server/wb/lk-refresh-flow";

function makeCheck(
  overrides: Partial<WbLkRefreshFlowCheckResult>,
): WbLkRefreshFlowCheckResult {
  return {
    tenantId: "tenant-1",
    status: "healthy",
    ok: true,
    checkedAt: "2026-05-19T10:00:00.000Z",
    code: "ok",
    message: "ok",
    rootVersion: "v1.93.1",
    tokenTtlSeconds: 300,
    tokenExpiresAt: "2026-05-19T10:05:00.000Z",
    authHttpStatus: 200,
    readOnlyHttpStatus: 200,
    ...overrides,
  };
}

describe("redistribution/http-readiness", () => {
  it("marks successful refresh-flow as ready", () => {
    const readiness = toRedistributionHttpReadiness(makeCheck({}));

    expect(readiness).toMatchObject<Partial<RedistributionHttpReadiness>>({
      status: "ready",
      ok: true,
      canUseHttp: true,
      nextAction: "continue",
      code: "ok",
      authHttpStatus: 200,
      readOnlyHttpStatus: 200,
    });
  });

  it("requires login when storageState is missing", () => {
    const readiness = toRedistributionHttpReadiness(makeCheck({
      status: "invalid",
      ok: false,
      code: "missing_storage_state",
      message: "WB ЛК storageState не сохранён.",
      rootVersion: null,
      tokenTtlSeconds: null,
      tokenExpiresAt: null,
      authHttpStatus: null,
      readOnlyHttpStatus: null,
    }));

    expect(readiness).toMatchObject<Partial<RedistributionHttpReadiness>>({
      status: "needs_login",
      ok: false,
      canUseHttp: false,
      nextAction: "reauth",
      code: "missing_storage_state",
    });
  });

  it("treats network failures as retryable warnings", () => {
    const readiness = toRedistributionHttpReadiness(makeCheck({
      status: "warning",
      ok: false,
      code: "auth_token_network_error",
      message: "fetch failed",
      tokenTtlSeconds: null,
      tokenExpiresAt: null,
      authHttpStatus: null,
      readOnlyHttpStatus: null,
    }));

    expect(readiness).toMatchObject<Partial<RedistributionHttpReadiness>>({
      status: "warning",
      ok: false,
      canUseHttp: false,
      nextAction: "retry_later",
      code: "auth_token_network_error",
    });
  });

  it("blocks HTTP flow on invalid auth/token or read-only probe response", () => {
    const readiness = toRedistributionHttpReadiness(makeCheck({
      status: "invalid",
      ok: false,
      code: "read_only_probe_failed",
      message: "WB LK read-only probe вернул HTTP 403.",
      tokenTtlSeconds: null,
      tokenExpiresAt: null,
      authHttpStatus: 200,
      readOnlyHttpStatus: 403,
    }));

    expect(readiness).toMatchObject<Partial<RedistributionHttpReadiness>>({
      status: "blocked",
      ok: false,
      canUseHttp: false,
      nextAction: "reauth",
      code: "read_only_probe_failed",
      authHttpStatus: 200,
      readOnlyHttpStatus: 403,
    });
  });
});
