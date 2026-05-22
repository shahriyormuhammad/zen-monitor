/**
 * Интерактивный WB ЛК login flow с поддержкой inline CAPTCHA через SSE.
 *
 * Запускается из API endpoint /api/admin/wb-lk-auth/start. Работает асинхронно
 * (не блокирует request), общается с UI через `auth-channel`:
 *   - pushEvent({type: 'status'/'captcha_image'/'sms_required'/...}) → UI рендерит
 *   - awaitUserResponse() → UI присылает captcha_answer / sms_code
 *
 * После успешного входа извлекает WBTokenV3 и сохраняет storage state.
 */

import { eq } from 'drizzle-orm';
import { chromium, type Browser, type Page } from 'playwright';

import { db } from '@/lib/db';
import { tenants } from '@/lib/db/schema';
import { logger } from '@/lib/logger';
import { checkTenantWbLkRefreshFlow } from '@/server/wb/lk-refresh-flow';

import {
  awaitUserResponse,
  closeSession,
  pushEvent,
  type UserResponse,
} from './auth-channel';
import {
  loadStorageStateSession,
  persistStorageStateFromContext,
  type StorageStateSession,
} from './storage-state';
import { extractAndPersistWbTokenV3 } from './token-v3';

const CAPTCHA_SELECTORS = [
  'iframe[src*="captcha" i]',
  'iframe[src*="smartcaptcha" i]',
  '[data-testid*="captcha" i]',
  '[class*="captcha" i]:not(input)',
  'img[alt*="капч" i]',
  'img[src*="captcha" i]',
];

const SMS_SELECTORS = [
  // WB Партнёры: модальное окно <div id="Portal-modal"> с
  // <div class="CodeInputContentView__code-wrapper-..."> внутри. Это
  // overlay поверх формы телефона. Исключаем readonly и phone-input —
  // phone-input иногда остаётся в DOM как readonly под модалкой и
  // нашими общими селекторами ловится как «один из CodeInput-инпутов».
  'div[id*="Portal-modal" i] [class*="CodeInput" i] input:not([readonly]):not([data-testid*="phone" i])',
  '[class*="CodeInput" i] input:not([readonly]):not([data-testid*="phone" i])',
  'div[id*="Portal-modal" i] input[inputmode="numeric"]:not([readonly]):not([data-testid*="phone" i])',
  'input[autocomplete="one-time-code"]:not([readonly])',
  'input[placeholder*="код" i]:not([readonly]):not([data-testid*="phone" i])',
  'input[placeholder*="смс" i]:not([readonly])',
  'input[name*="code" i]:not([readonly])',
  'input[name*="sms" i]:not([readonly])',
];

// Селекторы для повторного ввода телефона (WB после SMS просит подтвердить
// номер ещё раз — двухступенчатая авторизация в wb partners).
const PHONE_INPUT_SELECTORS = [
  'input[type=tel]',
  'input[inputmode=numeric][placeholder*="999" i]',
  'input[placeholder*="мобильн" i]',
  'input[placeholder*="телефон" i]',
];

// Текстовые маркеры что страница просит подтвердить номер (даже если input не нашёлся).
const PHONE_PAGE_TEXT_MARKERS = [
  'введите номер',
  'отправим на него код',
  'номер мобильного',
];

const SUCCESS_URL_PARTS = ['seller.wildberries.ru', 'cmp.wildberries.ru'];

function isSuccessUrl(url: string): boolean {
  return SUCCESS_URL_PARTS.some((p) => url.includes(p)) && !/login|auth|passport/i.test(url);
}

function normalizePhone(input: string): string {
  // WB seller-auth страница имеет встроенный префикс «+7» в маске поля.
  // Если передавать «+79260454344» (12 знаков), получится двойной префикс
  // «+7 + 79260454344» → «+7 792 604-54-344» (некорректный номер).
  // Решение: всегда передавать только последние 10 цифр без кода страны.
  const digits = input.replace(/\D/g, '');
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
}

async function elementVisible(page: Page, selectors: string[]): Promise<{
  found: true;
  selector: string;
} | { found: false }> {
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 500 }).catch(() => false)) {
        return { found: true, selector: sel };
      }
    } catch {
      /* skip */
    }
  }
  return { found: false };
}

/**
 * Отправка формы: на WB-страницах после прохождения шага старая submit-кнопка
 * остаётся в DOM (просто disabled), и `button[type=submit]` находит обе.
 * Поэтому ищем только enabled-кнопку. Если не нашли — fallback на Enter в поле.
 */
async function submitForm(
  page: Page,
  options: {
    sessionId: string;
    inputLocator: { press: (key: string) => Promise<void> };
    customSelector?: string | null;
  },
): Promise<'clicked' | 'enter' | 'failed'> {
  // Сначала пробуем custom селектор если задан, иначе общий enabled-only.
  const enabledSubmitSelectors = [
    options.customSelector,
    'button[type=submit]:not([disabled])',
    'button[type=submit][aria-disabled="false"]',
    'button:not([disabled])[data-testid*="submit" i]',
  ].filter(Boolean) as string[];

  // Сначала ждём пока какая-нибудь специфичная phone/sms-submit кнопка
  // станет enabled (валидация WB пропустит). Это страхует от click по
  // случайной кнопке (language/help/etc), которая type=submit но не нашей.
  const specificSelectors = [
    'button[data-testid*="submit-phone" i]:not([disabled])',
    'button[data-testid*="submit-sms" i]:not([disabled])',
    'button[data-testid*="submit-code" i]:not([disabled])',
    'button[data-testid*="submit" i]:not([disabled])',
  ];
  for (const sel of specificSelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await btn.click({ timeout: 5_000 });
        pushEvent(options.sessionId, { type: 'log', level: 'info', message: `Кликнул specific submit: ${sel}` });
        return 'clicked';
      }
    } catch {
      /* try next */
    }
  }
  for (const sel of enabledSubmitSelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 1_000 }).catch(() => false)) {
        await btn.click({ timeout: 5_000 });
        pushEvent(options.sessionId, { type: 'log', level: 'info', message: `Кликнул enabled submit: ${sel}` });
        return 'clicked';
      }
    } catch {
      /* try next */
    }
  }

  // Fallback на Enter из input.
  try {
    await options.inputLocator.press('Enter');
    pushEvent(options.sessionId, { type: 'log', level: 'info', message: 'Submit через Enter (enabled-кнопок не нашёл)' });
    return 'enter';
  } catch (err) {
    pushEvent(options.sessionId, { type: 'log', level: 'warn', message: `Не смог отправить форму: ${(err as Error).message}` });
    return 'failed';
  }
}

async function takeCaptchaScreenshot(page: Page, selector: string): Promise<string | null> {
  try {
    const el = page.locator(selector).first();
    const buf = await el.screenshot({ type: 'png', timeout: 5000 });
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch (error) {
    logger.warn({ err: error, selector }, '[wb-lk-interactive-login] captcha screenshot failed');
    return null;
  }
}

async function fillPhoneWithoutPointer(
  page: Page,
  selector: string,
  phoneToFill: string,
  options: { sessionId: string },
): Promise<'filled' | 'already_success'> {
  if (isSuccessUrl(page.url())) {
    return 'already_success';
  }

  const phoneLocator = page.locator(selector).first();
  try {
    await phoneLocator.waitFor({ state: 'visible', timeout: 10_000 });
    if (isSuccessUrl(page.url())) {
      return 'already_success';
    }
    await phoneLocator.focus({ timeout: 5_000 });
    await phoneLocator.evaluate((el: HTMLInputElement) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      setter?.call(el, '');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await phoneLocator.pressSequentially(phoneToFill, { delay: 50, timeout: 15_000 });
    return 'filled';
  } catch (error) {
    await page.waitForLoadState('domcontentloaded', { timeout: 2_000 }).catch(() => {});
    if (isSuccessUrl(page.url())) {
      pushEvent(options.sessionId, {
        type: 'log',
        level: 'info',
        message: 'WB уже редиректнул в кабинет во время ввода телефона — считаю шаг успешным.',
      });
      return 'already_success';
    }
    throw error;
  }
}

async function waitForLoginOutcome(
  page: Page,
  options: { timeoutMs: number; sessionId: string },
): Promise<
  | { outcome: 'captcha'; screenshotDataUrl: string | null; selector: string }
  | { outcome: 'sms'; selector: string }
  | { outcome: 'phone_again'; selector: string }
  | { outcome: 'success' }
  | { outcome: 'unknown'; debug: string }
> {
  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() < deadline) {
    const url = page.url();
    if (isSuccessUrl(url)) {
      return { outcome: 'success' };
    }

    const captcha = await elementVisible(page, CAPTCHA_SELECTORS);
    if (captcha.found) {
      const screenshot = await takeCaptchaScreenshot(page, captcha.selector);
      return { outcome: 'captcha', screenshotDataUrl: screenshot, selector: captcha.selector };
    }

    const sms = await elementVisible(page, SMS_SELECTORS);
    if (sms.found) {
      return { outcome: 'sms', selector: sms.selector };
    }

    // Phone-again: WB после успешного SMS просит ещё раз ввести телефон
    // («Введите номер мобильного, мы отправим на него код для входа»).
    // ВАЖНО: проверяем что нет CodeInput-overlay — иначе phone-input может быть
    // под Portal-modal с CodeInputContentView, который реально перехватывает
    // pointer events и `click()` упадёт по таймауту. Сам Portal-modal как
    // контейнер может быть zero-size (isVisible=false), а его дочерний
    // CodeInputContentView — реальный overlay поверх phone-input.
    const codeInputOverlayVisible = await elementVisible(page, [
      '[class*="CodeInputContentView" i]',
      'div[id*="Portal-modal" i] [class*="CodeInput" i]',
    ]);
    if (!codeInputOverlayVisible.found) {
      const phone = await elementVisible(page, PHONE_INPUT_SELECTORS);
      if (phone.found) {
        try {
          const bodyText = await page.evaluate(() => (document.body?.innerText ?? '').toLowerCase());
          if (PHONE_PAGE_TEXT_MARKERS.some((m) => bodyText.includes(m))) {
            return { outcome: 'phone_again', selector: phone.selector };
          }
        } catch {
          /* skip */
        }
      }
    }

    await page.waitForTimeout(700);
  }

  const debugUrl = page.url();
  return { outcome: 'unknown', debug: `URL: ${debugUrl}` };
}

export type RunInteractiveLoginParams = {
  sessionId: string;
  tenantId: string;
  phone: string;
};

/**
 * Главная функция interactive login. Не возвращает результат напрямую — всё
 * через channel. Должна быть запущена в background (без `await` от endpoint).
 */
export async function runInteractiveWbLkLogin(params: RunInteractiveLoginParams): Promise<void> {
  const { sessionId, tenantId, phone } = params;
  const log = logger.child({ sessionId, tenantId, scope: 'wb-lk-interactive-login' });

  const loginUrl = process.env.WB_RPA_LOGIN_URL?.trim();
  const loginSelector = process.env.WB_RPA_LOGIN_SELECTOR?.trim();
  const submitSelector = process.env.WB_RPA_SUBMIT_SELECTOR?.trim();
  const smsCodeSelector = process.env.WB_RPA_SMS_CODE_SELECTOR?.trim();
  const smsSubmitSelector = process.env.WB_RPA_SMS_SUBMIT_SELECTOR?.trim();
  const captchaInputSelector = process.env.WB_RPA_CAPTCHA_INPUT_SELECTOR?.trim() || 'input[placeholder*="код" i]:not([autocomplete="one-time-code"])';
  const captchaSubmitSelector = process.env.WB_RPA_CAPTCHA_SUBMIT_SELECTOR?.trim() || submitSelector;
  const headless = process.env.WB_RPA_HEADLESS !== 'false';
  const stepTimeoutMs = Number.parseInt(process.env.WB_RPA_INTERACTIVE_STEP_TIMEOUT_MS ?? '300000', 10);

  if (!loginUrl || !loginSelector || !submitSelector) {
    pushEvent(sessionId, {
      type: 'log', level: 'error',
      message: 'Не настроены WB_RPA_LOGIN_URL / WB_RPA_LOGIN_SELECTOR / WB_RPA_SUBMIT_SELECTOR в .env',
    });
    closeSession(sessionId, false, 'env-not-configured');
    return;
  }

  let browser: Browser | null = null;
  let sessionHandle: StorageStateSession | null = null;
  try {
    pushEvent(sessionId, { type: 'status', status: 'connecting', message: 'Открываю Chromium на сервере…' });
    try {
      browser = await chromium.launch({
        headless,
        // --no-sandbox: для запуска от root в production-контейнере.
        // --disable-dev-shm-usage: избегает падений из-за маленького /dev/shm.
        // --disable-blink-features=AutomationControlled: убирает navigator.webdriver
        //   и AutomationControlled features — главный антидетект для Playwright.
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled',
        ],
      });
    } catch (launchError) {
      const msg = launchError instanceof Error ? launchError.message : String(launchError);
      const friendly = /Executable doesn't exist|chrome-headless-shell/.test(msg)
        ? 'Chromium не установлен на сервере. Запустите на хосте: `npx playwright install chromium`.'
        : `Не удалось запустить браузер: ${msg}`;
      pushEvent(sessionId, { type: 'log', level: 'error', message: friendly });
      pushEvent(sessionId, { type: 'status', status: 'failed', message: friendly });
      closeSession(sessionId, false, friendly);
      return;
    }
    sessionHandle = await loadStorageStateSession(tenantId);
    if (sessionHandle) {
      pushEvent(sessionId, {
        type: 'log',
        level: 'info',
        message: 'Загружена сохранённая WB ЛК-сессия: повторный вход пойдёт с тем же browser/device контекстом.',
      });
    }

    const context = await browser.newContext({
      ...(sessionHandle ? { storageState: sessionHandle.tempPath } : {}),
      locale: 'ru-RU',
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    });
    // Anti-bot stealth: убираем navigator.webdriver=true.
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
    const page = await context.newPage();

    pushEvent(sessionId, { type: 'log', level: 'info', message: `Иду на ${loginUrl}` });
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });

    const phoneToFill = normalizePhone(phone);
    if (isSuccessUrl(page.url())) {
      pushEvent(sessionId, { type: 'log', level: 'info', message: 'Сохранённая WB ЛК-сессия сразу открыла кабинет — телефон повторно не ввожу.' });
    } else {
      pushEvent(sessionId, { type: 'status', status: 'awaiting_phone', message: 'Ввожу номер телефона…' });
      pushEvent(sessionId, { type: 'log', level: 'info', message: `Заполняю в "${loginSelector}" 10 цифр: ${phoneToFill}` });
      // Не кликаем по phone-input: при сохранённой сессии WB может редиректнуть
      // в кабинет прямо во время actionability-check, и DOM поля исчезает.
      const fillResult = await fillPhoneWithoutPointer(page, loginSelector, phoneToFill, { sessionId });
      if (fillResult === 'filled') {
        const phoneLocator = page.locator(loginSelector).first();
        // Дожидаемся пока WB-валидация активирует phone-submit-button (или любую
        // submit-кнопку с testid). Если не дождались за 5 сек — пишем warning,
        // submitForm всё равно попробует.
        try {
          await page.waitForSelector('button[data-testid*="submit-phone" i]:not([disabled]), button[data-testid*="submit" i]:not([disabled])', { timeout: 5_000 });
          pushEvent(sessionId, { type: 'log', level: 'info', message: 'Phone-submit стала enabled — кликаю' });
        } catch {
          pushEvent(sessionId, { type: 'log', level: 'warn', message: 'Phone-submit за 5 сек не стала enabled — возможно валидация не пропускает номер' });
        }
        await submitForm(page, { sessionId, inputLocator: phoneLocator, customSelector: submitSelector });
        // Даём WB время отреагировать на submit (anti-bot задержка / network).
        await page.waitForTimeout(2_000);
      }
    }

    // Цикл: ждём CAPTCHA / SMS / success. Может быть несколько раундов.
    // Loop-protection: считаем повторения одного и того же outcome.
    const outcomeCounts = new Map<string, number>();
    let lastUrl = page.url();
    for (let round = 0; round < 6; round++) {
      const outcome = await waitForLoginOutcome(page, { timeoutMs: 60_000, sessionId });
      const key = outcome.outcome;
      const prevCount = outcomeCounts.get(key) ?? 0;
      outcomeCounts.set(key, prevCount + 1);
      const currentUrl = page.url();
      pushEvent(sessionId, { type: 'log', level: 'info', message: `Round ${round + 1}: outcome=${key}, URL=${currentUrl}` });
      if ((key === 'phone_again' || key === 'unknown') && prevCount >= 1 && currentUrl === lastUrl) {
        const reason = `Цикл: WB повторно показывает «${key}» без прогресса (URL не меняется). Возможно anti-bot или ошибка валидации в самом WB.`;
        pushEvent(sessionId, { type: 'log', level: 'error', message: reason });
        closeSession(sessionId, false, 'no-progress-loop');
        return;
      }
      lastUrl = currentUrl;

      if (outcome.outcome === 'success') {
        break;
      }

      if (outcome.outcome === 'captcha') {
        if (!outcome.screenshotDataUrl) {
          pushEvent(sessionId, { type: 'log', level: 'error', message: 'CAPTCHA увидел, но скриншот не получился. Скорее всего Yandex SmartCaptcha (интерактивная) — нужен live view.' });
          closeSession(sessionId, false, 'captcha-screenshot-failed');
          return;
        }
        pushEvent(sessionId, { type: 'status', status: 'awaiting_captcha', message: 'WB просит проверочный код с картинки' });
        pushEvent(sessionId, { type: 'captcha_image', dataUrl: outcome.screenshotDataUrl, hint: 'Введите код с картинки' });

        let response: UserResponse;
        try {
          response = await awaitUserResponse(sessionId, stepTimeoutMs);
        } catch (error) {
          pushEvent(sessionId, { type: 'log', level: 'error', message: `Юзер не ответил: ${(error as Error).message}` });
          closeSession(sessionId, false, 'captcha-timeout');
          return;
        }
        if (response.type === 'cancel') {
          closeSession(sessionId, false, 'cancelled');
          return;
        }
        if (response.type !== 'captcha_answer') {
          pushEvent(sessionId, { type: 'log', level: 'warn', message: `Ожидал captcha_answer, пришёл ${response.type}` });
          closeSession(sessionId, false, 'unexpected-response');
          return;
        }
        try {
          const captchaLocator = page.locator(captchaInputSelector).first();
          await captchaLocator.fill(response.answer, { timeout: 10_000 });
          await submitForm(page, { sessionId, inputLocator: captchaLocator, customSelector: captchaSubmitSelector });
        } catch (error) {
          pushEvent(sessionId, { type: 'log', level: 'error', message: `Не нашёл поле ввода CAPTCHA: ${(error as Error).message}` });
          closeSession(sessionId, false, 'captcha-fill-failed');
          return;
        }
        continue; // следующий раунд: ждём SMS или success
      }

      if (outcome.outcome === 'phone_again') {
        // WB просит ещё раз ввести номер телефона (двухступенчатая авторизация
        // в wb partners). Заполняем автоматически тот же номер.
        pushEvent(sessionId, { type: 'status', status: 'awaiting_phone', message: 'WB просит подтвердить номер ещё раз — заполняю автоматически' });
        try {
          // Шаг 1. Если от прошлого SMS-шага в DOM остался Portal-modal с
          // CodeInputContentView — он перехватывает pointer events и `click()`
          // по phone-input падает по таймауту. Закрываем overlay через
          // close-кнопку или Escape, ждём пока скроется.
          const overlayLocator = page.locator(
            '[class*="CodeInputContentView" i], div[id*="Portal-modal" i] [class*="CodeInput" i]',
          ).first();
          if (await overlayLocator.isVisible({ timeout: 500 }).catch(() => false)) {
            pushEvent(sessionId, { type: 'log', level: 'info', message: 'CodeInput-overlay остался — пытаюсь закрыть' });
            const closeBtn = page.locator(
              '[id*="Portal-modal" i] button[aria-label*="закр" i], [id*="Portal-modal" i] button[aria-label*="close" i], [id*="Portal-modal" i] button[class*="close" i], [id*="Portal-modal" i] [class*="close" i][role="button"]',
            ).first();
            if (await closeBtn.isVisible({ timeout: 500 }).catch(() => false)) {
              await closeBtn.click({ timeout: 3_000, force: true }).catch(() => {});
            } else {
              await page.keyboard.press('Escape').catch(() => {});
            }
            await overlayLocator.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {
              pushEvent(sessionId, { type: 'log', level: 'warn', message: 'Overlay не скрылся за 5с — продолжаю через focus/JS-fill' });
            });
          }

          // Шаг 2. Работаем с phone-input через focus() + JS-clear +
          // pressSequentially. Это обходит pointer-event interception:
          // focus() не требует click, JS-set value не требует pointer events,
          // pressSequentially печатает в focused элементе.
          const phoneAgainLocator = page.locator(outcome.selector).first();
          try {
            await phoneAgainLocator.click({ timeout: 3_000 });
          } catch {
            pushEvent(sessionId, { type: 'log', level: 'info', message: 'click() по phone-input заблокирован — переключаюсь на focus()' });
            await phoneAgainLocator.focus({ timeout: 5_000 });
          }
          await phoneAgainLocator.evaluate((el: HTMLInputElement) => {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
            setter?.call(el, '');
            el.dispatchEvent(new Event('input', { bubbles: true }));
          });
          await phoneAgainLocator.pressSequentially(phoneToFill, { delay: 50, timeout: 15_000 });
          await submitForm(page, { sessionId, inputLocator: phoneAgainLocator, customSelector: submitSelector });
        } catch (error) {
          pushEvent(sessionId, { type: 'log', level: 'error', message: `Не смог повторно заполнить телефон: ${(error as Error).message}` });
          closeSession(sessionId, false, 'phone-again-failed');
          return;
        }
        continue;
      }

      if (outcome.outcome === 'sms') {
        // Приоритет — selector от детектора (он специфичнее: CodeInput/Portal-modal),
        // env-fallback только если детектор дал общий selector.
        const detectorIsSpecific = /CodeInput|Portal-modal/i.test(outcome.selector);
        const smsSel = detectorIsSpecific ? outcome.selector : (smsCodeSelector || outcome.selector);
        pushEvent(sessionId, { type: 'log', level: 'info', message: `SMS selector: ${smsSel} (specific=${detectorIsSpecific})` });
        pushEvent(sessionId, { type: 'status', status: 'awaiting_sms', message: 'WB отправил SMS' });
        pushEvent(sessionId, { type: 'sms_required', hint: 'Введите 6-значный код из SMS' });

        let response: UserResponse;
        try {
          response = await awaitUserResponse(sessionId, stepTimeoutMs);
        } catch (error) {
          pushEvent(sessionId, { type: 'log', level: 'error', message: `Юзер не ответил: ${(error as Error).message}` });
          closeSession(sessionId, false, 'sms-timeout');
          return;
        }
        if (response.type === 'cancel') {
          closeSession(sessionId, false, 'cancelled');
          return;
        }
        if (response.type !== 'sms_code') {
          pushEvent(sessionId, { type: 'log', level: 'warn', message: `Ожидал sms_code, пришёл ${response.type}` });
          closeSession(sessionId, false, 'unexpected-response');
          return;
        }
        try {
          const smsLocator = page.locator(smsSel).first();
          const isCodeInput = /CodeInput|Portal-modal/i.test(smsSel);

          if (isCodeInput) {
            // CodeInputContentView в WB Партнёры — N отдельных input'ов
            // (по 1 цифре). Считаем сколько их и заполняем каждый по очереди.
            const allInputs = page.locator(smsSel);
            const count = await allInputs.count();
            pushEvent(sessionId, { type: 'log', level: 'info', message: `Нашёл ${count} input'ов в CodeInput, цифр ввести: ${response.code.length}` });
            if (count >= response.code.length) {
              // По одной цифре в каждый input + dispatchEvent для onChange.
              for (let i = 0; i < response.code.length; i++) {
                const digit = response.code[i] ?? '';
                await allInputs.nth(i).click({ timeout: 3_000 });
                await allInputs.nth(i).fill(digit);
              }
              pushEvent(sessionId, { type: 'log', level: 'info', message: `SMS: заполнил ${response.code.length} input'ов посимвольно` });
            } else {
              // Один контейнер-input — focus + keyboard.type.
              await smsLocator.click({ timeout: 5_000 });
              await page.keyboard.type(response.code, { delay: 80 });
              pushEvent(sessionId, { type: 'log', level: 'info', message: `SMS: keyboard.type (count=${count})` });
            }
          } else {
            await smsLocator.fill(response.code, { timeout: 10_000 });
            pushEvent(sessionId, { type: 'log', level: 'info', message: `SMS: ввёл через fill` });
          }

          // Ищем submit ВНУТРИ модалки (если она есть), чтобы не схватить
          // disabled-кнопку из основной формы под модалкой.
          const submitSelectors: (string | null | undefined)[] = isCodeInput
            ? [
                'div[id*="Portal-modal" i] button:not([disabled])',
                'div[id*="Portal-modal" i] button[type=submit]:not([disabled])',
                smsSubmitSelector,
              ]
            : [smsSubmitSelector];
          let submitted = false;
          for (const sel of submitSelectors) {
            if (!sel) continue;
            try {
              const btn = page.locator(sel).first();
              if (await btn.isVisible({ timeout: 1_000 }).catch(() => false)) {
                await btn.click({ timeout: 5_000 });
                pushEvent(sessionId, { type: 'log', level: 'info', message: `Кликнул submit в модалке: ${sel}` });
                submitted = true;
                break;
              }
            } catch {
              /* try next */
            }
          }
          if (!submitted) {
            // Fallback на enabled-only через общий submitForm (Enter из последнего input).
            const lastInput = isCodeInput
              ? page.locator(smsSel).last()
              : smsLocator;
            await submitForm(page, { sessionId, inputLocator: lastInput, customSelector: undefined });
          }
        } catch (error) {
          pushEvent(sessionId, { type: 'log', level: 'error', message: `Не нашёл поле SMS: ${(error as Error).message}` });
          closeSession(sessionId, false, 'sms-fill-failed');
          return;
        }
        continue; // следующий раунд: ждём success или ещё CAPTCHA
      }

      // unknown — снимаем full-page screenshot и текст для диагностики.
      try {
        const fullScreenshot = await page.screenshot({ type: 'png', fullPage: false, timeout: 5000 });
        const dataUrl = `data:image/png;base64,${fullScreenshot.toString('base64')}`;
        pushEvent(sessionId, {
          type: 'captcha_image',
          dataUrl,
          hint: 'Скриншот текущей страницы WB (для диагностики). Если видите CAPTCHA/SMS — введите код ниже; если что-то ещё — скажите разработчику.',
        });
      } catch (screenshotError) {
        pushEvent(sessionId, { type: 'log', level: 'warn', message: `Скриншот не удался: ${(screenshotError as Error).message}` });
      }
      try {
        const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 600) ?? '');
        pushEvent(sessionId, { type: 'log', level: 'warn', message: `Текст страницы: ${bodyText.replace(/\s+/g, ' ').slice(0, 400)}` });
      } catch {
        /* skip */
      }
      pushEvent(sessionId, { type: 'log', level: 'error', message: `Не понял что показывает WB. ${outcome.debug}. Скриншот выше.` });
      // Не закрываем сессию сразу — даём юзеру шанс ввести код вручную глядя на скриншот.
      pushEvent(sessionId, { type: 'status', status: 'awaiting_captcha', message: 'Глядя на скриншот: если видите CAPTCHA — введите её' });
      let response: UserResponse;
      try {
        response = await awaitUserResponse(sessionId, stepTimeoutMs);
      } catch (err) {
        closeSession(sessionId, false, `unknown-state-timeout: ${(err as Error).message}`);
        return;
      }
      if (response.type === 'cancel') {
        closeSession(sessionId, false, 'cancelled');
        return;
      }
      // Что бы юзер ни ввёл — пробуем заполнить через наиболее общий селектор.
      const text = response.type === 'captcha_answer' ? response.answer : response.type === 'sms_code' ? response.code : '';
      if (!text) {
        closeSession(sessionId, false, 'unknown-state-empty-response');
        return;
      }
      try {
        // Пробуем найти любое видимое input-поле и заполнить.
        const visibleInputs = await page.locator('input:visible').all();
        if (visibleInputs.length > 0) {
          await visibleInputs[0]!.fill(text);
          await page.keyboard.press('Enter');
        } else {
          pushEvent(sessionId, { type: 'log', level: 'error', message: 'Видимого input-поля на странице нет.' });
          closeSession(sessionId, false, 'no-input');
          return;
        }
      } catch (fillError) {
        pushEvent(sessionId, { type: 'log', level: 'error', message: `Не удалось заполнить: ${(fillError as Error).message}` });
        closeSession(sessionId, false, 'fill-failed');
        return;
      }
      continue;
    }

    pushEvent(sessionId, { type: 'status', status: 'finalizing', message: 'Проверяю что вход реальный…' });

    // ВЕРИФИКАЦИЯ: success-URL может быть false-positive если WB сделал
    // редирект на seller.wildberries.ru/?error= или похожий. Реальный
    // признак входа — наличие auth-cookies в context.
    const allCookies = await context.cookies();
    const cookieNames = allCookies.map((c) => c.name);
    const AUTH_COOKIE_NAMES = ['WBTokenV3', 'WBToken', 'wbx-validation-key', 'x-supplier-id-external'];
    const hasAnyAuthCookie = AUTH_COOKIE_NAMES.some((n) => cookieNames.includes(n));
    pushEvent(sessionId, { type: 'log', level: 'info', message: `Cookies на финале: ${cookieNames.length}, auth-куки: ${AUTH_COOKIE_NAMES.filter((n) => cookieNames.includes(n)).join(', ') || 'НЕТ'}` });

    if (!hasAnyAuthCookie) {
      // False-positive success — никаких auth-куков нет. Пишем диагностику.
      try {
        const fullScreenshot = await page.screenshot({ type: 'png', fullPage: false, timeout: 5000 });
        pushEvent(sessionId, {
          type: 'captcha_image',
          dataUrl: `data:image/png;base64,${fullScreenshot.toString('base64')}`,
          hint: 'Финальный скриншот WB. Реальный вход не подтверждён (нет auth-cookies).',
        });
      } catch { /* skip */ }
      const reason = `Реальный вход не подтверждён: WB не выдал auth-куки. Возможно WB заблокировал по anti-bot или вход не завершился. URL: ${page.url()}`;
      pushEvent(sessionId, { type: 'log', level: 'error', message: reason });
      pushEvent(sessionId, { type: 'status', status: 'failed', message: reason });
      await db.update(tenants)
        .set({
          wbLkSessionStatus: 'invalid',
          wbLkSessionCheckedAt: new Date(),
          wbLkSessionError: reason.slice(0, 1000),
        })
        .where(eq(tenants.id, tenantId))
        .catch(() => { /* skip */ });
      closeSession(sessionId, false, 'auth-cookies-missing');
      return;
    }

    pushEvent(sessionId, { type: 'status', status: 'finalizing', message: 'Сохраняю сессию…' });

    // Полный список cookies для диагностики (имя@домен), чтобы видеть на
    // каком домене WB реально кладёт WBTokenV3 / wbx-validation-key.
    pushEvent(sessionId, {
      type: 'log',
      level: 'info',
      message: `Все cookies: ${allCookies.map((c) => `${c.name}@${c.domain}`).slice(0, 30).join(', ')}`,
    });

    // WB иногда выдаёт WBTokenV3 не сразу на seller-auth, а после захода
    // в seller.wildberries.ru (главная кабинета). Если V3 ещё нет —
    // навигируем туда и ждём networkidle, чтобы WB успел выставить cookie.
    if (!cookieNames.includes('WBTokenV3')) {
      pushEvent(sessionId, { type: 'log', level: 'info', message: 'WBTokenV3 нет — иду в seller.wildberries.ru, чтобы WB выставил токен' });
      const currentUrl = page.url();
      try {
        if (!currentUrl.startsWith('https://seller.wildberries.ru')) {
          await page.goto('https://seller.wildberries.ru/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
        }
        await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => { /* WB SPA может не достичь idle */ });
        await page.waitForTimeout(2_000);
      } catch (navErr) {
        pushEvent(sessionId, { type: 'log', level: 'warn', message: `Navigate в кабинет: ${(navErr as Error).message}` });
      }
      const refreshedCookies = await context.cookies();
      const refreshedNames = refreshedCookies.map((c) => c.name);
      pushEvent(sessionId, {
        type: 'log',
        level: 'info',
        message: `После navigate: ${refreshedCookies.length} cookies, новые auth: ${AUTH_COOKIE_NAMES.filter((n) => refreshedNames.includes(n) && !cookieNames.includes(n)).join(', ') || 'нет новых'}`,
      });
    }

    // Сохраняем storageState (cookies + localStorage) — после navigate,
    // чтобы захватить свежие cookies.
    await persistStorageStateFromContext(tenantId, context);

    // Извлекаем WBTokenV3 — тоже после navigate.
    const tokenSaved = await extractAndPersistWbTokenV3(tenantId, context);
    if (tokenSaved) {
      pushEvent(sessionId, { type: 'log', level: 'info', message: 'WBTokenV3 извлечён и сохранён' });
    } else {
      pushEvent(sessionId, { type: 'log', level: 'warn', message: 'WBTokenV3 не нашли в cookies (продолжаем через storageState)' });
    }

    const lkCheck = await checkTenantWbLkRefreshFlow(tenantId, {
      persistHealth: true,
      timeoutMs: 15_000,
    });
    pushEvent(sessionId, {
      type: 'log',
      level: lkCheck.ok ? 'info' : 'error',
      message: `WB LK refresh-flow: ${lkCheck.code}; auth=${lkCheck.authHttpStatus ?? '-'}, read=${lkCheck.readOnlyHttpStatus ?? '-'}; ${lkCheck.message}`,
    });
    if (!lkCheck.ok) {
      const reason = `Вход WB ЛК не подтверждён read-only проверкой: ${lkCheck.message}`;
      pushEvent(sessionId, { type: 'status', status: 'failed', message: reason });
      closeSession(sessionId, false, reason);
      return;
    }

    // Обновляем статус сессии в tenants
    await db.update(tenants)
      .set({
        wbLkPhone: phone,
        wbLkSessionStatus: 'healthy',
        wbLkSessionCheckedAt: new Date(),
        wbLkSessionError: null,
      })
      .where(eq(tenants.id, tenantId));

    pushEvent(sessionId, { type: 'status', status: 'success', message: 'Готово — вы вошли в WB ЛК' });
    closeSession(sessionId, true, 'login-success');
    log.info('login flow finished successfully');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ err: error }, 'login flow failed');
    pushEvent(sessionId, { type: 'log', level: 'error', message: `Ошибка: ${message}` });
    pushEvent(sessionId, { type: 'status', status: 'failed', message });

    await db.update(tenants)
      .set({
        wbLkSessionStatus: 'invalid',
        wbLkSessionCheckedAt: new Date(),
        wbLkSessionError: message.slice(0, 1000),
      })
      .where(eq(tenants.id, tenantId))
      .catch((dbErr) => log.error({ err: dbErr }, 'failed to update tenant session status'));

    closeSession(sessionId, false, message);
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (sessionHandle) {
      await sessionHandle.cleanup().catch(() => {});
    }
  }
}
