export function buildTaxAmountSql(input: {
  taxTypeExpr: string;
  taxRateExpr: string;
  vatModeExpr?: string;
  vatRateExpr?: string;
  revenueExpr: string;
  profitBeforeTaxExpr: string;
}) {
  const { taxTypeExpr, taxRateExpr, revenueExpr, profitBeforeTaxExpr } = input;
  const rateExpr = `(COALESCE(${taxRateExpr}, '0')::numeric / 100)`;
  const revenueSafeExpr = `GREATEST(COALESCE(${revenueExpr}, 0), 0)`;
  const vatAmountExpr = buildOutputVatAmountSql({
    vatModeExpr: input.vatModeExpr,
    vatRateExpr: input.vatRateExpr,
    revenueExpr,
  });
  const incomeTaxRevenueExpr = `GREATEST((${revenueSafeExpr}) - (${vatAmountExpr}), 0)`;
  const profitBeforeIncomeTaxExpr = `(COALESCE(${profitBeforeTaxExpr}, 0) - (${vatAmountExpr}))`;
  const positiveProfitExpr = `GREATEST(${profitBeforeIncomeTaxExpr}, 0)`;

  return `((${vatAmountExpr}) + (
    CASE
      WHEN ${taxTypeExpr} IN ('usn_income', 'ausn', 'ausn_income', 'npd_individual', 'npd_company')
        THEN ${incomeTaxRevenueExpr} * ${rateExpr}
      WHEN ${taxTypeExpr} = 'usn_income_expenses'
        THEN GREATEST(${positiveProfitExpr} * ${rateExpr}, ${incomeTaxRevenueExpr} * 0.01)
      WHEN ${taxTypeExpr} = 'ausn_income_expenses'
        THEN GREATEST(${positiveProfitExpr} * ${rateExpr}, ${incomeTaxRevenueExpr} * 0.03)
      WHEN ${taxTypeExpr} IN ('esxn', 'osn_ip', 'osn_company')
        THEN ${positiveProfitExpr} * ${rateExpr}
      ELSE ${incomeTaxRevenueExpr} * ${rateExpr}
    END
  ))`;
}

export function buildOutputVatAmountSql(input: {
  vatModeExpr?: string;
  vatRateExpr?: string;
  revenueExpr: string;
}) {
  const vatModeExpr = input.vatModeExpr ?? "'none'";
  const vatRatePercentExpr = `GREATEST(COALESCE(${input.vatRateExpr ?? "'0'"}, '0')::numeric, 0)`;
  const revenueSafeExpr = `GREATEST(COALESCE(${input.revenueExpr}, 0), 0)`;

  return `
    CASE
      WHEN ${vatModeExpr} IN ('usn_5', 'usn_7', 'general_22', 'general_10', 'general_0') AND ${vatRatePercentExpr} > 0
        THEN ${revenueSafeExpr} * ${vatRatePercentExpr} / (100 + ${vatRatePercentExpr})
      ELSE 0
    END
  `;
}

export function buildNetProfitSql(input: {
  taxTypeExpr: string;
  taxRateExpr: string;
  vatModeExpr?: string;
  vatRateExpr?: string;
  revenueExpr: string;
  profitBeforeTaxExpr: string;
}) {
  const taxAmountSql = buildTaxAmountSql(input);
  return `(COALESCE(${input.profitBeforeTaxExpr}, 0) - (${taxAmountSql}))`;
}
