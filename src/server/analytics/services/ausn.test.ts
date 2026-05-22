import { describe, expect, it } from "vitest";

import {
  calculateAusnDocumentTotals,
  calculateAusnTaxEstimate,
  type AusnDocumentRow,
  type AusnDocumentType,
} from "./ausn";

function row(documentType: AusnDocumentType, amount: number): AusnDocumentRow {
  return {
    id: null,
    documentType,
    amount,
    title: null,
    documentDate: null,
    source: null,
  };
}

describe("AUSN reconciliation formulas", () => {
  it("matches the accountant February WB mutual offset", () => {
    const totals = calculateAusnDocumentTotals([
      row("buyout_income", 1771.6),
      row("weekly_withholding", 273_694.38),
      row("detail_income", 481_611.34),
      row("detail_income_return", 18_619),
      row("upd_expense", 254_123.96),
    ]);

    expect(totals.lkIncome).toBe(292_313.38);
    expect(totals.lkIncomeReturn).toBe(18_619);
    expect(totals.lkExpense).toBe(254_123.96);
    expect(totals.lkExpenseReturn).toBe(0);
    expect(totals.lkNetIncomeBase).toBe(273_694.38);
  });

  it("adds non-WB manual operations only to the LC rows", () => {
    const totals = calculateAusnDocumentTotals([
      row("weekly_withholding", 1000),
      row("detail_income_return", 200),
      row("upd_expense", 300),
      row("manual_income", 50),
      row("manual_income_return", 10),
      row("manual_expense", 40),
      row("manual_expense_return", 5),
    ]);

    expect(totals.wbLkIncome).toBe(1200);
    expect(totals.lkIncome).toBe(1250);
    expect(totals.lkIncomeReturn).toBe(210);
    expect(totals.lkExpense).toBe(340);
    expect(totals.lkExpenseReturn).toBe(5);
    expect(totals.lkNetIncomeBase).toBe(1040);
    expect(totals.lkNetExpenseBase).toBe(335);
  });

  it("estimates income-object tax from bank base plus LC mutual offset", () => {
    const totals = calculateAusnDocumentTotals([
      row("weekly_withholding", 273_694.38),
      row("detail_income_return", 18_619),
      row("upd_expense", 254_123.96),
    ]);

    const tax = calculateAusnTaxEstimate({
      taxObject: "income",
      bankIncome: 700_000,
      bankIncomeReturn: 10_000,
      bankExpense: 0,
      bankExpenseReturn: 0,
      otherExpenses: 0,
      documentTotals: totals,
    });

    expect(tax.incomeBase).toBe(963_694.38);
    expect(tax.expenseBase).toBe(0);
    expect(tax.taxToPay).toBe(77_095.55);
  });

  it("uses 20 percent profit tax with 3 percent minimum for income-expenses", () => {
    const totals = calculateAusnDocumentTotals([
      row("weekly_withholding", 1000),
      row("upd_expense", 950),
    ]);

    const tax = calculateAusnTaxEstimate({
      taxObject: "income_expenses",
      bankIncome: 0,
      bankIncomeReturn: 0,
      bankExpense: 0,
      bankExpenseReturn: 0,
      otherExpenses: 0,
      documentTotals: totals,
    });

    expect(tax.regularTax).toBe(10);
    expect(tax.minimumTax).toBe(30);
    expect(tax.taxToPay).toBe(30);
  });
});
