import { inngest } from "@/inngest/client";
import { handleInngestFailure } from "@/inngest/on-failure";
import { db, withTenantContext } from "@/lib/db";
import { tenants, rawApiOrders } from "@/lib/db/schema";
import { wbApi } from "@/lib/wb-api";
import { format, subDays } from "date-fns";
import { ne, sql } from "drizzle-orm";
import { decryptIfNeeded } from "@/lib/encryption";
import { logger } from "@/lib/logger";

function optionalText(value: string | null | undefined) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
}

function optionalNumber(value: number | null | undefined) {
  return Number.isFinite(value) ? String(value) : null;
}

export const syncOrdersJob = inngest.createFunction(
  { id: "sync-wb-orders", name: "Sync WB Orders Weekly", concurrency: { limit: 1 }, onFailure: handleInngestFailure, triggers: [{ cron: "*/30 * * * *" }] },
  async ({ step }) => {
    const activeTenants = await step.run("fetch-active-tenants", async () => {
      return await db
        .select({ id: tenants.id, wbApiToken: tenants.wbApiToken })
        .from(tenants)
        .where(ne(tenants.wbTokenHealthStatus, "invalid"));
    });

    for (const tenant of activeTenants) {
      if (!tenant.wbApiToken) continue;

      await step.run(`sync-tenant-${tenant.id}-orders`, async () => {
        try {
          const plainToken = decryptIfNeeded(tenant.wbApiToken);
          const dateFrom = format(subDays(new Date(), 14), "yyyy-MM-dd");
          const dateTo = format(new Date(), "yyyy-MM-dd");
          const orders = await wbApi.getOrders(plainToken, dateFrom, dateTo);

          if (!orders || orders.length === 0) {
            return { records: 0 };
          }

          const chunkSize = 2000;
          await withTenantContext(db, tenant.id, async (tx) => {
            for (let i = 0; i < orders.length; i += chunkSize) {
              const chunk = orders.slice(i, i + chunkSize);

              const inserts = chunk.map(o => ({
                srid: o.srid,
                tenantId: tenant.id,
                nmId: o.nmId,
                date: new Date(o.date),
                totalPrice: o.totalPrice.toString(),
                isCancel: o.isCancel,
                warehouseName: optionalText(o.warehouseName),
                warehouseType: optionalText(o.warehouseType),
                countryName: optionalText(o.countryName),
                oblastOkrugName: optionalText(o.oblastOkrugName),
                regionName: optionalText(o.regionName),
                supplierArticle: optionalText(o.supplierArticle),
                barcode: optionalText(o.barcode),
                category: optionalText(o.category),
                subject: optionalText(o.subject),
                brand: optionalText(o.brand),
                techSize: optionalText(o.techSize),
                incomeId: typeof o.incomeID === "number" && Number.isFinite(o.incomeID) ? o.incomeID : null,
                spp: optionalNumber(o.spp),
                finishedPrice: optionalNumber(o.finishedPrice),
                priceWithDisc: optionalNumber(o.priceWithDisc),
              }));

              await tx.insert(rawApiOrders)
                .values(inserts)
                .onConflictDoUpdate({
                  target: [rawApiOrders.tenantId, rawApiOrders.srid],
                  set: {
                    isCancel: sql`EXCLUDED.is_cancel`,
                    totalPrice: sql`EXCLUDED.total_price`,
                    warehouseName: sql`EXCLUDED.warehouse_name`,
                    warehouseType: sql`EXCLUDED.warehouse_type`,
                    countryName: sql`EXCLUDED.country_name`,
                    oblastOkrugName: sql`EXCLUDED.oblast_okrug_name`,
                    regionName: sql`EXCLUDED.region_name`,
                    supplierArticle: sql`EXCLUDED.supplier_article`,
                    barcode: sql`EXCLUDED.barcode`,
                    category: sql`EXCLUDED.category`,
                    subject: sql`EXCLUDED.subject`,
                    brand: sql`EXCLUDED.brand`,
                    techSize: sql`EXCLUDED.tech_size`,
                    incomeId: sql`EXCLUDED.income_id`,
                    spp: sql`EXCLUDED.spp`,
                    finishedPrice: sql`EXCLUDED.finished_price`,
                    priceWithDisc: sql`EXCLUDED.price_with_disc`,
                  },
                });
            }
          });

          return { records: orders.length };
        } catch (error) {
          logger.error({ err: error, tenantId: tenant.id }, "[sync-orders] tenant sync failed");
          throw error;
        }
      });
    }
  }
);
