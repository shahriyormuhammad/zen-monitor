'use client';

/**
 * Sales Plan — Zen Monitor (Postal-style).
 *
 * Layout:
 *  1. Sticky header — period filters + "Новый план" button (opens modal).
 *  2. Plan picker — chip row of active plans (click to switch focus).
 *  3. Hero card — cylinder gauge + info-table (план / факт) + traffic lights.
 *  4. Weekly plan table — 53-week breakdown with season pills.
 *
 * Uses existing server actions (loadSalesPlanWorkspaceAction,
 * createSalesPlanAction, archiveSalesPlanAction) unchanged. The richer
 * UI is rendered from data already in SalesPlanSummary; per-week storage
 * comes in a follow-up commit.
 */

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ClipboardList,
  Loader2,
  Plus,
  Sparkles,
  TrendingUp,
  X,
} from 'lucide-react';

import { OperatorState } from '@/components/dashboard/OperatorState';
import { useStore } from '@/store/useStore';
import { CylinderGauge } from '@/components/sales-plan/CylinderGauge';
import {
  MiniTrafficLights,
  lightTone,
  type TrafficLightItem,
} from '@/components/sales-plan/MiniTrafficLights';
import { WeeklyPlanTable } from '@/components/sales-plan/WeeklyPlanTable';
import { buildWeeklyRowsFromPlan } from '@/components/sales-plan/weekly-plan-builder';
import {
  archiveSalesPlanAction,
  createSalesPlanAction,
  loadSalesPlanWorkspaceAction,
} from './actions';
import type {
  SalesPlanSummary,
  SalesPlanWorkspace,
} from '@/server/sales-plan/service';

/* ─────────────────────── helpers ─────────────────────── */

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}
function monthStart() {
  const now = new Date();
  return dateOnly(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
}
function monthEnd() {
  const now = new Date();
  return dateOnly(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)));
}
function formatNumber(value: number) {
  return Math.round(value).toLocaleString('ru-RU');
}
function formatMoney(value: number) {
  return `${Math.round(value).toLocaleString('ru-RU')} ₽`;
}
function formatMoneyCompact(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return (value / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M ₽';
  if (abs >= 1000) return (value / 1000).toFixed(1).replace(/\.0$/, '') + 'K ₽';
  return `${Math.round(value)} ₽`;
}
function paceLabel(status: SalesPlanSummary['paceStatus']) {
  if (status === 'ahead') return 'опережаем';
  if (status === 'behind') return 'отстаём';
  if (status === 'on_track') return 'по плану';
  return 'не стартовал';
}
function paceTone(status: SalesPlanSummary['paceStatus']): TrafficLightItem['tone'] {
  if (status === 'ahead' || status === 'on_track') return 'ok';
  if (status === 'behind') return 'bad';
  return 'idle';
}

/* ─────────────────────── PAGE ─────────────────────── */

export default function SalesPlanPage() {
  const { tenantId } = useStore();
  const queryClient = useQueryClient();
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const workspaceQuery = useQuery<SalesPlanWorkspace, Error>({
    queryKey: ['sales-plan-workspace', tenantId],
    queryFn: () => loadSalesPlanWorkspaceAction(tenantId!),
    enabled: Boolean(tenantId),
    staleTime: 30_000,
  });

  const groups = workspaceQuery.data?.groups ?? [];
  const plans = workspaceQuery.data?.plans ?? [];
  const activePlans = useMemo(() => plans.filter((p) => p.status === 'active'), [plans]);

  // Pick the currently-focused plan (latest active by default).
  const focusedPlan = useMemo(() => {
    if (activePlanId) return plans.find((p) => p.id === activePlanId) ?? activePlans[0];
    return activePlans[0];
  }, [activePlanId, activePlans, plans]);

  const archiveMutation = useMutation({
    mutationFn: (planId: string) => {
      if (!tenantId) throw new Error('Сначала выберите кабинет');
      return archiveSalesPlanAction(tenantId, planId);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sales-plan-workspace'] });
    },
  });

  if (!tenantId) {
    return (
      <OperatorState
        icon={ClipboardList}
        title="План продаж недоступен без кабинета"
        description="Выберите активный магазин, чтобы создать план."
        actionLabel="Открыть настройки"
        actionHref="/settings"
      />
    );
  }

  if (workspaceQuery.error) {
    return (
      <OperatorState
        icon={ClipboardList}
        tone="danger"
        title="Не удалось загрузить план продаж"
        description={workspaceQuery.error.message}
        actionLabel="Повторить"
        action={workspaceQuery.refetch}
      />
    );
  }

  if (workspaceQuery.isLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-cyan-500" />
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-10">
      {/* ─────────── Top: title + actions ─────────── */}
      <section className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black tracking-tight text-foreground">План продаж</h2>
          <p className="mt-0.5 text-xs font-semibold text-muted-foreground">
            Активных планов: {activePlans.length} · сезонная модель по склейкам
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-cyan-500 px-4 text-sm font-black text-white shadow-[0_10px_24px_-10px_rgba(6,182,212,0.7)] transition-transform hover:-translate-y-0.5 hover:bg-cyan-400"
          >
            <Plus className="h-4 w-4" />
            Новый план
          </button>
        </div>
      </section>

      {plans.length === 0 ? (
        <OperatorState
          icon={Sparkles}
          title="Планов ещё нет"
          description="Создайте первый план — выберите склейку, период и плановое количество штук."
          actionLabel="Создать план"
          action={() => setShowCreateModal(true)}
        />
      ) : (
        <>
          {/* ─────────── Plan chips ─────────── */}
          {activePlans.length > 1 ? (
            <section className="flex flex-wrap gap-2">
              {activePlans.map((p) => {
                const focused = focusedPlan?.id === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setActivePlanId(p.id)}
                    className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold transition-colors ${focused
                      ? 'border-cyan-500/40 bg-cyan-50 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-200'
                      : 'border-border bg-card text-muted-foreground hover:border-border-strong hover:text-foreground'
                      }`}
                  >
                    <span className="truncate max-w-[160px]">{p.groupName ?? p.name}</span>
                    <span className="text-[10px] font-bold text-muted-foreground">
                      {p.progressPct.toFixed(0)}%
                    </span>
                  </button>
                );
              })}
            </section>
          ) : null}

          {/* ─────────── Hero card (focused plan) ─────────── */}
          {focusedPlan ? (
            <HeroPlanCard
              plan={focusedPlan}
              onArchive={() => archiveMutation.mutate(focusedPlan.id)}
              archiving={archiveMutation.isPending}
            />
          ) : null}

          {/* ─────────── Weekly plan table ─────────── */}
          {focusedPlan ? (
            <section className="space-y-2">
              <div className="flex items-baseline justify-between">
                <h3 className="text-sm font-black uppercase tracking-[0.18em] text-muted-foreground">
                  Недельный план
                </h3>
                <span className="text-[11px] font-semibold text-muted-foreground">
                  53 недели · сезонный коэф · пики и спады
                </span>
              </div>
              <WeeklyPlanTable rows={buildWeeklyRowsFromPlan(focusedPlan)} />
            </section>
          ) : null}

          {/* ─────────── Archive list ─────────── */}
          {plans.filter((p) => p.status !== 'active').length > 0 ? (
            <section className="space-y-2">
              <h3 className="text-sm font-black uppercase tracking-[0.18em] text-muted-foreground">
                Архив
              </h3>
              <div className="grid gap-3 md:grid-cols-2">
                {plans.filter((p) => p.status !== 'active').map((p) => (
                  <div key={p.id} className="dashboard-card flex items-center justify-between p-4">
                    <div className="min-w-0">
                      <div className="truncate font-black text-foreground">{p.groupName ?? p.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {p.periodStart} → {p.periodEnd} · {formatMoneyCompact(p.actualRevenue)} факт
                      </div>
                    </div>
                    <span className="rounded-full border border-border bg-subtle px-2 py-1 text-[10px] font-bold text-muted-foreground">
                      архив
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}

      {/* ─────────── Modal: new plan ─────────── */}
      {showCreateModal ? (
        <CreatePlanModal
          tenantId={tenantId}
          groups={groups}
          isCreating={workspaceQuery.isFetching}
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            setShowCreateModal(false);
            void queryClient.invalidateQueries({ queryKey: ['sales-plan-workspace'] });
          }}
        />
      ) : null}
    </div>
  );
}

/* ─────────────────────── Hero ─────────────────────── */

function HeroPlanCard({
  plan,
  onArchive,
  archiving,
}: {
  plan: SalesPlanSummary;
  onArchive: () => void;
  archiving: boolean;
}) {
  const revenuePct = plan.plannedRevenue > 0
    ? (plan.actualRevenue / plan.plannedRevenue) * 100
    : 0;

  const trafficLights: TrafficLightItem[] = [
    { label: 'План',    value: `${plan.progressPct.toFixed(0)}%`, tone: lightTone(plan.progressPct, 95, 80) },
    { label: 'Выручка', value: `${revenuePct.toFixed(0)}%`,        tone: lightTone(revenuePct, 95, 80) },
    { label: 'Темп',    value: paceLabel(plan.paceStatus),         tone: paceTone(plan.paceStatus) },
    { label: 'Прогноз', value: `${formatNumber(plan.projectedOrders)} шт`, tone: lightTone((plan.projectedOrders / Math.max(1, plan.plannedOrders)) * 100, 100, 80) },
  ];

  return (
    <article className="dashboard-card p-5">
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-xl font-black tracking-tight text-foreground">
              {plan.groupName ?? plan.name}
            </h2>
            {plan.status !== 'active' ? (
              <span className="rounded-full border border-border bg-subtle px-2 py-1 text-[10px] font-bold text-muted-foreground">
                архив
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm font-semibold text-muted-foreground">
            {plan.periodStart} → {plan.periodEnd}
            {plan.seasonName ? ` · ${plan.seasonName}` : ''}
            {plan.targetStockDays ? ` · запас ${plan.targetStockDays} дн.` : ''}
          </p>
        </div>

        {plan.status === 'active' ? (
          <button
            type="button"
            onClick={onArchive}
            disabled={archiving}
            className="inline-flex h-9 items-center gap-2 rounded-xl border border-border bg-card px-3 text-xs font-bold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-60"
          >
            {archiving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}
            В архив
          </button>
        ) : null}
      </div>

      {/* Main: cylinder | info-table */}
      <div className="grid gap-5 lg:grid-cols-[150px_minmax(0,1fr)]">
        <CylinderGauge pct={plan.progressPct} label="Выполнение" />

        <div className="flex min-w-0 flex-col gap-4">
          {/* 7-col info-table: лейбл / план / факт | sep | лейбл / план / факт */}
          <table className="w-full table-fixed border-collapse text-xs">
            <thead>
              <tr>
                <th className="w-[24%]" />
                <th className="w-[13%]" />
                <th className="w-[13%] bg-amber-100 text-[9px] font-extrabold uppercase tracking-widest text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">Факт</th>
                <th className="w-[4%]" />
                <th className="w-[24%]" />
                <th className="w-[13%]" />
                <th className="w-[13%] bg-amber-100 text-[9px] font-extrabold uppercase tracking-widest text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">Факт</th>
              </tr>
            </thead>
            <tbody>
              <InfoRow
                label1="Заказы за сезон"
                plan1={formatNumber(plan.plannedOrders) + ' шт'}
                fact1={formatNumber(plan.actualOrders) + ' шт'}
                label2="Выручка"
                plan2={formatMoneyCompact(plan.plannedRevenue)}
                fact2={formatMoneyCompact(plan.actualRevenue)}
              />
              <InfoRow
                label1="% выполнения"
                plan1="100%"
                fact1={`${plan.progressPct.toFixed(1)}%`}
                label2="Прогноз"
                plan2={formatNumber(plan.plannedOrders) + ' шт'}
                fact2={formatNumber(plan.projectedOrders) + ' шт'}
              />
              <InfoRow
                label1="Остаток"
                plan1={formatNumber(plan.remainingOrders) + ' шт'}
                fact1={null}
                label2="Цель запас"
                plan2={plan.targetStockDays ? `${plan.targetStockDays} дн.` : '—'}
                fact2={null}
              />
            </tbody>
          </table>

          {/* Mini traffic lights */}
          <MiniTrafficLights items={trafficLights} />

          {/* Tags */}
          <div className="flex flex-wrap gap-2 text-xs font-bold text-muted-foreground">
            <span className="inline-flex items-center gap-1 rounded-xl border border-border bg-subtle px-2.5 py-1">
              <TrendingUp className="h-3.5 w-3.5 text-cyan-500" />
              Выручка план: {formatMoney(plan.plannedRevenue)}
            </span>
            <span className="inline-flex items-center gap-1 rounded-xl border border-border bg-subtle px-2.5 py-1">
              Факт: {formatMoney(plan.actualRevenue)}
            </span>
          </div>
        </div>
      </div>
    </article>
  );
}

function InfoRow({
  label1, plan1, fact1, label2, plan2, fact2,
}: {
  label1: string; plan1: string; fact1: string | null;
  label2: string; plan2: string; fact2: string | null;
}) {
  return (
    <tr className="border-t border-border">
      <th className="border border-border bg-subtle px-2 py-1.5 text-left text-[10.5px] font-medium text-muted-foreground">{label1}</th>
      <td className="border border-border px-2 py-1.5 text-right font-mono font-bold text-foreground">{plan1}</td>
      <td className="border border-border bg-amber-50/70 px-2 py-1.5 text-right font-mono font-bold text-foreground dark:bg-amber-900/20">{fact1 ?? '—'}</td>
      <td className="border-0" />
      <th className="border border-border bg-subtle px-2 py-1.5 text-left text-[10.5px] font-medium text-muted-foreground">{label2}</th>
      <td className="border border-border px-2 py-1.5 text-right font-mono font-bold text-foreground">{plan2}</td>
      <td className="border border-border bg-amber-50/70 px-2 py-1.5 text-right font-mono font-bold text-foreground dark:bg-amber-900/20">{fact2 ?? '—'}</td>
    </tr>
  );
}

/* ─────────────────────── Create modal ─────────────────────── */

function CreatePlanModal({
  tenantId,
  groups,
  onClose,
  onCreated,
}: {
  tenantId: string;
  groups: SalesPlanWorkspace['groups'];
  isCreating: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [groupId, setGroupId] = useState('');
  const [plannedOrders, setPlannedOrders] = useState('300');
  const [averagePrice, setAveragePrice] = useState('1000');
  const [periodStart, setPeriodStart] = useState(monthStart());
  const [periodEnd, setPeriodEnd] = useState(monthEnd());
  const [seasonName, setSeasonName] = useState('');
  const [targetStockDays, setTargetStockDays] = useState('30');
  const [formError, setFormError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () => {
      if (!groupId) throw new Error('Выберите склейку');
      return createSalesPlanAction(tenantId, {
        groupId,
        periodStart,
        periodEnd,
        plannedOrders: Number(plannedOrders),
        averagePrice: Number(averagePrice),
        seasonName,
        targetStockDays: Number(targetStockDays),
      });
    },
    onSuccess: () => {
      setFormError(null);
      onCreated();
    },
    onError: (err: Error) => setFormError(err.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="dashboard-card relative w-full max-w-md p-5">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-xl text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Закрыть"
        >
          <X className="h-4 w-4" />
        </button>

        <h2 className="text-lg font-black tracking-tight text-foreground">Новый план</h2>
        <p className="mt-1 text-xs font-semibold text-muted-foreground">Склейка, период, штуки, цена.</p>

        <div className="mt-4 space-y-3">
          <Field label="1. Что продаём">
            <select
              className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm font-bold outline-none focus:border-cyan-400"
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              disabled={groups.length === 0}
            >
              <option value="">Выберите склейку</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>{g.name} · {g.memberCount} SKU</option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="2. Сколько штук">
              <input
                className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm font-bold outline-none focus:border-cyan-400"
                inputMode="numeric"
                value={plannedOrders}
                onChange={(e) => setPlannedOrders(e.target.value)}
              />
            </Field>
            <Field label="Средняя цена">
              <input
                className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm font-bold outline-none focus:border-cyan-400"
                inputMode="numeric"
                value={averagePrice}
                onChange={(e) => setAveragePrice(e.target.value)}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="3. С даты">
              <input
                type="date"
                className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm font-bold outline-none focus:border-cyan-400"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
              />
            </Field>
            <Field label="По дату">
              <input
                type="date"
                className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm font-bold outline-none focus:border-cyan-400"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Сезон">
              <input
                className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm font-bold outline-none focus:border-cyan-400"
                placeholder="Например: лето, школа"
                value={seasonName}
                onChange={(e) => setSeasonName(e.target.value)}
              />
            </Field>
            <Field label="Запас, дн.">
              <input
                className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm font-bold outline-none focus:border-cyan-400"
                inputMode="numeric"
                value={targetStockDays}
                onChange={(e) => setTargetStockDays(e.target.value)}
              />
            </Field>
          </div>

          {formError ? (
            <div className="rounded-xl border border-rose-500/30 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 dark:bg-rose-950 dark:text-rose-300">
              {formError}
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 text-sm font-black text-white shadow-[0_10px_24px_-10px_rgba(6,182,212,0.7)] hover:bg-cyan-400 disabled:opacity-60"
          >
            {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Сохранить план
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
