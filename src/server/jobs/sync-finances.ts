import { inngest } from "@/inngest/client";
import { handleInngestFailure } from "@/inngest/on-failure";
import { db, withTenantContext } from "@/lib/db";
import { tenants, rawApiRealizationReports } from "@/lib/db/schema";
import { wbApi } from "@/lib/wb-api";
import { format, subDays } from "date-fns";
import { sql } from "drizzle-orm";
import { decryptIfNeeded } from "@/lib/encryption";
import { logger } from "@/lib/logger";

export const syncFinancesJob = inngest.createFunction(
  { id: "sync-wb-finances", name: "Sync WB Finances Daily", concurrency: { limit: 1 }, onFailure: handleInngestFailure, triggers: [{ cron: "0 2 * * *" }] },
  async ({ step }) => {
    // Получаем список организаций
    const activeTenants = await step.run("fetch-active-tenants", async () => {
      // В production добавить фильтр: where wbApiToken is not null
      return await db.select().from(tenants);
    });

    for (const tenant of activeTenants) {
      if (!tenant.wbApiToken) continue;

      await step.run(`sync-tenant-${tenant.id}-finances`, async () => {
        try {
          const plainToken = decryptIfNeeded(tenant.wbApiToken);
          const dateFrom = format(subDays(new Date(), 7), "yyyy-MM-dd");
          const dateTo = format(new Date(), "yyyy-MM-dd");
          const reports = await wbApi.getAllRealizationReports(
            plainToken,
            dateFrom,
            dateTo
          );

          if (!reports || reports.length === 0) {
            return { records: 0 };
          }

          const toNumber = (value: unknown) => {
            if (typeof value === "number") return Number.isFinite(value) ? value : 0;
            if (typeof value === "string") {
              const parsed = Number(value);
              return Number.isFinite(parsed) ? parsed : 0;
            }
            return 0;
          };
          const toText = (value: unknown) => typeof value === "string" ? value : "";
          const toOptionalText = (value: unknown) => {
            const text = toText(value).trim();
            return text.length > 0 ? text : null;
          };
          const toOptionalNumber = (value: unknown) => {
            if (value === null || value === undefined || value === "") return null;
            const parsed = toNumber(value);
            return Number.isFinite(parsed) ? parsed : null;
          };
          const toOptionalBoolean = (value: unknown) => {
            if (typeof value === "boolean") return value;
            if (typeof value === "number" && Number.isFinite(value)) return value !== 0;
            if (typeof value === "string") {
              const normalized = value.trim().toLowerCase();
              if (["true", "1", "yes", "y", "да"].includes(normalized)) return true;
              if (["false", "0", "no", "n", "нет"].includes(normalized)) return false;
            }
            return null;
          };

          const inserts = reports.map(r => {
            const commissionRaw = toNumber(r.commission_amount);
            const commissionAlias = toNumber((r as unknown as Record<string, unknown>).ppvz_sales_commission);
            const commission = commissionRaw !== 0 ? commissionRaw : commissionAlias;

            const storageFeeRaw = toNumber(r.storage_fee_rub);
            const storageFeeAlias = toNumber((r as unknown as Record<string, unknown>).storage_fee);
            const storageFee = storageFeeRaw !== 0 ? storageFeeRaw : storageFeeAlias;

            const penaltyRaw = toNumber(r.penalty_rub);
            const penaltyAlias = toNumber((r as unknown as Record<string, unknown>).penalty);
            const penalty = penaltyRaw !== 0 ? penaltyRaw : penaltyAlias;

            const paymentScheduleRaw = toNumber(r.payment_schedule_rub);
            const paymentScheduleAlias = toNumber((r as unknown as Record<string, unknown>).payment_schedule);
            const paymentSchedule = paymentScheduleRaw !== 0 ? paymentScheduleRaw : paymentScheduleAlias;
            const additionalPayment =
              toNumber(r.additional_payment)
              + toNumber((r as unknown as Record<string, unknown>).rebill_logistic_cost);

            return {
              rrdId: r.rrd_id,
              tenantId: tenant.id,
              realizationreportId: r.realizationreport_id,
              dateFrom: new Date(r.date_from),
              dateTo: new Date(r.date_to),
              saleDt: new Date(r.sale_dt ?? r.date_from),
              srid: toText(r.srid),
              docTypeName: toText(r.doc_type_name),
              supplierOperName: toText(r.supplier_oper_name),
              bonusTypeName: toText(r.bonus_type_name),
              rebillLogisticOrg: toText(r.rebill_logistic_org),
              officeName: toOptionalText(r.office_name),
              nmId: r.nm_id,
              quantity: r.quantity,
              retailAmount: toNumber(r.retail_amount).toString(),
              commissionAmount: commission.toString(),
              deliveryRub: toNumber(r.delivery_rub).toString(),
              storageFeeRub: storageFee.toString(),
              penaltyRub: penalty.toString(),
              sppRub: toNumber(r.spp_rub).toString(),
              paymentScheduleRub: paymentSchedule.toString(),
              ppvzForPay: toNumber(r.ppvz_for_pay).toString(),
              deduction: toNumber(r.deduction).toString(),
              additionalPayment: additionalPayment.toString(),
              acquiringFee: toNumber(r.acquiring_fee).toString(),
              returnAmount: toNumber(r.return_amount).toString(),
              retailPriceWithdiscRub: toNumber(r.retail_price_withdisc_rub).toString(),
              acceptance: toNumber(r.acceptance).toString(),
              cashbackAmount: toNumber(r.cashback_amount).toString(),
              ppvzSppPrc: toNumber(r.ppvz_spp_prc).toString(),
              ppvzKvwPrcBase: toNumber(r.ppvz_kvw_prc_base).toString(),
              ppvzKvwPrc: toNumber(r.ppvz_kvw_prc).toString(),
              fixationStartDate: r.fixation_start_date ?? null,
              fixationEndDate: r.fixation_end_date ?? null,
              isPaidDeliveryService: toOptionalBoolean(r.is_paid_delivery_service),
              fixedWarehouseCoefficient: toOptionalNumber(r.fixed_warehouse_coefficient)?.toString() ?? null,
            };
          });

          await withTenantContext(db, tenant.id, async (tx) => {
            await tx.insert(rawApiRealizationReports)
              .values(inserts)
              .onConflictDoUpdate({
                target: [rawApiRealizationReports.tenantId, rawApiRealizationReports.rrdId],
                set: {
                  dateFrom: sql`EXCLUDED.date_from`,
                  dateTo: sql`EXCLUDED.date_to`,
                  saleDt: sql`EXCLUDED.sale_dt`,
                  srid: sql`EXCLUDED.srid`,
                  docTypeName: sql`EXCLUDED.doc_type_name`,
                  supplierOperName: sql`EXCLUDED.supplier_oper_name`,
                  bonusTypeName: sql`EXCLUDED.bonus_type_name`,
                  rebillLogisticOrg: sql`EXCLUDED.rebill_logistic_org`,
                  officeName: sql`EXCLUDED.office_name`,
                  nmId: sql`EXCLUDED.nm_id`,
                  quantity: sql`EXCLUDED.quantity`,
                  retailAmount: sql`EXCLUDED.retail_amount`,
                  commissionAmount: sql`EXCLUDED.commission_amount`,
                  deliveryRub: sql`EXCLUDED.delivery_rub`,
                  storageFeeRub: sql`EXCLUDED.storage_fee_rub`,
                  penaltyRub: sql`EXCLUDED.penalty_rub`,
                  sppRub: sql`EXCLUDED.spp_rub`,
                  paymentScheduleRub: sql`EXCLUDED.payment_schedule_rub`,
                  ppvzForPay: sql`EXCLUDED.ppvz_for_pay`,
                  deduction: sql`EXCLUDED.deduction`,
                  additionalPayment: sql`EXCLUDED.additional_payment`,
                  acquiringFee: sql`EXCLUDED.acquiring_fee`,
                  returnAmount: sql`EXCLUDED.return_amount`,
                  retailPriceWithdiscRub: sql`EXCLUDED.retail_price_withdisc_rub`,
                  acceptance: sql`EXCLUDED.acceptance`,
                  cashbackAmount: sql`EXCLUDED.cashback_amount`,
                  ppvzSppPrc: sql`EXCLUDED.ppvz_spp_prc`,
                  ppvzKvwPrcBase: sql`EXCLUDED.ppvz_kvw_prc_base`,
                  ppvzKvwPrc: sql`EXCLUDED.ppvz_kvw_prc`,
                  fixationStartDate: sql`EXCLUDED.fixation_start_date`,
                  fixationEndDate: sql`EXCLUDED.fixation_end_date`,
                  isPaidDeliveryService: sql`EXCLUDED.is_paid_delivery_service`,
                  fixedWarehouseCoefficient: sql`EXCLUDED.fixed_warehouse_coefficient`,
                },
              });
          });

          return { records: reports.length };
        } catch (error) {
          logger.error({ err: error, tenantId: tenant.id }, "[sync-finances] tenant sync failed");
          throw error;
        }
      });
    }
  }
);
