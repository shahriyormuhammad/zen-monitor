import { sql } from 'drizzle-orm';

import { db, withTenantContext } from '@/lib/db';
import { salesPlanLines, salesPlanSeasons, salesPlanVersions } from '@/lib/db/schema';

export type SalesPlanStatus = 'active' | 'draft' | 'archived';

export type SalesPlanGroupOption = {
  id: string;
  name: string;
  memberCount: number;
};

export type SalesPlanSummary = {
  id: string;
  name: string;
  status: SalesPlanStatus;
  periodStart: string;
  periodEnd: string;
  groupId: string | null;
  groupName: string | null;
  seasonName: string | null;
  targetStockDays: number | null;
  plannedOrders: number;
  plannedRevenue: number;
  actualOrders: number;
  actualRevenue: number;
  progressPct: number;
  projectedOrders: number;
  remainingOrders: number;
  paceStatus: 'ahead' | 'behind' | 'on_track' | 'not_started';
};

export type SalesPlanWorkspace = {
  groups: SalesPlanGroupOption[];
  plans: SalesPlanSummary[];
};

export type SalesPlanPeriodSummary = {
  planCount: number;
  plannedOrders: number;
  plannedRevenue: number;
  actualOrders: number;
  actualRevenue: number;
  progressPct: number;
  projectedOrders: number;
  remainingOrders: number;
  daysElapsedPct: number;
  paceStatus: 'ahead' | 'behind' | 'on_track' | 'not_started';
};

export type CreateSimpleSalesPlanInput = {
  name?: string | null;
  groupId: string;
  periodStart: string;
  periodEnd: string;
  plannedOrders: number;
  averagePrice?: number | null;
  seasonName?: string | null;
  targetStockDays?: number | null;
  notes?: string | null;
};

function toNumber(value: unknown): number {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function toDateOnly(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? '').slice(0, 10);
}

function normalizeDateOnly(value: string, field: string): string {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new Error(`${field}: дата должна быть в формате YYYY-MM-DD`);
  }
  return trimmed;
}

function listDateRange(start: string, end: string): string[] {
  const startDate = new Date(`${start}T00:00:00.000Z`);
  const endDate = new Date(`${end}T00:00:00.000Z`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw new Error('Период плана указан некорректно');
  }
  if (endDate < startDate) {
    throw new Error('Дата окончания не может быть раньше даты начала');
  }

  const days: string[] = [];
  for (let t = startDate.getTime(); t <= endDate.getTime(); t += 86_400_000) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  if (days.length > 370) {
    throw new Error('План пока можно создать максимум на 370 дней');
  }
  return days;
}

function roundMoney(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

function computePace(
  periodStart: string,
  periodEnd: string,
  plannedOrders: number,
  actualOrders: number,
) {
  const start = new Date(`${periodStart}T00:00:00.000Z`).getTime();
  const end = new Date(`${periodEnd}T00:00:00.000Z`).getTime();
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const totalDays = Math.max(1, Math.floor((end - start) / 86_400_000) + 1);
  const elapsedDays = todayUtc < start ? 0 : Math.min(totalDays, Math.floor((Math.min(todayUtc, end) - start) / 86_400_000) + 1);
  const daysElapsedPct = totalDays > 0 ? (elapsedDays / totalDays) * 100 : 0;
  const progressPct = plannedOrders > 0 ? (actualOrders / plannedOrders) * 100 : 0;
  const projectedOrders = elapsedDays > 0 ? Math.round((actualOrders / elapsedDays) * totalDays) : actualOrders;
  const remainingOrders = Math.max(0, plannedOrders - actualOrders);

  let paceStatus: SalesPlanSummary['paceStatus'] = 'not_started';
  if (elapsedDays > 0 && plannedOrders > 0) {
    const delta = progressPct - daysElapsedPct;
    paceStatus = delta >= 5 ? 'ahead' : delta <= -5 ? 'behind' : 'on_track';
  }

  return {
    daysElapsedPct: Math.round(daysElapsedPct * 10) / 10,
    progressPct: Math.round(progressPct * 10) / 10,
    projectedOrders,
    remainingOrders,
    paceStatus,
  };
}

async function getActualForPlan(tenantId: string, planId: string, periodStart: string, periodEnd: string) {
  return withTenantContext(db, tenantId, async (tx) => {
    const targetRows = await tx.execute(sql`
      SELECT DISTINCT target_nm.nm_id::bigint AS nm_id
      FROM (
        SELECT COALESCE(l.nm_id, gm.nm_id)::bigint AS nm_id
        FROM sales_plan_lines l
        LEFT JOIN product_group_members gm ON gm.group_id = l.group_id
        WHERE l.tenant_id = ${tenantId}
          AND l.plan_id = ${planId}
      ) target_nm
      WHERE target_nm.nm_id IS NOT NULL
    `);
    const nmIds = (targetRows as unknown as Array<{ nm_id: unknown }>)
      .map((row) => Number(row.nm_id))
      .filter((nmId) => Number.isFinite(nmId) && nmId > 0);
    if (nmIds.length === 0) {
      return { actualOrders: 0, actualRevenue: 0 };
    }

    const nmIdList = sql.join(nmIds.map((nmId) => sql`${nmId}`), sql`, `);
    const factRows = await tx.execute(sql`
      SELECT
        COUNT(*)::int AS actual_orders,
        COALESCE(SUM(total_price), 0)::numeric AS actual_revenue
      FROM raw_api_orders
      WHERE tenant_id = ${tenantId}
        AND is_cancel = false
        AND date::date >= ${periodStart}::date
        AND date::date <= ${periodEnd}::date
        AND nm_id IN (${nmIdList})
    `);
    const row = (factRows as unknown as Array<{ actual_orders: unknown; actual_revenue: unknown }>)[0];
    return {
      actualOrders: toNumber(row?.actual_orders),
      actualRevenue: toNumber(row?.actual_revenue),
    };
  });
}

export async function getSalesPlanWorkspace(tenantId: string): Promise<SalesPlanWorkspace> {
  const { groupRows, planRows } = await withTenantContext(db, tenantId, async (tx) => {
    const groups = await tx.execute(sql`
      SELECT
        pg.id,
        pg.name,
        COUNT(gm.nm_id)::int AS member_count
      FROM product_groups pg
      LEFT JOIN product_group_members gm ON gm.group_id = pg.id
      WHERE pg.tenant_id = ${tenantId}
      GROUP BY pg.id, pg.name
      ORDER BY pg.name ASC
    `);

    const plans = await tx.execute(sql`
      SELECT
        v.id,
        v.name,
        v.status,
        v.period_start,
        v.period_end,
        COALESCE(SUM(l.planned_orders), 0)::int AS planned_orders,
        COALESCE(SUM(l.planned_revenue), 0)::numeric AS planned_revenue,
        MIN(l.group_id::text) AS group_id,
        MAX(pg.name) AS group_name,
        MAX(s.name) AS season_name,
        MAX(s.target_stock_days)::int AS target_stock_days
      FROM sales_plan_versions v
      LEFT JOIN sales_plan_lines l ON l.plan_id = v.id AND l.tenant_id = v.tenant_id
      LEFT JOIN product_groups pg ON pg.id = l.group_id
      LEFT JOIN sales_plan_seasons s ON s.plan_id = v.id AND s.tenant_id = v.tenant_id
      WHERE v.tenant_id = ${tenantId}
      GROUP BY v.id, v.name, v.status, v.period_start, v.period_end, v.created_at
      ORDER BY
        CASE v.status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,
        v.period_end DESC,
        v.created_at DESC
      LIMIT 20
    `);

    return { groupRows: groups, planRows: plans };
  });

  const groups = (groupRows as unknown as Array<{ id: string; name: string; member_count: unknown }>)
    .map((row) => ({
      id: row.id,
      name: row.name,
      memberCount: toNumber(row.member_count),
    }));

  const plans: SalesPlanSummary[] = [];
  for (const row of planRows as unknown as Array<{
    id: string;
    name: string;
    status: SalesPlanStatus;
    period_start: unknown;
    period_end: unknown;
    planned_orders: unknown;
    planned_revenue: unknown;
    group_id: string | null;
    group_name: string | null;
    season_name: string | null;
    target_stock_days: unknown;
  }>) {
    const periodStart = toDateOnly(row.period_start);
    const periodEnd = toDateOnly(row.period_end);
    const plannedOrders = toNumber(row.planned_orders);
    const plannedRevenue = toNumber(row.planned_revenue);
    const fact = await getActualForPlan(tenantId, row.id, periodStart, periodEnd);
    const pace = computePace(periodStart, periodEnd, plannedOrders, fact.actualOrders);
    plans.push({
      id: row.id,
      name: row.name,
      status: row.status,
      periodStart,
      periodEnd,
      groupId: row.group_id,
      groupName: row.group_name,
      seasonName: row.season_name,
      targetStockDays: row.target_stock_days == null ? null : toNumber(row.target_stock_days),
      plannedOrders,
      plannedRevenue,
      actualOrders: fact.actualOrders,
      actualRevenue: fact.actualRevenue,
      ...pace,
    });
  }

  return { groups, plans };
}

export async function createSimpleSalesPlan(
  tenantId: string,
  input: CreateSimpleSalesPlanInput,
): Promise<{ id: string }> {
  const periodStart = normalizeDateOnly(input.periodStart, 'Начало периода');
  const periodEnd = normalizeDateOnly(input.periodEnd, 'Конец периода');
  const days = listDateRange(periodStart, periodEnd);
  const plannedOrders = Math.round(Number(input.plannedOrders));
  if (!Number.isFinite(plannedOrders) || plannedOrders <= 0) {
    throw new Error('План продаж должен быть больше 0 шт.');
  }

  const groupId = input.groupId?.trim();
  if (!groupId) {
    throw new Error('Выберите склейку для плана');
  }

  const averagePrice = Number(input.averagePrice ?? 0);
  const safeAveragePrice = Number.isFinite(averagePrice) && averagePrice > 0 ? averagePrice : 0;
  const basePerDay = Math.floor(plannedOrders / days.length);
  const remainder = plannedOrders % days.length;
  const normalizedName = input.name?.trim() || `План ${periodStart} - ${periodEnd}`;
  const seasonName = input.seasonName?.trim() || null;
  const targetStockDays = Math.max(1, Math.min(180, Math.round(Number(input.targetStockDays ?? 30))));

  const created = await withTenantContext(db, tenantId, async (tx) => {
    const [version] = await tx.insert(salesPlanVersions).values({
      tenantId,
      name: normalizedName,
      periodStart,
      periodEnd,
      status: 'active',
      grain: 'day',
      sourceType: 'manual',
    }).returning({ id: salesPlanVersions.id });

    if (!version?.id) {
      throw new Error('Не удалось создать план продаж');
    }

    await tx.insert(salesPlanLines).values(days.map((day, index) => {
      const dailyOrders = basePerDay + (index < remainder ? 1 : 0);
      return {
        tenantId,
        planId: version.id,
        planDate: day,
        groupId,
        plannedOrders: dailyOrders,
        plannedBuyouts: 0,
        plannedRevenue: roundMoney(dailyOrders * safeAveragePrice),
        notes: input.notes?.trim() || null,
      };
    }));

    if (seasonName) {
      await tx.insert(salesPlanSeasons).values({
        tenantId,
        planId: version.id,
        groupId,
        name: seasonName,
        seasonStart: periodStart,
        seasonEnd: periodEnd,
        demandMultiplier: '1.000',
        targetStockDays,
        notes: input.notes?.trim() || null,
      });
    }

    return { id: version.id };
  });

  return created;
}

export async function archiveSalesPlan(tenantId: string, planId: string): Promise<{ id: string }> {
  const archived = await withTenantContext(db, tenantId, async (tx) => {
    const [row] = await tx.update(salesPlanVersions)
      .set({ status: 'archived', updatedAt: new Date() })
      .where(sql`${salesPlanVersions.tenantId} = ${tenantId} AND ${salesPlanVersions.id} = ${planId}`)
      .returning({ id: salesPlanVersions.id });
    return row;
  });
  if (!archived?.id) {
    throw new Error('План не найден');
  }
  return archived;
}

export async function getSalesPlanSummaryForPeriod(
  tenantId: string,
  periodStart: string,
  periodEnd: string,
  groupId: string | null = null,
): Promise<SalesPlanPeriodSummary | null> {
  const from = normalizeDateOnly(periodStart, 'Начало периода');
  const to = normalizeDateOnly(periodEnd, 'Конец периода');

  return withTenantContext(db, tenantId, async (tx) => {
    const groupFilter = groupId
      ? sql`AND (l.group_id = ${groupId}::uuid OR l.nm_id IN (SELECT nm_id FROM product_group_members WHERE group_id = ${groupId}::uuid))`
      : sql``;

    const plannedRows = await tx.execute(sql`
      SELECT
        COUNT(DISTINCT v.id)::int AS plan_count,
        COALESCE(SUM(l.planned_orders), 0)::int AS planned_orders,
        COALESCE(SUM(l.planned_revenue), 0)::numeric AS planned_revenue
      FROM sales_plan_versions v
      JOIN sales_plan_lines l ON l.plan_id = v.id AND l.tenant_id = v.tenant_id
      WHERE v.tenant_id = ${tenantId}
        AND v.status = 'active'
        AND l.plan_date >= ${from}::date
        AND l.plan_date <= ${to}::date
        ${groupFilter}
    `);
    const planned = (plannedRows as unknown as Array<{
      plan_count: unknown;
      planned_orders: unknown;
      planned_revenue: unknown;
    }>)[0];
    const planCount = toNumber(planned?.plan_count);
    const plannedOrders = toNumber(planned?.planned_orders);
    if (planCount === 0 || plannedOrders === 0) {
      return null;
    }

    const targetRows = await tx.execute(sql`
      SELECT DISTINCT target_nm.nm_id::bigint AS nm_id
      FROM (
        SELECT COALESCE(l.nm_id, gm.nm_id)::bigint AS nm_id
        FROM sales_plan_versions v
        JOIN sales_plan_lines l ON l.plan_id = v.id AND l.tenant_id = v.tenant_id
        LEFT JOIN product_group_members gm ON gm.group_id = l.group_id
        WHERE v.tenant_id = ${tenantId}
          AND v.status = 'active'
          AND l.plan_date >= ${from}::date
          AND l.plan_date <= ${to}::date
          ${groupFilter}
      ) target_nm
      WHERE target_nm.nm_id IS NOT NULL
    `);
    const nmIds = (targetRows as unknown as Array<{ nm_id: unknown }>)
      .map((row) => Number(row.nm_id))
      .filter((nmId) => Number.isFinite(nmId) && nmId > 0);

    let actualOrders = 0;
    let actualRevenue = 0;
    if (nmIds.length > 0) {
      const nmIdList = sql.join(nmIds.map((nmId) => sql`${nmId}`), sql`, `);
      const actualRows = await tx.execute(sql`
        SELECT
          COUNT(*)::int AS actual_orders,
          COALESCE(SUM(total_price), 0)::numeric AS actual_revenue
        FROM raw_api_orders
        WHERE tenant_id = ${tenantId}
          AND is_cancel = false
          AND date::date >= ${from}::date
          AND date::date <= ${to}::date
          AND nm_id IN (${nmIdList})
      `);
      const actual = (actualRows as unknown as Array<{ actual_orders: unknown; actual_revenue: unknown }>)[0];
      actualOrders = toNumber(actual?.actual_orders);
      actualRevenue = toNumber(actual?.actual_revenue);
    }

    const pace = computePace(from, to, plannedOrders, actualOrders);
    return {
      planCount,
      plannedOrders,
      plannedRevenue: toNumber(planned?.planned_revenue),
      actualOrders,
      actualRevenue,
      daysElapsedPct: pace.daysElapsedPct,
      progressPct: pace.progressPct,
      projectedOrders: pace.projectedOrders,
      remainingOrders: pace.remainingOrders,
      paceStatus: pace.paceStatus,
    };
  });
}

export async function getActiveSalesPlanDemandByNm(
  tenantId: string,
  from: string,
  to: string,
): Promise<Map<number, number>> {
  const periodStart = normalizeDateOnly(from, 'Начало периода');
  const periodEnd = normalizeDateOnly(to, 'Конец периода');
  const days = listDateRange(periodStart, periodEnd).length;

  const rows = await withTenantContext(db, tenantId, (tx) => tx.execute(sql`
    WITH group_member_counts AS (
      SELECT group_id, COUNT(*)::numeric AS member_count
      FROM product_group_members
      GROUP BY group_id
    ),
    expanded_lines AS (
      SELECT
        COALESCE(l.nm_id, gm.nm_id)::bigint AS nm_id,
        CASE
          WHEN l.nm_id IS NOT NULL THEN l.planned_orders::numeric
          WHEN gmc.member_count > 0 THEN l.planned_orders::numeric / gmc.member_count
          ELSE 0
        END AS planned_orders
      FROM sales_plan_versions v
      JOIN sales_plan_lines l ON l.plan_id = v.id AND l.tenant_id = v.tenant_id
      LEFT JOIN product_group_members gm ON gm.group_id = l.group_id
      LEFT JOIN group_member_counts gmc ON gmc.group_id = l.group_id
      WHERE v.tenant_id = ${tenantId}
        AND v.status = 'active'
        AND l.plan_date >= ${periodStart}::date
        AND l.plan_date <= ${periodEnd}::date
    )
    SELECT nm_id, (SUM(planned_orders) / ${days})::numeric AS avg_daily_demand
    FROM expanded_lines
    WHERE nm_id IS NOT NULL
    GROUP BY nm_id
  `));

  const result = new Map<number, number>();
  for (const row of rows as unknown as Array<{ nm_id: unknown; avg_daily_demand: unknown }>) {
    const nmId = Number(row.nm_id);
    const avgDailyDemand = toNumber(row.avg_daily_demand);
    if (Number.isFinite(nmId) && nmId > 0 && avgDailyDemand > 0) {
      result.set(nmId, avgDailyDemand);
    }
  }
  return result;
}
