'use server';

import { revalidatePath } from 'next/cache';

import { requireTenantFeatureAccess } from '@/lib/auth/tenant-access';
import { listSalesPlanArticles } from '@/server/sales-plan/articles';
import {
  computeDistributionAction,
  type DistributionResult,
  type SupplyStrategy,
} from '@/server/supply/distribution';
import {
  computeDeficitTable,
  computeSizeBreakdown,
  type DeficitResult,
  type SizeDeficitRow,
} from '@/server/supply/deficit';
import {
  computeCurrentLocalization,
  type CurrentLocalizationResult,
} from '@/server/supply/localization-data';
import {
  buildRegionPriorities,
  type GeoPriorityResult,
} from '@/server/supply/geo-priority';
import {
  addSupplyItem,
  addSupplyItemsBulk,
  assembleSupplyFromPlan,
  clearSupplyItems,
  listProfilesForArticle,
  listSupplyItems,
  matchVendorCode,
  removeSupplyItem,
  setSupplyItemBoxes,
  type AssembleArticleInput,
  type ProfileForDropdown,
  type SupplyItem,
  type SupplyItemInput,
} from '@/server/supply-builder/service';
import {
  buildShkAoa,
  buildSupplyAoa,
  toXlsxBuffer,
  type ShkAoaResult,
  type SupplyAoaResult,
} from '@/server/supply-builder/export';
import {
  createWbSupplyBatch,
  listWbWarehousesCached,
  listPlannedSupplies,
  fillWbBoxBarcodes,
  type SupplyGroupInput,
  type SupplyGroupResult,
  type PlannedSupply,
  type FillBoxResult,
} from '@/lib/wb-rpa/wb-supply-create';
import { warehouseToOkrug } from '@/server/supply/geography';

export async function listSupplyArticlesAction(tenantId: string) {
  await requireTenantFeatureAccess(tenantId, 'supply');
  return listSalesPlanArticles(tenantId);
}

export async function computeArticleDistributionAction(
  tenantId: string,
  nmId: number,
  totalQty: number,
  strategy: SupplyStrategy,
): Promise<DistributionResult> {
  await requireTenantFeatureAccess(tenantId, 'supply');
  return computeDistributionAction(tenantId, nmId, totalQty, strategy);
}

export async function loadDeficitTableAction(
  tenantId: string,
  periodDays: number,
  forecastDays: number,
): Promise<DeficitResult> {
  await requireTenantFeatureAccess(tenantId, 'supply');
  return computeDeficitTable(tenantId, { periodDays, forecastDays });
}

export async function loadSizeBreakdownAction(
  tenantId: string,
  nmId: number,
  periodDays: number,
  forecastDays: number,
): Promise<SizeDeficitRow[]> {
  await requireTenantFeatureAccess(tenantId, 'supply');
  return computeSizeBreakdown(tenantId, nmId, { periodDays, forecastDays });
}

/* ── Локализация (порт «Поставлено»: ИЛ/ИРП/КТР/КРП на наших данных) ─── */

export async function loadLocalizationAction(
  tenantId: string,
  periodDays = 91,
): Promise<CurrentLocalizationResult> {
  await requireTenantFeatureAccess(tenantId, 'supply');
  return computeCurrentLocalization(tenantId, { periodDays });
}

export async function loadGeoPriorityAction(
  tenantId: string,
  periodDays = 30,
): Promise<GeoPriorityResult> {
  await requireTenantFeatureAccess(tenantId, 'supply');
  return buildRegionPriorities(tenantId, { periodDays });
}

/* ── Supply list (Шаг 1 + 2 + 3 shared storage) ─────────── */

export async function listProfilesForArticleAction(
  tenantId: string,
  nmId: number | null,
  vendorCode: string,
): Promise<ProfileForDropdown[]> {
  await requireTenantFeatureAccess(tenantId, 'supply');
  return listProfilesForArticle(tenantId, nmId, vendorCode);
}

export async function addSupplyItemAction(
  tenantId: string,
  input: SupplyItemInput,
): Promise<SupplyItem> {
  await requireTenantFeatureAccess(tenantId, 'supply', ['owner', 'admin', 'manager']);
  const item = await addSupplyItem(tenantId, input);
  revalidatePath('/supply');
  return item;
}

export async function listSupplyItemsAction(tenantId: string): Promise<SupplyItem[]> {
  await requireTenantFeatureAccess(tenantId, 'supply');
  return listSupplyItems(tenantId);
}

export async function assembleSupplyFromPlanAction(
  tenantId: string,
  articles: AssembleArticleInput[],
): Promise<{ added: SupplyItem[]; failed: { vendorCode: string; reason: string }[] }> {
  await requireTenantFeatureAccess(tenantId, 'supply', ['owner', 'admin', 'manager']);
  const result = await assembleSupplyFromPlan(tenantId, articles);
  revalidatePath('/supply');
  return result;
}

export async function removeSupplyItemAction(tenantId: string, id: string): Promise<void> {
  await requireTenantFeatureAccess(tenantId, 'supply', ['owner', 'admin', 'manager']);
  await removeSupplyItem(tenantId, id);
  revalidatePath('/supply');
}

export async function setSupplyItemBoxesAction(tenantId: string, id: string, boxes: number): Promise<SupplyItem> {
  await requireTenantFeatureAccess(tenantId, 'supply', ['owner', 'admin', 'manager']);
  const item = await setSupplyItemBoxes(tenantId, id, boxes);
  revalidatePath('/supply');
  return item;
}

export async function clearSupplyItemsAction(tenantId: string): Promise<void> {
  await requireTenantFeatureAccess(tenantId, 'supply', ['owner', 'admin', 'manager']);
  await clearSupplyItems(tenantId);
  revalidatePath('/supply');
}

/* ── Шаг 2: Накладная ──────────────────────────────────── */

export type InvoiceRowInput = {
  inputText: string;
  /** Parsed article (after "-N" shorthand expansion done client-side). */
  article: string;
  boxes: number;
  /** Optional profile id picked in the dropdown. */
  profileId?: string | null;
};

export type InvoiceProcessResult = {
  added: SupplyItem[];
  failed: { inputText: string; article: string; boxes: number; reason: string }[];
};

export async function processInvoiceAction(
  tenantId: string,
  rows: InvoiceRowInput[],
): Promise<InvoiceProcessResult> {
  await requireTenantFeatureAccess(tenantId, 'supply', ['owner', 'admin', 'manager']);

  const inputs: SupplyItemInput[] = [];
  const failedEarly: InvoiceProcessResult['failed'] = [];
  for (const row of rows) {
    if (!row.article || row.boxes <= 0) continue;
    const match = await matchVendorCode(tenantId, row.article);
    if (!match) {
      failedEarly.push({
        inputText: row.inputText,
        article: row.article,
        boxes: row.boxes,
        reason: 'артикул не найден в кабинете',
      });
      continue;
    }
    const profiles = await listProfilesForArticle(tenantId, match.nmId, match.vendorCode);
    if (profiles.length === 0) {
      failedEarly.push({
        inputText: row.inputText,
        article: row.article,
        boxes: row.boxes,
        reason: 'нет сохранённой ростовки — создай в Настройках',
      });
      continue;
    }
    let chosen: ProfileForDropdown | undefined;
    if (row.profileId) chosen = profiles.find((p) => p.id === row.profileId);
    if (!chosen) chosen = profiles.find((p) => p.isDefault) ?? profiles[0]!;

    inputs.push({
      vendorCode: match.vendorCode,
      nmId: match.nmId,
      profileId: chosen.id,
      profileName: chosen.name,
      boxes: row.boxes,
      rows: chosen.rows,
      source: 'invoice',
    });
  }

  const bulk = await addSupplyItemsBulk(tenantId, inputs);
  revalidatePath('/supply');
  return {
    added: bulk.added,
    failed: [
      ...failedEarly,
      ...bulk.failed.map((f) => ({
        inputText: f.input.vendorCode,
        article: f.input.vendorCode,
        boxes: f.input.boxes,
        reason: f.reason,
      })),
    ],
  };
}

/* ── Exports ───────────────────────────────────────────── */

export async function buildSupplyXlsxAction(tenantId: string): Promise<{ filename: string; base64: string; summary: SupplyAoaResult }> {
  await requireTenantFeatureAccess(tenantId, 'supply');
  const items = await listSupplyItems(tenantId);
  if (items.length === 0) throw new Error('Список поставки пуст');
  const summary = buildSupplyAoa(items);
  if (summary.barcodesCount === 0) {
    throw new Error('Ни одного штрихкода — сначала подтяни размеры из WB в Настройках → Ростовки');
  }

  // WB принимает файл товаров ТОЛЬКО в своём формате: один лист «Sheet1»,
  // колонки «Баркод» / «Количество». Поэтому отдаём строго один лист со
  // всеми баркодами. (Разбивку по складам в отдельные файлы/ZIP добавим
  // отдельно — WB на загрузке читает только один лист.)
  const buffer = await toXlsxBuffer(summary.aoa, 'Sheet1');
  return {
    filename: `postavka_wb_${dateStamp()}.xlsx`,
    base64: buffer.toString('base64'),
    summary,
  };
}

export type GenerateShkInput = {
  firstShk: string;
  boxCount: number;
};

export async function buildShkXlsxAction(
  tenantId: string,
  input: GenerateShkInput,
): Promise<{ filename: string; base64: string; preview: ShkAoaResult['boxes'] }> {
  await requireTenantFeatureAccess(tenantId, 'supply');
  const items = await listSupplyItems(tenantId);
  if (items.length === 0) throw new Error('Список поставки пуст');
  const missing = items.some((i) => i.missingBc > 0);
  if (missing) {
    throw new Error('В списке есть строки без штрихкодов. Пересоздай ростовки после синхронизации WB.');
  }
  const result = buildShkAoa(items, input.firstShk, input.boxCount);
  const buffer = await toXlsxBuffer(result.aoa, 'ШК коробов');
  return {
    filename: `shk_${dateStamp()}.xlsx`,
    base64: buffer.toString('base64'),
    preview: result.boxes,
  };
}

function dateStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/* ── WB automation: создать поставку прямо в кабинете ───────────────────────
 *
 * Группирует позиции по складу из «Плана поставки», сопоставляет склад с
 * реальным складом WB и создаёт по преордеру на каждый склад (или черновик,
 * если позиции без склада / склад не сопоставлен). Автозаполняет товары через
 * сохранённую WB ЛК сессию. НЕ бронирует дату — это финансовый шаг с капчей,
 * остаётся за пользователем (отдаём deep link). См. wb-supply-create.ts.
 */
export async function createWbSupplyAction(
  tenantId: string,
  overrideWarehouseId?: number | null,
): Promise<SupplyGroupResult[]> {
  await requireTenantFeatureAccess(tenantId, 'supply', ['owner', 'admin', 'manager']);
  const items = await listSupplyItems(tenantId);
  if (items.length === 0) throw new Error('Список поставки пуст');

  let groups: SupplyGroupInput[];

  if (overrideWarehouseId) {
    // Override: вся поставка одной поставкой на выбранный склад WB.
    const bc = new Map<string, number>();
    for (const item of items) {
      for (const row of item.rows) {
        if (row.total <= 0 || !row.barcode) continue;
        bc.set(row.barcode, (bc.get(row.barcode) ?? 0) + row.total);
      }
    }
    const groupItems = [...bc.entries()].map(([barcode, quantity]) => ({ barcode, quantity }));
    if (groupItems.length === 0) {
      throw new Error('Ни одного штрихкода — сначала подтяни размеры из WB в Настройках → Ростовки');
    }
    groups = [{ warehouseName: null, warehouseId: overrideWarehouseId, items: groupItems }];
  } else {
    // Авто: по складу из «Плана поставки» (null = без склада → черновик).
    const byWarehouse = new Map<string | null, Map<string, number>>();
    for (const item of items) {
      const wh = item.warehouse?.trim() || null;
      let bc = byWarehouse.get(wh);
      if (!bc) { bc = new Map(); byWarehouse.set(wh, bc); }
      for (const row of item.rows) {
        if (row.total <= 0 || !row.barcode) continue;
        bc.set(row.barcode, (bc.get(row.barcode) ?? 0) + row.total);
      }
    }
    groups = [];
    for (const [warehouseName, bc] of byWarehouse) {
      const groupItems = [...bc.entries()].map(([barcode, quantity]) => ({ barcode, quantity }));
      if (groupItems.length > 0) groups.push({ warehouseName, items: groupItems });
    }
    if (groups.length === 0) {
      throw new Error('Ни одного штрихкода — сначала подтяни размеры из WB в Настройках → Ростовки');
    }
  }

  return createWbSupplyBatch(tenantId, groups);
}

/** Real WB warehouses for the dropdowns (cached). Excludes specialized lines. */
export async function listWbWarehousesAction(
  tenantId: string,
): Promise<{ warehouseId: number; warehouseName: string; okrug: string | null }[]> {
  await requireTenantFeatureAccess(tenantId, 'supply');
  const list = await listWbWarehousesCached(tenantId);
  return list
    .filter((w) => !/(питание|горюч|шины)/i.test(w.warehouseName))
    .map((w) => ({ warehouseId: w.warehouseId, warehouseName: w.warehouseName, okrug: warehouseToOkrug(w.warehouseName) }))
    .sort((a, b) => a.warehouseName.localeCompare(b.warehouseName, 'ru'));
}

/* ── ШК коробов в кабинете (после брони даты) ──────────────────────────────── */

/** Booked WB supplies that still need box barcodes (для пикера). */
export async function listPlannedSuppliesAction(tenantId: string): Promise<PlannedSupply[]> {
  await requireTenantFeatureAccess(tenantId, 'supply');
  return listPlannedSupplies(tenantId);
}

/**
 * Generate + bind box barcodes (ШК коробов) in WB for a booked supply, using
 * the current «Список поставки» box layout (item.boxes коробов × ростовка).
 */
export async function fillWbBoxBarcodesAction(
  tenantId: string,
  supplyId: number,
): Promise<FillBoxResult> {
  await requireTenantFeatureAccess(tenantId, 'supply', ['owner', 'admin', 'manager']);
  if (!supplyId || supplyId <= 0) throw new Error('Не выбрана поставка.');
  const items = await listSupplyItems(tenantId);
  if (items.length === 0) throw new Error('Список поставки пуст — нечего паковать.');

  // One box per item.boxes, each box = the article's per-box ростовка.
  const boxes: { barcode: string; quantity: number }[][] = [];
  for (const item of items) {
    const comp = item.rows
      .filter((r) => r.perBox > 0 && r.barcode)
      .map((r) => ({ barcode: r.barcode, quantity: r.perBox }));
    if (comp.length === 0) continue;
    for (let b = 0; b < item.boxes; b++) boxes.push(comp);
  }
  if (boxes.length === 0) {
    throw new Error('Нет коробов со штрихкодами — проверь ростовки (Настройки → Ростовки).');
  }
  return fillWbBoxBarcodes(tenantId, supplyId, boxes);
}
