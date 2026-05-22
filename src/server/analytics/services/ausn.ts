import { sql } from "drizzle-orm";

import { db, withTenantContext } from "@/lib/db";
import {
  buildWbCreditInterestDeductionSql,
  buildWbCreditPrincipalDeductionSql,
  buildWbDeductionExpenseSql,
  buildWbPayoutBeforeCostSql,
  buildWbRealizationSaleDateSql,
  buildWbRealizationTaxBaseSql,
} from "./economics";

export type AusnTaxObject = "income" | "income_expenses";

export type AusnDocumentType =
  | "buyout_income"
  | "weekly_withholding"
  | "weekly_withholding_return"
  | "detail_income"
  | "detail_income_return"
  | "upd_expense"
  | "ukd_expense_return"
  | "manual_income"
  | "manual_income_return"
  | "manual_expense"
  | "manual_expense_return";

export const AUSN_DOCUMENT_TYPES: AusnDocumentType[] = [
  "buyout_income",
  "weekly_withholding",
  "weekly_withholding_return",
  "detail_income",
  "detail_income_return",
  "upd_expense",
  "ukd_expense_return",
  "manual_income",
  "manual_income_return",
  "manual_expense",
  "manual_expense_return",
];

export const AUSN_WB_DOCUMENT_TYPES: AusnDocumentType[] = [
  "buyout_income",
  "weekly_withholding",
  "weekly_withholding_return",
  "detail_income",
  "detail_income_return",
  "upd_expense",
  "ukd_expense_return",
];

export type AusnMonthlyInput = {
  month: string;
  taxObject: AusnTaxObject;
  bankIncome: number;
  bankIncomeReturn: number;
  bankExpense: number;
  bankExpenseReturn: number;
  otherExpenses: number;
  notes: string | null;
};

export type AusnDocumentRow = {
  id: string | null;
  documentType: AusnDocumentType;
  amount: number;
  title: string | null;
  documentDate: string | null;
  source: string | null;
};

export type AusnDocumentTotals = Record<AusnDocumentType, number> & {
  totalIncomeDocuments: number;
  netIncomeDocuments: number;
  lkIncome: number;
  lkIncomeReturn: number;
  lkExpense: number;
  lkExpenseReturn: number;
  lkNetIncomeBase: number;
  lkNetExpenseBase: number;
  wbLkIncome: number;
  wbLkIncomeReturn: number;
  wbLkExpense: number;
  wbLkExpenseReturn: number;
  manualLkIncome: number;
  manualLkIncomeReturn: number;
  manualLkExpense: number;
  manualLkExpenseReturn: number;
};

export type AusnExpenseBreakdown = {
  commission: number;
  logistics: number;
  storage: number;
  acceptance: number;
  acquiring: number;
  paymentSchedule: number;
  deduction: number;
  deductionCreditPrincipal: number;
  deductionCreditInterest: number;
  cashback: number;
  penalties: number;
  additionalPayments: number;
  netWbExpenses: number;
  adCostsObserved: number;
  paidStorageObserved: number;
};

export type AusnManualEntry = {
  kind: "income" | "income_return" | "expense" | "expense_return";
  title: string;
  amount: number;
  requiredFor: "income" | "income_expenses" | "both";
  details: string;
};

export type AusnReconciliation = {
  generatedAt: string;
  period: {
    month: string;
    from: string;
    to: string;
    basis: "ausn_documents";
  };
  input: AusnMonthlyInput;
  documentRows: AusnDocumentRow[];
  documentTotals: AusnDocumentTotals;
  dataQuality: {
    realizationRows: number;
    realizationReports: number;
    firstReportDate: string | null;
    lastReportDate: string | null;
    retailWithDiscRows: number;
    sppRows: number;
    documentRows: number;
    warnings: string[];
  };
  wb: {
    grossSales: number;
    returns: number;
    netSales: number;
    retailAmount: number;
    retailPriceWithDisc: number;
    spp: number;
    payoutBeforeCost: number;
  };
  bank: {
    incomeAlreadyMarked: number;
    incomeReturnAlreadyMarked: number;
    expenseAlreadyMarked: number;
    expenseReturnAlreadyMarked: number;
    netIncomeBase: number;
    netExpenseBase: number;
    notCoveredByBankGross: number;
    reconciliationDelta: number;
  };
  expenses: AusnExpenseBreakdown;
  manualEntries: AusnManualEntry[];
  taxEstimate: {
    taxObject: AusnTaxObject;
    ratePercent: number;
    minimumRatePercent: number | null;
    incomeBase: number;
    expenseBase: number;
    profitBase: number;
    regularTax: number;
    minimumTax: number;
    taxToPay: number;
  };
};

const MONTH_RE = /^\d{4}-\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function roundMoney(value: number) {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

function parseNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeMoney(value: unknown) {
  return roundMoney(Math.max(0, parseNumber(value)));
}

export function normalizeAusnTaxObject(value: unknown): AusnTaxObject {
  return value === "income_expenses" ? "income_expenses" : "income";
}

export function normalizeAusnMonth(value: string | null | undefined) {
  if (value && MONTH_RE.test(value)) {
    return value;
  }
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function normalizeAusnDocumentType(value: unknown): AusnDocumentType | null {
  return AUSN_DOCUMENT_TYPES.includes(value as AusnDocumentType)
    ? value as AusnDocumentType
    : null;
}

function getMonthRange(month: string) {
  const normalized = normalizeAusnMonth(month);
  const [year, monthNum] = normalized.split("-").map(Number);
  const from = new Date(Date.UTC(year!, monthNum! - 1, 1));
  const toExclusive = new Date(Date.UTC(year!, monthNum!, 1));
  const toInclusive = new Date(toExclusive.getTime() - 86_400_000);
  return {
    month: normalized,
    from,
    toExclusive,
    fromDate: from.toISOString().slice(0, 10),
    toDate: toInclusive.toISOString().slice(0, 10),
  };
}

function emptyDocumentTotals(): Record<AusnDocumentType, number> {
  return {
    buyout_income: 0,
    weekly_withholding: 0,
    weekly_withholding_return: 0,
    detail_income: 0,
    detail_income_return: 0,
    upd_expense: 0,
    ukd_expense_return: 0,
    manual_income: 0,
    manual_income_return: 0,
    manual_expense: 0,
    manual_expense_return: 0,
  };
}

export function calculateAusnDocumentTotals(rows: AusnDocumentRow[]): AusnDocumentTotals {
  const totals = emptyDocumentTotals();
  rows.forEach((row) => {
    totals[row.documentType] = roundMoney(totals[row.documentType] + row.amount);
  });

  const totalIncomeDocuments = roundMoney(totals.buyout_income + totals.detail_income);
  const netIncomeDocuments = roundMoney(Math.max(0, totalIncomeDocuments - totals.detail_income_return));
  const wbLkIncome = roundMoney(Math.max(0, totals.weekly_withholding - totals.weekly_withholding_return + totals.detail_income_return));
  const wbLkIncomeReturn = totals.detail_income_return;
  const wbLkExpense = totals.upd_expense;
  const wbLkExpenseReturn = totals.ukd_expense_return;
  const manualLkIncome = totals.manual_income;
  const manualLkIncomeReturn = totals.manual_income_return;
  const manualLkExpense = totals.manual_expense;
  const manualLkExpenseReturn = totals.manual_expense_return;
  const rawLkIncome = roundMoney(wbLkIncome + manualLkIncome);
  const lkIncome = roundMoney(Math.max(0, rawLkIncome));
  const lkIncomeReturn = roundMoney(wbLkIncomeReturn + manualLkIncomeReturn);
  const lkExpense = roundMoney(wbLkExpense + manualLkExpense);
  const lkExpenseReturn = roundMoney(wbLkExpenseReturn + manualLkExpenseReturn);
  const lkNetIncomeBase = roundMoney(Math.max(0, lkIncome - lkIncomeReturn));
  const lkNetExpenseBase = roundMoney(Math.max(0, lkExpense - lkExpenseReturn));

  return {
    ...totals,
    totalIncomeDocuments,
    netIncomeDocuments,
    lkIncome,
    lkIncomeReturn,
    lkExpense,
    lkExpenseReturn,
    lkNetIncomeBase,
    lkNetExpenseBase,
    wbLkIncome,
    wbLkIncomeReturn,
    wbLkExpense,
    wbLkExpenseReturn,
    manualLkIncome,
    manualLkIncomeReturn,
    manualLkExpense,
    manualLkExpenseReturn,
  };
}

export type AusnTaxEstimateInput = {
  taxObject: AusnTaxObject;
  bankIncome: number;
  bankIncomeReturn: number;
  bankExpense: number;
  bankExpenseReturn: number;
  otherExpenses: number;
  documentTotals: AusnDocumentTotals;
};

export type AusnTaxEstimate = AusnReconciliation["taxEstimate"];

export function calculateAusnTaxEstimate(input: AusnTaxEstimateInput): AusnTaxEstimate {
  const bankNetIncomeBase = roundMoney(Math.max(0, input.bankIncome - input.bankIncomeReturn));
  const bankNetExpenseBase = roundMoney(Math.max(0, input.bankExpense - input.bankExpenseReturn));
  const incomeBase = roundMoney(bankNetIncomeBase + input.documentTotals.lkNetIncomeBase);
  const expenseBase = input.taxObject === "income_expenses"
    ? roundMoney(bankNetExpenseBase + input.documentTotals.lkNetExpenseBase + input.otherExpenses)
    : 0;
  const profitBase = roundMoney(Math.max(0, incomeBase - expenseBase));
  const regularTax = input.taxObject === "income_expenses"
    ? roundMoney(profitBase * 0.2)
    : roundMoney(incomeBase * 0.08);
  const minimumTax = input.taxObject === "income_expenses"
    ? roundMoney(incomeBase * 0.03)
    : 0;
  const taxToPay = input.taxObject === "income_expenses"
    ? roundMoney(Math.max(regularTax, minimumTax))
    : regularTax;

  return {
    taxObject: input.taxObject,
    ratePercent: input.taxObject === "income_expenses" ? 20 : 8,
    minimumRatePercent: input.taxObject === "income_expenses" ? 3 : null,
    incomeBase,
    expenseBase,
    profitBase,
    regularTax,
    minimumTax,
    taxToPay,
  };
}

function makeWarnings(input: {
  documentRows: number;
  totals: AusnDocumentTotals;
  realizationRows: number;
  adCostsObserved: number;
  deduction: number;
  penalties: number;
  manualRows: number;
}) {
  const warnings: string[] = [];
  if (input.documentRows === 0) {
    warnings.push("Документы АУСН за месяц еще не загружены. Нажмите синхронизацию WB, иначе строки для ЛК будут нулевыми.");
  }
  if (input.totals.weekly_withholding === 0 && input.documentRows > 0) {
    warnings.push("Не загружены удержания из еженедельных отчетов. Приход по взаимозачету может быть занижен.");
  }
  if (input.totals.upd_expense === 0 && input.documentRows > 0) {
    warnings.push("Не загружены УПД. Расход для ЛК АУСН будет нулевым.");
  }
  if (input.totals.detail_income === 0 && input.documentRows > 0) {
    warnings.push("Не загружены доходы из детализации к отчету реализации. Это контрольный блок для сверки с бухгалтерией.");
  }
  if (input.totals.weekly_withholding_return > input.totals.weekly_withholding) {
    warnings.push("Возврат удержаний больше удержаний. Проверьте знак и период документов.");
  }
  if (input.realizationRows === 0) {
    warnings.push("В WB API нет строк отчета реализации за этот месяц. API-контроль не сможет подтвердить период.");
  }
  if (input.adCostsObserved > 0) {
    warnings.push("В WB API есть рекламные расходы. В АУСН-калькулятор они не попадают автоматически: учитывайте их только по документу/банку.");
  }
  if (input.deduction !== 0) {
    warnings.push("В WB API есть прочие удержания. Для ЛК АУСН используйте сумму из еженедельного отчета, не PnL-удержания.");
  }
  if (input.penalties !== 0) {
    warnings.push("В WB API есть штрафы. Для АУСН проверяйте их по документам перед внесением как расход.");
  }
  if (input.manualRows > 0) {
    warnings.push("Есть операции вне WB, добавленные вручную. Проверьте, что они не продублированы в банковских операциях АУСН.");
  }
  return warnings;
}

function buildManualEntries(totals: AusnDocumentTotals): AusnManualEntry[] {
  return [
    {
      kind: "income",
      title: "Приход",
      amount: totals.lkIncome,
      requiredFor: "both",
      details: "WB: удержания из еженедельных отчетов - возврат удержаний + возврат доходов из детализации. Плюс прочий приход вручную.",
    },
    {
      kind: "income_return",
      title: "Возврат прихода",
      amount: totals.lkIncomeReturn,
      requiredFor: "both",
      details: "Возврат доходов из детализации WB плюс прочий возврат прихода.",
    },
    {
      kind: "expense",
      title: "Расход",
      amount: totals.lkExpense,
      requiredFor: "both",
      details: "УПД WB плюс прочий расход вручную.",
    },
    {
      kind: "expense_return",
      title: "Возврат расхода",
      amount: totals.lkExpenseReturn,
      requiredFor: "both",
      details: "УКД WB плюс прочий возврат расхода.",
    },
  ];
}

function normalizeDocumentRows(input: unknown): Array<Omit<AusnDocumentRow, "id">> | null {
  if (!Array.isArray(input)) return null;
  return input.slice(0, 500).flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const record = row as Record<string, unknown>;
    const documentType = normalizeAusnDocumentType(record.documentType);
    const amount = normalizeMoney(record.amount);
    if (!documentType || amount <= 0) return [];
    const title = typeof record.title === "string" && record.title.trim()
      ? record.title.trim().slice(0, 500)
      : null;
    const source = typeof record.source === "string" && record.source.trim()
      ? record.source.trim().slice(0, 1000)
      : null;
    const documentDate = typeof record.documentDate === "string" && DATE_RE.test(record.documentDate)
      ? record.documentDate
      : null;
    return [{ documentType, amount, title, documentDate, source }];
  });
}

export async function getAusnMonthlyReconciliation(
  tenantId: string,
  monthValue: string | null | undefined,
): Promise<AusnReconciliation> {
  const range = getMonthRange(normalizeAusnMonth(monthValue));

  const result = await withTenantContext(db, tenantId, async (tx) => {
    const inputRows = await tx.execute(sql`
      SELECT
        month,
        tax_object,
        bank_income,
        bank_income_return,
        bank_expense,
        bank_expense_return,
        other_expenses,
        notes
      FROM ausn_monthly_inputs
      WHERE tenant_id = ${tenantId}
        AND month = ${range.fromDate}::date
      LIMIT 1;
    `);

    const documentRows = await tx.execute(sql`
      SELECT
        id::text AS id,
        document_type,
        amount,
        title,
        document_date::text AS document_date,
        source
      FROM ausn_document_rows
      WHERE tenant_id = ${tenantId}
        AND month = ${range.fromDate}::date
      ORDER BY document_type, document_date NULLS LAST, created_at, id;
    `);

    const wbRows = await tx.execute(sql`
      WITH realization_base AS (
        SELECT
          r.*,
          (${sql.raw(buildWbRealizationTaxBaseSql("r"))})::numeric AS tax_base_revenue,
          (${sql.raw(buildWbDeductionExpenseSql("r"))})::numeric AS deduction_expense,
          (${sql.raw(buildWbCreditPrincipalDeductionSql("r"))})::numeric AS deduction_credit_principal,
          (${sql.raw(buildWbCreditInterestDeductionSql("r"))})::numeric AS deduction_credit_interest
        FROM raw_api_realization_reports r
        WHERE r.tenant_id = ${tenantId}
          AND (${sql.raw(buildWbRealizationSaleDateSql("r"))}) >= ${range.fromDate}::timestamp
          AND (${sql.raw(buildWbRealizationSaleDateSql("r"))}) < ${range.toExclusive.toISOString()}::timestamp
      ),
      realization_summary AS (
        SELECT
          COUNT(*)::int AS realization_rows,
          COUNT(DISTINCT realizationreport_id)::int AS realization_reports,
          MIN(COALESCE(sale_dt, date_from))::date AS first_report_date,
          MAX(COALESCE(sale_dt, date_from))::date AS last_report_date,
          COUNT(*) FILTER (WHERE COALESCE(retail_price_withdisc_rub, 0) <> 0)::int AS retail_with_disc_rows,
          COUNT(*) FILTER (WHERE COALESCE(spp_rub, 0) <> 0)::int AS spp_rows,
          COALESCE(SUM(CASE WHEN tax_base_revenue > 0 THEN tax_base_revenue ELSE 0 END), 0)::numeric AS gross_sales,
          COALESCE(SUM(CASE WHEN tax_base_revenue < 0 THEN ABS(tax_base_revenue) ELSE 0 END), 0)::numeric AS returns,
          COALESCE(SUM(tax_base_revenue), 0)::numeric AS net_sales,
          COALESCE(SUM(retail_amount), 0)::numeric AS retail_amount,
          COALESCE(SUM(retail_price_withdisc_rub), 0)::numeric AS retail_price_with_disc,
          COALESCE(SUM(spp_rub), 0)::numeric AS spp,
          COALESCE(SUM(commission_amount), 0)::numeric AS commission,
          COALESCE(SUM(delivery_rub), 0)::numeric AS logistics,
          COALESCE(SUM(storage_fee_rub), 0)::numeric AS storage,
          COALESCE(SUM(acceptance), 0)::numeric AS acceptance,
          COALESCE(SUM(acquiring_fee), 0)::numeric AS acquiring,
          COALESCE(SUM(payment_schedule_rub), 0)::numeric AS payment_schedule,
          COALESCE(SUM(deduction_expense), 0)::numeric AS deduction,
          COALESCE(SUM(deduction_credit_principal), 0)::numeric AS deduction_credit_principal,
          COALESCE(SUM(deduction_credit_interest), 0)::numeric AS deduction_credit_interest,
          COALESCE(SUM(cashback_amount), 0)::numeric AS cashback,
          COALESCE(SUM(penalty_rub), 0)::numeric AS penalties,
          COALESCE(SUM(additional_payment), 0)::numeric AS additional_payments,
          COALESCE(SUM((${sql.raw(buildWbPayoutBeforeCostSql("realization_base"))})), 0)::numeric AS payout_before_cost
        FROM realization_base
      ),
      ad_costs AS (
        SELECT COALESCE(SUM(amount), 0)::numeric AS ad_costs_observed
        FROM raw_api_ad_costs
        WHERE tenant_id = ${tenantId}
          AND date >= ${range.fromDate}::timestamp
          AND date < ${range.toExclusive.toISOString()}::timestamp
      ),
      paid_storage AS (
        SELECT COALESCE(SUM(storage_amount), 0)::numeric AS paid_storage_observed
        FROM raw_api_paid_storage
        WHERE tenant_id = ${tenantId}
          AND date >= ${range.fromDate}::timestamp
          AND date < ${range.toExclusive.toISOString()}::timestamp
      )
      SELECT
        COALESCE(rs.realization_rows, 0)::int AS realization_rows,
        COALESCE(rs.realization_reports, 0)::int AS realization_reports,
        rs.first_report_date AS first_report_date,
        rs.last_report_date AS last_report_date,
        COALESCE(rs.retail_with_disc_rows, 0)::int AS retail_with_disc_rows,
        COALESCE(rs.spp_rows, 0)::int AS spp_rows,
        COALESCE(rs.gross_sales, 0)::numeric AS gross_sales,
        COALESCE(rs.returns, 0)::numeric AS returns,
        COALESCE(rs.net_sales, 0)::numeric AS net_sales,
        COALESCE(rs.retail_amount, 0)::numeric AS retail_amount,
        COALESCE(rs.retail_price_with_disc, 0)::numeric AS retail_price_with_disc,
        COALESCE(rs.spp, 0)::numeric AS spp,
        COALESCE(rs.commission, 0)::numeric AS commission,
        COALESCE(rs.logistics, 0)::numeric AS logistics,
        COALESCE(rs.storage, 0)::numeric AS storage,
        COALESCE(rs.acceptance, 0)::numeric AS acceptance,
        COALESCE(rs.acquiring, 0)::numeric AS acquiring,
        COALESCE(rs.payment_schedule, 0)::numeric AS payment_schedule,
        COALESCE(rs.deduction, 0)::numeric AS deduction,
        COALESCE(rs.deduction_credit_principal, 0)::numeric AS deduction_credit_principal,
        COALESCE(rs.deduction_credit_interest, 0)::numeric AS deduction_credit_interest,
        COALESCE(rs.cashback, 0)::numeric AS cashback,
        COALESCE(rs.penalties, 0)::numeric AS penalties,
        COALESCE(rs.additional_payments, 0)::numeric AS additional_payments,
        COALESCE(rs.payout_before_cost, 0)::numeric AS payout_before_cost,
        COALESCE((SELECT ad_costs_observed FROM ad_costs), 0)::numeric AS ad_costs_observed,
        COALESCE((SELECT paid_storage_observed FROM paid_storage), 0)::numeric AS paid_storage_observed
      FROM realization_summary rs;
    `);

    return { inputRows, documentRows, wbRows };
  });

  const inputRow = (result.inputRows[0] ?? {}) as Record<string, unknown>;
  const wbRow = (result.wbRows[0] ?? {}) as Record<string, unknown>;
  const taxObject = normalizeAusnTaxObject(inputRow.tax_object);
  const bankIncome = roundMoney(parseNumber(inputRow.bank_income));
  const bankIncomeReturn = roundMoney(parseNumber(inputRow.bank_income_return));
  const bankExpense = roundMoney(parseNumber(inputRow.bank_expense));
  const bankExpenseReturn = roundMoney(parseNumber(inputRow.bank_expense_return));
  const otherExpenses = roundMoney(parseNumber(inputRow.other_expenses));
  const notes = typeof inputRow.notes === "string" && inputRow.notes.trim() ? inputRow.notes : null;

  const documentRows = result.documentRows.flatMap((raw) => {
    const row = raw as Record<string, unknown>;
    const documentType = normalizeAusnDocumentType(row.document_type);
    if (!documentType) return [];
    return [{
      id: typeof row.id === "string" ? row.id : null,
      documentType,
      amount: roundMoney(parseNumber(row.amount)),
      title: typeof row.title === "string" && row.title.trim() ? row.title : null,
      documentDate: typeof row.document_date === "string" ? row.document_date : null,
      source: typeof row.source === "string" && row.source.trim() ? row.source : null,
    }];
  });
  const documentTotals = calculateAusnDocumentTotals(documentRows);

  const commission = roundMoney(parseNumber(wbRow.commission));
  const logistics = roundMoney(parseNumber(wbRow.logistics));
  const storage = roundMoney(parseNumber(wbRow.storage));
  const acceptance = roundMoney(parseNumber(wbRow.acceptance));
  const acquiring = roundMoney(parseNumber(wbRow.acquiring));
  const paymentSchedule = roundMoney(parseNumber(wbRow.payment_schedule));
  const deduction = roundMoney(parseNumber(wbRow.deduction));
  const deductionCreditPrincipal = roundMoney(parseNumber(wbRow.deduction_credit_principal));
  const deductionCreditInterest = roundMoney(parseNumber(wbRow.deduction_credit_interest));
  const cashback = roundMoney(parseNumber(wbRow.cashback));
  const penalties = roundMoney(parseNumber(wbRow.penalties));
  const additionalPayments = roundMoney(parseNumber(wbRow.additional_payments));
  const adCostsObserved = roundMoney(parseNumber(wbRow.ad_costs_observed));
  const paidStorageObserved = roundMoney(parseNumber(wbRow.paid_storage_observed));
  const rawWbExpenses = commission
    + logistics
    + storage
    + acceptance
    + acquiring
    + paymentSchedule
    + deduction
    + cashback
    + penalties
    - additionalPayments;
  const netWbExpenses = roundMoney(Math.max(0, rawWbExpenses));

  const bankNetIncomeBase = roundMoney(Math.max(0, bankIncome - bankIncomeReturn));
  const bankNetExpenseBase = roundMoney(Math.max(0, bankExpense - bankExpenseReturn));
  const taxEstimate = calculateAusnTaxEstimate({
    taxObject,
    bankIncome,
    bankIncomeReturn,
    bankExpense,
    bankExpenseReturn,
    otherExpenses,
    documentTotals,
  });

  const realizationRows = Math.round(parseNumber(wbRow.realization_rows));

  return {
    generatedAt: new Date().toISOString(),
    period: {
      month: range.month,
      from: range.fromDate,
      to: range.toDate,
      basis: "ausn_documents",
    },
    input: {
      month: range.month,
      taxObject,
      bankIncome,
      bankIncomeReturn,
      bankExpense,
      bankExpenseReturn,
      otherExpenses,
      notes,
    },
    documentRows,
    documentTotals,
    dataQuality: {
      realizationRows,
      realizationReports: Math.round(parseNumber(wbRow.realization_reports)),
      firstReportDate: typeof wbRow.first_report_date === "string" ? wbRow.first_report_date : null,
      lastReportDate: typeof wbRow.last_report_date === "string" ? wbRow.last_report_date : null,
      retailWithDiscRows: Math.round(parseNumber(wbRow.retail_with_disc_rows)),
      sppRows: Math.round(parseNumber(wbRow.spp_rows)),
      documentRows: documentRows.length,
      warnings: makeWarnings({
        documentRows: documentRows.length,
        totals: documentTotals,
        realizationRows,
        adCostsObserved,
        deduction,
        penalties,
        manualRows: documentRows.filter((row) => row.documentType.startsWith("manual_")).length,
      }),
    },
    wb: {
      grossSales: roundMoney(parseNumber(wbRow.gross_sales)),
      returns: roundMoney(parseNumber(wbRow.returns)),
      netSales: roundMoney(parseNumber(wbRow.net_sales)),
      retailAmount: roundMoney(parseNumber(wbRow.retail_amount)),
      retailPriceWithDisc: roundMoney(parseNumber(wbRow.retail_price_with_disc)),
      spp: roundMoney(parseNumber(wbRow.spp)),
      payoutBeforeCost: roundMoney(parseNumber(wbRow.payout_before_cost)),
    },
    bank: {
      incomeAlreadyMarked: bankIncome,
      incomeReturnAlreadyMarked: bankIncomeReturn,
      expenseAlreadyMarked: bankExpense,
      expenseReturnAlreadyMarked: bankExpenseReturn,
      netIncomeBase: bankNetIncomeBase,
      netExpenseBase: bankNetExpenseBase,
      notCoveredByBankGross: documentTotals.lkIncome,
      reconciliationDelta: documentTotals.lkNetIncomeBase,
    },
    expenses: {
      commission,
      logistics,
      storage,
      acceptance,
      acquiring,
      paymentSchedule,
      deduction,
      deductionCreditPrincipal,
      deductionCreditInterest,
      cashback,
      penalties,
      additionalPayments,
      netWbExpenses,
      adCostsObserved,
      paidStorageObserved,
    },
    manualEntries: buildManualEntries(documentTotals),
    taxEstimate,
  };
}

export async function saveAusnMonthlyInput(
  tenantId: string,
  input: AusnMonthlyInput & { documentRows?: unknown },
) {
  const range = getMonthRange(input.month);
  const taxObject = normalizeAusnTaxObject(input.taxObject);
  const bankIncome = normalizeMoney(input.bankIncome);
  const bankIncomeReturn = normalizeMoney(input.bankIncomeReturn);
  const bankExpense = normalizeMoney(input.bankExpense);
  const bankExpenseReturn = normalizeMoney(input.bankExpenseReturn);
  const otherExpenses = normalizeMoney(input.otherExpenses);
  const notes = input.notes?.trim() ? input.notes.trim() : null;
  const documentRows = normalizeDocumentRows(input.documentRows);

  await withTenantContext(db, tenantId, async (tx) => {
    await tx.execute(sql`
      INSERT INTO ausn_monthly_inputs (
        tenant_id,
        month,
        tax_object,
        bank_income,
        bank_income_return,
        bank_expense,
        bank_expense_return,
        other_expenses,
        notes,
        updated_at
      )
      VALUES (
        ${tenantId},
        ${range.fromDate}::date,
        ${taxObject},
        ${bankIncome.toFixed(2)},
        ${bankIncomeReturn.toFixed(2)},
        ${bankExpense.toFixed(2)},
        ${bankExpenseReturn.toFixed(2)},
        ${otherExpenses.toFixed(2)},
        ${notes},
        NOW()
      )
      ON CONFLICT (tenant_id, month)
      DO UPDATE SET
        tax_object = EXCLUDED.tax_object,
        bank_income = EXCLUDED.bank_income,
        bank_income_return = EXCLUDED.bank_income_return,
        bank_expense = EXCLUDED.bank_expense,
        bank_expense_return = EXCLUDED.bank_expense_return,
        other_expenses = EXCLUDED.other_expenses,
        notes = EXCLUDED.notes,
        updated_at = NOW();
    `);

    if (documentRows) {
      const documentRowsPayload = documentRows.map((row) => ({
        document_type: row.documentType,
        amount: row.amount,
        title: row.title ?? "",
        document_date: row.documentDate ?? "",
        source: row.source ?? "",
      }));

      await tx.execute(sql`
        DELETE FROM ausn_document_rows
        WHERE tenant_id = ${tenantId}
          AND month = ${range.fromDate}::date;
      `);

      if (documentRowsPayload.length > 0) {
        await tx.execute(sql`
          INSERT INTO ausn_document_rows (
            tenant_id,
            month,
            document_type,
            amount,
            title,
            document_date,
            source,
            updated_at
          )
          SELECT
            ${tenantId},
            ${range.fromDate}::date,
            x.document_type,
            x.amount,
            NULLIF(x.title, ''),
            NULLIF(x.document_date, '')::date,
            NULLIF(x.source, ''),
            NOW()
          FROM jsonb_to_recordset(${JSON.stringify(documentRowsPayload)}::jsonb)
            AS x(document_type text, amount numeric, title text, document_date text, source text);
        `);
      }
    }
  });

  return getAusnMonthlyReconciliation(tenantId, range.month);
}
