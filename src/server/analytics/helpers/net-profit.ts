import { calculateTax } from '@/lib/tax/regimes';

type ProfitInput = {
  taxType: string | null | undefined;
  taxRatePercent: number | string | null | undefined;
  vatMode: string | null | undefined;
  vatRatePercent: number | string | null | undefined;
  taxBaseRevenue: number;
  operatingProfit: number;
  adSpend: number;
};

type ProfitResult = {
  profitBeforeTax: number;
  taxAmount: number;
  netProfit: number;
};

function safeNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function calculateNetProfitFromOperating(input: ProfitInput): ProfitResult {
  const operatingProfit = safeNumber(input.operatingProfit);
  const adSpend = safeNumber(input.adSpend);
  const taxBaseRevenue = Math.max(0, safeNumber(input.taxBaseRevenue));
  const profitBeforeTax = operatingProfit - adSpend;

  const tax = calculateTax({
    taxType: input.taxType,
    taxRatePercent: input.taxRatePercent,
    vatMode: input.vatMode,
    vatRatePercent: input.vatRatePercent,
    revenue: taxBaseRevenue,
    profitBeforeTax,
  });

  return {
    profitBeforeTax,
    taxAmount: tax.taxAmount,
    netProfit: tax.netProfit,
  };
}
