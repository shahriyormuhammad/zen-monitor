# Bandit autopilot design (P72)

> Status: draft · 2026-04-19 · закрывает P72a (foundation), описывает roadmap до P72d.

## Motivation

Текущий автопилот использует epsilon-greedy в `src/lib/advertising/self-learning.ts`
с детерминированным seed и 4 фиксированными arm-ами диапазонов позиций
(`SELF_LEARNING_POSITION_ARMS`). Это baseline: простой, стабильный, но:

- исследование равномерное (least-runs), игнорирует posterior-неопределённость;
- нет количественной оценки "arm X оптимален с вероятностью Y%";
- нет механизма работы с continuous reward (ROAS / ДРР / net profit).

Цель P72 — заменить этот пласт на Bayesian Thompson Sampling, сохраняя
существующий контракт `StrategyLearningState` и guardrails из P65.

## Scope

### In scope (P72a — этот slice)

- Детерминированный PRNG (mulberry32) + sampler-ы Normal/Gamma/Beta.
- Thompson posterior-модели Beta-Bernoulli и Normal-Normal.
- Функция arg-max выбора arm'а по sample'ам.
- Monte-Carlo оценка `P(arm is best)` для UI.
- Pure TS модули без IO и без изменений БД.
- 28 unit-тестов (determinism, dispersion, convergence, bounds).

### Out of scope (P72b/c/d)

- Интеграция с `workspace.ts` и автопилот-рантаймом — P72b.
- Миграция `summary.learningState.arms[]` → Beta/Normal posterior — P72b.
- UI-компонент "BanditInsights" с объяснениями выбора — P72c.
- A/B split-тесты per SKU — P72d (он же P74).

## Algorithm choice

| Контекст | Posterior | Когда выбирать |
|---|---|---|
| Бинарный reward (target попал в диапазон позиций) | Beta-Bernoulli | baseline-порт существующего epsilon-greedy |
| Continuous reward (log(ROAS/target), ΔROAS, savings/spend) | Normal-Normal | когда нужно оптимизировать экономику, а не попадание |

LinUCB (contextual bandits с feature vector) — отложен до P72c, т.к. требует:

- feature engineering поверх `advertising_bid_changes`, `raw_api_ad_costs`, `raw_api_orders`;
- регулярного обновления посредством Ridge-регрессии;
- persistent матрицы A⁻¹ per стратегия (растёт с числом features).

Stateless Thompson на фиксированных arm-ах закрывает 80% задачи при минимальном риске.

## Reward design

Для интеграции (P72b) предлагается два режима reward, конфигурируемых через
`autopilotConfig.rewardKind`:

- `position_hit` (Beta) — reward ∈ {0, 1}, фиксирует попадание avg-позиции в arm-диапазон.
  Прямой порт `computeSelfLearningRunReward` из self-learning.ts.
- `economic_delta` (Normal) — reward = `log(currentRoas / targetRoas)` или
  `(targetDrr − observedDrr) / targetDrr`, clipped в [-3, 3]. Reward центрирован
  вокруг 0 → arm с нулевой историей не штрафуется.

Default для существующих стратегий: `position_hit` (эквивалент сегодняшнего
поведения).

## Open questions — адресованы

### Какие features в векторе?

Для P72a — arm = (positionFrom, positionTo), без дополнительных features.
Для P72c (LinUCB) — вектор `[log(nmId_price), log(avg_orders_30d), category_id_onehot,
week_of_year_cyclical_encoded]`. Стартовая размерность ≤ 16.

### Cold start для новых SKU без истории?

Thompson Sampling естественно решает cold start: при `count=0` posterior =
prior Beta(1,1) / Normal(0, 1), что даёт uniform-like exploration.
Дополнительных cold-start эвристик не требуется.

### Interaction с P65 guardrails / kill-switch?

Разделение ответственности:

- Bandit выбирает arm (диапазон позиций / mode).
- Guardrails (P65) — гейт на итоговый bid перед applying: max bid delta,
  kill-switch на drop ROAS > threshold, max per-run spend.
- Kill-switch ветка приводит к `runStatus = 'suppressed'` и **не** обновляет posterior
  (иначе модель усвоит, что arm "виноват" в suppression вместо реального провала).

Соответственно `updateBetaArm` / `updateNormalArm` вызывается только при
`runStatus ∈ {applied, skipped}`, как в текущем self-learning.ts.

## Determinism and testability

- Все sampler-ы детерминированы по (strategyId, referenceDate) через
  `buildDeterministicSeed` → mulberry32. Это сохраняет свойство существующего
  `pickSelfLearningTarget`: `dry-run` и `apply` в одной минуте дают один и
  тот же arm.
- Тесты покрывают:
  1. determinism (один seed → одинаковая последовательность);
  2. статистическую корректность sampler-ов (mean/variance близки к
     теоретическим на n=20k);
  3. convergence (Welford-accumulator сходится к истинному mean на 2k обновлений);
  4. argmax-semantics Thompson (доминирующий arm выигрывает ≥80% запусков);
  5. uniformity на пустых priors (≥20% и ≤50% share на 3 arm-ах).

## Migration strategy (P72b draft)

1. Добавить поле `bandit` в `StrategyLearningState`:
   ```ts
   type StrategyLearningState = {
     ...existing;
     bandit?: {
       kind: 'beta' | 'normal';
       arms: Record<LearningArmKey, BetaBernoulliArm | NormalArm>;
     };
   };
   ```
2. Сохранить обратную совместимость: `readLearningStateFromSummary` падает
   в legacy epsilon-greedy при `bandit === undefined` и `autopilotConfig.mode === 'self_learning'`.
3. Добавить `autopilotConfig.policy = 'epsilon_greedy' | 'thompson_beta' | 'thompson_normal'`
   (default `epsilon_greedy` — нулевой риск для текущих стратегий).
4. Shadow-mode (P72b): bandit считает выбор, но автопилот применяет
   epsilon-greedy. Логируем delta для оценки, прежде чем переключать по-настоящему.

## Acceptance for P72 (полный объём)

Из backlog:

- автопилот-стратегия показывает рост ROAS на ≥10% за 2 недели эксплуатации vs baseline — мерить на пилотной стратегии после P72b;
- UI объясняет каждое изменение — P72c (`BanditInsights`);
- автопилот не делает >10% BID-дельты за сессию, не ломает guardrails P65 — P72b (guardrails неизменны, policy меняет только выбор arm-а).

## Риски

- Семплинг из Beta через Gamma-rejection чувствителен к NaN seed.
  Митигировано cap-ом итераций (256) и дефолтным возвратом `d`.
- Normal-Normal с малым `count` ведёт себя почти как prior — может
  "перекинуть" выбор на неинформативный arm. Митигировано reward-clipping
  в P72b и минимальной variance `1e-4`.
- A/B реальной эффективности требует пилот-сессии — design doc не доказывает
  lift, только обеспечивает невырождение алгоритма.
