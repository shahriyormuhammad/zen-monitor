import { describe, it, expect } from 'vitest';
import { buildSuggestionReason } from './advisor-digest';

describe('buildSuggestionReason', () => {
  it('только applied', () => {
    expect(buildSuggestionReason([{ status: 'applied', count: 3 }])).toBe('3 примен.');
  });

  it('только preview', () => {
    expect(buildSuggestionReason([{ status: 'preview', count: 2 }])).toBe('2 предлож.');
  });

  it('applied + preview', () => {
    expect(
      buildSuggestionReason([
        { status: 'applied', count: 3 },
        { status: 'preview', count: 2 },
      ]),
    ).toBe('3 примен., 2 предлож.');
  });

  it('все три статуса', () => {
    expect(
      buildSuggestionReason([
        { status: 'applied', count: 5 },
        { status: 'preview', count: 1 },
        { status: 'failed', count: 2 },
      ]),
    ).toBe('5 примен., 1 предлож., 2 с ошибкой');
  });

  it('пустой массив → «без изменений»', () => {
    expect(buildSuggestionReason([])).toBe('без изменений');
  });

  it('игнорирует неизвестные статусы (skipped, guardrail_blocked)', () => {
    expect(
      buildSuggestionReason([
        { status: 'skipped', count: 5 },
        { status: 'guardrail_blocked', count: 2 },
      ]),
    ).toBe('без изменений');
  });

  it('0-значные counts не попадают в строку', () => {
    expect(
      buildSuggestionReason([
        { status: 'applied', count: 0 },
        { status: 'preview', count: 1 },
      ]),
    ).toBe('1 предлож.');
  });
});
