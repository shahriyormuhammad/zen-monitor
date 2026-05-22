export const TAX_REGIME_IDS = [
  'usn_income',
  'usn_income_expenses',
  'ausn_income',
  'ausn_income_expenses',
  'npd_individual',
  'npd_company',
  'esxn',
  'osn_ip',
  'osn_company',
] as const;

export type TaxRegimeId = (typeof TAX_REGIME_IDS)[number];

export type TaxRegimeDefinition = {
  id: TaxRegimeId;
  label: string;
  description: string;
  defaultRate: number;
  base: 'revenue' | 'profit';
  minimumRevenueRate?: number;
  rateHint?: string;
};

export const TAX_REGIMES: TaxRegimeDefinition[] = [
  {
    id: 'usn_income',
    label: 'УСН Доходы',
    description: 'Налог с доходов. Стандартно 6%, региональная льгота может снижать ставку до 1%.',
    defaultRate: 6,
    base: 'revenue',
    rateHint: 'Для льготного региона укажите фактическую ставку вручную, например 1%.',
  },
  {
    id: 'usn_income_expenses',
    label: 'УСН Доходы-Расходы',
    description: 'Налог с прибыли. Стандартно 15%, региональная льгота может снижать ставку до 5%; минимальный налог 1% от доходов сохраняется.',
    defaultRate: 15,
    base: 'profit',
    minimumRevenueRate: 1,
    rateHint: 'Для льготного региона укажите фактическую ставку вручную, например 5%.',
  },
  {
    id: 'ausn_income',
    label: 'АУСН Доходы',
    description: 'АУСН с объектом "доходы" (ставка 8%).',
    defaultRate: 8,
    base: 'revenue',
    rateHint: 'АУСН доступна не всем: лимит 60 млн ₽, до 5 сотрудников, регион эксперимента и уполномоченный банк.',
  },
  {
    id: 'ausn_income_expenses',
    label: 'АУСН Доходы-Расходы',
    description: 'АУСН с объектом "доходы минус расходы" (ставка 20%), минимальный налог 3% от доходов.',
    defaultRate: 20,
    base: 'profit',
    minimumRevenueRate: 3,
    rateHint: 'АУСН доступна не всем: лимит 60 млн ₽, до 5 сотрудников, регион эксперимента и уполномоченный банк.',
  },
  {
    id: 'npd_individual',
    label: 'НПД (физлица)',
    description: 'Налог на профессиональный доход 4% (расчёт от доходов).',
    defaultRate: 4,
    base: 'revenue',
  },
  {
    id: 'npd_company',
    label: 'НПД (юрлица/ИП как покупатели)',
    description: 'Налог на профессиональный доход 6% (расчёт от доходов).',
    defaultRate: 6,
    base: 'revenue',
  },
  {
    id: 'esxn',
    label: 'ЕСХН',
    description: 'Единый сельхозналог 6% от прибыли.',
    defaultRate: 6,
    base: 'profit',
  },
  {
    id: 'osn_ip',
    label: 'ОСНО (ИП, НДФЛ 13-22%)',
    description: 'НДФЛ с прибыли по прогрессивной шкале 13-22%. Для управленческого расчёта укажите эффективную ставку вручную. НДС задаётся отдельно.',
    defaultRate: 13,
    base: 'profit',
    rateHint: 'Если прибыль высокая, 13% может занижать налог. Укажите эффективную ставку НДФЛ под ваш годовой доход.',
  },
  {
    id: 'osn_company',
    label: 'ОСНО (организация, налог на прибыль)',
    description: 'Налог на прибыль 25% от прибыли. НДС задаётся отдельным полем.',
    defaultRate: 25,
    base: 'profit',
    rateHint: 'Для обычного ООО на ОСНО используйте 25%, если у компании нет специальных льгот.',
  },
];

/**
 * Режимы, которые реально применимы для продавца на маркетплейсе WB
 * в текущем продукте: УСН/АУСН/ОСНО.
 * Остальные режимы оставляем в общем справочнике только ради обратной совместимости.
 */
export const WB_TAX_REGIME_IDS = [
  'usn_income',
  'usn_income_expenses',
  'ausn_income',
  'ausn_income_expenses',
  'osn_ip',
  'osn_company',
] as const;

export type WbTaxRegimeId = (typeof WB_TAX_REGIME_IDS)[number];

const WB_TAX_REGIME_ID_SET = new Set<string>(WB_TAX_REGIME_IDS);

export const WB_TAX_REGIMES: TaxRegimeDefinition[] = TAX_REGIMES.filter((regime) =>
  WB_TAX_REGIME_ID_SET.has(regime.id),
);

const TAX_REGIME_MAP = new Map<TaxRegimeId, TaxRegimeDefinition>(
  TAX_REGIMES.map((item) => [item.id, item]),
);

const TAX_TYPE_ALIASES: Record<string, TaxRegimeId> = {
  ausn: 'ausn_income',
  patent: 'usn_income',
};

export function normalizeTaxType(value: string | null | undefined): TaxRegimeId {
  const normalized = (value ?? '').trim().toLowerCase();
  if (normalized in TAX_TYPE_ALIASES) {
    return TAX_TYPE_ALIASES[normalized]!;
  }
  if ((TAX_REGIME_IDS as readonly string[]).includes(normalized)) {
    return normalized as TaxRegimeId;
  }
  return 'usn_income';
}

export function normalizeWbTaxType(value: string | null | undefined): WbTaxRegimeId {
  const normalized = normalizeTaxType(value);
  if (WB_TAX_REGIME_ID_SET.has(normalized)) {
    return normalized as WbTaxRegimeId;
  }
  return 'usn_income';
}

export function getTaxRegimeDefinition(value: string | null | undefined): TaxRegimeDefinition {
  return TAX_REGIME_MAP.get(normalizeTaxType(value)) ?? TAX_REGIME_MAP.get('usn_income')!;
}

export function resolveTaxRatePercent(taxType: string | null | undefined, rawRate: number | string | null | undefined): number {
  const parsed = typeof rawRate === 'number' ? rawRate : Number(rawRate ?? NaN);
  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed;
  }
  return getTaxRegimeDefinition(taxType).defaultRate;
}

export const VAT_MODE_IDS = [
  'none',
  'usn_5',
  'usn_7',
  'general_22',
  'general_10',
  'general_0',
] as const;

export type VatModeId = (typeof VAT_MODE_IDS)[number];

export type VatModeDefinition = {
  id: VatModeId;
  label: string;
  description: string;
  defaultRate: number;
};

export const VAT_MODES: VatModeDefinition[] = [
  {
    id: 'none',
    label: 'Без НДС',
    description: 'УСН с доходом до 20 млн ₽ в 2026 году: освобождение от НДС применяется автоматически.',
    defaultRate: 0,
  },
  {
    id: 'usn_5',
    label: 'УСН + НДС 5%',
    description: 'Для УСН при доходе от 20 до 272,5 млн ₽; без вычета входного НДС.',
    defaultRate: 5,
  },
  {
    id: 'usn_7',
    label: 'УСН + НДС 7%',
    description: 'Для УСН при доходе от 272,5 до 490,5 млн ₽; без вычета входного НДС.',
    defaultRate: 7,
  },
  {
    id: 'general_22',
    label: 'Общая ставка НДС 22%',
    description: 'Общая ставка НДС с правом на вычеты входного НДС, если выбран такой порядок учёта.',
    defaultRate: 22,
  },
  {
    id: 'general_10',
    label: 'Общая ставка НДС 10%',
    description: 'Льготная общая ставка для отдельных категорий товаров с правом на вычеты.',
    defaultRate: 10,
  },
  {
    id: 'general_0',
    label: 'НДС 0%',
    description: 'Нулевая ставка для отдельных операций, если она применима по НК РФ.',
    defaultRate: 0,
  },
];

const VAT_MODE_MAP = new Map<VatModeId, VatModeDefinition>(
  VAT_MODES.map((item) => [item.id, item]),
);

export function normalizeVatMode(value: string | null | undefined): VatModeId {
  const normalized = (value ?? '').trim().toLowerCase();
  if ((VAT_MODE_IDS as readonly string[]).includes(normalized)) {
    return normalized as VatModeId;
  }
  return 'none';
}

export function getVatModeDefinition(value: string | null | undefined): VatModeDefinition {
  return VAT_MODE_MAP.get(normalizeVatMode(value)) ?? VAT_MODE_MAP.get('none')!;
}

export function resolveVatRatePercent(vatMode: string | null | undefined, rawRate: number | string | null | undefined): number {
  const mode = getVatModeDefinition(vatMode);
  if (mode.id === 'none') {
    return 0;
  }

  const parsed = typeof rawRate === 'number' ? rawRate : Number(rawRate ?? NaN);
  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed;
  }

  return mode.defaultRate;
}

export function calculateOutputVatAmount(input: {
  vatMode: string | null | undefined;
  vatRatePercent: number | string | null | undefined;
  revenue: number;
}) {
  const vatMode = normalizeVatMode(input.vatMode);
  const vatRatePercent = resolveVatRatePercent(vatMode, input.vatRatePercent);
  const revenue = Number.isFinite(input.revenue) ? Math.max(0, input.revenue) : 0;

  if (vatMode === 'none' || vatRatePercent <= 0 || revenue <= 0) {
    return {
      vatMode,
      vatRatePercent: 0,
      vatAmount: 0,
    };
  }

  return {
    vatMode,
    vatRatePercent,
    vatAmount: (revenue * vatRatePercent) / (100 + vatRatePercent),
  };
}

export type TaxCalculationInput = {
  taxType: string | null | undefined;
  taxRatePercent: number | string | null | undefined;
  vatMode?: string | null | undefined;
  vatRatePercent?: number | string | null | undefined;
  revenue: number;
  profitBeforeTax: number;
};

export type TaxCalculationResult = {
  regime: TaxRegimeDefinition;
  taxRatePercent: number;
  vatMode: VatModeId;
  vatRatePercent: number;
  vatAmount: number;
  incomeTaxAmount: number;
  taxAmount: number;
  minimumTaxAmount: number;
  incomeTaxBaseRevenue: number;
  profitBeforeTax: number;
  profitBeforeIncomeTax: number;
  netProfit: number;
};

export function calculateTax(input: TaxCalculationInput): TaxCalculationResult {
  const regime = getTaxRegimeDefinition(input.taxType);
  const taxRatePercent = resolveTaxRatePercent(regime.id, input.taxRatePercent);
  const revenue = Number.isFinite(input.revenue) ? Math.max(0, input.revenue) : 0;
  const profitBeforeTax = Number.isFinite(input.profitBeforeTax) ? input.profitBeforeTax : 0;
  const vat = calculateOutputVatAmount({
    vatMode: input.vatMode,
    vatRatePercent: input.vatRatePercent,
    revenue,
  });
  const incomeTaxBaseRevenue = Math.max(0, revenue - vat.vatAmount);
  const profitBeforeIncomeTax = profitBeforeTax - vat.vatAmount;
  const positiveProfit = Math.max(0, profitBeforeIncomeTax);

  const percentTax = (base: number, rate: number) => (base > 0 && rate > 0 ? (base * rate) / 100 : 0);

  let incomeTaxAmount = 0;
  let minimumTaxAmount = 0;

  if (regime.base === 'revenue') {
    incomeTaxAmount = percentTax(incomeTaxBaseRevenue, taxRatePercent);
  } else if (regime.base === 'profit') {
    incomeTaxAmount = percentTax(positiveProfit, taxRatePercent);
    if (regime.minimumRevenueRate && regime.minimumRevenueRate > 0) {
      minimumTaxAmount = percentTax(incomeTaxBaseRevenue, regime.minimumRevenueRate);
      incomeTaxAmount = Math.max(incomeTaxAmount, minimumTaxAmount);
    }
  }

  const taxAmount = incomeTaxAmount + vat.vatAmount;
  const netProfit = profitBeforeTax - taxAmount;

  return {
    regime,
    taxRatePercent,
    vatMode: vat.vatMode,
    vatRatePercent: vat.vatRatePercent,
    vatAmount: vat.vatAmount,
    incomeTaxAmount,
    taxAmount,
    minimumTaxAmount,
    incomeTaxBaseRevenue,
    profitBeforeTax,
    profitBeforeIncomeTax,
    netProfit,
  };
}
