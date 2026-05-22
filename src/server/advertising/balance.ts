import { and, desc, eq, gte, sum } from 'drizzle-orm';

import { AppError } from '@/lib/auth/tenant-access';
import { db, withTenantContext } from '@/lib/db';
import {
  advertisingAutoRefillLogs,
  advertisingAutoRefillSettings,
  advertisingBalanceSnapshots,
  tenants,
} from '@/lib/db/schema';
import { decryptIfNeeded } from '@/lib/encryption';
import { wbDepositAdBudget, wbGetAdBalance, wbGetAdSpendHistory } from '@/lib/wb-api/ads-balance';
import { sendAdAlert } from '@/server/advertising/send-alert';
import { logger } from '@/lib/logger';

const AUTO_REFILL_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours
const AUTO_REFILL_DAILY_CAP_DEFAULT = 10_000;
const BALANCE_CACHE_TTL_MS = 25 * 60 * 1000; // 25 min — refresh before 30-min sync

async function getTenantWbToken(tenantId: string): Promise<string> {
  const [tenant] = await db
    .select({ wbApiToken: tenants.wbApiToken })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  const token = decryptIfNeeded(tenant?.wbApiToken ?? '').trim();
  if (!token) {
    throw new AppError('Для кабинета не сохранён WB API токен. Добавьте токен в настройках.', 400);
  }
  return token;
}

export interface AdvertisingBalancePayload {
  realMoney: number;
  bonusSum: number;
  bonusPercent: number;
  bonusExpiresAt: string | null;
  syncedAt: string;
  spendHistory: { date: string; spendRub: number }[];
  forecastDaysLeft: number | null;
}

export async function getAdvertisingBalance(tenantId: string): Promise<AdvertisingBalancePayload> {
  const token = await getTenantWbToken(tenantId);

  // Fetch fresh balance + 30-day spend history in parallel
  const [balance, spendHistory] = await Promise.all([
    wbGetAdBalance(token),
    wbGetAdSpendHistory(token, 30),
  ]);

  const syncedAt = new Date();

  // Upsert snapshot
  await withTenantContext(db, tenantId, async (tx) => {
    await tx.insert(advertisingBalanceSnapshots).values({
      tenantId,
      realMoney: String(balance.realMoney),
      bonusSum: String(balance.bonus.sum),
      bonusPercent: balance.bonus.percent,
      bonusExpiresAt: balance.bonus.expiresAt ? new Date(balance.bonus.expiresAt) : null,
      syncedAt,
    });
  });

  // Forecast: avg daily spend over last 7 days
  const last7 = spendHistory.slice(-7);
  let forecastDaysLeft: number | null = null;
  if (last7.length > 0) {
    const avgDailySpend = last7.reduce((acc, p) => acc + p.spendRub, 0) / last7.length;
    if (avgDailySpend > 0) {
      forecastDaysLeft = Math.floor(balance.realMoney / avgDailySpend);
    }
  }

  return {
    realMoney: balance.realMoney,
    bonusSum: balance.bonus.sum,
    bonusPercent: balance.bonus.percent,
    bonusExpiresAt: balance.bonus.expiresAt,
    syncedAt: syncedAt.toISOString(),
    spendHistory,
    forecastDaysLeft,
  };
}

export async function getAdvertisingBalanceCached(tenantId: string): Promise<AdvertisingBalancePayload | null> {
  const cutoff = new Date(Date.now() - BALANCE_CACHE_TTL_MS);

  const [snapshot] = await withTenantContext(db, tenantId, async (tx) =>
    tx.select()
      .from(advertisingBalanceSnapshots)
      .where(and(
        eq(advertisingBalanceSnapshots.tenantId, tenantId),
        gte(advertisingBalanceSnapshots.syncedAt, cutoff),
      ))
      .orderBy(desc(advertisingBalanceSnapshots.syncedAt))
      .limit(1),
  );

  if (!snapshot) return null;

  return {
    realMoney: Number(snapshot.realMoney),
    bonusSum: Number(snapshot.bonusSum),
    bonusPercent: snapshot.bonusPercent,
    bonusExpiresAt: snapshot.bonusExpiresAt?.toISOString() ?? null,
    syncedAt: snapshot.syncedAt.toISOString(),
    spendHistory: [],
    forecastDaysLeft: null,
  };
}

export interface AutoRefillSettings {
  enabled: boolean;
  campaignId: number | null;
  thresholdRub: number;
  topUpAmountRub: number;
  dailyCapRub: number;
}

export async function getAutoRefillSettings(tenantId: string): Promise<AutoRefillSettings> {
  const [row] = await withTenantContext(db, tenantId, async (tx) =>
    tx.select()
      .from(advertisingAutoRefillSettings)
      .where(eq(advertisingAutoRefillSettings.tenantId, tenantId))
      .limit(1),
  );

  if (!row) {
    return {
      enabled: false,
      campaignId: null,
      thresholdRub: 500,
      topUpAmountRub: 2000,
      dailyCapRub: AUTO_REFILL_DAILY_CAP_DEFAULT,
    };
  }

  return {
    enabled: row.enabled,
    campaignId: row.campaignId ?? null,
    thresholdRub: Number(row.thresholdRub),
    topUpAmountRub: Number(row.topUpAmountRub),
    dailyCapRub: Number(row.dailyCapRub),
  };
}

export async function upsertAutoRefillSettings(
  tenantId: string,
  settings: Partial<AutoRefillSettings>
): Promise<AutoRefillSettings> {
  const existing = await getAutoRefillSettings(tenantId);
  const merged: AutoRefillSettings = { ...existing, ...settings };

  await withTenantContext(db, tenantId, async (tx) => {
    await tx.insert(advertisingAutoRefillSettings)
      .values({
        tenantId,
        enabled: merged.enabled,
        campaignId: merged.campaignId ?? null,
        thresholdRub: String(merged.thresholdRub),
        topUpAmountRub: String(merged.topUpAmountRub),
        dailyCapRub: String(merged.dailyCapRub),
      })
      .onConflictDoUpdate({
        target: advertisingAutoRefillSettings.tenantId,
        set: {
          enabled: merged.enabled,
          campaignId: merged.campaignId ?? null,
          thresholdRub: String(merged.thresholdRub),
          topUpAmountRub: String(merged.topUpAmountRub),
          dailyCapRub: String(merged.dailyCapRub),
          updatedAt: new Date(),
        },
      });
  });

  return merged;
}

export async function depositManual(
  tenantId: string,
  campaignId: number,
  amountRub: number
): Promise<void> {
  if (amountRub <= 0 || amountRub > 100_000) {
    throw new AppError('Сумма пополнения должна быть от 1 до 100 000 ₽', 400);
  }

  const token = await getTenantWbToken(tenantId);
  await wbDepositAdBudget(token, campaignId, amountRub);

  await withTenantContext(db, tenantId, async (tx) => {
    await tx.insert(advertisingAutoRefillLogs).values({
      tenantId,
      campaignId,
      amountRub: String(amountRub),
      triggeredBy: 'manual',
    });
  });
}

export interface AutoRefillResult {
  triggered: boolean;
  reason: string;
  amountRub?: number;
}

export async function checkAndRunAutoRefill(
  tenantId: string,
  currentBalanceRub: number
): Promise<AutoRefillResult> {
  const settings = await getAutoRefillSettings(tenantId);

  if (!settings.enabled) return { triggered: false, reason: 'auto-refill disabled' };
  if (!settings.campaignId) return { triggered: false, reason: 'no campaign configured' };
  if (currentBalanceRub > settings.thresholdRub) {
    return { triggered: false, reason: 'balance above threshold' };
  }

  const now = new Date();
  const cooldownCutoff = new Date(now.getTime() - AUTO_REFILL_COOLDOWN_MS);
  const dayCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // Check cooldown + daily cap in one tx
  const { lastRefill, dailyTotals } = await withTenantContext(db, tenantId, async (tx) => {
    const [lastRefillRow] = await tx.select({ createdAt: advertisingAutoRefillLogs.createdAt })
      .from(advertisingAutoRefillLogs)
      .where(and(
        eq(advertisingAutoRefillLogs.tenantId, tenantId),
        gte(advertisingAutoRefillLogs.createdAt, cooldownCutoff),
      ))
      .orderBy(desc(advertisingAutoRefillLogs.createdAt))
      .limit(1);

    const [dailyTotalsRow] = await tx.select({ total: sum(advertisingAutoRefillLogs.amountRub) })
      .from(advertisingAutoRefillLogs)
      .where(and(
        eq(advertisingAutoRefillLogs.tenantId, tenantId),
        gte(advertisingAutoRefillLogs.createdAt, dayCutoff),
      ));

    return { lastRefill: lastRefillRow, dailyTotals: dailyTotalsRow };
  });

  if (lastRefill) {
    return { triggered: false, reason: 'cooldown active (6h)' };
  }

  const dailySpent = Number(dailyTotals?.total ?? 0);
  const cap = settings.dailyCapRub;

  if (dailySpent + settings.topUpAmountRub > cap) {
    const remaining = cap - dailySpent;
    if (remaining <= 0) return { triggered: false, reason: 'daily cap reached' };
    // Top up with remaining capacity if partial is possible
    if (remaining < 100) return { triggered: false, reason: 'daily cap almost reached' };
    settings.topUpAmountRub = remaining;
  }

  const token = await getTenantWbToken(tenantId);
  await wbDepositAdBudget(token, settings.campaignId, settings.topUpAmountRub);

  await withTenantContext(db, tenantId, async (tx) => {
    await tx.insert(advertisingAutoRefillLogs).values({
      tenantId,
      campaignId: settings.campaignId!, // guarded by `if (!settings.campaignId) return` above
      amountRub: String(settings.topUpAmountRub),
      triggeredBy: 'auto',
    });
  });

  return { triggered: true, reason: 'balance below threshold', amountRub: settings.topUpAmountRub };
}

// Called by Inngest background sync
export async function syncAdvertisingBalance(tenantId: string): Promise<void> {
  let balance: AdvertisingBalancePayload;
  try {
    balance = await getAdvertisingBalance(tenantId);
  } catch {
    return; // Token missing or WB API error — skip silently, sync will retry
  }

  const settings = await getAutoRefillSettings(tenantId);
  if (balance.realMoney <= settings.thresholdRub) {
    void sendAdAlert(tenantId, {
      type: 'balance_low',
      currentRub: balance.realMoney,
      thresholdRub: settings.thresholdRub,
      daysLeft: null,
    }).catch((error: unknown) => {
      logger.error({ err: error, tenantId }, '[syncAdvertisingBalance] balance_low alert failed');
    });
  }

  await checkAndRunAutoRefill(tenantId, balance.realMoney);
}
