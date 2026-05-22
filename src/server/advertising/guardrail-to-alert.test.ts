import { describe, it, expect } from 'vitest';
import { mapGuardrailToAutoPauseAction } from './guardrail-to-alert';
import { DEFAULT_GUARDRAIL_CONFIG, type GuardrailContext } from '@/lib/advertising/guardrails';

const BASE_CTX: GuardrailContext = {
  autopilotEnabled: true,
  strategyStartedAt: new Date('2026-01-01'),
  lastBidChangedAt: null,
  stockQty: 10,
  drrLookbackPct: 20,
  spendRub24h: 500,
  orders24h: 5,
  crPct7d: 1.2,
  spendTodayRubTotal: 500,
  currentBid: 50,
  proposedBid: 55,
  wbRecommendedBid: 100,
  targetAcosPct: 30,
};

describe('mapGuardrailToAutoPauseAction', () => {
  it('kill_switch → action kill_switch', () => {
    const action = mapGuardrailToAutoPauseAction('kill_switch', BASE_CTX, DEFAULT_GUARDRAIL_CONFIG);
    expect(action).toEqual({ type: 'kill_switch' });
  });

  it('low_stock → pause_stock с реальным остатком и порогом', () => {
    const action = mapGuardrailToAutoPauseAction(
      'low_stock',
      { ...BASE_CTX, stockQty: 1 },
      { ...DEFAULT_GUARDRAIL_CONFIG, minStockThreshold: 3 },
    );
    expect(action).toEqual({ type: 'pause_stock', stockQty: 1, thresholdQty: 3 });
  });

  it('low_stock → pause_stock с stockQty=0 если ctx.stockQty = null', () => {
    const action = mapGuardrailToAutoPauseAction(
      'low_stock',
      { ...BASE_CTX, stockQty: null },
      DEFAULT_GUARDRAIL_CONFIG,
    );
    expect(action).toMatchObject({ type: 'pause_stock', stockQty: 0 });
  });

  it('high_drr → pause_drr с явным maxDRRPct', () => {
    const action = mapGuardrailToAutoPauseAction(
      'high_drr',
      { ...BASE_CTX, drrLookbackPct: 60 },
      { ...DEFAULT_GUARDRAIL_CONFIG, maxDRRPct: 50 },
    );
    expect(action).toEqual({ type: 'pause_drr', drrPct: 60, thresholdPct: 50 });
  });

  it('high_drr → pause_drr с дефолтом 1.5× targetAcosPct когда maxDRRPct = null', () => {
    const action = mapGuardrailToAutoPauseAction(
      'high_drr',
      { ...BASE_CTX, drrLookbackPct: 50, targetAcosPct: 30 },
      { ...DEFAULT_GUARDRAIL_CONFIG, maxDRRPct: null },
    );
    expect(action).toEqual({ type: 'pause_drr', drrPct: 50, thresholdPct: 45 });
  });

  it('spend_no_orders → pause_no_orders со spend24h', () => {
    const action = mapGuardrailToAutoPauseAction(
      'spend_no_orders',
      { ...BASE_CTX, spendRub24h: 1200 },
      DEFAULT_GUARDRAIL_CONFIG,
    );
    expect(action).toEqual({ type: 'pause_no_orders', spentRub: 1200, hoursWindow: 24 });
  });

  it('low_cr → pause_low_cr с CR и порогом', () => {
    const action = mapGuardrailToAutoPauseAction(
      'low_cr',
      { ...BASE_CTX, crPct7d: 0.05 },
      { ...DEFAULT_GUARDRAIL_CONFIG, minCRPct: 0.1 },
    );
    expect(action).toEqual({ type: 'pause_low_cr', crPct: 0.05, thresholdPct: 0.1, daysWindow: 7 });
  });

  it('low_cr → 0 при null CR (не бросает)', () => {
    const action = mapGuardrailToAutoPauseAction(
      'low_cr',
      { ...BASE_CTX, crPct7d: null },
      DEFAULT_GUARDRAIL_CONFIG,
    );
    expect(action).toMatchObject({ type: 'pause_low_cr', crPct: 0 });
  });

  it('learning_period → null (не алертим)', () => {
    expect(mapGuardrailToAutoPauseAction('learning_period', BASE_CTX, DEFAULT_GUARDRAIL_CONFIG)).toBeNull();
  });

  it('cooldown → null', () => {
    expect(mapGuardrailToAutoPauseAction('cooldown', BASE_CTX, DEFAULT_GUARDRAIL_CONFIG)).toBeNull();
  });

  it('daily_cap → null (алертится через daily_cap_reached)', () => {
    expect(mapGuardrailToAutoPauseAction('daily_cap', BASE_CTX, DEFAULT_GUARDRAIL_CONFIG)).toBeNull();
  });

  it('max_bid_delta и max_bid → null (cluster-level, не strategy-level)', () => {
    expect(mapGuardrailToAutoPauseAction('max_bid_delta', BASE_CTX, DEFAULT_GUARDRAIL_CONFIG)).toBeNull();
    expect(mapGuardrailToAutoPauseAction('max_bid', BASE_CTX, DEFAULT_GUARDRAIL_CONFIG)).toBeNull();
  });
});
