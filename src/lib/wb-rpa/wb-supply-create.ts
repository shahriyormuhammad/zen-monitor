/**
 * WB supply automation — create a draft, push goods (barcodes+quantities),
 * and (optionally) create a zero-cost preorder, reusing the stored WB ЛК
 * session.
 *
 * ── Safety boundary ───────────────────────────────────────────────────────
 * The WB supply pipeline is:
 *   A. draft/create + UpdateDraftGoods          (no captcha, no cost)
 *   B. supply/create  → preorder                (no captcha, status
 *                                                 «Не запланировано», 0 ₽,
 *                                                 fully reversible)
 *   C. plan/add       → books delivery date     ⚠️ requires x-wb-captcha-token
 *                                                 + is the financial commit
 *   D. box/createBoxBarcodes + bindBarcodes     (ШК, after C)
 *
 * This module automates A and (optionally) B, then STOPS. Step C — the
 * captcha-gated financial commit — is intentionally left to the human in the
 * WB cabinet (we hand back a deep link). This both respects the "creating a
 * supply is a financial action" rule and matches WB's own captcha gate.
 *
 * ── Auth ──────────────────────────────────────────────────────────────────
 * The seller-supply.wildberries.ru JSON-RPC endpoints need three SPA-injected
 * headers in addition to session cookies: `authorizev3`, `wb-seller-lk`
 * (≈5-min TTL) and `root-version`. A plain fetch doesn't add them, so we
 * capture them live from a real SPA request, then replay our calls via
 * in-page `fetch` (genuine browser origin → identical TLS/headers, passes
 * WB antibot + CORS exactly like the SPA does).
 */

import { chromium, type BrowserContext, type Page } from 'playwright';

import { logger } from '@/lib/logger';
import {
  loadStorageStateSession,
  persistStorageStateFromContext,
} from '@/lib/wb-rpa/storage-state';

const WB_RPA_HEADLESS = process.env.WB_RPA_HEADLESS !== 'false';
const WB_SUPPLY_TIMEOUT_MS = (() => {
  const parsed = Number.parseInt(process.env.WB_SUPPLY_TIMEOUT_MS ?? '60000', 10);
  if (!Number.isFinite(parsed) || parsed < 15_000) return 60_000;
  return Math.min(180_000, parsed);
})();

const SUPPLY_BASE = 'https://seller-supply.wildberries.ru';
const SUPPLIES_PAGE = 'https://seller.wildberries.ru/supplies-management/all-supplies';

/** boxTypeID 2 = «Короб». Other values: 5 = «Монопаллета», 6 = «Суперсейф». */
export const WB_BOX_TYPE_KOROB = 2;

export type SupplyDraftItem = { barcode: string; quantity: number };

export type WbWarehouseItem = { warehouseId: number; warehouseName: string };

export type CreateWbSupplyInput = {
  items: SupplyDraftItem[];
  /**
   * If set, also create the (zero-cost) preorder for this warehouse. If null,
   * we stop after the draft+goods and hand back a draft deep link so the user
   * picks the warehouse themselves.
   */
  warehouseId?: number | null;
  boxTypeID?: number;
};

export type CreateWbSupplyResult = {
  draftID: string;
  preorderID: number | null;
  /** Distinct barcodes pushed into the draft. */
  goodsBarcodes: number;
  /** Total units across all barcodes. */
  goodsUnits: number;
  /** barcodes WB reported a validation error for (when a warehouse was given). */
  rejected: { barcode: string; reason: string }[];
  warehouseId: number | null;
  /** URL the user opens to finish (pick date + slot + confirm) in WB. */
  deepLink: string;
  warnings: string[];
};

type CapturedAuth = {
  authorizev3: string;
  wbSellerLk: string;
  rootVersion: string;
};

class WbSupplyError extends Error {}

function isWbAuthRedirect(url: string): boolean {
  return /seller-auth\.wildberries\.ru/i.test(url) || /\/login/i.test(url);
}

/**
 * Open the WB supplies page under the tenant's session, capture the SPA auth
 * headers, and run `fn` with an `rpc` helper bound to those headers. Persists
 * the (refreshed) session on success.
 */
async function withSupplyApi<T>(
  tenantId: string,
  fn: (ctx: {
    rpc: <R = unknown>(pathSuffix: string, params: unknown, id?: string) => Promise<R>;
    page: Page;
  }) => Promise<T>,
): Promise<T> {
  const session = await loadStorageStateSession(tenantId);
  if (!session) {
    throw new WbSupplyError(
      'Нет сохранённой WB ЛК сессии. Зайдите в Настройки → WB ЛК Доступ и авторизуйтесь.',
    );
  }

  const browser = await chromium.launch({
    headless: WB_RPA_HEADLESS,
    ...(process.env.WB_RPA_CHROMIUM_PATH
      ? { executablePath: process.env.WB_RPA_CHROMIUM_PATH }
      : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  let context: BrowserContext | null = null;
  try {
    context = await browser.newContext({
      storageState: session.tempPath,
      locale: 'ru-RU',
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();

    // Keep the freshest SPA auth headers seen on any seller-supply request.
    let latestAuth: CapturedAuth | null = null;
    page.on('request', (req) => {
      const u = req.url();
      if (req.method() !== 'POST' || !u.startsWith(SUPPLY_BASE + '/ns/')) return;
      const h = req.headers();
      const authorizev3 = h['authorizev3'];
      const wbSellerLk = h['wb-seller-lk'];
      const rootVersion = h['root-version'];
      if (authorizev3 && wbSellerLk) {
        latestAuth = { authorizev3, wbSellerLk, rootVersion: rootVersion ?? '' };
      }
    });

    // Loading the supplies list fires listSupplies/getWarehouseFilterItems,
    // which carry the auth headers we need.
    await page.goto(SUPPLIES_PAGE, {
      waitUntil: 'domcontentloaded',
      timeout: WB_SUPPLY_TIMEOUT_MS,
    });
    if (isWbAuthRedirect(page.url())) {
      throw new WbSupplyError(
        'WB ЛК сессия истекла (редирект на логин). Переавторизуйтесь в Настройках → WB ЛК Доступ.',
      );
    }
    // Wait until we've captured the SPA auth headers.
    const deadline = Date.now() + 20_000;
    while (!latestAuth && Date.now() < deadline) {
      await page.waitForTimeout(300);
    }
    if (!latestAuth) {
      throw new WbSupplyError(
        'Не удалось перехватить токены авторизации WB (страница поставок не сделала запросов). Повторите попытку.',
      );
    }

    const rpc = async <R = unknown>(pathSuffix: string, params: unknown, id = 'zen'): Promise<R> => {
      const auth = latestAuth!;
      const out = await page.evaluate(
        async ({ url, body, auth }) => {
          try {
            const res = await fetch(url, {
              method: 'POST',
              credentials: 'include',
              headers: {
                'content-type': 'application/json',
                authorizev3: auth.authorizev3,
                'wb-seller-lk': auth.wbSellerLk,
                'root-version': auth.rootVersion,
              },
              body,
            });
            const text = await res.text();
            return { ok: true as const, status: res.status, text };
          } catch (e) {
            return { ok: false as const, status: 0, text: String(e) };
          }
        },
        {
          url: SUPPLY_BASE + pathSuffix,
          body: JSON.stringify({ params, jsonrpc: '2.0', id }),
          auth,
        },
      );

      if (!out.ok) {
        throw new WbSupplyError(`WB ${pathSuffix}: сетевая ошибка — ${out.text.slice(0, 200)}`);
      }
      if (out.status < 200 || out.status >= 300) {
        throw new WbSupplyError(`WB ${pathSuffix}: HTTP ${out.status} — ${out.text.slice(0, 200)}`);
      }
      let json: { result?: R; error?: unknown };
      try {
        json = JSON.parse(out.text);
      } catch {
        throw new WbSupplyError(`WB ${pathSuffix}: не-JSON ответ — ${out.text.slice(0, 200)}`);
      }
      if (json.error) {
        throw new WbSupplyError(`WB ${pathSuffix}: ${JSON.stringify(json.error).slice(0, 300)}`);
      }
      return json.result as R;
    };

    const result = await fn({ rpc, page });

    // Refresh the stored session cookies (best-effort).
    try {
      await persistStorageStateFromContext(tenantId, context!);
    } catch (e) {
      logger.warn({ err: e, tenantId }, '[wb-supply-create] persistStorageState failed');
    }

    return result;
  } finally {
    await context?.close().catch(() => {});
    await browser.close().catch(() => {});
    await session.cleanup?.().catch(() => {});
  }
}

/** Read the seller's full warehouse list (id ↔ name) for mapping. */
export async function listWbWarehouses(tenantId: string): Promise<WbWarehouseItem[]> {
  return withSupplyApi(tenantId, async ({ rpc }) => {
    const res = await rpc<{ items: { warehouseID: number; warehouseName: string }[] }>(
      '/ns/sm-supply/supply-manager/api/v1/warehouse/getWarehouseFilterItems',
      {},
      'zen-wh',
    );
    return (res.items ?? []).map((w) => ({
      warehouseId: w.warehouseID,
      warehouseName: w.warehouseName,
    }));
  });
}

/**
 * Create a WB supply draft, push goods, and (optionally) create the zero-cost
 * preorder. Never books a delivery date (captcha + financial commit stay with
 * the human).
 */
export async function createWbSupply(
  tenantId: string,
  input: CreateWbSupplyInput,
): Promise<CreateWbSupplyResult> {
  // De-dupe + aggregate barcodes; drop empty/zero rows.
  const byBarcode = new Map<string, number>();
  for (const it of input.items) {
    const bc = String(it.barcode ?? '').trim();
    const qty = Math.max(0, Math.floor(Number(it.quantity) || 0));
    if (!bc || qty <= 0) continue;
    byBarcode.set(bc, (byBarcode.get(bc) ?? 0) + qty);
  }
  const barcodes = [...byBarcode.entries()].map(([barcode, quantity]) => ({ barcode, quantity }));
  if (barcodes.length === 0) {
    throw new WbSupplyError('Нет ни одного штрихкода с количеством > 0.');
  }

  const boxTypeID = input.boxTypeID ?? WB_BOX_TYPE_KOROB;
  const warehouseId = input.warehouseId ?? null;

  return withSupplyApi(tenantId, async ({ rpc }) => {
    const warnings: string[] = [];

    // A1 — create draft
    const created = await rpc<{ draftID: string }>(
      '/ns/sm-draft/supply-manager/api/v1/draft/create',
      {},
      'zen-draft-create',
    );
    const draftID = created.draftID;
    if (!draftID) throw new WbSupplyError('WB не вернул draftID.');

    // A2 — push goods (barcodes + quantities)
    await rpc('/ns/sm-draft/supply-manager/api/v1/draft/UpdateDraftGoods', {
      draftID,
      barcodes,
    }, 'zen-draft-goods');

    // A3 — read back what actually landed in the draft
    const listed = await rpc<{ goods: { barcode: string }[]; total: number; quantity: number }>(
      '/ns/sm-draft/supply-manager/api/v1/draft/listDraftGoods',
      { draftID, limit: 1000, offset: 0, filter: { orderBy: { barcode: 1 }, search: '' } },
      'zen-draft-list',
    );
    const landedBarcodes = new Set((listed.goods ?? []).map((g) => g.barcode));
    const goodsUnits = listed.quantity ?? barcodes.reduce((s, b) => s + b.quantity, 0);
    const notLanded = barcodes.filter((b) => !landedBarcodes.has(b.barcode));
    const rejected: CreateWbSupplyResult['rejected'] = notLanded.map((b) => ({
      barcode: b.barcode,
      reason: 'не найден в карточках кабинета WB (баркод не привязан к товару)',
    }));
    if (notLanded.length > 0) {
      warnings.push(
        `${notLanded.length} штрихкод(ов) WB не принял — проверьте, что размеры синхронизированы (Настройки → Ростовки).`,
      );
    }

    let preorderID: number | null = null;

    if (warehouseId) {
      // B1 — validate goods against the chosen warehouse
      try {
        const validated = await rpc<{ items: { barcode: string; hasError: boolean; errors: string[] }[] }>(
          '/ns/sm/supply-manager/api/v1/plan/validateWarehouseGoodsV2',
          { draftID, warehouseId, transitWarehouseId: null },
          'zen-validate',
        );
        for (const it of validated.items ?? []) {
          if (it.hasError) {
            rejected.push({ barcode: it.barcode, reason: (it.errors ?? []).join('; ') || 'ошибка валидации' });
          }
        }
      } catch (e) {
        warnings.push(`Валидация склада не прошла: ${(e as Error).message}`);
      }

      // B2 — create the zero-cost preorder («Не запланировано»)
      const supply = await rpc<{ ids: { Id: number; boxTypeId: number; boxTypeName: string }[] }>(
        '/ns/sm-supply/supply-manager/api/v1/supply/create',
        {
          boxTypeID,
          draftID,
          warehouseId,
          transitWarehouseId: null,
          isBoxOnPallet: false,
          isContainer: false,
        },
        'zen-supply-create',
      );
      preorderID = supply.ids?.[0]?.Id ?? null;
      if (!preorderID) warnings.push('WB не вернул ID преордера — создан только черновик.');
    }

    const deepLink = preorderID
      ? SUPPLIES_PAGE
      : `https://seller.wildberries.ru/supplies-management/new-supply/goods?draftID=${draftID}`;

    logger.info(
      { tenantId, draftID, preorderID, goods: landedBarcodes.size, warehouseId },
      '[wb-supply-create] supply prepared (stopped before plan/add)',
    );

    return {
      draftID,
      preorderID,
      goodsBarcodes: landedBarcodes.size,
      goodsUnits,
      rejected,
      warehouseId,
      deepLink,
      warnings,
    };
  });
}
