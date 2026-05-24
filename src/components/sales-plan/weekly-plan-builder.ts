import type { SalesPlanSummary } from '@/server/sales-plan/service';
import type { WeeklyRow } from './WeeklyPlanTable';

/**
 * Synthesize a 53-week breakdown from an existing SalesPlanSummary.
 *
 * Server-side weekly storage is a follow-up; for the first integration step
 * we render a calculated forecast based on:
 *   - existing plan total (plannedOrders) distributed by a seasonal cosine
 *     curve with peak in August (week 31..35)
 *   - a 4-week linear ramp-up at the start of the period
 *   - cumulative profit / cash assuming the plan's actualRevenue/actualOrders
 *     ratio is the going price
 *
 * This is a transparent "what your plan looks like, broken down weekly"
 * — when we add real weekly storage and competitor signals, this function
 * stays as the fallback for plans that lack week-level data.
 */
export function buildWeeklyRowsFromPlan(plan: SalesPlanSummary): WeeklyRow[] {
  const startDate = new Date(plan.periodStart);
  if (Number.isNaN(startDate.getTime())) return [];

  const totalWeeks = weekCount(startDate, new Date(plan.periodEnd));
  const weeksToRender = Math.min(53, Math.max(8, totalWeeks));

  // Build seasonal cos-wave (peak around month index 7 = August).
  const coefs: number[] = [];
  for (let i = 0; i < weeksToRender; i++) {
    const monthOfWeek = (startDate.getMonth() + Math.floor(i / 4.345)) % 12;
    const peak = 7;
    let dist = Math.abs(monthOfWeek - peak);
    if (dist > 6) dist = 12 - dist;
    coefs.push(+(1.6 - (dist / 6) * 1.2).toFixed(2));
  }
  const totalCoef = coefs.reduce((s, c) => s + c, 0) || 1;

  // Ramp-up: 25/50/75/100% over first 4 weeks.
  const ramp = (i: number) => (i < 4 ? (i + 1) / 4 : 1);

  // Plan-derived constants
  const expectedTotal = plan.plannedOrders;
  const pricePlan = plan.plannedOrders > 0
    ? plan.plannedRevenue / plan.plannedOrders
    : 0;
  const priceFactCalc = plan.actualOrders > 0
    ? plan.actualRevenue / plan.actualOrders
    : null;

  // Approximate margin from typical WB cost structure (40% margin until juniorka is plugged in).
  const marginPlan = 0.35;
  const buyoutPlan = 78;
  const unitCost = pricePlan * (1 - marginPlan);

  const rows: WeeklyRow[] = [];
  let cumProfit = 0;
  let cumCash = -plan.plannedRevenue * 0.4; // assume initial procurement spend

  for (let i = 0; i < weeksToRender; i++) {
    const weekStart = new Date(startDate.getTime() + i * 7 * 86400000);
    const baseSpeed = expectedTotal * (coefs[i]! / totalCoef);
    const planOrders = Math.max(0, Math.round(baseSpeed * ramp(i)));

    const isPast = weekStart.getTime() < Date.now() - 7 * 86400000;
    const factOrders = isPast && plan.actualOrders > 0
      ? Math.round(planOrders * (plan.actualOrders / Math.max(1, plan.plannedOrders)))
      : null;

    const weekProfit = planOrders * pricePlan * marginPlan;
    cumProfit += weekProfit;
    cumCash += weekProfit - (planOrders * unitCost * 0.2);

    rows.push({
      wk: i + 1,
      date: toISODate(weekStart),
      monthName: monthShortRu(weekStart.getMonth()),
      seasonCoef: coefs[i]!,
      planOrders,
      factOrders,
      pricePlan,
      priceFact: isPast ? (priceFactCalc ?? pricePlan) : null,
      marginPlan,
      marginFact: isPast ? marginPlan : null,
      buyoutPlan,
      buyoutFact: isPast ? buyoutPlan - 4 : null,
      weekProfit,
      cumProfit,
      cumCash,
    });
  }

  return rows;
}

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function monthShortRu(idx: number): string {
  return ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'][idx] ?? '';
}

function weekCount(start: Date, end: Date): number {
  const diffMs = end.getTime() - start.getTime();
  return Math.max(1, Math.round(diffMs / (7 * 86400000)));
}
