'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import {
  ArrowDownCircle,
  ArrowRightLeft,
  ArrowUpCircle,
  Banknote,
  CalendarDays,
  Check,
  CreditCard,
  Landmark,
  Loader2,
  Plus,
  ReceiptText,
  RefreshCw,
  Wallet,
  X,
} from 'lucide-react';

import {
  cancelFinanceTransaction,
  createFinanceAccount,
  createFinanceBudgetItem,
  createFinanceDebt,
  createFinanceTransaction,
  loadFinanceDashboard,
  updateFinanceBudgetItemStatus,
  updateFinanceDebtStatus,
  type FinanceAccountType,
  type FinanceBudgetStatus,
  type FinanceDebtStatus,
  type FinanceDebtType,
  type FinanceOperationType,
} from './actions';

type FinanceDashboard = Awaited<ReturnType<typeof loadFinanceDashboard>>;
type FinanceTab = 'overview' | 'transactions' | 'accounts' | 'debts' | 'budget';

const TABS: Array<{ id: FinanceTab; label: string }> = [
  { id: 'overview', label: 'Обзор' },
  { id: 'transactions', label: 'Операции' },
  { id: 'accounts', label: 'Счета и кассы' },
  { id: 'debts', label: 'Долги' },
  { id: 'budget', label: 'План-факт' },
];

const ACCOUNT_TYPE_LABEL: Record<FinanceAccountType, string> = {
  bank: 'Банк',
  cash: 'Касса',
  wb_balance: 'Баланс Вайлдберриз',
  card: 'Карта',
  loan: 'Кредитный счет',
  other: 'Другое',
};

const OPERATION_LABEL: Record<FinanceOperationType, string> = {
  income: 'Доход',
  expense: 'Расход',
  transfer: 'Перевод',
  loan_received: 'Получили кредит',
  loan_payment: 'Погасили кредит',
  owner_contribution: 'Взнос собственника',
  owner_withdrawal: 'Вывод собственника',
};

const DEBT_TYPE_LABEL: Record<FinanceDebtType, string> = {
  loan: 'Кредит/займ',
  supplier_payable: 'Поставщику',
  receivable: 'Нам должны',
  tax: 'Налог',
  other: 'Другое',
};

const today = () => new Date().toISOString().slice(0, 10);
const currentMonth = () => today().slice(0, 7);

function money(value: number) {
  return `${Math.round(value).toLocaleString('ru-RU')} ₽`;
}

function moneyPrecise(value: number) {
  return `${value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`;
}

function parseAmount(value: string) {
  const parsed = Number(value.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function accountName(data: FinanceDashboard | null, id: string | null) {
  if (!id) return 'не указан';
  return data?.accounts.find((account) => account.id === id)?.name ?? 'счет не найден';
}

function categoryName(data: FinanceDashboard | null, id: string | null) {
  if (!id) return 'без категории';
  return data?.categories.find((category) => category.id === id)?.name ?? 'категория не найдена';
}

function operationTone(type: FinanceOperationType) {
  if (type === 'income' || type === 'loan_received' || type === 'owner_contribution') {
    return 'text-emerald-700 bg-emerald-500/10 border-emerald-500/25 dark:text-emerald-300';
  }
  if (type === 'transfer') {
    return 'text-sky-700 bg-sky-500/10 border-sky-500/25 dark:text-sky-300';
  }
  return 'text-rose-700 bg-rose-500/10 border-rose-500/25 dark:text-rose-300';
}

function SummaryCard({
  title,
  value,
  detail,
  icon: Icon,
  tone,
}: {
  title: string;
  value: string;
  detail: string;
  icon: typeof Wallet;
  tone: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">{title}</p>
          <p className="mt-2 truncate text-2xl font-black tabular-nums text-foreground">{value}</p>
          <p className="mt-1 truncate text-xs font-medium text-muted-foreground">{detail}</p>
        </div>
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${tone}`}>
          <Icon className="h-5 w-5" />
        </span>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-xs font-semibold text-muted-foreground">
      {label}
      {children}
    </label>
  );
}

const inputClass = 'h-10 rounded-lg border border-border bg-card px-3 text-sm text-foreground outline-none transition-colors focus:border-emerald-500';
const selectClass = `${inputClass} appearance-auto`;
const buttonClass = 'inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-emerald-500 px-4 text-sm font-bold text-white transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60';

export function FinancePageClient({ tenantId }: { tenantId: string }) {
  const [tab, setTab] = useState<FinanceTab>('overview');
  const [data, setData] = useState<FinanceDashboard | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [accountForm, setAccountForm] = useState({
    name: '',
    type: 'cash' as FinanceAccountType,
    openingBalance: '',
    openingBalanceDate: today(),
    notes: '',
  });

  const [transactionForm, setTransactionForm] = useState({
    occurredAt: today(),
    economicDate: today(),
    operationType: 'expense' as FinanceOperationType,
    amount: '',
    fromAccountId: '',
    toAccountId: '',
    categoryId: '',
    counterparty: '',
    description: '',
  });

  const [debtForm, setDebtForm] = useState({
    name: '',
    debtType: 'loan' as FinanceDebtType,
    counterparty: '',
    principalAmount: '',
    outstandingAmount: '',
    openedAt: today(),
    dueAt: '',
    interestRatePercent: '',
    accountId: '',
    notes: '',
  });

  const [budgetForm, setBudgetForm] = useState({
    periodMonth: currentMonth(),
    name: '',
    direction: 'outflow' as 'inflow' | 'outflow',
    plannedAmount: '',
    actualAmount: '',
    categoryId: '',
    accountId: '',
    dueAt: '',
    notes: '',
  });

  const activeAccounts = useMemo(
    () => data?.accounts.filter((account) => account.isActive) ?? [],
    [data],
  );

  const activeCategories = useMemo(
    () => data?.categories.filter((category) => category.isActive) ?? [],
    [data],
  );

  const filteredCategories = useMemo(() => {
    const type = transactionForm.operationType;
    if (type === 'income') return activeCategories.filter((category) => category.kind === 'income');
    if (type === 'expense') return activeCategories.filter((category) => category.kind === 'expense');
    if (type === 'transfer') return activeCategories.filter((category) => category.kind === 'transfer');
    if (type === 'loan_received' || type === 'loan_payment') return activeCategories.filter((category) => category.kind === 'liability');
    return activeCategories.filter((category) => category.kind === 'equity');
  }, [activeCategories, transactionForm.operationType]);

  const refresh = () => {
    setIsLoading(true);
    loadFinanceDashboard(tenantId)
      .then((payload) => {
        setData(payload);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Не удалось загрузить финансы'))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  useEffect(() => {
    const firstAccount = activeAccounts[0]?.id ?? '';
    setTransactionForm((prev) => ({
      ...prev,
      fromAccountId: prev.fromAccountId || firstAccount,
      toAccountId: prev.toAccountId || firstAccount,
    }));
    setDebtForm((prev) => ({ ...prev, accountId: prev.accountId || firstAccount }));
    setBudgetForm((prev) => ({ ...prev, accountId: prev.accountId || firstAccount }));
  }, [activeAccounts]);

  useEffect(() => {
    setTransactionForm((prev) => ({
      ...prev,
      categoryId: filteredCategories.some((category) => category.id === prev.categoryId)
        ? prev.categoryId
        : (filteredCategories[0]?.id ?? ''),
    }));
  }, [filteredCategories]);

  const runAction = (action: () => Promise<void>, success: string) => {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      try {
        await action();
        setMessage(success);
        refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Операция не выполнена');
      }
    });
  };

  const addAccount = () => runAction(async () => {
    await createFinanceAccount(tenantId, {
      name: accountForm.name,
      type: accountForm.type,
      openingBalance: accountForm.openingBalance ? parseAmount(accountForm.openingBalance) : 0,
      openingBalanceDate: accountForm.openingBalanceDate,
      notes: accountForm.notes || null,
    });
    setAccountForm({ name: '', type: 'cash', openingBalance: '', openingBalanceDate: today(), notes: '' });
  }, 'Счет добавлен');

  const addTransaction = () => runAction(async () => {
    await createFinanceTransaction(tenantId, {
      occurredAt: transactionForm.occurredAt,
      economicDate: transactionForm.economicDate,
      operationType: transactionForm.operationType,
      amount: parseAmount(transactionForm.amount),
      fromAccountId: transactionForm.fromAccountId || null,
      toAccountId: transactionForm.toAccountId || null,
      categoryId: transactionForm.categoryId || null,
      counterparty: transactionForm.counterparty || null,
      description: transactionForm.description || null,
    });
    setTransactionForm((prev) => ({
      ...prev,
      amount: '',
      counterparty: '',
      description: '',
    }));
  }, 'Операция записана');

  const addDebt = () => runAction(async () => {
    await createFinanceDebt(tenantId, {
      name: debtForm.name,
      debtType: debtForm.debtType,
      counterparty: debtForm.counterparty || null,
      principalAmount: parseAmount(debtForm.principalAmount),
      outstandingAmount: debtForm.outstandingAmount ? parseAmount(debtForm.outstandingAmount) : null,
      openedAt: debtForm.openedAt,
      dueAt: debtForm.dueAt || null,
      interestRatePercent: debtForm.interestRatePercent ? parseAmount(debtForm.interestRatePercent) : null,
      accountId: debtForm.accountId || null,
      notes: debtForm.notes || null,
    });
    setDebtForm({
      name: '',
      debtType: 'loan',
      counterparty: '',
      principalAmount: '',
      outstandingAmount: '',
      openedAt: today(),
      dueAt: '',
      interestRatePercent: '',
      accountId: activeAccounts[0]?.id ?? '',
      notes: '',
    });
  }, 'Долг добавлен');

  const addBudgetItem = () => runAction(async () => {
    await createFinanceBudgetItem(tenantId, {
      periodMonth: budgetForm.periodMonth,
      name: budgetForm.name,
      direction: budgetForm.direction,
      plannedAmount: parseAmount(budgetForm.plannedAmount),
      actualAmount: budgetForm.actualAmount ? parseAmount(budgetForm.actualAmount) : null,
      categoryId: budgetForm.categoryId || null,
      accountId: budgetForm.accountId || null,
      dueAt: budgetForm.dueAt || null,
      notes: budgetForm.notes || null,
    });
    setBudgetForm((prev) => ({
      ...prev,
      name: '',
      plannedAmount: '',
      actualAmount: '',
      dueAt: '',
      notes: '',
    }));
  }, 'План добавлен');

  const hasAccounts = activeAccounts.length > 0;

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 space-y-5 pb-10 duration-500">
      <div className="flex justify-end">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={refresh}
            disabled={isLoading || isPending}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-bold text-foreground hover:bg-muted disabled:opacity-60"
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Обновить
          </button>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto rounded-2xl border border-border bg-card p-2 shadow-sm">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`h-10 shrink-0 rounded-xl px-4 text-sm font-black transition-colors ${
              tab === item.id
                ? 'bg-emerald-500 text-white shadow-sm'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="flex items-start gap-2 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm font-semibold text-rose-700 dark:text-rose-300">
          <X className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      ) : null}

      {message ? (
        <div className="flex items-start gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
          <Check className="mt-0.5 h-4 w-4 shrink-0" />
          {message}
        </div>
      ) : null}

      {isLoading && !data ? (
        <div className="flex min-h-[360px] items-center justify-center rounded-2xl border border-border bg-card text-sm font-semibold text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Загружаю финансы
        </div>
      ) : null}

      {data && tab === 'overview' ? (
        <div className="space-y-5">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <SummaryCard
              title="Деньги сейчас"
              value={money(data.summary.totalCash)}
              detail={`${data.accounts.length} счетов и касс`}
              icon={Wallet}
              tone="bg-emerald-500/12 text-emerald-600"
            />
            <SummaryCard
              title="ДДС месяц"
              value={money(data.summary.monthNetCashflow)}
              detail={`+${money(data.summary.monthInflow)} / -${money(data.summary.monthOutflow)}`}
              icon={ArrowRightLeft}
              tone="bg-sky-500/12 text-sky-600"
            />
            <SummaryCard
              title="Прибыль и убытки"
              value={money(data.summary.monthNetProfit)}
              detail={`Доход ${money(data.pnl.revenue)}`}
              icon={ReceiptText}
              tone="bg-violet-500/12 text-violet-600"
            />
            <SummaryCard
              title="Долги"
              value={money(data.summary.activeDebtAmount)}
              detail={data.summary.overdueDebtCount > 0 ? `Просрочено: ${data.summary.overdueDebtCount}` : 'Без просрочки'}
              icon={CreditCard}
              tone="bg-rose-500/12 text-rose-600"
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
            <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-black text-foreground">ДДС</h2>
                <span className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">Текущий месяц</span>
              </div>
              <div className="space-y-2">
                {(['operating', 'investing', 'financing'] as const).map((section) => {
                  const labels = {
                    operating: 'Операционная деятельность',
                    investing: 'Инвестиции',
                    financing: 'Кредиты и собственник',
                  };
                  const row = data.cashflow[section];
                  return (
                    <div key={section} className="grid grid-cols-[1fr_auto] gap-3 rounded-xl border border-border/70 bg-muted/30 p-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-foreground">{labels[section]}</p>
                        <p className="mt-1 text-xs font-medium text-muted-foreground">
                          Приход {money(row.inflow)} · расход {money(row.outflow)}
                        </p>
                      </div>
                      <p className={`text-right text-sm font-black tabular-nums ${row.net >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {money(row.net)}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-black text-foreground">Прибыль и убытки</h2>
                <span className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">Управленчески</span>
              </div>
              <div className="space-y-2">
                {[
                  ['Выручка', data.pnl.revenue, 'plus'],
                  ['Себестоимость', -data.pnl.cogs, 'minus'],
                  ['Расходы Вайлдберриз', -data.pnl.wbCosts, 'minus'],
                  ['Операционные расходы', -data.pnl.opex, 'minus'],
                  ['Налоги', -data.pnl.tax, 'minus'],
                  ['Проценты', -data.pnl.interest, 'minus'],
                ].map(([label, value]) => (
                  <div key={String(label)} className="flex items-center justify-between gap-3 border-b border-border/60 py-2 last:border-0">
                    <span className="text-sm font-semibold text-muted-foreground">{label}</span>
                    <span className={`text-sm font-black tabular-nums ${Number(value) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {money(Number(value))}
                    </span>
                  </div>
                ))}
                <div className="mt-3 flex items-center justify-between rounded-xl bg-foreground px-3 py-2 text-background">
                  <span className="text-sm font-black">Чистая прибыль</span>
                  <span className="text-sm font-black tabular-nums">{money(data.pnl.netProfit)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
            <AccountsList data={data} />
            <RecentTransactions data={data} tenantId={tenantId} onAction={runAction} />
          </div>
        </div>
      ) : null}

      {data && tab === 'transactions' ? (
        <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <h2 className="mb-4 text-lg font-black text-foreground">Новая операция</h2>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Дата денег">
                  <input className={inputClass} type="date" value={transactionForm.occurredAt} onChange={(e) => setTransactionForm((p) => ({ ...p, occurredAt: e.target.value }))} />
                </Field>
                <Field label="Дата прибыли">
                  <input className={inputClass} type="date" value={transactionForm.economicDate} onChange={(e) => setTransactionForm((p) => ({ ...p, economicDate: e.target.value }))} />
                </Field>
              </div>
              <Field label="Тип">
                <select className={selectClass} value={transactionForm.operationType} onChange={(e) => setTransactionForm((p) => ({ ...p, operationType: e.target.value as FinanceOperationType }))}>
                  {Object.entries(OPERATION_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </Field>
              <Field label="Сумма">
                <input className={`${inputClass} text-right tabular-nums`} inputMode="decimal" value={transactionForm.amount} onChange={(e) => setTransactionForm((p) => ({ ...p, amount: e.target.value }))} placeholder="0,00" />
              </Field>
              {transactionForm.operationType !== 'income' && transactionForm.operationType !== 'loan_received' && transactionForm.operationType !== 'owner_contribution' ? (
                <Field label="Списать со счета">
                  <select className={selectClass} value={transactionForm.fromAccountId} onChange={(e) => setTransactionForm((p) => ({ ...p, fromAccountId: e.target.value }))}>
                    {activeAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                  </select>
                </Field>
              ) : null}
              {transactionForm.operationType !== 'expense' && transactionForm.operationType !== 'loan_payment' && transactionForm.operationType !== 'owner_withdrawal' ? (
                <Field label="Зачислить на счет">
                  <select className={selectClass} value={transactionForm.toAccountId} onChange={(e) => setTransactionForm((p) => ({ ...p, toAccountId: e.target.value }))}>
                    {activeAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                  </select>
                </Field>
              ) : null}
              <Field label="Категория">
                <select className={selectClass} value={transactionForm.categoryId} onChange={(e) => setTransactionForm((p) => ({ ...p, categoryId: e.target.value }))}>
                  {filteredCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </select>
              </Field>
              <Field label="Контрагент">
                <input className={inputClass} value={transactionForm.counterparty} onChange={(e) => setTransactionForm((p) => ({ ...p, counterparty: e.target.value }))} placeholder="Поставщик, банк, подрядчик" />
              </Field>
              <Field label="Комментарий">
                <textarea className="min-h-20 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-emerald-500" value={transactionForm.description} onChange={(e) => setTransactionForm((p) => ({ ...p, description: e.target.value }))} />
              </Field>
              <button type="button" disabled={isPending || !hasAccounts} onClick={addTransaction} className={buttonClass}>
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Записать
              </button>
            </div>
          </div>
          <RecentTransactions data={data} tenantId={tenantId} onAction={runAction} expanded />
        </div>
      ) : null}

      {data && tab === 'accounts' ? (
        <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <h2 className="mb-4 text-lg font-black text-foreground">Новый счет или касса</h2>
            <div className="space-y-3">
              <Field label="Название">
                <input className={inputClass} value={accountForm.name} onChange={(e) => setAccountForm((p) => ({ ...p, name: e.target.value }))} placeholder="Касса Арбат, Точка, Наличные" />
              </Field>
              <Field label="Тип">
                <select className={selectClass} value={accountForm.type} onChange={(e) => setAccountForm((p) => ({ ...p, type: e.target.value as FinanceAccountType }))}>
                  {Object.entries(ACCOUNT_TYPE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Начальный остаток">
                  <input className={`${inputClass} text-right tabular-nums`} inputMode="decimal" value={accountForm.openingBalance} onChange={(e) => setAccountForm((p) => ({ ...p, openingBalance: e.target.value }))} placeholder="0,00" />
                </Field>
                <Field label="Дата остатка">
                  <input className={inputClass} type="date" value={accountForm.openingBalanceDate} onChange={(e) => setAccountForm((p) => ({ ...p, openingBalanceDate: e.target.value }))} />
                </Field>
              </div>
              <Field label="Заметки">
                <textarea className="min-h-20 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-emerald-500" value={accountForm.notes} onChange={(e) => setAccountForm((p) => ({ ...p, notes: e.target.value }))} />
              </Field>
              <button type="button" disabled={isPending} onClick={addAccount} className={buttonClass}>
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Добавить
              </button>
            </div>
          </div>
          <AccountsList data={data} expanded />
        </div>
      ) : null}

      {data && tab === 'debts' ? (
        <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <h2 className="mb-4 text-lg font-black text-foreground">Новый долг</h2>
            <div className="space-y-3">
              <Field label="Название">
                <input className={inputClass} value={debtForm.name} onChange={(e) => setDebtForm((p) => ({ ...p, name: e.target.value }))} placeholder="Кредит оборотка, поставщик Yiwu" />
              </Field>
              <Field label="Тип">
                <select className={selectClass} value={debtForm.debtType} onChange={(e) => setDebtForm((p) => ({ ...p, debtType: e.target.value as FinanceDebtType }))}>
                  {Object.entries(DEBT_TYPE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </Field>
              <Field label="Контрагент">
                <input className={inputClass} value={debtForm.counterparty} onChange={(e) => setDebtForm((p) => ({ ...p, counterparty: e.target.value }))} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Первоначально">
                  <input className={`${inputClass} text-right tabular-nums`} inputMode="decimal" value={debtForm.principalAmount} onChange={(e) => setDebtForm((p) => ({ ...p, principalAmount: e.target.value }))} />
                </Field>
                <Field label="Осталось">
                  <input className={`${inputClass} text-right tabular-nums`} inputMode="decimal" value={debtForm.outstandingAmount} onChange={(e) => setDebtForm((p) => ({ ...p, outstandingAmount: e.target.value }))} placeholder="если пусто, равно сумме" />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Дата открытия">
                  <input className={inputClass} type="date" value={debtForm.openedAt} onChange={(e) => setDebtForm((p) => ({ ...p, openedAt: e.target.value }))} />
                </Field>
                <Field label="Срок">
                  <input className={inputClass} type="date" value={debtForm.dueAt} onChange={(e) => setDebtForm((p) => ({ ...p, dueAt: e.target.value }))} />
                </Field>
              </div>
              <Field label="Процент годовых">
                <input className={`${inputClass} text-right tabular-nums`} inputMode="decimal" value={debtForm.interestRatePercent} onChange={(e) => setDebtForm((p) => ({ ...p, interestRatePercent: e.target.value }))} placeholder="0" />
              </Field>
              <button type="button" disabled={isPending} onClick={addDebt} className={buttonClass}>
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Добавить долг
              </button>
            </div>
          </div>
          <DebtsList data={data} tenantId={tenantId} onAction={runAction} />
        </div>
      ) : null}

      {data && tab === 'budget' ? (
        <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <h2 className="mb-4 text-lg font-black text-foreground">Плановая строка</h2>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Месяц">
                  <input className={inputClass} type="month" value={budgetForm.periodMonth} onChange={(e) => setBudgetForm((p) => ({ ...p, periodMonth: e.target.value }))} />
                </Field>
                <Field label="Направление">
                  <select className={selectClass} value={budgetForm.direction} onChange={(e) => setBudgetForm((p) => ({ ...p, direction: e.target.value as 'inflow' | 'outflow' }))}>
                    <option value="inflow">Приход</option>
                    <option value="outflow">Расход</option>
                  </select>
                </Field>
              </div>
              <Field label="Название">
                <input className={inputClass} value={budgetForm.name} onChange={(e) => setBudgetForm((p) => ({ ...p, name: e.target.value }))} placeholder="Оплата поставщику, налог, кредит" />
              </Field>
              <Field label="Плановая сумма">
                <input className={`${inputClass} text-right tabular-nums`} inputMode="decimal" value={budgetForm.plannedAmount} onChange={(e) => setBudgetForm((p) => ({ ...p, plannedAmount: e.target.value }))} />
              </Field>
              <Field label="Категория">
                <select className={selectClass} value={budgetForm.categoryId} onChange={(e) => setBudgetForm((p) => ({ ...p, categoryId: e.target.value }))}>
                  <option value="">Без категории</option>
                  {activeCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </select>
              </Field>
              <Field label="Счет">
                <select className={selectClass} value={budgetForm.accountId} onChange={(e) => setBudgetForm((p) => ({ ...p, accountId: e.target.value }))}>
                  <option value="">Не выбран</option>
                  {activeAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                </select>
              </Field>
              <Field label="Срок">
                <input className={inputClass} type="date" value={budgetForm.dueAt} onChange={(e) => setBudgetForm((p) => ({ ...p, dueAt: e.target.value }))} />
              </Field>
              <button type="button" disabled={isPending} onClick={addBudgetItem} className={buttonClass}>
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Добавить план
              </button>
            </div>
          </div>
          <BudgetList data={data} tenantId={tenantId} onAction={runAction} />
        </div>
      ) : null}
    </div>
  );
}

function AccountsList({ data, expanded = false }: { data: FinanceDashboard; expanded?: boolean }) {
  const visible = expanded ? data.accounts : data.accounts.slice(0, 6);
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-black text-foreground">Счета и кассы</h2>
        <span className="text-xs font-bold text-muted-foreground">{data.accounts.length} шт</span>
      </div>
      <div className="space-y-2">
        {visible.map((account) => {
          const Icon = account.type === 'cash' ? Banknote : account.type === 'wb_balance' ? Landmark : Wallet;
          return (
            <div key={account.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-xl border border-border/70 bg-muted/30 p-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600">
                <Icon className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-foreground">{account.name}</p>
                <p className="truncate text-xs font-medium text-muted-foreground">{ACCOUNT_TYPE_LABEL[account.type]} · старт {moneyPrecise(account.openingBalance)}</p>
              </div>
              <p className="text-right text-sm font-black tabular-nums text-foreground">{moneyPrecise(account.balance)}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RecentTransactions({
  data,
  tenantId,
  onAction,
  expanded = false,
}: {
  data: FinanceDashboard;
  tenantId: string;
  onAction: (action: () => Promise<void>, success: string) => void;
  expanded?: boolean;
}) {
  const rows = expanded ? data.transactions : data.transactions.slice(0, 8);
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-black text-foreground">Операции</h2>
        <span className="text-xs font-bold text-muted-foreground">{data.transactions.length} записей</span>
      </div>
      <div className="space-y-2">
        {rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm font-semibold text-muted-foreground">
            Операций пока нет
          </div>
        ) : rows.map((transaction) => {
          const direction = transaction.operationType === 'income' || transaction.operationType === 'loan_received' || transaction.operationType === 'owner_contribution'
            ? 'in'
            : transaction.operationType === 'transfer'
              ? 'transfer'
              : 'out';
          const Icon = direction === 'in' ? ArrowDownCircle : direction === 'out' ? ArrowUpCircle : ArrowRightLeft;
          return (
            <div key={transaction.id} className={`grid gap-3 rounded-xl border p-3 ${transaction.status === 'cancelled' ? 'border-border bg-muted/30 opacity-60' : 'border-border/70 bg-muted/30'} lg:grid-cols-[auto_1fr_auto_auto] lg:items-center`}>
              <span className={`flex h-10 w-10 items-center justify-center rounded-xl border ${operationTone(transaction.operationType)}`}>
                <Icon className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-black text-foreground">{OPERATION_LABEL[transaction.operationType]}</p>
                  <span className="rounded-full bg-background px-2 py-0.5 text-[11px] font-bold text-muted-foreground">
                    {new Date(transaction.occurredAt).toLocaleDateString('ru-RU')}
                  </span>
                  {transaction.status === 'cancelled' ? (
                    <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[11px] font-bold text-rose-600">отменено</span>
                  ) : null}
                </div>
                <p className="mt-1 truncate text-xs font-medium text-muted-foreground">
                  {transaction.operationType === 'transfer'
                    ? `${accountName(data, transaction.fromAccountId)} → ${accountName(data, transaction.toAccountId)}`
                    : `${categoryName(data, transaction.categoryId)} · ${transaction.counterparty || 'контрагент не указан'}`}
                </p>
                {transaction.description ? <p className="mt-1 truncate text-xs text-muted-foreground">{transaction.description}</p> : null}
              </div>
              <p className={`text-right text-sm font-black tabular-nums ${direction === 'out' ? 'text-rose-600' : direction === 'in' ? 'text-emerald-600' : 'text-sky-600'}`}>
                {direction === 'out' ? '-' : direction === 'in' ? '+' : ''}
                {moneyPrecise(transaction.amount)}
              </p>
              {transaction.status !== 'cancelled' ? (
                <button
                  type="button"
                  onClick={() => onAction(() => cancelFinanceTransaction(tenantId, transaction.id), 'Операция отменена')}
                  className="inline-flex h-8 items-center justify-center rounded-lg border border-border px-3 text-xs font-bold text-muted-foreground hover:bg-background hover:text-foreground"
                >
                  Отменить
                </button>
              ) : <span />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DebtsList({
  data,
  tenantId,
  onAction,
}: {
  data: FinanceDashboard;
  tenantId: string;
  onAction: (action: () => Promise<void>, success: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-black text-foreground">Долги и обязательства</h2>
        <span className="text-xs font-bold text-muted-foreground">{data.debts.length} записей</span>
      </div>
      <div className="space-y-2">
        {data.debts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm font-semibold text-muted-foreground">
            Долгов пока нет
          </div>
        ) : data.debts.map((debt) => (
          <div key={debt.id} className="grid gap-3 rounded-xl border border-border/70 bg-muted/30 p-3 lg:grid-cols-[1fr_auto_auto] lg:items-center">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-black text-foreground">{debt.name}</p>
                <span className="rounded-full bg-background px-2 py-0.5 text-[11px] font-bold text-muted-foreground">{DEBT_TYPE_LABEL[debt.debtType]}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${debt.status === 'closed' ? 'bg-emerald-500/10 text-emerald-600' : debt.status === 'overdue' ? 'bg-rose-500/10 text-rose-600' : 'bg-amber-500/10 text-amber-600'}`}>
                  {debt.status === 'closed' ? 'закрыт' : debt.status === 'overdue' ? 'просрочен' : 'активен'}
                </span>
              </div>
              <p className="mt-1 truncate text-xs font-medium text-muted-foreground">
                {debt.counterparty || 'контрагент не указан'} · срок {debt.dueAt ? new Date(debt.dueAt).toLocaleDateString('ru-RU') : 'не указан'}
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm font-black tabular-nums text-foreground">{moneyPrecise(debt.outstandingAmount)}</p>
              <p className="text-xs font-medium text-muted-foreground">из {moneyPrecise(debt.principalAmount)}</p>
            </div>
            <div className="flex gap-2 lg:justify-end">
              {debt.status !== 'closed' ? (
                <button type="button" onClick={() => onAction(() => updateFinanceDebtStatus(tenantId, debt.id, 'closed' as FinanceDebtStatus), 'Долг закрыт')} className="h-8 rounded-lg border border-border px-3 text-xs font-bold hover:bg-background">
                  Закрыть
                </button>
              ) : null}
              {debt.status === 'active' ? (
                <button type="button" onClick={() => onAction(() => updateFinanceDebtStatus(tenantId, debt.id, 'overdue' as FinanceDebtStatus), 'Долг помечен просроченным')} className="h-8 rounded-lg border border-border px-3 text-xs font-bold hover:bg-background">
                  Просрочка
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BudgetList({
  data,
  tenantId,
  onAction,
}: {
  data: FinanceDashboard;
  tenantId: string;
  onAction: (action: () => Promise<void>, success: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-black text-foreground">План-факт</h2>
        <span className="inline-flex items-center gap-1 text-xs font-bold text-muted-foreground">
          <CalendarDays className="h-3.5 w-3.5" />
          {data.budgetItems.length} строк
        </span>
      </div>
      <div className="space-y-2">
        {data.budgetItems.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm font-semibold text-muted-foreground">
            Плановых строк пока нет
          </div>
        ) : data.budgetItems.map((item) => {
          const delta = item.actualAmount - item.plannedAmount;
          return (
            <div key={item.id} className="grid gap-3 rounded-xl border border-border/70 bg-muted/30 p-3 lg:grid-cols-[1fr_auto_auto] lg:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-black text-foreground">{item.name}</p>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${item.direction === 'inflow' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-rose-500/10 text-rose-600'}`}>
                    {item.direction === 'inflow' ? 'приход' : 'расход'}
                  </span>
                  <span className="rounded-full bg-background px-2 py-0.5 text-[11px] font-bold text-muted-foreground">
                    {item.periodMonth?.slice(0, 7)}
                  </span>
                </div>
                <p className="mt-1 truncate text-xs font-medium text-muted-foreground">
                  {categoryName(data, item.categoryId)} · срок {item.dueAt ? new Date(item.dueAt).toLocaleDateString('ru-RU') : 'не указан'}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-black tabular-nums text-foreground">{moneyPrecise(item.plannedAmount)}</p>
                <p className={`text-xs font-bold tabular-nums ${delta <= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                  факт {moneyPrecise(item.actualAmount)}
                </p>
              </div>
              <div className="flex gap-2 lg:justify-end">
                {item.status !== 'paid' ? (
                  <button type="button" onClick={() => onAction(() => updateFinanceBudgetItemStatus(tenantId, item.id, 'paid' as FinanceBudgetStatus), 'Плановая строка закрыта')} className="h-8 rounded-lg border border-border px-3 text-xs font-bold hover:bg-background">
                    Оплачено
                  </button>
                ) : null}
                {item.status !== 'cancelled' ? (
                  <button type="button" onClick={() => onAction(() => updateFinanceBudgetItemStatus(tenantId, item.id, 'cancelled' as FinanceBudgetStatus), 'Плановая строка отменена')} className="h-8 rounded-lg border border-border px-3 text-xs font-bold hover:bg-background">
                    Отменить
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
