#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

const now = new Date();
const stamp = now.toISOString().replaceAll(':', '-').replaceAll('.', '-');
const baseUrl = (process.env.SMOKE_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const authMode = process.env.SMOKE_AUTH_MODE ?? 'auto';
const defaultEmail = `codex-smoke+${stamp}-${randomUUID().slice(0, 8)}@example.com`;
const email = process.env.SMOKE_EMAIL ?? defaultEmail;
const usesGeneratedEmail = !process.env.SMOKE_EMAIL;
const password = process.env.SMOKE_PASSWORD ?? 'CodexSmoke123!';
const cabinetName = process.env.SMOKE_CABINET_NAME ?? `Codex Smoke ${stamp.slice(0, 16)}`;
const wbToken = process.env.SMOKE_WB_TOKEN ?? `smoke-token-${randomUUID().slice(0, 12)}`;
const headless = process.env.SMOKE_HEADLESS !== '0';
const triggerSync = process.env.SMOKE_TRIGGER_SYNC !== '0';
const expectInngestRuntime = process.env.SMOKE_EXPECT_INNGEST_RUNTIME === '1';
const terminalSyncStatuses = new Set(['Успешно', 'Частично с ошибками', 'Ошибка']);
const playwrightOutputRoot = path.join(process.cwd(), 'output', 'playwright');
const outputDir = path.join(playwrightOutputRoot, `operator-smoke-${stamp}`);
const playwrightSmokeRetentionDays = (() => {
  const parsed = Number.parseInt(process.env.PLAYWRIGHT_SMOKE_RETENTION_DAYS ?? '3', 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 3;
  }
  return Math.min(parsed, 30);
})();
const playwrightSmokeMaxDirs = (() => {
  const parsed = Number.parseInt(process.env.PLAYWRIGHT_SMOKE_MAX_DIRS ?? '20', 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 20;
  }
  return Math.min(parsed, 200);
})();

const knownOverviewStates = [
  'Операционный Дашборд',
  'Нет данных для дашборда',
  'Сначала подключите кабинет',
  'Не удалось собрать дашборд',
];

const knownOverviewTestStates = [
  'Тестовая Вкладка',
  'Нет данных для тестовой вкладки',
  'Сначала подключите кабинет',
  'Не удалось загрузить тестовую вкладку',
];

const knownEconomicsStates = [
  'Юнит-Экономика',
  'Пока нет данных по товарам',
  'Юнит-экономика недоступна без кабинета',
  'Не удалось загрузить юнит-экономику',
];

const report = {
  startedAt: now.toISOString(),
  baseUrl,
  authMode,
  email,
  cabinetName,
  triggerSync,
  expectInngestRuntime,
  outputDir,
  steps: [],
};

function log(message) {
  console.log(`[smoke:operator] ${message}`);
}

function record(step, data = {}) {
  report.steps.push({
    step,
    timestamp: new Date().toISOString(),
    ...data,
  });
}

async function saveReport(filename = 'report.json') {
  report.finishedAt = new Date().toISOString();
  await writeFile(path.join(outputDir, filename), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function cleanupPlaywrightArtifacts() {
  let dirents;
  try {
    dirents = await readdir(playwrightOutputRoot, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return;
    }
    throw error;
  }

  const nowMs = Date.now();
  const maxAgeMs = playwrightSmokeRetentionDays * 24 * 60 * 60 * 1000;
  const candidates = [];

  for (const dirent of dirents) {
    if (!dirent.isDirectory() || !/^operator-smoke-/i.test(dirent.name)) {
      continue;
    }
    const fullPath = path.join(playwrightOutputRoot, dirent.name);
    const info = await stat(fullPath).catch(() => null);
    if (!info) {
      continue;
    }
    candidates.push({
      fullPath,
      mtimeMs: info.mtimeMs,
    });
  }

  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs || left.fullPath.localeCompare(right.fullPath));

  let removed = 0;
  for (const [index, candidate] of candidates.entries()) {
    const overCountLimit = index >= playwrightSmokeMaxDirs;
    const isExpired = nowMs - candidate.mtimeMs > maxAgeMs;
    if (!overCountLimit && !isExpired) {
      continue;
    }
    await rm(candidate.fullPath, { recursive: true, force: true }).catch(() => undefined);
    removed += 1;
  }

  if (removed > 0) {
    log(`Removed ${removed} old Playwright artifact director${removed === 1 ? 'y' : 'ies'}`);
  }
}

async function capture(page, name) {
  await page.screenshot({
    path: path.join(outputDir, `${name}.png`),
    fullPage: true,
  });
}

async function waitForApp(page, timeout = 12_000) {
  try {
    await page.waitForURL(
      (url) => new URL(url).pathname !== '/login',
      { timeout }
    );
    await page.waitForLoadState('networkidle');
    return true;
  } catch {
    return false;
  }
}

async function readLoginMessage(page) {
  const locator = page.getByTestId('login-message');
  if (await locator.count()) {
    return (await locator.first().textContent())?.trim() ?? null;
  }

  return null;
}

async function openLogin(page) {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
}

async function fillCredentials(page) {
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
}

async function attemptLogin(page) {
  await openLogin(page);
  await fillCredentials(page);
  await page.getByTestId('login-submit').click();
  const ok = await waitForApp(page);
  const message = await readLoginMessage(page);
  record('login-attempt', { ok, message });
  return { ok, message };
}

async function attemptSignup(page) {
  await openLogin(page);
  await fillCredentials(page);
  await page.getByTestId('signup-submit').click();
  const ok = await waitForApp(page);
  const message = await readLoginMessage(page);
  record('signup-attempt', { ok, message });
  return { ok, message };
}

async function authenticate(page) {
  if (authMode === 'login' && !process.env.SMOKE_EMAIL) {
    throw new Error('SMOKE_EMAIL is required when SMOKE_AUTH_MODE=login');
  }

  if (authMode === 'login') {
    const result = await attemptLogin(page);
    if (!result.ok) {
      throw new Error(result.message ?? 'Login flow stayed on /login');
    }
    return;
  }

  if (authMode === 'signup') {
    const result = await attemptSignup(page);
    if (result.ok) {
      return;
    }
    if (result.message?.includes('Аккаунт создан')) {
      const fallback = await attemptLogin(page);
      if (fallback.ok) {
        return;
      }
      throw new Error(fallback.message ?? 'Signup completed but fallback login failed');
    }
    throw new Error(result.message ?? 'Signup flow stayed on /login');
  }

  if (usesGeneratedEmail) {
    const result = await attemptSignup(page);
    if (result.ok) {
      return;
    }

    if (result.message?.includes('Аккаунт создан')) {
      log('Signup requested an explicit login, retrying login with the same generated credentials');
      const fallback = await attemptLogin(page);
      if (fallback.ok) {
        return;
      }
      throw new Error(fallback.message ?? 'Generated-email signup completed but fallback login failed');
    }
  }

  const loginResult = await attemptLogin(page);
  if (loginResult.ok) {
    return;
  }

  log(`Login did not succeed (${loginResult.message ?? 'no message'}), trying signup`);
  const signupResult = await attemptSignup(page);
  if (signupResult.ok) {
    return;
  }

  if (signupResult.message?.includes('Аккаунт создан')) {
    log('Signup requested an explicit login, retrying login with the same credentials');
    const fallback = await attemptLogin(page);
    if (fallback.ok) {
      return;
    }
    throw new Error(fallback.message ?? 'Auto auth failed after signup + login fallback');
  }

  throw new Error(signupResult.message ?? 'Auto auth failed');
}

async function ensureCabinet(page) {
  const currentPath = new URL(page.url()).pathname;

  if (currentPath !== '/settings') {
    await page.goto(`${baseUrl}/settings`, { waitUntil: 'domcontentloaded' });
  }

  await page.waitForLoadState('networkidle');

  if (new URL(page.url()).pathname === '/login') {
    throw new Error('Settings redirected back to /login after authentication');
  }

  const syncTrigger = page.getByTestId('manual-sync-trigger');
  if (await syncTrigger.isVisible().catch(() => false)) {
    record('cabinet-ready', { created: false });
    return;
  }

  const currentTab = page.getByTestId('settings-tab-current');
  if (await currentTab.isVisible().catch(() => false)) {
    await currentTab.click();
    await page.waitForTimeout(500);
    if (await syncTrigger.isVisible().catch(() => false)) {
      record('cabinet-ready', { created: false, viaTabSwitch: true });
      return;
    }
  }

  const modalNameField = page.getByTestId('new-cabinet-name');
  const openButtons = [
    page.getByTestId('open-add-cabinet'),
    page.getByRole('button', { name: /Подключить магазин/i }),
  ];

  await capture(page, 'settings-before-cabinet-modal');

  let modalOpened = false;
  for (const button of openButtons) {
    if (!(await button.isVisible().catch(() => false))) {
      continue;
    }

    await button.scrollIntoViewIfNeeded().catch(() => undefined);
    await button.click().catch(async () => {
      await button.click({ force: true });
    });

    try {
      await modalNameField.waitFor({ state: 'visible', timeout: 3_000 });
      modalOpened = true;
      break;
    } catch {
      // Try the next entry point.
    }
  }

  if (!modalOpened) {
    await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll('button'));
      const target = candidates.find((button) => (
        button instanceof HTMLButtonElement
        && (
          button.dataset.testid === 'open-add-cabinet'
          || button.textContent?.includes('Подключить магазин')
        )
      ));

      if (target instanceof HTMLButtonElement) {
        target.click();
      }
    });

    try {
      await modalNameField.waitFor({ state: 'visible', timeout: 3_000 });
      modalOpened = true;
    } catch {
      // fall through to the final error below
    }
  }

  if (!modalOpened) {
    throw new Error('Cabinet onboarding modal did not open from settings');
  }

  await modalNameField.fill(cabinetName);
  await page.getByTestId('new-cabinet-token').fill(wbToken);
  await capture(page, 'settings-before-cabinet-activation');
  await page.getByTestId('activate-cabinet').click();

  const warningActivate = page.getByTestId('activate-cabinet-with-warning');
  try {
    await Promise.race([
      syncTrigger.waitFor({ state: 'visible', timeout: 15_000 }),
      warningActivate.waitFor({ state: 'visible', timeout: 15_000 }),
    ]);
  } catch {
    // handled by the final syncTrigger wait below if neither state appears
  }

  if (await warningActivate.isVisible().catch(() => false)) {
    record('cabinet-warning-confirmation', { required: true });
    await warningActivate.click();
    await syncTrigger.waitFor({ state: 'visible', timeout: 15_000 });
  }

  record('cabinet-ready', { created: true });
}

async function triggerManualSyncFlow(page) {
  if (!triggerSync) {
    record('manual-sync-skipped');
    return null;
  }

  const statusChip = page.getByTestId('latest-sync-status');
  const refreshButton = page.getByTestId('refresh-sync-status');

  await capture(page, 'settings-before-sync');
  await page.getByTestId('manual-sync-trigger').click();
  await page.waitForTimeout(1_500);

  const readStatus = async () => {
    if (await statusChip.count()) {
      return ((await statusChip.textContent()) ?? '').trim();
    }
    return null;
  };

  let status = await readStatus();
  const isHistoryReady = () => status && status !== 'Нет истории';

  const waitForStatus = async (predicate, timeout = 20_000) => {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeout) {
      await refreshButton.click();
      await page.waitForTimeout(1_500);
      status = await readStatus();

      if (predicate(status)) {
        return status;
      }
    }

    return status;
  };

  if (!isHistoryReady()) {
    await refreshButton.click();
    await page.waitForTimeout(1_500);
    status = await readStatus();
  }

  if (!isHistoryReady()) {
    try {
      await page.waitForFunction(
        () => {
          const el = document.querySelector('[data-testid="latest-sync-status"]');
          return Boolean(el?.textContent && !el.textContent.includes('Нет истории'));
        },
        undefined,
        { timeout: 20_000 }
      );
      status = await readStatus();
    } catch {
      status = await readStatus();
    }
  }

  const errorLocator = page.getByTestId('manual-sync-error');
  const syncError = await errorLocator.isVisible().catch(() => false)
    ? ((await errorLocator.textContent()) ?? '').trim()
    : null;

  if (expectInngestRuntime) {
    if (syncError) {
      throw new Error(`Manual sync failed before Inngest runtime pickup: ${syncError}`);
    }

    status = await waitForStatus(
      (value) => Boolean(value && value !== 'Нет истории' && value !== 'В очереди'),
      30_000
    );

    status = await waitForStatus(
      (value) => Boolean(value && terminalSyncStatuses.has(value)),
      45_000
    );
  }

  await capture(page, 'settings-after-sync');

  if (expectInngestRuntime && (!status || !terminalSyncStatuses.has(status))) {
    throw new Error(`Manual sync did not reach a terminal sync status. Last visible status: ${status ?? 'none'}`);
  }

  if (!isHistoryReady() && !syncError) {
    throw new Error('Manual sync did not produce a visible sync status or UI error');
  }

  record('manual-sync-finished', { status, syncError });
  return { status, syncError };
}

async function resolveKnownState(page, values, label) {
  for (const value of values) {
    const locator = page.getByText(value, { exact: true });
    if (await locator.first().isVisible().catch(() => false)) {
      record(label, { state: value });
      return value;
    }
  }

  throw new Error(`Unable to resolve known state for ${label}`);
}

async function inspectDashboardRoute(page, route, values, label, screenshotName, options = {}) {
  const { expectFreshnessBanner = false } = options;

  await page.goto(`${baseUrl}${route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1_000);

  if (expectFreshnessBanner) {
    await page.getByTestId('data-freshness-banner').waitFor({ state: 'visible', timeout: 10_000 });
  }

  const state = await resolveKnownState(page, values, label);
  await capture(page, screenshotName);
  return state;
}

async function inspectSignalsDrillDown(page) {
  const trigger = page.getByTestId('signal-details-trigger').first();
  const triggerVisible = await trigger.isVisible().catch(() => false);

  if (!triggerVisible) {
    record('signals-drilldown-check', { state: 'skipped-no-signals' });
    return 'skipped-no-signals';
  }

  await trigger.click();
  await page.getByTestId('signal-details-drawer').waitFor({ state: 'visible', timeout: 10_000 });

  const content = page.getByTestId('signal-details-content');
  const error = page.getByTestId('signal-details-error');

  await Promise.race([
    content.waitFor({ state: 'visible', timeout: 15_000 }),
    error.waitFor({ state: 'visible', timeout: 15_000 }),
  ]);

  if (await error.isVisible().catch(() => false)) {
    const message = (await error.textContent())?.trim() ?? 'Signal details rendered an error state';
    throw new Error(message);
  }

  await capture(page, 'overview-signal-details');
  record('signals-drilldown-check', { state: 'opened' });

  const recommendationLink = page.getByTestId('signal-recommendation-link').first();
  const recommendationVisible = await recommendationLink.isVisible().catch(() => false);

  if (!recommendationVisible) {
    await page.getByTestId('signal-details-close').click();
    await page.getByTestId('signal-details-drawer').waitFor({ state: 'hidden', timeout: 10_000 });
    record('signals-followup-check', { state: 'skipped-no-link' });
    return 'opened';
  }

  const href = await recommendationLink.getAttribute('href');
  await recommendationLink.click();
  await page.waitForLoadState('networkidle');

  const pathname = new URL(page.url()).pathname;
  const focusBanner = page.getByTestId('signal-focus-banner');

  if (pathname === '/economics' || pathname === '/explorer') {
    await focusBanner.waitFor({ state: 'visible', timeout: 10_000 });
    await capture(page, `signal-followup-${pathname.replace('/', '')}`);
    record('signals-followup-check', {
      state: 'opened-focused-target',
      target: pathname,
      href,
    });
  } else {
    record('signals-followup-check', {
      state: 'opened-generic-target',
      target: pathname,
      href,
    });
  }

  return 'opened';
}

async function main() {
  await cleanupPlaywrightArtifacts();
  await mkdir(outputDir, { recursive: true });

  let browser;
  let context;

  try {
    log(`Starting operator smoke flow against ${baseUrl}`);
    browser = await chromium.launch({ headless });
    context = await browser.newContext({
      viewport: { width: 1440, height: 1024 },
    });
    await context.tracing.start({ screenshots: true, snapshots: true });
    const page = await context.newPage();

    await authenticate(page);
    await capture(page, 'post-auth');
    record('authenticated', { url: page.url() });

    await ensureCabinet(page);
    const manualSync = await triggerManualSyncFlow(page);
    const overviewState = await inspectDashboardRoute(
      page,
      '/overview',
      knownOverviewStates,
      'overview-check',
      'overview',
      { expectFreshnessBanner: true }
    );
    const overviewTestState = await inspectDashboardRoute(
      page,
      '/overview-test',
      knownOverviewTestStates,
      'overview-test-check',
      'overview-test',
      { expectFreshnessBanner: true }
    );
    const signalsDrilldown = await inspectSignalsDrillDown(page);
    const economicsState = await inspectDashboardRoute(
      page,
      '/economics',
      knownEconomicsStates,
      'economics-check',
      'economics',
      { expectFreshnessBanner: true }
    );

    report.result = {
      success: true,
      manualSync,
      overviewState,
      overviewTestState,
      signalsDrilldown,
      economicsState,
    };

    await context.tracing.stop({ path: path.join(outputDir, 'trace.zip') });
    await saveReport();
    log(`Smoke flow passed. Report: ${path.join(outputDir, 'report.json')}`);
  } catch (error) {
    report.result = {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };

    if (context) {
      try {
        await context.tracing.stop({ path: path.join(outputDir, 'trace.zip') });
      } catch {
        // ignore trace shutdown errors after a launch/runtime failure
      }
    }

    await saveReport('report.failure.json');
    if (error instanceof Error && /Executable doesn't exist|browserType\.launch/.test(error.message)) {
      console.error('[smoke:operator] Playwright browser is not installed. Run `npx playwright install chromium` and try again.');
    }
    console.error(`[smoke:operator] ${report.result.error}`);
    process.exitCode = 1;
  } finally {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}

await main();
