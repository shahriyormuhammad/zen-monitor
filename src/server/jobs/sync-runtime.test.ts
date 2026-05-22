import { describe, expect, it } from "vitest";

import { WbApiError } from "@/lib/wb-api/client";
import {
  buildSyncRunSummary,
  formatSyncRunErrorMessage,
  resolveSyncRunStatus,
  runSyncSource,
} from "@/server/jobs/sync-runtime";

describe("runSyncSource", () => {
  it("marks timed out ads source as skipped with timeout metadata", async () => {
    const summary = await runSyncSource(
      "ads",
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { records: 1 };
      },
      { timeoutMs: 10 }
    );

    expect(summary.status).toBe("skipped");
    expect(summary.records).toBe(0);
    expect(summary.meta).toMatchObject({
      errorCategory: "network_error",
      operation: "ads",
      reason: "wb_temporary_unavailable",
    });
    expect(summary.meta?.shortMessage).toContain("Источник превысил лимит");
    expect(summary.meta?.fallbackError).toContain("[Sync] ads exceeded");
  });

  it("does not persist raw SQL parameters in source errors", async () => {
    const queryError = new Error(
      "Failed query: insert into raw_api_orders values ($1, $2)\nparams: customer-sensitive-data"
    );

    const summary = await runSyncSource("orders", async () => {
      throw queryError;
    });

    expect(summary.status).toBe("error");
    expect(summary.error).toBe("Ошибка БД: запрос синхронизации не выполнен");
    expect(summary.error).not.toContain("customer-sensitive-data");
  });

  it("marks WB 429 as a retryable source warning instead of a hard failure", async () => {
    const summary = await runSyncSource("orders", async () => {
      throw new WbApiError({
        message: "WB API getOrders failed with status 429",
        operation: "getOrders",
        status: 429,
        attempt: 1,
        retryable: true,
      });
    });

    expect(summary.status).toBe("error");
    expect(summary.meta).toMatchObject({
      errorCategory: "wb_rate_limited",
      statusCode: 429,
      reason: "wb_rate_limited",
      retryable: true,
      shortMessage: "WB временно ограничил источник, данные догрузим позже",
    });

    const syncSummary = buildSyncRunSummary([summary]);

    expect(resolveSyncRunStatus([summary])).toBe("completed_with_errors");
    expect(syncSummary.diagnosis).toMatchObject({
      kind: "wb_rate_limited",
      affectedSources: ["orders"],
    });
    expect(formatSyncRunErrorMessage(syncSummary)).toBe(
      "WB временно ограничил источник. Данные догрузим автоматически позже.",
    );
  });
});
