'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  AlertCircle,
  Loader2,
  RefreshCw,
  Wallet,
  Gift,
  TrendingDown,
  Plus,
  Settings2,
} from 'lucide-react';

import { useStore } from '@/store/useStore';

interface SpendPoint {
  date: string;
  spendRub: number;
}

interface BalanceData {
  realMoney: number;
  bonusSum: number;
  bonusPercent: number;
  bonusExpiresAt: string | null;
  syncedAt: string;
  spendHistory: SpendPoint[];
  forecastDaysLeft: number | null;
}

interface AutoRefillSettings {
  enabled: boolean;
  campaignId: number | null;
  thresholdRub: number;
  topUpAmountRub: number;
  dailyCapRub: number;
}

interface BalanceResponse {
  balance: BalanceData;
  autoRefill: AutoRefillSettings;
}

function formatRub(value: number) {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

async function fetchBalance(): Promise<BalanceResponse> {
  const res = await fetch(
    `/api/views/advertising/balance`,
    { cache: 'no-store' }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Ошибка загрузки' }));
    throw new Error(err.error ?? 'Ошибка загрузки баланса');
  }
  return res.json();
}

async function postBalanceAction(
  body: Record<string, unknown>
): Promise<unknown> {
  const res = await fetch(`/api/views/advertising/balance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Ошибка' }));
    throw new Error(err.error ?? 'Ошибка запроса');
  }
  return res.json();
}

export function BalancePage() {
  const { tenantId } = useStore();
  const queryClient = useQueryClient();

  const [depositCampaignId, setDepositCampaignId] = useState('');
  const [depositAmount, setDepositAmount] = useState('');
  const [showAutoRefillForm, setShowAutoRefillForm] = useState(false);
  const [arForm, setArForm] = useState<Partial<AutoRefillSettings>>({});
  const [depositError, setDepositError] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['advertising-balance', tenantId],
    queryFn: () => fetchBalance(),
    enabled: Boolean(tenantId),
    staleTime: 5 * 60 * 1000,
  });

  const depositMutation = useMutation({
    mutationFn: (vars: { campaignId: number; amountRub: number }) =>
      postBalanceAction({
        action: 'deposit',
        campaignId: vars.campaignId,
        amountRub: vars.amountRub,
      }),
    onSuccess: () => {
      setDepositAmount('');
      setDepositCampaignId('');
      setDepositError(null);
      queryClient.invalidateQueries({ queryKey: ['advertising-balance', tenantId] });
    },
    onError: (e: Error) => setDepositError(e.message),
  });

  const autoRefillMutation = useMutation({
    mutationFn: (settings: Partial<AutoRefillSettings>) =>
      postBalanceAction({ action: 'configure-auto-refill', ...settings }),
    onSuccess: () => {
      setShowAutoRefillForm(false);
      queryClient.invalidateQueries({ queryKey: ['advertising-balance', tenantId] });
    },
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center gap-3 text-emerald-600">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="text-slate-500">Загружаем баланс...</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3 text-rose-600">
        <AlertCircle className="h-8 w-8" />
        <p className="text-sm">{(error as Error).message}</p>
        <button
          onClick={() => refetch()}
          className="rounded-md bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100"
        >
          Повторить
        </button>
      </div>
    );
  }

  const balance = data?.balance;
  const autoRefill = data?.autoRefill;

  const handleDeposit = () => {
    const campaignId = Number(depositCampaignId);
    const amountRub = Number(depositAmount);
    if (!Number.isFinite(campaignId) || campaignId <= 0) {
      setDepositError('Введите корректный ID кампании');
      return;
    }
    if (!Number.isFinite(amountRub) || amountRub <= 0) {
      setDepositError('Введите корректную сумму');
      return;
    }
    depositMutation.mutate({ campaignId, amountRub });
  };

  const handleSaveAutoRefill = () => {
    const settings: Partial<AutoRefillSettings> = {
      ...autoRefill,
      ...arForm,
    };
    autoRefillMutation.mutate(settings);
  };

  const spendData = (balance?.spendHistory ?? []).map((p) => ({
    date: formatDate(p.date),
    spend: Math.round(p.spendRub),
  }));

  return (
    <div className="space-y-6 p-1">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Баланс рекламного кабинета</h2>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-2 rounded-md bg-slate-100 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-400"
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          Обновить
        </button>
      </div>

      {/* Balance cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {/* Real money */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            <Wallet className="h-4 w-4" />
            Реальные деньги
          </div>
          <div className="mt-2 text-3xl font-bold text-slate-900 dark:text-slate-100">
            {balance ? formatRub(balance.realMoney) : '—'}
          </div>
          {balance?.forecastDaysLeft != null && (
            <div className="mt-1 flex items-center gap-1 text-xs text-slate-400">
              <TrendingDown className="h-3 w-3" />
              Хватит примерно на {balance.forecastDaysLeft} дн.
            </div>
          )}
        </div>

        {/* Bonus */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            <Gift className="h-4 w-4" />
            Бонусы WB
          </div>
          <div className="mt-2 text-3xl font-bold text-slate-900 dark:text-slate-100">
            {balance ? formatRub(balance.bonusSum) : '—'}
          </div>
          {balance?.bonusExpiresAt && (
            <div className="mt-1 text-xs text-amber-500">
              Истекают {formatDate(balance.bonusExpiresAt)}
            </div>
          )}
        </div>

        {/* Auto-refill status */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            <Settings2 className="h-4 w-4" />
            Автопополнение
          </div>
          <div className="mt-2">
            {autoRefill?.enabled ? (
              <span className="inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-sm font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                Включено
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-500 dark:bg-slate-700">
                Выключено
              </span>
            )}
          </div>
          {autoRefill?.enabled && (
            <div className="mt-1 text-xs text-slate-400">
              Порог {formatRub(autoRefill.thresholdRub)} · +{formatRub(autoRefill.topUpAmountRub)}
            </div>
          )}
        </div>
      </div>

      {/* Spend chart */}
      {spendData.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <h3 className="mb-4 text-sm font-semibold text-slate-700 dark:text-slate-300">Расходы за 30 дней</h3>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={spendData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="spendGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => `${Math.round(v / 1000)}k`}
              />
              <Tooltip
                formatter={(v) => [formatRub(Number(v ?? 0)), 'Расход']}
                contentStyle={{ fontSize: 12 }}
              />
              <Area
                type="monotone"
                dataKey="spend"
                stroke="#10b981"
                strokeWidth={2}
                fill="url(#spendGrad)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Manual deposit */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
          <Plus className="h-4 w-4" />
          Пополнить кампанию
        </h3>
        <div className="flex flex-wrap gap-3">
          <input
            type="number"
            placeholder="ID кампании"
            value={depositCampaignId}
            onChange={(e) => setDepositCampaignId(e.target.value)}
            className="w-36 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
          />
          <input
            type="number"
            placeholder="Сумма, ₽"
            value={depositAmount}
            onChange={(e) => setDepositAmount(e.target.value)}
            className="w-36 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
          />
          <button
            onClick={handleDeposit}
            disabled={depositMutation.isPending}
            className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {depositMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Пополнить
          </button>
        </div>
        {depositError && (
          <p className="mt-2 text-xs text-rose-500">{depositError}</p>
        )}
        {depositMutation.isSuccess && (
          <p className="mt-2 text-xs text-emerald-600">Пополнение отправлено</p>
        )}
      </div>

      {/* Auto-refill settings */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
            <Settings2 className="h-4 w-4" />
            Настройки автопополнения
          </h3>
          <button
            onClick={() => {
              setArForm({ ...autoRefill });
              setShowAutoRefillForm(!showAutoRefillForm);
            }}
            className="rounded-md bg-slate-100 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-400"
          >
            {showAutoRefillForm ? 'Свернуть' : 'Изменить'}
          </button>
        </div>

        {!showAutoRefillForm && autoRefill && (
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-slate-400">Статус</dt>
              <dd className="font-medium text-slate-700 dark:text-slate-300">
                {autoRefill.enabled ? 'Включено' : 'Выключено'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Кампания</dt>
              <dd className="font-medium text-slate-700 dark:text-slate-300">
                {autoRefill.campaignId ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Порог</dt>
              <dd className="font-medium text-slate-700 dark:text-slate-300">
                {formatRub(autoRefill.thresholdRub)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Сумма пополнения</dt>
              <dd className="font-medium text-slate-700 dark:text-slate-300">
                {formatRub(autoRefill.topUpAmountRub)}
              </dd>
            </div>
          </dl>
        )}

        {showAutoRefillForm && (
          <div className="mt-4 space-y-4">
            <label className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={arForm.enabled ?? false}
                onChange={(e) => setArForm((f) => ({ ...f, enabled: e.target.checked }))}
                className="h-4 w-4 rounded accent-emerald-600"
              />
              <span className="text-slate-700 dark:text-slate-300">Включить автопополнение</span>
            </label>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <label className="space-y-1">
                <span className="text-xs text-slate-500">ID кампании</span>
                <input
                  type="number"
                  value={arForm.campaignId ?? ''}
                  onChange={(e) => setArForm((f) => ({ ...f, campaignId: Number(e.target.value) || null }))}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-slate-500">Порог, ₽</span>
                <input
                  type="number"
                  value={arForm.thresholdRub ?? ''}
                  onChange={(e) => setArForm((f) => ({ ...f, thresholdRub: Number(e.target.value) }))}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-slate-500">Сумма пополнения, ₽</span>
                <input
                  type="number"
                  value={arForm.topUpAmountRub ?? ''}
                  onChange={(e) => setArForm((f) => ({ ...f, topUpAmountRub: Number(e.target.value) }))}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-slate-500">Дневной лимит, ₽</span>
                <input
                  type="number"
                  value={arForm.dailyCapRub ?? ''}
                  onChange={(e) => setArForm((f) => ({ ...f, dailyCapRub: Number(e.target.value) }))}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
                />
              </label>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleSaveAutoRefill}
                disabled={autoRefillMutation.isPending}
                className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {autoRefillMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Сохранить
              </button>
              <button
                onClick={() => setShowAutoRefillForm(false)}
                className="rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-600 hover:bg-slate-200 dark:bg-slate-700"
              >
                Отмена
              </button>
            </div>

            {autoRefillMutation.isError && (
              <p className="text-xs text-rose-500">
                {(autoRefillMutation.error as Error).message}
              </p>
            )}
          </div>
        )}
      </div>

      {balance?.syncedAt && (
        <p className="text-center text-xs text-slate-400">
          Обновлено: {new Date(balance.syncedAt).toLocaleString('ru-RU')}
        </p>
      )}
    </div>
  );
}
