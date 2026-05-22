import { describe, expect, it } from 'vitest';

import {
  isFeatureEnabled,
  resolveSubscriptionEntitlement,
} from './subscription';

const NOW = new Date('2026-05-11T12:00:00.000Z');

describe('resolveSubscriptionEntitlement', () => {
  it('denies access when subscription is missing', () => {
    expect(resolveSubscriptionEntitlement(null, NOW)).toMatchObject({
      hasAccess: false,
      effectiveStatus: 'missing',
      reason: 'no_subscription',
    });
  });

  it('allows active trial before trial end', () => {
    expect(resolveSubscriptionEntitlement({
      status: 'trialing',
      trialEndsAt: '2026-05-12T00:00:00.000Z',
    }, NOW)).toMatchObject({
      hasAccess: true,
      effectiveStatus: 'trialing',
      reason: 'trial_active',
    });
  });

  it('denies expired trial', () => {
    expect(resolveSubscriptionEntitlement({
      status: 'trialing',
      trialEndsAt: '2026-05-10T00:00:00.000Z',
    }, NOW)).toMatchObject({
      hasAccess: false,
      effectiveStatus: 'expired',
      reason: 'trial_expired',
    });
  });

  it('allows active subscription within current period', () => {
    expect(resolveSubscriptionEntitlement({
      status: 'active',
      currentPeriodEnd: '2026-06-11T00:00:00.000Z',
    }, NOW)).toMatchObject({
      hasAccess: true,
      effectiveStatus: 'active',
      reason: 'active',
    });
  });

  it('allows expired active subscription only when grace is still open', () => {
    expect(resolveSubscriptionEntitlement({
      status: 'active',
      currentPeriodEnd: '2026-05-10T00:00:00.000Z',
      graceUntil: '2026-05-13T00:00:00.000Z',
    }, NOW)).toMatchObject({
      hasAccess: true,
      effectiveStatus: 'grace',
      reason: 'active_in_grace',
    });
  });

  it('denies past_due without active grace', () => {
    expect(resolveSubscriptionEntitlement({
      status: 'past_due',
      currentPeriodEnd: '2026-05-10T00:00:00.000Z',
    }, NOW)).toMatchObject({
      hasAccess: false,
      effectiveStatus: 'past_due',
      reason: 'past_due',
    });
  });

  it('denies canceled and expired subscriptions', () => {
    expect(resolveSubscriptionEntitlement({ status: 'canceled' }, NOW).hasAccess).toBe(false);
    expect(resolveSubscriptionEntitlement({ status: 'expired' }, NOW).hasAccess).toBe(false);
  });
});

describe('isFeatureEnabled', () => {
  it('allows absent feature checks', () => {
    expect(isFeatureEnabled({}, undefined)).toBe(true);
  });

  it('allows only explicit true feature flags', () => {
    expect(isFeatureEnabled({ reviewsQa: true }, 'reviewsQa')).toBe(true);
    expect(isFeatureEnabled({ reviewsQa: false }, 'reviewsQa')).toBe(false);
    expect(isFeatureEnabled({ reviewsQa: 'true' }, 'reviewsQa')).toBe(false);
    expect(isFeatureEnabled({}, 'reviewsQa')).toBe(false);
  });
});

