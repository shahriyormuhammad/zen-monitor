/**
 * Локализация WB: Доля локализации / КТР / КРП / ИЛ / ИРП.
 *
 * Порт «Поставлено» 1:1 (реверс из их бандла, слепок 2026-06-16, проект 79274139489).
 * WB даёт скидку/наценку на прямую логистику в зависимости от ЛОКАЛИЗАЦИИ —
 * доли заказов артикула, отгруженных из «правильного» (локального) кластера.
 *
 * Поток: на каждый (артикул×размер) считаем долю локализации → по таблицам
 * KTR/KRP берём множители → агрегируем в индексы проекта ИЛ/ИРП.
 *   • КТР — множитель базовой логистики (чем выше локализация, тем ниже, до 0.5).
 *   • КРП — штраф за нелокальные продажи; обнуляется при локализации ≥ 60%.
 *   • ИЛ  = Σ(заказы×КТР)/Σзаказы — орд-взвешенный средний КТР проекта.
 *   • ИРП = Σ(заказы×КРП)/Σзаказы.
 *
 * Таблицы коэффициентов — единые для всех (window.POSTAVLENO.KTR/KRP_COEFFICIENTS).
 * Сверено на реальной строке слепка: доля 67.44% → КТР 1.0, КРП 0; 77.78% → КТР 0.9.
 */

/** Диапазоны «локализация % → КТР». Границы — нижние, по возрастанию. */
const KTR_TABLE: ReadonlyArray<{ from: number; ktr: number }> = [
  { from: 0, ktr: 2.0 },
  { from: 5, ktr: 1.8 },
  { from: 10, ktr: 1.75 },
  { from: 15, ktr: 1.7 },
  { from: 20, ktr: 1.6 },
  { from: 25, ktr: 1.55 },
  { from: 30, ktr: 1.5 },
  { from: 35, ktr: 1.4 },
  { from: 40, ktr: 1.3 },
  { from: 45, ktr: 1.2 },
  { from: 50, ktr: 1.1 },
  { from: 55, ktr: 1.05 },
  { from: 60, ktr: 1.0 },
  { from: 75, ktr: 0.9 },
  { from: 80, ktr: 0.8 },
  { from: 85, ktr: 0.7 },
  { from: 90, ktr: 0.6 },
  { from: 95, ktr: 0.5 },
];

/** Диапазоны «локализация % → КРП». КРП = 0 при доле ≥ 60% (порог локализации). */
const KRP_TABLE: ReadonlyArray<{ from: number; krp: number }> = [
  { from: 0, krp: 2.5 },
  { from: 5, krp: 2.45 },
  { from: 10, krp: 2.35 },
  { from: 15, krp: 2.3 },
  { from: 20, krp: 2.25 },
  { from: 25, krp: 2.2 },
  { from: 30, krp: 2.15 },
  { from: 35, krp: 2.1 },
  { from: 45, krp: 2.05 },
  { from: 55, krp: 2.0 },
  { from: 60, krp: 0.0 },
];

/** КТР по доле локализации (%). share вне [0..100] клампится. */
export function ktrForShare(localizationShare: number): number {
  const s = Math.max(0, Math.min(100, localizationShare));
  let ktr = KTR_TABLE[0]!.ktr;
  for (const row of KTR_TABLE) {
    if (s >= row.from) ktr = row.ktr;
    else break;
  }
  return ktr;
}

/** КРП по доле локализации (%). */
export function krpForShare(localizationShare: number): number {
  const s = Math.max(0, Math.min(100, localizationShare));
  let krp = KRP_TABLE[0]!.krp;
  for (const row of KRP_TABLE) {
    if (s >= row.from) krp = row.krp;
    else break;
  }
  return krp;
}

/**
 * Доля локализации (%) = локальные заказы / всего заказов × 100.
 * totalOrders = allOrders − excludedOrders (исключённые WB кластеры не считаются).
 */
export function localizationShare(localOrders: number, totalOrders: number): number {
  if (totalOrders <= 0) return 0;
  return (localOrders / totalOrders) * 100;
}

/** Вход агрегации индексов: один (артикул×размер) или склад. */
export type LocalizationRow = {
  /** Локальные заказы (из локального кластера). */
  localOrders: number;
  /** Всего заказов в зачёт (allOrders − excludedOrders). */
  totalOrders: number;
  /** Если проект/кластер не eligible — КТР→1, КРП→0 (наценки нет). */
  excluded?: boolean;
};

/** Разбор одной строки локализации (доля + коэффициенты + вклад в индексы). */
export type LocalizationBreakdown = {
  share: number;
  ktr: number;
  krp: number;
  /** Вклад строки в ИЛ = totalOrders × КТР (база для «% влияния»). */
  ilContribution: number;
  /** Вклад строки в ИРП = totalOrders × КРП. */
  irpContribution: number;
};

/** Доля + КТР/КРП + вклад в индексы для одной строки. */
export function breakdownRow(row: LocalizationRow): LocalizationBreakdown {
  if (row.excluded) {
    return { share: 0, ktr: 1, krp: 0, ilContribution: row.totalOrders, irpContribution: 0 };
  }
  const share = localizationShare(row.localOrders, row.totalOrders);
  const ktr = ktrForShare(share);
  const krp = krpForShare(share);
  return {
    share,
    ktr,
    krp,
    ilContribution: row.totalOrders * ktr,
    irpContribution: row.totalOrders * krp,
  };
}

/** Итоговые индексы проекта (шапка кабинета «ИЛ 1,08 ИРП 1,59»). */
export type LocalizationIndices = {
  /** ИЛ = Σ(заказы×КТР)/Σзаказы (орд-взвешенный КТР). */
  il: number;
  /** ИРП = Σ(заказы×КРП)/Σзаказы. */
  irp: number;
  /** Σ(заказы×КТР) — база для «% влияния на ИЛ». */
  ilSum: number;
  /** Σ(заказы×КРП) — база для «% влияния на ИРП». */
  irpSum: number;
  /** Σ заказов в зачёт. */
  totalOrders: number;
};

/** Агрегирует индексы ИЛ/ИРП по набору строк (артикулов×размеров). */
export function aggregateIndices(rows: ReadonlyArray<LocalizationRow>): LocalizationIndices {
  let ilSum = 0;
  let irpSum = 0;
  let totalOrders = 0;
  for (const row of rows) {
    const b = breakdownRow(row);
    ilSum += b.ilContribution;
    irpSum += b.irpContribution;
    totalOrders += row.totalOrders;
  }
  return {
    il: totalOrders > 0 ? ilSum / totalOrders : 0,
    irp: totalOrders > 0 ? irpSum / totalOrders : 0,
    ilSum,
    irpSum,
    totalOrders,
  };
}

/** «% влияния» строки на индекс = вклад строки / общая сумма × 100. */
export function influencePct(contribution: number, sumAll: number): number {
  if (sumAll <= 0) return 0;
  return (contribution / sumAll) * 100;
}
