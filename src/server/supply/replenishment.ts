/**
 * Расчёт пополнения (replenishment) — порт движка «Поставлено» 1:1.
 *
 * Реверс из их бандла + сверка на реальной строке слепка (A676-14 разм.44):
 *   ordersAverage 0.06, …СВыкупом 0.04, forecastRemainder 2, daysOnReturns 3,
 *   горизонт 30 → Отгрузить = (3×0.06 + 0.04×27)×1 − 2 = −0.74 → 0 ✓; оборачиваемость 48.5 ✓.
 *
 * Модель списания склада двухрежимная: первые `daysOnReturns` дней (возвраты ещё
 * не вернулись) склад тает по ВАЛОВЫМ заказам, дальше — по ВЫКУПАМ
 * (ordersAverage × %выкупа). Тренд — ручной множитель спроса.
 *
 * Чистые функции, без БД/сети. Источник данных подключается отдельным слоем.
 */

/** % выкупа = продажи/заказы (окно 8 недель). <10 заказов или товар <24 дней → 100%. */
export function percentBuyout(
  salesCount: number,
  ordersCount: number,
  opts?: { ordersCountForRule?: number; daysOnSale?: number },
): number {
  const ruleOrders = opts?.ordersCountForRule ?? ordersCount;
  const daysOnSale = opts?.daysOnSale ?? Infinity;
  if (ruleOrders < 10 || daysOnSale < 24) return 100;
  if (ordersCount <= 0) return 100;
  return (salesCount / ordersCount) * 100;
}

/** Заказов в день = заказы по гео / дней периода анализа. */
export function ordersAverage(ordersGeo: number, periodDays: number): number {
  if (periodDays <= 0) return 0;
  return ordersGeo / periodDays;
}

/** Заказов в день с учётом выкупа = скорость списания склада = заказы/день × %выкупа. */
export function ordersAverageWithBuyout(ordersAvg: number, percentBuyoutValue: number): number {
  return ordersAvg * (percentBuyoutValue / 100);
}

/**
 * Прогнозный остаток на момент прихода поставки.
 * = остаток + в пути к клиенту×(1−%выкупа) + в пути от клиента (возвраты).
 */
export function forecastRemainder(
  quantity: number,
  inWayToClient: number,
  inWayFromClient: number,
  percentBuyoutValue: number,
): number {
  const buyoutFrac = percentBuyoutValue / 100;
  return quantity + inWayToClient * (1 - buyoutFrac) + inWayFromClient;
}

/** Заказов за время доставки (расход, пока поставка едет) = заказы/день × %выкупа × дней доставки. */
export function ordersByDeliveryDays(
  ordersAvg: number,
  percentBuyoutValue: number,
  deliveryDays: number,
): number {
  return ordersAvg * (percentBuyoutValue / 100) * deliveryDays;
}

/** Общий вход для формул запаса/отгрузки на склад (или общий по гео). */
export type ReplenishmentInput = {
  /** Дней «на возвраты» — окно валовой скорости (по умолч. 3). */
  daysOnReturns: number;
  /** Горизонт планирования, дней (на сколько везём). */
  forecastOrdersDays: number;
  /** Заказов в день (валовая скорость). */
  ordersAverage: number;
  /** Заказов в день с учётом выкупа (скорость списания). */
  ordersAverageWithBuyout: number;
  /** Коэффициент тренда (ручной множитель спроса). ≤0/undefined → 1. */
  trendK?: number | null;
  /** Товары на пути в WB (приёмка). */
  inWayToFBO: number;
  /** Прогнозный остаток на момент прихода. */
  forecastRemainder: number;
  /** Остатки конкурентных складов кластера (чужие FBO). */
  competitiveWarehouse?: number;
  /** Учитывать ли конкурентные остатки. */
  considerCompetitive?: boolean;
  /** Расход за время доставки (вычитается из доступного). */
  ordersByDeliveryDays?: number;
};

function normTrend(trendK?: number | null): number {
  return trendK && trendK > 0 ? trendK : 1;
}

/** Доступный остаток к моменту прихода поставки (floor 0). */
function availableStock(i: ReplenishmentInput): number {
  const competitive = i.considerCompetitive ? i.competitiveWarehouse ?? 0 : 0;
  return Math.max(0, i.inWayToFBO + i.forecastRemainder + competitive - (i.ordersByDeliveryDays ?? 0));
}

/**
 * «Отгрузить на склад» (рекомендация поставки), floor 0.
 *
 * целевой запас на горизонт = (daysOnReturns × заказы/день
 *   + заказы/деньСВыкупом × (горизонт − daysOnReturns)) × тренд
 * минус доступный остаток.
 */
export function calculateResult(i: ReplenishmentInput): number {
  const trend = normTrend(i.trendK);
  const available = availableStock(i);
  const target =
    (i.daysOnReturns * i.ordersAverage +
      i.ordersAverageWithBuyout * (i.forecastOrdersDays - i.daysOnReturns)) *
    trend;
  const ship = Math.trunc(target - available);
  return ship < 0 ? 0 : ship;
}

/** Округление отгрузки вверх до кратности короба. */
export function applyMultiplicity(ship: number, multiplicity: number): number {
  if (multiplicity <= 1) return ship;
  return Math.ceil(ship / multiplicity) * multiplicity;
}

/**
 * Оборачиваемость / запас хода в днях БЕЗ новой поставки.
 * Первые daysOnReturns дней — по валовым заказам, дальше — по выкупам; ÷ тренд.
 */
export function turnoverDays(i: ReplenishmentInput): number {
  const competitive = i.considerCompetitive ? i.competitiveWarehouse ?? 0 : 0;
  const available = i.inWayToFBO + i.forecastRemainder + competitive;
  const grossWindow = i.daysOnReturns * i.ordersAverage;
  let days: number;
  if (available > grossWindow) {
    if (i.ordersAverageWithBuyout <= 0) return 0;
    days = (available - grossWindow) / i.ordersAverageWithBuyout + i.daysOnReturns;
  } else {
    if (i.ordersAverage <= 0) return 0;
    days = available / i.ordersAverage;
  }
  const trend = normTrend(i.trendK);
  if (trend > 0) days /= trend;
  return days;
}

/** «Хватит на дней» ПОСЛЕ отгрузки рекомендованного кол-ва (с учётом расхода в пути). */
export function estimatedWarehouseLoad(i: ReplenishmentInput, ship: number): number {
  const competitive = i.considerCompetitive ? i.competitiveWarehouse ?? 0 : 0;
  const available =
    Math.max(0, i.inWayToFBO + i.forecastRemainder + competitive - (i.ordersByDeliveryDays ?? 0)) + ship;
  const grossWindow = i.daysOnReturns * i.ordersAverage;
  let days: number;
  if (available > grossWindow) {
    if (i.ordersAverageWithBuyout <= 0) return 0;
    days = (available - grossWindow) / i.ordersAverageWithBuyout + i.daysOnReturns;
  } else {
    if (i.ordersAverage <= 0) return 0;
    days = available / i.ordersAverage;
  }
  const trend = normTrend(i.trendK);
  if (trend > 0) days /= trend;
  return Math.round(days);
}
