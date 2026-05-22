import { describe, expect, it } from "vitest";

import { buildSyncRunRecoveryPlan } from "@/server/jobs/wb-sync-recovery-plan";

const staleBefore = new Date("2026-05-13T10:00:00.000Z");
const requestedAt = new Date("2026-05-13T08:00:00.000Z");
const startedAt = new Date("2026-05-13T08:05:00.000Z");

describe("buildSyncRunRecoveryPlan", () => {
  it("resumes from the running source and preserves remaining requested order", () => {
    const plan = buildSyncRunRecoveryPlan({
      status: "running",
      triggerSource: "manual",
      requestedAt,
      startedAt,
      staleBefore,
      summary: {
        requestedSources: ["orders", "sales", "ads"],
        progress: {
          runningSource: "sales",
          updatedAt: "2026-05-13T09:00:00.000Z",
        },
        sources: [
          {
            source: "orders",
            status: "success",
            records: 10,
            batches: 1,
            startedAt: "2026-05-13T08:05:00.000Z",
            finishedAt: "2026-05-13T08:06:00.000Z",
          },
        ],
      },
    });

    expect(plan.shouldRecover).toBe(true);
    expect(plan.reason).toBe("resume_remaining_sources");
    expect(plan.remainingSources).toEqual(["sales", "ads"]);
    expect(plan.completedSources).toEqual(["orders"]);
  });

  it("does not recover an active run with a fresh heartbeat", () => {
    const plan = buildSyncRunRecoveryPlan({
      status: "running",
      triggerSource: "manual",
      requestedAt,
      startedAt,
      staleBefore,
      summary: {
        requestedSources: ["orders", "sales"],
        progress: {
          runningSource: "sales",
          updatedAt: "2026-05-13T10:05:00.000Z",
        },
        sources: [],
      },
    });

    expect(plan.shouldRecover).toBe(false);
    expect(plan.reason).toBe("heartbeat_fresh");
  });

  it("falls back to trigger-source sources when old summaries do not have requestedSources", () => {
    const plan = buildSyncRunRecoveryPlan({
      status: "running",
      triggerSource: "scheduled-medium-2h",
      requestedAt,
      startedAt,
      staleBefore,
      summary: {
        progress: {
          runningSource: "funnel",
          updatedAt: "2026-05-13T09:00:00.000Z",
        },
        sources: [
          {
            source: "stocks",
            status: "success",
            records: 5,
            batches: 1,
            startedAt: "2026-05-13T08:05:00.000Z",
            finishedAt: "2026-05-13T08:06:00.000Z",
          },
          {
            source: "stock_offices",
            status: "success",
            records: 5,
            batches: 1,
            startedAt: "2026-05-13T08:06:00.000Z",
            finishedAt: "2026-05-13T08:07:00.000Z",
          },
          {
            source: "prices",
            status: "success",
            records: 5,
            batches: 1,
            startedAt: "2026-05-13T08:07:00.000Z",
            finishedAt: "2026-05-13T08:08:00.000Z",
          },
        ],
      },
    });

    expect(plan.shouldRecover).toBe(true);
    expect(plan.remainingSources).toEqual(["funnel", "region_sales", "tariffs", "ads"]);
  });

  it("finalizes a stale run when all requested sources are already recorded", () => {
    const plan = buildSyncRunRecoveryPlan({
      status: "running",
      triggerSource: "manual",
      requestedAt,
      startedAt,
      staleBefore,
      summary: {
        requestedSources: ["orders"],
        progress: {
          updatedAt: "2026-05-13T09:00:00.000Z",
        },
        sources: [
          {
            source: "orders",
            status: "success",
            records: 10,
            batches: 1,
            startedAt: "2026-05-13T08:05:00.000Z",
            finishedAt: "2026-05-13T08:06:00.000Z",
          },
        ],
      },
    });

    expect(plan.shouldRecover).toBe(true);
    expect(plan.reason).toBe("finalize_completed_stale_run");
    expect(plan.remainingSources).toEqual([]);
  });

  it("resumes only requested sources for source retry runs", () => {
    const plan = buildSyncRunRecoveryPlan({
      status: "running",
      triggerSource: "scheduled-source-retry-1",
      requestedAt,
      startedAt,
      staleBefore,
      summary: {
        sourceRetry: {
          requestedSources: ["orders", "sales"],
        },
        progress: {
          runningSource: "orders",
          updatedAt: "2026-05-13T09:00:00.000Z",
        },
        sources: [],
      },
    });

    expect(plan.shouldRecover).toBe(true);
    expect(plan.remainingSources).toEqual(["orders", "sales"]);
  });
});
