import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowRight, CheckCircle2, Database, KeyRound, RefreshCw, Settings, Store } from 'lucide-react';
import { desc, eq } from 'drizzle-orm';

import { AppError } from '@/lib/errors';
import { requireAuthenticatedUser } from '@/lib/auth/tenant-access';
import { syncActiveTenantForUser } from '@/lib/auth/user-bootstrap';
import { db, withAdminContext, withTenantContext } from '@/lib/db';
import { plans, subscriptions, syncRuns, tenants } from '@/lib/db/schema';
import { OnboardingSetup, type OnboardingPlanOption } from './OnboardingSetup';

export const metadata: Metadata = {
  title: 'Первый запуск — Про Цифры',
  description: 'Выбор пакета, подключение Wildberries и запуск первой синхронизации.',
};

type OnboardingSearchParams = {
  connected?: string;
  sync?: string;
  message?: string;
  messageType?: string;
  planCode?: string;
};

const dateTimeFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function formatDateTime(value: Date | string | null | undefined) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return dateTimeFormatter.format(date);
}

function planDisplayName(code: string | null | undefined, fallback: string | null | undefined) {
  const labels: Record<string, string> = {
    solo: 'Старт',
    growth: 'Рост',
    team: 'Команда',
    ops: 'Масштаб',
  };
  return code ? labels[code] ?? fallback ?? code : fallback ?? '—';
}

async function loadOnboardingPlans(): Promise<OnboardingPlanOption[]> {
  const rows = await withAdminContext(db, (tx) =>
    tx.select({
      code: plans.code,
      name: plans.name,
      priceRub: plans.priceRub,
      billingPeriod: plans.billingPeriod,
      maxTenants: plans.maxTenants,
      maxUsers: plans.maxUsers,
    })
      .from(plans)
      .where(eq(plans.isActive, true))
      .orderBy(plans.createdAt),
  );

  return rows.map((plan) => ({
    ...plan,
    priceRub: Number(plan.priceRub ?? 0),
  }));
}

async function loadConnectedState(tenantId: string) {
  const [tenantRows, subscriptionRows, syncRows] = await Promise.all([
    withTenantContext(db, tenantId, (tx) =>
      tx.select({
        name: tenants.name,
        shopName: tenants.shopName,
        wbTokenHealthStatus: tenants.wbTokenHealthStatus,
        wbTokenCheckedAt: tenants.wbTokenCheckedAt,
      })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1),
    ),
    withTenantContext(db, tenantId, (tx) =>
      tx.select({
        status: subscriptions.status,
        trialEndsAt: subscriptions.trialEndsAt,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        planCode: plans.code,
        planName: plans.name,
      })
        .from(subscriptions)
        .leftJoin(plans, eq(plans.id, subscriptions.planId))
        .where(eq(subscriptions.tenantId, tenantId))
        .orderBy(desc(subscriptions.createdAt))
        .limit(1),
    ),
    withTenantContext(db, tenantId, (tx) =>
      tx.select({
        status: syncRuns.status,
        requestedAt: syncRuns.requestedAt,
        startedAt: syncRuns.startedAt,
        finishedAt: syncRuns.finishedAt,
        errorMessage: syncRuns.errorMessage,
        summary: syncRuns.summary,
      })
        .from(syncRuns)
        .where(eq(syncRuns.tenantId, tenantId))
        .orderBy(desc(syncRuns.requestedAt))
        .limit(1),
    ),
  ]);

  return {
    tenant: tenantRows[0] ?? null,
    subscription: subscriptionRows[0] ?? null,
    syncRun: syncRows[0] ?? null,
  };
}

function ConnectedDashboard({
  state,
  searchParams,
}: {
  state: Awaited<ReturnType<typeof loadConnectedState>>;
  searchParams: OnboardingSearchParams;
}) {
  const syncRun = state.syncRun;
  const syncActive = syncRun?.status === 'pending' || syncRun?.status === 'running';
  const syncFailed = searchParams.sync === 'failed' || syncRun?.status === 'failed';
  const subscription = state.subscription;

  return (
    <main className="min-h-screen bg-[#f4f7fb] px-4 py-6 text-slate-950 dark:bg-[#050609] dark:text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.28em] text-cyan-700 dark:text-cyan-300">Первый запуск</p>
              <h1 className="mt-3 text-3xl font-black tracking-tight">Кабинет подключен</h1>
              <p className="mt-3 max-w-2xl text-sm font-medium leading-6 text-slate-600 dark:text-slate-300">
                Можно уже заходить в сервис. Первая синхронизация идёт в фоне, а данные появятся по мере загрузки источников WB.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-black text-white hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200" href="/overview">
                Открыть кабинет
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900" href="/settings">
                <Settings className="h-4 w-4" />
                Настройки
              </Link>
            </div>
          </div>

          {searchParams.message ? (
            <p className={`mt-5 rounded-lg border p-3 text-sm font-bold ${
              syncFailed
                ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-300'
                : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-900/20 dark:text-emerald-300'
            }`}>
              {searchParams.message}
            </p>
          ) : null}
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <Store className="h-6 w-6 text-cyan-700 dark:text-cyan-300" />
            <p className="mt-4 text-xs font-black uppercase tracking-[0.18em] text-slate-500">Магазин</p>
            <p className="mt-2 text-lg font-black">{state.tenant?.shopName || state.tenant?.name || '—'}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <KeyRound className="h-6 w-6 text-emerald-700 dark:text-emerald-300" />
            <p className="mt-4 text-xs font-black uppercase tracking-[0.18em] text-slate-500">WB-ключ</p>
            <p className="mt-2 text-lg font-black">{state.tenant?.wbTokenHealthStatus === 'healthy' ? 'проверен' : 'сохранён'}</p>
            <p className="mt-1 text-xs font-semibold text-slate-500">{formatDateTime(state.tenant?.wbTokenCheckedAt)}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <CheckCircle2 className="h-6 w-6 text-violet-700 dark:text-violet-300" />
            <p className="mt-4 text-xs font-black uppercase tracking-[0.18em] text-slate-500">Пакет</p>
            <p className="mt-2 text-lg font-black">{planDisplayName(subscription?.planCode, subscription?.planName)}</p>
            <p className="mt-1 text-xs font-semibold text-slate-500">trial до {formatDateTime(subscription?.trialEndsAt ?? subscription?.currentPeriodEnd)}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <RefreshCw className={`h-6 w-6 ${syncActive ? 'animate-spin text-blue-700 dark:text-blue-300' : syncFailed ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'}`} />
            <p className="mt-4 text-xs font-black uppercase tracking-[0.18em] text-slate-500">Синхронизация</p>
            <p className="mt-2 text-lg font-black">{syncRun?.status ?? 'ожидает'}</p>
            <p className="mt-1 text-xs font-semibold text-slate-500">{formatDateTime(syncRun?.startedAt ?? syncRun?.requestedAt)}</p>
          </div>
        </div>

        <section className="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-3">
            <Database className="h-6 w-6 text-cyan-700 dark:text-cyan-300" />
            <h2 className="text-xl font-black tracking-tight">Что происходит сейчас</h2>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {[
              ['Финансы и продажи', 'Загружаем отчёты, продажи, заказы и выкупы.'],
              ['Реклама и воронка', 'Подтягиваем расходы, кампании и базовые показатели.'],
              ['Остатки и товары', 'Собираем товары, склады, остатки и основу для рекомендаций.'],
            ].map(([title, text]) => (
              <div key={title} className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/45">
                <p className="font-black">{title}</p>
                <p className="mt-2 text-sm font-medium leading-6 text-slate-600 dark:text-slate-300">{text}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<OnboardingSearchParams>;
}) {
  const params = await searchParams;
  let user;

  try {
    user = await requireAuthenticatedUser();
  } catch (error) {
    if (error instanceof AppError && error.status === 401) {
      redirect('/login');
    }
    throw error;
  }

  const bootstrapState = await syncActiveTenantForUser(user.id, user.email ?? null);

  if (bootstrapState.tenantId) {
    const state = await loadConnectedState(bootstrapState.tenantId);
    return <ConnectedDashboard state={state} searchParams={params} />;
  }

  const onboardingPlans = await loadOnboardingPlans();
  return (
    <OnboardingSetup
      plans={onboardingPlans}
      defaultPlanCode={params.planCode ?? process.env.ONBOARDING_DEFAULT_PLAN_CODE ?? 'growth'}
      message={params.message}
      messageType={params.messageType}
    />
  );
}
