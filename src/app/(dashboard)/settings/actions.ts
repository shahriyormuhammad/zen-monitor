'use server';


import { db, type DrizzleTransaction, withAdminContext, withTenantContext } from '@/lib/db';
import { plans, platformAuditLog, platformImpersonationSessions, subscriptions, telegramChatLinks, telegramLinkTokens, tenants, users, userTenants } from '@/lib/db/schema';
import { and, desc, eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { randomBytes } from 'node:crypto';
import { inngest } from '@/inngest/client';
import { invalidateDashboardCache } from '@/lib/analytics/dashboard-cache';
import { decryptIfNeeded, encrypt } from '@/lib/encryption';
import { logger } from '@/lib/logger';
import { normalizeProductVisibilityNmIds, setProductsVisibility } from '@/server/products/visibility';
import {
  requireAuthenticatedUser,
  requireTenantAccess,
  setActiveTenantCookie,
} from '@/lib/auth/tenant-access';
import { getActivePlatformImpersonationSessionForUser } from '@/lib/auth/platform-impersonation-session';
import { ensureLocalUserProfile } from '@/lib/auth/user-bootstrap';
import { markLeadTrialStarted } from '@/lib/leads';
import {
  DEFAULT_SIGNAL_NOTIFICATION_PREFERENCES,
  resolveSignalNotificationPreferences,
  type SignalNotificationPreferences,
} from '@/lib/operator-signal-timeline';
import { ALL_TENANT_FEATURE_PERMISSIONS, resolveTenantFeaturePermissions } from '@/lib/auth/feature-access';
import { hashTelegramLinkToken } from '@/lib/telegram-link-token';
import { normalizeVatMode, normalizeWbTaxType, resolveTaxRatePercent, resolveVatRatePercent } from '@/lib/tax/regimes';
import { wbApi } from '@/lib/wb-api';
import { WbApiError } from '@/lib/wb-api/client';
import { buildWbRedistributionUrlCandidates } from '@/lib/wb-rpa/redistribution-target';
import { WB_TOKEN_PREFLIGHT_EVENT } from '@/server/wb-token-preflight-event';
import {
  loadStorageStateSession,
  persistStorageStateFromContext,
  type StorageStateSession,
} from '@/lib/wb-rpa/storage-state';
import { triggerInitialWbSync } from './sync-action';
import { chromium, type Browser, type Page } from 'playwright';

type WbTokenPreflightCategory =
  | 'ok'
  | 'missing_token'
  | 'wb_token_invalid'
  | 'wb_auth_failed'
  | 'wb_upstream_error'
  | 'network_error'
  | 'unknown_error';

export type WbTokenHealthStatus = 'unknown' | 'healthy' | 'warning' | 'invalid';
export type WbTokenSavePolicy = 'pass' | 'warning_required' | 'missing_token';
export type WbLkSessionStatus = 'unknown' | 'healthy' | 'warning' | 'invalid';

export type WbTokenPreflightCheck = {
  key: 'statistics' | 'content' | 'prices' | 'ads';
  label: string;
  ok: boolean;
  category: WbTokenPreflightCategory;
  message: string;
  statusCode?: number;
};

export type StoredWbTokenHealth = {
  status: WbTokenHealthStatus;
  source: 'stored';
  checkedAt: string;
  ok: boolean;
  savePolicy: WbTokenSavePolicy;
  title: string;
  message: string;
  checks: WbTokenPreflightCheck[];
};

export type WbTokenPreflightResult = {
  ok: boolean;
  healthStatus: WbTokenHealthStatus;
  savePolicy: WbTokenSavePolicy;
  source: 'draft' | 'stored';
  checkedAt: string;
  title: string;
  message: string;
  checks: WbTokenPreflightCheck[];
  persistedHealth?: StoredWbTokenHealth;
};

export type SaveApiTokenResult = {
  saved: boolean;
  requiresWarning: boolean;
  title: string;
  message: string;
  preflight: WbTokenPreflightResult;
  storedHealth?: StoredWbTokenHealth;
};

export type TelegramLinkState = {
  chatId: number;
  chatType: string;
  telegramUserId: number | null;
  telegramUsername: string | null;
  createdAt: string;
};

export type TelegramLinkTokenResult = {
  token: string;
  startParameter: string;
  deepLinkUrl: string | null;
  expiresAt: string;
  botUsernameConfigured: boolean;
};

function getTelegramBotUsername() {
  const normalized = process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, '');
  return normalized || null;
}

export type AddCabinetResult =
  | {
      created: false;
      requiresWarning: boolean;
      title: string;
      message: string;
      preflight: WbTokenPreflightResult;
    }
  | {
      created: true;
      success: true;
      tenantId: string;
      role: 'owner';
      featurePermissions: ReturnType<typeof resolveTenantFeaturePermissions>;
      storedHealth: StoredWbTokenHealth;
      subscription: OnboardingSubscriptionState;
    };

export type SignalNotificationSettings = {
  inApp: SignalNotificationPreferences;
  telegram: SignalNotificationPreferences;
};

type OnboardingSubscriptionState = {
  id: string;
  status: string;
  planCode: string;
  planName: string;
  trialEndsAt: string;
};

const DEFAULT_ONBOARDING_PLAN_CODE = 'growth';
const DEFAULT_ONBOARDING_TRIAL_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const TELEGRAM_LINK_TOKEN_TTL_MS = 15 * 60 * 1000;

function getOnboardingPlanCode() {
  return process.env.ONBOARDING_DEFAULT_PLAN_CODE?.trim() || DEFAULT_ONBOARDING_PLAN_CODE;
}

function getOnboardingTrialDays() {
  const rawValue = Number.parseInt(process.env.ONBOARDING_TRIAL_DAYS ?? '', 10);
  return Number.isFinite(rawValue) && rawValue > 0 ? rawValue : DEFAULT_ONBOARDING_TRIAL_DAYS;
}

async function createOnboardingTrialSubscription(
  tx: DrizzleTransaction,
  tenantId: string,
  selectedPlanCode?: string,
): Promise<OnboardingSubscriptionState> {
  const planCode = selectedPlanCode?.trim() || getOnboardingPlanCode();
  const trialEndsAt = new Date(Date.now() + getOnboardingTrialDays() * DAY_MS);

  const [plan] = await tx.select({
    id: plans.id,
    code: plans.code,
    name: plans.name,
  })
    .from(plans)
    .where(and(eq(plans.code, planCode), eq(plans.isActive, true)))
    .limit(1);

  if (!plan) {
    throw new Error(`Default onboarding plan "${planCode}" is not seeded.`);
  }

  const [subscription] = await tx.insert(subscriptions).values({
    tenantId,
    planId: plan.id,
    status: 'trialing',
    currentPeriodStart: new Date(),
    currentPeriodEnd: trialEndsAt,
    trialEndsAt,
    provider: 'manual',
  }).returning({
    id: subscriptions.id,
    status: subscriptions.status,
  });

  if (!subscription) {
    throw new Error('Не удалось создать пробную подписку для кабинета.');
  }

  return {
    id: subscription.id,
    status: subscription.status,
    planCode: plan.code,
    planName: plan.name,
    trialEndsAt: trialEndsAt.toISOString(),
  };
}

export type WbLkSessionHealth = {
  status: WbLkSessionStatus;
  checkedAt: string | null;
  title: string;
  message: string;
  storageStatePath: string | null;
  requiresSms: boolean;
};

export type VerifyWbLkSessionResult = {
  ok: boolean;
  status: WbLkSessionStatus;
  checkedAt: string;
  title: string;
  message: string;
  requiresSms: boolean;
  storageStatePath: string | null;
};

function classifyTokenCheckError(error: unknown): Omit<WbTokenPreflightCheck, 'key' | 'label'> {
  if (error instanceof WbApiError) {
    if (error.status === 401) {
      const payload = `${error.message} ${error.details ?? ''}`;
      const invalidToken = /token is malformed|access token problem|invalid number of segments/i.test(payload);

      return {
        ok: false,
        category: invalidToken ? 'wb_token_invalid' : 'wb_auth_failed',
        message: invalidToken ? 'Wildberries отклонил токен.' : 'WB API вернул ошибку авторизации.',
        statusCode: 401,
      };
    }

    if (typeof error.status === 'number' && error.status >= 500) {
      return {
        ok: false,
        category: 'wb_upstream_error',
        message: `WB API временно недоступен (${error.status}).`,
        statusCode: error.status,
      };
    }

    return {
      ok: false,
      category: 'unknown_error',
      message: error.status ? `WB API вернул ${error.status}.` : 'WB API вернул ошибку.',
      statusCode: error.status,
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  if (/fetch failed|ECONNREFUSED|timed out|network/i.test(message)) {
    return {
      ok: false,
      category: 'network_error',
      message: 'Не удалось достучаться до WB API. Проверьте сеть и повторите попытку.',
    };
  }

  return {
    ok: false,
    category: 'unknown_error',
    message: 'Проверка завершилась неизвестной ошибкой.',
  };
}

async function runTokenCheck(
  token: string,
  check: {
    key: WbTokenPreflightCheck['key'];
    label: WbTokenPreflightCheck['label'];
    run: () => Promise<unknown>;
  }
): Promise<WbTokenPreflightCheck> {
  try {
    await check.run();
    return {
      key: check.key,
      label: check.label,
      ok: true,
      category: 'ok',
      message: 'Контур доступен.',
    };
  } catch (error) {
    return {
      key: check.key,
      label: check.label,
      ...classifyTokenCheckError(error),
    };
  }
}

function buildMissingTokenResult(source: 'draft' | 'stored'): WbTokenPreflightResult {
  return {
    ok: false,
    healthStatus: 'unknown',
    savePolicy: 'missing_token',
    source,
    checkedAt: new Date().toISOString(),
    title: 'Токен не указан',
    message: source === 'draft'
      ? 'Вставьте токен в поле, затем повторите preflight-проверку.'
      : 'Сохранённый токен для этого кабинета не найден. Сначала добавьте или обновите токен.',
    checks: [
      {
        key: 'statistics',
        label: 'Statistics API',
        ok: false,
        category: 'missing_token',
        message: 'Нет токена для проверки.',
      },
    ],
  };
}

function buildStoredTokenHealth(
  result: WbTokenPreflightResult,
  overrides?: Partial<Pick<StoredWbTokenHealth, 'title' | 'message'>>
): StoredWbTokenHealth {
  return {
    status: result.healthStatus,
    source: 'stored',
    checkedAt: result.checkedAt,
    ok: result.ok,
    savePolicy: result.savePolicy,
    title: overrides?.title ?? result.title,
    message: overrides?.message ?? result.message,
    checks: result.checks,
  };
}

async function persistStoredTokenHealth(tenantId: string, health: StoredWbTokenHealth) {
  await db.update(tenants)
    .set({
      wbTokenHealthStatus: health.status,
      wbTokenCheckedAt: new Date(health.checkedAt),
      wbTokenHealthSummary: health,
    })
    .where(eq(tenants.id, tenantId));
}

async function runWbTokenPreflight(source: 'draft' | 'stored', candidateToken: string): Promise<WbTokenPreflightResult> {
  if (!candidateToken) {
    return buildMissingTokenResult(source);
  }

  const dateFrom = new Date().toISOString();
  const checks = await Promise.all([
    runTokenCheck(candidateToken, {
      key: 'statistics',
      label: 'Statistics API',
      run: () => wbApi.getOrders(candidateToken, dateFrom, dateFrom),
    }),
    runTokenCheck(candidateToken, {
      key: 'content',
      label: 'Content API',
      run: () => wbApi.getCardsListPage(candidateToken, { limit: 1 }),
    }),
    runTokenCheck(candidateToken, {
      key: 'prices',
      label: 'Prices API',
      run: () => wbApi.getPrices(candidateToken, 1),
    }),
    runTokenCheck(candidateToken, {
      key: 'ads',
      label: 'Advertising API',
      run: () => wbApi.getAdCampaigns(candidateToken),
    }),
  ]);

  const passedChecks = checks.filter((check) => check.ok).length;
  const totalChecks = checks.length;
  const allFailedWithInvalidToken = checks.every((check) => check.category === 'wb_token_invalid');
  const allFailedWithAuth = checks.every((check) => check.category === 'wb_auth_failed' || check.category === 'wb_token_invalid');

  if (passedChecks === totalChecks) {
    return {
      ok: true,
      healthStatus: 'healthy',
      savePolicy: 'pass',
      source,
      checkedAt: new Date().toISOString(),
      title: source === 'draft' ? 'Черновой токен принят WB' : 'Сохранённый токен прошёл preflight',
      message: source === 'draft'
        ? 'Все ключевые контуры WB ответили без ошибок. Сохраните токен, чтобы синхронизация использовала именно его.'
        : 'Все ключевые контуры WB ответили без ошибок. Можно запускать синхронизацию.',
      checks,
    };
  }

  if (allFailedWithInvalidToken) {
    return {
      ok: false,
      healthStatus: 'invalid',
      savePolicy: 'warning_required',
      source,
      checkedAt: new Date().toISOString(),
      title: 'Wildberries отклонил токен',
      message: source === 'draft'
        ? 'Проверенный токен не принят Wildberries. Исправьте токен перед сохранением.'
        : 'Сохранённый токен не принят Wildberries. Обновите его перед следующей синхронизацией.',
      checks,
    };
  }

  if (allFailedWithAuth) {
    return {
      ok: false,
      healthStatus: 'invalid',
      savePolicy: 'warning_required',
      source,
      checkedAt: new Date().toISOString(),
      title: 'WB API не авторизовал запросы',
      message: 'Проверка не прошла ни по одному из ключевых контуров. Проверьте токен и его права доступа.',
      checks,
    };
  }

  return {
    ok: false,
    healthStatus: 'warning',
    savePolicy: 'warning_required',
    source,
    checkedAt: new Date().toISOString(),
    title: 'Токен проходит preflight частично',
    message: `Из ${totalChecks} контуров WB ответили без ошибок только ${passedChecks}. Синхронизация может завершиться частично с ошибками.`,
    checks,
  };
}

function buildPendingStoredTokenHealth(): StoredWbTokenHealth {
  const checkedAt = new Date().toISOString();
  return {
    status: 'unknown',
    source: 'stored',
    checkedAt,
    ok: false,
    savePolicy: 'warning_required',
    title: 'Ключ применён, идёт проверка',
    message: 'Сохранённый ключ уже используется кабинетом. Проверка WB API запущена отдельно и обновит статус по каждому контуру.',
    checks: [],
  };
}

async function scheduleStoredTokenPreflight(tenantId: string) {
  try {
    await inngest.send({
      name: WB_TOKEN_PREFLIGHT_EVENT,
      data: { tenantId },
    });
  } catch (error) {
    logger.warn({ err: error, tenantId }, '[WB Token] Failed to enqueue background preflight');
  }
}

async function scheduleNewCabinetBackgroundSetup(tenantId: string) {
  const results = await Promise.allSettled([
    scheduleStoredTokenPreflight(tenantId),
    triggerInitialWbSync(tenantId),
  ]);

  for (const result of results) {
    if (result.status === 'rejected') {
      logger.warn({ err: result.reason, tenantId }, '[WB] Failed to enqueue new cabinet background setup');
    }
  }
}

function normalizeWbLkPhone(value: string) {
  const cleaned = value.trim().replace(/[^\d+]/g, '');
  const digits = cleaned.replace(/\D/g, '');
  if (digits.length < 10) {
    return '';
  }

  return cleaned.startsWith('+') ? `+${digits}` : digits;
}

function normalizeWbLkSessionStatus(value: string | null | undefined): WbLkSessionStatus {
  if (value === 'active' || value === 'healthy') {
    return 'healthy';
  }
  if (value === 'warning' || value === 'invalid') {
    return value;
  }

  return 'unknown';
}

function normalizeWbTokenHealthStatus(value: string | null | undefined): WbTokenHealthStatus {
  if (value === 'healthy' || value === 'warning' || value === 'invalid') {
    return value;
  }

  return 'unknown';
}

function isWbOfferConditionUrl(url: string) {
  return /seller\.wildberries\.ru\/confirm-offer-condition\/view/i.test(url);
}

function normalizeWbLkSessionErrorMessage(value: string) {
  const cleaned = value
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/\[[0-9;]*m/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) {
    return 'Не удалось проверить доступ WB ЛК. Повторите попытку.';
  }

  if (/need captcha|captcha|капч/i.test(cleaned)) {
    return 'WB требует CAPTCHA перед отправкой SMS. Откройте вход WB ЛК в обычном браузере, пройдите CAPTCHA и запросите код повторно.';
  }

  if (
    /waitforselector/i.test(cleaned)
    && /input\[type=['"]file['"]\]/i.test(cleaned)
  ) {
    return 'WB не перевёл сессию в кабинет (не удалось подтвердить раздел перераспределения). Обычно это anti-bot/CAPTCHA или не завершённый вход по SMS.';
  }

  if (/timeout/i.test(cleaned) && /seller-auth\.wildberries\.ru/i.test(cleaned)) {
    return 'WB не завершил вход по SMS в отведённое время. Повторите запрос кода и подтверждение ещё раз.';
  }

  if (
    /net::ERR_TIMED_OUT/i.test(cleaned)
    && /seller\.wildberries\.ru\/(?:supplies-management|supply-plan-upload|analytics-reports\/warehouse-remains)/i.test(cleaned)
  ) {
    return 'Не удалось открыть раздел «Перемещения» в WB (таймаут сети). Обычно это временная сеть/VPN проблема или нестабильный доступ к WB.';
  }

  if (/net::ERR_TIMED_OUT/i.test(cleaned) && /seller\.wildberries\.ru/i.test(cleaned)) {
    return 'Не удалось достучаться до WB Seller (таймаут сети). Проверьте интернет/VPN и повторите попытку.';
  }

  if (/confirm-offer-condition\/view/i.test(cleaned)) {
    return 'WB требует принять актуальную оферту в кабинете. Откройте WB Seller, примите оферту и повторите проверку.';
  }

  if (/ERR_ABORTED|frame was detached/i.test(cleaned) && /seller-auth\.wildberries\.ru/i.test(cleaned)) {
    return 'WB прервал переход на шаге входа. Обычно это редирект/переключение вкладки при anti-bot-проверке. Повторите вход через кнопку «Открыть ручной вход».';
  }

  if (/x server|no display|headed browser|browser was not found|failed to launch browser process/i.test(cleaned)) {
    return 'Ручной вход через окно Chromium доступен только в локальном окружении с графическим интерфейсом.';
  }

  if (
    /cannot find module/i.test(cleaned)
    && /package\.json/i.test(cleaned)
    && /playwright-core/i.test(cleaned)
  ) {
    return 'На сервере повреждён runtime Playwright для standalone-сборки. Выполните redeploy с полной установкой playwright/playwright-core и повторите проверку WB ЛК.';
  }

  if (/error while loading shared libraries|libnspr4|libnss3/i.test(cleaned)) {
    return 'На сервере не установлены системные библиотеки Chromium/Playwright. Обратитесь к администратору сервера и повторите вход.';
  }

  return cleaned.slice(0, 1000);
}

function uniqueSelectorCandidates(candidates: Array<string | null | undefined>) {
  const set = new Set<string>();
  for (const value of candidates) {
    if (!value) continue;
    for (const part of value.split(',')) {
      const selector = part.trim();
      if (!selector) continue;
      set.add(selector);
    }
  }

  return Array.from(set);
}

async function pickVisibleSelector(page: Page, candidates: string[], timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    for (const selector of candidates) {
      const visible = await page.locator(selector).first().isVisible({ timeout: 250 }).catch(() => false);
      if (visible) {
        return selector;
      }
    }
    await page.waitForTimeout(250);
  }

  return null;
}

function resolveWbPhoneFillValue(phone: string, inputMode: string | null, placeholder: string | null) {
  const digits = phone.replace(/\D/g, '');
  const normalizedInputMode = (inputMode || '').toLowerCase();
  const normalizedPlaceholder = (placeholder || '').toLowerCase();
  const expectsLocalNumeric =
    normalizedInputMode.includes('numeric')
    || normalizedPlaceholder.includes('999')
    || normalizedPlaceholder.includes('телефон');

  if (expectsLocalNumeric && digits.length >= 10) {
    return digits.slice(-10);
  }

  return phone;
}

async function gotoWithAbortTolerance(
  page: Page,
  url: string,
  timeout: number,
  waitUntil: 'commit' | 'domcontentloaded' | 'load' | 'networkidle' = 'domcontentloaded',
) {
  try {
    await page.goto(url, { waitUntil, timeout });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/ERR_ABORTED|frame was detached/i.test(message)) {
      await page.waitForTimeout(800);
      return;
    }
    throw error;
  }
}

function getRpaRedistributionTriggerSelector() {
  return process.env.WB_RPA_REDISTRIBUTION_TRIGGER_SELECTOR?.trim()
    || 'button:has-text("Перераспределить остатки"), a:has-text("Перераспределить остатки")';
}

async function resolveWbRedistributionPage(
  page: Page,
  configuredUrl: string,
  fileInputSelector: string | null,
  timeoutMs: number,
) {
  const candidateUrls = buildWbRedistributionUrlCandidates(configuredUrl);
  const attemptedUrls: string[] = [];
  let lastNavigationError: string | null = null;
  const redistributionTriggerSelector = getRpaRedistributionTriggerSelector();

  for (const candidateUrl of candidateUrls) {
    attemptedUrls.push(candidateUrl);
    try {
      await gotoWithAbortTolerance(page, candidateUrl, timeoutMs, 'domcontentloaded');
      await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
      await page.waitForTimeout(500);
    } catch (error) {
      lastNavigationError = error instanceof Error ? error.message : String(error);
      continue;
    }

    if (isWbOfferConditionUrl(page.url())) {
      return {
        ready: false,
        offerAcceptanceRequired: true,
        attemptedUrls,
        lastNavigationError,
        currentUrl: page.url(),
      };
    }

    const fileInputVisible = fileInputSelector
      ? await page
        .locator(fileInputSelector)
        .first()
        .count()
        .then((count) => count > 0)
        .catch(() => false)
      : false;

    const redistributionButtonVisible = await page
      .locator(redistributionTriggerSelector)
      .first()
      .isVisible({ timeout: 8_000 })
      .catch(() => false);

    const hasWarehouseRemainsMarker = await page
      .locator('text=Отчёт по остаткам на складе')
      .first()
      .isVisible({ timeout: 6_000 })
      .catch(() => false);

    const bodyText = await page.textContent('body').catch(() => '') ?? '';
    const hasWarehouseRemainsText = /отч[её]т по остаткам на складе|перераспределить остатки/i.test(bodyText);

    if (fileInputVisible || redistributionButtonVisible || hasWarehouseRemainsMarker || hasWarehouseRemainsText) {
      return {
        ready: true,
        offerAcceptanceRequired: false,
        attemptedUrls,
        lastNavigationError,
        currentUrl: page.url(),
        modeHint: fileInputVisible ? 'csv' : 'warehouse_remains',
      };
    }
  }

  return {
    ready: false,
    offerAcceptanceRequired: false,
    attemptedUrls,
    lastNavigationError,
    currentUrl: page.url(),
    modeHint: 'unknown',
  };
}

export async function verifyWbLkSession(
  tenantId: string,
  data: {
    phone: string;
    smsCode?: string;
    password?: string;
    mode?: 'auto' | 'interactive';
  },
): Promise<VerifyWbLkSessionResult> {
  await requireTenantAccess(tenantId, ['owner', 'admin']);

  const phone = normalizeWbLkPhone(data.phone);
  const password = data.password?.trim() ?? '';
  const smsCode = data.smsCode?.trim() ?? '';
  const mode: 'auto' | 'interactive' = data.mode === 'interactive' ? 'interactive' : 'auto';
  if (!phone) {
    throw new Error('Укажите номер телефона для WB ЛК.');
  }

  const loginUrl = process.env.WB_RPA_LOGIN_URL?.trim();
  const redistributionUrl = process.env.WB_RPA_REDISTRIBUTION_URL?.trim();
  const loginSelector = process.env.WB_RPA_LOGIN_SELECTOR?.trim();
  const passwordSelector = process.env.WB_RPA_PASSWORD_SELECTOR?.trim() || null;
  const submitSelector = process.env.WB_RPA_SUBMIT_SELECTOR?.trim();
  const fileInputSelector = process.env.WB_RPA_FILE_INPUT_SELECTOR?.trim();
  const smsCodeSelector = process.env.WB_RPA_SMS_CODE_SELECTOR?.trim() || null;
  const smsSubmitSelector = process.env.WB_RPA_SMS_SUBMIT_SELECTOR?.trim() || null;
  const loginSuccessSelector = process.env.WB_RPA_LOGIN_SUCCESS_SELECTOR?.trim() || null;
  const timeoutMs = Number.parseInt(process.env.WB_RPA_TIMEOUT_MS ?? '90000', 10);
  const effectiveTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 10_000 ? Math.min(timeoutMs, 600_000) : 90_000;
  const interactiveTimeoutRaw = Number.parseInt(process.env.WB_RPA_INTERACTIVE_TIMEOUT_MS ?? '900000', 10);
  const interactiveTimeoutMs = Number.isFinite(interactiveTimeoutRaw) && interactiveTimeoutRaw >= 30_000
    ? Math.min(interactiveTimeoutRaw, 900_000)
    : 300_000;
  const headless = process.env.WB_RPA_HEADLESS !== 'false';
  let sessionHandle: StorageStateSession | null = null;
  const checkedAt = new Date().toISOString();

  const requiredEnv = {
    WB_RPA_LOGIN_URL: loginUrl,
    WB_RPA_REDISTRIBUTION_URL: redistributionUrl,
    WB_RPA_LOGIN_SELECTOR: loginSelector,
    WB_RPA_SUBMIT_SELECTOR: submitSelector,
  } as const;
  const missingEnv = Object.entries(requiredEnv)
    .filter(([, value]) => !value)
    .map(([name]) => name);

  let status: WbLkSessionStatus = 'invalid';
  let title = 'Проверка WB ЛК не выполнена';
  let message = 'Не удалось проверить доступ в WB ЛК.';
  let requiresSms = false;
  let distributionReady = true;
  let offerAcceptanceRequired = false;

  if (missingEnv.length > 0) {
    title = 'Проблема с доступом WB ЛК';
    message = `Не настроен вход WB ЛК для RPA. Заполните .env: ${missingEnv.join(', ')}.`;

    await db.update(tenants)
      .set({
        wbLkPhone: phone,
        wbLkSessionStatus: status,
        wbLkSessionCheckedAt: new Date(checkedAt),
        wbLkSessionError: message.slice(0, 1000),
      })
      .where(eq(tenants.id, tenantId));

    revalidatePath('/settings');
    revalidatePath('/');

    return {
      ok: false,
      status,
      checkedAt,
      title,
      message,
      requiresSms,
      storageStatePath: null,
    };
  }

  const safeLoginUrl = loginUrl!;
  const safeRedistributionUrl = redistributionUrl!;
  const safeLoginSelector = loginSelector!;
  const safeSubmitSelector = submitSelector!;
  const safeFileInputSelector = fileInputSelector || null;

  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({ headless: mode === 'interactive' ? false : headless });
    sessionHandle = await loadStorageStateSession(tenantId);
    const context = await browser.newContext(
      sessionHandle ? { storageState: sessionHandle.tempPath } : undefined,
    );
    const page = await context.newPage();

    if (mode === 'interactive') {
      await gotoWithAbortTolerance(page, safeLoginUrl, Math.min(effectiveTimeoutMs, 30_000), 'commit');
      const loginSelectorCandidates = uniqueSelectorCandidates([
        safeLoginSelector,
        "input[type='tel']",
        "input[inputmode='numeric']",
        "input[placeholder*='999']",
        "input[placeholder*='телефон']",
        "input[type='text']",
      ]);
      const interactiveLoginSelector = await pickVisibleSelector(page, loginSelectorCandidates, 5_000);
      if (interactiveLoginSelector) {
        const inputMeta = await page.locator(interactiveLoginSelector).first().evaluate((el) => ({
          inputMode: (el as HTMLInputElement).inputMode || el.getAttribute('inputmode'),
          placeholder: (el as HTMLInputElement).placeholder || el.getAttribute('placeholder'),
        })).catch(() => ({ inputMode: null as string | null, placeholder: null as string | null }));
        const fillValue = resolveWbPhoneFillValue(phone, inputMeta.inputMode, inputMeta.placeholder);
        await page.fill(interactiveLoginSelector, fillValue, { timeout: effectiveTimeoutMs }).catch(() => {});
      }

      const startedAt = Date.now();
      let leftAuthDomain = false;
      let observedSellerPage: typeof page | null = null;

      while (Date.now() - startedAt < interactiveTimeoutMs) {
        const openPages = context.pages().filter((candidate) => !candidate.isClosed());
        if (openPages.length === 0) {
          throw new Error('Окно ручного входа Chromium было закрыто до завершения авторизации.');
        }

        for (const candidate of openPages) {
          const currentUrl = candidate.url();
          const onAuthDomain = /seller-auth\.wildberries\.ru/i.test(currentUrl);
          const onSellerDomain = /seller\.wildberries\.ru/i.test(currentUrl);
          if (onSellerDomain && !onAuthDomain) {
            observedSellerPage = candidate;
            leftAuthDomain = true;
            break;
          }
        }
        if (leftAuthDomain) break;

        await page.waitForTimeout(1_200);
      }

      if (!leftAuthDomain) {
        const authPage = context.pages().find((candidate) => /seller-auth\.wildberries\.ru/i.test(candidate.url())) ?? page;
        const bodyText = await authPage.textContent('body').catch(() => '') ?? '';
        if (/captcha|капч/i.test(bodyText)) {
          throw new Error(
            'WB требует CAPTCHA. В ручном окне Chromium завершите CAPTCHA и вход, затем повторите проверку.',
          );
        }

        throw new Error(
          'Не удалось завершить ручной вход в WB ЛК в заданное время. Повторите и завершите вход в открытом окне Chromium.',
        );
      }

      const verificationPage = observedSellerPage && !observedSellerPage.isClosed() ? observedSellerPage : page;
      if (isWbOfferConditionUrl(verificationPage.url())) {
        const offerStartedAt = Date.now();
        while (Date.now() - offerStartedAt < interactiveTimeoutMs) {
          if (verificationPage.isClosed()) {
            throw new Error('Окно ручного входа Chromium было закрыто до принятия оферты WB.');
          }

          if (!isWbOfferConditionUrl(verificationPage.url())) {
            break;
          }

          await verificationPage.waitForTimeout(1_200);
        }

        if (isWbOfferConditionUrl(verificationPage.url())) {
          offerAcceptanceRequired = true;
        }
      }

      if (!offerAcceptanceRequired) {
        const interactivePostLoginCheck = await resolveWbRedistributionPage(
          verificationPage,
          safeRedistributionUrl,
          safeFileInputSelector,
          Math.min(effectiveTimeoutMs, 45_000),
        );
        distributionReady = interactivePostLoginCheck.ready;
        if (interactivePostLoginCheck.offerAcceptanceRequired) {
          offerAcceptanceRequired = true;
        } else if (!interactivePostLoginCheck.ready) {
          if (/seller-auth\.wildberries\.ru/i.test(interactivePostLoginCheck.currentUrl)) {
            throw new Error(
              `Сохранённая WB-сессия недействительна или истекла: WB перенаправил на авторизацию (${interactivePostLoginCheck.currentUrl}). Повторите вход через «Простой вход: открыть CAPTCHA и войти», затем дождитесь перехода в кабинет WB.`,
            );
          }

          throw new Error(
            `После ручного входа не удалось подтвердить страницу перераспределения в WB. Попробованы URL: ${interactivePostLoginCheck.attemptedUrls.join(', ')}.${interactivePostLoginCheck.lastNavigationError ? ` Последняя ошибка навигации: ${interactivePostLoginCheck.lastNavigationError}` : ''}`,
          );
        }
      }
    } else {
      const preLoginCheck = await resolveWbRedistributionPage(
        page,
        safeRedistributionUrl,
        safeFileInputSelector,
        Math.min(effectiveTimeoutMs, 20_000),
      );
      distributionReady = preLoginCheck.ready;
      const fileInputVisible = preLoginCheck.ready;
      offerAcceptanceRequired = preLoginCheck.offerAcceptanceRequired;

      if (!fileInputVisible && !offerAcceptanceRequired) {
        await page.goto(safeLoginUrl, { waitUntil: 'domcontentloaded', timeout: effectiveTimeoutMs });
        const loginSelectorCandidates = uniqueSelectorCandidates([
          safeLoginSelector,
          "input[type='tel']",
          "input[inputmode='numeric']",
          "input[placeholder*='999']",
          "input[placeholder*='телефон']",
          "input[type='text']",
        ]);
        const submitSelectorCandidates = uniqueSelectorCandidates([
          safeSubmitSelector,
          "button[type='submit']",
        ]);

        const resolvedLoginSelector = await pickVisibleSelector(
          page,
          loginSelectorCandidates,
          Math.min(effectiveTimeoutMs, 15_000),
        );
        if (!resolvedLoginSelector) {
          throw new Error(
            `WB изменил форму входа: не найдено поле телефона. Проверьте селектор WB_RPA_LOGIN_SELECTOR (текущий: ${safeLoginSelector}).`,
          );
        }

        const inputMeta = await page.locator(resolvedLoginSelector).first().evaluate((el) => ({
          inputMode: (el as HTMLInputElement).inputMode || el.getAttribute('inputmode'),
          placeholder: (el as HTMLInputElement).placeholder || el.getAttribute('placeholder'),
        })).catch(() => ({ inputMode: null as string | null, placeholder: null as string | null }));
        const fillValue = resolveWbPhoneFillValue(phone, inputMeta.inputMode, inputMeta.placeholder);
        await page.fill(resolvedLoginSelector, fillValue, { timeout: effectiveTimeoutMs });
        if (passwordSelector && password) {
          await page.fill(passwordSelector, password, { timeout: effectiveTimeoutMs });
        }

        const codeRequestResponsePromise = page.waitForResponse(
          (response) => response.url().includes('/auth/v2/code/wb-captcha'),
          { timeout: 12_000 },
        ).catch(() => null);

        const resolvedSubmitSelector = await pickVisibleSelector(
          page,
          submitSelectorCandidates,
          Math.min(effectiveTimeoutMs, 8_000),
        );
        if (!resolvedSubmitSelector) {
          throw new Error(
            `WB изменил форму входа: не найдена кнопка отправки кода. Проверьте селектор WB_RPA_SUBMIT_SELECTOR (текущий: ${safeSubmitSelector}).`,
          );
        }

        await Promise.all([
          page.waitForLoadState('networkidle', { timeout: effectiveTimeoutMs }).catch(() => {}),
          page.click(resolvedSubmitSelector, { timeout: effectiveTimeoutMs }),
        ]);

        const codeRequestResponse = await codeRequestResponsePromise;
        if (codeRequestResponse) {
          type WbCaptchaResponse = {
            error?: string;
            result?: number;
          };

          let codeRequestBody: WbCaptchaResponse | null = null;
          try {
            codeRequestBody = await codeRequestResponse.json() as WbCaptchaResponse;
          } catch {
            codeRequestBody = null;
          }

          const captchaRequired = codeRequestBody?.error?.toLowerCase().includes('captcha')
            || codeRequestBody?.result === 3;
          if (captchaRequired) {
            throw new Error(
              'WB требует CAPTCHA перед отправкой SMS. Откройте вход WB ЛК в обычном браузере, пройдите CAPTCHA и запросите код повторно.',
            );
          }
        }

        const bodyTextAfterSubmit = await page.textContent('body').catch(() => '') ?? '';
        const looksLikeSmsStep = /код|sms|смс|подтверждени/i.test(bodyTextAfterSubmit);

        if (smsCodeSelector) {
          const smsInputVisible = await page.locator(smsCodeSelector).first().isVisible({ timeout: 3_500 }).catch(() => false);
          const isSameInputAsLogin = smsCodeSelector === safeLoginSelector;
          if (smsInputVisible && (looksLikeSmsStep || !isSameInputAsLogin)) {
            if (!smsCode) {
              requiresSms = true;
              status = 'warning';
              title = 'Требуется SMS-код подтверждения';
              message = 'Номер телефона принят. Для завершения входа в WB ЛК введите SMS-код и нажмите подтверждение.';

              await db.update(tenants)
                .set({
                  wbLkPhone: phone,
                  wbLkSessionStatus: status,
                  wbLkSessionCheckedAt: new Date(checkedAt),
                  wbLkSessionError: message,
                })
                .where(eq(tenants.id, tenantId));

              revalidatePath('/settings');
              revalidatePath('/');

              return {
                ok: false,
                status,
                checkedAt,
                title,
                message,
                requiresSms,
                storageStatePath: null,
              };
            }

            await page.fill(smsCodeSelector, smsCode, { timeout: effectiveTimeoutMs });
            if (smsSubmitSelector) {
              await Promise.all([
                page.waitForLoadState('networkidle', { timeout: effectiveTimeoutMs }).catch(() => {}),
                page.click(smsSubmitSelector, { timeout: effectiveTimeoutMs }),
              ]);
            } else {
              await page.keyboard.press('Enter');
              await page.waitForLoadState('networkidle', { timeout: effectiveTimeoutMs }).catch(() => {});
            }
          }
        }

        const urlAfterSubmit = page.url();
        const stillOnAuthDomain = /seller-auth\.wildberries\.ru/i.test(urlAfterSubmit);
        if (stillOnAuthDomain && !looksLikeSmsStep) {
          if (/captcha|капч/i.test(bodyTextAfterSubmit)) {
            throw new Error(
              'WB требует CAPTCHA перед отправкой SMS. Откройте вход WB ЛК в обычном браузере, пройдите CAPTCHA и запросите код повторно.',
            );
          }

          throw new Error(
            'WB не отправил SMS-код (страница входа не перешла на шаг подтверждения). Обычно это anti-bot/CAPTCHA или лимит попыток. Попробуйте запросить код в обычном браузере WB и повторите.',
          );
        }

        if (loginSuccessSelector) {
          await page.waitForSelector(loginSuccessSelector, { timeout: 10_000 });
        }

        const postLoginCheck = await resolveWbRedistributionPage(
          page,
          safeRedistributionUrl,
          safeFileInputSelector,
          effectiveTimeoutMs,
        );
        distributionReady = postLoginCheck.ready;
        if (postLoginCheck.offerAcceptanceRequired) {
          offerAcceptanceRequired = true;
        } else if (!postLoginCheck.ready) {
          throw new Error(
            `После входа не удалось подтвердить страницу перераспределения в WB. Попробованы URL: ${postLoginCheck.attemptedUrls.join(', ')}.${postLoginCheck.lastNavigationError ? ` Последняя ошибка навигации: ${postLoginCheck.lastNavigationError}` : ''}`,
          );
        }
      }
    }

    await persistStorageStateFromContext(tenantId, context);

    if (offerAcceptanceRequired) {
      status = 'warning';
      title = 'Требуется принять оферту WB';
      message = 'После входа WB перенаправляет на страницу оферты. Откройте WB Seller, примите актуальную оферту и повторите проверку WB ЛК.';
    } else if (distributionReady) {
      status = 'healthy';
      title = 'Доступ к WB ЛК подтвержден';
      message = mode === 'interactive'
        ? 'Сессия сохранена после ручного входа. Полуавтоматический запуск RPA можно выполнять без повторного логина.'
        : 'Сессия успешно сохранена. Полуавтоматический запуск RPA можно выполнять без повторного логина.';
    } else {
      status = 'warning';
      title = 'Сессия WB ЛК сохранена с предупреждением';
      message = 'Вход в WB ЛК выполнен, но экран «Перераспределить остатки» не подтвердился. Сессия сохранена, проверьте URL/селекторы RPA перед запуском.';
    }
    requiresSms = false;
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    if (
      mode === 'interactive'
      && /x server|no display|headed browser|browser was not found|failed to launch browser process/i.test(rawMessage)
    ) {
      const autoResult = await verifyWbLkSession(tenantId, {
        ...data,
        mode: 'auto',
      });

      return {
        ...autoResult,
        title: autoResult.ok ? 'Ручное окно Chromium недоступно на сервере' : 'Проблема с доступом WB ЛК',
        message: autoResult.ok
          ? 'На сервере нет графического интерфейса, поэтому окно Chromium не открывается. Выполнена авто-проверка WB ЛК без ручного окна.'
          : `На сервере нет графического интерфейса, поэтому окно Chromium не открывается. Авто-проверка завершилась так: ${autoResult.message}`,
      };
    }

    status = 'invalid';
    title = 'Проблема с доступом WB ЛК';
    message = normalizeWbLkSessionErrorMessage(
      rawMessage || 'Не удалось авторизоваться в WB ЛК.',
    );
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (sessionHandle) {
      await sessionHandle.cleanup();
    }
  }

  await db.update(tenants)
    .set({
      wbLkPhone: phone,
      wbLkSessionStatus: status,
      wbLkSessionCheckedAt: new Date(checkedAt),
      wbLkSessionError: status === 'healthy' ? null : message.slice(0, 1000),
    })
    .where(eq(tenants.id, tenantId));

  revalidatePath('/settings');
  revalidatePath('/');

  return {
    ok: status === 'healthy',
    status,
    checkedAt,
    title,
    message,
    requiresSms,
    storageStatePath: null,
  };
}

export async function validateWbToken(tenantId: string, draftToken?: string): Promise<WbTokenPreflightResult> {
  await requireTenantAccess(tenantId, ['owner', 'admin']);

  const [tenant] = await db.select({
    wbApiToken: tenants.wbApiToken,
  })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  const source = draftToken?.trim() ? 'draft' : 'stored';
  const candidateToken = draftToken?.trim()
    ? draftToken.trim()
    : tenant?.wbApiToken
      ? decryptIfNeeded(tenant.wbApiToken)
      : '';

  const result = await runWbTokenPreflight(source, candidateToken);

  if (source === 'stored') {
    const persistedHealth = buildStoredTokenHealth(result);
    await persistStoredTokenHealth(tenantId, persistedHealth);
    revalidatePath('/settings');
    return {
      ...result,
      persistedHealth,
    };
  }

  return result;
}

/**
 * Сохранение и шифрование API токена с preflight-политикой
 */
export async function saveApiToken(tenantId: string, token: string, _allowWarning = false): Promise<SaveApiTokenResult> {
  await requireTenantAccess(tenantId, ['owner', 'admin']);
  const candidateToken = token.trim();

  if (!candidateToken) {
    throw new Error('Нельзя сохранить пустой токен.');
  }

  const encryptedToken = encrypt(candidateToken);
  const storedHealth = buildPendingStoredTokenHealth();

  await db.update(tenants)
    .set({
      wbApiToken: encryptedToken,
      wbTokenHealthStatus: storedHealth.status,
      wbTokenCheckedAt: new Date(storedHealth.checkedAt),
      wbTokenHealthSummary: storedHealth,
    })
    .where(eq(tenants.id, tenantId));
  
  revalidatePath('/settings');
  revalidatePath('/');
  await scheduleStoredTokenPreflight(tenantId);

  return {
    saved: true,
    requiresWarning: false,
    title: 'Ключ применён',
    message: 'Новый WB API ключ сохранён. Проверка доступа идёт отдельно: статус обновится по мере ответа контуров WB.',
    preflight: {
      ok: false,
      healthStatus: 'unknown',
      savePolicy: 'warning_required',
      source: 'stored',
      checkedAt: storedHealth.checkedAt,
      title: storedHealth.title,
      message: storedHealth.message,
      checks: [],
    },
    storedHealth,
  };
}

/**
 * Обновление настроек магазина и налогов
 */
export async function createTelegramLinkToken(tenantId: string): Promise<TelegramLinkTokenResult> {
  const { user } = await requireTenantAccess(tenantId, ['owner', 'admin']);
  const token = randomBytes(24).toString('base64url');
  const tokenHash = hashTelegramLinkToken(token);
  const expiresAt = new Date(Date.now() + TELEGRAM_LINK_TOKEN_TTL_MS);

  await withTenantContext(db, tenantId, async (tx) => {
    await tx.update(telegramLinkTokens)
      .set({ status: 'revoked' })
      .where(and(
        eq(telegramLinkTokens.tenantId, tenantId),
        eq(telegramLinkTokens.status, 'pending'),
      ));

    await tx.insert(telegramLinkTokens).values({
      tenantId,
      tokenHash,
      createdByUserId: user.id,
      expiresAt,
    });
  });

  const botUsername = getTelegramBotUsername();

  return {
    token,
    startParameter: token,
    deepLinkUrl: botUsername ? `https://t.me/${botUsername}?start=${token}` : null,
    expiresAt: expiresAt.toISOString(),
    botUsernameConfigured: Boolean(botUsername),
  };
}

export async function updateTenantSettings(
  tenantId: string, 
  data: { 
    shopName: string, 
    taxType: string, 
    taxRate: number,
    vatMode?: string,
    vatRate?: number,
    telegramChatId?: number | null,
    notificationsEnabled?: boolean,
    telegramSignalNotificationPrefs?: SignalNotificationPreferences,
    wbLkPhone?: string | null,
  }
) {
  await requireTenantAccess(tenantId, ['owner', 'admin']);
  const normalizedTaxType = normalizeWbTaxType(data.taxType);
  const normalizedTaxRate = resolveTaxRatePercent(normalizedTaxType, data.taxRate);
  const normalizedVatMode = normalizeVatMode(data.vatMode);
  const normalizedVatRate = resolveVatRatePercent(normalizedVatMode, data.vatRate ?? null);
  await db.update(tenants)
    .set({
      shopName: data.shopName,
      taxType: normalizedTaxType,
      taxRate: normalizedTaxRate.toFixed(2),
      vatMode: normalizedVatMode,
      vatRate: normalizedVatRate.toFixed(2),
      telegramChatId: data.telegramChatId,
      notificationsEnabled: data.notificationsEnabled,
      telegramSignalNotificationPrefs: resolveSignalNotificationPreferences(data.telegramSignalNotificationPrefs),
      wbLkPhone: data.wbLkPhone ? normalizeWbLkPhone(data.wbLkPhone) : null,
    })
    .where(eq(tenants.id, tenantId));
  
  revalidatePath('/settings');
  revalidatePath('/');
}

export async function getTenantSettings(tenantId: string) {
  const { user } = await requireTenantAccess(tenantId);
  const [result] = await db.select({
    name: tenants.name,
    shopName: tenants.shopName,
    taxType: tenants.taxType,
    taxRate: tenants.taxRate,
    vatMode: tenants.vatMode,
    vatRate: tenants.vatRate,
    telegramChatId: tenants.telegramChatId,
    notificationsEnabled: tenants.notificationsEnabled,
    telegramSignalNotificationPrefs: tenants.telegramSignalNotificationPrefs,
    hasStoredToken: sql<boolean>`case when ${tenants.wbApiToken} is not null and ${tenants.wbApiToken} <> '' then true else false end`,
    wbTokenHealthStatus: tenants.wbTokenHealthStatus,
    wbTokenCheckedAt: tenants.wbTokenCheckedAt,
    wbTokenHealthSummary: tenants.wbTokenHealthSummary,
    wbLkPhone: tenants.wbLkPhone,
    wbLkSessionStatus: tenants.wbLkSessionStatus,
    wbLkSessionCheckedAt: tenants.wbLkSessionCheckedAt,
    wbLkSessionError: tenants.wbLkSessionError,
    wbLkStorageStatePath: tenants.wbLkStorageStatePath,
  })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  if (!result) {
    return null;
  }

  const [membership] = await withTenantContext(db, tenantId, async (tx) =>
    tx.select({
      inAppSignalNotificationPrefs: userTenants.inAppSignalNotificationPrefs,
    })
      .from(userTenants)
      .where(and(eq(userTenants.tenantId, tenantId), eq(userTenants.userId, user.id)))
      .limit(1),
  );

  const [telegramLink] = await withTenantContext(db, tenantId, async (tx) =>
    tx.select({
      chatId: telegramChatLinks.chatId,
      chatType: telegramChatLinks.chatType,
      telegramUserId: telegramChatLinks.telegramUserId,
      telegramUsername: telegramChatLinks.telegramUsername,
      createdAt: telegramChatLinks.createdAt,
    })
      .from(telegramChatLinks)
      .where(and(
        eq(telegramChatLinks.tenantId, tenantId),
        eq(telegramChatLinks.status, 'active'),
      ))
      .orderBy(desc(telegramChatLinks.createdAt))
      .limit(1),
  );

  const summary = result.wbTokenHealthSummary as Partial<StoredWbTokenHealth> | undefined;
  const wbLkSessionStatus = normalizeWbLkSessionStatus(result.wbLkSessionStatus);
  const tokenHealth: StoredWbTokenHealth | null = result.wbTokenCheckedAt
    ? {
        status: result.wbTokenHealthStatus as WbTokenHealthStatus,
        source: 'stored',
        checkedAt: result.wbTokenCheckedAt.toISOString(),
        ok: summary?.ok ?? result.wbTokenHealthStatus === 'healthy',
        savePolicy: summary?.savePolicy ?? (result.wbTokenHealthStatus === 'healthy' ? 'pass' : 'warning_required'),
        title: summary?.title ?? 'Сохранённый токен проверен',
        message: summary?.message ?? 'Состояние токена обновлено.',
        checks: summary?.checks ?? [],
      }
    : null;

  return {
    name: result.name,
    shopName: result.shopName,
    taxType: normalizeWbTaxType(result.taxType),
    taxRate: resolveTaxRatePercent(result.taxType, result.taxRate),
    vatMode: normalizeVatMode(result.vatMode),
    vatRate: resolveVatRatePercent(result.vatMode, result.vatRate),
    wbLkPhone: result.wbLkPhone,
    telegramChatId: result.telegramChatId,
    telegramLink: telegramLink
      ? {
          chatId: telegramLink.chatId,
          chatType: telegramLink.chatType,
          telegramUserId: telegramLink.telegramUserId,
          telegramUsername: telegramLink.telegramUsername,
          createdAt: telegramLink.createdAt.toISOString(),
        } satisfies TelegramLinkState
      : null,
    notificationsEnabled: result.notificationsEnabled,
    signalNotificationSettings: {
      inApp: resolveSignalNotificationPreferences(membership?.inAppSignalNotificationPrefs),
      telegram: resolveSignalNotificationPreferences(result.telegramSignalNotificationPrefs),
    },
    hasStoredToken: result.hasStoredToken,
    tokenHealth,
    wbLkSessionHealth: {
      status: wbLkSessionStatus,
      checkedAt: result.wbLkSessionCheckedAt ? result.wbLkSessionCheckedAt.toISOString() : null,
      title: wbLkSessionStatus === 'healthy'
        ? 'WB ЛК-сессия подтверждена'
        : wbLkSessionStatus === 'warning'
          ? 'WB ЛК требует дополнительное подтверждение'
          : wbLkSessionStatus === 'invalid'
            ? 'WB ЛК-сессия невалидна'
            : 'WB ЛК-сессия не настроена',
      message: wbLkSessionStatus === 'healthy'
        ? 'Сохранённая сессия доступна для RPA-полуавтомата.'
        : result.wbLkSessionError
          ? normalizeWbLkSessionErrorMessage(result.wbLkSessionError)
          : 'Проведите проверку логина WB ЛК через номер телефона.',
      storageStatePath: result.wbLkStorageStatePath,
      requiresSms: wbLkSessionStatus === 'warning',
    } satisfies WbLkSessionHealth,
  };
}

export async function updateInAppSignalNotificationPreferences(
  tenantId: string,
  inAppSignalNotificationPrefs: SignalNotificationPreferences,
) {
  const { user } = await requireTenantAccess(tenantId);

  await withTenantContext(db, tenantId, async (tx) => {
    await tx.update(userTenants)
      .set({
        inAppSignalNotificationPrefs: resolveSignalNotificationPreferences(inAppSignalNotificationPrefs),
      })
      .where(and(eq(userTenants.tenantId, tenantId), eq(userTenants.userId, user.id)));
  });

  revalidatePath('/settings');
  revalidatePath('/');

  return {
    success: true,
    preferences: {
      inApp: resolveSignalNotificationPreferences(inAppSignalNotificationPrefs),
      telegram: DEFAULT_SIGNAL_NOTIFICATION_PREFERENCES,
    },
  };
}

/**
 * Переключение видимости товара (скрыть/показать)
 */
export async function toggleProductVisibility(tenantId: string, nmId: number, isHidden: boolean) {
  await requireTenantAccess(tenantId, ['owner', 'admin']);
  await setProductsVisibility(tenantId, [nmId], isHidden);

  revalidatePath('/costs');
  revalidatePath('/economics');
  revalidatePath('/economics-v2');
  revalidatePath('/overview');
  invalidateDashboardCache(tenantId);
}

/**
 * Массовое переключение видимости товаров.
 */
export async function toggleProductsVisibility(tenantId: string, nmIds: number[], isHidden: boolean) {
  await requireTenantAccess(tenantId, ['owner', 'admin']);

  const uniqueNmIds = normalizeProductVisibilityNmIds(nmIds);

  if (uniqueNmIds.length === 0) {
    return { success: true, count: 0 };
  }

  await setProductsVisibility(tenantId, uniqueNmIds, isHidden);

  revalidatePath('/costs');
  revalidatePath('/economics');
  revalidatePath('/economics-v2');
  revalidatePath('/overview');
  invalidateDashboardCache(tenantId);

  return { success: true, count: uniqueNmIds.length };
}

/**
 * Получить список всех доступных кабинетов пользователя
 */
export async function getAvailableTenants() {
  const user = await requireAuthenticatedUser();
  const impersonation = await getActivePlatformImpersonationSessionForUser(user.id);

  if (impersonation) {
    const results = await withAdminContext(db, (tx) => tx.execute(sql<{
      id: string;
      name: string | null;
      shopName: string | null;
      role: string;
      accessPreset: string | null;
      featurePermissions: Record<string, boolean>;
      hasStoredToken: boolean;
      wbTokenHealthStatus: string | null;
      wbTokenCheckedAt: Date | null;
      wbLkSessionStatus: string | null;
    }>`
      WITH owner_users AS (
        SELECT DISTINCT ut.user_id, lower(u.email) AS owner_email
        FROM user_tenants ut
        LEFT JOIN users u ON u.id = ut.user_id
        WHERE ut.tenant_id = ${impersonation.tenantId}
          AND ut.role = 'owner'
      ),
      account_users AS (
        SELECT DISTINCT u.id AS user_id
        FROM users u
        JOIN owner_users ou
          ON ou.user_id = u.id
          OR (ou.owner_email IS NOT NULL AND lower(u.email) = ou.owner_email)
      ),
      account_tenants AS (
        SELECT DISTINCT ON (t.id)
          t.id,
          t.name,
          t.shop_name,
          ut.role,
          ut.access_preset,
          ut.feature_permissions,
          CASE WHEN t.wb_api_token IS NOT NULL AND t.wb_api_token <> '' THEN true ELSE false END AS has_stored_token,
          t.wb_token_health_status,
          t.wb_token_checked_at,
          t.wb_lk_session_status
        FROM user_tenants ut
        JOIN account_users au ON au.user_id = ut.user_id
        JOIN tenants t ON t.id = ut.tenant_id
        ORDER BY t.id, CASE ut.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END
      )
      SELECT
        t.id::text AS id,
        t.name,
        t.shop_name AS "shopName",
        COALESCE(at.role, 'owner') AS role,
        COALESCE(at.access_preset, 'all') AS "accessPreset",
        COALESCE(at.feature_permissions, '{}'::jsonb) AS "featurePermissions",
        CASE WHEN t.wb_api_token IS NOT NULL AND t.wb_api_token <> '' THEN true ELSE false END AS "hasStoredToken",
        t.wb_token_health_status AS "wbTokenHealthStatus",
        t.wb_token_checked_at AS "wbTokenCheckedAt",
        t.wb_lk_session_status AS "wbLkSessionStatus"
      FROM tenants t
      LEFT JOIN account_tenants at ON at.id = t.id
      WHERE at.id IS NOT NULL OR t.id = ${impersonation.tenantId}
      ORDER BY t.created_at DESC
    `));

    return (results as unknown as Array<{
      id: string;
      name: string | null;
      shopName: string | null;
      role: string;
      accessPreset: string | null;
      featurePermissions: Record<string, boolean>;
      hasStoredToken: boolean;
      wbTokenHealthStatus: string | null;
      wbTokenCheckedAt: Date | null;
      wbLkSessionStatus: string | null;
    }>).map((row) => ({
      ...row,
      role: 'owner',
      accessPreset: 'all',
      featurePermissions: ALL_TENANT_FEATURE_PERMISSIONS,
      wbTokenHealthStatus: normalizeWbTokenHealthStatus(row.wbTokenHealthStatus),
      wbLkSessionStatus: normalizeWbLkSessionStatus(row.wbLkSessionStatus),
    }));
  }

  // Admin-path: list all tenants the user belongs to — intrinsically cross-tenant.
  const results = await withAdminContext(db, (tx) =>
    tx.select({
      id: tenants.id,
      name: tenants.name,
      shopName: tenants.shopName,
      role: userTenants.role,
      accessPreset: userTenants.accessPreset,
      featurePermissions: userTenants.featurePermissions,
      hasStoredToken: sql<boolean>`case when ${tenants.wbApiToken} is not null and ${tenants.wbApiToken} <> '' then true else false end`,
      wbTokenHealthStatus: tenants.wbTokenHealthStatus,
      wbTokenCheckedAt: tenants.wbTokenCheckedAt,
      wbLkSessionStatus: tenants.wbLkSessionStatus,
    })
    .from(userTenants)
    .leftJoin(tenants, eq(userTenants.tenantId, tenants.id))
    .where(eq(userTenants.userId, user.id)),
  );

  return results.map((row) => ({
    ...row,
    featurePermissions: resolveTenantFeaturePermissions(row.role, row.featurePermissions),
    wbTokenHealthStatus: normalizeWbTokenHealthStatus(row.wbTokenHealthStatus),
    wbLkSessionStatus: normalizeWbLkSessionStatus(row.wbLkSessionStatus),
  }));
}

/**
 * Сменить активный кабинет
 */
export async function switchActiveTenant(tenantId: string) {
  const authenticatedUser = await requireAuthenticatedUser();
  const impersonation = await getActivePlatformImpersonationSessionForUser(authenticatedUser.id);

  if (impersonation) {
    const availableTenants = await getAvailableTenants();
    const target = availableTenants.find((tenant) => tenant.id === tenantId);

    if (!target?.id) {
      throw new Error('Этот кабинет не относится к текущему клиентскому аккаунту');
    }

    await withAdminContext(db, async (tx) => {
      await tx
        .update(platformImpersonationSessions)
        .set({ tenantId })
        .where(eq(platformImpersonationSessions.id, impersonation.id));

      await tx.insert(platformAuditLog).values({
        actorUserId: authenticatedUser.id,
        actorRole: impersonation.actorRole,
        action: 'platform.impersonation.switch_tenant',
        entityType: 'platform_impersonation_session',
        entityId: impersonation.id,
        tenantId,
        before: { tenantId: impersonation.tenantId },
        after: { tenantId },
        reason: 'switch_active_tenant',
      });
    });

    await setActiveTenantCookie(tenantId);
    revalidatePath('/');

    return {
      success: true,
      role: 'owner',
      featurePermissions: ALL_TENANT_FEATURE_PERMISSIONS,
    };
  }

  const { user, access } = await requireTenantAccess(tenantId);
  await ensureLocalUserProfile(user.id, user.email ?? null);

  // Обновляем активный тенант в профиле
  await db.update(users)
    .set({ tenantId, role: access.role })
    .where(eq(users.id, user.id));

  // Bind the active tenant to an HttpOnly cookie so /api/views/** can
  // trust it without a client-supplied query param (P1-13).
  await setActiveTenantCookie(tenantId);

  revalidatePath('/');
  return {
    success: true,
    role: access.role,
    featurePermissions: resolveTenantFeaturePermissions(access.role, access.featurePermissions),
  };
}

/**
 * Добавить новый кабинет и привязать его к пользователю
 */
export async function addCabinet(
  name: string,
  token: string,
  _allowWarning = false,
  selectedPlanCode?: string,
): Promise<AddCabinetResult> {
  const user = await requireAuthenticatedUser();
  await ensureLocalUserProfile(user.id, user.email ?? null);

  const candidateToken = token.trim();
  if (!candidateToken) {
    throw new Error('Нельзя создать кабинет без API токена.');
  }

  const encryptedToken = encrypt(candidateToken);
  const storedHealth = buildPendingStoredTokenHealth();

  const createdState = await withAdminContext(db, async (tx) => {
    const [newTenant] = await tx.insert(tenants).values({
      name,
      wbApiToken: encryptedToken,
      shopName: name,
      wbTokenHealthStatus: storedHealth.status,
      wbTokenCheckedAt: new Date(storedHealth.checkedAt),
      wbTokenHealthSummary: storedHealth,
    }).returning();

    if (!newTenant) {
      throw new Error('Не удалось создать кабинет.');
    }

    await tx.insert(userTenants).values({
      userId: user.id,
      tenantId: newTenant.id,
      role: 'owner',
      accessPreset: 'all',
      featurePermissions: {},
    });

    await tx.update(users)
      .set({ tenantId: newTenant.id, role: 'owner' })
      .where(eq(users.id, user.id));

    const subscription = await createOnboardingTrialSubscription(tx, newTenant.id, selectedPlanCode);
    await markLeadTrialStarted(tx, {
      email: user.email ?? null,
      userId: user.id,
      tenantId: newTenant.id,
      selectedPlanCode: subscription.planCode,
    });

    return {
      tenantId: newTenant.id,
      subscription,
    };
  });

  await setActiveTenantCookie(createdState.tenantId);
  await scheduleNewCabinetBackgroundSetup(createdState.tenantId);

  revalidatePath('/');
  revalidatePath('/settings');
  return {
    created: true,
    success: true,
    tenantId: createdState.tenantId,
    role: 'owner' as const,
    featurePermissions: resolveTenantFeaturePermissions('owner', {}),
    storedHealth,
    subscription: createdState.subscription,
  };
}
