import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { sql, eq } from 'drizzle-orm';

type Options = {
  from: string;
  to: string;
  tenantId?: string;
};

function loadEnv() {
  const cwd = process.cwd();
  const candidates = ['.env.runtime', '.env.production', '.env'];
  for (const rel of candidates) {
    const full = path.join(cwd, rel);
    if (fs.existsSync(full)) {
      dotenv.config({ path: full, override: false });
    }
  }
}

function parseArgs(argv: string[]): Options {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      continue;
    }
    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }
    args.set(key, value);
    i += 1;
  }

  const from = args.get('from');
  const to = args.get('to');
  if (!from || !to) {
    throw new Error('Usage: npx tsx scripts/backfill_realization_reports.ts --from YYYY-MM-DD --to YYYY-MM-DD [--tenant-id UUID]');
  }

  const tenantId = args.get('tenant-id') || undefined;
  return { from, to, tenantId };
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  if (chunkSize <= 0) return [items];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function toOptionalText(value: unknown): string | null {
  const text = toText(value).trim();
  return text.length > 0 ? text : null;
}

function toOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = toNumber(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toOptionalBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'да'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', 'нет'].includes(normalized)) return false;
  }
  return null;
}

async function main() {
  loadEnv();
  const { from, to, tenantId } = parseArgs(process.argv.slice(2));

  const [{ db, withAdminContext, withTenantContext }, schema, encryption, wb] = await Promise.all([
    import('@/lib/db'),
    import('@/lib/db/schema'),
    import('@/lib/encryption'),
    import('@/lib/wb-api'),
  ]);
  const { tenants, rawApiRealizationReports } = schema;

  const tenantRows = tenantId
    ? await withAdminContext(db, async (tx) => tx.select().from(tenants).where(eq(tenants.id, tenantId)))
    : await withAdminContext(db, async (tx) => tx.select().from(tenants));

  if (tenantRows.length === 0) {
    throw new Error('No tenants found for backfill');
  }

  console.log(`[backfill] range=${from}..${to} tenants=${tenantRows.length}`);

  for (const tenant of tenantRows) {
    const token = encryption.decryptIfNeeded(tenant.wbApiToken);
    if (!token || token.trim().length < 20) {
      console.warn(`[backfill] skip tenant=${tenant.id} reason=invalid_token`);
      continue;
    }

    console.log(`[backfill] tenant=${tenant.id} name="${tenant.name}" fetch_start`);
    const reports = await wb.wbApi.getAllRealizationReports(token, from, to);

    if (reports.length === 0) {
      console.log(`[backfill] tenant=${tenant.id} fetched=0`);
      continue;
    }

    let batches = 0;
    for (const batch of chunkArray(reports, 200)) {
      batches += 1;
      const inserts = batch.map((item) => {
        const commission = toNumber(item.commission_amount) !== 0
          ? toNumber(item.commission_amount)
          : toNumber(item.ppvz_sales_commission);
        const storageFee = toNumber(item.storage_fee_rub) !== 0
          ? toNumber(item.storage_fee_rub)
          : toNumber(item.storage_fee);
        const penalty = toNumber(item.penalty_rub) !== 0
          ? toNumber(item.penalty_rub)
          : toNumber(item.penalty);
        const paymentSchedule = toNumber(item.payment_schedule_rub) !== 0
          ? toNumber(item.payment_schedule_rub)
          : toNumber(item.payment_schedule);
        const additionalPayment =
          toNumber(item.additional_payment) + toNumber(item.rebill_logistic_cost);

        return {
          rrdId: item.rrd_id,
          tenantId: tenant.id,
          realizationreportId: item.realizationreport_id,
          dateFrom: new Date(item.date_from),
          dateTo: new Date(item.date_to),
          saleDt: new Date(item.sale_dt ?? item.date_from),
          srid: toText(item.srid),
          docTypeName: toText(item.doc_type_name),
          supplierOperName: toText(item.supplier_oper_name),
          bonusTypeName: toText(item.bonus_type_name),
          rebillLogisticOrg: toText(item.rebill_logistic_org),
          officeName: toOptionalText(item.office_name),
          nmId: item.nm_id,
          quantity: item.quantity,
          retailAmount: toNumber(item.retail_amount).toString(),
          commissionAmount: commission.toString(),
          deliveryRub: toNumber(item.delivery_rub).toString(),
          boxDeliveryBase: toNumber(item.box_delivery_base).toString(),
          boxDeliveryLiter: toNumber(item.box_delivery_liter).toString(),
          boxStorageBase: toNumber(item.box_storage_base).toString(),
          boxStorageLiter: toNumber(item.box_storage_liter).toString(),
          storageFeeRub: storageFee.toString(),
          penaltyRub: penalty.toString(),
          sppRub: toNumber(item.spp_rub).toString(),
          paymentScheduleRub: paymentSchedule.toString(),
          ppvzForPay: toNumber(item.ppvz_for_pay).toString(),
          deduction: toNumber(item.deduction).toString(),
          additionalPayment: additionalPayment.toString(),
          acquiringFee: toNumber(item.acquiring_fee).toString(),
          returnAmount: toNumber(item.return_amount).toString(),
          retailPriceWithdiscRub: toNumber(item.retail_price_withdisc_rub).toString(),
          acceptance: toNumber(item.acceptance).toString(),
          cashbackAmount: toNumber(item.cashback_amount).toString(),
          ppvzSppPrc: toNumber(item.ppvz_spp_prc).toString(),
          ppvzKvwPrcBase: toNumber(item.ppvz_kvw_prc_base).toString(),
          ppvzKvwPrc: toNumber(item.ppvz_kvw_prc).toString(),
          fixationStartDate: item.fixation_start_date ?? null,
          fixationEndDate: item.fixation_end_date ?? null,
          isPaidDeliveryService: toOptionalBoolean(item.is_paid_delivery_service),
          fixedWarehouseCoefficient: toOptionalNumber(item.fixed_warehouse_coefficient)?.toString() ?? null,
        };
      });

      await withTenantContext(db, tenant.id, async (tx) => {
        await tx.insert(rawApiRealizationReports)
          .values(inserts)
          .onConflictDoUpdate({
            target: [rawApiRealizationReports.tenantId, rawApiRealizationReports.rrdId],
            set: {
              realizationreportId: sql`EXCLUDED.realizationreport_id`,
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
              boxDeliveryBase: sql`EXCLUDED.box_delivery_base`,
              boxDeliveryLiter: sql`EXCLUDED.box_delivery_liter`,
              boxStorageBase: sql`EXCLUDED.box_storage_base`,
              boxStorageLiter: sql`EXCLUDED.box_storage_liter`,
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
    }

    console.log(`[backfill] tenant=${tenant.id} fetched=${reports.length} batches=${batches} done`);
  }

  console.log('[backfill] finished');
}

main().catch((error) => {
  console.error('[backfill] failed', error);
  process.exit(1);
});
