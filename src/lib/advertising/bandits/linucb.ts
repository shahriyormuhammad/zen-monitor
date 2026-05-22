/**
 * LinUCB contextual bandit (диsjoint model) для P72c.
 *
 * Используется когда накоплено достаточно наблюдений (LINUCB_MIN_OBSERVATIONS)
 * и есть контекстный вектор признаков (цена, заказы, сезонность).
 *
 * Алгоритм (Chu et al., 2011, "Contextual Bandits with Linear Payoff Functions"):
 *   - Каждый arm независимо ведёт матрицу A (d×d) и вектор b (d).
 *   - UCB = θ_a^T x + α * sqrt(x^T A_a^{-1} x),
 *     где θ_a = A_a^{-1} b_a.
 *   - Обновление при наблюдении reward r и features x:
 *     A_a += x x^T,  b_a += r x.
 *
 * Модуль чистый (no IO), детерминированный, d ≤ 16 гарантирует практичность
 * линейного решателя.
 */

/** Количество dimensions у feature-вектора из buildLinUCBFeatures. */
export const LINUCB_FEATURE_DIM = 4;

/** Порог наблюдений для активации LinUCB вместо Thompson. */
export const LINUCB_MIN_OBSERVATIONS = 500;

/** Exploration factor α. Типовые значения: 0.5–1.5 (выше = больше исследования). */
export const LINUCB_DEFAULT_ALPHA = 1.0;

export type LinUCBArm = {
  id: string;
  /** d×d матрица, row-major flat array. Инициализируется как I. */
  A: number[];
  /** d-вектор. Инициализируется нулями. */
  b: number[];
};

export type LinUCBPick = {
  arm: LinUCBArm;
  scores: Array<{ id: string; score: number }>;
};

/** Создать новый arm с A = I_d, b = 0. */
export function createLinUCBArm(id: string, d: number): LinUCBArm {
  const A = new Array<number>(d * d).fill(0);
  for (let i = 0; i < d; i++) A[i * d + i] = 1;
  return { id, A, b: new Array<number>(d).fill(0) };
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] ?? 0) * (b[i] ?? 0);
  return s;
}

/**
 * Решить систему Ax = rhs методом Гаусса с частичным выбором ведущего элемента.
 * d ≤ 16, поэтому O(d^3) не является проблемой производительности.
 */
function solveLinear(A: number[], rhs: number[], d: number): number[] {
  // Строим расширенную матрицу [A | rhs] размером d × (d+1)
  const aug: number[][] = Array.from({ length: d }, (_, i) => {
    const row = A.slice(i * d, (i + 1) * d) as number[];
    row.push(rhs[i] ?? 0);
    return row;
  });

  for (let col = 0; col < d; col++) {
    // Выбор максимального элемента по строкам
    let maxRow = col;
    for (let row = col + 1; row < d; row++) {
      if (Math.abs(aug[row]![col]!) > Math.abs(aug[maxRow]![col]!)) maxRow = row;
    }
    const tmp = aug[col]!;
    aug[col] = aug[maxRow]!;
    aug[maxRow] = tmp;

    const pivot = aug[col]![col]!;
    if (Math.abs(pivot) < 1e-12) continue;

    // Нормировать ведущую строку
    for (let j = col; j <= d; j++) aug[col]![j]! /= pivot;

    // Элиминировать остальные строки
    for (let row = 0; row < d; row++) {
      if (row === col) continue;
      const factor = aug[row]![col]!;
      for (let j = col; j <= d; j++) aug[row]![j]! -= factor * aug[col]![j]!;
    }
  }

  return aug.map(row => row[d]!);
}

/**
 * Вычислить UCB-оценку для arm при данном вектор признаков.
 *   score = θ^T x + α * sqrt(x^T A^{-1} x)
 */
export function linUCBScore(arm: LinUCBArm, features: number[], alpha: number): number {
  const d = features.length;
  const theta = solveLinear(arm.A, arm.b, d);
  // y = A^{-1} x — решаем A y = x
  const y = solveLinear(arm.A, features, d);
  // x^T A^{-1} x = x^T y
  const uncertainty = dot(features, y);
  return dot(theta, features) + alpha * Math.sqrt(Math.max(0, uncertainty));
}

/** Выбрать arm с наибольшим UCB. */
export function pickLinUCB(
  arms: ReadonlyArray<LinUCBArm>,
  features: number[],
  alpha: number = LINUCB_DEFAULT_ALPHA,
): LinUCBPick {
  if (arms.length === 0) {
    throw new Error('linucb.pickLinUCB: arms must not be empty');
  }
  const scores = arms.map(arm => ({ id: arm.id, score: linUCBScore(arm, features, alpha) }));
  let bestIdx = 0;
  for (let i = 1; i < scores.length; i++) {
    if ((scores[i]?.score ?? Number.NEGATIVE_INFINITY) > (scores[bestIdx]?.score ?? Number.NEGATIVE_INFINITY)) {
      bestIdx = i;
    }
  }
  return { arm: arms[bestIdx]!, scores };
}

/**
 * Обновить состояние arm после наблюдения reward.
 *   A += x x^T
 *   b += r x
 */
export function updateLinUCBArm(arm: LinUCBArm, features: number[], reward: number): LinUCBArm {
  const d = features.length;
  const nextA = [...arm.A];
  const nextB = [...arm.b];
  for (let i = 0; i < d; i++) {
    const xi = features[i] ?? 0;
    for (let j = 0; j < d; j++) {
      nextA[i * d + j]! += xi * (features[j] ?? 0);
    }
    nextB[i]! += reward * xi;
  }
  return { id: arm.id, A: nextA, b: nextB };
}

/**
 * Построить 4-мерный feature-вектор из контекстных данных.
 *
 *   [log(price + 1), log(orders_30d + 1), sin(2π·week/52), cos(2π·week/52)]
 *
 * Размерность соответствует LINUCB_FEATURE_DIM = 4.
 */
export function buildLinUCBFeatures(input: {
  /** Цена SKU в рублях (≥ 0). */
  price: number;
  /** Средние заказы за 30 дней (≥ 0). */
  orders30d: number;
  /** Номер недели в году, 1–52. */
  weekOfYear: number;
}): number[] {
  const weekRad = (2 * Math.PI * input.weekOfYear) / 52;
  return [
    Math.log(Math.max(0, input.price) + 1),
    Math.log(Math.max(0, input.orders30d) + 1),
    Math.sin(weekRad),
    Math.cos(weekRad),
  ];
}
