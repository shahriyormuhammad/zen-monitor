import { inngest } from "@/inngest/client";
import { handleInngestFailure } from "@/inngest/on-failure";
import { runSlotMonitorForAllTenants } from "@/server/redistribution/slot-monitor";

const REDISTRIBUTION_SLOT_MONITOR_TICK_CRON = process.env.REDISTRIBUTION_SLOT_MONITOR_TICK_CRON?.trim() || "* * * * *";

const SLOT_MONITOR_AUTO_SUBMIT = process.env.REDISTRIBUTION_SLOT_MONITOR_AUTO_SUBMIT !== "false";
const DEFAULT_AGGRESSIVE_WINDOWS_MSK = "08:40-10:30,11:55-12:20,15:55-16:20,17:55-18:20";

function parseBoundedInt(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, min), max);
}

function parseMskTimeToMinutes(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }
  const match = value.trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!match) {
    return fallback;
  }
  const hours = Number.parseInt(match[1]!, 10);
  const minutes = Number.parseInt(match[2]!, 10);
  return hours * 60 + minutes;
}

function minutesToMskTime(value: number) {
  const safeValue = Math.min(Math.max(value, 0), 23 * 60 + 59);
  return `${String(Math.floor(safeValue / 60)).padStart(2, "0")}:${String(safeValue % 60).padStart(2, "0")}`;
}

type SlotMonitorAggressiveWindow = {
  startMinute: number;
  endMinute: number;
  label: string;
};

function parseAggressiveWindowSpec(value: string | undefined): SlotMonitorAggressiveWindow[] {
  const rawValue = value?.trim();
  if (!rawValue) {
    return [];
  }

  const windows: SlotMonitorAggressiveWindow[] = [];
  for (const rawPart of rawValue.split(",")) {
    const part = rawPart.trim();
    const match = part.match(/^([01]?\d|2[0-3]):([0-5]\d)-([01]?\d|2[0-3]):([0-5]\d)$/);
    if (!match) {
      continue;
    }

    const startMinute = Number.parseInt(match[1]!, 10) * 60 + Number.parseInt(match[2]!, 10);
    const endMinute = Number.parseInt(match[3]!, 10) * 60 + Number.parseInt(match[4]!, 10);
    windows.push({
      startMinute,
      endMinute,
      label: `${minutesToMskTime(startMinute)}-${minutesToMskTime(endMinute)}`,
    });
  }

  return windows;
}

function resolveAggressiveWindows() {
  const configuredWindows = parseAggressiveWindowSpec(process.env.REDISTRIBUTION_SLOT_MONITOR_AGGRESSIVE_WINDOWS_MSK);
  if (configuredWindows.length > 0) {
    return configuredWindows;
  }

  if (
    process.env.REDISTRIBUTION_SLOT_MONITOR_AGGRESSIVE_START_MSK
    || process.env.REDISTRIBUTION_SLOT_MONITOR_AGGRESSIVE_END_MSK
  ) {
    const startMinute = parseMskTimeToMinutes(
      process.env.REDISTRIBUTION_SLOT_MONITOR_AGGRESSIVE_START_MSK,
      8 * 60 + 55,
    );
    const endMinute = parseMskTimeToMinutes(
      process.env.REDISTRIBUTION_SLOT_MONITOR_AGGRESSIVE_END_MSK,
      10 * 60 + 30,
    );
    return [{
      startMinute,
      endMinute,
      label: `${minutesToMskTime(startMinute)}-${minutesToMskTime(endMinute)}`,
    }];
  }

  return parseAggressiveWindowSpec(DEFAULT_AGGRESSIVE_WINDOWS_MSK);
}

const SLOT_MONITOR_AGGRESSIVE_WINDOWS = resolveAggressiveWindows();

const SLOT_MONITOR_BACKGROUND_INTERVAL_MIN = parseBoundedInt(
  process.env.REDISTRIBUTION_SLOT_MONITOR_BACKGROUND_INTERVAL_MIN,
  3,
  1,
  60,
);
const SLOT_MONITOR_MAX_ROUTES_PER_TENANT_AGGRESSIVE = parseBoundedInt(
  process.env.REDISTRIBUTION_SLOT_MONITOR_MAX_ROUTES_PER_TENANT_AGGRESSIVE,
  24,
  1,
  60,
);
const SLOT_MONITOR_MAX_ROUTES_PER_TENANT_BACKGROUND = parseBoundedInt(
  process.env.REDISTRIBUTION_SLOT_MONITOR_MAX_ROUTES_PER_TENANT_BACKGROUND
    ?? process.env.REDISTRIBUTION_SLOT_MONITOR_MAX_ROUTES_PER_TENANT,
  8,
  1,
  60,
);
const SLOT_MONITOR_MATRIX_MAX_NM_PER_TENANT_AGGRESSIVE = parseBoundedInt(
  process.env.REDISTRIBUTION_SLOT_MONITOR_MATRIX_MAX_NM_PER_TENANT_AGGRESSIVE,
  0,
  0,
  25,
);
const SLOT_MONITOR_MATRIX_MAX_NM_PER_TENANT_BACKGROUND = parseBoundedInt(
  process.env.REDISTRIBUTION_SLOT_MONITOR_MATRIX_MAX_NM_PER_TENANT_BACKGROUND
    ?? process.env.REDISTRIBUTION_SLOT_MONITOR_MATRIX_MAX_NM_PER_TENANT,
  1,
  0,
  25,
);
const SLOT_MONITOR_MATRIX_MAX_ROUTES_PER_TENANT_AGGRESSIVE = parseBoundedInt(
  process.env.REDISTRIBUTION_SLOT_MONITOR_MATRIX_MAX_ROUTES_PER_TENANT_AGGRESSIVE,
  0,
  0,
  1500,
);
const SLOT_MONITOR_MATRIX_MAX_ROUTES_PER_TENANT_BACKGROUND = parseBoundedInt(
  process.env.REDISTRIBUTION_SLOT_MONITOR_MATRIX_MAX_ROUTES_PER_TENANT_BACKGROUND
    ?? process.env.REDISTRIBUTION_SLOT_MONITOR_MATRIX_MAX_ROUTES_PER_TENANT,
  50,
  0,
  1500,
);

function getMoscowTimeSnapshot(value = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Moscow",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(value);
  const hour = Number.parseInt(parts.find((part) => part.type === "hour")?.value ?? "0", 10);
  const minute = Number.parseInt(parts.find((part) => part.type === "minute")?.value ?? "0", 10);

  const safeHour = Number.isFinite(hour) ? hour : 0;
  const safeMinute = Number.isFinite(minute) ? minute : 0;
  return {
    hour: safeHour,
    minute: safeMinute,
    minuteOfDay: safeHour * 60 + safeMinute,
  };
}

export function isMinuteInWindow(minuteOfDay: number, startMinute: number, endMinute: number) {
  if (startMinute <= endMinute) {
    return minuteOfDay >= startMinute && minuteOfDay <= endMinute;
  }
  return minuteOfDay >= startMinute || minuteOfDay <= endMinute;
}

export function resolveSlotMonitorWindow(
  minuteOfDay: number,
  minute: number,
  aggressiveWindows = SLOT_MONITOR_AGGRESSIVE_WINDOWS,
) {
  const activeAggressiveWindow = aggressiveWindows.find((window) =>
    isMinuteInWindow(minuteOfDay, window.startMinute, window.endMinute),
  );

  if (activeAggressiveWindow) {
    return {
      shouldRun: true,
      mode: "aggressive" as const,
      maxRoutesPerTenant: SLOT_MONITOR_MAX_ROUTES_PER_TENANT_AGGRESSIVE,
      matrixMaxNmPerTenant: SLOT_MONITOR_MATRIX_MAX_NM_PER_TENANT_AGGRESSIVE,
      matrixMaxRoutesPerTenant: SLOT_MONITOR_MATRIX_MAX_ROUTES_PER_TENANT_AGGRESSIVE,
      intervalMin: 1,
      aggressiveWindow: activeAggressiveWindow.label,
    };
  }

  const shouldRunBackground = minute % SLOT_MONITOR_BACKGROUND_INTERVAL_MIN === 0;
  return {
    shouldRun: shouldRunBackground,
    mode: "background" as const,
    maxRoutesPerTenant: SLOT_MONITOR_MAX_ROUTES_PER_TENANT_BACKGROUND,
    matrixMaxNmPerTenant: SLOT_MONITOR_MATRIX_MAX_NM_PER_TENANT_BACKGROUND,
    matrixMaxRoutesPerTenant: SLOT_MONITOR_MATRIX_MAX_ROUTES_PER_TENANT_BACKGROUND,
    intervalMin: SLOT_MONITOR_BACKGROUND_INTERVAL_MIN,
    aggressiveWindow: null,
  };
}

export const redistributionSlotMonitorJob = inngest.createFunction(
  {
    id: "redistribution-slot-monitor-window",
    name: "Redistribution Slot Monitor Window",
    concurrency: { limit: 1 },
    onFailure: handleInngestFailure,
    triggers: [{ cron: REDISTRIBUTION_SLOT_MONITOR_TICK_CRON }],
  },
  async ({ step }) => {
    const moscowTime = getMoscowTimeSnapshot();
    const slotMonitorWindow = resolveSlotMonitorWindow(moscowTime.minuteOfDay, moscowTime.minute);

    if (!slotMonitorWindow.shouldRun) {
      return {
        cron: REDISTRIBUTION_SLOT_MONITOR_TICK_CRON,
        mode: slotMonitorWindow.mode,
        skipped: true,
        reason: "background_interval_gate",
        moscowTime: `${String(moscowTime.hour).padStart(2, "0")}:${String(moscowTime.minute).padStart(2, "0")}`,
        backgroundIntervalMin: SLOT_MONITOR_BACKGROUND_INTERVAL_MIN,
        matrixMaxNmPerTenant: slotMonitorWindow.matrixMaxNmPerTenant,
        matrixMaxRoutesPerTenant: slotMonitorWindow.matrixMaxRoutesPerTenant,
        aggressiveWindowsMsk: SLOT_MONITOR_AGGRESSIVE_WINDOWS.map((window) => window.label),
      };
    }

    const result = await step.run("redistribution-slot-monitor-all-tenants", async () => {
      return runSlotMonitorForAllTenants({
        maxRoutesPerTenant: slotMonitorWindow.maxRoutesPerTenant,
        autoSubmit: SLOT_MONITOR_AUTO_SUBMIT,
        triggerSource: "scheduler",
        monitorMode: slotMonitorWindow.mode,
        matrixMaxNmPerTenant: slotMonitorWindow.matrixMaxNmPerTenant,
        matrixMaxRoutesPerTenant: slotMonitorWindow.matrixMaxRoutesPerTenant,
      });
    });

    return {
      cron: REDISTRIBUTION_SLOT_MONITOR_TICK_CRON,
      mode: slotMonitorWindow.mode,
      intervalMin: slotMonitorWindow.intervalMin,
      aggressiveWindow: slotMonitorWindow.aggressiveWindow,
      aggressiveWindowsMsk: SLOT_MONITOR_AGGRESSIVE_WINDOWS.map((window) => window.label),
      moscowTime: `${String(moscowTime.hour).padStart(2, "0")}:${String(moscowTime.minute).padStart(2, "0")}`,
      autoSubmit: SLOT_MONITOR_AUTO_SUBMIT,
      maxRoutesPerTenant: slotMonitorWindow.maxRoutesPerTenant,
      matrixMaxNmPerTenant: slotMonitorWindow.matrixMaxNmPerTenant,
      matrixMaxRoutesPerTenant: slotMonitorWindow.matrixMaxRoutesPerTenant,
      ...result,
    };
  },
);
