export function formatMoney(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return '—';
  }
  return `${Math.round(value).toLocaleString('ru-RU')} ₽`;
}

export function formatMoneyPrecise(value: number | null, digits = 2) {
  if (value === null || !Number.isFinite(value)) {
    return '—';
  }
  return `${value.toLocaleString('ru-RU', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} ₽`;
}

export function formatNumber(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return '—';
  }
  return Math.round(value).toLocaleString('ru-RU');
}

export function formatDecimal(value: number | null, digits = 2) {
  if (value === null || !Number.isFinite(value)) {
    return '—';
  }
  return value.toLocaleString('ru-RU', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatPercent(value: number | null, digits = 1) {
  if (value === null || !Number.isFinite(value)) {
    return '—';
  }
  return `${value.toFixed(digits)}%`;
}

export function formatDateTime(value: string | null) {
  if (!value) {
    return '—';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Europe/Moscow',
  });
}

export function dayLabel(dayKey: string) {
  const parsed = new Date(`${dayKey}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return dayKey;
  }
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
  }).format(parsed);
}

export function statusLabel(status: number | null) {
  if (status === null) {
    return '—';
  }
  const map: Record<number, string> = {
    4: 'Готова к запуску',
    7: 'Завершена',
    8: 'Отклонена',
    9: 'Активна',
    11: 'На паузе',
  };
  return map[status] ?? String(status);
}
