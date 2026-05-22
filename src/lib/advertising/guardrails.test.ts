import { describe, it, expect } from 'vitest';
import {
  checkGuardrails,
  isInLearningPeriod,
  normalizeGuardrailConfig,
  DEFAULT_GUARDRAIL_CONFIG,
  type GuardrailContext,
  type GuardrailConfig,
} from './guardrails';

const NOW = new Date('2026-04-17T12:00:00Z');
const NOW_MS = NOW.getTime();

function ctx(overrides: Partial<GuardrailContext> = {}): GuardrailContext {
  return {
    autopilotEnabled: true,
    strategyStartedAt: new Date(NOW_MS - 10 * 86_400_000), // 10 days ago
    lastBidChangedAt: null,
    stockQty: 10,
    drrLookbackPct: 30,
    spendRub24h: 100,
    orders24h: 5,
    crPct7d: 1.0,
    spendTodayRubTotal: 200,
    currentBid: 1000,
    proposedBid: 1050,
    wbRecommendedBid: null,
    targetAcosPct: 25,
    nowMs: NOW_MS,
    ...overrides,
  };
}

function cfg(overrides: Partial<GuardrailConfig> = {}): GuardrailConfig {
  return { ...DEFAULT_GUARDRAIL_CONFIG, ...overrides };
}

// ─── happy path ──────────────────────────────────────────────────────────────

describe('checkGuardrails — passed', () => {
  it('все в норме → passed: true', () => {
    const result = checkGuardrails(ctx(), cfg());
    expect(result.passed).toBe(true);
    expect(result.blockedBy).toBeNull();
  });
});

// ─── kill switch ─────────────────────────────────────────────────────────────

describe('kill_switch', () => {
  it('блокирует при autopilotEnabled = false', () => {
    const r = checkGuardrails(ctx({ autopilotEnabled: false }), cfg());
    expect(r.passed).toBe(false);
    expect(r.blockedBy).toBe('kill_switch');
    expect(r.advisorOnly).toBe(false);
  });
});

// ─── learning period ─────────────────────────────────────────────────────────

describe('learning_period', () => {
  it('advisor-only первые 7 дней', () => {
    const r = checkGuardrails(
      ctx({ strategyStartedAt: new Date(NOW_MS - 3 * 86_400_000) }),
      cfg(),
    );
    expect(r.passed).toBe(false);
    expect(r.blockedBy).toBe('learning_period');
    expect(r.advisorOnly).toBe(true);
  });

  it('проходит на 8-й день', () => {
    const r = checkGuardrails(
      ctx({ strategyStartedAt: new Date(NOW_MS - 8 * 86_400_000) }),
      cfg(),
    );
    expect(r.passed).toBe(true);
  });

  it('без learning period (0 дней) — не блокирует', () => {
    const r = checkGuardrails(
      ctx({ strategyStartedAt: new Date(NOW_MS - 1 * 86_400_000) }),
      cfg({ learningPeriodDays: 0 }),
    );
    expect(r.passed).toBe(true);
  });
});

describe('isInLearningPeriod', () => {
  it('true в пределах периода', () => {
    const start = new Date(NOW_MS - 3 * 86_400_000);
    expect(isInLearningPeriod(start, 7, NOW)).toBe(true);
  });

  it('false после периода', () => {
    const start = new Date(NOW_MS - 8 * 86_400_000);
    expect(isInLearningPeriod(start, 7, NOW)).toBe(false);
  });

  it('false при learningPeriodDays = 0', () => {
    expect(isInLearningPeriod(NOW, 0, NOW)).toBe(false);
  });
});

// ─── cooldown ────────────────────────────────────────────────────────────────

describe('cooldown', () => {
  it('блокирует если прошло < cooldown минут', () => {
    const r = checkGuardrails(
      ctx({ lastBidChangedAt: new Date(NOW_MS - 30 * 60_000) }),
      cfg({ bidCooldownMinutes: 60 }),
    );
    expect(r.blockedBy).toBe('cooldown');
  });

  it('проходит если прошло >= cooldown минут', () => {
    const r = checkGuardrails(
      ctx({ lastBidChangedAt: new Date(NOW_MS - 61 * 60_000) }),
      cfg({ bidCooldownMinutes: 60 }),
    );
    expect(r.passed).toBe(true);
  });

  it('проходит при lastBidChangedAt = null', () => {
    const r = checkGuardrails(ctx({ lastBidChangedAt: null }), cfg());
    expect(r.passed).toBe(true);
  });

  it('cooldown = 0 → не блокирует', () => {
    const r = checkGuardrails(
      ctx({ lastBidChangedAt: new Date(NOW_MS - 1) }),
      cfg({ bidCooldownMinutes: 0 }),
    );
    expect(r.passed).toBe(true);
  });
});

// ─── daily cap ───────────────────────────────────────────────────────────────

describe('daily_cap', () => {
  it('блокирует при достижении лимита', () => {
    const r = checkGuardrails(
      ctx({ spendTodayRubTotal: 1000 }),
      cfg({ dailySpendCapRub: 1000 }),
    );
    expect(r.blockedBy).toBe('daily_cap');
  });

  it('блокирует при превышении лимита', () => {
    const r = checkGuardrails(
      ctx({ spendTodayRubTotal: 1500 }),
      cfg({ dailySpendCapRub: 1000 }),
    );
    expect(r.blockedBy).toBe('daily_cap');
  });

  it('проходит ниже лимита', () => {
    const r = checkGuardrails(
      ctx({ spendTodayRubTotal: 999 }),
      cfg({ dailySpendCapRub: 1000 }),
    );
    expect(r.passed).toBe(true);
  });

  it('null cap → не блокирует', () => {
    const r = checkGuardrails(
      ctx({ spendTodayRubTotal: 99999 }),
      cfg({ dailySpendCapRub: null }),
    );
    expect(r.passed).toBe(true);
  });
});

// ─── low stock ───────────────────────────────────────────────────────────────

describe('low_stock', () => {
  it('блокирует при stockQty < threshold', () => {
    const r = checkGuardrails(ctx({ stockQty: 2 }), cfg({ minStockThreshold: 3 }));
    expect(r.blockedBy).toBe('low_stock');
  });

  it('проходит при stockQty = threshold', () => {
    const r = checkGuardrails(ctx({ stockQty: 3 }), cfg({ minStockThreshold: 3 }));
    expect(r.passed).toBe(true);
  });

  it('нулевой остаток → блокирует', () => {
    const r = checkGuardrails(ctx({ stockQty: 0 }), cfg());
    expect(r.blockedBy).toBe('low_stock');
  });

  it('null stockQty → пропускает проверку', () => {
    const r = checkGuardrails(ctx({ stockQty: null }), cfg());
    expect(r.passed).toBe(true);
  });
});

// ─── high DRR ────────────────────────────────────────────────────────────────

describe('high_drr', () => {
  it('блокирует при ДРР > явного лимита', () => {
    const r = checkGuardrails(
      ctx({ drrLookbackPct: 80 }),
      cfg({ maxDRRPct: 75 }),
    );
    expect(r.blockedBy).toBe('high_drr');
  });

  it('блокирует при ДРР > 1.5 × targetAcosPct (dynamic)', () => {
    // targetAcosPct=25 → maxDRR=37.5
    const r = checkGuardrails(
      ctx({ drrLookbackPct: 40, targetAcosPct: 25 }),
      cfg({ maxDRRPct: null }),
    );
    expect(r.blockedBy).toBe('high_drr');
  });

  it('проходит при ДРР ниже динамического лимита', () => {
    const r = checkGuardrails(
      ctx({ drrLookbackPct: 30, targetAcosPct: 25 }),
      cfg({ maxDRRPct: null }),
    );
    expect(r.passed).toBe(true);
  });

  it('null drrLookbackPct → пропускает', () => {
    const r = checkGuardrails(ctx({ drrLookbackPct: null }), cfg({ maxDRRPct: 10 }));
    expect(r.passed).toBe(true);
  });
});

// ─── spend without orders ────────────────────────────────────────────────────

describe('spend_no_orders', () => {
  it('блокирует при 0 заказах и расходе выше лимита', () => {
    const r = checkGuardrails(
      ctx({ orders24h: 0, spendRub24h: 600 }),
      cfg({ maxSpendWithoutOrdersRub: 500 }),
    );
    expect(r.blockedBy).toBe('spend_no_orders');
  });

  it('не блокирует если есть заказы', () => {
    const r = checkGuardrails(
      ctx({ orders24h: 1, spendRub24h: 9999 }),
      cfg({ maxSpendWithoutOrdersRub: 500 }),
    );
    expect(r.passed).toBe(true);
  });

  it('не блокирует при расходе ≤ лимита без заказов', () => {
    const r = checkGuardrails(
      ctx({ orders24h: 0, spendRub24h: 500 }),
      cfg({ maxSpendWithoutOrdersRub: 500 }),
    );
    expect(r.passed).toBe(true);
  });
});

// ─── low CR ──────────────────────────────────────────────────────────────────

describe('low_cr', () => {
  it('блокирует при CR < minCRPct', () => {
    const r = checkGuardrails(
      ctx({ crPct7d: 0.05 }),
      cfg({ minCRPct: 0.1 }),
    );
    expect(r.blockedBy).toBe('low_cr');
  });

  it('нулевой CR → блокирует', () => {
    const r = checkGuardrails(ctx({ crPct7d: 0 }), cfg({ minCRPct: 0.1 }));
    expect(r.blockedBy).toBe('low_cr');
  });

  it('null crPct7d → пропускает', () => {
    const r = checkGuardrails(ctx({ crPct7d: null }), cfg({ minCRPct: 0.1 }));
    expect(r.passed).toBe(true);
  });

  it('проходит при CR = minCRPct', () => {
    const r = checkGuardrails(ctx({ crPct7d: 0.1 }), cfg({ minCRPct: 0.1 }));
    expect(r.passed).toBe(true);
  });
});

// ─── max bid delta ───────────────────────────────────────────────────────────

describe('max_bid_delta', () => {
  it('блокирует при дельте > 20%', () => {
    const r = checkGuardrails(
      ctx({ currentBid: 1000, proposedBid: 1250 }), // +25%
      cfg({ maxBidDeltaPct: 20 }),
    );
    expect(r.blockedBy).toBe('max_bid_delta');
  });

  it('блокирует при понижении > 20%', () => {
    const r = checkGuardrails(
      ctx({ currentBid: 1000, proposedBid: 750 }), // -25%
      cfg({ maxBidDeltaPct: 20 }),
    );
    expect(r.blockedBy).toBe('max_bid_delta');
  });

  it('проходит при дельте = 20%', () => {
    const r = checkGuardrails(
      ctx({ currentBid: 1000, proposedBid: 1200 }), // +20%
      cfg({ maxBidDeltaPct: 20 }),
    );
    expect(r.passed).toBe(true);
  });

  it('maxBidDeltaPct = 0 → не блокирует (отключён)', () => {
    const r = checkGuardrails(
      ctx({ currentBid: 1000, proposedBid: 9999 }),
      cfg({ maxBidDeltaPct: 0 }),
    );
    expect(r.passed).toBe(true);
  });
});

// ─── max bid ─────────────────────────────────────────────────────────────────

describe('max_bid', () => {
  it('блокирует при ставке > 1.5× рекомендованной', () => {
    const r = checkGuardrails(
      ctx({ currentBid: 3200, proposedBid: 3200, wbRecommendedBid: 2000 }),
      cfg({ maxBidMultiplier: 1.5 }),
    );
    expect(r.blockedBy).toBe('max_bid');
  });

  it('проходит при ставке = 1.5× рекомендованной', () => {
    const r = checkGuardrails(
      ctx({ currentBid: 3000, proposedBid: 3000, wbRecommendedBid: 2000 }),
      cfg({ maxBidMultiplier: 1.5 }),
    );
    expect(r.passed).toBe(true);
  });

  it('null wbRecommendedBid → пропускает', () => {
    const r = checkGuardrails(
      ctx({ currentBid: 9999, proposedBid: 9999, wbRecommendedBid: null }),
      cfg({ maxBidMultiplier: 1.5 }),
    );
    expect(r.passed).toBe(true);
  });
});

// ─── normalizeGuardrailConfig ─────────────────────────────────────────────────

describe('normalizeGuardrailConfig', () => {
  it('возвращает дефолты при пустом объекте', () => {
    const c = normalizeGuardrailConfig({});
    expect(c).toEqual(DEFAULT_GUARDRAIL_CONFIG);
  });

  it('clamps отрицательные значения в 0', () => {
    const c = normalizeGuardrailConfig({ minStockThreshold: -5, maxBidDeltaPct: -10 });
    expect(c.minStockThreshold).toBe(0);
    expect(c.maxBidDeltaPct).toBe(0);
  });

  it('maxBidMultiplier не ниже 1', () => {
    const c = normalizeGuardrailConfig({ maxBidMultiplier: 0.5 });
    expect(c.maxBidMultiplier).toBe(1);
  });

  it('null → возвращает дефолты', () => {
    expect(normalizeGuardrailConfig(null)).toEqual(DEFAULT_GUARDRAIL_CONFIG);
  });
});
