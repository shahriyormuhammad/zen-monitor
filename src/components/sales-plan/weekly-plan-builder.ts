import type { WeeklyRow } from './WeeklyPlanTable';

/**
 * Inputs for synthesizing a 53-week breakdown.
 *
 * This file is *purely deterministic*. It does not call the network or the
 * DB. Once we add server-side weekly storage, the caller will swap this for
 * a query — the consumer (WeeklyPlanTable) does not change.
 */
export type WeeklyPlanBuilderInput = {
  /** Period start date (any day). The first week's Monday is derived from this. */
  startDate: Date;
  /** Total target orders for the entire season. */
  totalOrders: number;
  /** Average selling price after WB SPP discount, RUB. */
  pricePlan: number;
  /** Margin before advertising, fraction (0..1). */
  marginPlan?: number;
  /** Average WB SPP discount applied to the on-sale price, fraction (0..1). */
  sppPct?: number;
  /** Buyout share, %. */
  buyoutPct?: number;
  /** Target DRR (advertising-to-revenue ratio), %. */
  drrTargetPct?: number;
  /** Maximum acceptable DRR, %. */
  drrLimitPct?: number;
  /** Cost of goods per unit (себестоимость), RUB. */
  unitCost?: number;
  /** How many weeks to project (default: 53). */
  weeks?: number;
  /** Optional actual orders so far (from sync). */
  actualOrdersTotal?: number;
  /** Optional actual revenue so far (from sync). */
  actualRevenueTotal?: number;
  /** Optional supply schedule: weeks where deliveries are placed, with qty each. */
  supplies?: { wk: number; qty: number }[];
};

/**
 * Build 53 weekly rows for the Postal-style table. Implements the same
 * formulas the Postal prototype used (cos-wave seasonality, ramp-up, DRR
 * decay, cumulative cash). Server-side replacement comes later.
 */
export function buildWeeklyRows(input: WeeklyPlanBuilderInput): WeeklyRow[] {
  const start = mondayOf(input.startDate);
  const weeks = input.weeks ?? 53;

  const marginPlan = input.marginPlan ?? 0.33;
  const sppPct = input.sppPct ?? 18;
  const buyoutPct = input.buyoutPct ?? 78;
  const drrTarget = input.drrTargetPct ?? 12;
  const drrLimit = input.drrLimitPct ?? 18;
  const unitCost = input.unitCost ?? input.pricePlan * (1 - marginPlan);
  const priceBeforeSpp = sppPct > 0 ? input.pricePlan / (1 - sppPct / 100) : input.pricePlan;

  // Seasonal cos-wave, peak in August
  const coefs: number[] = [];
  for (let i = 0; i < weeks; i++) {
    const monthOfWeek = (start.getMonth() + Math.floor(i / 4.345)) % 12;
    let dist = Math.abs(monthOfWeek - 7);
    if (dist > 6) dist = 12 - dist;
    coefs.push(+(1.6 - (dist / 6) * 1.2).toFixed(2));
  }
  const totalCoef = coefs.reduce((s, c) => s + c, 0) || 1;
  const ramp = (i: number) => (i < 4 ? (i + 1) / 4 : 1);

  // Supply lookup
  const supplyByWk = new Map(input.supplies?.map((s) => [s.wk, s.qty] as const) ?? []);

  // Build rows
  const rows: WeeklyRow[] = [];
  let stock = 0;
  let cumProfit = 0;
  let cumCash = 0;
  let cumInvest = 0;
  const todayMs = Date.now();

  // Fact ratio (if any) — applied uniformly across past weeks
  const factRatio = input.actualOrdersTotal && input.totalOrders > 0
    ? input.actualOrdersTotal / input.totalOrders
    : null;

  for (let i = 0; i < weeks; i++) {
    const weekStart = new Date(start.getTime() + i * 7 * 86400000);
    const isPast = weekStart.getTime() < todayMs - 7 * 86400000;

    const baseSpeed = input.totalOrders * (coefs[i]! / totalCoef);
    const planOrders = Math.max(0, Math.round(baseSpeed * ramp(i)));

    const supplies = supplyByWk.get(i + 1) ?? 0;
    stock += supplies;
    const ordersThisWeek = Math.min(planOrders, Math.max(0, stock));

    const factOrders = isPast && factRatio != null ? Math.round(planOrders * factRatio) : null;
    const effective = isPast && factOrders != null ? factOrders : ordersThisWeek;
    stock = Math.max(0, stock - effective);

    const drr = Math.max(drrTarget, drrLimit - i * 0.3);
    const adCost = (drr / 100) * input.pricePlan * effective;
    const grossMarginRub = input.pricePlan * marginPlan;
    const weekProfit = grossMarginRub * effective - adCost;
    cumProfit += weekProfit;

    const supplyRub = supplies * unitCost;
    cumInvest += supplyRub;
    cumCash += weekProfit - supplyRub;

    const buyoutShtPlan = Math.round(planOrders * (buyoutPct / 100));
    const buyoutShtFact = factOrders != null ? Math.round(factOrders * ((buyoutPct - 4) / 100)) : null;

    rows.push({
      wk: i + 1,
      date: toIso(weekStart),
      dateEnd: toIso(new Date(weekStart.getTime() + 6 * 86400000)),
      monthName: shortMonthRu(weekStart.getMonth()),
      seasonCoef: coefs[i]!,
      coefSeasonPrice: 1,
      coefDemandSupply: 1,
      coefFinal: coefs[i]! * ramp(i),
      compRate7d: Math.round(planOrders * 0.6 / 7),
      pricePlan: input.pricePlan,
      priceFact: isPast ? Math.round(input.pricePlan * (1 + (Math.sin(i) * 0.02))) : null,
      sppPlan: sppPct,
      sppFact: isPast ? +(sppPct + Math.sin(i * 2) * 1.5).toFixed(1) : null,
      priceBeforeSppPlan: priceBeforeSpp,
      priceBeforeSppFact: isPast ? Math.round(priceBeforeSpp) : null,
      marginPlan,
      marginFact: isPast ? marginPlan : null,
      ramp: ramp(i),
      planOrders,
      factOrders,
      buyoutPlan: buyoutPct,
      buyoutFact: isPast ? +(buyoutPct - 4).toFixed(0) : null,
      buyoutShtPlan,
      buyoutShtFact,
      supplies,
      supplyRub,
      stockPlan: stock,
      stockFact: isPast ? Math.round(stock * 1.05) : null,
      stockDays: effective > 0 ? Math.round(stock / (effective / 7)) : null,
      investments: cumInvest,
      drrPlan: drr,
      drrFact: isPast ? +(drr + (Math.cos(i) * 2)).toFixed(1) : null,
      adCost,
      externalCosts: 0,
      drrTotalPct: drr,
      marginAfterDrrPct: marginPlan - drr / 100,
      toTransfer: input.pricePlan * 0.86 * effective,
      taxPct: 7,
      taxRub: input.pricePlan * 0.07 * effective,
      weekProfit,
      cumProfit,
      cumCash,
    });
  }

  return rows;
}

function mondayOf(d: Date): Date {
  const x = new Date(d);
  const day = x.getDay();
  const diff = day === 0 ? 6 : day - 1;
  x.setDate(x.getDate() - diff);
  x.setHours(0, 0, 0, 0);
  return x;
}
function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function shortMonthRu(idx: number): string {
  return ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'][idx] ?? '';
}
