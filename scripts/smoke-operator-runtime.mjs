#!/usr/bin/env node

import net from 'node:net';
import { spawn } from 'node:child_process';
import process from 'node:process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const inngestBaseUrl = (process.env.INNGEST_BASE_URL ?? 'http://localhost:8288').replace(/\/$/, '');

function log(message) {
  console.log(`[smoke:runtime] ${message}`);
}

function normalizeBaseUrl(value) {
  return value.replace(/\/$/, '');
}

function getExplicitRuntimeBaseUrl() {
  const explicit = process.env.SMOKE_BASE_URL ?? process.env.INNGEST_APP_URL;
  return explicit ? normalizeBaseUrl(explicit) : null;
}

function allocateFreePort(host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to allocate runtime port')));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function waitForUrl(url, timeoutMs = 90_000) {
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

function run(command, args, options = {}) {
  return spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
    ...options,
  });
}

function waitForExit(child) {
  return new Promise((resolve) => {
    child.on('exit', (code, signal) => resolve({ code, signal }));
  });
}

function stopChild(child) {
  if (!child || child.exitCode !== null || child.killed) {
    return;
  }

  child.kill('SIGINT');
}

const explicitRuntimeBaseUrl = getExplicitRuntimeBaseUrl();
const runtimePort = explicitRuntimeBaseUrl
  ? new URL(explicitRuntimeBaseUrl).port || (new URL(explicitRuntimeBaseUrl).protocol === 'https:' ? '443' : '80')
  : String(await allocateFreePort());
const appBaseUrl = explicitRuntimeBaseUrl ?? `http://127.0.0.1:${runtimePort}`;
const appServeUrl = `${appBaseUrl}/api/inngest`;

const runtime = run(npmCommand, ['run', 'dev:runtime'], {
  env: {
    ...process.env,
    PORT: runtimePort,
    SMOKE_BASE_URL: appBaseUrl,
    INNGEST_APP_URL: appBaseUrl,
  },
});

const shutdown = () => {
  stopChild(runtime);
};

process.on('SIGINT', () => {
  shutdown();
  process.exit(130);
});

process.on('SIGTERM', () => {
  shutdown();
  process.exit(143);
});

try {
  log(`Waiting for app endpoint at ${appServeUrl}`);
  await waitForUrl(appServeUrl);

  log(`Waiting for Inngest Dev Server at ${inngestBaseUrl}`);
  await waitForUrl(inngestBaseUrl);

  const smoke = run(npmCommand, ['run', 'smoke:operator'], {
    env: {
      ...process.env,
      PORT: runtimePort,
      SMOKE_BASE_URL: appBaseUrl,
      INNGEST_APP_URL: appBaseUrl,
      SMOKE_EXPECT_INNGEST_RUNTIME: '1',
    },
  });

  const result = await waitForExit(smoke);
  shutdown();

  if (result.code !== 0) {
    process.exit(result.code ?? 1);
  }
} catch (error) {
  console.error('[smoke:runtime] Runtime smoke failed:', error);
  shutdown();
  process.exit(1);
}
