const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function toLocalDateParam(value: Date): string {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0'),
  ].join('-');
}

export function parseApiDateParam(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const parsed = DATE_ONLY_RE.test(value)
    ? new Date(`${value}T00:00:00.000Z`)
    : new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function toInputDateValue(value: string | Date | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return toLocalDateParam(parsed);
}
