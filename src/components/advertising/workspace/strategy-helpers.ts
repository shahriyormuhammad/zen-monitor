export function parseIntList(value: string) {
  const unique = new Set<number>();
  for (const part of String(value).split(/[,\n;]+/g)) {
    const parsed = Math.round(Number(part.trim()));
    if (Number.isFinite(parsed) && parsed >= 0) {
      unique.add(parsed);
    }
  }
  return [...unique];
}

export function strategyStateLabel(value: string | null) {
  if (!value) {
    return '—';
  }
  if (value === 'success') {
    return 'Успешно';
  }
  if (value === 'failed') {
    return 'Ошибка';
  }
  if (value === 'skipped') {
    return 'Пропущено';
  }
  if (value === 'running') {
    return 'Выполняется';
  }
  return value;
}

export function toNullableNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function toSummaryObject(value: unknown) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {} as Record<string, unknown>;
}

export function bidChangeStatusLabel(value: string) {
  if (value === 'applied') {
    return 'Применено';
  }
  if (value === 'failed') {
    return 'Ошибка';
  }
  if (value === 'preview') {
    return 'Превью';
  }
  if (value === 'guardrail_blocked') {
    return 'Блок guardrail';
  }
  if (value === 'skipped') {
    return 'Пропущено';
  }
  return value;
}

export function strategyReasonLabel(value: string | null) {
  if (!value) {
    return '—';
  }
  if (value === 'orders_below_min') {
    return 'Мало заказов';
  }
  if (value === 'acos_above_target') {
    return 'ДРР выше цели';
  }
  if (value === 'cpc_above_max') {
    return 'CPC выше лимита';
  }
  if (value === 'performance_above_target') {
    return 'Метрики лучше цели';
  }
  if (value === 'position_above_target_probe_down') {
    return 'Позиция выше цели: снижаем ставку';
  }
  if (value === 'position_below_target_raise') {
    return 'Позиция ниже цели: поднимаем ставку';
  }
  if (value === 'position_in_target_probe_down') {
    return 'Позиция в коридоре: пробуем дешевле';
  }
  if (value === 'insufficient_position_data_probe_up') {
    return 'Мало данных по позиции: тестовый рост';
  }
  if (value === 'outside_schedule') {
    return 'Вне расписания';
  }
  if (value === 'budget_exhausted') {
    return 'Бюджет исчерпан';
  }
  if (value === 'budget_soft_cap') {
    return 'Достигнут мягкий лимит бюджета';
  }
  if (value === 'portfolio_budget_exhausted') {
    return 'Бюджет портфеля исчерпан';
  }
  if (value === 'no_action_needed') {
    return 'Действие не требуется';
  }
  if (value === 'outside_schedule_no_change') {
    return 'Вне расписания, без изменений';
  }
  if (value === 'portfolio_soft_cap_no_growth') {
    return 'Мягкий лимит портфеля, рост отключён';
  }
  if (value === 'no_nm_ids') {
    return 'Нет SKU для обработки';
  }
  if (value === 'no_changes_needed') {
    return 'Изменения не требуются';
  }
  return value;
}

export function drrToneClass(value: number | null, targetPct: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return 'border-slate-200 bg-slate-100 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400';
  }
  if (targetPct === null || !Number.isFinite(targetPct) || targetPct <= 0) {
    if (value >= 45) {
      return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800/40 dark:bg-rose-900/20 dark:text-rose-300';
    }
    if (value >= 30) {
      return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-300';
    }
    return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-900/20 dark:text-emerald-300';
  }
  if (value > targetPct * 1.2) {
    return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800/40 dark:bg-rose-900/20 dark:text-rose-300';
  }
  if (value > targetPct) {
    return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-300';
  }
  if (value <= targetPct * 0.75) {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-900/20 dark:text-emerald-300';
  }
  return 'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-800/40 dark:bg-indigo-900/20 dark:text-indigo-300';
}
