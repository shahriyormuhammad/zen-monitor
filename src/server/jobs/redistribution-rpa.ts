import { access, mkdir } from "node:fs/promises";
import { join } from "node:path";

import { and, desc, eq, inArray } from "drizzle-orm";
import { NonRetriableError } from "inngest";
import { chromium, type Locator, type Page } from "playwright";

import { inngest } from "@/inngest/client";
import { handleInngestFailure } from "@/inngest/on-failure";
import { db, withTenantContext } from "@/lib/db";
import { logger } from "@/lib/logger";
import { redistributionItems, redistributionRuns } from "@/lib/db/schema";
import { cleanupOutputArtifacts } from "@/lib/output-retention";
import { resolvePersistentOutputDir } from "@/lib/runtime-paths";
import { buildWbRedistributionUrlCandidates } from "@/lib/wb-rpa/redistribution-target";
import {
  loadStorageStateSession,
  persistStorageStateFromContext,
  type StorageStateSession,
} from "@/lib/wb-rpa/storage-state";
import { saveRouteAvailabilityResult } from "@/server/redistribution/route-scan";

const REDISTRIBUTION_RPA_EVENT = "wb/redistribution.rpa.requested";
const WB_RPA_HEADLESS = process.env.WB_RPA_HEADLESS !== "false";
const WB_RPA_TIMEOUT_MS = (() => {
  const parsed = Number.parseInt(process.env.WB_RPA_TIMEOUT_MS ?? "90000", 10);
  if (!Number.isFinite(parsed) || parsed < 10_000) {
    return 90_000;
  }
  return Math.min(600_000, parsed);
})();
const WB_RPA_FAILURE_RETENTION_DAYS = (() => {
  const parsed = Number.parseInt(process.env.WB_RPA_FAILURE_RETENTION_DAYS ?? "7", 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 7;
  }
  return Math.min(parsed, 90);
})();
const WB_RPA_FAILURE_MAX_FILES = (() => {
  const parsed = Number.parseInt(process.env.WB_RPA_FAILURE_MAX_FILES ?? "1000", 10);
  if (!Number.isFinite(parsed) || parsed < 50) {
    return 1000;
  }
  return Math.min(parsed, 10_000);
})();
const WB_RPA_FAILURE_CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
let lastWbRpaFailureCleanupAt = 0;

type RedistributionRpaRequestedEvent = {
  data: {
    tenantId: string;
    runId: string;
    csvFilePath?: string;
    csvFileName?: string;
  };
};

type RedistributionRpaItem = {
  id: string;
  nmId: number;
  vendorCode: string | null;
  sizeName: string;
  fromWarehouse: string;
  toWarehouse: string;
  transferUnits: number;
};

export type RedistributionRpaProbeItem = {
  nmId: number;
  vendorCode: string | null;
  sizeName: string;
  fromWarehouse: string;
  toWarehouse: string;
  transferUnits: number;
};

type RpaResolvedMode = "csv_upload" | "warehouse_remains_modal";

type RpaExecutionResult = {
  mode: "dry_run" | RpaResolvedMode;
  message: string;
  perItemStatusManaged: boolean;
  submittedItems: number;
};

function isWbOfferConditionUrl(url: string) {
  return /seller\.wildberries\.ru\/confirm-offer-condition\/view/i.test(url);
}

async function cleanupWbRpaFailureArtifactsIfNeeded() {
  const nowMs = Date.now();
  if (nowMs - lastWbRpaFailureCleanupAt < WB_RPA_FAILURE_CLEANUP_INTERVAL_MS) {
    return;
  }
  lastWbRpaFailureCleanupAt = nowMs;

  const failuresDir = resolvePersistentOutputDir("wb-rpa", "failures");
  const result = await cleanupOutputArtifacts({
    dir: failuresDir,
    kind: "file",
    maxAgeMs: WB_RPA_FAILURE_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    maxEntries: WB_RPA_FAILURE_MAX_FILES,
    matchName: /^redistribution-.*\.png$/i,
    nowMs,
  });

  if (result.removed > 0 || result.failed > 0) {
    logger.info(
      {
        dir: failuresDir,
        removed: result.removed,
        failed: result.failed,
        matched: result.matched,
        retentionDays: WB_RPA_FAILURE_RETENTION_DAYS,
        maxFiles: WB_RPA_FAILURE_MAX_FILES,
      },
      "[redistribution-rpa] cleaned failure artifacts",
    );
  }
}

function isWbAuthUrl(url: string) {
  return /seller-auth\.wildberries\.ru/i.test(url);
}


function getRequiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function getOptionalEnv(name: string) {
  const value = process.env[name]?.trim();
  return value || null;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeComparableWarehouse(value: string) {
  return value
    .toLowerCase()
    .replace(/[«»"']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function warehouseMatchesExpected(actual: string, expected: string) {
  const normalizedActual = normalizeComparableWarehouse(actual);
  const normalizedExpected = normalizeComparableWarehouse(expected);
  if (!normalizedActual || !normalizedExpected) {
    return false;
  }

  return normalizedActual.includes(normalizedExpected)
    || normalizedExpected.includes(normalizedActual);
}

function getRedistributionTriggerSelector() {
  return getOptionalEnv("WB_RPA_REDISTRIBUTION_TRIGGER_SELECTOR")
    || 'button:has-text("Перераспределить остатки"), a:has-text("Перераспределить остатки"), button:has-text("Перераспределить"), a:has-text("Перераспределить"), [role="button"]:has-text("Перераспределить"), [data-testid*="redistribution" i], [class*="redistribution" i] button';
}

function getRedistributionDialogSelector() {
  return getOptionalEnv("WB_RPA_REDISTRIBUTION_DIALOG_SELECTOR")
    || 'div[class*="Modal__"]:has-text("Перераспределить"), [role="dialog"]:has-text("Перераспределить"), div:has-text("Перераспределить остатки товара")';
}

function getArticleInputSelector() {
  return getOptionalEnv("WB_RPA_ARTICLE_SELECTOR")
    || 'input[placeholder*="артикул"], input[placeholder*="Артикул"]';
}

function getArticleSearchSelector() {
  return getOptionalEnv("WB_RPA_ARTICLE_SEARCH_SELECTOR")
    || 'input[name="search-name"], input#search[placeholder*="Поиск"]';
}

function getArticleOptionSelector() {
  return getOptionalEnv("WB_RPA_ARTICLE_OPTION_SELECTOR")
    || 'button[class*="Dropdown-option"], li[class*="Dropdown-list__item"]:not([class*="--search"]), div[class*="Custom-nm-option"], [role="option"]';
}

function getWarehouseInputSelector() {
  return getOptionalEnv("WB_RPA_WAREHOUSE_INPUT_SELECTOR")
    || 'input[placeholder*="Выберите склад"], input[placeholder*="выберите склад"]';
}

function getModalSubmitSelector() {
  return getOptionalEnv("WB_RPA_REDISTRIBUTION_SUBMIT_SELECTOR")
    || 'button:has-text("Перераспределить"), [role="button"]:has-text("Перераспределить")';
}

function getSizeSelector() {
  return getOptionalEnv("WB_RPA_SIZE_SELECTOR")
    || 'input[placeholder*="размер"], input[placeholder*="Размер"]';
}

function shouldUseVendorCodeArticleFallback() {
  const configured = process.env.WB_RPA_ARTICLE_ALLOW_VENDOR_CODE_FALLBACK?.trim().toLowerCase();
  if (!configured) {
    return true;
  }
  return configured === "true" || configured === "1" || configured === "yes";
}

function isWbDailyLimitError(message: string) {
  return /дневн.*лимит.*исчерпан|переместите товар с другого склада|попробуйте завтра/i.test(message);
}

function isNonCriticalWarehouseSelectionError(message: string) {
  return /поле склада-получателя не активировалось|не удалось выбрать склады в модалке|не удалось выбрать склад-получатель|кнопка .*перераспределить.*неактивна|склад[а\- ]получател/i.test(message);
}

async function resolveRedistributionTargetPage(input: {
  configuredUrl: string;
  page: Page;
  timeoutMs: number;
  fileInputSelector: string | null;
}) {
  const { configuredUrl, page, timeoutMs, fileInputSelector } = input;
  const candidates = buildWbRedistributionUrlCandidates(configuredUrl);
  const attemptedUrls: string[] = [];
  let lastNavigationError: string | null = null;
  const redistributionTriggerSelector = getRedistributionTriggerSelector();

  for (const candidateUrl of candidates) {
    attemptedUrls.push(candidateUrl);
    try {
      await page.goto(candidateUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
      await page.waitForTimeout(500);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastNavigationError = message;
      const interruptedByRedirect = /interrupted by another navigation/i.test(message);
      if (!interruptedByRedirect) {
        continue;
      }
      await page.waitForLoadState("domcontentloaded", { timeout: 8_000 }).catch(() => {});
      await page.waitForTimeout(500);
    }

    if (isWbOfferConditionUrl(page.url())) {
      return {
        ready: false,
        mode: null as RpaResolvedMode | null,
        offerAcceptanceRequired: true,
        attemptedUrls,
        lastNavigationError,
        currentUrl: page.url(),
      };
    }

    const fileInputVisible = fileInputSelector
      ? await page.locator(fileInputSelector).first().count()
        .then((count) => count > 0)
        .catch(() => false)
      : false;
    if (fileInputVisible) {
      return {
        ready: true,
        mode: "csv_upload" as const,
        offerAcceptanceRequired: false,
        attemptedUrls,
        lastNavigationError,
        currentUrl: page.url(),
      };
    }

    const redistributionTriggerVisible = await page
      .locator(redistributionTriggerSelector)
      .first()
      .isVisible({ timeout: 8_000 })
      .catch(() => false);

    const bodyText = await page.textContent("body").catch(() => "") ?? "";
    const hasWarehouseRemainsMarker = /отч[её]т по остаткам на складе|перераспределить остатки/i.test(bodyText);

    if (redistributionTriggerVisible || hasWarehouseRemainsMarker) {
      return {
        ready: true,
        mode: "warehouse_remains_modal" as const,
        offerAcceptanceRequired: false,
        attemptedUrls,
        lastNavigationError,
        currentUrl: page.url(),
      };
    }
  }

  return {
    ready: false,
    mode: null as RpaResolvedMode | null,
    offerAcceptanceRequired: false,
    attemptedUrls,
    lastNavigationError,
    currentUrl: page.url(),
  };
}

async function markRedistributionItemStatus(input: {
  tenantId: string;
  itemId: string;
  status: "rpa_submitted" | "rpa_failed";
  note: string;
}) {
  await withTenantContext(db, input.tenantId, async (tx) => {
    await tx.update(redistributionItems)
      .set({
        status: input.status,
        executionNote: input.note.slice(0, 1000),
        executedAt: input.status === "rpa_submitted" ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(redistributionItems.id, input.itemId));
  });
}

async function selectAutocompleteValue(input: Locator, page: Page, value: string, timeoutMs: number) {
  const actionTimeoutMs = Math.min(timeoutMs, 15_000);
  const isReadOnly = await input.evaluate((element) => {
    const inputElement = element as HTMLInputElement;
    return inputElement.hasAttribute("readonly")
      || inputElement.readOnly
      || inputElement.getAttribute("aria-readonly") === "true";
  }).catch(() => false);

  await input.click({ timeout: actionTimeoutMs });
  if (!isReadOnly) {
    await input.fill("", { timeout: actionTimeoutMs }).catch(() => {});
    await input.fill(value, { timeout: actionTimeoutMs }).catch(() => {});
  } else {
    const searchInputs = page.locator('input[name="search-name"], input#search[placeholder*="Поиск"]');
    let activeSearchInput: Locator | null = null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (attempt === 0) {
        await input.click({ timeout: actionTimeoutMs }).catch(() => {});
      } else {
        const toggle = input.locator(
          'xpath=ancestor::*[contains(@class,"select") or contains(@class,"Select")][1]//button',
        ).first();
        const toggleVisible = await toggle.isVisible().catch(() => false);
        if (toggleVisible) {
          await toggle.click({ timeout: actionTimeoutMs }).catch(() => {});
        }
      }

      await page.waitForTimeout(180);
      const searchCount = await searchInputs.count().catch(() => 0);
      for (let index = 0; index < searchCount; index += 1) {
        const candidate = searchInputs.nth(index);
        const visible = await candidate.isVisible().catch(() => false);
        if (visible) {
          activeSearchInput = candidate;
          break;
        }
      }
      if (activeSearchInput) {
        break;
      }
    }

    if (activeSearchInput) {
      await activeSearchInput.fill("", { timeout: actionTimeoutMs }).catch(() => {});
      await activeSearchInput.fill(value, { timeout: actionTimeoutMs }).catch(() => {});
      await page.waitForTimeout(500);
      await page
        .locator('button[class*="Dropdown-option"], li[class*="Dropdown-list__item"]')
        .first()
        .waitFor({ state: "visible", timeout: 3_500 })
        .catch(() => {});
    } else {
      await page.keyboard.type(value, { delay: 25 }).catch(() => {});
    }
  }
  await page.waitForTimeout(250);

  const optionByRole = page.getByRole("option", {
    name: new RegExp(escapeRegExp(value), "i"),
  }).first();
  const hasRoleOption = await optionByRole.count().then((count) => count > 0).catch(() => false);
  if (hasRoleOption) {
    const clicked = await optionByRole
      .click({ timeout: Math.min(actionTimeoutMs, 5_000) })
      .then(() => true)
      .catch(() => false);
    if (clicked) {
      return;
    }
  }

  const classOptionSelector = isReadOnly
    ? 'button[class*="Dropdown-option"], li[class*="Dropdown-list__item"] button, li[class*="Dropdown-list__item"]'
    : '[class*="Select__option"], [class*="option"], [class*="Option"], [role="option"]';
  const optionByClass = page.locator(classOptionSelector)
    .filter({ hasText: new RegExp(escapeRegExp(value), "i") })
    .first();
  const hasClassOption = await optionByClass.count().then((count) => count > 0).catch(() => false);
  if (hasClassOption) {
    const clicked = await optionByClass
      .click({ timeout: Math.min(actionTimeoutMs, 5_000) })
      .then(() => true)
      .catch(() => false);
    if (clicked) {
      return;
    }
  }

  await input.press("ArrowDown").catch(() => {});
  await input.press("Enter").catch(() => {});
  await page.waitForTimeout(200);
}

async function selectMoveModalArticle(input: {
  articleInput: Locator;
  formRoot: Locator;
  page: Page;
  value: string;
  articleSearchSelector: string;
  articleOptionSelector: string;
  timeoutMs: number;
}) {
  const actionTimeoutMs = Math.min(input.timeoutMs, 15_000);
  const debugSteps: string[] = [];
  await input.articleInput.click({ timeout: actionTimeoutMs });

  const searchInput = input.page
    .locator(input.articleSearchSelector)
    .first();
  const searchVisibleAfterClick = await searchInput.isVisible({ timeout: 1_000 }).catch(() => false);
  if (!searchVisibleAfterClick) {
    const toggle = input.articleInput.locator(
      'xpath=ancestor::*[contains(@class,"select") or contains(@class,"Select")][1]//button',
    ).first();
    const toggleVisible = await toggle.isVisible({ timeout: 600 }).catch(() => false);
    if (toggleVisible) {
      await toggle.click({ timeout: actionTimeoutMs }).catch(() => {});
    } else {
      await input.articleInput.click({ timeout: actionTimeoutMs }).catch(() => {});
    }
  }
  await searchInput.waitFor({ state: "visible", timeout: actionTimeoutMs });
  await searchInput.fill("", { timeout: actionTimeoutMs }).catch(() => {});
  await searchInput.fill(input.value, { timeout: actionTimeoutMs });
  await input.page.waitForTimeout(1_200);

  const options = input.page
    .locator(input.articleOptionSelector)
    .filter({ hasText: new RegExp(escapeRegExp(input.value), "i") });
  const optionCount = await options.count().catch(() => 0);
  debugSteps.push(`optionCount=${optionCount}`);
  if (optionCount === 0) {
    throw new Error(
      `Не найден option для артикула "${input.value}" по селектору "${input.articleOptionSelector}". debug="${debugSteps.join(" | ")}"`,
    );
  }

  await options.first().click({ timeout: Math.min(actionTimeoutMs, 4_000), force: true });
  await input.page.waitForTimeout(500);

  const articleById = await input.page
    .locator("input#nm, input[name='nm']")
    .first()
    .inputValue()
    .catch(() => "");
  const articleByLocator = await input.articleInput.inputValue().catch(() => "");
  const articleValue = (articleById || articleByLocator || "").trim();
  debugSteps.push(`articleById="${articleById}"`, `articleByLocator="${articleByLocator}"`);
  if (!articleValue) {
    throw new Error(
      `Артикул "${input.value}" не применился: поле Артикул WB осталось пустым. debug="${debugSteps.join(" | ")}"`,
    );
  }
}

async function waitForInputEnabled(input: {
  page: Page;
  locator: Locator;
  timeoutMs: number;
}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < input.timeoutMs) {
    const ready = await input.locator.isEnabled().catch(() => false);
    if (ready) {
      return true;
    }
    await input.page.waitForTimeout(200);
  }
  return false;
}

async function dismissCookieBanner(page: Page) {
  const acceptButton = page
    .locator('button:has-text("Принимаю"), button:has-text("Соглас"), button:has-text("Принять")')
    .first();
  const visible = await acceptButton.isVisible({ timeout: 700 }).catch(() => false);
  if (visible) {
    await acceptButton.click({ timeout: 3_000 }).catch(() => {});
    await page.waitForTimeout(150);
  }
}

async function closeRedistributionDialogIfOpen(page: Page, dialogSelector: string) {
  const dialog = page.locator(dialogSelector).first();
  const visible = await dialog.isVisible({ timeout: 600 }).catch(() => false);
  if (!visible) {
    return;
  }

  const closeButton = dialog
    .locator(
      'button[aria-label*="Закры"], button[aria-label*="Close"], button[class*="close"], button[class*="Close"]',
    )
    .first();
  const closeButtonVisible = await closeButton.isVisible({ timeout: 400 }).catch(() => false);
  if (closeButtonVisible) {
    await closeButton.click({ timeout: 1_500 }).catch(() => {});
  } else {
    await page.keyboard.press("Escape").catch(() => {});
  }

  await dialog.waitFor({ state: "hidden", timeout: 2_000 }).catch(() => {});
}

async function runWarehouseRemainsModalFlow(input: {
  page: Page;
  timeoutMs: number;
  items: RedistributionRpaItem[];
  runId: string;
  tenantId: string;
  mode?: "submit" | "probe";
  trackItemStatus?: boolean;
  availabilitySource?: string;
  continueOnHardError?: boolean;
}) {
  const { page, timeoutMs, items, runId, tenantId } = input;
  const mode = input.mode ?? "submit";
  const trackItemStatus = input.trackItemStatus ?? true;
  const availabilitySource = input.availabilitySource ?? "rpa_modal";
  const continueOnHardError = input.continueOnHardError ?? false;
  const actionTimeoutMs = Math.min(timeoutMs, 20_000);
  const triggerSelector = getRedistributionTriggerSelector();
  const dialogSelector = getRedistributionDialogSelector();
  const articleSelector = getArticleInputSelector();
  const articleSearchSelector = getArticleSearchSelector();
  const articleOptionSelector = getArticleOptionSelector();
  const warehouseInputSelector = getWarehouseInputSelector();
  const submitSelector = getModalSubmitSelector();
  const fromWarehouseSelectorOverride = getOptionalEnv("WB_RPA_FROM_WAREHOUSE_SELECTOR");
  const toWarehouseSelectorOverride = getOptionalEnv("WB_RPA_TO_WAREHOUSE_SELECTOR");
  const sizeSelector = getSizeSelector();
  const transferUnitsSelector = getOptionalEnv("WB_RPA_TRANSFER_UNITS_SELECTOR");

  let submittedItems = 0;

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    const itemTag = `nmId=${item.nmId}; size=${item.sizeName}; from=${item.fromWarehouse}; to=${item.toWarehouse}; units=${item.transferUnits}`;

    try {
      await dismissCookieBanner(page);

      const dialog = page.locator(dialogSelector).first();
      let dialogVisible = await dialog.isVisible({ timeout: 800 }).catch(() => false);
      if (!dialogVisible) {
        const triggerButton = page.locator(triggerSelector).first();
        await triggerButton.waitFor({ state: "visible", timeout: actionTimeoutMs });
        await triggerButton.click({ timeout: actionTimeoutMs });
        dialogVisible = await dialog.isVisible({ timeout: 7_000 }).catch(() => false);
      }
      const formRoot = dialogVisible ? dialog : page.locator("body");
      await dismissCookieBanner(page);

      const articleInput = formRoot.locator(articleSelector).first();
      await articleInput.waitFor({ state: "visible", timeout: actionTimeoutMs });
      await page.waitForTimeout(400);

      if (transferUnitsSelector) {
        const unitsInput = formRoot.locator(transferUnitsSelector).first();
        if (await unitsInput.count().then((count) => count > 0).catch(() => false)) {
          await unitsInput.fill(String(item.transferUnits), { timeout: timeoutMs }).catch(() => {});
        }
      }

      const fromWarehouseInput = fromWarehouseSelectorOverride
        ? formRoot.locator(fromWarehouseSelectorOverride).first()
        : formRoot.locator(warehouseInputSelector).nth(0);
      const toWarehouseInput = toWarehouseSelectorOverride
        ? formRoot.locator(toWarehouseSelectorOverride).first()
        : formRoot.locator(warehouseInputSelector).nth(1);

      await fromWarehouseInput.waitFor({ state: "visible", timeout: actionTimeoutMs });
      await toWarehouseInput.waitFor({ state: "visible", timeout: actionTimeoutMs });

      const articleCandidates = [String(item.nmId)];
      if (shouldUseVendorCodeArticleFallback()) {
        const vendorCodeCandidate = item.vendorCode?.trim() || "";
        if (vendorCodeCandidate.length > 0 && !articleCandidates.includes(vendorCodeCandidate)) {
          articleCandidates.push(vendorCodeCandidate);
        }
      }

      let warehousesUnlocked = false;
      let lastArticleValue = "";
      let lastSizeValue = "";
      const articleSelectionErrors: string[] = [];
      for (const candidate of articleCandidates) {
        const selectionAttempt = await selectMoveModalArticle({
          articleInput,
          formRoot,
          page,
          value: candidate,
          articleSearchSelector,
          articleOptionSelector,
          timeoutMs,
        }).then(() => ({ ok: true, error: "" }))
          .catch((error: unknown) => ({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }));
        if (!selectionAttempt.ok) {
          articleSelectionErrors.push(`${candidate}: ${selectionAttempt.error}`);
          continue;
        }

        const sizeInput = formRoot.locator(sizeSelector).first();
        const sizeInputVisible = await sizeInput.isVisible({ timeout: 1_500 }).catch(() => false);
        if (sizeInputVisible) {
          await selectAutocompleteValue(sizeInput, page, item.sizeName, timeoutMs);
        }
        lastArticleValue = (await articleInput.inputValue().catch(() => "")).trim();
        lastSizeValue = sizeInputVisible
          ? (await sizeInput.inputValue().catch(() => "")).trim()
          : "";

        warehousesUnlocked = await waitForInputEnabled({
          page,
          locator: fromWarehouseInput,
          timeoutMs: 6_000,
        });
        if (warehousesUnlocked) {
          break;
        }
      }

      if (!warehousesUnlocked) {
        throw new Error(
          `После выбора артикула/размера поле склада-источника осталось неактивным (article="${lastArticleValue || "-"}", size="${lastSizeValue || "-"}", articleSelectionError="${articleSelectionErrors.join(" | ") || "-"}"). Проверьте соответствие артикула WB, размера и селекторов модалки.`,
        );
      }

      await selectAutocompleteValue(fromWarehouseInput, page, item.fromWarehouse, timeoutMs);
      let selectedFromWarehouse = (await fromWarehouseInput.inputValue().catch(() => "")).trim();
      if (!warehouseMatchesExpected(selectedFromWarehouse, item.fromWarehouse)) {
        await selectAutocompleteValue(fromWarehouseInput, page, item.fromWarehouse, timeoutMs);
        await page.waitForTimeout(300);
        selectedFromWarehouse = (await fromWarehouseInput.inputValue().catch(() => "")).trim();
      }
      await page.waitForTimeout(350);
      const formTextAfterFrom = (await formRoot.textContent().catch(() => "") ?? "").toLowerCase();
      const fromLimitReached = /дневн.*лимит.*исчерпан|переместите товар с другого склада|попробуйте завтра/i
        .test(formTextAfterFrom);
      if (fromLimitReached) {
        throw new Error(
          `WB ограничение: дневной лимит перемещений исчерпан для склада-источника "${selectedFromWarehouse || item.fromWarehouse}".`,
        );
      }

      const toWarehouseUnlocked = await waitForInputEnabled({
        page,
        locator: toWarehouseInput,
        timeoutMs: 6_000,
      });
      let toWarehouseReady = toWarehouseUnlocked;
      if (!toWarehouseReady) {
        await selectAutocompleteValue(
          fromWarehouseInput,
          page,
          selectedFromWarehouse || item.fromWarehouse,
          timeoutMs,
        );
        await page.waitForTimeout(300);
        toWarehouseReady = await waitForInputEnabled({
          page,
          locator: toWarehouseInput,
          timeoutMs: 4_000,
        });
      }
      if (!toWarehouseReady) {
        throw new Error(
          "После выбора склада-источника поле склада-получателя не активировалось. Проверьте доступные маршруты WB.",
        );
      }
      await selectAutocompleteValue(toWarehouseInput, page, item.toWarehouse, timeoutMs);
      let selectedToWarehouse = (await toWarehouseInput.inputValue().catch(() => "")).trim();
      if (!warehouseMatchesExpected(selectedToWarehouse, item.toWarehouse)) {
        await selectAutocompleteValue(toWarehouseInput, page, item.toWarehouse, timeoutMs);
        await page.waitForTimeout(300);
        selectedToWarehouse = (await toWarehouseInput.inputValue().catch(() => "")).trim();
      }

      if (!selectedFromWarehouse
        || !selectedToWarehouse
        || !warehouseMatchesExpected(selectedFromWarehouse, item.fromWarehouse)
        || !warehouseMatchesExpected(selectedToWarehouse, item.toWarehouse)) {
        throw new Error(
          `Не удалось выбрать склад-получатель/источник в модалке (from="${selectedFromWarehouse || "-"}", to="${selectedToWarehouse || "-"}", expectedFrom="${item.fromWarehouse}", expectedTo="${item.toWarehouse}").`,
        );
      }

      const submitButton = formRoot.locator(submitSelector).first();
      await submitButton.waitFor({ state: "visible", timeout: actionTimeoutMs });
      const submitEnabled = await submitButton.isEnabled().catch(() => false);
      if (!submitEnabled) {
        const articleValue = (await articleInput.inputValue().catch(() => "")).trim();
        throw new Error(
          `Кнопка "Перераспределить" неактивна после заполнения формы (article="${articleValue || "-"}", from="${selectedFromWarehouse}", to="${selectedToWarehouse}", units=${item.transferUnits}).`,
        );
      }
      if (mode === "submit") {
        await submitButton.click({ timeout: actionTimeoutMs });

        if (dialogVisible) {
          await dialog.waitFor({ state: "hidden", timeout: Math.min(timeoutMs, 30_000) }).catch(async () => {
            // Some WB variants keep modal open while showing inline confirmation.
            const inlineSuccess = await dialog
              .locator("text=/успеш|заявк|перераспредел/i")
              .first()
              .isVisible({ timeout: 1_500 })
              .catch(() => false);
            if (!inlineSuccess) {
              throw new Error("Модалка не закрылась и подтверждение отправки не найдено.");
            }
          });
        } else {
          const inlineSuccessGlobal = await page
            .locator("text=/успеш|заявк|перераспредел/i")
            .first()
            .isVisible({ timeout: 6_000 })
            .catch(() => false);
          if (!inlineSuccessGlobal) {
            await page.waitForTimeout(1_000);
          }
        }
      } else {
        await closeRedistributionDialogIfOpen(page, dialogSelector);
      }

      if (trackItemStatus) {
        await markRedistributionItemStatus({
          tenantId,
          itemId: item.id,
          status: "rpa_submitted",
          note: mode === "submit" ? `modal_submitted (${itemTag})` : `modal_probe_ready (${itemTag})`,
        });
      }
      await saveRouteAvailabilityResult({
        tenantId,
        runId,
        fromWarehouse: item.fromWarehouse,
        toWarehouse: item.toWarehouse,
        status: "available",
        source: availabilitySource,
        reason: mode === "submit" ? "modal_submitted" : "modal_probe_ready_to_submit",
      }).catch(() => {});
      submittedItems += 1;
      await page.waitForTimeout(350);
    } catch (error) {
      const baseMessage = error instanceof Error ? error.message : String(error);
      let screenshotPath: string | null = null;
      try {
        const failuresDir = resolvePersistentOutputDir("wb-rpa", "failures");
        await cleanupWbRpaFailureArtifactsIfNeeded().catch((cleanupError) => {
          logger.warn({ err: cleanupError, dir: failuresDir }, "[redistribution-rpa] failure artifact cleanup failed");
        });
        await mkdir(failuresDir, { recursive: true });
        screenshotPath = join(
          failuresDir,
          `redistribution-${runId}-item-${index + 1}-${Date.now()}.png`,
        );
        await page.screenshot({ path: screenshotPath, fullPage: true });
      } catch {
        screenshotPath = null;
      }
      const message = screenshotPath
        ? `${baseMessage} [screenshot: ${screenshotPath}]`
        : baseMessage;
      const isLimitError = isWbDailyLimitError(baseMessage);
      const isWarehouseSoftError = isNonCriticalWarehouseSelectionError(baseMessage);
      const isSoftFail = isLimitError || isWarehouseSoftError;
      const routeStatus = isLimitError
        ? "limit_exhausted"
        : isWarehouseSoftError
          ? "route_unavailable"
          : "transient_error";
      if (trackItemStatus) {
        await markRedistributionItemStatus({
          tenantId,
          itemId: item.id,
          status: "rpa_failed",
          note: `${isLimitError ? "modal_failed_limit" : isWarehouseSoftError ? "modal_failed_warehouse" : "modal_failed"} (${itemTag}): ${message}`,
        });
      }
      await saveRouteAvailabilityResult({
        tenantId,
        runId,
        fromWarehouse: item.fromWarehouse,
        toWarehouse: item.toWarehouse,
        status: routeStatus,
        source: availabilitySource,
        reason: message,
      }).catch(() => {});
      if (isSoftFail || mode === "probe" || continueOnHardError) {
        await closeRedistributionDialogIfOpen(page, dialogSelector);
        continue;
      }
      throw new NonRetriableError(
        `WB modal redistribution failed on item ${index + 1}/${items.length} (${itemTag}): ${message}`,
      );
    }
  }

  return submittedItems;
}

async function runRedistributionUploadRpa(input: {
  tenantId: string;
  runId: string;
  csvFilePath: string;
  items: RedistributionRpaItem[];
}) {
  const dryRun = process.env.WB_RPA_DRY_RUN === "true";
  if (dryRun) {
    return {
      mode: "dry_run" as const,
      message: "WB_RPA_DRY_RUN=true, upload skipped",
      perItemStatusManaged: false,
      submittedItems: 0,
    } satisfies RpaExecutionResult;
  }

  const redistributionUrl = getRequiredEnv("WB_RPA_REDISTRIBUTION_URL");
  const fileInputSelector = getOptionalEnv("WB_RPA_FILE_INPUT_SELECTOR");
  const uploadSubmitSelector = getOptionalEnv("WB_RPA_UPLOAD_SUBMIT_SELECTOR");
  const successSelector = getOptionalEnv("WB_RPA_SUCCESS_SELECTOR");
  const successText = getOptionalEnv("WB_RPA_SUCCESS_TEXT");
  const sessionHandle: StorageStateSession | null = await loadStorageStateSession(input.tenantId);
  const canUseStorageState = sessionHandle !== null;

  const browser = await chromium.launch({
    headless: WB_RPA_HEADLESS,
    // Системный Google Chrome через WB_RPA_CHROMIUM_PATH — Playwright не
    // поставляет Chromium под Ubuntu 26.04.
    ...(process.env.WB_RPA_CHROMIUM_PATH
      ? { executablePath: process.env.WB_RPA_CHROMIUM_PATH }
      : {}),
  });

  try {
    const context = await browser.newContext(
      sessionHandle
        ? { storageState: sessionHandle.tempPath }
        : undefined,
    );
    const page = await context.newPage();

    const preLoginTarget = await resolveRedistributionTargetPage({
      configuredUrl: redistributionUrl,
      fileInputSelector,
      timeoutMs: WB_RPA_TIMEOUT_MS,
      page,
    });

    if (preLoginTarget.offerAcceptanceRequired) {
      throw new Error("WB требует принять актуальную оферту в кабинете. Откройте WB Seller, примите оферту и повторите запуск.");
    }

    let resolvedMode = preLoginTarget.mode;
    if (!preLoginTarget.ready || !resolvedMode) {
      if (canUseStorageState) {
        if (isWbAuthUrl(preLoginTarget.currentUrl)) {
          throw new NonRetriableError(
            `Сохранённая WB-сессия недействительна или истекла: WB перенаправил на авторизацию (${preLoginTarget.currentUrl}). Повторите вход через «Простой вход: открыть CAPTCHA и войти» в Settings -> WB ЛК Доступ (RPA), затем запустите прогон заново.${preLoginTarget.lastNavigationError ? ` Последняя ошибка навигации: ${preLoginTarget.lastNavigationError}` : ""}`,
          );
        }
        throw new NonRetriableError(
          `Сессия WB загружена, но целевая страница перераспределения не найдена. Проверьте WB_RPA_REDISTRIBUTION_URL и селекторы RPA. Попробованы URL: ${preLoginTarget.attemptedUrls.join(", ")}. Текущий URL: ${preLoginTarget.currentUrl}.${preLoginTarget.lastNavigationError ? ` Последняя ошибка навигации: ${preLoginTarget.lastNavigationError}` : ""}`,
        );
      }

      const loginValue = getOptionalEnv("WB_RPA_LOGIN");
      if (!loginValue) {
        throw new NonRetriableError(
          "Сохранённая WB-сессия для RPA недоступна или истёк TTL (7 дней). Выполните вход через «Простой вход: открыть CAPTCHA и войти» в Settings -> WB ЛК Доступ (RPA), затем повторите запуск.",
        );
      }

      const loginUrl = getRequiredEnv("WB_RPA_LOGIN_URL");
      const loginSelector = getRequiredEnv("WB_RPA_LOGIN_SELECTOR");
      const submitSelector = getRequiredEnv("WB_RPA_SUBMIT_SELECTOR");
      const passwordValue = getOptionalEnv("WB_RPA_PASSWORD");
      const passwordSelector = getOptionalEnv("WB_RPA_PASSWORD_SELECTOR");
      const smsCodeSelector = getOptionalEnv("WB_RPA_SMS_CODE_SELECTOR");
      const loginSuccessSelector = getOptionalEnv("WB_RPA_LOGIN_SUCCESS_SELECTOR");

      await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: WB_RPA_TIMEOUT_MS });
      await page.fill(loginSelector, loginValue, { timeout: WB_RPA_TIMEOUT_MS });
      if (passwordSelector && passwordValue) {
        await page.fill(passwordSelector, passwordValue, { timeout: WB_RPA_TIMEOUT_MS });
      }

      const codeRequestResponsePromise = page.waitForResponse(
        (response) => response.url().includes("/auth/v2/code/wb-captcha"),
        { timeout: 12_000 },
      ).catch(() => null);

      await Promise.all([
        page.waitForLoadState("networkidle", { timeout: WB_RPA_TIMEOUT_MS }).catch(() => {}),
        page.click(submitSelector, { timeout: WB_RPA_TIMEOUT_MS }),
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

        const captchaRequired = codeRequestBody?.error?.toLowerCase().includes("captcha")
          || codeRequestBody?.result === 3;
        if (captchaRequired) {
          throw new Error("WB требует CAPTCHA перед отправкой SMS. Пройдите CAPTCHA вручную и сохраните сессию в Settings -> WB ЛК Доступ (RPA), затем повторите запуск.");
        }
      }

      const bodyTextAfterSubmit = await page.textContent("body").catch(() => "") ?? "";
      const looksLikeSmsStep = /код|sms|смс|подтверждени/i.test(bodyTextAfterSubmit);

      if (smsCodeSelector) {
        const smsCodeVisible = await page.locator(smsCodeSelector).first().isVisible({
          timeout: 4_000,
        }).catch(() => false);
        const isSameInputAsLogin = smsCodeSelector === loginSelector;

        if (smsCodeVisible && (looksLikeSmsStep || !isSameInputAsLogin)) {
          throw new Error("WB запросил SMS-код. Завершите вход и сохраните сессию в Settings -> WB ЛК Доступ (RPA), затем повторите запуск.");
        }
      }

      if (loginSuccessSelector) {
        await page.waitForSelector(loginSuccessSelector, { timeout: 10_000 });
      }

      const postLoginTarget = await resolveRedistributionTargetPage({
        configuredUrl: redistributionUrl,
        fileInputSelector,
        timeoutMs: WB_RPA_TIMEOUT_MS,
        page,
      });
      if (postLoginTarget.offerAcceptanceRequired) {
        throw new Error("WB требует принять актуальную оферту в кабинете. Откройте WB Seller, примите оферту и повторите запуск.");
      }
      if (!postLoginTarget.ready || !postLoginTarget.mode) {
        if (isWbAuthUrl(postLoginTarget.currentUrl)) {
          throw new NonRetriableError(
            `После логина WB оставил страницу авторизации (${postLoginTarget.currentUrl}). Завершите вход вручную через Settings -> WB ЛК Доступ (RPA), сохраните сессию и повторите запуск.${postLoginTarget.lastNavigationError ? ` Последняя ошибка навигации: ${postLoginTarget.lastNavigationError}` : ""}`,
          );
        }
        throw new NonRetriableError(
          `После логина не удалось подтвердить целевую страницу WB для перераспределения. Проверьте WB_RPA_REDISTRIBUTION_URL и селекторы RPA. Попробованы URL: ${postLoginTarget.attemptedUrls.join(", ")}.${postLoginTarget.lastNavigationError ? ` Последняя ошибка навигации: ${postLoginTarget.lastNavigationError}` : ""}`,
        );
      }
      resolvedMode = postLoginTarget.mode;
    }

    if (!resolvedMode) {
      throw new NonRetriableError("Не удалось определить режим RPA для перераспределения.");
    }

    if (resolvedMode === "csv_upload") {
      if (!fileInputSelector) {
        throw new NonRetriableError("Обнаружен режим CSV upload, но не задан WB_RPA_FILE_INPUT_SELECTOR.");
      }

      await page.setInputFiles(fileInputSelector, input.csvFilePath, { timeout: WB_RPA_TIMEOUT_MS });

      if (uploadSubmitSelector) {
        await Promise.all([
          page.waitForLoadState("networkidle", { timeout: WB_RPA_TIMEOUT_MS }).catch(() => {}),
          page.click(uploadSubmitSelector, { timeout: WB_RPA_TIMEOUT_MS }),
        ]);
      }

      if (successSelector) {
        await page.waitForSelector(successSelector, { timeout: WB_RPA_TIMEOUT_MS });
      } else if (successText) {
        await page.waitForSelector(`text=${successText}`, { timeout: WB_RPA_TIMEOUT_MS });
      }

      await persistStorageStateFromContext(input.tenantId, context);

      return {
        mode: "csv_upload" as const,
        message: canUseStorageState ? "csv_uploaded_with_saved_session" : "csv_uploaded",
        perItemStatusManaged: false,
        submittedItems: input.items.length,
      } satisfies RpaExecutionResult;
    }

    if (!input.items.length) {
      throw new NonRetriableError(`RPA modal flow requires run items; runId=${input.runId} has 0 items.`);
    }

    const submittedItems = await runWarehouseRemainsModalFlow({
      page,
      timeoutMs: WB_RPA_TIMEOUT_MS,
      items: input.items,
      runId: input.runId,
      tenantId: input.tenantId,
      mode: "submit",
      trackItemStatus: true,
      availabilitySource: "rpa_modal",
      continueOnHardError: true,
    });

    const failedItems = input.items.length - submittedItems;
    if (failedItems > 0) {
      const failedSamples = await withTenantContext(db, input.tenantId, async (tx) =>
        tx.select({
          nmId: redistributionItems.nmId,
          sizeName: redistributionItems.sizeName,
          fromWarehouse: redistributionItems.fromWarehouse,
          toWarehouse: redistributionItems.toWarehouse,
          executionNote: redistributionItems.executionNote,
        })
          .from(redistributionItems)
          .where(and(
            eq(redistributionItems.runId, input.runId),
            eq(redistributionItems.status, "rpa_failed"),
          ))
          .orderBy(desc(redistributionItems.updatedAt))
          .limit(3),
      );

      const sampleText = failedSamples.length > 0
        ? failedSamples
          .map((item, index) => (
            `${index + 1}) nmId=${item.nmId}, size=${item.sizeName}, ${item.fromWarehouse}→${item.toWarehouse}: ${item.executionNote ?? "-"}`
          ))
          .join(" | ")
        : "детали ошибок по позициям отсутствуют";

      throw new NonRetriableError(
        `RPA завершен с частичными ошибками: успешно ${submittedItems}/${input.items.length}, ошибок ${failedItems}. ${sampleText}`,
      );
    }

    await persistStorageStateFromContext(input.tenantId, context);

    return {
      mode: "warehouse_remains_modal" as const,
      message: `modal_submitted_items=${submittedItems}`,
      perItemStatusManaged: true,
      submittedItems,
    } satisfies RpaExecutionResult;
  } finally {
    await browser.close();
    if (sessionHandle) {
      await sessionHandle.cleanup();
    }
  }
}

export async function runRedistributionRouteProbeRpa(input: {
  tenantId: string;
  items: RedistributionRpaProbeItem[];
  source?: string;
  submitWhenReady?: boolean;
}) {
  if (process.env.WB_RPA_DRY_RUN === "true") {
    return {
      mode: "dry_run" as const,
      message: "WB_RPA_DRY_RUN=true, slot monitor skipped",
      probedItems: 0,
      openedSlots: 0,
      autoSubmitted: false,
    };
  }

  if (!input.items.length) {
    return {
      mode: "noop" as const,
      message: "no_probe_items",
      probedItems: 0,
      openedSlots: 0,
      autoSubmitted: false,
    };
  }

  const submitWhenReady = input.submitWhenReady === true;

  const redistributionUrl = getRequiredEnv("WB_RPA_REDISTRIBUTION_URL");
  const sessionHandle = await loadStorageStateSession(input.tenantId);
  if (!sessionHandle) {
    throw new NonRetriableError(
      "Мониторинг слотов требует сохраненную WB-сессию (Settings -> WB ЛК Доступ). Сессия отсутствует или истёк TTL (7 дней).",
    );
  }

  const browser = await chromium.launch({
    headless: WB_RPA_HEADLESS,
    // Системный Google Chrome через WB_RPA_CHROMIUM_PATH — Playwright не
    // поставляет Chromium под Ubuntu 26.04.
    ...(process.env.WB_RPA_CHROMIUM_PATH
      ? { executablePath: process.env.WB_RPA_CHROMIUM_PATH }
      : {}),
  });

  try {
    const context = await browser.newContext({ storageState: sessionHandle.tempPath });
    const page = await context.newPage();

    const target = await resolveRedistributionTargetPage({
      configuredUrl: redistributionUrl,
      fileInputSelector: null,
      timeoutMs: WB_RPA_TIMEOUT_MS,
      page,
    });
    if (target.offerAcceptanceRequired) {
      throw new NonRetriableError("WB требует принять актуальную оферту в кабинете перед мониторингом слотов.");
    }
    if (!target.ready || target.mode !== "warehouse_remains_modal") {
      throw new NonRetriableError(
        `Не удалось открыть WB модалку перераспределения для мониторинга. URL: ${target.currentUrl}.`,
      );
    }

    const probeItems: RedistributionRpaItem[] = input.items.map((item, index) => ({
      id: `slot-probe-${index + 1}`,
      nmId: item.nmId,
      vendorCode: item.vendorCode,
      sizeName: item.sizeName,
      fromWarehouse: item.fromWarehouse,
      toWarehouse: item.toWarehouse,
      transferUnits: Math.max(1, item.transferUnits || 1),
    }));

    const openedSlots = await runWarehouseRemainsModalFlow({
      page,
      timeoutMs: WB_RPA_TIMEOUT_MS,
      items: probeItems,
      runId: `slot-monitor-${Date.now()}`,
      tenantId: input.tenantId,
      mode: submitWhenReady ? "submit" : "probe",
      trackItemStatus: false,
      availabilitySource: input.source ?? (submitWhenReady ? "slot_monitor_auto_submit" : "slot_monitor_probe"),
      continueOnHardError: true,
    });

    await persistStorageStateFromContext(input.tenantId, context);

    return {
      mode: submitWhenReady ? "submit" : "probe",
      message: submitWhenReady
        ? `slot_monitor_auto_submit_probed=${probeItems.length}; submitted=${openedSlots}`
        : `slot_monitor_probed=${probeItems.length}; opened=${openedSlots}`,
      probedItems: probeItems.length,
      openedSlots,
      autoSubmitted: submitWhenReady,
    };
  } finally {
    await browser.close();
    await sessionHandle.cleanup();
  }
}

export const redistributionRpaJob = inngest.createFunction(
  {
    id: "redistribution-rpa-upload",
    name: "Redistribution RPA Upload",
    concurrency: [
      { limit: 1, key: "event.data.tenantId" },
      { limit: 2 },
    ],
    onFailure: handleInngestFailure,
    triggers: [{ event: REDISTRIBUTION_RPA_EVENT }],
  },
  async ({ event, step }: { event: RedistributionRpaRequestedEvent; step: { run: <T>(id: string, fn: () => Promise<T>) => Promise<T> } }) => {
    const tenantId = event.data.tenantId;
    const runId = event.data.runId;

    if (!tenantId || !runId) {
      throw new Error("tenantId and runId are required");
    }

    const [runRow] = await step.run("redistribution-rpa-load-run", async () => {
      return withTenantContext(db, tenantId, async (tx) =>
        tx.select({
          id: redistributionRuns.id,
          tenantId: redistributionRuns.tenantId,
          csvFilePath: redistributionRuns.csvFilePath,
        })
          .from(redistributionRuns)
          .where(eq(redistributionRuns.id, runId))
          .limit(1),
      );
    });

    if (!runRow || runRow.tenantId !== tenantId) {
      throw new Error(`Redistribution run not found for runId=${runId}`);
    }

    const runItems = await step.run("redistribution-rpa-load-run-items", async () => {
      return withTenantContext(db, tenantId, async (tx) =>
        tx.select({
          id: redistributionItems.id,
          nmId: redistributionItems.nmId,
          vendorCode: redistributionItems.vendorCode,
          sizeName: redistributionItems.sizeName,
          fromWarehouse: redistributionItems.fromWarehouse,
          toWarehouse: redistributionItems.toWarehouse,
          transferUnits: redistributionItems.transferUnits,
        })
          .from(redistributionItems)
          .where(eq(redistributionItems.runId, runId)),
      );
    });

    const csvFilePath = event.data.csvFilePath ?? runRow.csvFilePath;
    if (!csvFilePath) {
      throw new Error(`CSV path is missing for runId=${runId}`);
    }

    try {
      await step.run("redistribution-rpa-check-csv", async () => {
        await access(csvFilePath);
      });

      await step.run("redistribution-rpa-mark-running", async () => {
        await withTenantContext(db, tenantId, async (tx) => {
          await tx.update(redistributionRuns)
            .set({
              status: "rpa_running",
              rpaStartedAt: new Date(),
              errorMessage: null,
              updatedAt: new Date(),
            })
            .where(eq(redistributionRuns.id, runId));

          await tx.update(redistributionItems)
            .set({
              status: "rpa_running",
              updatedAt: new Date(),
            })
            .where(and(
              eq(redistributionItems.runId, runId),
              inArray(redistributionItems.status, ["planned", "rpa_queued"]),
            ));
        });
      });

      const rpaResult = await step.run("redistribution-rpa-execute", async () => {
        return runRedistributionUploadRpa({
          tenantId,
          runId,
          csvFilePath,
          items: runItems,
        });
      });

      await step.run("redistribution-rpa-mark-completed", async () => {
        await withTenantContext(db, tenantId, async (tx) => {
          await tx.update(redistributionRuns)
            .set({
              status: "rpa_completed",
              rpaFinishedAt: new Date(),
              errorMessage: null,
              updatedAt: new Date(),
            })
            .where(eq(redistributionRuns.id, runId));

          if (!rpaResult.perItemStatusManaged) {
            await tx.update(redistributionItems)
              .set({
                status: "rpa_submitted",
                executedAt: new Date(),
                executionNote: rpaResult.message,
                updatedAt: new Date(),
              })
              .where(eq(redistributionItems.runId, runId));
          } else {
            // RPA reported per-item status. Any items still sitting at rpa_running
            // mean RPA neither submitted nor failed them (partial success or missed
            // reporting). Promote them to rpa_failed to avoid stuck rows.
            const orphaned = await tx.update(redistributionItems)
              .set({
                status: "rpa_failed",
                executionNote: "not_reported_by_rpa",
                updatedAt: new Date(),
              })
              .where(and(
                eq(redistributionItems.runId, runId),
                eq(redistributionItems.status, "rpa_running"),
              ))
              .returning({ id: redistributionItems.id });
            if (orphaned.length > 0) {
              logger.warn(
                { runId, tenantId, orphanedCount: orphaned.length },
                "[redistribution-rpa] partial success: items stuck in rpa_running were marked rpa_failed",
              );
            }
          }
        });
      });

      return {
        success: true,
        tenantId,
        runId,
        csvFilePath,
        submittedItems: rpaResult.submittedItems,
        rpaResult,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "redistribution_rpa_unknown_error";
      await step.run("redistribution-rpa-mark-failed", async () => {
        await withTenantContext(db, tenantId, async (tx) => {
          await tx.update(redistributionRuns)
            .set({
              status: "rpa_failed",
              rpaFinishedAt: new Date(),
              errorMessage: message.slice(0, 4000),
              updatedAt: new Date(),
            })
            .where(eq(redistributionRuns.id, runId));

          await tx.update(redistributionItems)
            .set({
              status: "rpa_failed",
              executionNote: message.slice(0, 1000),
              updatedAt: new Date(),
            })
            .where(and(
              eq(redistributionItems.runId, runId),
              inArray(redistributionItems.status, ["rpa_running", "rpa_queued", "planned"]),
            ));
        });
      });

      if (error instanceof NonRetriableError) {
        throw error;
      }
      throw new NonRetriableError(message);
    }
  },
);
