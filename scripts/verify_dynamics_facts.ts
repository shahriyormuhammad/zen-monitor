import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { sql } from 'drizzle-orm';
import { calculateTax } from '@/lib/tax/regimes';

type CliOptions = {
  from: string;
  to: string;
  tenantId?: string;
  groupId?: string;
  outputJson?: string;
  outputMd?: string;
  failOnMismatch: boolean;
};

type GroupTarget = {
  tenantId: string;
  tenantName: string;
  groupId: string;
  groupName: string;
};

type BaseDayRow = {
  financeRevenue: number;
  financeSoldQty: number;
  opProfit: number;
  costTotal: number;
  orderQty: number | null;
  orderRevenue: number | null;
  rawBuyoutQty: number;
  rawBuyoutRevenue: number;
  funnelViewQty: number | null;
  funnelAddToCartQty: number | null;
  funnelOrderQty: number | null;
  funnelOrderRevenue: number | null;
  funnelCancelQty: number | null;
  funnelBuyoutQty: number | null;
  funnelBuyoutRevenue: number | null;
  funnelAvgPrice: number | null;
  funnelAddToCartPercent: number | null;
  funnelCartToOrderPercent: number | null;
  funnelOrderToBuyoutPercent: number | null;
  adSpend: number;
  storageCost: number;
};

type DynamicsSeries = Record<string, Record<string, number | null>>;

type DynamicsResult = {
  days: string[];
  group: DynamicsSeries;
  skus: Record<number, DynamicsSeries>;
};

type Mismatch = {
  tenantId: string;
  tenantName: string;
  groupId: string;
  groupName: string;
  scope: 'group' | 'sku';
  nmId: number | null;
  day: string;
  metric: string;
  actual: number | null;
  expected: number | null;
  delta: number | null;
};

type CompareSummary = {
  valuesCompared: number;
  mismatches: Mismatch[];
  skuCountExpected: number;
  skuCountActual: number;
  dayCountExpected: number;
  dayCountActual: number;
};

type GroupRunSummary = {
  target: GroupTarget;
  comparedValues: number;
  mismatchCount: number;
  expectedSkuCount: number;
  actualSkuCount: number;
  expectedDayCount: number;
  actualDayCount: number;
};

type FullRunReport = {
  checkedAt: string;
  period: { from: string; to: string };
  filters: { tenantId?: string; groupId?: string };
  groupsChecked: number;
  totalComparedValues: number;
  totalMismatches: number;
  groupSummaries: GroupRunSummary[];
  mismatches: Mismatch[];
};

type DbExecutor = {
  execute: (query: unknown) => Promise<unknown>;
};

const METRICS_TO_COMPARE = [
  'revenue',
  'soldQty',
  'financeRevenue',
  'financeSoldQty',
  'opProfit',
  'costTotal',
  'orderQty',
  'orderRevenue',
  'funnelViewQty',
  'funnelAddToCartQty',
  'funnelOrderQty',
  'funnelOrderRevenue',
  'funnelCancelQty',
  'funnelBuyoutQty',
  'funnelBuyoutRevenue',
  'funnelAvgPrice',
  'funnelAddToCartPercent',
  'funnelCartToOrderPercent',
  'funnelOrderToBuyoutPercent',
  'adSpend',
  'storageCost',
  'netProfit',
  'netProfitBeforeAds',
  'drr',
  'buyoutPercent',
  'avgOrderPrice',
  'avgBuyoutPrice',
  'profitPerUnit',
] as const;

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

function parseArgs(argv: string[]): CliOptions {
  const args = new Map<string, string>();
  const flags = new Set<string>();

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      continue;
    }

    const key = token.slice(2);
    const next = argv[i + 1];

    if (!next || next.startsWith('--')) {
      flags.add(key);
      continue;
    }

    args.set(key, next);
    i += 1;
  }

  const from = args.get('from');
  const to = args.get('to');
  if (!from || !to) {
    throw new Error(
      'Usage: npx tsx scripts/verify_dynamics_facts.ts --from YYYY-MM-DD --to YYYY-MM-DD [--tenant-id UUID] [--group-id UUID] [--output-json path] [--output-md path] [--allow-mismatch]',
    );
  }

  return {
    from,
    to,
    tenantId: args.get('tenant-id') || undefined,
    groupId: args.get('group-id') || undefined,
    outputJson: args.get('output-json') || undefined,
    outputMd: args.get('output-md') || undefined,
    failOnMismatch: !flags.has('allow-mismatch'),
  };
}

function parseDateOnly(input: string): Date {
  const date = new Date(`${input}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${input}`);
  }
  return date;
}

function toDayIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dayLabelFromIso(dayIso: string): string {
  const [yyyy, mm, dd] = dayIso.split('-');
  return `${dd}.${mm}.${yyyy}`;
}

function buildDayRange(from: string, to: string): string[] {
  const start = parseDateOnly(from);
  const end = parseDateOnly(to);
  if (start.getTime() > end.getTime()) {
    throw new Error(`Invalid range: from (${from}) is after to (${to})`);
  }

  const days: string[] = [];
  const cursor = new Date(start);
  while (cursor.getTime() <= end.getTime()) {
    days.push(toDayIso(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
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

function roundInt(value: number): number {
  return Math.round(value);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function createEmptyBaseRow(): BaseDayRow {
  return {
    financeRevenue: 0,
    financeSoldQty: 0,
    opProfit: 0,
    costTotal: 0,
    orderQty: null,
    orderRevenue: null,
    rawBuyoutQty: 0,
    rawBuyoutRevenue: 0,
    funnelViewQty: null,
    funnelAddToCartQty: null,
    funnelOrderQty: null,
    funnelOrderRevenue: null,
    funnelCancelQty: null,
    funnelBuyoutQty: null,
    funnelBuyoutRevenue: null,
    funnelAvgPrice: null,
    funnelAddToCartPercent: null,
    funnelCartToOrderPercent: null,
    funnelOrderToBuyoutPercent: null,
    adSpend: 0,
    storageCost: 0,
  };
}

function dayKey(nmId: number, dayIso: string): string {
  return `${nmId}|${dayIso}`;
}

function dateDiffInclusive(fromIso: string, toIso: string): number {
  const from = parseDateOnly(fromIso).getTime();
  const to = parseDateOnly(toIso).getTime();
  return Math.floor((to - from) / 86_400_000) + 1;
}

function clampIsoRange(rowFrom: string, rowTo: string, periodFrom: string, periodTo: string) {
  const start = rowFrom > periodFrom ? rowFrom : periodFrom;
  const end = rowTo < periodTo ? rowTo : periodTo;
  if (start > end) {
    return null;
  }
  return { start, end };
}

function normalizeComparable(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Object.is(numeric, -0) ? 0 : numeric;
}

function areComparableEqual(actual: number | null, expected: number | null): boolean {
  if (actual === null && expected === null) {
    return true;
  }
  if (actual === null || expected === null) {
    return false;
  }
  return Math.abs(actual - expected) <= 1e-9;
}

function ensureDir(filePath: string) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

function buildMarkdownReport(report: FullRunReport): string {
  const lines: string[] = [];
  lines.push(`# Dynamics factual control check (${report.period.from}..${report.period.to})`);
  lines.push('');
  lines.push(`- Checked at: ${report.checkedAt}`);
  lines.push(`- Groups checked: ${report.groupsChecked}`);
  lines.push(`- Compared values: ${report.totalComparedValues}`);
  lines.push(`- Mismatches: ${report.totalMismatches}`);
  lines.push('');

  lines.push('## Group summary');
  lines.push('');
  lines.push('| Tenant | Group | Compared | Mismatches | Day count (exp/act) | SKU count (exp/act) |');
  lines.push('|---|---|---:|---:|---:|---:|');
  for (const item of report.groupSummaries) {
    lines.push(`| ${item.target.tenantName} | ${item.target.groupName} | ${item.comparedValues} | ${item.mismatchCount} | ${item.expectedDayCount}/${item.actualDayCount} | ${item.expectedSkuCount}/${item.actualSkuCount} |`);
  }
  lines.push('');

  lines.push('## Mismatches (actual vs expected)');
  lines.push('');
  if (report.mismatches.length === 0) {
    lines.push('No mismatches detected.');
    lines.push('');
  } else {
    lines.push('| Tenant | Group | Scope | NM | Day | Metric | Actual | Expected | Delta |');
    lines.push('|---|---|---|---:|---|---|---:|---:|---:|');
    for (const row of report.mismatches.slice(0, 500)) {
      lines.push(`| ${row.tenantName} | ${row.groupName} | ${row.scope} | ${row.nmId ?? 0} | ${row.day} | ${row.metric} | ${row.actual ?? 'null'} | ${row.expected ?? 'null'} | ${row.delta ?? 'null'} |`);
    }
    if (report.mismatches.length > 500) {
      lines.push('');
      lines.push(`... and ${report.mismatches.length - 500} more rows (see JSON report).`);
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

function resolveCostAt(
  costByNm: Map<number, Array<{ effectiveFromMs: number; costPrice: number }>>,
  nmId: number,
  atMs: number,
): number {
  const points = costByNm.get(nmId);
  if (!points || points.length === 0) {
    return 0;
  }

  let left = 0;
  let right = points.length - 1;
  let result = -1;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    if (points[mid].effectiveFromMs <= atMs) {
      result = mid;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  return result >= 0 ? points[result].costPrice : 0;
}

async function computeExpectedDynamics(args: {
  db: DbExecutor;
  tenantId: string;
  nmIds: number[];
  from: string;
  to: string;
}): Promise<DynamicsResult> {
  const { db, tenantId, nmIds, from, to } = args;
  const dayRangeIso = buildDayRange(from, to);
  const dayLabels = dayRangeIso.map(dayLabelFromIso);

  const baseMap = new Map<string, BaseDayRow>();
  for (const nmId of nmIds) {
    for (const dayIso of dayRangeIso) {
      baseMap.set(dayKey(nmId, dayIso), createEmptyBaseRow());
    }
  }

  if (nmIds.length === 0) {
    return { days: dayLabels, group: {}, skus: {} };
  }

  const nmIdList = sql.join(nmIds.map((nmId) => sql`${nmId}`), sql`, `);

  const [tenantTaxRow] = (await db.execute(sql`
    SELECT tax_type as "taxType", tax_rate as "taxRate"
    FROM tenants
    WHERE id = ${tenantId}
    LIMIT 1
  `)) as Array<{ taxType: string | null; taxRate: string | number | null }>;

  const tenantTaxType = tenantTaxRow?.taxType ?? 'usn_income';
  const tenantTaxRate = toNumber(tenantTaxRow?.taxRate ?? 0);

  const costRows = (await db.execute(sql`
    SELECT
      nm_id as "nmId",
      cost_price as "costPrice",
      effective_from as "effectiveFrom"
    FROM unit_economics_configs
    WHERE tenant_id = ${tenantId}
      AND nm_id IN (${nmIdList})
    ORDER BY nm_id ASC, effective_from ASC
  `)) as Array<{ nmId: number; costPrice: string | number; effectiveFrom: string | Date }>;

  const costByNm = new Map<number, Array<{ effectiveFromMs: number; costPrice: number }>>();
  for (const row of costRows) {
    const list = costByNm.get(row.nmId) ?? [];
    list.push({
      effectiveFromMs: new Date(row.effectiveFrom).getTime(),
      costPrice: toNumber(row.costPrice),
    });
    costByNm.set(row.nmId, list);
  }

  const realizationRows = (await db.execute(sql`
    SELECT
      nm_id as "nmId",
      date_from::date as "dateFrom",
      date_to::date as "dateTo",
      quantity,
      retail_amount as "retailAmount",
      commission_amount as "commissionAmount",
      delivery_rub as "deliveryRub",
      storage_fee_rub as "storageFeeRub",
      penalty_rub as "penaltyRub",
      payment_schedule_rub as "paymentScheduleRub",
      ppvz_for_pay as "ppvzForPay"
    FROM raw_api_realization_reports
    WHERE tenant_id = ${tenantId}
      AND nm_id IN (${nmIdList})
      AND date_to::date >= ${from}::date
      AND date_from::date <= ${to}::date
  `)) as Array<{
    nmId: number;
    dateFrom: string;
    dateTo: string;
    quantity: number;
    retailAmount: string | number;
    commissionAmount: string | number;
    deliveryRub: string | number;
    storageFeeRub: string | number;
    penaltyRub: string | number;
    paymentScheduleRub: string | number;
    ppvzForPay: string | number;
  }>;

  for (const row of realizationRows) {
    const rowFrom = String(row.dateFrom);
    const rowTo = String(row.dateTo);
    const clipped = clampIsoRange(rowFrom, rowTo, from, to);
    if (!clipped) {
      continue;
    }

    const spanDays = Math.max(1, dateDiffInclusive(rowFrom, rowTo));
    const retailAmount = toNumber(row.retailAmount);
    const ppvzForPay = toNumber(row.ppvzForPay);
    const quantity = toNumber(row.quantity);
    const qtyForCalc = (retailAmount !== 0 || ppvzForPay !== 0) ? quantity : 0;
    const commissionAmount = toNumber(row.commissionAmount);
    const deliveryRub = toNumber(row.deliveryRub);
    const storageFeeRub = toNumber(row.storageFeeRub);
    const penaltyRub = toNumber(row.penaltyRub);
    const paymentScheduleRub = toNumber(row.paymentScheduleRub);

    const costPrice = resolveCostAt(costByNm, row.nmId, parseDateOnly(rowFrom).getTime());

    const cursor = parseDateOnly(clipped.start);
    const end = parseDateOnly(clipped.end);
    while (cursor.getTime() <= end.getTime()) {
      const dayIso = toDayIso(cursor);
      const key = dayKey(row.nmId, dayIso);
      const base = baseMap.get(key);
      if (base) {
        base.financeSoldQty += qtyForCalc / spanDays;
        base.financeRevenue += retailAmount / spanDays;
        base.opProfit += (retailAmount - commissionAmount - deliveryRub - storageFeeRub - penaltyRub - paymentScheduleRub) / spanDays;
        base.costTotal += (qtyForCalc * costPrice) / spanDays;
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }

  const ordersRows = (await db.execute(sql`
    SELECT
      date::date as "day",
      nm_id as "nmId",
      COUNT(*)::numeric as "orderQty",
      SUM(total_price)::numeric as "orderRevenue"
    FROM raw_api_orders
    WHERE tenant_id = ${tenantId}
      AND nm_id IN (${nmIdList})
      AND date::date >= ${from}::date
      AND date::date <= ${to}::date
      AND is_cancel = false
    GROUP BY 1, 2
  `)) as Array<{ day: string; nmId: number; orderQty: string | number; orderRevenue: string | number }>;

  for (const row of ordersRows) {
    const key = dayKey(row.nmId, String(row.day));
    const base = baseMap.get(key);
    if (!base) {
      continue;
    }
    base.orderQty = toNumber(row.orderQty);
    base.orderRevenue = toNumber(row.orderRevenue);
  }

  const rawSalesRows = (await db.execute(sql`
    SELECT
      date::date as "day",
      nm_id as "nmId",
      COUNT(*)::numeric as "rawBuyoutQty",
      SUM(price_with_discount)::numeric as "rawBuyoutRevenue"
    FROM raw_api_sales
    WHERE tenant_id = ${tenantId}
      AND nm_id IN (${nmIdList})
      AND date::date >= ${from}::date
      AND date::date <= ${to}::date
      AND is_storno = false
    GROUP BY 1, 2
  `)) as Array<{ day: string; nmId: number; rawBuyoutQty: string | number; rawBuyoutRevenue: string | number }>;

  for (const row of rawSalesRows) {
    const key = dayKey(row.nmId, String(row.day));
    const base = baseMap.get(key);
    if (!base) {
      continue;
    }
    base.rawBuyoutQty = toNumber(row.rawBuyoutQty);
    base.rawBuyoutRevenue = toNumber(row.rawBuyoutRevenue);
  }

  const funnelRows = (await db.execute(sql`
    SELECT
      period_start::date as "day",
      nm_id as "nmId",
      MAX(open_card_count)::numeric as "viewQty",
      MAX(add_to_cart_count)::numeric as "addToCartQty",
      MAX(order_count)::numeric as "orderQty",
      MAX(order_sum)::numeric as "orderRevenue",
      MAX(cancel_count)::numeric as "cancelQty",
      MAX(buyout_count)::numeric as "buyoutQty",
      MAX(buyout_sum)::numeric as "buyoutRevenue",
      MAX(avg_price)::numeric as "avgPrice",
      MAX(add_to_cart_percent)::numeric as "addToCartPercent",
      MAX(cart_to_order_percent)::numeric as "cartToOrderPercent",
      MAX(order_to_buyout_percent)::numeric as "orderToBuyoutPercent"
    FROM raw_api_funnel_stats
    WHERE tenant_id = ${tenantId}
      AND nm_id IN (${nmIdList})
      AND period_start::date = period_end::date
      AND period_start::date >= ${from}::date
      AND period_start::date <= ${to}::date
    GROUP BY 1, 2
  `)) as Array<{
    day: string;
    nmId: number;
    viewQty: string | number;
    addToCartQty: string | number;
    orderQty: string | number;
    orderRevenue: string | number;
    cancelQty: string | number;
    buyoutQty: string | number;
    buyoutRevenue: string | number;
    avgPrice: string | number;
    addToCartPercent: string | number;
    cartToOrderPercent: string | number;
    orderToBuyoutPercent: string | number;
  }>;

  for (const row of funnelRows) {
    const key = dayKey(row.nmId, String(row.day));
    const base = baseMap.get(key);
    if (!base) {
      continue;
    }
    base.funnelViewQty = toNumber(row.viewQty);
    base.funnelAddToCartQty = toNumber(row.addToCartQty);
    base.funnelOrderQty = toNumber(row.orderQty);
    base.funnelOrderRevenue = toNumber(row.orderRevenue);
    base.funnelCancelQty = toNumber(row.cancelQty);
    base.funnelBuyoutQty = toNumber(row.buyoutQty);
    base.funnelBuyoutRevenue = toNumber(row.buyoutRevenue);
    base.funnelAvgPrice = toNumber(row.avgPrice);
    base.funnelAddToCartPercent = toNumber(row.addToCartPercent);
    base.funnelCartToOrderPercent = toNumber(row.cartToOrderPercent);
    base.funnelOrderToBuyoutPercent = toNumber(row.orderToBuyoutPercent);
  }

  const adCostsRows = (await db.execute(sql`
    SELECT
      date::date as "day",
      nm_id as "nmId",
      SUM(amount)::numeric as "adSpend"
    FROM raw_api_ad_costs
    WHERE tenant_id = ${tenantId}
      AND nm_id IN (${nmIdList})
      AND date::date >= ${from}::date
      AND date::date <= ${to}::date
    GROUP BY 1, 2
  `)) as Array<{ day: string; nmId: number; adSpend: string | number }>;

  const adClustersRows = (await db.execute(sql`
    SELECT
      date::date as "day",
      nm_id as "nmId",
      SUM(amount)::numeric as "adSpend"
    FROM raw_api_ad_clusters
    WHERE tenant_id = ${tenantId}
      AND nm_id IN (${nmIdList})
      AND date::date >= ${from}::date
      AND date::date <= ${to}::date
    GROUP BY 1, 2
  `)) as Array<{ day: string; nmId: number; adSpend: string | number }>;

  const adCostsMap = new Map<string, number>();
  for (const row of adCostsRows) {
    adCostsMap.set(dayKey(row.nmId, String(row.day)), toNumber(row.adSpend));
  }

  const adClustersMap = new Map<string, number>();
  for (const row of adClustersRows) {
    adClustersMap.set(dayKey(row.nmId, String(row.day)), toNumber(row.adSpend));
  }

  for (const nmId of nmIds) {
    for (const dayIso of dayRangeIso) {
      const key = dayKey(nmId, dayIso);
      const base = baseMap.get(key);
      if (!base) {
        continue;
      }
      if (adCostsMap.has(key)) {
        base.adSpend = adCostsMap.get(key) ?? 0;
      } else if (adClustersMap.has(key)) {
        base.adSpend = adClustersMap.get(key) ?? 0;
      } else {
        base.adSpend = 0;
      }
    }
  }

  const storageRows = (await db.execute(sql`
    SELECT
      date::date as "day",
      nm_id as "nmId",
      SUM(storage_amount)::numeric as "storageCost"
    FROM raw_api_paid_storage
    WHERE tenant_id = ${tenantId}
      AND nm_id IN (${nmIdList})
      AND date::date >= ${from}::date
      AND date::date <= ${to}::date
    GROUP BY 1, 2
  `)) as Array<{ day: string; nmId: number; storageCost: string | number }>;

  for (const row of storageRows) {
    const key = dayKey(row.nmId, String(row.day));
    const base = baseMap.get(key);
    if (!base) {
      continue;
    }
    base.storageCost = toNumber(row.storageCost);
  }

  const groupDaily: DynamicsSeries = {};
  const skus: Record<number, DynamicsSeries> = {};

  for (const dayIso of dayRangeIso) {
    const dayLabel = dayLabelFromIso(dayIso);
    groupDaily[dayLabel] = {
      revenue: 0,
      soldQty: 0,
      financeRevenue: 0,
      financeSoldQty: 0,
      opProfit: 0,
      costTotal: 0,
      orderQty: null,
      orderRevenue: null,
      funnelViewQty: null,
      funnelAddToCartQty: null,
      funnelOrderQty: null,
      funnelOrderRevenue: null,
      funnelCancelQty: null,
      funnelBuyoutQty: null,
      funnelBuyoutRevenue: null,
      funnelAvgPrice: null,
      funnelAddToCartPercent: null,
      funnelCartToOrderPercent: null,
      funnelOrderToBuyoutPercent: null,
      adSpend: 0,
      storageCost: 0,
      netProfit: 0,
    };
  }

  for (const nmId of nmIds) {
    skus[nmId] = {};
    for (const dayIso of dayRangeIso) {
      const dayLabel = dayLabelFromIso(dayIso);
      const base = baseMap.get(dayKey(nmId, dayIso)) ?? createEmptyBaseRow();

      const rRevenue = base.rawBuyoutRevenue;
      const rSoldQty = base.rawBuyoutQty;
      const rFinanceRevenue = base.financeRevenue;
      const rFinanceSoldQty = base.financeSoldQty;
      const rOpProfit = base.opProfit;
      const rCostTotal = base.costTotal;
      const rOrderQty = base.orderQty;
      const rOrderRevenue = base.orderRevenue;
      const rFunnelViewQty = base.funnelViewQty;
      const rFunnelAddToCartQty = base.funnelAddToCartQty;
      const rExactFunnelOrderQty = base.funnelOrderQty;
      const rExactFunnelOrderRevenue = base.funnelOrderRevenue;
      const rExactFunnelCancelQty = base.funnelCancelQty;
      const rExactFunnelBuyoutQty = base.funnelBuyoutQty;
      const rExactFunnelBuyoutRevenue = base.funnelBuyoutRevenue;
      const rExactFunnelAvgPrice = base.funnelAvgPrice;
      const rFunnelAddToCartPercent = base.funnelAddToCartPercent;
      const rFunnelCartToOrderPercent = base.funnelCartToOrderPercent;
      const rFunnelOrderToBuyoutPercent = base.funnelOrderToBuyoutPercent;
      const rAdSpend = base.adSpend;
      const rStorageCost = base.storageCost;

      const rFunnelOrderQty = rExactFunnelOrderQty ?? rOrderQty;
      const rFunnelOrderRevenue = rExactFunnelOrderRevenue ?? rOrderRevenue;
      const rFunnelCancelQty = rExactFunnelCancelQty;
      const rFunnelBuyoutQty = rExactFunnelBuyoutQty ?? rSoldQty;
      const rFunnelBuyoutRevenue = rExactFunnelBuyoutRevenue ?? rRevenue;
      const rFunnelAvgPrice = rExactFunnelAvgPrice
        ?? (
          rFunnelBuyoutQty !== null
          && rFunnelBuyoutRevenue !== null
          && rFunnelBuyoutQty > 0
            ? rFunnelBuyoutRevenue / rFunnelBuyoutQty
            : null
        );

      const profitBeforeTax = rOpProfit - rCostTotal - rAdSpend;
      const netProfit = calculateTax({
        taxType: tenantTaxType,
        taxRatePercent: tenantTaxRate,
        revenue: rFinanceRevenue,
        profitBeforeTax,
      }).netProfit;

      const skuEntry: Record<string, number | null> = {
        revenue: roundInt(rRevenue),
        soldQty: round2(rSoldQty),
        financeRevenue: roundInt(rFinanceRevenue),
        financeSoldQty: round2(rFinanceSoldQty),
        opProfit: roundInt(rOpProfit),
        costTotal: roundInt(rCostTotal),
        orderQty: rOrderQty === null ? null : round2(rOrderQty),
        orderRevenue: rOrderRevenue === null ? null : roundInt(rOrderRevenue),
        funnelViewQty: rFunnelViewQty === null ? null : roundInt(rFunnelViewQty),
        funnelAddToCartQty: rFunnelAddToCartQty === null ? null : roundInt(rFunnelAddToCartQty),
        funnelOrderQty: rFunnelOrderQty === null ? null : round2(rFunnelOrderQty),
        funnelOrderRevenue: rFunnelOrderRevenue === null ? null : roundInt(rFunnelOrderRevenue),
        funnelCancelQty: rFunnelCancelQty === null ? null : round2(rFunnelCancelQty),
        funnelBuyoutQty: rFunnelBuyoutQty === null ? null : round2(rFunnelBuyoutQty),
        funnelBuyoutRevenue: rFunnelBuyoutRevenue === null ? null : roundInt(rFunnelBuyoutRevenue),
        funnelAvgPrice: rFunnelAvgPrice === null ? null : roundInt(rFunnelAvgPrice),
        funnelAddToCartPercent: rFunnelAddToCartPercent === null ? null : round2(rFunnelAddToCartPercent),
        funnelCartToOrderPercent: rFunnelCartToOrderPercent === null ? null : round2(rFunnelCartToOrderPercent),
        funnelOrderToBuyoutPercent: rFunnelOrderToBuyoutPercent === null ? null : round2(rFunnelOrderToBuyoutPercent),
        adSpend: roundInt(rAdSpend),
        storageCost: round2(rStorageCost),
        netProfit: roundInt(netProfit),
      };

      const netProfitWithoutAds = (skuEntry.netProfit ?? 0) + (skuEntry.adSpend ?? 0);
      const profitabilityRevenue = (skuEntry.financeRevenue ?? 0) > 0 ? skuEntry.financeRevenue : skuEntry.revenue;
      const profitabilitySoldQty = (skuEntry.financeSoldQty ?? 0) > 0 ? skuEntry.financeSoldQty : skuEntry.soldQty;
      const drrRevenueBase = (skuEntry.funnelOrderRevenue ?? 0) > 0
        ? skuEntry.funnelOrderRevenue
        : ((skuEntry.orderRevenue ?? 0) > 0 ? skuEntry.orderRevenue : null);
      const drr = drrRevenueBase && drrRevenueBase > 0 ? ((skuEntry.adSpend ?? 0) / drrRevenueBase) * 100 : null;
      const buyoutPercent = skuEntry.funnelOrderToBuyoutPercent !== null && skuEntry.funnelOrderToBuyoutPercent !== undefined
        ? skuEntry.funnelOrderToBuyoutPercent
        : (
            skuEntry.funnelBuyoutQty !== null
            && skuEntry.funnelCancelQty !== null
            && (skuEntry.funnelBuyoutQty + skuEntry.funnelCancelQty) > 0
              ? (skuEntry.funnelBuyoutQty / (skuEntry.funnelBuyoutQty + skuEntry.funnelCancelQty)) * 100
              : null
          );
      const avgOrderPrice = skuEntry.funnelOrderQty && skuEntry.funnelOrderQty > 0 && skuEntry.funnelOrderRevenue !== null
        ? skuEntry.funnelOrderRevenue / skuEntry.funnelOrderQty
        : (
            skuEntry.orderQty && skuEntry.orderQty > 0 && skuEntry.orderRevenue !== null
              ? skuEntry.orderRevenue / skuEntry.orderQty
              : null
          );
      const avgBuyoutPrice = profitabilitySoldQty && profitabilitySoldQty > 0
        ? (profitabilityRevenue ?? 0) / profitabilitySoldQty
        : null;
      const profitPerUnit = profitabilitySoldQty && profitabilitySoldQty > 0
        ? (skuEntry.netProfit ?? 0) / profitabilitySoldQty
        : null;
      const funnelAvgPrice = skuEntry.funnelBuyoutQty && skuEntry.funnelBuyoutQty > 0 && skuEntry.funnelBuyoutRevenue !== null
        ? skuEntry.funnelBuyoutRevenue / skuEntry.funnelBuyoutQty
        : skuEntry.funnelAvgPrice;

      skuEntry.netProfitBeforeAds = roundInt(netProfitWithoutAds);
      skuEntry.drr = drr === null ? null : round2(drr);
      skuEntry.buyoutPercent = buyoutPercent === null ? null : round2(buyoutPercent);
      skuEntry.avgOrderPrice = avgOrderPrice === null ? null : roundInt(avgOrderPrice);
      skuEntry.avgBuyoutPrice = avgBuyoutPrice === null ? null : roundInt(avgBuyoutPrice);
      skuEntry.profitPerUnit = profitPerUnit === null ? null : roundInt(profitPerUnit);
      skuEntry.funnelAvgPrice = funnelAvgPrice === null || funnelAvgPrice === undefined ? null : roundInt(funnelAvgPrice);

      skus[nmId][dayLabel] = skuEntry;

      const g = groupDaily[dayLabel];
      g.revenue = (g.revenue ?? 0) + rRevenue;
      g.soldQty = (g.soldQty ?? 0) + rSoldQty;
      g.financeRevenue = (g.financeRevenue ?? 0) + rFinanceRevenue;
      g.financeSoldQty = (g.financeSoldQty ?? 0) + rFinanceSoldQty;
      g.opProfit = (g.opProfit ?? 0) + rOpProfit;
      g.costTotal = (g.costTotal ?? 0) + rCostTotal;
      if (rOrderQty !== null && rOrderRevenue !== null) {
        g.orderQty = (g.orderQty ?? 0) + rOrderQty;
        g.orderRevenue = (g.orderRevenue ?? 0) + rOrderRevenue;
      }
      if (rFunnelViewQty !== null) {
        g.funnelViewQty = (g.funnelViewQty ?? 0) + rFunnelViewQty;
      }
      if (rFunnelAddToCartQty !== null) {
        g.funnelAddToCartQty = (g.funnelAddToCartQty ?? 0) + rFunnelAddToCartQty;
      }
      if (rFunnelOrderQty !== null) {
        g.funnelOrderQty = (g.funnelOrderQty ?? 0) + rFunnelOrderQty;
      }
      if (rFunnelOrderRevenue !== null) {
        g.funnelOrderRevenue = (g.funnelOrderRevenue ?? 0) + rFunnelOrderRevenue;
      }
      if (rFunnelCancelQty !== null) {
        g.funnelCancelQty = (g.funnelCancelQty ?? 0) + rFunnelCancelQty;
      }
      if (rFunnelBuyoutQty !== null) {
        g.funnelBuyoutQty = (g.funnelBuyoutQty ?? 0) + rFunnelBuyoutQty;
      }
      if (rFunnelBuyoutRevenue !== null) {
        g.funnelBuyoutRevenue = (g.funnelBuyoutRevenue ?? 0) + rFunnelBuyoutRevenue;
      }
      if (rFunnelAvgPrice !== null) {
        g.funnelAvgPrice = rFunnelAvgPrice;
      }
      if (rFunnelAddToCartPercent !== null) {
        g.funnelAddToCartPercent = rFunnelAddToCartPercent;
      }
      if (rFunnelCartToOrderPercent !== null) {
        g.funnelCartToOrderPercent = rFunnelCartToOrderPercent;
      }
      if (rFunnelOrderToBuyoutPercent !== null) {
        g.funnelOrderToBuyoutPercent = rFunnelOrderToBuyoutPercent;
      }
      g.adSpend = (g.adSpend ?? 0) + rAdSpend;
      g.storageCost = (g.storageCost ?? 0) + rStorageCost;
      g.netProfit = (g.netProfit ?? 0) + netProfit;
    }
  }

  for (const dayIso of dayRangeIso) {
    const dayLabel = dayLabelFromIso(dayIso);
    const g = groupDaily[dayLabel];

    const netProfitWithoutAds = (g.netProfit ?? 0) + (g.adSpend ?? 0);
    const profitabilityRevenue = (g.financeRevenue ?? 0) > 0 ? g.financeRevenue : g.revenue;
    const profitabilitySoldQty = (g.financeSoldQty ?? 0) > 0 ? g.financeSoldQty : g.soldQty;
    const drrRevenueBase = (g.funnelOrderRevenue ?? 0) > 0
      ? g.funnelOrderRevenue
      : ((g.orderRevenue ?? 0) > 0 ? g.orderRevenue : null);
    const drr = drrRevenueBase && drrRevenueBase > 0 ? ((g.adSpend ?? 0) / drrRevenueBase) * 100 : null;
    const funnelAddToCartPercent = g.funnelViewQty && g.funnelViewQty > 0 && g.funnelAddToCartQty !== null
      ? (g.funnelAddToCartQty / g.funnelViewQty) * 100
      : null;
    const funnelCartToOrderPercent = g.funnelAddToCartQty && g.funnelAddToCartQty > 0 && g.funnelOrderQty !== null
      ? (g.funnelOrderQty / g.funnelAddToCartQty) * 100
      : null;
    const funnelOrderToBuyoutPercent = g.funnelOrderQty && g.funnelOrderQty > 0 && g.funnelBuyoutQty !== null
      ? (g.funnelBuyoutQty / g.funnelOrderQty) * 100
      : null;
    const buyoutPercent = g.funnelBuyoutQty !== null
      && g.funnelCancelQty !== null
      && (g.funnelBuyoutQty + g.funnelCancelQty) > 0
      ? (g.funnelBuyoutQty / (g.funnelBuyoutQty + g.funnelCancelQty)) * 100
      : funnelOrderToBuyoutPercent;
    const avgOrderPrice = g.funnelOrderQty && g.funnelOrderQty > 0 && g.funnelOrderRevenue !== null
      ? g.funnelOrderRevenue / g.funnelOrderQty
      : (
          g.orderQty && g.orderQty > 0 && g.orderRevenue !== null
            ? g.orderRevenue / g.orderQty
            : null
        );
    const avgBuyoutPrice = profitabilitySoldQty && profitabilitySoldQty > 0
      ? (profitabilityRevenue ?? 0) / profitabilitySoldQty
      : null;
    const profitPerUnit = profitabilitySoldQty && profitabilitySoldQty > 0
      ? (g.netProfit ?? 0) / profitabilitySoldQty
      : null;

    g.revenue = roundInt(toNumber(g.revenue));
    g.soldQty = round2(toNumber(g.soldQty));
    g.financeRevenue = roundInt(toNumber(g.financeRevenue));
    g.financeSoldQty = round2(toNumber(g.financeSoldQty));
    g.opProfit = roundInt(toNumber(g.opProfit));
    g.costTotal = roundInt(toNumber(g.costTotal));
    g.orderQty = g.orderQty === null ? null : round2(toNumber(g.orderQty));
    g.orderRevenue = g.orderRevenue === null ? null : roundInt(toNumber(g.orderRevenue));
    g.funnelViewQty = g.funnelViewQty === null ? null : roundInt(toNumber(g.funnelViewQty));
    g.funnelAddToCartQty = g.funnelAddToCartQty === null ? null : roundInt(toNumber(g.funnelAddToCartQty));
    g.funnelOrderQty = g.funnelOrderQty === null ? null : round2(toNumber(g.funnelOrderQty));
    g.funnelOrderRevenue = g.funnelOrderRevenue === null ? null : roundInt(toNumber(g.funnelOrderRevenue));
    g.funnelCancelQty = g.funnelCancelQty === null ? null : round2(toNumber(g.funnelCancelQty));
    g.funnelBuyoutQty = g.funnelBuyoutQty === null ? null : round2(toNumber(g.funnelBuyoutQty));
    g.funnelBuyoutRevenue = g.funnelBuyoutRevenue === null ? null : roundInt(toNumber(g.funnelBuyoutRevenue));
    g.funnelAvgPrice = g.funnelBuyoutQty !== null && g.funnelBuyoutQty > 0 && g.funnelBuyoutRevenue !== null
      ? roundInt(g.funnelBuyoutRevenue / g.funnelBuyoutQty)
      : (g.funnelAvgPrice === null ? null : roundInt(toNumber(g.funnelAvgPrice)));
    g.funnelAddToCartPercent = funnelAddToCartPercent === null ? null : round2(funnelAddToCartPercent);
    g.funnelCartToOrderPercent = funnelCartToOrderPercent === null ? null : round2(funnelCartToOrderPercent);
    g.funnelOrderToBuyoutPercent = funnelOrderToBuyoutPercent === null ? null : round2(funnelOrderToBuyoutPercent);
    g.adSpend = roundInt(toNumber(g.adSpend));
    g.storageCost = round2(toNumber(g.storageCost));
    g.netProfit = roundInt(toNumber(g.netProfit));
    g.netProfitBeforeAds = roundInt(netProfitWithoutAds);
    g.drr = drr === null ? null : round2(drr);
    g.buyoutPercent = buyoutPercent === null ? null : round2(buyoutPercent);
    g.avgOrderPrice = avgOrderPrice === null ? null : roundInt(avgOrderPrice);
    g.avgBuyoutPrice = avgBuyoutPrice === null ? null : roundInt(avgBuyoutPrice);
    g.profitPerUnit = profitPerUnit === null ? null : roundInt(profitPerUnit);
  }

  return {
    days: dayLabels,
    group: groupDaily,
    skus,
  };
}

function compareDynamics(
  target: GroupTarget,
  expected: DynamicsResult,
  actual: DynamicsResult,
): CompareSummary {
  const mismatches: Mismatch[] = [];
  let valuesCompared = 0;

  const expectedDaySet = new Set(expected.days);
  const actualDaySet = new Set(actual.days ?? []);
  const dayUnion = Array.from(new Set([...expected.days, ...(actual.days ?? [])]));

  for (const day of dayUnion) {
    const dayInExpected = expectedDaySet.has(day);
    const dayInActual = actualDaySet.has(day);
    if (!dayInExpected || !dayInActual) {
      mismatches.push({
        tenantId: target.tenantId,
        tenantName: target.tenantName,
        groupId: target.groupId,
        groupName: target.groupName,
        scope: 'group',
        nmId: null,
        day,
        metric: 'day_presence',
        actual: dayInActual ? 1 : null,
        expected: dayInExpected ? 1 : null,
        delta: null,
      });
    }
  }

  for (const day of dayUnion) {
    const expectedRow = expected.group?.[day] ?? {};
    const actualRow = actual.group?.[day] ?? {};
    for (const metric of METRICS_TO_COMPARE) {
      const expectedValue = normalizeComparable(expectedRow[metric]);
      const actualValue = normalizeComparable(actualRow[metric]);
      valuesCompared += 1;
      if (!areComparableEqual(actualValue, expectedValue)) {
        mismatches.push({
          tenantId: target.tenantId,
          tenantName: target.tenantName,
          groupId: target.groupId,
          groupName: target.groupName,
          scope: 'group',
          nmId: null,
          day,
          metric,
          actual: actualValue,
          expected: expectedValue,
          delta: actualValue !== null && expectedValue !== null ? round2(actualValue - expectedValue) : null,
        });
      }
    }
  }

  const expectedSkuIds = Object.keys(expected.skus).map((value) => Number(value));
  const actualSkuIds = Object.keys(actual.skus ?? {}).map((value) => Number(value));
  const skuUnion = Array.from(new Set([...expectedSkuIds, ...actualSkuIds])).sort((a, b) => a - b);

  for (const nmId of skuUnion) {
    const expectedSeries = expected.skus[nmId] ?? {};
    const actualSeries = actual.skus?.[nmId] ?? {};

    const expectedHasSku = nmId in expected.skus;
    const actualHasSku = nmId in (actual.skus ?? {});
    if (!expectedHasSku || !actualHasSku) {
      mismatches.push({
        tenantId: target.tenantId,
        tenantName: target.tenantName,
        groupId: target.groupId,
        groupName: target.groupName,
        scope: 'sku',
        nmId,
        day: '-',
        metric: 'sku_presence',
        actual: actualHasSku ? 1 : null,
        expected: expectedHasSku ? 1 : null,
        delta: null,
      });
    }

    for (const day of dayUnion) {
      const expectedRow = expectedSeries[day] ?? {};
      const actualRow = actualSeries[day] ?? {};
      for (const metric of METRICS_TO_COMPARE) {
        const expectedValue = normalizeComparable(expectedRow[metric]);
        const actualValue = normalizeComparable(actualRow[metric]);
        valuesCompared += 1;
        if (!areComparableEqual(actualValue, expectedValue)) {
          mismatches.push({
            tenantId: target.tenantId,
            tenantName: target.tenantName,
            groupId: target.groupId,
            groupName: target.groupName,
            scope: 'sku',
            nmId,
            day,
            metric,
            actual: actualValue,
            expected: expectedValue,
            delta: actualValue !== null && expectedValue !== null ? round2(actualValue - expectedValue) : null,
          });
        }
      }
    }
  }

  return {
    valuesCompared,
    mismatches,
    skuCountExpected: expectedSkuIds.length,
    skuCountActual: actualSkuIds.length,
    dayCountExpected: expected.days.length,
    dayCountActual: (actual.days ?? []).length,
  };
}

async function getGroupTargets(db: DbExecutor, options: CliOptions): Promise<GroupTarget[]> {
  const rows = (await db.execute(sql`
    SELECT
      pg.id as "groupId",
      pg.name as "groupName",
      pg.tenant_id as "tenantId",
      t.name as "tenantName"
    FROM product_groups pg
    JOIN tenants t ON t.id = pg.tenant_id
    ORDER BY t.name, pg.name
  `)) as Array<GroupTarget>;

  return rows.filter((row) => {
    if (options.tenantId && row.tenantId !== options.tenantId) {
      return false;
    }
    if (options.groupId && row.groupId !== options.groupId) {
      return false;
    }
    return true;
  });
}

async function getGroupNmIds(db: DbExecutor, groupId: string): Promise<number[]> {
  const rows = (await db.execute(sql`
    SELECT nm_id as "nmId"
    FROM product_group_members
    WHERE group_id = ${groupId}
    ORDER BY nm_id ASC
  `)) as Array<{ nmId: number }>;

  return rows.map((row) => Number(row.nmId));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  loadEnv();

  const [{ db }, { AnalyticsEngine }] = await Promise.all([
    import('@/lib/db'),
    import('@/server/analytics/engine'),
  ]);
  const database = db as unknown as DbExecutor;

  const targets = await getGroupTargets(database, options);
  if (targets.length === 0) {
    throw new Error('No product groups found for selected filters');
  }

  console.log(`[verify] period=${options.from}..${options.to} groups=${targets.length}`);

  const groupSummaries: GroupRunSummary[] = [];
  const allMismatches: Mismatch[] = [];
  let totalComparedValues = 0;

  for (const target of targets) {
    const nmIds = await getGroupNmIds(database, target.groupId);
    if (nmIds.length === 0) {
      console.log(`[verify] tenant=${target.tenantName} group=${target.groupName} skipped (empty group)`);
      continue;
    }

    const expected = await computeExpectedDynamics({
      db: database,
      tenantId: target.tenantId,
      nmIds,
      from: options.from,
      to: options.to,
    });

    const actual = await AnalyticsEngine.getGroupDynamics(
      target.tenantId,
      target.groupId,
      parseDateOnly(options.from),
      parseDateOnly(options.to),
      { calculationMode: 'FACT_WB' },
    ) as DynamicsResult;

    const summary = compareDynamics(target, expected, actual);

    totalComparedValues += summary.valuesCompared;
    allMismatches.push(...summary.mismatches);

    groupSummaries.push({
      target,
      comparedValues: summary.valuesCompared,
      mismatchCount: summary.mismatches.length,
      expectedSkuCount: summary.skuCountExpected,
      actualSkuCount: summary.skuCountActual,
      expectedDayCount: summary.dayCountExpected,
      actualDayCount: summary.dayCountActual,
    });

    console.log(
      `[verify] tenant="${target.tenantName}" group="${target.groupName}" compared=${summary.valuesCompared} mismatches=${summary.mismatches.length}`,
    );
  }

  const report: FullRunReport = {
    checkedAt: new Date().toISOString(),
    period: { from: options.from, to: options.to },
    filters: {
      tenantId: options.tenantId,
      groupId: options.groupId,
    },
    groupsChecked: groupSummaries.length,
    totalComparedValues,
    totalMismatches: allMismatches.length,
    groupSummaries,
    mismatches: allMismatches,
  };

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputJson = options.outputJson ?? path.join('output', 'dynamics-fact-check', `report-${timestamp}.json`);
  const outputMd = options.outputMd ?? path.join('output', 'dynamics-fact-check', `report-${timestamp}.md`);

  ensureDir(outputJson);
  fs.writeFileSync(outputJson, JSON.stringify(report, null, 2), 'utf8');

  ensureDir(outputMd);
  fs.writeFileSync(outputMd, buildMarkdownReport(report), 'utf8');

  console.log(`[verify] json=${outputJson}`);
  console.log(`[verify] md=${outputMd}`);
  console.log(`[verify] compared=${report.totalComparedValues} mismatches=${report.totalMismatches}`);

  if (report.totalMismatches > 0 && options.failOnMismatch) {
    process.exit(2);
  }

  process.exit(0);
}

main().catch((error) => {
  console.error('[verify] failed', error);
  process.exit(1);
});
