import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const handleUpdate = vi.fn();
const init = vi.fn();
const markTelegramUpdate = vi.fn();

vi.mock("@/server/bot/service", () => ({
  bot: {
    init,
    handleUpdate,
  },
}));

vi.mock("@/lib/telegram-update-dedup", () => ({
  markTelegramUpdate,
}));

vi.mock("@/lib/rate-limit", () => ({
  withRateLimit: (handler: unknown) => handler,
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
  },
}));

describe("POST /api/bot", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "x".repeat(32));
    init.mockResolvedValue(undefined);
    markTelegramUpdate.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("acks Telegram before slow bot handling finishes", async () => {
    let resolveHandleUpdate: () => void = () => {};
    handleUpdate.mockReturnValue(new Promise<void>((resolve) => {
      resolveHandleUpdate = resolve;
    }));

    const { POST } = await import("./route");
    const request = new Request("http://localhost/api/bot", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": "x".repeat(32),
      },
      body: JSON.stringify({ update_id: 123, message: { text: "Статус" } }),
    });

    const response = await POST(request as never, {} as never);

    expect(response.status).toBe(200);
    expect(handleUpdate).not.toHaveBeenCalled();

    await vi.runOnlyPendingTimersAsync();
    expect(handleUpdate).toHaveBeenCalledWith({ update_id: 123, message: { text: "Статус" } });

    resolveHandleUpdate();
    await vi.runAllTimersAsync();
  });
});
