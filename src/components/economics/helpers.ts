/**
 * Pure formatting and parsing helpers used across the Unit Economics module.
 *
 * Kept side-effect-free so they can be unit-tested without a React/DOM env.
 */

export function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function roundCurrency(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function toManualStorageKey(tenantId: string | null | undefined, nmId: number): string {
  const tenantScope = typeof tenantId === 'string' && tenantId.trim().length > 0 ? tenantId.trim() : 'default';
  return `economics-template-manual:${tenantScope}:${nmId}`;
}

export function normalizeDecimalInput(value: string): string {
  return value.replace(',', '.').replace(/[^\d.]/g, '');
}

export function formatCurrency(value: number, digits = 0): string {
  return `${value.toLocaleString('ru-RU', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} ₽`;
}

export function formatPercent(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}

export function formatNumber(value: number, digits = 2): string {
  return value.toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatText(value: string | null | undefined): string {
  if (!value || !value.trim()) {
    return '—';
  }
  return value.trim();
}

export function parseFirstNumber(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }
  const normalized = value.replace(',', '.');
  const match = normalized.match(/-?\d+(\.\d+)?/);
  if (!match) {
    return 0;
  }
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

/**
 * WB acceptance/storage tariffs sometimes come as a percentage (e.g. `120` for
 * 120%) and sometimes as a multiplier (e.g. `1.2`). Heuristic: anything > 10
 * is treated as a percentage and divided by 100, otherwise it's a multiplier.
 * Mirrors the original component's logic exactly.
 */
export function parseCoefExprToMultiplier(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return value > 10 ? value / 100 : value;
}

export function hasManualValue(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Normalize a warehouse label so it can be matched fuzzy against WB API keys. */
export function normalizeWarehouseKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}
