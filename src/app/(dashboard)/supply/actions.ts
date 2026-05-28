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
  type DeficitResult,
} from '@/server/supply/deficit';
import {
  addSupplyItem,
  addSupplyItemsBulk,
  assembleSupplyFromPlan,
  clearSupplyItems,
  listProfilesForArticle,
  listSupplyItems,
  matchVendorCode,
  removeSupplyItem,
  type AssembleArticleInput,
  type ProfileForDropdown,
  type SupplyItem,
  type SupplyItemInput,
} from '@/server/supply-builder/service';
import {
  buildShkAoa,
  buildSupplyAoa,
  buildSupplyWorkbookByWarehouse,
  toXlsxBuffer,
  type ShkAoaResult,
  type SupplyAoaResult,
} from '@/server/supply-builder/export';

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

  // If any item is routed to a warehouse (assembled from План поставки),
  // produce a multi-sheet workbook — one WB-ready sheet per warehouse.
  const hasWarehouses = items.some((i) => i.warehouse);
  if (hasWarehouses) {
    const wbResult = await buildSupplyWorkbookByWarehouse(items);
    return {
      filename: `postavka_po_skladam_${dateStamp()}.xlsx`,
      base64: wbResult.buffer.toString('base64'),
      summary,
    };
  }

  const buffer = await toXlsxBuffer(summary.aoa, 'Поставка');
  return {
    filename: `postavka_${dateStamp()}.xlsx`,
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
