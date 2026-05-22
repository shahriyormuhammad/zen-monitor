import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';

import { apiRoute } from '@/lib/api-response';
import { requireActiveTenant } from '@/lib/auth/tenant-access';
import { db, withTenantContext } from '@/lib/db';
import { parseApiDateParam, toLocalDateParam } from '@/lib/date-range';
import { AnalyticsEngine } from '@/server/analytics/engine';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type GroupRow = {
  id: string;
  name: string;
  memberCount: number | string;
  visibleMemberCount: number | string;
};

type SummaryMetrics = {
  revenue: number;
  profit: number;
  expenses: number;
  roi: number;
  buyoutRate: number;
  ads: number;
  adsCpo: number;
  orders: number;
  buyouts: number;
  stocks: number;
  lostOrders: number;
  lostOrdersSum: number;
};

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeGroupName(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');
}

function metricValue(kpi: Record<string, unknown>, key: string) {
  const metric = kpi[key];
  if (!metric || typeof metric !== 'object') {
    return 0;
  }

  return toNumber((metric as { value?: unknown }).value);
}

function addUtcDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function getInclusiveDayCount(from: Date, to: Date) {
  return Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1);
}

function isFirstDayOfMonthUtc(date: Date) {
  return date.getUTCDate() === 1;
}

function isLastDayOfMonthUtc(date: Date) {
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  return date.getUTCDate() === lastDay;
}

function resolveComparisonPeriod(currentFrom: Date, currentTo: Date) {
  const isCurrentMonthToDate = (
    isFirstDayOfMonthUtc(currentFrom)
    && currentFrom.getUTCFullYear() === currentTo.getUTCFullYear()
    && currentFrom.getUTCMonth() === currentTo.getUTCMonth()
  );
  const isFullCalendarMonth = isCurrentMonthToDate && isLastDayOfMonthUtc(currentTo);

  if (isFullCalendarMonth) {
    const previousMonthStart = new Date(Date.UTC(
      currentFrom.getUTCFullYear(),
      currentFrom.getUTCMonth() - 1,
      1,
    ));
    const previousMonthEnd = new Date(Date.UTC(
      previousMonthStart.getUTCFullYear(),
      previousMonthStart.getUTCMonth() + 1,
      0,
    ));
    return {
      from: previousMonthStart,
      to: previousMonthEnd,
      days: getInclusiveDayCount(previousMonthStart, previousMonthEnd),
    };
  }

  if (isCurrentMonthToDate) {
    const previousMonthStart = new Date(Date.UTC(
      currentFrom.getUTCFullYear(),
      currentFrom.getUTCMonth() - 1,
      1,
    ));
    const previousMonthLastDay = new Date(Date.UTC(
      previousMonthStart.getUTCFullYear(),
      previousMonthStart.getUTCMonth() + 1,
      0,
    )).getUTCDate();
    const dayOfMonth = currentTo.getUTCDate();
    const previousMonthTo = new Date(Date.UTC(
      previousMonthStart.getUTCFullYear(),
      previousMonthStart.getUTCMonth(),
      Math.min(dayOfMonth, previousMonthLastDay),
    ));
    return {
      from: previousMonthStart,
      to: previousMonthTo,
      days: getInclusiveDayCount(previousMonthStart, previousMonthTo),
    };
  }

  const periodDays = getInclusiveDayCount(currentFrom, currentTo);
  const previousTo = addUtcDays(currentFrom, -1);
  const previousFrom = addUtcDays(previousTo, -(periodDays - 1));
  return { from: previousFrom, to: previousTo, days: periodDays };
}

function buildMetrics(kpi: Record<string, unknown>): SummaryMetrics {
  const revenue = metricValue(kpi, 'revenue');
  const realizedRevenue = metricValue(kpi, 'realizedRevenue');
  const cogs = metricValue(kpi, 'cogs');
  const profit = metricValue(kpi, 'profit');
  // Расходы = реализация после СПП − прибыль (СПП финансирует WB). ROI = прибыль / себестоимость.
  const expenses = Math.max(realizedRevenue - profit, 0);
  const roi = cogs > 0 ? (profit / cogs) * 100 : 0;
  const buyoutRate = metricValue(kpi, 'buyoutRate');
  const ads = metricValue(kpi, 'ads');
  const adsCpo = metricValue(kpi, 'adsCpo');
  const orders = metricValue(kpi, 'orders');
  const buyouts = metricValue(kpi, 'buyouts');
  const stocks = metricValue(kpi, 'stocks');
  const lostOrders = metricValue(kpi, 'lostOrders');
  const lostOrdersSum = metricValue(kpi, 'lostOrdersSum');

  return {
    revenue,
    profit,
    expenses,
    roi,
    buyoutRate,
    ads,
    adsCpo,
    orders,
    buyouts,
    stocks,
    lostOrders,
    lostOrdersSum,
  };
}

function buildDelta(current: SummaryMetrics, previous: SummaryMetrics): SummaryMetrics {
  return {
    revenue: current.revenue - previous.revenue,
    profit: current.profit - previous.profit,
    expenses: current.expenses - previous.expenses,
    roi: current.roi - previous.roi,
    buyoutRate: current.buyoutRate - previous.buyoutRate,
    ads: current.ads - previous.ads,
    adsCpo: current.adsCpo - previous.adsCpo,
    orders: current.orders - previous.orders,
    buyouts: current.buyouts - previous.buyouts,
    stocks: current.stocks - previous.stocks,
    lostOrders: current.lostOrders - previous.lostOrders,
    lostOrdersSum: current.lostOrdersSum - previous.lostOrdersSum,
  };
}

function buildDeltaPct(current: SummaryMetrics, previous: SummaryMetrics) {
  return Object.fromEntries(
    (Object.keys(current) as Array<keyof SummaryMetrics>).map((key) => {
      const previousValue = previous[key];
      return [
        key,
        previousValue === 0 ? null : ((current[key] - previousValue) / Math.abs(previousValue)) * 100,
      ];
    }),
  ) as Record<keyof SummaryMetrics, number | null>;
}

export const GET = apiRoute(async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  if (!from || !to) {
    return NextResponse.json({ error: 'Нужны параметры from и to' }, { status: 400 });
  }

  const parsedFrom = parseApiDateParam(from);
  const parsedTo = parseApiDateParam(to);
  if (!parsedFrom || !parsedTo) {
    return NextResponse.json({ error: 'Неверные параметры даты' }, { status: 400 });
  }

  if (parsedTo.getTime() < parsedFrom.getTime()) {
    return NextResponse.json({ error: 'Дата to должна быть не раньше from' }, { status: 400 });
  }

  const comparisonPeriod = resolveComparisonPeriod(parsedFrom, parsedTo);
  const previousFrom = comparisonPeriod.from;
  const previousTo = comparisonPeriod.to;
  const periodDays = comparisonPeriod.days;
  const { tenantId } = await requireActiveTenant(request);
  const [groups, visibleProductsCountRows] = await withTenantContext(db, tenantId, (tx) => Promise.all([
    tx.execute(sql<GroupRow>`
      SELECT
        pg.id,
        pg.name,
        COUNT(gm.nm_id)::int AS "memberCount",
        COUNT(DISTINCT gm.nm_id) FILTER (WHERE COALESCE(p.is_hidden, FALSE) = FALSE)::int AS "visibleMemberCount"
      FROM product_groups pg
      LEFT JOIN product_group_members gm ON gm.group_id = pg.id
      LEFT JOIN products p
        ON p.tenant_id = pg.tenant_id
       AND p.nm_id = gm.nm_id
      WHERE pg.tenant_id = ${tenantId}
      GROUP BY pg.id, pg.name
      ORDER BY pg.name ASC
      LIMIT 100
    `),
    tx.execute<{ total: number }>(sql`
      SELECT COUNT(*)::int AS total
      FROM products p
      WHERE p.tenant_id = ${tenantId}
        AND COALESCE(p.is_hidden, FALSE) = FALSE
    `),
  ]));
  const visibleProductsCount = Math.max(0, toNumber(visibleProductsCountRows[0]?.total));

  const groupRows = groups as unknown as GroupRow[];
  const rows = await Promise.all(groupRows.map(async (group) => {
    const visibleMemberCount = Math.max(0, toNumber(group.visibleMemberCount));
    const isNamedWholeStore = normalizeGroupName(group.name) === 'весь магазин';
    const isFullScopeByCoverage = visibleProductsCount > 0 && visibleMemberCount >= visibleProductsCount;
    const effectiveGroupId = isNamedWholeStore || isFullScopeByCoverage ? null : group.id;
    const [kpi, previousKpi] = await Promise.all([
      AnalyticsEngine.getKpis(tenantId, parsedFrom, parsedTo, {
        calculationMode: 'FACT_WB',
        groupId: effectiveGroupId,
      }) as Promise<Record<string, unknown>>,
      AnalyticsEngine.getKpis(tenantId, previousFrom, previousTo, {
        calculationMode: 'FACT_WB',
        groupId: effectiveGroupId,
      }) as Promise<Record<string, unknown>>,
    ]);
    const current = buildMetrics(kpi);
    const previous = buildMetrics(previousKpi);
    const delta = buildDelta(current, previous);

    return {
      id: group.id,
      name: group.name,
      memberCount: toNumber(group.memberCount),
      ...current,
      previous,
      delta,
      deltaPct: buildDeltaPct(current, previous),
      comparisonPeriod: {
        from: toLocalDateParam(previousFrom),
        to: toLocalDateParam(previousTo),
        days: periodDays,
      },
      flags: {
        negativeProfit: current.profit < 0,
        lowBuyout: current.buyoutRate > 0 && current.buyoutRate < 70,
        highCpo: current.adsCpo > 0 && current.buyouts > 0 && current.adsCpo > Math.max(current.revenue / Math.max(current.buyouts, 1) * 0.2, 80),
        stockRisk: current.lostOrders > 0 || current.lostOrdersSum > 0,
      },
    };
  }));

  return NextResponse.json({ data: rows });
});
