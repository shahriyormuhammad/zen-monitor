import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the db module
vi.mock("@/lib/db", () => ({
  db: {
    execute: vi.fn(),
  },
}));

// Mock logger
vi.mock("@/lib/logger", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

import { markTelegramUpdate } from "./telegram-update-dedup";
import { db } from "@/lib/db";

const mockExecute = vi.mocked(db.execute);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("markTelegramUpdate", () => {
  it("returns true when update_id is new (RETURNING returns 1 row)", async () => {
    // Simulate INSERT … RETURNING returning the inserted row
    mockExecute.mockResolvedValueOnce([{ update_id: 12345 }] as never);
    const result = await markTelegramUpdate(12345);
    expect(result).toBe(true);
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it("returns false when update_id is duplicate (RETURNING returns 0 rows)", async () => {
    // ON CONFLICT DO NOTHING → no row returned
    mockExecute.mockResolvedValueOnce([] as never);
    const result = await markTelegramUpdate(12345);
    expect(result).toBe(false);
  });

  it("returns false for empty result (treated as conflict)", async () => {
    mockExecute.mockResolvedValueOnce([] as never);
    const result = await markTelegramUpdate(99999);
    expect(result).toBe(false);
  });

  it("returns true and logs warning when DB throws (fail-open for availability)", async () => {
    mockExecute.mockRejectedValueOnce(new Error("DB connection lost"));
    const { logger } = await import("@/lib/logger");
    const result = await markTelegramUpdate(54321);
    expect(result).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ updateId: 54321 }),
      expect.stringContaining("markTelegramUpdate failed")
    );
  });
});
