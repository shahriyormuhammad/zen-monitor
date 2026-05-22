import type { AdvertisingPriority, ClusterRiskLevel } from './types';

export const panelClass =
  'rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 shadow-sm';

export function mapStatusLabel(value: 'active' | 'excluded' | 'unknown') {
  if (value === 'active') {
    return 'Активен';
  }
  if (value === 'excluded') {
    return 'Исключен';
  }
  return 'Неизвестно';
}

export function alertSeverityLabel(value: 'critical' | 'high' | 'medium') {
  if (value === 'critical') {
    return 'Критично';
  }
  if (value === 'high') {
    return 'Высокий';
  }
  return 'Средний';
}

export function alertTypeLabel(value: string) {
  if (value === 'spend_spike_without_orders') {
    return 'Всплеск расхода без заказов';
  }
  if (value === 'ctr_cvr_degradation') {
    return 'Деградация CTR/CVR';
  }
  if (value === 'brand_anomaly') {
    return 'Аномалия бренда';
  }
  if (value === 'sku_anomaly') {
    return 'Аномалия SKU';
  }
  return value;
}

export function priorityChip(priority: AdvertisingPriority) {
  if (priority === 'high') {
    return 'border-rose-200 bg-rose-50 text-rose-700';
  }
  if (priority === 'medium') {
    return 'border-amber-200 bg-amber-50 text-amber-700';
  }
  return 'border-blue-200 bg-blue-50 text-blue-700';
}

export function priorityLabel(priority: AdvertisingPriority) {
  if (priority === 'high') {
    return 'Высокий';
  }
  if (priority === 'medium') {
    return 'Средний';
  }
  return 'Низкий';
}

export function riskChip(level: ClusterRiskLevel) {
  if (level === 'high') {
    return 'border-rose-200 bg-rose-50 text-rose-700';
  }
  if (level === 'medium') {
    return 'border-amber-200 bg-amber-50 text-amber-700';
  }
  if (level === 'low') {
    return 'border-sky-200 bg-sky-50 text-sky-700';
  }
  return 'border-slate-200 bg-slate-50 text-slate-600';
}

export function riskLabel(level: ClusterRiskLevel) {
  if (level === 'high') {
    return 'Высокий';
  }
  if (level === 'medium') {
    return 'Средний';
  }
  if (level === 'low') {
    return 'Низкий';
  }
  return 'Без риска';
}

export function rankTone(value: number | null) {
  if (value === null) {
    return 'text-slate-500';
  }
  if (value >= 45) {
    return 'text-rose-600';
  }
  if (value >= 30) {
    return 'text-amber-600';
  }
  return 'text-emerald-600';
}
