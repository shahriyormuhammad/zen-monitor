import { describe, expect, it } from 'vitest';

import {
  canUseRowAutoBuyout,
  getRowBuyoutAutoDiagnostics,
  getWarehouseLookupKeys,
  getWbLogisticsBaseUpToOneLiter,
  getWbReverseBaseForVolume,
  pickAcceptanceTariffByWarehouseLabel,
  resolveVolumeLiters,
  type AcceptanceTariffCandidate,
} from './tariff-helpers';
import { normalizeWarehouseKey } from './helpers';

function makeAcceptance(name: string, deliveryCoef = 100): AcceptanceTariffCandidate {
  return {
    warehouseName: name,
    boxTypeId: 2,
    allowUnload: true,
    coefficient: 0,
    deliveryCoef,
    storageCoef: 100,
    deliveryBaseLiter: 0,
    deliveryAdditionalLiter: 0,
    storageBaseLiter: 0,
    storageAdditionalLiter: 0,
    date: '2026-05-07',
  };
}

describe('getWarehouseLookupKeys', () => {
  it('does NOT include the bare trigger when label is more specific', () => {
    // For «Санкт-Петербург (Шушары)» the trigger «санктпетербург» is shorter
    // than the label — it must NOT leak into lookup keys, otherwise the exact
    // map.get loop would shadow specific Shushary tariffs with a generic SPB
    // entry.
    const keys = getWarehouseLookupKeys('санктпетербургшушары');
    expect(keys).not.toContain('санктпетербург');
    expect(keys).toContain('санктпетербургшушары');
    expect(keys).toContain('спбшушары');
    expect(keys).toContain('шушары');
  });

  it('DOES include trigger when it equals the normalized label exactly', () => {
    const keys = getWarehouseLookupKeys('санктпетербург');
    expect(keys).toContain('санктпетербург');
  });

  it('returns keys sorted by length DESC (most specific first)', () => {
    const keys = getWarehouseLookupKeys('санктпетербургшушары');
    expect(keys[0]).toBe('санктпетербургшушары'); // 19 chars
    // Subsequent keys must all be shorter or equal.
    for (let i = 1; i < keys.length; i += 1) {
      const current = keys[i] ?? '';
      const previous = keys[i - 1] ?? '';
      expect(current.length).toBeLessThanOrEqual(previous.length);
    }
  });
});

describe('pickAcceptanceTariffByWarehouseLabel — Шушары vs СГТ', () => {
  it('does NOT match «Санкт-Петербург (Шушары)» to «Санкт-Петербург СГТ»', () => {
    // WB API may return both «Санкт-Петербург СГТ» and «Санкт-Петербург (Шушары)»
    // — for the Shushary label we must pick Shushary, not SGT.
    const map = new Map<string, AcceptanceTariffCandidate>();
    map.set(normalizeWarehouseKey('Санкт-Петербург СГТ'), makeAcceptance('Санкт-Петербург СГТ', 105));
    map.set(normalizeWarehouseKey('Санкт-Петербург (Шушары)'), makeAcceptance('Санкт-Петербург (Шушары)', 110));

    const result = pickAcceptanceTariffByWarehouseLabel(
      map,
      normalizeWarehouseKey('Санкт-Петербург (Шушары)'),
    );
    expect(result?.warehouseName).toBe('Санкт-Петербург (Шушары)');
  });

  it('returns undefined for Shushary label when only SGT and Утк.Заводь are in the map', () => {
    // Without an exact Shushary entry, the previous fuzzy fallback would have
    // matched SGT through the broad «санктпетербург» key. Now: no broad key,
    // no fuzzy match — caller sees «Нет совпадения в WB-тарифах».
    const map = new Map<string, AcceptanceTariffCandidate>();
    map.set(normalizeWarehouseKey('Санкт-Петербург СГТ'), makeAcceptance('Санкт-Петербург СГТ'));
    map.set(normalizeWarehouseKey('Санкт-Петербург (Уткина Заводь)'), makeAcceptance('Санкт-Петербург (Уткина Заводь)'));

    const result = pickAcceptanceTariffByWarehouseLabel(
      map,
      normalizeWarehouseKey('Санкт-Петербург (Шушары)'),
    );
    expect(result).toBeUndefined();
  });

  it('matches «Санкт-Петербург (Шушары)» via «спбшушары» alias when WB returns "СПБ Шушары"', () => {
    const map = new Map<string, AcceptanceTariffCandidate>();
    map.set(normalizeWarehouseKey('СПБ Шушары'), makeAcceptance('СПБ Шушары', 110));
    map.set(normalizeWarehouseKey('Санкт-Петербург СГТ'), makeAcceptance('Санкт-Петербург СГТ', 105));

    const result = pickAcceptanceTariffByWarehouseLabel(
      map,
      normalizeWarehouseKey('Санкт-Петербург (Шушары)'),
    );
    expect(result?.warehouseName).toBe('СПБ Шушары');
  });

  it('does NOT match Утк.Заводь through generic SPB token (regression for «спб» alias)', () => {
    // Old aliases included a 3-letter «спб», which fuzzy-matched through any
    // SPB warehouse via includes(). It was removed.
    const map = new Map<string, AcceptanceTariffCandidate>();
    map.set(normalizeWarehouseKey('Санкт-Петербург (Уткина Заводь)'), makeAcceptance('Санкт-Петербург (Уткина Заводь)'));

    const result = pickAcceptanceTariffByWarehouseLabel(
      map,
      normalizeWarehouseKey('Санкт-Петербург (Шушары)'),
    );
    expect(result).toBeUndefined();
  });
});

describe('resolveVolumeLiters', () => {
  it('prefers WB factual volume over card-side fallback', () => {
    expect(resolveVolumeLiters({
      wbVolumeLiters: 0.5,
      volumeLiters: 1.2,
      volume: '2 л',
      length: '20',
      width: '10',
      height: '10',
    })).toBe(0.5);
  });

  it('falls back to card volume when WB has no factual measurement', () => {
    expect(resolveVolumeLiters({
      wbVolumeLiters: null,
      volumeLiters: 0.83,
    })).toBe(0.83);
  });

  it('falls back to card dimensions when volume is absent', () => {
    expect(resolveVolumeLiters({
      wbVolumeLiters: null,
      volumeLiters: null,
      length: '14',
      width: '9',
      height: '4',
    })).toBe(0.5);
  });
});

describe('WB logistics base tiers up to 1L', () => {
  it('uses the WB tier as a per-item base, not volume × tariff', () => {
    expect(getWbLogisticsBaseUpToOneLiter(0.18)).toBe(23);
    expect(getWbLogisticsBaseUpToOneLiter(0.3)).toBe(26);
    expect(getWbLogisticsBaseUpToOneLiter(0.5)).toBe(29);
    expect(getWbLogisticsBaseUpToOneLiter(0.7)).toBe(30);
    expect(getWbLogisticsBaseUpToOneLiter(0.85)).toBe(32);
  });

  it('uses the same base tiers for buyer reverse logistics under 1L', () => {
    expect(getWbReverseBaseForVolume(0.18)).toBe(23);
    expect(getWbReverseBaseForVolume(0.85)).toBe(32);
    expect(getWbReverseBaseForVolume(1.5)).toBe(53);
  });
});

describe('auto buyout eligibility', () => {
  it('allows auto buyout when history/base/open-share checks pass', () => {
    const diagnostics = getRowBuyoutAutoDiagnostics({
      buyoutPercentFact: 80,
      buyoutHistoryDaysFact: 35,
      buyoutOrderCountFact: 30,
      buyoutCountFact: 20,
      buyoutCancelCountFact: 10,
    });
    expect(diagnostics.canUseAuto).toBe(true);
    expect(diagnostics.reason).toBe('ok');
    expect(canUseRowAutoBuyout({
      buyoutPercentFact: 80,
      buyoutHistoryDaysFact: 35,
      buyoutOrderCountFact: 30,
      buyoutCountFact: 20,
      buyoutCancelCountFact: 10,
    })).toBe(true);
  });

  it('disables auto buyout for low closed base', () => {
    const diagnostics = getRowBuyoutAutoDiagnostics({
      buyoutPercentFact: 100,
      buyoutHistoryDaysFact: 35,
      buyoutOrderCountFact: 5,
      buyoutCountFact: 5,
      buyoutCancelCountFact: 0,
    });
    expect(diagnostics.canUseAuto).toBe(false);
    expect(diagnostics.reason).toBe('low_closed_base');
  });

  it('disables auto buyout for high open share', () => {
    const diagnostics = getRowBuyoutAutoDiagnostics({
      buyoutPercentFact: 90,
      buyoutHistoryDaysFact: 35,
      buyoutOrderCountFact: 30,
      buyoutCountFact: 8,
      buyoutCancelCountFact: 4,
    });
    expect(diagnostics.canUseAuto).toBe(false);
    expect(diagnostics.reason).toBe('high_open_share');
  });
});
