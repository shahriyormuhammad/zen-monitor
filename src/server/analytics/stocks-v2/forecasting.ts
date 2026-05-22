/**
 * Pure forecasting / safety stock helpers for the new Stocks 2.0 stack (P87).
 *
 * Все функции pure: одно входное значение → одно выходное, никакой БД и
 * никакого I/O. Тестируются отдельно от сервиса.
 *
 * Источник формул:
 *   - EWMA (Exponentially Weighted Moving Average) — стандартный demand
 *     forecasting. Чем выше α, тем сильнее вес у недавних дней.
 *   - Safety stock = Z × σ_demand × √lead_time — формула из ISM/NetSuite,
 *     учитывает изменчивость спроса и срок поставки.
 *   - ROP (Reorder Point) = avg_daily_demand × lead_time + safety_stock.
 *   - Service level Z-scores: 99%=2.33, 95%=1.65, 90%=1.28 — из стандартной
 *     нормальной таблицы.
 */

export type StockStatus = 'critical' | 'warning' | 'ok' | 'overstock';

export type AbcBucket = 'A' | 'B' | 'C' | 'unrated';

/**
 * Z-score for a target service level. Higher service level → bigger buffer.
 *
 * Используется как зависимость от ABC-категории SKU:
 *   - A (топ выручка / "критично иметь в наличии")  → 99% → Z=2.33
 *   - B (средние)                                    → 95% → Z=1.65
 *   - C (хвост)                                      → 90% → Z=1.28
 *   - unrated (нет данных по выручке)                → 95% — безопасный
 *     дефолт.
 */
export function getZScoreForAbc(bucket: AbcBucket): number {
  switch (bucket) {
    case 'A': return 2.33;
    case 'B': return 1.65;
    case 'C': return 1.28;
    case 'unrated': return 1.65;
  }
}

/**
 * EWMA over a daily-demand series. Если входной массив пуст — 0.
 *
 * @param dailyDemand — массив количеств заказов по дням (от старых к новым).
 * @param alpha — вес недавних точек. 0..1. Default: 0.3 (умеренная реакция).
 *   Для волатильных SKU (Z в XYZ) — рекомендуется 0.5.
 */
export function computeEwma(dailyDemand: readonly number[], alpha: number = 0.3): number {
  if (!Array.isArray(dailyDemand) || dailyDemand.length === 0) return 0;
  const a = Math.min(1, Math.max(0, alpha));
  let ewma = dailyDemand[0] ?? 0;
  for (let i = 1; i < dailyDemand.length; i += 1) {
    const value = Number.isFinite(dailyDemand[i]) ? (dailyDemand[i] as number) : 0;
    ewma = a * value + (1 - a) * ewma;
  }
  return ewma;
}

/**
 * Sample standard deviation of a series (Bessel-correction). Если меньше 2
 * точек — 0.
 */
export function computeStdDev(values: readonly number[]): number {
  if (!Array.isArray(values) || values.length < 2) return 0;
  const finite = values.filter((v) => Number.isFinite(v)) as number[];
  if (finite.length < 2) return 0;
  const mean = finite.reduce((sum, v) => sum + v, 0) / finite.length;
  const variance = finite.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (finite.length - 1);
  return Math.sqrt(variance);
}

/**
 * Safety stock = Z × σ × √L.
 *
 * @param zScore — z-score для целевого service level.
 * @param sigmaDemand — std dev суточного спроса.
 * @param leadTimeDays — срок поставки в днях.
 *
 * @returns целое число единиц. Round-up чтобы запас был не хуже целевого.
 */
export function computeSafetyStock(
  zScore: number,
  sigmaDemand: number,
  leadTimeDays: number,
): number {
  if (!Number.isFinite(zScore) || !Number.isFinite(sigmaDemand) || !Number.isFinite(leadTimeDays)) {
    return 0;
  }
  if (zScore <= 0 || sigmaDemand <= 0 || leadTimeDays <= 0) return 0;
  return Math.ceil(zScore * sigmaDemand * Math.sqrt(leadTimeDays));
}

/**
 * Reorder Point — уровень запаса, при котором надо размещать заказ
 * поставщику чтобы успеть до OOS.
 *
 * ROP = средний дневной спрос × срок поставки + safety stock.
 */
export function computeRop(
  avgDailyDemand: number,
  leadTimeDays: number,
  safetyStock: number,
): number {
  if (!Number.isFinite(avgDailyDemand) || !Number.isFinite(leadTimeDays)) return 0;
  if (avgDailyDemand < 0 || leadTimeDays < 0) return 0;
  const safety = Number.isFinite(safetyStock) && safetyStock > 0 ? safetyStock : 0;
  return Math.ceil(avgDailyDemand * leadTimeDays + safety);
}

/**
 * На сколько дней хватит запаса при текущем спросе. Если спрос 0 — Infinity
 * (товар лежит мёртвым грузом, статус будет overstock или unrated).
 */
export function computeDaysLeft(totalAvailable: number, avgDailyDemand: number): number {
  if (!Number.isFinite(totalAvailable) || totalAvailable <= 0) return 0;
  if (!Number.isFinite(avgDailyDemand) || avgDailyDemand <= 0) return Number.POSITIVE_INFINITY;
  return totalAvailable / avgDailyDemand;
}

/**
 * Светофор-статус.
 *
 * Логика:
 *   - daysLeft < leadTime           → critical (красный, OOS до прихода)
 *   - daysLeft < leadTime + 14      → warning  (жёлтый, подходит к ROP)
 *   - daysLeft > 60 + leadTime      → overstock (синий, слишком много)
 *   - daysLeft = ∞ AND totalAvail>0 → overstock (продаж нет вообще)
 *   - иначе                          → ok      (зелёный)
 */
export function computeStockStatus(
  daysLeft: number,
  leadTimeDays: number,
  totalAvailable: number,
): StockStatus {
  const lead = Number.isFinite(leadTimeDays) && leadTimeDays > 0 ? leadTimeDays : 0;
  if (!Number.isFinite(daysLeft)) {
    return totalAvailable > 0 ? 'overstock' : 'critical';
  }
  if (totalAvailable <= 0) return 'critical';
  if (daysLeft < lead) return 'critical';
  if (daysLeft < lead + 14) return 'warning';
  if (daysLeft > 60 + lead) return 'overstock';
  return 'ok';
}

/**
 * Сколько докупить чтобы покрыть N дней + safety stock.
 *
 * @param targetDays — целевое покрытие (по умолчанию 30 дней).
 * @param avgDailyDemand — средний дневной спрос.
 * @param safetyStock — желаемый страховой запас.
 * @param totalAvailable — что у нас уже есть (WB + свой + в пути + в производстве).
 *
 * @returns целое число единиц для заказа. Никогда не отрицательное.
 */
export function computeRecommendQuantity(
  targetDays: number,
  avgDailyDemand: number,
  safetyStock: number,
  totalAvailable: number,
): number {
  const target = Number.isFinite(targetDays) && targetDays > 0 ? targetDays : 0;
  const demand = Number.isFinite(avgDailyDemand) && avgDailyDemand > 0 ? avgDailyDemand : 0;
  const safety = Number.isFinite(safetyStock) && safetyStock > 0 ? safetyStock : 0;
  const available = Number.isFinite(totalAvailable) && totalAvailable > 0 ? totalAvailable : 0;
  const need = Math.ceil(target * demand) + safety - available;
  return need > 0 ? need : 0;
}

/**
 * Распределение «overhead» (доставка + таможня) на одну line партии. Pro-rata
 * по доле line в общей стоимости товаров; если общая стоимость 0 (закупка
 * без указания цен), fallback — пропорция по количеству.
 *
 * @param lineGoodsTotal  — стоимость товаров в этой line (qty × unit cost).
 * @param allLinesGoodsTotal — сумма по всем lines партии.
 * @param lineQty          — количество в этой line.
 * @param allLinesQty      — суммарное количество в партии.
 * @param overheadTotal    — общий overhead партии (shipping + customs).
 *
 * @returns доля overhead'а на эту line в той же валюте, что и overhead.
 *   Никогда не отрицательное. 0 если overhead 0 или входы невалидные.
 */
export function distributeOverheadShare(
  lineGoodsTotal: number,
  allLinesGoodsTotal: number,
  lineQty: number,
  allLinesQty: number,
  overheadTotal: number,
): number {
  if (!Number.isFinite(overheadTotal) || overheadTotal <= 0) return 0;
  if (allLinesGoodsTotal > 0 && Number.isFinite(lineGoodsTotal) && lineGoodsTotal > 0) {
    return overheadTotal * (lineGoodsTotal / allLinesGoodsTotal);
  }
  if (allLinesQty > 0 && Number.isFinite(lineQty) && lineQty > 0) {
    return overheadTotal * (lineQty / allLinesQty);
  }
  return 0;
}

/**
 * Полная (landed) себестоимость единицы для одной line после
 * распределения overhead'а.
 *
 * @returns NaN-safe number ≥ 0.
 */
export function computeLandedCostPerUnit(
  lineGoodsTotal: number,
  lineQty: number,
  overheadShare: number,
): number {
  if (!Number.isFinite(lineQty) || lineQty <= 0) return 0;
  const goods = Number.isFinite(lineGoodsTotal) && lineGoodsTotal > 0 ? lineGoodsTotal : 0;
  const overhead = Number.isFinite(overheadShare) && overheadShare > 0 ? overheadShare : 0;
  const totalCost = goods + overhead;
  return totalCost / lineQty;
}

/**
 * ABC-классификация: накопительная доля выручки.
 *
 * @param itemsByRevenue — массив (nmId, revenue) — отсортированный по
 *   revenue DESC.
 * @param thresholdA — доля верхушки в категории A (default 80%).
 * @param thresholdB — доля верхушки в категории A+B (default 95%).
 *
 * @returns Map<nmId, AbcBucket>. SKU без выручки получают 'unrated'.
 */
export function classifyAbc(
  itemsByRevenue: readonly { nmId: number; revenue: number }[],
  thresholdA: number = 0.8,
  thresholdB: number = 0.95,
): Map<number, AbcBucket> {
  const map = new Map<number, AbcBucket>();
  if (!Array.isArray(itemsByRevenue) || itemsByRevenue.length === 0) return map;

  const positive = itemsByRevenue.filter((item) => Number.isFinite(item.revenue) && item.revenue > 0);
  if (positive.length === 0) {
    for (const item of itemsByRevenue) map.set(item.nmId, 'unrated');
    return map;
  }

  const sorted = [...positive].sort((a, b) => b.revenue - a.revenue);
  const totalRevenue = sorted.reduce((sum, item) => sum + item.revenue, 0);
  let cumulative = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    const item = sorted[i] as { nmId: number; revenue: number };
    cumulative += item.revenue;
    const share = cumulative / totalRevenue;
    // Edge case: top-1 SKU is always A even if it represents 100% of revenue
    // (single-item assortment → otherwise it would land in C).
    if (i === 0) map.set(item.nmId, 'A');
    else if (share <= thresholdA) map.set(item.nmId, 'A');
    else if (share <= thresholdB) map.set(item.nmId, 'B');
    else map.set(item.nmId, 'C');
  }
  // Items with zero/negative revenue → unrated.
  for (const item of itemsByRevenue) {
    if (!map.has(item.nmId)) map.set(item.nmId, 'unrated');
  }
  return map;
}
