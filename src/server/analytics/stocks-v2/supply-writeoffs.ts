import { createHash } from "node:crypto";

import { and, eq, inArray, sql } from "drizzle-orm";

import { db, type DrizzleTransaction, withTenantContext } from "@/lib/db";
import { tenants, wbSupplyWriteoffs } from "@/lib/db/schema";
import { decryptIfNeeded } from "@/lib/encryption";
import { logger } from "@/lib/logger";
import {
  type WbFbwSupplyDetails,
  type WbFbwSupplyGood,
  type WbFbwSupplyListItem,
  wbApi,
} from "@/lib/wb-api";
import { bot } from "@/server/bot/service";
import { consumeOwnStockFifo } from "@/server/analytics/stocks-v2/own-stock-ledger";

const DEFAULT_LOOKBACK_DAYS = 2;
const MAX_LOOKBACK_DAYS = 180;
const ACCEPTED_SUPPLY_STATUS_IDS = [5, 6];
const IGNORED_INSUFFICIENT_STOCK_STATUS = "ignored_insufficient_stock";
const APP_BASE_URL = process.env.APP_BASE_URL ?? "https://enterprise-analytics.v-wb.ru";

type TenantForSupplyWriteoffs = {
  id: string;
  name: string;
  shopName: string | null;
  wbApiToken: string;
  telegramChatId: number | null;
  notificationsEnabled: boolean;
};

type SupplyIdentity = {
  key: string;
  id: number;
  isPreorder: boolean;
  supplyId: number | null;
  preorderId: number | null;
};

type SupplyLineInput = {
  tenantId: string;
  identity: SupplyIdentity;
  supply: WbFbwSupplyListItem;
  details: WbFbwSupplyDetails | null;
  good: WbFbwSupplyGood;
  lineKey: string;
  nmId: number;
  quantity: number;
};

type LineNotificationEvent = {
  lineKey: string;
  supplyKey: string;
  nmId: number;
  vendorCode: string | null;
  barcode: string | null;
  quantity: number;
  acceptedQuantity?: number | null;
  discrepancyQuantity?: number | null;
  discrepancyResolved?: boolean;
  error?: string;
};

type LineProcessResult = {
  writtenOffUnits: number;
  writeOffError?: LineNotificationEvent;
  discrepancy?: LineNotificationEvent;
};

export type WbSupplyWriteoffSummary = {
  suppliesScanned: number;
  linesSeen: number;
  writtenOffLines: number;
  writtenOffUnits: number;
  discrepancies: number;
  writeOffErrors: number;
  notificationsSent: boolean;
};

export type WbSupplyWriteoffReconcileOptions = {
  supplyIds?: number[];
  preorderIds?: number[];
  lookbackDays?: number;
};

function parseLookbackDays(override?: number) {
  if (override !== undefined && Number.isFinite(override) && override > 0) {
    return Math.min(Math.trunc(override), MAX_LOOKBACK_DAYS);
  }

  const parsed = Number.parseInt(process.env.WB_SUPPLY_WRITEOFF_LOOKBACK_DAYS ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LOOKBACK_DAYS;
  }

  return Math.min(parsed, MAX_LOOKBACK_DAYS);
}

function formatApiDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function getDateRange(options: WbSupplyWriteoffReconcileOptions = {}) {
  const till = new Date();
  const from = new Date(till);
  from.setUTCDate(from.getUTCDate() - parseLookbackDays(options.lookbackDays));

  return {
    from: formatApiDate(from),
    till: formatApiDate(till),
  };
}

function getInteger(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.trunc(value);
}

function getPositiveInteger(value: number | null | undefined) {
  const integer = getInteger(value);
  return integer !== null && integer > 0 ? integer : 0;
}

function truncateText(value: string | null | undefined, maxLength: number) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function toNullableDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toJsonRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function getSupplyIdentity(supply: WbFbwSupplyListItem): SupplyIdentity | null {
  if (supply.supplyId && supply.supplyId > 0) {
    return {
      key: `supply:${supply.supplyId}`,
      id: supply.supplyId,
      isPreorder: false,
      supplyId: supply.supplyId,
      preorderId: supply.preorderId,
    };
  }

  if (supply.preorderId && supply.preorderId > 0) {
    return {
      key: `preorder:${supply.preorderId}`,
      id: supply.preorderId,
      isPreorder: true,
      supplyId: null,
      preorderId: supply.preorderId,
    };
  }

  return null;
}

function buildLineKey(identity: SupplyIdentity, good: WbFbwSupplyGood, nmId: number) {
  const fingerprint = createHash("sha1")
    .update([
      identity.key,
      nmId,
      good.barcode ?? "",
      good.techSize ?? "",
      good.vendorCode ?? "",
    ].join("|"))
    .digest("hex")
    .slice(0, 16);

  return `${identity.key}:nm:${nmId}:g:${fingerprint}`;
}

function getLineLabel(event: LineNotificationEvent) {
  return event.vendorCode
    ? `${event.vendorCode} / nmId ${event.nmId}`
    : `nmId ${event.nmId}`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function buildAbsoluteAppUrl(href: string) {
  return new URL(href, APP_BASE_URL).toString();
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isAcceptedSupplyStatus(statusId: number | null | undefined) {
  return statusId === 5 || statusId === 6;
}

async function loadTenant(tenantId: string) {
  const rows = await withTenantContext(db, tenantId, async (tx) => (
    tx.select({
      id: tenants.id,
      name: tenants.name,
      shopName: tenants.shopName,
      wbApiToken: tenants.wbApiToken,
      telegramChatId: tenants.telegramChatId,
      notificationsEnabled: tenants.notificationsEnabled,
    })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1)
  ));

  return rows[0] ?? null;
}

function buildSeedSupply(identity: SupplyIdentity): WbFbwSupplyListItem {
  return {
    supplyId: identity.supplyId,
    preorderId: identity.preorderId,
    createDate: null,
    supplyDate: null,
    factDate: null,
    updatedDate: null,
    statusId: null,
    boxTypeId: null,
    isBoxOnPallet: null,
  };
}

async function fetchSupplies(token: string, options: WbSupplyWriteoffReconcileOptions = {}) {
  const supplies = new Map<string, WbFbwSupplyListItem>();
  const targetSupplyIds = [...new Set((options.supplyIds ?? [])
    .filter((id) => Number.isFinite(id) && id > 0)
    .map((id) => Math.trunc(id)))];
  const targetPreorderIds = [...new Set((options.preorderIds ?? [])
    .filter((id) => Number.isFinite(id) && id > 0)
    .map((id) => Math.trunc(id)))];

  for (const supplyId of targetSupplyIds) {
    const identity: SupplyIdentity = {
      key: `supply:${supplyId}`,
      id: supplyId,
      isPreorder: false,
      supplyId,
      preorderId: null,
    };
    supplies.set(identity.key, buildSeedSupply(identity));
  }

  for (const preorderId of targetPreorderIds) {
    const identity: SupplyIdentity = {
      key: `preorder:${preorderId}`,
      id: preorderId,
      isPreorder: true,
      supplyId: null,
      preorderId,
    };
    supplies.set(identity.key, buildSeedSupply(identity));
  }

  if (supplies.size > 0) {
    return [...supplies.values()];
  }

  const { from, till } = getDateRange(options);

  const batches = await Promise.all([
    wbApi.getFbwSupplies(token, {
      from,
      till,
      dateType: "factDate",
      statusIds: ACCEPTED_SUPPLY_STATUS_IDS,
    }),
    wbApi.getFbwSupplies(token, {
      from,
      till,
      dateType: "updatedDate",
      statusIds: ACCEPTED_SUPPLY_STATUS_IDS,
    }),
  ]);

  for (const batch of batches) {
    for (const supply of batch) {
      const identity = getSupplyIdentity(supply);
      if (!identity) {
        continue;
      }

      supplies.set(identity.key, supply);
    }
  }

  return [...supplies.values()];
}

async function processSupplyLine(
  tx: DrizzleTransaction,
  input: SupplyLineInput,
): Promise<LineProcessResult> {
  const existingRows = await tx.select()
    .from(wbSupplyWriteoffs)
    .where(and(
      eq(wbSupplyWriteoffs.tenantId, input.tenantId),
      eq(wbSupplyWriteoffs.lineKey, input.lineKey),
    ))
    .limit(1);
  const existing = existingRows[0] ?? null;

  const acceptedQuantity = getInteger(input.good.acceptedQuantity);
  const unloadingQuantity = getInteger(input.good.unloadingQuantity);
  const readyForSaleQuantity = getInteger(input.good.readyForSaleQuantity);
  const discrepancyQuantity = acceptedQuantity === null
    ? null
    : acceptedQuantity - input.quantity;
  const discrepancyStatus = discrepancyQuantity === null
    ? "pending"
    : discrepancyQuantity === 0
      ? "ok"
      : "mismatch";

  const baseValues = {
    tenantId: input.tenantId,
    supplyKey: input.identity.key,
    lineKey: input.lineKey,
    supplyId: input.identity.supplyId,
    preorderId: input.identity.preorderId,
    isPreorder: input.identity.isPreorder,
    statusId: input.details?.statusId ?? input.supply.statusId,
    nmId: input.nmId,
    barcode: truncateText(input.good.barcode, 255) ?? "",
    vendorCode: truncateText(input.good.vendorCode, 255),
    warehouseName: truncateText(input.details?.warehouseName, 255),
    actualWarehouseName: truncateText(input.details?.actualWarehouseName, 255),
    supplyDate: toNullableDate(input.details?.supplyDate ?? input.supply.supplyDate),
    factDate: toNullableDate(input.details?.factDate ?? input.supply.factDate),
    wbQuantity: input.quantity,
    acceptedQuantity,
    unloadingQuantity,
    readyForSaleQuantity,
    discrepancyQuantity,
    discrepancyStatus,
    rawSupply: toJsonRecord(input.details ?? input.supply),
    rawGoods: toJsonRecord(input.good),
    lastSeenAt: sql`NOW()`,
    updatedAt: sql`NOW()`,
  };

  if (!existing) {
    await tx.insert(wbSupplyWriteoffs).values(baseValues);
  }

  const currentWrittenOff = existing?.localWrittenOffQuantity ?? 0;
  const missingToWriteOff = Math.max(input.quantity - currentWrittenOff, 0);
  const isIgnoredInsufficientStock = existing?.writeOffStatus === IGNORED_INSUFFICIENT_STOCK_STATUS;
  let nextWrittenOffQuantity = currentWrittenOff;
  let writtenOffUnits = 0;
  let writeOffStatus = isIgnoredInsufficientStock
    ? IGNORED_INSUFFICIENT_STOCK_STATUS
    : currentWrittenOff >= input.quantity
      ? "written_off"
      : "pending";
  let writeOffError: string | null = isIgnoredInsufficientStock ? existing?.writeOffError ?? null : null;
  let writtenOffAt: Date | null | undefined = existing?.writtenOffAt ?? null;
  let writeOffEvent: LineNotificationEvent | undefined;

  if (!isIgnoredInsufficientStock && missingToWriteOff > 0) {
    try {
      await consumeOwnStockFifo(
        tx,
        input.tenantId,
        input.nmId,
        missingToWriteOff,
        "shipped_to_wb",
        `Автосписание WB ${input.identity.key}`,
        "own",
      );
      nextWrittenOffQuantity += missingToWriteOff;
      writtenOffUnits = missingToWriteOff;
      writeOffStatus = "written_off";
      writtenOffAt = new Date();
    } catch (error) {
      writeOffStatus = "insufficient_stock";
      writeOffError = getErrorMessage(error);

      if (!existing?.writeOffErrorNotifiedAt) {
        writeOffEvent = {
          lineKey: input.lineKey,
          supplyKey: input.identity.key,
          nmId: input.nmId,
          vendorCode: input.good.vendorCode,
          barcode: input.good.barcode,
          quantity: input.quantity,
          error: writeOffError,
        };
      }
    }
  }

  const discrepancyChanged = existing?.discrepancyQuantity !== discrepancyQuantity;
  const discrepancyEvent = discrepancyQuantity !== null && (
    (discrepancyQuantity !== 0 && (!existing?.discrepancyNotifiedAt || discrepancyChanged))
    || (discrepancyQuantity === 0 && existing?.discrepancyStatus === "mismatch")
  )
    ? {
        lineKey: input.lineKey,
        supplyKey: input.identity.key,
        nmId: input.nmId,
        vendorCode: input.good.vendorCode,
        barcode: input.good.barcode,
        quantity: input.quantity,
        acceptedQuantity,
        discrepancyQuantity,
        discrepancyResolved: discrepancyQuantity === 0,
      }
    : undefined;

  await tx.update(wbSupplyWriteoffs)
    .set({
      ...baseValues,
      localWrittenOffQuantity: nextWrittenOffQuantity,
      writeOffStatus,
      writeOffError,
      writtenOffAt,
    })
    .where(and(
      eq(wbSupplyWriteoffs.tenantId, input.tenantId),
      eq(wbSupplyWriteoffs.lineKey, input.lineKey),
    ));

  return {
    writtenOffUnits,
    writeOffError: writeOffEvent,
    discrepancy: discrepancyEvent,
  };
}

function buildNotificationMessage(
  tenant: TenantForSupplyWriteoffs,
  writeOffErrors: LineNotificationEvent[],
  discrepancies: LineNotificationEvent[],
) {
  const tenantName = tenant.shopName ?? tenant.name;
  const lines: string[] = [
    `<b>Автосверка WB-поставок — ${escapeHtml(tenantName)}</b>`,
    "",
  ];

  if (writeOffErrors.length > 0) {
    lines.push(`<b>Не удалось списать со своего склада (${writeOffErrors.length}):</b>`);
    for (const event of writeOffErrors.slice(0, 10)) {
      lines.push(
        `• ${escapeHtml(getLineLabel(event))}: поставка ${escapeHtml(event.supplyKey)}, нужно ${event.quantity} шт. ${escapeHtml(event.error ?? "")}`,
      );
    }
    if (writeOffErrors.length > 10) {
      lines.push(`... и еще ${writeOffErrors.length - 10}`);
    }
    lines.push("");
  }

  if (discrepancies.length > 0) {
    lines.push(`<b>Расхождения и доприемка WB (${discrepancies.length}):</b>`);
    for (const event of discrepancies.slice(0, 10)) {
      const statusText = event.discrepancyResolved
        ? "расхождение закрыто"
        : `разница ${event.discrepancyQuantity ?? "?"}`;
      lines.push(
        `• ${escapeHtml(getLineLabel(event))}: поставка ${escapeHtml(event.supplyKey)}, заявлено ${event.quantity}, принято ${event.acceptedQuantity ?? "?"}, ${statusText}.`,
      );
    }
    if (discrepancies.length > 10) {
      lines.push(`... и еще ${discrepancies.length - 10}`);
    }
    lines.push("");
  }

  lines.push(`<a href="${escapeHtml(buildAbsoluteAppUrl("/stocks-v2/wb-supplies"))}">Открыть WB-поставки</a>`);

  return lines.join("\n").slice(0, 3900);
}

async function markNotificationsSent(
  tenantId: string,
  writeOffErrorKeys: string[],
  discrepancyKeys: string[],
) {
  if (writeOffErrorKeys.length === 0 && discrepancyKeys.length === 0) {
    return;
  }

  await withTenantContext(db, tenantId, async (tx) => {
    if (writeOffErrorKeys.length > 0) {
      await tx.update(wbSupplyWriteoffs)
        .set({
          writeOffErrorNotifiedAt: sql`NOW()`,
          updatedAt: sql`NOW()`,
        })
        .where(and(
          eq(wbSupplyWriteoffs.tenantId, tenantId),
          inArray(wbSupplyWriteoffs.lineKey, writeOffErrorKeys),
        ));
    }

    if (discrepancyKeys.length > 0) {
      await tx.update(wbSupplyWriteoffs)
        .set({
          discrepancyNotifiedAt: sql`NOW()`,
          updatedAt: sql`NOW()`,
        })
        .where(and(
          eq(wbSupplyWriteoffs.tenantId, tenantId),
          inArray(wbSupplyWriteoffs.lineKey, discrepancyKeys),
        ));
    }
  });
}

async function sendNotifications(
  tenant: TenantForSupplyWriteoffs,
  writeOffErrors: LineNotificationEvent[],
  discrepancies: LineNotificationEvent[],
) {
  if (
    !bot
    || !tenant.telegramChatId
    || !tenant.notificationsEnabled
    || (writeOffErrors.length === 0 && discrepancies.length === 0)
  ) {
    return false;
  }

  const message = buildNotificationMessage(tenant, writeOffErrors, discrepancies);
  await bot.api.sendMessage(tenant.telegramChatId, message, {
    parse_mode: "HTML",
    link_preview_options: {
      is_disabled: true,
    },
  });

  await markNotificationsSent(
    tenant.id,
    writeOffErrors.map((event) => event.lineKey),
    discrepancies.map((event) => event.lineKey),
  );

  return true;
}

export async function reconcileWbSupplyWriteoffsForTenant(
  tenantId: string,
  options: WbSupplyWriteoffReconcileOptions = {},
): Promise<WbSupplyWriteoffSummary> {
  const tenant = await loadTenant(tenantId);
  if (!tenant) {
    throw new Error(`Tenant ${tenantId} not found`);
  }

  const token = decryptIfNeeded(tenant.wbApiToken ?? "", tenantId).trim();
  if (!token) {
    return {
      suppliesScanned: 0,
      linesSeen: 0,
      writtenOffLines: 0,
      writtenOffUnits: 0,
      discrepancies: 0,
      writeOffErrors: 0,
      notificationsSent: false,
    };
  }

  const supplies = await fetchSupplies(token, options);
  const writeOffErrorEvents: LineNotificationEvent[] = [];
  const discrepancyEvents: LineNotificationEvent[] = [];
  const summary: WbSupplyWriteoffSummary = {
    suppliesScanned: supplies.length,
    linesSeen: 0,
    writtenOffLines: 0,
    writtenOffUnits: 0,
    discrepancies: 0,
    writeOffErrors: 0,
    notificationsSent: false,
  };

  for (const supply of supplies) {
    const identity = getSupplyIdentity(supply);
    if (!identity) {
      continue;
    }

    const details = await wbApi.getFbwSupplyDetails(token, identity.id, { isPreorder: identity.isPreorder });
    const statusId = details?.statusId ?? supply.statusId;
    if (!isAcceptedSupplyStatus(statusId)) {
      continue;
    }

    const goods = await wbApi.getFbwSupplyGoods(token, identity.id, { isPreorder: identity.isPreorder });

    for (const good of goods) {
      const nmId = getInteger(good.nmId);
      const quantity = getPositiveInteger(good.quantity);
      if (!nmId || quantity <= 0) {
        continue;
      }

      summary.linesSeen += 1;

      const lineKey = buildLineKey(identity, good, nmId);
      const result = await withTenantContext(db, tenantId, async (tx) => (
        processSupplyLine(tx, {
          tenantId,
          identity,
          supply,
          details,
          good,
          lineKey,
          nmId,
          quantity,
        })
      ));

      if (result.writtenOffUnits > 0) {
        summary.writtenOffLines += 1;
        summary.writtenOffUnits += result.writtenOffUnits;
      }

      if (result.writeOffError) {
        summary.writeOffErrors += 1;
        writeOffErrorEvents.push(result.writeOffError);
      }

      if (result.discrepancy) {
        summary.discrepancies += 1;
        discrepancyEvents.push(result.discrepancy);
      }
    }
  }

  try {
    summary.notificationsSent = await sendNotifications(
      tenant,
      writeOffErrorEvents,
      discrepancyEvents,
    );
  } catch (error) {
    logger.error({ err: error, tenantId }, "[stocks-v2] supply writeoff notification failed");
  }

  return summary;
}
