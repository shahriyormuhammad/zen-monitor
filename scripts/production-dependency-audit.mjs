#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import process from "node:process";

const attempts = Number.parseInt(process.env.NPM_AUDIT_ATTEMPTS ?? "3", 10);
const retryDelayMs = Number.parseInt(process.env.NPM_AUDIT_RETRY_DELAY_MS ?? "5000", 10);
const maxAttempts = Number.isFinite(attempts) && attempts > 0 ? attempts : 3;
const delayMs = Number.isFinite(retryDelayMs) && retryDelayMs >= 0 ? retryDelayMs : 5000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runAudit() {
  return spawnSync("npm", ["audit", "--omit=dev", "--audit-level=high"], {
    encoding: "utf8",
    stdio: "pipe",
  });
}

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  console.log(`[audit:production] attempt ${attempt}/${maxAttempts}`);
  const result = runAudit();

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.status === 0) {
    process.exit(0);
  }

  if (attempt < maxAttempts) {
    console.error(`[audit:production] attempt ${attempt} failed; retrying in ${delayMs}ms`);
    await sleep(delayMs);
  } else {
    process.exit(result.status ?? 1);
  }
}
