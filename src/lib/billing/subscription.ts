import { desc, eq } from 'drizzle-orm';

import { db, withTenantContext } from '@/lib/db';
import { plans, subscriptions } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';

export const SUBSCRIPTION_STATUSES = [
  'trialing',
  'active',
  'past_due',
  'grace',
  'canceled',
  'expired',
] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
export type EffectiveSubscriptionStatus = SubscriptionStatus | 'missing';
export type SubscriptionAccessReason =
  | 'no_subscription'
  | 'trial_active'
  | 'trial_expired'
  | 'active'
  | 'active_in_grace'
  | 'past_due'
  | 'past_due_in_grace'
  | 'grace_active'
  | 'grace_expired'
  | 'canceled'
  | 'expired'
  | 'unknown_status';

type DateLike = Date | string | null | undefined;

export type SubscriptionForEntitlement = {
  status: string;
  currentPeriodEnd?: DateLike;
  trialEndsAt?: DateLike;
  graceUntil?: DateLike;
};

export type SubscriptionEntitlement = {
  hasAccess: boolean;
  effectiveStatus: EffectiveSubscriptionStatus;
  reason: SubscriptionAccessReason;
  accessUntil: Date | null;
};

function toDate(value: DateLike): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isFutureOrNow(value: Date | null, now: Date) {
  return value ? value.getTime() >= now.getTime() : false;
}

function normalizeStatus(status: string): SubscriptionStatus | null {
  return SUBSCRIPTION_STATUSES.includes(status as SubscriptionStatus)
    ? status as SubscriptionStatus
    : null;
}

export function resolveSubscriptionEntitlement(
  subscription: SubscriptionForEntitlement | null | undefined,
  now = new Date(),
): SubscriptionEntitlement {
  if (!subscription) {
    return {
      hasAccess: false,
      effectiveStatus: 'missing',
      reason: 'no_subscription',
      accessUntil: null,
    };
  }

  const status = normalizeStatus(subscription.status);
  const currentPeriodEnd = toDate(subscription.currentPeriodEnd);
  const trialEndsAt = toDate(subscription.trialEndsAt);
  const graceUntil = toDate(subscription.graceUntil);

  if (!status) {
    return {
      hasAccess: false,
      effectiveStatus: 'expired',
      reason: 'unknown_status',
      accessUntil: null,
    };
  }

  if (status === 'canceled') {
    return {
      hasAccess: false,
      effectiveStatus: 'canceled',
      reason: 'canceled',
      accessUntil: currentPeriodEnd,
    };
  }

  if (status === 'expired') {
    return {
      hasAccess: false,
      effectiveStatus: 'expired',
      reason: 'expired',
      accessUntil: currentPeriodEnd,
    };
  }

  if (status === 'trialing') {
    const trialActive = isFutureOrNow(trialEndsAt, now);
    return {
      hasAccess: trialActive,
      effectiveStatus: trialActive ? 'trialing' : 'expired',
      reason: trialActive ? 'trial_active' : 'trial_expired',
      accessUntil: trialEndsAt,
    };
  }

  if (status === 'active') {
    if (!currentPeriodEnd || isFutureOrNow(currentPeriodEnd, now)) {
      return {
        hasAccess: true,
        effectiveStatus: 'active',
        reason: 'active',
        accessUntil: currentPeriodEnd,
      };
    }

    const graceActive = isFutureOrNow(graceUntil, now);
    return {
      hasAccess: graceActive,
      effectiveStatus: graceActive ? 'grace' : 'expired',
      reason: graceActive ? 'active_in_grace' : 'expired',
      accessUntil: graceActive ? graceUntil : currentPeriodEnd,
    };
  }

  if (status === 'past_due') {
    const graceActive = isFutureOrNow(graceUntil, now);
    return {
      hasAccess: graceActive,
      effectiveStatus: graceActive ? 'grace' : 'past_due',
      reason: graceActive ? 'past_due_in_grace' : 'past_due',
      accessUntil: graceActive ? graceUntil : currentPeriodEnd,
    };
  }

  const graceActive = isFutureOrNow(graceUntil, now);
  return {
    hasAccess: graceActive,
    effectiveStatus: graceActive ? 'grace' : 'expired',
    reason: graceActive ? 'grace_active' : 'grace_expired',
    accessUntil: graceUntil,
  };
}

export function isFeatureEnabled(features: Record<string, unknown> | null | undefined, feature?: string) {
  if (!feature) return true;
  return features?.[feature] === true;
}

export async function requireActiveSubscription(tenantId: string, feature?: string) {
  if (!tenantId) {
    throw new AppError('Missing tenantId', 400);
  }

  const [row] = await withTenantContext(db, tenantId, (tx) =>
    tx.select({
      subscriptionId: subscriptions.id,
      status: subscriptions.status,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      trialEndsAt: subscriptions.trialEndsAt,
      graceUntil: subscriptions.graceUntil,
      planId: plans.id,
      planCode: plans.code,
      planName: plans.name,
      planFeatures: plans.features,
    })
      .from(subscriptions)
      .leftJoin(plans, eq(subscriptions.planId, plans.id))
      .where(eq(subscriptions.tenantId, tenantId))
      .orderBy(desc(subscriptions.createdAt))
      .limit(1),
  );

  const entitlement = resolveSubscriptionEntitlement(row ?? null);
  if (!entitlement.hasAccess) {
    throw new AppError('Подписка не активна', 402);
  }

  if (!isFeatureEnabled(row?.planFeatures, feature)) {
    throw new AppError('Функция недоступна на текущем тарифе', 403);
  }

  return {
    tenantId,
    subscriptionId: row?.subscriptionId ?? null,
    planId: row?.planId ?? null,
    planCode: row?.planCode ?? null,
    planName: row?.planName ?? null,
    entitlement,
  };
}

