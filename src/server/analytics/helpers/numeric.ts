export function formatCurrency(value: number) {
  return `${Math.round(value).toLocaleString("ru-RU")} ₽`;
}

export function formatUnits(value: number) {
  return `${Math.round(value).toLocaleString("ru-RU")} шт.`;
}

export function safeNumber(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

export function parseNumeric(value: unknown, fallback = 0): number {
  if (value === null || value === undefined) {
    return fallback;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function parseNullableNumeric(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function safeNullableNumber(value: number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  return Number.isFinite(value) ? value : null;
}

export function roundFinancial(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function roundFinancialNullable(value: number | null | undefined, decimals = 2): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  return roundFinancial(value, decimals);
}

export function getUtcDayStart(value: Date | string) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

export function getUtcNextDayStart(value: Date | string) {
  const date = getUtcDayStart(value);
  date.setUTCDate(date.getUTCDate() + 1);
  return date;
}
