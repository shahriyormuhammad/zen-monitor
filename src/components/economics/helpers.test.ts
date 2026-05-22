import { describe, it, expect } from 'vitest';

import {
  toNumber,
  roundCurrency,
  toManualStorageKey,
  normalizeDecimalInput,
  formatCurrency,
  formatPercent,
  formatNumber,
  formatText,
  parseFirstNumber,
  clampPercent,
  parseCoefExprToMultiplier,
  hasManualValue,
} from './helpers';

describe('toNumber', () => {
  it('parses finite numeric strings', () => {
    expect(toNumber('12.5')).toBe(12.5);
    expect(toNumber(42)).toBe(42);
  });
  it('returns 0 for non-finite or invalid values', () => {
    expect(toNumber(undefined)).toBe(0);
    expect(toNumber('abc')).toBe(0);
    expect(toNumber(NaN)).toBe(0);
    expect(toNumber(Infinity)).toBe(0);
  });
});

describe('roundCurrency', () => {
  it('rounds to 2 decimal places', () => {
    expect(roundCurrency(1.005)).toBe(1.01);
    expect(roundCurrency(2.125)).toBe(2.13);
    expect(roundCurrency(10)).toBe(10);
  });
  it('returns 0 for non-finite', () => {
    expect(roundCurrency(Infinity)).toBe(0);
    expect(roundCurrency(NaN)).toBe(0);
  });
});

describe('toManualStorageKey', () => {
  it('uses tenantId when provided', () => {
    expect(toManualStorageKey('tenant-xyz', 42)).toBe('economics-template-manual:tenant-xyz:42');
  });
  it('trims whitespace-only tenantId and falls back to default', () => {
    expect(toManualStorageKey('   ', 1)).toBe('economics-template-manual:default:1');
    expect(toManualStorageKey(null, 1)).toBe('economics-template-manual:default:1');
    expect(toManualStorageKey(undefined, 1)).toBe('economics-template-manual:default:1');
  });
  it('preserves tenantId including trimmed whitespace', () => {
    expect(toManualStorageKey('  abc  ', 7)).toBe('economics-template-manual:abc:7');
  });
});

describe('normalizeDecimalInput', () => {
  it('converts comma to dot', () => {
    expect(normalizeDecimalInput('12,5')).toBe('12.5');
  });
  it('strips non-numeric, non-dot characters', () => {
    expect(normalizeDecimalInput('12.5руб')).toBe('12.5');
    expect(normalizeDecimalInput('ab 10,25 cd')).toBe('10.25');
  });
  it('handles empty', () => {
    expect(normalizeDecimalInput('')).toBe('');
  });
});

describe('formatCurrency', () => {
  it('formats with default 0 digits', () => {
    expect(formatCurrency(1234)).toMatch(/₽/);
    expect(formatCurrency(1234)).toContain('1');
  });
  it('respects digits arg', () => {
    const formatted = formatCurrency(1234.567, 2);
    expect(formatted).toContain('57');
    expect(formatted).toContain('₽');
  });
});

describe('formatPercent', () => {
  it('formats with default 1 digit', () => {
    expect(formatPercent(12.345)).toBe('12.3%');
  });
  it('respects digits arg', () => {
    expect(formatPercent(12.345, 2)).toBe('12.35%');
    expect(formatPercent(50, 0)).toBe('50%');
  });
});

describe('formatNumber', () => {
  it('formats with default 2 digits', () => {
    const result = formatNumber(1234.5678);
    expect(result).toContain('57');
  });
  it('respects digits arg', () => {
    expect(formatNumber(1, 0)).toBe('1');
    expect(formatNumber(1.5, 1)).toBe('1,5');
  });
});

describe('formatText', () => {
  it('returns dash for null/undefined/empty', () => {
    expect(formatText(null)).toBe('—');
    expect(formatText(undefined)).toBe('—');
    expect(formatText('')).toBe('—');
    expect(formatText('   ')).toBe('—');
  });
  it('trims whitespace', () => {
    expect(formatText('  hello  ')).toBe('hello');
  });
});

describe('parseFirstNumber', () => {
  it('extracts first numeric token', () => {
    expect(parseFirstNumber('abc 12.5 xyz')).toBe(12.5);
    expect(parseFirstNumber('1.2 3.4')).toBe(1.2);
  });
  it('handles negative numbers', () => {
    expect(parseFirstNumber('temp -5.5°C')).toBe(-5.5);
  });
  it('normalizes comma to dot', () => {
    expect(parseFirstNumber('12,75 литров')).toBe(12.75);
  });
  it('returns 0 for no match or falsy input', () => {
    expect(parseFirstNumber('abc')).toBe(0);
    expect(parseFirstNumber(null)).toBe(0);
    expect(parseFirstNumber(undefined)).toBe(0);
    expect(parseFirstNumber('')).toBe(0);
  });
});

describe('clampPercent', () => {
  it('clamps to [0, 100]', () => {
    expect(clampPercent(-5)).toBe(0);
    expect(clampPercent(50)).toBe(50);
    expect(clampPercent(150)).toBe(100);
    expect(clampPercent(0)).toBe(0);
    expect(clampPercent(100)).toBe(100);
  });
});

describe('parseCoefExprToMultiplier', () => {
  it('returns value as-is for ≤ 10', () => {
    expect(parseCoefExprToMultiplier(1.5)).toBe(1.5);
    expect(parseCoefExprToMultiplier(10)).toBe(10);
    expect(parseCoefExprToMultiplier(0.2)).toBe(0.2);
  });
  it('divides by 100 for values > 10 (assumed percentage)', () => {
    expect(parseCoefExprToMultiplier(25)).toBe(0.25);
    expect(parseCoefExprToMultiplier(100)).toBe(1);
  });
  it('returns 0 for non-positive or invalid', () => {
    expect(parseCoefExprToMultiplier(0)).toBe(0);
    expect(parseCoefExprToMultiplier(-5)).toBe(0);
    expect(parseCoefExprToMultiplier(Infinity)).toBe(0);
    expect(parseCoefExprToMultiplier(NaN)).toBe(0);
  });
});

describe('hasManualValue', () => {
  it('returns true for non-empty trimmed strings', () => {
    expect(hasManualValue('abc')).toBe(true);
    expect(hasManualValue(' a ')).toBe(true);
  });
  it('returns false for empty / whitespace / nullish', () => {
    expect(hasManualValue('')).toBe(false);
    expect(hasManualValue('   ')).toBe(false);
    expect(hasManualValue(null)).toBe(false);
    expect(hasManualValue(undefined)).toBe(false);
  });
});
