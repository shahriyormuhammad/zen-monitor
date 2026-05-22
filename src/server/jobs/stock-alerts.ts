import { and, eq, gte, lt, sql } from "drizzle-orm";

import { inngest } from "@/inngest/client";
import { handleInngestFailure } from "@/inngest/on-failure";
import { db } from "@/lib/db";
import { tenants, rawApiStockSizes, rawApiOrders, ownStockBatches, productionOrderLines, productionOrders, products } from "@/lib/db/schema";
import { bot } from "@/server/bot/service";
import { logger } from "@/lib/logger";

/**
 * Stock Alerts — Inngest cron job
 *
 * Runs daily at 9:00 AM Moscow time (6:00 UTC).
 * For each tenant with Telegram notifications enabled:
 * 1. Computes coverage days for each SKU
 * 2. Sends alerts for:
 *    - SKUs with WB coverage < configurable threshold (default 3 days)
 *    - SKUs completely out of stock on WB
 *    - SKUs that need a China order placed NOW (based on lead time)
 */

const DEFAULT_ALERT_THRESHOLD_DAYS = 3;
const DEFAULT_LEAD_TIME_DAYS = 46; // production 14 + transit 25 + customs 7

type StockAlertItem = {
  nmId: number;
  vendorCode: string | null;
  brand: string | null;
  wbStock: number;
  dailyDemand: number;
  coverageDays: number | null;
  ownStock: number;
  inTransitChina: number;
  inProductionQty: number;
  alertType: "out_of_stock" | "low_stock" | "order_china";
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function formatAlertMessage(alerts: StockAlertItem[], tenantName: string): string {
  const oos = alerts.filter((a) => a.alertType === "out_of_stock");
  const low = alerts.filter((a) => a.alertType === "low_stock");
  const order = alerts.filter((a) => a.alertType === "order_china");

  const lines: string[] = [];
  lines.push(`<b>📦 Алерт по остаткам — ${escapeHtml(tenantName)}</b>`);
  lines.push("");

  if (oos.length > 0) {
    lines.push(`<b>🔴 Out of stock на WB (${oos.length}):</b>`);
    for (const item of oos.slice(0, 10)) {
      const label = item.vendorCode ? escapeHtml(item.vendorCode) : `nmId ${item.nmId}`;
      const demand = item.dailyDemand > 0 ? ` · ${item.dailyDemand.toFixed(1)} шт/день` : "";
      lines.push(`  • <b>${label}</b>${demand}`);
    }
    if (oos.length > 10) lines.push(`  ... и ещё ${oos.length - 10}`);
    lines.push("");
  }

  if (low.length > 0) {
    lines.push(`<b>🟡 Мало на WB — осталось на ${DEFAULT_ALERT_THRESHOLD_DAYS} дн или менее (${low.length}):</b>`);
    for (const item of low.slice(0, 10)) {
      const label = item.vendorCode ? escapeHtml(item.vendorCode) : `nmId ${item.nmId}`;
      const days = item.coverageDays !== null ? `${item.coverageDays.toFixed(1)} дн` : "?";
      lines.push(`  • <b>${label}</b> — ${days} · WB: ${item.wbStock} шт`);
    }
    if (low.length > 10) lines.push(`  ... и ещё ${low.length - 10}`);
    lines.push("");
  }

  if (order.length > 0) {
    lines.push(`<b>🟠 Пора заказывать в Китае (${order.length}):</b>`);
    for (const item of order.slice(0, 10)) {
      const label = item.vendorCode ? escapeHtml(item.vendorCode) : `nmId ${item.nmId}`;
      const pipeline = item.inTransitChina + item.inProductionQty;
      const totalDays = item.coverageDays !== null
        ? item.coverageDays.toFixed(0)
        : "?";
      lines.push(
        `  • <b>${label}</b> — покрытие ~${totalDays} дн, в пути: ${pipeline} шт`
      );
    }
    if (order.length > 10) lines.push(`  ... и ещё ${order.length - 10}`);
    lines.push("");
  }

  const total = oos.length + low.length + order.length;
  lines.push(`Итого: <b>${total}</b> позиций требуют внимания`);

  return lines.join("\n");
}

export const stockAlertsJob = inngest.createFunction(
  {
    id: "stock-alerts-daily",
    name: "Stock Alerts Daily Check",
    concurrency: { limit: 1 },
    onFailure: handleInngestFailure,
    triggers: [{ cron: "0 6 * * *" }], // 6:00 UTC = 9:00 MSK
  },
  async ({ step }) => {
    const activeTenants = await step.run("fetch-tenants", async () => {
      return db
        .select({
          id: tenants.id,
          name: tenants.name,
          telegramChatId: tenants.telegramChatId,
          notificationsEnabled: tenants.notificationsEnabled,
        })
        .from(tenants)
        .where(eq(tenants.notificationsEnabled, true));
    });

    const results: { tenantId: string; alerts: number; sent: boolean }[] = [];

    for (const tenant of activeTenants) {
      if (!tenant.telegramChatId || !bot) {
        results.push({ tenantId: tenant.id, alerts: 0, sent: false });
        continue;
      }

      const alerts = await step.run(`check-stocks-${tenant.id}`, async () => {
        const now = new Date();
        const from = new Date(now);
        from.setUTCDate(from.getUTCDate() - 30);
        from.setUTCHours(0, 0, 0, 0);
        const to = new Date(now);
        to.setUTCHours(0, 0, 0, 0);
        const toExclusive = new Date(to);
        toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);
        const dateWindowDays = 30;

        // Get latest stock snapshot
        const [snapshotRow] = await db
          .select({
            snapshotDate: sql<Date | null>`MAX(${rawApiStockSizes.snapshotDate})`,
          })
          .from(rawApiStockSizes)
          .where(
            and(
              eq(rawApiStockSizes.tenantId, tenant.id),
              eq(rawApiStockSizes.stockType, "wb")
            )
          );

        const snapshotDate = snapshotRow?.snapshotDate;
        if (!snapshotDate) return [];

        // Aggregate WB stock + orders by nmId
        const stockRows = await db
          .select({
            nmId: rawApiStockSizes.nmId,
            wbStock: sql<number>`SUM(${rawApiStockSizes.stockCount})::int`,
            ordersCount: sql<number>`SUM(COALESCE(${rawApiStockSizes.ordersCount}, 0))::float`,
          })
          .from(rawApiStockSizes)
          .where(
            and(
              eq(rawApiStockSizes.tenantId, tenant.id),
              eq(rawApiStockSizes.stockType, "wb"),
              eq(rawApiStockSizes.snapshotDate, snapshotDate)
            )
          )
          .groupBy(rawApiStockSizes.nmId);

        if (stockRows.length === 0) return [];

        // Fallback orders from orders table
        const orderRows = await db
          .select({
            nmId: rawApiOrders.nmId,
            ordersCount: sql<number>`COUNT(*)::int`,
          })
          .from(rawApiOrders)
          .where(
            and(
              eq(rawApiOrders.tenantId, tenant.id),
              eq(rawApiOrders.isCancel, false),
              gte(rawApiOrders.date, from),
              lt(rawApiOrders.date, toExclusive)
            )
          )
          .groupBy(rawApiOrders.nmId);

        const fallbackMap = new Map<number, number>();
        for (const row of orderRows) {
          fallbackMap.set(row.nmId, Number(row.ordersCount) || 0);
        }

        const nmIds = stockRows.map((r) => r.nmId);

        // After P87 the legacy stock_planning_inputs table is gone. Pull
        // own-warehouse from ownStockBatches and in-transit/production from
        // production_order_lines+orders by status bucket.
        const [ownRows, inFlightRows, productRows] = await Promise.all([
          db
            .select({
              nmId: ownStockBatches.nmId,
              total: sql<number>`COALESCE(SUM(${ownStockBatches.remainingQuantity}), 0)::int`,
            })
            .from(ownStockBatches)
            .where(
              and(
                eq(ownStockBatches.tenantId, tenant.id),
                sql`${ownStockBatches.remainingQuantity} > 0`,
                sql`${ownStockBatches.nmId} = ANY(${nmIds})`,
              ),
            )
            .groupBy(ownStockBatches.nmId),
          db
            .select({
              nmId: productionOrderLines.nmId,
              status: productionOrders.status,
              pending: sql<number>`COALESCE(SUM(${productionOrderLines.quantity} - ${productionOrderLines.receivedQuantity}), 0)::int`,
            })
            .from(productionOrderLines)
            .innerJoin(productionOrders, eq(productionOrders.id, productionOrderLines.productionOrderId))
            .where(
              and(
                eq(productionOrders.tenantId, tenant.id),
                sql`${productionOrders.status} IN ('ordered','in_production','shipped','customs')`,
                sql`${productionOrderLines.nmId} = ANY(${nmIds})`,
              ),
            )
            .groupBy(productionOrderLines.nmId, productionOrders.status),
          db
            .select({
              nmId: products.nmId,
              vendorCode: products.vendorCode,
              brand: products.brand,
            })
            .from(products)
            .where(
              and(
                eq(products.tenantId, tenant.id),
                sql`${products.nmId} = ANY(${nmIds})`
              )
            ),
        ]);

        const inputMap = new Map<number, { ownStock: number; inTransitChina: number; inProductionQty: number }>();
        for (const row of ownRows) {
          const nm = Number(row.nmId);
          const entry = inputMap.get(nm) ?? { ownStock: 0, inTransitChina: 0, inProductionQty: 0 };
          entry.ownStock = Number(row.total) || 0;
          inputMap.set(nm, entry);
        }
        for (const row of inFlightRows) {
          const nm = Number(row.nmId);
          const entry = inputMap.get(nm) ?? { ownStock: 0, inTransitChina: 0, inProductionQty: 0 };
          const pending = Number(row.pending) || 0;
          if (row.status === 'ordered' || row.status === 'in_production') {
            entry.inProductionQty += pending;
          } else if (row.status === 'shipped' || row.status === 'customs') {
            entry.inTransitChina += pending;
          }
          inputMap.set(nm, entry);
        }

        const productMap = new Map(
          productRows.map((r) => [
            r.nmId,
            { vendorCode: r.vendorCode, brand: r.brand },
          ])
        );

        const alertItems: StockAlertItem[] = [];

        for (const row of stockRows) {
          const wbStock = Number(row.wbStock) || 0;
          const ordersFromStock = Number(row.ordersCount) || 0;
          const ordersFromFallback = fallbackMap.get(row.nmId) ?? 0;
          const dailyDemand =
            ordersFromStock > 0
              ? ordersFromStock / dateWindowDays
              : ordersFromFallback > 0
                ? ordersFromFallback / dateWindowDays
                : 0;

          if (dailyDemand <= 0) continue; // Skip items with no demand

          const coverageDays =
            dailyDemand > 0 ? wbStock / dailyDemand : null;
          const input = inputMap.get(row.nmId) ?? {
            ownStock: 0,
            inTransitChina: 0,
            inProductionQty: 0,
          };
          const product = productMap.get(row.nmId);
          const totalAvailable =
            wbStock + input.ownStock + input.inTransitChina + input.inProductionQty;
          const totalCoverageDays =
            dailyDemand > 0 ? totalAvailable / dailyDemand : null;

          const base: Omit<StockAlertItem, "alertType"> = {
            nmId: row.nmId,
            vendorCode: product?.vendorCode ?? null,
            brand: product?.brand ?? null,
            wbStock,
            dailyDemand: Math.round(dailyDemand * 10) / 10,
            coverageDays,
            ownStock: input.ownStock,
            inTransitChina: input.inTransitChina,
            inProductionQty: input.inProductionQty,
          };

          if (wbStock === 0) {
            alertItems.push({ ...base, alertType: "out_of_stock" });
          } else if (
            coverageDays !== null &&
            coverageDays <= DEFAULT_ALERT_THRESHOLD_DAYS
          ) {
            alertItems.push({ ...base, alertType: "low_stock" });
          }

          // Check if total coverage is less than lead time
          if (
            totalCoverageDays !== null &&
            totalCoverageDays < DEFAULT_LEAD_TIME_DAYS
          ) {
            alertItems.push({ ...base, alertType: "order_china" });
          }
        }

        return alertItems;
      });

      if (alerts.length === 0) {
        results.push({ tenantId: tenant.id, alerts: 0, sent: false });
        continue;
      }

      const sent = await step.run(`send-alert-${tenant.id}`, async () => {
        const message = formatAlertMessage(alerts, tenant.name);
        try {
          await bot!.api.sendMessage(tenant.telegramChatId!, message, {
            parse_mode: "HTML",
          });
          return true;
        } catch (error) {
          logger.error({ err: error, tenantId: tenant.id }, '[stock-alerts] Failed to send to tenant');
          return false;
        }
      });

      results.push({ tenantId: tenant.id, alerts: alerts.length, sent });
    }

    return { tenants: results.length, results };
  }
);
