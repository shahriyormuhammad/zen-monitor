#!/usr/bin/env node

import { spawn } from 'node:child_process';
import process from 'node:process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const inngestCliPackage = 'inngest-cli@1.18.0';
const runtimePort = Number.parseInt(process.env.PORT ?? '3000', 10);
const defaultAppBaseUrl = `http://127.0.0.1:${Number.isFinite(runtimePort) && runtimePort > 0 ? runtimePort : 3000}`;
const appBaseUrl = (process.env.INNGEST_APP_URL ?? process.env.SMOKE_BASE_URL ?? defaultAppBaseUrl).replace(/\/$/, '');
const appServeUrl = `${appBaseUrl}/api/inngest`;
const inngestBaseUrl = (process.env.INNGEST_BASE_URL ?? 'http://localhost:8288').replace(/\/$/, '');

function log(message) {
  console.log(`[dev:runtime] ${message}`);
}

async function waitForUrl(url, timeoutMs = 60_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);

      if (response.ok) {
        return;
      }
    } catch {
      // Retry until timeout.
    }

    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error(`Timed out waiting for ${url}`);
}

function killChild(child) {
  if (!child || child.exitCode !== null || child.killed) {
    return;
  }

  child.kill('SIGINT');
}

const nextDev = spawn(npmCommand, ['run', 'dev'], {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
});

let shuttingDown = false;
let inngestDev;

const shutdown = (code = 0) => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  killChild(inngestDev);
  killChild(nextDev);
  setTimeout(() => process.exit(code), 250).unref();
};

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

nextDev.on('exit', (code, signal) => {
  if (!shuttingDown) {
    log(`Next dev exited unexpectedly (${signal ?? code ?? 'unknown'}).`);
    shutdown(code ?? 1);
  }
});

try {
  log(`Waiting for app serve endpoint at ${appServeUrl}`);
  await waitForUrl(appServeUrl);

  log('Starting Inngest Dev Server');
  inngestDev = spawn(
    npxCommand,
    ['--yes', '--ignore-scripts=false', inngestCliPackage, 'dev', '--no-discovery', '-u', appServeUrl],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
    }
  );

  inngestDev.on('exit', (code, signal) => {
    if (!shuttingDown) {
      log(`Inngest Dev Server exited unexpectedly (${signal ?? code ?? 'unknown'}).`);
      shutdown(code ?? 1);
    }
  });

  log(`Waiting for Inngest Dev Server at ${inngestBaseUrl}`);
  await waitForUrl(inngestBaseUrl);

  log(`Runtime ready: app ${appBaseUrl}, Inngest ${inngestBaseUrl}`);
} catch (error) {
  console.error('[dev:runtime] Failed to start local runtime:', error);
  shutdown(1);
}
