'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Calculator,
  CheckCircle2,
  Download,
  FileText,
  Loader2,
  RefreshCw,
  Save,
} from 'lucide-react';

import { OperatorState } from '@/components/dashboard/OperatorState';

type TaxObject = 'income' | 'income_expenses';
type DocumentType =
  | 'buyout_income'
  | 'weekly_withholding'
  | 'weekly_withholding_return'
  | 'detail_income'
  | 'detail_income_return'
  | 'upd_expense'
  | 'ukd_expense_return'
  | 'manual_income'
  | 'manual_income_return'
  | 'manual_expense'
  | 'manual_expense_return';

type DocumentRow = {
  id: string | null;
  documentType: DocumentType;
  amount: number;
  title: string | null;
  documentDate: string | null;
  source: string | null;
};

type DocumentTotals = Record<DocumentType, number> & {
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

type AusnReport = {
  generatedAt: string;
  period: {
    month: string;
    from: string;
    to: string;
    basis: 'ausn_documents';
  };
  input: {
    month: string;
    taxObject: TaxObject;
    bankIncome: number;
    bankIncomeReturn: number;
    bankExpense: number;
    bankExpenseReturn: number;
    otherExpenses: number;
    notes: string | null;
  };
  documentRows: DocumentRow[];
  documentTotals: DocumentTotals;
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
  expenses: {
    commission: number;
    logistics: number;
    storage: number;
    acceptance: number;
    acquiring: number;
    paymentSchedule: number;
    deduction: number;
    cashback: number;
    penalties: number;
    additionalPayments: number;
    netWbExpenses: number;
    adCostsObserved: number;
    paidStorageObserved: number;
  };
  manualEntries: Array<{
    kind: 'income' | 'income_return' | 'expense' | 'expense_return';
    title: string;
    amount: number;
    requiredFor: 'income' | 'income_expenses' | 'both';
    details: string;
  }>;
  taxEstimate: {
    taxObject: TaxObject;
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

type AusnSyncSummary = {
  month: string;
  documentsFound: number;
  documentsQueued: number;
  documentRowsSaved: number;
  detailRows: number;
  detailReports: number;
  warnings: Array<{ code: string; message: string }>;
};

const DOCUMENT_SECTIONS: Array<{
  type: DocumentType;
  title: string;
  subtitle: string;
  placeholder: string;
  group: 'wb' | 'manual';
}> = [
  {
    type: 'buyout_income',
    title: 'Уведомления о выкупе',
    subtitle: 'Доход по отчетам. Используется как контрольный блок.',
    placeholder: '792,39\n2 759,62\n668,58',
    group: 'wb',
  },
  {
    type: 'weekly_withholding',
    title: 'Еженедельные отчеты',
    subtitle: 'Удержания. Участвуют в строке «Приход».',
    placeholder: '151 301,43\n215 159,23',
    group: 'wb',
  },
  {
    type: 'weekly_withholding_return',
    title: 'Возврат удержаний',
    subtitle: 'Если в еженедельных отчетах есть возврат удержаний.',
    placeholder: '0',
    group: 'wb',
  },
  {
    type: 'detail_income',
    title: 'Детализация: доходы',
    subtitle: 'Доходы из детализации. Контрольный блок сверки.',
    placeholder: '203 107,78\n216 298,44',
    group: 'wb',
  },
  {
    type: 'detail_income_return',
    title: 'Детализация: возврат доходов',
    subtitle: 'Идет в «Возврат прихода» и добавляется в «Приход».',
    placeholder: '7 607,00\n9 936,00',
    group: 'wb',
  },
  {
    type: 'upd_expense',
    title: 'УПД',
    subtitle: 'Расход для строки ЛК АУСН.',
    placeholder: '27 692,00\n77 053,47',
    group: 'wb',
  },
  {
    type: 'ukd_expense_return',
    title: 'УКД',
    subtitle: 'Возврат расхода. Если УКД нет, оставьте пусто.',
    placeholder: '0',
    group: 'wb',
  },
  {
    type: 'manual_income',
    title: 'Прочий приход',
    subtitle: 'Добавляйте только если банк/ФНС эту операцию не видит.',
    placeholder: '10 000,00 консультация',
    group: 'manual',
  },
  {
    type: 'manual_income_return',
    title: 'Прочий возврат прихода',
    subtitle: 'Возвраты по операциям вне WB, не переданные банком.',
    placeholder: '1 500,00 возврат клиенту',
    group: 'manual',
  },
  {
    type: 'manual_expense',
    title: 'Прочий расход',
    subtitle: 'Расходы вне WB, которые нужно добавить в ЛК вручную.',
    placeholder: '3 000,00 сервис',
    group: 'manual',
  },
  {
    type: 'manual_expense_return',
    title: 'Прочий возврат расхода',
    subtitle: 'Возвраты расходов вне WB, не переданные банком.',
    placeholder: '0',
    group: 'manual',
  },
];

const DOCUMENT_TYPES = DOCUMENT_SECTIONS.map((section) => section.type);
const MONEY_RE = /-?\d[\d\s]*(?:[,.]\d{1,2})?/g;

function currentMonthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function money(value: number) {
  return `${Math.round(value).toLocaleString('ru-RU')} ₽`;
}

function moneyPrecise(value: number) {
  return `${value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`;
}

function formatInputAmount(value: number) {
  return value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function numberInput(value: number) {
  return Number.isFinite(value) && value > 0 ? String(value) : '';
}

function parseMoneyInput(value: string) {
  const normalized = value.replace(/\s/g, '').replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function parseMoneyToken(value: string) {
  const normalized = value.replace(/\s/g, '').replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function emptyTexts(): Record<DocumentType, string> {
  return {
    buyout_income: '',
    weekly_withholding: '',
    weekly_withholding_return: '',
    detail_income: '',
    detail_income_return: '',
    upd_expense: '',
    ukd_expense_return: '',
    manual_income: '',
    manual_income_return: '',
    manual_expense: '',
    manual_expense_return: '',
  };
}

function emptyTotals(): DocumentTotals {
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
    totalIncomeDocuments: 0,
    netIncomeDocuments: 0,
    lkIncome: 0,
    lkIncomeReturn: 0,
    lkExpense: 0,
    lkExpenseReturn: 0,
    lkNetIncomeBase: 0,
    lkNetExpenseBase: 0,
    wbLkIncome: 0,
    wbLkIncomeReturn: 0,
    wbLkExpense: 0,
    wbLkExpenseReturn: 0,
    manualLkIncome: 0,
    manualLkIncomeReturn: 0,
    manualLkExpense: 0,
    manualLkExpenseReturn: 0,
  };
}

function calculateTotals(rows: DocumentRow[]): DocumentTotals {
  const totals = emptyTotals();
  rows.forEach((row) => {
    totals[row.documentType] = Math.round((totals[row.documentType] + row.amount) * 100) / 100;
  });
  totals.totalIncomeDocuments = Math.round((totals.buyout_income + totals.detail_income) * 100) / 100;
  totals.netIncomeDocuments = Math.max(0, Math.round((totals.totalIncomeDocuments - totals.detail_income_return) * 100) / 100);
  totals.wbLkIncome = Math.max(0, Math.round((totals.weekly_withholding - totals.weekly_withholding_return + totals.detail_income_return) * 100) / 100);
  totals.wbLkIncomeReturn = totals.detail_income_return;
  totals.wbLkExpense = totals.upd_expense;
  totals.wbLkExpenseReturn = totals.ukd_expense_return;
  totals.manualLkIncome = totals.manual_income;
  totals.manualLkIncomeReturn = totals.manual_income_return;
  totals.manualLkExpense = totals.manual_expense;
  totals.manualLkExpenseReturn = totals.manual_expense_return;
  totals.lkIncome = Math.max(0, Math.round((totals.wbLkIncome + totals.manualLkIncome) * 100) / 100);
  totals.lkIncomeReturn = Math.round((totals.wbLkIncomeReturn + totals.manualLkIncomeReturn) * 100) / 100;
  totals.lkExpense = Math.round((totals.wbLkExpense + totals.manualLkExpense) * 100) / 100;
  totals.lkExpenseReturn = Math.round((totals.wbLkExpenseReturn + totals.manualLkExpenseReturn) * 100) / 100;
  totals.lkNetIncomeBase = Math.max(0, Math.round((totals.lkIncome - totals.lkIncomeReturn) * 100) / 100);
  totals.lkNetExpenseBase = Math.max(0, Math.round((totals.lkExpense - totals.lkExpenseReturn) * 100) / 100);
  return totals;
}

function rowsToTexts(rows: DocumentRow[]) {
  const texts = emptyTexts();
  DOCUMENT_TYPES.forEach((type) => {
    texts[type] = rows
      .filter((row) => row.documentType === type)
      .map((row) => `${formatInputAmount(row.amount)}${row.title ? ` ${row.title}` : ''}`)
      .join('\n');
  });
  return texts;
}

function cleanTitle(line: string, token: string) {
  return line
    .replace(token, '')
    .replace(/[+=()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500) || null;
}

function parseDocumentText(type: DocumentType, text: string): DocumentRow[] {
  const rows: DocumentRow[] = [];
  text.split(/\n+/).forEach((line, lineIndex) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const matches = trimmed.match(MONEY_RE) ?? [];
    const selected = trimmed.includes('+') ? matches : matches.slice(-1);
    selected.forEach((token, tokenIndex) => {
      const amount = parseMoneyToken(token);
      if (amount <= 0) return;
      rows.push({
        id: null,
        documentType: type,
        amount,
        title: selected.length === 1 ? cleanTitle(trimmed, token) : `Строка ${lineIndex + 1}.${tokenIndex + 1}`,
        documentDate: null,
        source: null,
      });
    });
  });
  return rows;
}

function entryKindLabel(kind: AusnReport['manualEntries'][number]['kind']) {
  if (kind === 'income') return 'Приход';
  if (kind === 'income_return') return 'Возврат прихода';
  if (kind === 'expense') return 'Расход';
  return 'Возврат расхода';
}

function Card({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string;
  hint: string;
  tone?: 'default' | 'good' | 'warn';
}) {
  const toneClass = tone === 'good'
    ? 'text-emerald-700 dark:text-emerald-300'
    : tone === 'warn'
      ? 'text-amber-700 dark:text-amber-300'
      : 'text-slate-950 dark:text-slate-50';

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`mt-2 text-2xl font-extrabold ${toneClass}`}>{value}</p>
      <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">{hint}</p>
    </div>
  );
}

export function AosnPageClient({ tenantId }: { tenantId: string }) {
  const [month, setMonth] = useState(currentMonthValue);
  const [taxObject, setTaxObject] = useState<TaxObject>('income');
  const [bankIncome, setBankIncome] = useState('');
  const [bankIncomeReturn, setBankIncomeReturn] = useState('');
  const [bankExpense, setBankExpense] = useState('');
  const [bankExpenseReturn, setBankExpenseReturn] = useState('');
  const [otherExpenses, setOtherExpenses] = useState('');
  const [notes, setNotes] = useState('');
  const [documentTexts, setDocumentTexts] = useState<Record<DocumentType, string>>(emptyTexts);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncSummary, setSyncSummary] = useState<AusnSyncSummary | null>(null);

  const { data, isLoading, error, refetch } = useQuery<AusnReport, Error>({
    queryKey: ['aosn', tenantId, month],
    queryFn: async () => {
      const response = await fetch(`/api/views/aosn?month=${encodeURIComponent(month)}`, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('Не удалось загрузить расчет АУСН');
      }
      return response.json();
    },
  });

  useEffect(() => {
    if (!data || isDirty) return;
    setTaxObject(data.input.taxObject);
    setBankIncome(numberInput(data.input.bankIncome));
    setBankIncomeReturn(numberInput(data.input.bankIncomeReturn));
    setBankExpense(numberInput(data.input.bankExpense));
    setBankExpenseReturn(numberInput(data.input.bankExpenseReturn));
    setOtherExpenses(numberInput(data.input.otherExpenses));
    setNotes(data.input.notes ?? '');
    setDocumentTexts(rowsToTexts(data.documentRows));
  }, [data, isDirty]);

  const parsedDocumentRows = useMemo(() => (
    DOCUMENT_TYPES.flatMap((type) => parseDocumentText(type, documentTexts[type]))
  ), [documentTexts]);

  const activeTotals = useMemo(() => (
    isDirty ? calculateTotals(parsedDocumentRows) : data?.documentTotals ?? emptyTotals()
  ), [data?.documentTotals, isDirty, parsedDocumentRows]);
  const activeTaxEstimate = useMemo(() => {
    if (!isDirty && data) return data.taxEstimate;
    const bankNetIncome = Math.max(0, parseMoneyInput(bankIncome) - parseMoneyInput(bankIncomeReturn));
    const bankNetExpense = Math.max(0, parseMoneyInput(bankExpense) - parseMoneyInput(bankExpenseReturn));
    const incomeBase = activeTotals.lkNetIncomeBase;
    const totalIncomeBase = Math.round((bankNetIncome + incomeBase) * 100) / 100;
    const expenseBase = taxObject === 'income_expenses'
      ? Math.round((bankNetExpense + activeTotals.lkNetExpenseBase + parseMoneyInput(otherExpenses)) * 100) / 100
      : 0;
    const profitBase = Math.max(0, totalIncomeBase - expenseBase);
    const regularTax = taxObject === 'income_expenses'
      ? Math.round(profitBase * 0.2 * 100) / 100
      : Math.round(totalIncomeBase * 0.08 * 100) / 100;
    const minimumTax = taxObject === 'income_expenses'
      ? Math.round(totalIncomeBase * 0.03 * 100) / 100
      : 0;
    const taxToPay = taxObject === 'income_expenses'
      ? Math.round(Math.max(regularTax, minimumTax) * 100) / 100
      : regularTax;
    return {
      taxObject,
      ratePercent: taxObject === 'income_expenses' ? 20 : 8,
      minimumRatePercent: taxObject === 'income_expenses' ? 3 : null,
      incomeBase: totalIncomeBase,
      expenseBase,
      profitBase,
      regularTax,
      minimumTax,
      taxToPay,
    };
  }, [activeTotals.lkNetExpenseBase, activeTotals.lkNetIncomeBase, bankExpense, bankExpenseReturn, bankIncome, bankIncomeReturn, data, isDirty, otherExpenses, taxObject]);
  const activeTaxToPay = activeTaxEstimate.taxToPay;
  const activeBankNetIncome = useMemo(() => {
    if (!isDirty && data) return data.bank.netIncomeBase;
    return Math.max(0, parseMoneyInput(bankIncome) - parseMoneyInput(bankIncomeReturn));
  }, [bankIncome, bankIncomeReturn, data, isDirty]);
  const activeBankNetExpense = useMemo(() => {
    if (!isDirty && data) return data.bank.netExpenseBase;
    return Math.max(0, parseMoneyInput(bankExpense) - parseMoneyInput(bankExpenseReturn));
  }, [bankExpense, bankExpenseReturn, data, isDirty]);

  const saveInput = async () => {
    setIsSaving(true);
    setSaveError(null);
    try {
      const response = await fetch('/api/views/aosn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          month,
          taxObject,
          bankIncome: parseMoneyInput(bankIncome),
          bankIncomeReturn: parseMoneyInput(bankIncomeReturn),
          bankExpense: parseMoneyInput(bankExpense),
          bankExpenseReturn: parseMoneyInput(bankExpenseReturn),
          otherExpenses: parseMoneyInput(otherExpenses),
          notes,
          documentRows: parsedDocumentRows,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(typeof payload.error === 'string' ? payload.error : 'Не удалось сохранить вводные');
      }
      setIsDirty(false);
      await refetch();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Не удалось сохранить вводные');
    } finally {
      setIsSaving(false);
    }
  };

  const syncFromWb = async () => {
    setIsSyncing(true);
    setSyncError(null);
    setSyncSummary(null);
    try {
      const response = await fetch('/api/views/aosn/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload.error === 'string' ? payload.error : 'Не удалось синхронизировать документы WB');
      }
      setSyncSummary(payload.sync ?? null);
      setIsDirty(false);
      await refetch();
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Не удалось синхронизировать документы WB');
    } finally {
      setIsSyncing(false);
    }
  };

  const updateDocumentText = (type: DocumentType, value: string) => {
    setDocumentTexts((prev) => ({ ...prev, [type]: value }));
    setIsDirty(true);
  };

  let content: React.ReactNode;

  if (isLoading) {
    content = (
      <div className="flex h-[55vh] flex-col items-center justify-center gap-4 text-emerald-600">
        <Loader2 className="h-10 w-10 animate-spin" />
        <p className="font-medium text-slate-500 dark:text-slate-400">Собираем АУСН-сверку по документам...</p>
      </div>
    );
  } else if (error) {
    content = (
      <OperatorState
        icon={Calculator}
        tone="danger"
        title="Не удалось загрузить АУСН"
        description={error.message}
        actionLabel="Повторить"
        action={refetch}
      />
    );
  } else if (!data) {
    content = null;
  } else {
    const manualEntries = isDirty
      ? [
        {
          kind: 'income' as const,
          title: 'Приход',
          amount: activeTotals.lkIncome,
          details: 'WB: удержания - возврат удержаний + возврат доходов. Плюс прочий приход вручную.',
        },
        {
          kind: 'income_return' as const,
          title: 'Возврат прихода',
          amount: activeTotals.lkIncomeReturn,
          details: 'Возврат доходов из детализации WB плюс прочий возврат прихода.',
        },
        {
          kind: 'expense' as const,
          title: 'Расход',
          amount: activeTotals.lkExpense,
          details: 'УПД WB плюс прочий расход вручную.',
        },
        {
          kind: 'expense_return' as const,
          title: 'Возврат расхода',
          amount: activeTotals.lkExpenseReturn,
          details: 'УКД WB плюс прочий возврат расхода.',
        },
      ]
      : data.manualEntries;

    content = (
      <div className="space-y-6">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <div className="grid gap-4 lg:grid-cols-[1fr_1fr_auto_auto]">
            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Месяц</span>
              <input
                type="month"
                value={month}
                onChange={(event) => {
                  setMonth(event.target.value || currentMonthValue());
                  setIsDirty(false);
                }}
                className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </label>
            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Объект</span>
              <select
                value={taxObject}
                onChange={(event) => {
                  setTaxObject(event.target.value as TaxObject);
                  setIsDirty(true);
                }}
                className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                <option value="income">Доходы 8%</option>
                <option value="income_expenses">Доходы-Расходы 20%, минимум 3%</option>
              </select>
            </label>
            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={syncFromWb}
                disabled={isSyncing || isSaving}
                className="inline-flex h-11 items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-white"
              >
                {isSyncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Синхронизировать WB
              </button>
            </div>
            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={saveInput}
                disabled={isSaving || isSyncing}
                className="inline-flex h-11 items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Сохранить
              </button>
              <a
                href={`/api/views/aosn?month=${encodeURIComponent(month)}&format=csv`}
                className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-900"
                title="Скачать CSV"
              >
                <Download className="h-4 w-4" />
              </a>
            </div>
          </div>
          <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/40">
            <div className="flex flex-col justify-between gap-2 md:flex-row md:items-end">
              <div>
                <h2 className="text-sm font-extrabold text-slate-950 dark:text-slate-50">Расчётный счёт / уже есть в АУСН</h2>
                <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">Берите суммы из операций АУСН банка или ФНС. Эти суммы нужны для оценки налога, в строки WB-взаимозачета они не попадут.</p>
              </div>
              <div className="text-sm font-bold text-slate-700 dark:text-slate-200">
                Нетто: {moneyPrecise(activeBankNetIncome)} / {moneyPrecise(activeBankNetExpense)}
              </div>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <label className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Приход банка</span>
                <input
                  value={bankIncome}
                  inputMode="decimal"
                  placeholder="0"
                  onChange={(event) => {
                    setBankIncome(event.target.value);
                    setIsDirty(true);
                  }}
                  className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </label>
              <label className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Возврат прихода</span>
                <input
                  value={bankIncomeReturn}
                  inputMode="decimal"
                  placeholder="0"
                  onChange={(event) => {
                    setBankIncomeReturn(event.target.value);
                    setIsDirty(true);
                  }}
                  className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </label>
              <label className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Расход банка</span>
                <input
                  value={bankExpense}
                  inputMode="decimal"
                  placeholder="0"
                  onChange={(event) => {
                    setBankExpense(event.target.value);
                    setIsDirty(true);
                  }}
                  className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </label>
              <label className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Возврат расхода</span>
                <input
                  value={bankExpenseReturn}
                  inputMode="decimal"
                  placeholder="0"
                  onChange={(event) => {
                    setBankExpenseReturn(event.target.value);
                    setIsDirty(true);
                  }}
                  className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </label>
              <label className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Прочие расходы</span>
                <input
                  value={otherExpenses}
                  inputMode="decimal"
                  placeholder="0"
                  onChange={(event) => {
                    setOtherExpenses(event.target.value);
                    setIsDirty(true);
                  }}
                  className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </label>
            </div>
          </div>
          <textarea
            value={notes}
            onChange={(event) => {
              setNotes(event.target.value);
              setIsDirty(true);
            }}
            placeholder="Заметка по сверке: какие документы вошли, что проверить перед переносом в ЛК"
            className="mt-4 min-h-20 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
          {saveError ? <p className="mt-3 text-sm font-semibold text-rose-600">{saveError}</p> : null}
          {syncError ? <p className="mt-3 text-sm font-semibold text-rose-600">{syncError}</p> : null}
          {syncSummary ? (
            <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-100">
              <p className="font-bold">
                WB sync: документов найдено {syncSummary.documentsFound}, загружено {syncSummary.documentsQueued}, строк сохранено {syncSummary.documentRowsSaved}, строк детализации {syncSummary.detailRows}.
              </p>
              {syncSummary.warnings.map((warning) => (
                <p key={`${warning.code}-${warning.message}`} className="mt-1 text-xs leading-5">{warning.message}</p>
              ))}
            </div>
          ) : null}
          {isDirty ? <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">Есть несохраненные вводные. Итоги ниже уже пересчитаны по черновику, но в базе сохранятся только после нажатия «Сохранить».</p> : null}
        </section>

        {data.dataQuality.warnings.length > 0 && !isDirty ? (
          <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <div className="space-y-1">
                <p className="font-bold">Проверка перед внесением в ЛК</p>
                {data.dataQuality.warnings.map((warning) => (
                  <p key={warning} className="text-sm leading-5">{warning}</p>
                ))}
              </div>
            </div>
          </section>
        ) : (
          <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-100">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5" />
              <p className="text-sm font-semibold">Формула взаимозачета: Приход = Удержания - Возврат удержаний + Возврат доходов.</p>
            </div>
          </section>
        )}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <Card label="Приход в ЛК" value={money(activeTotals.lkIncome)} hint="WB-взаимозачет плюс ручные операции вне WB." tone="good" />
          <Card label="Возврат прихода" value={money(activeTotals.lkIncomeReturn)} hint="Возвраты для строки ЛК." tone="warn" />
          <Card label="Расход в ЛК" value={money(activeTotals.lkExpense)} hint="УПД WB плюс ручные расходы вне WB." />
          <Card label="Возврат расхода" value={money(activeTotals.lkExpenseReturn)} hint="УКД WB плюс ручные возвраты расходов." />
          <Card label="Оценка налога" value={money(activeTaxToPay)} hint="Банк + строки ЛК, по выбранному объекту." tone="good" />
        </section>

        <section className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <div className="border-b border-slate-200 p-5 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-emerald-600" />
              <h2 className="text-lg font-extrabold text-slate-950 dark:text-slate-50">Строки для ЛК АУСН</h2>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900/60 dark:text-slate-400">
                <tr>
                  <th className="px-5 py-3">Тип</th>
                  <th className="px-5 py-3">Операция</th>
                  <th className="px-5 py-3 text-right">Сумма</th>
                  <th className="px-5 py-3">Расчет</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {manualEntries.map((entry) => (
                  <tr key={`${entry.kind}-${entry.title}`} className="align-top">
                    <td className="px-5 py-4 font-semibold text-slate-700 dark:text-slate-200">{entryKindLabel(entry.kind)}</td>
                    <td className="px-5 py-4 font-semibold text-slate-950 dark:text-slate-50">{entry.title}</td>
                    <td className="px-5 py-4 text-right font-bold text-slate-950 dark:text-slate-50">{moneyPrecise(entry.amount)}</td>
                    <td className="px-5 py-4 text-xs leading-5 text-slate-500 dark:text-slate-400">{entry.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-5">
          <div className="xl:col-span-2">
            <h2 className="text-lg font-extrabold text-slate-950 dark:text-slate-50">Документы WB</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
              Основной расчет идет через кнопку синхронизации WB. Эти поля нужны только если WB не отдал документ или бухгалтерская сверка требует временной правки.
            </p>
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            {DOCUMENT_SECTIONS.filter((section) => section.group === 'wb').map((section) => (
              <div key={section.type} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="font-extrabold text-slate-950 dark:text-slate-50">{section.title}</h3>
                    <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{section.subtitle}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Итого</p>
                    <p className="font-extrabold text-slate-950 dark:text-slate-50">{moneyPrecise(activeTotals[section.type])}</p>
                  </div>
                </div>
                <textarea
                  value={documentTexts[section.type]}
                  onChange={(event) => updateDocumentText(section.type, event.target.value)}
                  placeholder={section.placeholder}
                  className="mt-4 min-h-32 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
                <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">Можно вставлять суммы построчно или выражением через плюс.</p>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-5">
          <div>
            <h2 className="text-lg font-extrabold text-slate-950 dark:text-slate-50">Операции вне WB</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
              Добавляйте сюда только операции, которых нет в банковской разметке АУСН. Если банк уже передал операцию в ФНС, оставьте её только в блоке расчетного счета.
            </p>
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            {DOCUMENT_SECTIONS.filter((section) => section.group === 'manual').map((section) => (
              <div key={section.type} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="font-extrabold text-slate-950 dark:text-slate-50">{section.title}</h3>
                    <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{section.subtitle}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Итого</p>
                    <p className="font-extrabold text-slate-950 dark:text-slate-50">{moneyPrecise(activeTotals[section.type])}</p>
                  </div>
                </div>
                <textarea
                  value={documentTexts[section.type]}
                  onChange={(event) => updateDocumentText(section.type, event.target.value)}
                  placeholder={section.placeholder}
                  className="mt-4 min-h-24 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
                <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">Можно вставлять суммы построчно или выражением через плюс.</p>
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950">
            <h2 className="text-lg font-extrabold text-slate-950 dark:text-slate-50">Итоги документов</h2>
            <dl className="mt-5 space-y-3 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-slate-500 dark:text-slate-400">Доходы документов</dt>
                <dd className="font-bold text-slate-950 dark:text-slate-50">{moneyPrecise(activeTotals.totalIncomeDocuments)}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-slate-500 dark:text-slate-400">Доходы минус возвраты</dt>
                <dd className="font-bold text-slate-950 dark:text-slate-50">{moneyPrecise(activeTotals.netIncomeDocuments)}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-slate-500 dark:text-slate-400">Банк: база доходов</dt>
                <dd className="font-bold text-slate-950 dark:text-slate-50">{moneyPrecise(activeBankNetIncome)}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-slate-500 dark:text-slate-400">ЛК: база доходов</dt>
                <dd className="font-bold text-emerald-700 dark:text-emerald-300">{moneyPrecise(activeTotals.lkNetIncomeBase)}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-slate-500 dark:text-slate-400">Банк: база расходов</dt>
                <dd className="font-bold text-slate-950 dark:text-slate-50">{moneyPrecise(activeBankNetExpense)}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-slate-500 dark:text-slate-400">ЛК: база расходов</dt>
                <dd className="font-bold text-slate-950 dark:text-slate-50">{moneyPrecise(activeTotals.lkNetExpenseBase)}</dd>
              </div>
              <div className="flex items-center justify-between gap-4 border-t border-slate-100 pt-3 dark:border-slate-800">
                <dt className="font-semibold text-slate-700 dark:text-slate-200">Итого база доходов</dt>
                <dd className="font-extrabold text-emerald-700 dark:text-emerald-300">{moneyPrecise(activeTaxEstimate.incomeBase)}</dd>
              </div>
              {taxObject === 'income_expenses' ? (
                <div className="flex items-center justify-between gap-4">
                  <dt className="font-semibold text-slate-700 dark:text-slate-200">Итого база расходов</dt>
                  <dd className="font-extrabold text-slate-950 dark:text-slate-50">{moneyPrecise(activeTaxEstimate.expenseBase)}</dd>
                </div>
              ) : null}
              <div className="flex items-center justify-between gap-4">
                <dt className="text-slate-500 dark:text-slate-400">Оценка налога</dt>
                <dd className="font-bold text-slate-950 dark:text-slate-50">{moneyPrecise(activeTaxToPay)}</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950">
            <h2 className="text-lg font-extrabold text-slate-950 dark:text-slate-50">WB API контроль</h2>
            <dl className="mt-5 grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Строк отчета</dt>
                <dd className="mt-1 text-xl font-extrabold text-slate-950 dark:text-slate-50">{data.dataQuality.realizationRows.toLocaleString('ru-RU')}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Отчетов WB</dt>
                <dd className="mt-1 text-xl font-extrabold text-slate-950 dark:text-slate-50">{data.dataQuality.realizationReports.toLocaleString('ru-RU')}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">API доход после СПП</dt>
                <dd className="mt-1 font-semibold text-slate-950 dark:text-slate-50">{moneyPrecise(data.wb.netSales)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">API расходы PnL</dt>
                <dd className="mt-1 font-semibold text-slate-950 dark:text-slate-50">{moneyPrecise(data.expenses.netWbExpenses)}</dd>
              </div>
            </dl>
            <p className="mt-5 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-500 dark:bg-slate-900 dark:text-slate-400">
              Этот блок не участвует в строках ЛК АУСН. Он нужен только как контроль, потому что бухгалтерский взаимозачет считается по документам: уведомления, еженедельные отчеты, детализации, УПД и УКД.
            </p>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 space-y-6 pb-10 duration-500">
      {content}
    </div>
  );
}
