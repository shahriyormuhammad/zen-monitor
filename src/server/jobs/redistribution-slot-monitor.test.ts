import { describe, expect, it, vi } from "vitest";

const mockRunSlotMonitorForAllTenants = vi.fn();

vi.mock("@/server/redistribution/slot-monitor", () => ({
  runSlotMonitorForAllTenants: (...args: unknown[]) => mockRunSlotMonitorForAllTenants(...args),
}));

vi.mock("@/inngest/client", () => ({
  inngest: {
    createFunction: (_opts: unknown, handler: unknown) => ({ _handler: handler }),
  },
}));

vi.mock("@/inngest/on-failure", () => ({
  handleInngestFailure: vi.fn(),
}));

import { isMinuteInWindow, resolveSlotMonitorWindow } from "./redistribution-slot-monitor";

const aggressiveWindows = [
  { startMinute: 8 * 60 + 40, endMinute: 10 * 60 + 30, label: "08:40-10:30" },
  { startMinute: 11 * 60 + 55, endMinute: 12 * 60 + 20, label: "11:55-12:20" },
  { startMinute: 15 * 60 + 55, endMinute: 16 * 60 + 20, label: "15:55-16:20" },
  { startMinute: 17 * 60 + 55, endMinute: 18 * 60 + 20, label: "17:55-18:20" },
];

describe("redistribution slot monitor windows", () => {
  it.each([
    [9 * 60, 0, "08:40-10:30"],
    [12 * 60 + 5, 5, "11:55-12:20"],
    [16 * 60, 0, "15:55-16:20"],
    [18 * 60 + 10, 10, "17:55-18:20"],
  ])("uses aggressive mode inside %s", (minuteOfDay, minute, label) => {
    expect(resolveSlotMonitorWindow(minuteOfDay, minute, aggressiveWindows)).toMatchObject({
      shouldRun: true,
      mode: "aggressive",
      intervalMin: 1,
      aggressiveWindow: label,
      matrixMaxNmPerTenant: 0,
      matrixMaxRoutesPerTenant: 0,
    });
  });

  it("skips background minutes outside the configured interval", () => {
    expect(resolveSlotMonitorWindow(10 * 60 + 31, 31, aggressiveWindows)).toMatchObject({
      shouldRun: false,
      mode: "background",
      intervalMin: 3,
      aggressiveWindow: null,
    });
  });

  it("runs background checks every 3 minutes outside aggressive windows", () => {
    expect(resolveSlotMonitorWindow(10 * 60 + 33, 33, aggressiveWindows)).toMatchObject({
      shouldRun: true,
      mode: "background",
      intervalMin: 3,
      aggressiveWindow: null,
      matrixMaxNmPerTenant: 1,
      matrixMaxRoutesPerTenant: 50,
    });
  });

  it("supports windows crossing midnight", () => {
    expect(isMinuteInWindow(23 * 60 + 30, 23 * 60, 1 * 60)).toBe(true);
    expect(isMinuteInWindow(30, 23 * 60, 1 * 60)).toBe(true);
    expect(isMinuteInWindow(2 * 60, 23 * 60, 1 * 60)).toBe(false);
  });
});
