#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import process from "node:process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function runStep(stepLabel, command, args, options = {}) {
  console.log(`[predeploy] ${stepLabel}`);
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
    ...options,
  });

  if (result.status !== 0) {
    const statusLabel = result.status ?? 1;
    throw new Error(`${stepLabel} failed with exit code ${statusLabel}`);
  }
}

try {
  runStep("release baseline", "node", ["scripts/release-baseline.mjs"]);
  runStep("runtime smoke", npmCommand, ["run", "smoke:operator:runtime"]);
  console.log("[predeploy] gate passed");
} catch (error) {
  console.error("[predeploy] gate failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
}
