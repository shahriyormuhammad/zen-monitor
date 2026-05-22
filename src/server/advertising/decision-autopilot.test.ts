import { describe, expect, it } from 'vitest';

import type { AdvertisingDecisionCard } from '@/server/analytics/advertising-decision-center';
import {
  canApplyDecisionAutomatically,
  canPreviewDecisionAutomatically,
  normalizeAdvertisingDecisionAutopilotMode,
} from './decision-autopilot';

function card(partial: Partial<AdvertisingDecisionCard>): AdvertisingDecisionCard {
  return {
    id: 'card-1',
    type: 'lower_bid',
    title: 'Снизить ставку',
    productTitle: null,
    vendorCode: null,
    brand: null,
    photoUrl: null,
    reason: 'test',
    money: '100 ₽',
    risk: 'medium',
    reasonCode: 'bid_economics',
    reasonLabel: 'Ставка',
    actionLabel: 'Проверить',
    action: 'confirm_lower_bid',
    nmId: 1001,
    groupId: null,
    groupName: null,
    attributionScope: 'sku',
    advertId: null,
    ...partial,
    plan: partial.plan ?? {
      primary: 'Проверяем изменение ставки.',
      expectedEffect: 'Ожидаем управляемый эффект.',
      guardrail: 'Guardrails включены.',
      followUp: 'Мониторим последствия.',
    },
  };
}

describe('advertising decision autopilot policy', () => {
  it('normalizes unknown modes to advisor', () => {
    expect(normalizeAdvertisingDecisionAutopilotMode('auto')).toBe('auto');
    expect(normalizeAdvertisingDecisionAutopilotMode('semi_auto')).toBe('semi_auto');
    expect(normalizeAdvertisingDecisionAutopilotMode('unexpected')).toBe('advisor');
    expect(normalizeAdvertisingDecisionAutopilotMode(null)).toBe('advisor');
  });

  it('keeps advisor mode read-only', () => {
    const item = card({});

    expect(canPreviewDecisionAutomatically('advisor', item)).toBe(false);
    expect(canApplyDecisionAutomatically('advisor', item)).toBe(false);
  });

  it('semi-auto applies only lower bid decisions', () => {
    expect(canApplyDecisionAutomatically('semi_auto', card({ type: 'lower_bid', action: 'confirm_lower_bid' }))).toBe(true);
    expect(canApplyDecisionAutomatically('semi_auto', card({ type: 'stop_now', action: 'confirm_cleanup', risk: 'high' }))).toBe(false);
    expect(canApplyDecisionAutomatically('semi_auto', card({ type: 'raise_bid', action: 'confirm_raise_bid', risk: 'low' }))).toBe(false);
  });

  it('auto applies stop/lower and only low-risk raises', () => {
    expect(canApplyDecisionAutomatically('auto', card({ type: 'stop_now', action: 'confirm_cleanup', risk: 'high' }))).toBe(true);
    expect(canApplyDecisionAutomatically('auto', card({ type: 'lower_bid', action: 'confirm_lower_bid', risk: 'medium' }))).toBe(true);
    expect(canApplyDecisionAutomatically('auto', card({ type: 'raise_bid', action: 'confirm_raise_bid', risk: 'low' }))).toBe(true);
    expect(canApplyDecisionAutomatically('auto', card({ type: 'raise_bid', action: 'confirm_raise_bid', risk: 'medium' }))).toBe(false);
  });

  it('does not preview non-confirmation cards', () => {
    expect(canPreviewDecisionAutomatically('auto', card({ type: 'check_product', action: 'open_products' }))).toBe(false);
    expect(canPreviewDecisionAutomatically('auto', card({ type: 'quiet', action: 'none' }))).toBe(false);
  });
});
