import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: [
        "src/lib/operator-signal-timeline.ts",
        "src/lib/signal-queue-utils.ts",
        "src/lib/errors.ts",
        "src/lib/auth/tenant-access.ts",
        "src/lib/api-response.ts",
        "src/lib/encryption.ts",
        "src/lib/rate-limit.ts",
        "src/lib/idempotency.ts",
      ],
    },
  },
});
