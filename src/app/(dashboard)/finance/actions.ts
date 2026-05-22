'use server';

import { asc, desc, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { requireTenantFeatureAccess } from '@/lib/auth/tenant-access';
import { db, withTenantContext, type DrizzleTransaction } from '@/lib/db';
import {
  financeAccounts,
  financeBudgetItems,
  financeCategories,
  financeDebts,
  financeTransactions,
} from '@/lib/db/schema';

export type FinanceAccountType = 'bank' | 'cash' | 'wb_balance' | 'card' | 'loan' | 'other';
export type FinanceCategoryKind = 'income' | 'expense' | 'transfer' | 'asset' | 'liability' | 'equity';
export type FinanceCashflowSection = 'operating' | 'investing' | 'financing' | 'none';
export type FinancePnlSection = 'revenue' | 'cogs' | 'wb_costs' | 'opex' | 'tax' | 'interest' | 'other' | 'none';
export type FinanceOperationType =
  | 'income'
  | 'expense'
  | 'transfer'
  | 'loan_received'
  | 'loan_payment'
  | 'owner_contribution'
  | 'owner_withdrawal';
export type FinanceDebtType = 'loan' | 'supplier_payable' | 'receivable' | 'tax' | 'other';
export type FinanceRecordStatus = 'actual' | 'planned' | 'cancelled';
export type FinanceDebtStatus = 'active' | 'closed' | 'overdue';
export type FinanceBudgetStatus = 'planned' | 'paid' | 'overdue' | 'cancelled';

export type CreateFinanceAccountInput = {
  name: string;
  type: FinanceAccountType;
  openingBalance?: number | null;
  openingBalanceDate?: string | null;
  notes?: string | null;
};

export type CreateFinanceTransactionInput = {
  occurredAt: string;
  economicDate?: string | null;
  operationType: FinanceOperationType;
  status?: FinanceRecordStatus;
  amount: number;
  fromAccountId?: string | null;
  toAccountId?: string | null;
  categoryId?: string | null;
  counterparty?: string | null;
  description?: string | null;
};

export type CreateFinanceDebtInput = {
  name: string;
  debtType: FinanceDebtType;
  counterparty?: string | null;
  principalAmount: number;
  outstandingAmount?: number | null;
  openedAt?: string | null;
  dueAt?: string | null;
  interestRatePercent?: number | null;
  accountId?: string | null;
  notes?: string | null;
};

export type CreateFinanceBudgetItemInput = {
  periodMonth: string;
  name: string;
  direction: 'inflow' | 'outflow';
  plannedAmount: number;
  actualAmount?: number | null;
  categoryId?: string | null;
  accountId?: string | null;
  dueAt?: string | null;
  notes?: string | null;
};

const DEFAULT_ACCOUNTS: Array<{
  name: string;
  type: FinanceAccountType;
  sortOrder: number;
  notes: string;
}> = [
  { name: 'Расчетный счет', type: 'bank', sortOrder: 10, notes: 'Основной банковский счет бизнеса' },
  { name: 'Касса', type: 'cash', sortOrder: 20, notes: 'Наличные деньги' },
  { name: 'Баланс Вайлдберриз', type: 'wb_balance', sortOrder: 30, notes: 'Деньги и удержания на стороне Вайлдберриз' },
];

const DEFAULT_CATEGORIES: Array<{
  name: string;
  kind: FinanceCategoryKind;
  cashflowSection: FinanceCashflowSection;
  pnlSection: FinancePnlSection;
  sortOrder: number;
  color: string;
}> = [
  { name: 'Выплаты Вайлдберриз', kind: 'income', cashflowSection: 'operating', pnlSection: 'revenue', sortOrder: 10, color: 'emerald' },
  { name: 'Прочие продажи', kind: 'income', cashflowSection: 'operating', pnlSection: 'revenue', sortOrder: 20, color: 'emerald' },
  { name: 'Закупка товара', kind: 'expense', cashflowSection: 'operating', pnlSection: 'cogs', sortOrder: 110, color: 'amber' },
  { name: 'Доставка до фулфилмента/Вайлдберриз', kind: 'expense', cashflowSection: 'operating', pnlSection: 'cogs', sortOrder: 120, color: 'amber' },
  { name: 'Упаковка', kind: 'expense', cashflowSection: 'operating', pnlSection: 'cogs', sortOrder: 130, color: 'amber' },
  { name: 'Комиссия Вайлдберриз', kind: 'expense', cashflowSection: 'operating', pnlSection: 'wb_costs', sortOrder: 210, color: 'cyan' },
  { name: 'Логистика Вайлдберриз', kind: 'expense', cashflowSection: 'operating', pnlSection: 'wb_costs', sortOrder: 220, color: 'cyan' },
  { name: 'Хранение Вайлдберриз', kind: 'expense', cashflowSection: 'operating', pnlSection: 'wb_costs', sortOrder: 230, color: 'cyan' },
  { name: 'Реклама Вайлдберриз', kind: 'expense', cashflowSection: 'operating', pnlSection: 'wb_costs', sortOrder: 240, color: 'cyan' },
  { name: 'Зарплаты', kind: 'expense', cashflowSection: 'operating', pnlSection: 'opex', sortOrder: 310, color: 'violet' },
  { name: 'Подрядчики', kind: 'expense', cashflowSection: 'operating', pnlSection: 'opex', sortOrder: 320, color: 'violet' },
  { name: 'Сервисы и подписки', kind: 'expense', cashflowSection: 'operating', pnlSection: 'opex', sortOrder: 330, color: 'violet' },
  { name: 'Аренда', kind: 'expense', cashflowSection: 'operating', pnlSection: 'opex', sortOrder: 340, color: 'violet' },
  { name: 'Контент и съемки', kind: 'expense', cashflowSection: 'operating', pnlSection: 'opex', sortOrder: 350, color: 'violet' },
  { name: 'Налоги', kind: 'expense', cashflowSection: 'operating', pnlSection: 'tax', sortOrder: 410, color: 'lime' },
  { name: 'Проценты по кредитам', kind: 'expense', cashflowSection: 'financing', pnlSection: 'interest', sortOrder: 510, color: 'rose' },
  { name: 'Получение кредита', kind: 'liability', cashflowSection: 'financing', pnlSection: 'none', sortOrder: 610, color: 'slate' },
  { name: 'Погашение тела кредита', kind: 'liability', cashflowSection: 'financing', pnlSection: 'none', sortOrder: 620, color: 'slate' },
  { name: 'Взнос собственника', kind: 'equity', cashflowSection: 'financing', pnlSection: 'none', sortOrder: 710, color: 'slate' },
  { name: 'Вывод собственника', kind: 'equity', cashflowSection: 'financing', pnlSection: 'none', sortOrder: 720, color: 'slate' },
  { name: 'Перевод между счетами', kind: 'transfer', cashflowSection: 'none', pnlSection: 'none', sortOrder: 810, color: 'slate' },
];

function todayDateOnly() {
  return new Date().toISOString().slice(0, 10);
}

function monthStartDateOnly(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
}

function normalizeDateOnly(value: string | null | undefined, fallback = todayDateOnly()) {
  const trimmed = value?.trim() ?? '';
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : fallback;
}

function normalizeMonth(value: string | null | undefined) {
  const trimmed = value?.trim() ?? '';
  if (/^\d{4}-\d{2}$/.test(trimmed)) return `${trimmed}-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return `${trimmed.slice(0, 7)}-01`;
  return monthStartDateOnly();
}

function normalizeTimestamp(value: string | null | undefined) {
  const dateOnly = normalizeDateOnly(value);
  return new Date(`${dateOnly}T12:00:00.000Z`);
}

function toMoney(value: number | null | undefined, fieldName: string, allowNegative = false) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    throw new Error(`${fieldName}: укажите число`);
  }
  if (!allowNegative && value <= 0) {
    throw new Error(`${fieldName}: сумма должна быть больше 0`);
  }
  return (Math.round(value * 100) / 100).toFixed(2);
}

function toOptionalMoney(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return (Math.round(value * 100) / 100).toFixed(2);
}

function cleanText(value: string | null | undefined, max = 255) {
  const trimmed = value?.trim() ?? '';
  return trimmed ? trimmed.slice(0, max) : null;
}

function assertName(value: string | null | undefined, label = 'Название') {
  const name = cleanText(value, 180);
  if (!name) throw new Error(`${label}: заполните поле`);
  return name;
}

function asNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toIsoDate(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const raw = String(value);
  return raw.length >= 10 ? raw.slice(0, 10) : raw;
}

function toIsoTimestamp(value: unknown) {
  if (!value) return new Date().toISOString();
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

async function ensureDefaultFinanceSetup(tx: DrizzleTransaction, tenantId: string) {
  const existingAccounts = await tx
    .select({ id: financeAccounts.id })
    .from(financeAccounts)
    .where(eq(financeAccounts.tenantId, tenantId))
    .limit(1);

  if (existingAccounts.length === 0) {
    await tx.insert(financeAccounts).values(DEFAULT_ACCOUNTS.map((account) => ({
      tenantId,
      name: account.name,
      type: account.type,
      openingBalance: '0.00',
      sortOrder: account.sortOrder,
      notes: account.notes,
    }))).onConflictDoNothing({
      target: [financeAccounts.tenantId, financeAccounts.name],
    });
  }

  await tx.insert(financeCategories).values(DEFAULT_CATEGORIES.map((category) => ({
    tenantId,
    name: category.name,
    kind: category.kind,
    cashflowSection: category.cashflowSection,
    pnlSection: category.pnlSection,
    isSystem: true,
    sortOrder: category.sortOrder,
    color: category.color,
  }))).onConflictDoNothing({
    target: [financeCategories.tenantId, financeCategories.name],
  });
}

function resolveCashflowSection(
  operationType: FinanceOperationType,
  category: { cashflowSection: string } | undefined,
): FinanceCashflowSection {
  if (operationType === 'transfer') return 'none';
  if (
    operationType === 'loan_received'
    || operationType === 'loan_payment'
    || operationType === 'owner_contribution'
    || operationType === 'owner_withdrawal'
  ) {
    return 'financing';
  }
  const section = category?.cashflowSection;
  return section === 'investing' || section === 'financing' || section === 'none'
    ? section
    : 'operating';
}

function externalDirection(operationType: FinanceOperationType): 'inflow' | 'outflow' | 'none' {
  if (operationType === 'income' || operationType === 'loan_received' || operationType === 'owner_contribution') return 'inflow';
  if (operationType === 'expense' || operationType === 'loan_payment' || operationType === 'owner_withdrawal') return 'outflow';
  return 'none';
}

async function assertAccountBelongsToTenant(tx: DrizzleTransaction, tenantId: string, accountId: string | null | undefined) {
  if (!accountId) return;
  const [account] = await tx
    .select({ id: financeAccounts.id })
    .from(financeAccounts)
    .where(eq(financeAccounts.id, accountId))
    .limit(1);
  if (!account) throw new Error('Счет не найден в активном кабинете');
}

async function assertCategoryBelongsToTenant(tx: DrizzleTransaction, tenantId: string, categoryId: string | null | undefined) {
  if (!categoryId) return;
  const [category] = await tx
    .select({ id: financeCategories.id })
    .from(financeCategories)
    .where(eq(financeCategories.id, categoryId))
    .limit(1);
  if (!category) throw new Error('Категория не найдена в активном кабинете');
}

export async function loadFinanceDashboard(tenantId: string) {
  await requireTenantFeatureAccess(tenantId, 'finance', ['owner', 'admin', 'manager', 'viewer']);

  return withTenantContext(db, tenantId, async (tx) => {
    await ensureDefaultFinanceSetup(tx, tenantId);

    const accountsRaw = await tx.select().from(financeAccounts).where(eq(financeAccounts.tenantId, tenantId)).orderBy(asc(financeAccounts.sortOrder), asc(financeAccounts.name));
    const categoriesRaw = await tx.select().from(financeCategories).where(eq(financeCategories.tenantId, tenantId)).orderBy(asc(financeCategories.sortOrder), asc(financeCategories.name));
    const transactionsRaw = await tx.select().from(financeTransactions).where(eq(financeTransactions.tenantId, tenantId)).orderBy(desc(financeTransactions.occurredAt));
    const debtsRaw = await tx.select().from(financeDebts).where(eq(financeDebts.tenantId, tenantId)).orderBy(asc(financeDebts.dueAt), desc(financeDebts.createdAt));
    const budgetRaw = await tx.select().from(financeBudgetItems).where(eq(financeBudgetItems.tenantId, tenantId)).orderBy(desc(financeBudgetItems.periodMonth), asc(financeBudgetItems.dueAt));

    const categoriesById = new Map(categoriesRaw.map((category) => [category.id, category]));
    const balances = new Map(accountsRaw.map((account) => [account.id, asNumber(account.openingBalance)]));
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const cashflow = {
      operating: { inflow: 0, outflow: 0, net: 0 },
      investing: { inflow: 0, outflow: 0, net: 0 },
      financing: { inflow: 0, outflow: 0, net: 0 },
    };
    const pnl = {
      revenue: 0,
      cogs: 0,
      wbCosts: 0,
      opex: 0,
      tax: 0,
      interest: 0,
      other: 0,
      netProfit: 0,
    };

    for (const transaction of transactionsRaw) {
      if (transaction.status !== 'actual') continue;
      const amount = asNumber(transaction.amount);
      if (transaction.fromAccountId) {
        balances.set(transaction.fromAccountId, (balances.get(transaction.fromAccountId) ?? 0) - amount);
      }
      if (transaction.toAccountId) {
        balances.set(transaction.toAccountId, (balances.get(transaction.toAccountId) ?? 0) + amount);
      }

      const occurredAt = transaction.occurredAt instanceof Date
        ? transaction.occurredAt
        : new Date(String(transaction.occurredAt));
      const operationType = transaction.operationType as FinanceOperationType;
      const category = transaction.categoryId ? categoriesById.get(transaction.categoryId) : undefined;

      if (occurredAt >= monthStart) {
        const section = resolveCashflowSection(operationType, category);
        const direction = externalDirection(operationType);
        if (section !== 'none' && direction !== 'none') {
          const bucket = cashflow[section];
          if (direction === 'inflow') bucket.inflow += amount;
          if (direction === 'outflow') bucket.outflow += amount;
          bucket.net = bucket.inflow - bucket.outflow;
        }
      }

      const economicRaw = transaction.economicDate ?? transaction.occurredAt;
      const economicAt = economicRaw instanceof Date ? economicRaw : new Date(String(economicRaw));
      if (economicAt >= monthStart && (operationType === 'income' || operationType === 'expense')) {
        if (operationType === 'income') {
          pnl.revenue += amount;
        } else {
          switch (category?.pnlSection) {
            case 'cogs':
              pnl.cogs += amount;
              break;
            case 'wb_costs':
              pnl.wbCosts += amount;
              break;
            case 'tax':
              pnl.tax += amount;
              break;
            case 'interest':
              pnl.interest += amount;
              break;
            case 'none':
              break;
            case 'opex':
            default:
              pnl.opex += amount;
              break;
          }
        }
      }
    }

    pnl.netProfit = pnl.revenue - pnl.cogs - pnl.wbCosts - pnl.opex - pnl.tax - pnl.interest - pnl.other;

    const today = todayDateOnly();
    const activeDebts = debtsRaw.filter((debt) => debt.status !== 'closed');
    const overdueDebts = activeDebts.filter((debt) => debt.dueAt && String(debt.dueAt).slice(0, 10) < today);
    const activeDebtAmount = activeDebts.reduce((sum, debt) => sum + asNumber(debt.outstandingAmount), 0);
    const currentMonth = monthStartDateOnly();
    const monthBudget = budgetRaw.filter((item) => String(item.periodMonth).slice(0, 10) === currentMonth);
    const plannedInflow = monthBudget
      .filter((item) => item.direction === 'inflow' && item.status !== 'cancelled')
      .reduce((sum, item) => sum + asNumber(item.plannedAmount), 0);
    const plannedOutflow = monthBudget
      .filter((item) => item.direction === 'outflow' && item.status !== 'cancelled')
      .reduce((sum, item) => sum + asNumber(item.plannedAmount), 0);

    const accounts = accountsRaw.map((account) => ({
      id: account.id,
      name: account.name,
      type: account.type as FinanceAccountType,
      currency: account.currency,
      openingBalance: asNumber(account.openingBalance),
      openingBalanceDate: toIsoDate(account.openingBalanceDate),
      balance: balances.get(account.id) ?? 0,
      isActive: account.isActive,
      notes: account.notes,
    }));

    return {
      generatedAt: new Date().toISOString(),
      accounts,
      categories: categoriesRaw.map((category) => ({
        id: category.id,
        name: category.name,
        kind: category.kind as FinanceCategoryKind,
        cashflowSection: category.cashflowSection as FinanceCashflowSection,
        pnlSection: category.pnlSection as FinancePnlSection,
        isSystem: category.isSystem,
        isActive: category.isActive,
        sortOrder: category.sortOrder,
        color: category.color,
      })),
      transactions: transactionsRaw.slice(0, 200).map((transaction) => ({
        id: transaction.id,
        occurredAt: toIsoTimestamp(transaction.occurredAt),
        economicDate: toIsoDate(transaction.economicDate),
        operationType: transaction.operationType as FinanceOperationType,
        status: transaction.status as FinanceRecordStatus,
        amount: asNumber(transaction.amount),
        currency: transaction.currency,
        fromAccountId: transaction.fromAccountId,
        toAccountId: transaction.toAccountId,
        categoryId: transaction.categoryId,
        counterparty: transaction.counterparty,
        description: transaction.description,
        sourceType: transaction.sourceType,
      })),
      debts: debtsRaw.map((debt) => ({
        id: debt.id,
        name: debt.name,
        debtType: debt.debtType as FinanceDebtType,
        status: debt.status as FinanceDebtStatus,
        counterparty: debt.counterparty,
        principalAmount: asNumber(debt.principalAmount),
        outstandingAmount: asNumber(debt.outstandingAmount),
        currency: debt.currency,
        openedAt: toIsoDate(debt.openedAt),
        dueAt: toIsoDate(debt.dueAt),
        interestRatePercent: debt.interestRatePercent === null ? null : asNumber(debt.interestRatePercent),
        accountId: debt.accountId,
        notes: debt.notes,
      })),
      budgetItems: budgetRaw.map((item) => ({
        id: item.id,
        periodMonth: toIsoDate(item.periodMonth),
        name: item.name,
        direction: item.direction as 'inflow' | 'outflow',
        plannedAmount: asNumber(item.plannedAmount),
        actualAmount: asNumber(item.actualAmount),
        categoryId: item.categoryId,
        accountId: item.accountId,
        dueAt: toIsoDate(item.dueAt),
        status: item.status as FinanceBudgetStatus,
        notes: item.notes,
      })),
      summary: {
        totalCash: accounts.reduce((sum, account) => sum + account.balance, 0),
        monthInflow: cashflow.operating.inflow + cashflow.investing.inflow + cashflow.financing.inflow,
        monthOutflow: cashflow.operating.outflow + cashflow.investing.outflow + cashflow.financing.outflow,
        monthNetCashflow: cashflow.operating.net + cashflow.investing.net + cashflow.financing.net,
        monthNetProfit: pnl.netProfit,
        activeDebtAmount,
        overdueDebtCount: overdueDebts.length,
        plannedInflow,
        plannedOutflow,
      },
      cashflow,
      pnl,
    };
  });
}

export async function createFinanceAccount(tenantId: string, input: CreateFinanceAccountInput) {
  await requireTenantFeatureAccess(tenantId, 'finance', ['owner', 'admin', 'manager']);
  const name = assertName(input.name, 'Счет/касса');
  const openingBalance = input.openingBalance === null || input.openingBalance === undefined
    ? '0.00'
    : toMoney(input.openingBalance, 'Начальный остаток', true);

  await withTenantContext(db, tenantId, async (tx) => {
    const [existing] = await tx
      .select({ id: financeAccounts.id })
      .from(financeAccounts)
      .where(eq(financeAccounts.name, name))
      .limit(1);
    if (existing) throw new Error('Счет или касса с таким названием уже есть');

    await tx.insert(financeAccounts).values({
      tenantId,
      name,
      type: input.type,
      openingBalance,
      openingBalanceDate: normalizeDateOnly(input.openingBalanceDate),
      notes: cleanText(input.notes, 1000),
    });
  });

  revalidatePath('/finance');
}

export async function createFinanceTransaction(tenantId: string, input: CreateFinanceTransactionInput) {
  await requireTenantFeatureAccess(tenantId, 'finance', ['owner', 'admin', 'manager']);
  const amount = toMoney(input.amount, 'Сумма');
  const operationType = input.operationType;
  const fromAccountId = input.fromAccountId || null;
  const toAccountId = input.toAccountId || null;
  const categoryId = input.categoryId || null;

  if ((operationType === 'expense' || operationType === 'loan_payment' || operationType === 'owner_withdrawal') && !fromAccountId) {
    throw new Error('Для расхода нужен счет списания');
  }
  if ((operationType === 'income' || operationType === 'loan_received' || operationType === 'owner_contribution') && !toAccountId) {
    throw new Error('Для поступления нужен счет зачисления');
  }
  if (operationType === 'transfer') {
    if (!fromAccountId || !toAccountId) throw new Error('Для перевода нужны оба счета');
    if (fromAccountId === toAccountId) throw new Error('Нельзя переводить на тот же счет');
  }

  await withTenantContext(db, tenantId, async (tx) => {
    await ensureDefaultFinanceSetup(tx, tenantId);
    await assertAccountBelongsToTenant(tx, tenantId, fromAccountId);
    await assertAccountBelongsToTenant(tx, tenantId, toAccountId);
    await assertCategoryBelongsToTenant(tx, tenantId, categoryId);

    await tx.insert(financeTransactions).values({
      tenantId,
      occurredAt: normalizeTimestamp(input.occurredAt),
      economicDate: normalizeDateOnly(input.economicDate || input.occurredAt),
      operationType,
      status: input.status ?? 'actual',
      amount,
      fromAccountId,
      toAccountId,
      categoryId,
      counterparty: cleanText(input.counterparty),
      description: cleanText(input.description, 2000),
      sourceType: 'manual',
    });
  });

  revalidatePath('/finance');
}

export async function cancelFinanceTransaction(tenantId: string, transactionId: string) {
  await requireTenantFeatureAccess(tenantId, 'finance', ['owner', 'admin', 'manager']);

  await withTenantContext(db, tenantId, async (tx) => {
    await tx.update(financeTransactions)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(financeTransactions.id, transactionId));
  });

  revalidatePath('/finance');
}

export async function createFinanceDebt(tenantId: string, input: CreateFinanceDebtInput) {
  await requireTenantFeatureAccess(tenantId, 'finance', ['owner', 'admin', 'manager']);
  const principalAmount = toMoney(input.principalAmount, 'Сумма долга');
  const outstandingAmount = toOptionalMoney(input.outstandingAmount) ?? principalAmount;

  await withTenantContext(db, tenantId, async (tx) => {
    await assertAccountBelongsToTenant(tx, tenantId, input.accountId);
    await tx.insert(financeDebts).values({
      tenantId,
      name: assertName(input.name, 'Долг'),
      debtType: input.debtType,
      counterparty: cleanText(input.counterparty),
      principalAmount,
      outstandingAmount,
      openedAt: normalizeDateOnly(input.openedAt),
      dueAt: input.dueAt ? normalizeDateOnly(input.dueAt) : null,
      interestRatePercent: toOptionalMoney(input.interestRatePercent),
      accountId: input.accountId || null,
      notes: cleanText(input.notes, 1000),
    });
  });

  revalidatePath('/finance');
}

export async function updateFinanceDebtStatus(tenantId: string, debtId: string, status: FinanceDebtStatus) {
  await requireTenantFeatureAccess(tenantId, 'finance', ['owner', 'admin', 'manager']);
  await withTenantContext(db, tenantId, async (tx) => {
    await tx.update(financeDebts)
      .set({ status, updatedAt: new Date() })
      .where(eq(financeDebts.id, debtId));
  });
  revalidatePath('/finance');
}

export async function createFinanceBudgetItem(tenantId: string, input: CreateFinanceBudgetItemInput) {
  await requireTenantFeatureAccess(tenantId, 'finance', ['owner', 'admin', 'manager']);

  await withTenantContext(db, tenantId, async (tx) => {
    await assertAccountBelongsToTenant(tx, tenantId, input.accountId);
    await assertCategoryBelongsToTenant(tx, tenantId, input.categoryId);
    await tx.insert(financeBudgetItems).values({
      tenantId,
      periodMonth: normalizeMonth(input.periodMonth),
      name: assertName(input.name, 'План'),
      direction: input.direction,
      plannedAmount: toMoney(input.plannedAmount, 'Плановая сумма'),
      actualAmount: toOptionalMoney(input.actualAmount) ?? '0.00',
      categoryId: input.categoryId || null,
      accountId: input.accountId || null,
      dueAt: input.dueAt ? normalizeDateOnly(input.dueAt) : null,
      notes: cleanText(input.notes, 1000),
    });
  });

  revalidatePath('/finance');
}

export async function updateFinanceBudgetItemStatus(tenantId: string, itemId: string, status: FinanceBudgetStatus) {
  await requireTenantFeatureAccess(tenantId, 'finance', ['owner', 'admin', 'manager']);
  await withTenantContext(db, tenantId, async (tx) => {
    await tx.update(financeBudgetItems)
      .set({ status, updatedAt: new Date() })
      .where(eq(financeBudgetItems.id, itemId));
  });
  revalidatePath('/finance');
}
