import { describe, expect, it } from 'vitest';

import { EMPTY_MANUAL_FIELDS } from '../constants';
import { parseManualFieldsPayload } from '../manual-fields-io';
import type { ManualFields, RowSummary, UnitTemplateRow } from '../types';
import { resolveCellText } from './cellValue';

function makeManual(overrides: Partial<ManualFields> = {}): ManualFields {
  return parseManualFieldsPayload({ ...EMPTY_MANUAL_FIELDS, ...overrides });
}

describe('resolveCellText cost fields', () => {
  it('shows purchasePrice before full costPrice for purchase cost column', () => {
    const row = { nmId: 123, purchasePrice: 100, costPrice: 145 } satisfies UnitTemplateRow;

    expect(resolveCellText('cost_price_1', row, {} as RowSummary, makeManual())).toBe('100,00 ₽');
  });

  it('keeps manual purchase value before row fallbacks', () => {
    const row = { nmId: 123, purchasePrice: 100, costPrice: 145 } satisfies UnitTemplateRow;

    expect(resolveCellText('cost_price_1', row, {} as RowSummary, makeManual({ costPrice: '90' }))).toBe('90,00 ₽');
  });

  it('falls back to legacy costPrice when purchasePrice is absent', () => {
    const row = { nmId: 123, costPrice: 120 } satisfies UnitTemplateRow;

    expect(resolveCellText('cost_price_1', row, {} as RowSummary, makeManual())).toBe('120,00 ₽');
  });

  it('does not show legacy full cost as purchase when detailed costs exist', () => {
    const row = { nmId: 123, purchasePrice: 0, costPrice: 120 } satisfies UnitTemplateRow;
    const manual = makeManual({ deliveryToFf: '20' });

    expect(resolveCellText('cost_price_1', row, {} as RowSummary, manual)).toBe('—');
  });
});


describe('resolveCellText buyout auto', () => {
  it('shows auto buyout only when it is the applied source', () => {
    expect(resolveCellText('buyout_auto', {} as UnitTemplateRow, {
      buyoutAutoPercent: 72.4,
      buyoutSource: 'auto',
    } as RowSummary, makeManual())).toBe('72.4%');
  });

  it('shows dash when WB fact exists but auto buyout is not applied', () => {
    expect(resolveCellText('buyout_auto', {} as UnitTemplateRow, {
      buyoutAutoPercent: 100,
      buyoutSource: 'manual',
    } as RowSummary, makeManual())).toBe('—');
  });
});
