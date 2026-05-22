import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
} from 'drizzle-orm';

import { AppError } from '@/lib/auth/tenant-access';
import { db, withAdminContext, withTenantContext } from '@/lib/db';
import {
  advertisingBidChanges,
  advertisingBidPacingRules,
  advertisingBidPortfolios,
  products,
  rawApiAdClusters,
  tenants,
} from '@/lib/db/schema';
import { decryptIfNeeded } from '@/lib/encryption';
import { wbApi } from '@/lib/wb-api';

import {
  executeBulkBidUpdate,
  getAdvertisingBidWorkspace,
} from './workspace';

const ACTIONABLE_STATUSES = new Set([4, 9, 11]);
const MAX_PORTFOLIO_NM_IDS = 120;
const MAX_DUE_RULES = 40;
const DEFAULT_TIMEZONE = 'Europe/Moscow';

type TriggerSource = 'manual' | 'scheduled';

export type AdvertisingPacingRuleRecord = {
  id: string;
  name: string;
  advertId: number;
  nmId: number;
  isEnabled: boolean;
  dryRun: boolean;
  dailyBudgetRub: number;
  softCapPct: number;
  stepDownPct: number;
  minBid: number;
  maxBid: number;
  daypartHours: number[];
  timezone: string;
  intervalMinutes: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastStatus: string | null;
  lastSummary: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type SaveAdvertisingPacingRuleInput = {
  id?: string;
  name: string;
  advertId: number;
  nmId: number;
  isEnabled: boolean;
  dryRun: boolean;
  dailyBudgetRub: number;
  softCapPct: number;
  stepDownPct: number;
  minBid: number;
  maxBid: number;
  daypartHours: number[];
  timezone: string;
  intervalMinutes: number;
};

export type AdvertisingPortfolioRecord = {
  id: string;
  name: string;
  brandFilter: string | null;
  nmIds: number[];
  isEnabled: boolean;
  dryRun: boolean;
  targetAcosPct: number;
  minOrders: number;
  maxCpcRub: number;
  dailyBudgetRub: number;
  minBid: number;
  maxBid: number;
  stepUpPct: number;
  stepDownPct: number;
  lookbackDays: number;
  intervalMinutes: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastStatus: string | null;
  lastSummary: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type SaveAdvertisingPortfolioInput = {
  id?: string;
  name: string;
  brandFilter?: string | null;
  nmIds: number[];
  isEnabled: boolean;
  dryRun: boolean;
  targetAcosPct: number;
  minOrders: number;
  maxCpcRub: number;
  dailyBudgetRub: number;
  minBid: number;
  maxBid: number;
  stepUpPct: number;
  stepDownPct: number;
  lookbackDays: number;
  intervalMinutes: number;
};

type BidChangeRow = {
  id: string;
  source: string;
  advertId: number;
  nmId: number;
  cluster: string;
  previousBid: number | null;
  nextBid: number | null;
  status: string;
  reason: string | null;
  createdAt: string;
};

export type AdvertisingPacingWorkspaceResponse = {
  generatedAt: string;
  rules: AdvertisingPacingRuleRecord[];
  recentChanges: BidChangeRow[];
};

export type AdvertisingPortfolioWorkspaceResponse = {
  generatedAt: string;
  portfolios: AdvertisingPortfolioRecord[];
  recentChanges: BidChangeRow[];
};

function toNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toInt(value: unknown) {
  return Math.round(toNumber(value));
}

function round(value: number, precision = 2) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function toUtcDayStart(value: Date) {
  const next = new Date(value);
  next.setUTCHours(0, 0, 0, 0);
  return next;
}

function addUtcDays(value: Date, days: number) {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function computeNextRunAt(intervalMinutes: number, baseDate = new Date()) {
  return new Date(baseDate.getTime() + intervalMinutes * 60_000);
}

function parseHours(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as number[];
  }
  const unique = new Set<number>();
  for (const item of value) {
    const hour = Math.round(Number(item));
    if (Number.isFinite(hour) && hour >= 0 && hour <= 23) {
      unique.add(hour);
    }
  }
  return [...unique].sort((left, right) => left - right);
}

function parseNmIds(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as number[];
  }
  const unique = new Set<number>();
  for (const item of value) {
    const nmId = Math.round(Number(item));
    if (Number.isFinite(nmId) && nmId > 0) {
      unique.add(nmId);
    }
  }
  return [...unique].slice(0, MAX_PORTFOLIO_NM_IDS);
}

function parseBrandTerms(filter: string | null) {
  return String(filter ?? '')
    .split(/[,\n;]+/g)
    .map((item) => item.trim().toLocaleLowerCase('ru-RU'))
    .filter((item) => item.length > 0);
}

function getCurrentHourInTimezone(timezone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    hour12: false,
    timeZone: timezone || DEFAULT_TIMEZONE,
  }).formatToParts(new Date());

  const hourRaw = parts.find((item) => item.type === 'hour')?.value ?? '0';
  const hour = Number(hourRaw);
  return Number.isFinite(hour) ? hour : 0;
}

async function getTenantWbToken(tenantId: string) {
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

async function getNmSpendForDay(tenantId: string, nmId: number, day: Date) {
  const dayStart = toUtcDayStart(day);
  const dayEnd = addUtcDays(dayStart, 1);

  const [row] = await withTenantContext(db, tenantId, async (tx) =>
    tx.select({
      spend: sql<number>`COALESCE(SUM(${rawApiAdClusters.amount}), 0)::numeric`,
    })
      .from(rawApiAdClusters)
      .where(and(
        eq(rawApiAdClusters.tenantId, tenantId),
        eq(rawApiAdClusters.nmId, nmId),
        gte(rawApiAdClusters.date, dayStart),
        lt(rawApiAdClusters.date, dayEnd),
      )),
  );

  return round(toNumber(row?.spend), 2);
}

async function getSpendForNmIdsForDay(tenantId: string, nmIds: number[], day: Date) {
  if (nmIds.length === 0) {
    return 0;
  }

  const dayStart = toUtcDayStart(day);
  const dayEnd = addUtcDays(dayStart, 1);

  const [row] = await withTenantContext(db, tenantId, async (tx) =>
    tx.select({
      spend: sql<number>`COALESCE(SUM(${rawApiAdClusters.amount}), 0)::numeric`,
    })
      .from(rawApiAdClusters)
      .where(and(
        eq(rawApiAdClusters.tenantId, tenantId),
        inArray(rawApiAdClusters.nmId, nmIds),
        gte(rawApiAdClusters.date, dayStart),
        lt(rawApiAdClusters.date, dayEnd),
      )),
  );

  return round(toNumber(row?.spend), 2);
}

function aggregateAcosProxyPct(rows: Array<{ adSpend: number; acosProxyPct: number | null }>) {
  const spend = rows.reduce((sum, row) => sum + row.adSpend, 0);
  const revenueProxy = rows.reduce((sum, row) => {
    if (row.acosProxyPct === null || row.acosProxyPct <= 0) {
      return sum;
    }
    return sum + (row.adSpend / (row.acosProxyPct / 100));
  }, 0);

  if (!Number.isFinite(revenueProxy) || revenueProxy <= 0) {
    return null;
  }

  return round((spend / revenueProxy) * 100, 2);
}

function mapBidChange(row: typeof advertisingBidChanges.$inferSelect): BidChangeRow {
  return {
    id: row.id,
    source: row.source,
    advertId: Number(row.advertId),
    nmId: Number(row.nmId),
    cluster: row.cluster,
    previousBid: row.previousBid,
    nextBid: row.nextBid,
    status: row.status,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
  };
}

function mapPacingRuleRecord(row: typeof advertisingBidPacingRules.$inferSelect): AdvertisingPacingRuleRecord {
  return {
    id: row.id,
    name: row.name,
    advertId: Number(row.advertId),
    nmId: Number(row.nmId),
    isEnabled: row.isEnabled,
    dryRun: row.dryRun,
    dailyBudgetRub: toNumber(row.dailyBudgetRub),
    softCapPct: toNumber(row.softCapPct),
    stepDownPct: toNumber(row.stepDownPct),
    minBid: row.minBid,
    maxBid: row.maxBid,
    daypartHours: parseHours(row.daypartHours),
    timezone: row.timezone ?? DEFAULT_TIMEZONE,
    intervalMinutes: row.intervalMinutes,
    lastRunAt: row.lastRunAt ? row.lastRunAt.toISOString() : null,
    nextRunAt: row.nextRunAt ? row.nextRunAt.toISOString() : null,
    lastStatus: row.lastStatus,
    lastSummary: (row.lastSummary ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapPortfolioRecord(row: typeof advertisingBidPortfolios.$inferSelect): AdvertisingPortfolioRecord {
  return {
    id: row.id,
    name: row.name,
    brandFilter: row.brandFilter,
    nmIds: parseNmIds(row.nmIds),
    isEnabled: row.isEnabled,
    dryRun: row.dryRun,
    targetAcosPct: toNumber(row.targetAcosPct),
    minOrders: row.minOrders,
    maxCpcRub: toNumber(row.maxCpcRub),
    dailyBudgetRub: toNumber(row.dailyBudgetRub),
    minBid: row.minBid,
    maxBid: row.maxBid,
    stepUpPct: toNumber(row.stepUpPct),
    stepDownPct: toNumber(row.stepDownPct),
    lookbackDays: row.lookbackDays,
    intervalMinutes: row.intervalMinutes,
    lastRunAt: row.lastRunAt ? row.lastRunAt.toISOString() : null,
    nextRunAt: row.nextRunAt ? row.nextRunAt.toISOString() : null,
    lastStatus: row.lastStatus,
    lastSummary: (row.lastSummary ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function validatePacingRuleInput(input: SaveAdvertisingPacingRuleInput) {
  const name = String(input.name ?? '').trim();
  if (!name) {
    throw new AppError('Название правила обязательно', 400);
  }

  if (!Number.isFinite(input.advertId) || input.advertId <= 0) {
    throw new AppError('Некорректный advertId', 400);
  }
  if (!Number.isFinite(input.nmId) || input.nmId <= 0) {
    throw new AppError('Некорректный nmId', 400);
  }

  const minBid = Math.max(0, Math.round(input.minBid));
  const maxBid = Math.max(minBid, Math.round(input.maxBid));
  const intervalMinutes = Math.min(1_440, Math.max(10, Math.round(input.intervalMinutes)));
  const timezone = String(input.timezone ?? DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE;

  return {
    ...input,
    name,
    minBid,
    maxBid,
    intervalMinutes,
    timezone,
    daypartHours: parseHours(input.daypartHours),
    dailyBudgetRub: Math.max(0, round(input.dailyBudgetRub, 2)),
    softCapPct: Math.min(100, Math.max(1, round(input.softCapPct, 2))),
    stepDownPct: Math.max(1, round(input.stepDownPct, 2)),
  };
}

function validatePortfolioInput(input: SaveAdvertisingPortfolioInput) {
  const name = String(input.name ?? '').trim();
  if (!name) {
    throw new AppError('Название портфеля обязательно', 400);
  }

  const minBid = Math.max(0, Math.round(input.minBid));
  const maxBid = Math.max(minBid, Math.round(input.maxBid));
  const intervalMinutes = Math.min(1_440, Math.max(15, Math.round(input.intervalMinutes)));

  return {
    ...input,
    name,
    brandFilter: String(input.brandFilter ?? '').trim() || null,
    nmIds: parseNmIds(input.nmIds),
    minBid,
    maxBid,
    intervalMinutes,
    targetAcosPct: Math.max(1, round(input.targetAcosPct, 2)),
    minOrders: Math.max(0, Math.round(input.minOrders)),
    maxCpcRub: Math.max(0, round(input.maxCpcRub, 2)),
    dailyBudgetRub: Math.max(0, round(input.dailyBudgetRub, 2)),
    stepUpPct: Math.max(0, round(input.stepUpPct, 2)),
    stepDownPct: Math.max(1, round(input.stepDownPct, 2)),
    lookbackDays: Math.min(30, Math.max(1, Math.round(input.lookbackDays))),
  };
}

export async function getAdvertisingPacingWorkspace(tenantId: string): Promise<AdvertisingPacingWorkspaceResponse> {
  const [rules, changes] = await withTenantContext(db, tenantId, async (tx) => Promise.all([
    tx.select()
      .from(advertisingBidPacingRules)
      .where(eq(advertisingBidPacingRules.tenantId, tenantId))
      .orderBy(desc(advertisingBidPacingRules.updatedAt))
      .limit(80),
    tx.select()
      .from(advertisingBidChanges)
      .where(and(
        eq(advertisingBidChanges.tenantId, tenantId),
        eq(advertisingBidChanges.source, 'pacing'),
      ))
      .orderBy(desc(advertisingBidChanges.createdAt))
      .limit(120),
  ]));

  return {
    generatedAt: new Date().toISOString(),
    rules: rules.map(mapPacingRuleRecord),
    recentChanges: changes.map(mapBidChange),
  };
}

export async function saveAdvertisingPacingRule(
  tenantId: string,
  userId: string | null,
  input: SaveAdvertisingPacingRuleInput,
): Promise<AdvertisingPacingRuleRecord> {
  const validated = validatePacingRuleInput(input);
  const now = new Date();

  if (validated.id) {
    const [updated] = await withTenantContext(db, tenantId, async (tx) =>
      tx.update(advertisingBidPacingRules)
        .set({
          userId,
          name: validated.name,
          advertId: validated.advertId,
          nmId: validated.nmId,
          isEnabled: validated.isEnabled,
          dryRun: validated.dryRun,
          dailyBudgetRub: String(validated.dailyBudgetRub),
          softCapPct: String(validated.softCapPct),
          stepDownPct: String(validated.stepDownPct),
          minBid: validated.minBid,
          maxBid: validated.maxBid,
          daypartHours: validated.daypartHours,
          timezone: validated.timezone,
          intervalMinutes: validated.intervalMinutes,
          nextRunAt: validated.isEnabled ? computeNextRunAt(validated.intervalMinutes, now) : null,
          updatedAt: now,
        })
        .where(and(
          eq(advertisingBidPacingRules.id, validated.id!),
          eq(advertisingBidPacingRules.tenantId, tenantId),
        ))
        .returning(),
    );

    if (!updated) {
      throw new AppError('Правило пейсинга не найдено', 404);
    }

    return mapPacingRuleRecord(updated);
  }

  const created = (await withTenantContext(db, tenantId, async (tx) =>
    tx.insert(advertisingBidPacingRules)
      .values({
        tenantId,
        userId,
        name: validated.name,
        advertId: validated.advertId,
        nmId: validated.nmId,
        isEnabled: validated.isEnabled,
        dryRun: validated.dryRun,
        dailyBudgetRub: String(validated.dailyBudgetRub),
        softCapPct: String(validated.softCapPct),
        stepDownPct: String(validated.stepDownPct),
        minBid: validated.minBid,
        maxBid: validated.maxBid,
        daypartHours: validated.daypartHours,
        timezone: validated.timezone,
        intervalMinutes: validated.intervalMinutes,
        nextRunAt: validated.isEnabled ? computeNextRunAt(validated.intervalMinutes, now) : null,
        updatedAt: now,
      })
      .returning(),
  ))[0]!;

  return mapPacingRuleRecord(created);
}

export async function deleteAdvertisingPacingRule(tenantId: string, ruleId: string): Promise<void> {
  await withTenantContext(db, tenantId, async (tx) => {
    await tx.delete(advertisingBidPacingRules)
      .where(and(
        eq(advertisingBidPacingRules.id, ruleId),
        eq(advertisingBidPacingRules.tenantId, tenantId),
      ));
  });
}

async function runPacingRule(
  rule: typeof advertisingBidPacingRules.$inferSelect,
  options: { triggerSource: TriggerSource; userId: string | null },
) {
  const now = new Date();
  const intervalMinutes = Math.max(10, rule.intervalMinutes);
  const daypartHours = parseHours(rule.daypartHours);
  const currentHour = getCurrentHourInTimezone(rule.timezone ?? DEFAULT_TIMEZONE);
  const inSchedule = daypartHours.length === 0 || daypartHours.includes(currentHour);

  const dailyBudgetRub = toNumber(rule.dailyBudgetRub);
  const softCapPct = toNumber(rule.softCapPct);
  const stepDownPct = toNumber(rule.stepDownPct);
  const spendToday = await getNmSpendForDay(rule.tenantId, Number(rule.nmId), now);

  let valuePct: number | null = null;
  let reason: string | null = null;

  if (!inSchedule) {
    valuePct = -Math.abs(stepDownPct);
    reason = 'outside_schedule';
  } else if (dailyBudgetRub > 0 && spendToday >= dailyBudgetRub) {
    valuePct = -Math.max(20, Math.abs(stepDownPct));
    reason = 'budget_exhausted';
  } else if (dailyBudgetRub > 0 && spendToday >= (dailyBudgetRub * (softCapPct / 100))) {
    valuePct = -Math.abs(stepDownPct);
    reason = 'budget_soft_cap';
  }

  if (valuePct === null || !Number.isFinite(valuePct)) {
    const summary = {
      triggerSource: options.triggerSource,
      currentHour,
      inSchedule,
      spendTodayRub: spendToday,
      dailyBudgetRub,
      softCapPct,
      changedCount: 0,
      appliedCount: 0,
      failedCount: 0,
      reason: inSchedule ? 'no_action_needed' : 'outside_schedule_no_change',
      dryRun: rule.dryRun,
    } satisfies Record<string, unknown>;

    await withTenantContext(db, rule.tenantId, async (tx) => {
      await tx.update(advertisingBidPacingRules)
        .set({
          lastRunAt: now,
          nextRunAt: rule.isEnabled ? computeNextRunAt(intervalMinutes, now) : null,
          lastStatus: 'skipped',
          lastSummary: summary,
          updatedAt: now,
        })
        .where(eq(advertisingBidPacingRules.id, rule.id));
    });

    return { ruleId: rule.id, status: 'skipped', summary };
  }

  const dayStart = toUtcDayStart(now);
  const result = await executeBulkBidUpdate(rule.tenantId, {
    userId: options.userId,
    advertId: Number(rule.advertId),
    nmId: Number(rule.nmId),
    dateFrom: dayStart,
    dateTo: dayStart,
    mode: 'delta_pct',
    value: valuePct,
    minBid: rule.minBid,
    maxBid: rule.maxBid,
    dryRun: rule.dryRun,
    confirmed: true,
    source: 'pacing',
    guardrail: {
      enabled: false,
      maxAcosPct: 100,
      maxCpoRub: 100000,
      minClicksWithoutOrders: 9999,
      preventIncreaseWithoutOrders: false,
    },
  });

  const status = result.summary.failedCount > 0
    ? 'failed'
    : result.summary.applyCount > 0
      ? 'success'
      : 'skipped';

  const summary = {
    triggerSource: options.triggerSource,
    currentHour,
    inSchedule,
    spendTodayRub: spendToday,
    dailyBudgetRub,
    softCapPct,
    reason,
    bidDeltaPct: valuePct,
    changedCount: result.summary.changedClusters,
    appliedCount: result.summary.applyCount,
    failedCount: result.summary.failedCount,
    dryRun: rule.dryRun,
  } satisfies Record<string, unknown>;

  await withTenantContext(db, rule.tenantId, async (tx) => {
    await tx.update(advertisingBidPacingRules)
      .set({
        lastRunAt: now,
        nextRunAt: rule.isEnabled ? computeNextRunAt(intervalMinutes, now) : null,
        lastStatus: status,
        lastSummary: summary,
        updatedAt: now,
      })
      .where(eq(advertisingBidPacingRules.id, rule.id));
  });

  return { ruleId: rule.id, status, summary };
}

export async function runAdvertisingPacingRuleNow(tenantId: string, ruleId: string, userId: string | null) {
  const [rule] = await withTenantContext(db, tenantId, async (tx) =>
    tx.select()
      .from(advertisingBidPacingRules)
      .where(and(
        eq(advertisingBidPacingRules.id, ruleId),
        eq(advertisingBidPacingRules.tenantId, tenantId),
      ))
      .limit(1),
  );

  if (!rule) {
    throw new AppError('Правило пейсинга не найдено', 404);
  }

  return runPacingRule(rule, {
    triggerSource: 'manual',
    userId,
  });
}

export async function runDueAdvertisingPacingRules() {
  const now = new Date();
  // Admin-path: scheduler scans pacing rules across all tenants. Per-rule
  // execution (runPacingRule) uses its own withTenantContext under the
  // owning tenant.
  const dueRules = await withAdminContext(db, (tx) =>
    tx
      .select()
      .from(advertisingBidPacingRules)
      .where(and(
        eq(advertisingBidPacingRules.isEnabled, true),
        or(
          isNull(advertisingBidPacingRules.nextRunAt),
          lte(advertisingBidPacingRules.nextRunAt, now),
        ),
      ))
      .orderBy(asc(advertisingBidPacingRules.nextRunAt))
      .limit(MAX_DUE_RULES),
  );

  const results: Array<Record<string, unknown>> = [];
  for (const rule of dueRules) {
    results.push(await runPacingRule(rule, {
      triggerSource: 'scheduled',
      userId: null,
    }));
  }

  return {
    checked: dueRules.length,
    results,
  };
}

async function resolvePortfolioNmIds(tenantId: string, portfolio: typeof advertisingBidPortfolios.$inferSelect) {
  const explicit = parseNmIds(portfolio.nmIds);
  const terms = parseBrandTerms(portfolio.brandFilter ?? null);
  const result = new Set<number>(explicit);

  if (terms.length > 0) {
    const productRows = await withTenantContext(db, tenantId, async (tx) =>
      tx.select({
        nmId: products.nmId,
        brand: products.brand,
      })
        .from(products)
        .where(and(
          eq(products.tenantId, tenantId),
          eq(products.isHidden, false),
        ))
        .limit(5_000),
    );

    for (const productRow of productRows) {
      const brand = String(productRow.brand ?? '').trim().toLocaleLowerCase('ru-RU');
      if (!brand) {
        continue;
      }
      if (terms.some((term) => brand.includes(term))) {
        result.add(toInt(productRow.nmId));
      }
    }
  }

  return [...result].filter((nmId) => nmId > 0).slice(0, MAX_PORTFOLIO_NM_IDS);
}

function getCampaignByNm(campaigns: Awaited<ReturnType<typeof wbApi.getAdCampaigns>>, nmIds: number[]) {
  const map = new globalThis.Map<number, { advertId: number; status: number | null }>();

  const filtered = campaigns.filter((campaign) => (
    campaign.searchPlacement
    && campaign.nmIds.length > 0
    && (campaign.status === undefined || ACTIONABLE_STATUSES.has(campaign.status))
  ));

  for (const campaign of filtered) {
    for (const nmId of campaign.nmIds) {
      if (!nmIds.includes(nmId)) {
        continue;
      }

      const current = map.get(nmId);
      const status = campaign.status ?? null;
      if (!current) {
        map.set(nmId, { advertId: campaign.advertId, status });
        continue;
      }

      if (current.status !== 9 && status === 9) {
        map.set(nmId, { advertId: campaign.advertId, status });
      }
    }
  }

  return map;
}

export async function getAdvertisingPortfolioWorkspace(tenantId: string): Promise<AdvertisingPortfolioWorkspaceResponse> {
  const [portfolios, changes] = await withTenantContext(db, tenantId, async (tx) => Promise.all([
    tx.select()
      .from(advertisingBidPortfolios)
      .where(eq(advertisingBidPortfolios.tenantId, tenantId))
      .orderBy(desc(advertisingBidPortfolios.updatedAt))
      .limit(60),
    tx.select()
      .from(advertisingBidChanges)
      .where(and(
        eq(advertisingBidChanges.tenantId, tenantId),
        eq(advertisingBidChanges.source, 'portfolio'),
      ))
      .orderBy(desc(advertisingBidChanges.createdAt))
      .limit(120),
  ]));

  return {
    generatedAt: new Date().toISOString(),
    portfolios: portfolios.map(mapPortfolioRecord),
    recentChanges: changes.map(mapBidChange),
  };
}

export async function saveAdvertisingPortfolio(
  tenantId: string,
  userId: string | null,
  input: SaveAdvertisingPortfolioInput,
): Promise<AdvertisingPortfolioRecord> {
  const validated = validatePortfolioInput(input);
  const now = new Date();

  if (validated.id) {
    const [updated] = await withTenantContext(db, tenantId, async (tx) =>
      tx.update(advertisingBidPortfolios)
        .set({
          userId,
          name: validated.name,
          brandFilter: validated.brandFilter,
          nmIds: validated.nmIds,
          isEnabled: validated.isEnabled,
          dryRun: validated.dryRun,
          targetAcosPct: String(validated.targetAcosPct),
          minOrders: validated.minOrders,
          maxCpcRub: String(validated.maxCpcRub),
          dailyBudgetRub: String(validated.dailyBudgetRub),
          minBid: validated.minBid,
          maxBid: validated.maxBid,
          stepUpPct: String(validated.stepUpPct),
          stepDownPct: String(validated.stepDownPct),
          lookbackDays: validated.lookbackDays,
          intervalMinutes: validated.intervalMinutes,
          nextRunAt: validated.isEnabled ? computeNextRunAt(validated.intervalMinutes, now) : null,
          updatedAt: now,
        })
        .where(and(
          eq(advertisingBidPortfolios.id, validated.id!),
          eq(advertisingBidPortfolios.tenantId, tenantId),
        ))
        .returning(),
    );

    if (!updated) {
      throw new AppError('Портфель не найден', 404);
    }

    return mapPortfolioRecord(updated);
  }

  const created = (await withTenantContext(db, tenantId, async (tx) =>
    tx.insert(advertisingBidPortfolios)
      .values({
        tenantId,
        userId,
        name: validated.name,
        brandFilter: validated.brandFilter,
        nmIds: validated.nmIds,
        isEnabled: validated.isEnabled,
        dryRun: validated.dryRun,
        targetAcosPct: String(validated.targetAcosPct),
        minOrders: validated.minOrders,
        maxCpcRub: String(validated.maxCpcRub),
        dailyBudgetRub: String(validated.dailyBudgetRub),
        minBid: validated.minBid,
        maxBid: validated.maxBid,
        stepUpPct: String(validated.stepUpPct),
        stepDownPct: String(validated.stepDownPct),
        lookbackDays: validated.lookbackDays,
        intervalMinutes: validated.intervalMinutes,
        nextRunAt: validated.isEnabled ? computeNextRunAt(validated.intervalMinutes, now) : null,
        updatedAt: now,
      })
      .returning(),
  ))[0]!;

  return mapPortfolioRecord(created);
}

export async function deleteAdvertisingPortfolio(tenantId: string, portfolioId: string): Promise<void> {
  await withTenantContext(db, tenantId, async (tx) => {
    await tx.delete(advertisingBidPortfolios)
      .where(and(
        eq(advertisingBidPortfolios.id, portfolioId),
        eq(advertisingBidPortfolios.tenantId, tenantId),
      ));
  });
}

async function runPortfolio(
  portfolio: typeof advertisingBidPortfolios.$inferSelect,
  options: { triggerSource: TriggerSource; userId: string | null },
) {
  const now = new Date();
  const lookbackDays = Math.max(1, portfolio.lookbackDays);
  const rangeTo = toUtcDayStart(now);
  const rangeFrom = addUtcDays(rangeTo, -(lookbackDays - 1));
  const intervalMinutes = Math.max(15, portfolio.intervalMinutes);

  const nmIds = await resolvePortfolioNmIds(portfolio.tenantId, portfolio);
  if (nmIds.length === 0) {
    const summary = {
      triggerSource: options.triggerSource,
      reason: 'no_nm_ids',
      changedCount: 0,
      appliedCount: 0,
      failedCount: 0,
      dryRun: portfolio.dryRun,
    } satisfies Record<string, unknown>;

    await withTenantContext(db, portfolio.tenantId, (tx) =>
      tx.update(advertisingBidPortfolios)
        .set({
          lastRunAt: now,
          nextRunAt: portfolio.isEnabled ? computeNextRunAt(intervalMinutes, now) : null,
          lastStatus: 'skipped',
          lastSummary: summary,
          updatedAt: now,
        })
        .where(and(
          eq(advertisingBidPortfolios.id, portfolio.id),
          eq(advertisingBidPortfolios.tenantId, portfolio.tenantId),
        )),
    );

    return { portfolioId: portfolio.id, status: 'skipped', summary };
  }

  const token = await getTenantWbToken(portfolio.tenantId);
  const campaigns = await wbApi.getAdCampaigns(token);
  const campaignByNm = getCampaignByNm(campaigns, nmIds);
  const targetAcosPct = toNumber(portfolio.targetAcosPct);
  const maxCpcRub = toNumber(portfolio.maxCpcRub);
  const stepUpPct = toNumber(portfolio.stepUpPct);
  const stepDownPct = toNumber(portfolio.stepDownPct);

  const dailyBudgetRub = toNumber(portfolio.dailyBudgetRub);
  const spendToday = await getSpendForNmIdsForDay(portfolio.tenantId, nmIds, now);
  const budgetExhausted = dailyBudgetRub > 0 && spendToday >= dailyBudgetRub;
  const budgetSoftCap = dailyBudgetRub > 0 && spendToday >= (dailyBudgetRub * 0.85);

  const decisions: Array<{
    nmId: number;
    advertId: number;
    reason: string;
    valuePct: number;
    summary: Record<string, unknown>;
  }> = [];

  for (const nmId of nmIds) {
    const campaign = campaignByNm.get(nmId);
    if (!campaign) {
      continue;
    }

    const workspace = await getAdvertisingBidWorkspace(portfolio.tenantId, {
      advertId: campaign.advertId,
      nmId,
      dateFrom: rangeFrom,
      dateTo: rangeTo,
    });

    const spend = round(workspace.rows.reduce((sum, row) => sum + row.adSpend, 0), 2);
    const clicks = workspace.rows.reduce((sum, row) => sum + row.clicks, 0);
    const orders = workspace.rows.reduce((sum, row) => sum + row.orders, 0);
    const cpcRub = clicks > 0 ? round(spend / clicks, 2) : null;
    const acosProxyPct = aggregateAcosProxyPct(workspace.rows);

    let valuePct: number | null = null;
    let reason: string | null = null;

    if (budgetExhausted) {
      valuePct = -Math.max(20, stepDownPct);
      reason = 'portfolio_budget_exhausted';
    } else if (orders < portfolio.minOrders) {
      valuePct = -stepDownPct;
      reason = 'orders_below_min';
    } else if (acosProxyPct !== null && acosProxyPct > targetAcosPct) {
      valuePct = -stepDownPct;
      reason = 'acos_above_target';
    } else if (cpcRub !== null && cpcRub > maxCpcRub) {
      valuePct = -stepDownPct;
      reason = 'cpc_above_max';
    } else if (
      !budgetSoftCap
      && orders >= portfolio.minOrders
      && (acosProxyPct === null || acosProxyPct <= targetAcosPct * 0.75)
      && (cpcRub === null || cpcRub <= maxCpcRub * 0.9)
      && stepUpPct > 0
    ) {
      valuePct = stepUpPct;
      reason = 'performance_above_target';
    }

    if (valuePct === null || reason === null) {
      continue;
    }

    decisions.push({
      nmId,
      advertId: campaign.advertId,
      reason,
      valuePct,
      summary: {
        spendRub: spend,
        clicks,
        orders,
        cpcRub,
        acosProxyPct,
      },
    });
  }

  if (decisions.length === 0) {
    const summary = {
      triggerSource: options.triggerSource,
      reason: budgetSoftCap ? 'portfolio_soft_cap_no_growth' : 'no_changes_needed',
      dailyBudgetRub,
      spendTodayRub: spendToday,
      changedCount: 0,
      appliedCount: 0,
      failedCount: 0,
      dryRun: portfolio.dryRun,
    } satisfies Record<string, unknown>;

    await withTenantContext(db, portfolio.tenantId, async (tx) => {
      await tx.update(advertisingBidPortfolios)
        .set({
          lastRunAt: now,
          nextRunAt: portfolio.isEnabled ? computeNextRunAt(intervalMinutes, now) : null,
          lastStatus: 'skipped',
          lastSummary: summary,
          updatedAt: now,
        })
        .where(eq(advertisingBidPortfolios.id, portfolio.id));
    });

    return { portfolioId: portfolio.id, status: 'skipped', summary };
  }

  let changedCount = 0;
  let appliedCount = 0;
  let failedCount = 0;
  const decisionResults: Array<Record<string, unknown>> = [];

  for (const decision of decisions) {
    const result = await executeBulkBidUpdate(portfolio.tenantId, {
      userId: options.userId,
      advertId: decision.advertId,
      nmId: decision.nmId,
      dateFrom: rangeFrom,
      dateTo: rangeTo,
      mode: 'delta_pct',
      value: decision.valuePct,
      minBid: portfolio.minBid,
      maxBid: portfolio.maxBid,
      dryRun: portfolio.dryRun,
      confirmed: true,
      source: 'portfolio',
    });

    changedCount += result.summary.changedClusters;
    appliedCount += result.summary.applyCount;
    failedCount += result.summary.failedCount;

    decisionResults.push({
      nmId: decision.nmId,
      advertId: decision.advertId,
      reason: decision.reason,
      valuePct: decision.valuePct,
      changedClusters: result.summary.changedClusters,
      appliedClusters: result.summary.applyCount,
      failedClusters: result.summary.failedCount,
      metrics: decision.summary,
    });
  }

  const status = failedCount > 0
    ? 'failed'
    : appliedCount > 0
      ? 'success'
      : 'skipped';

  const summary = {
    triggerSource: options.triggerSource,
    lookbackDays,
    dailyBudgetRub,
    spendTodayRub: spendToday,
    budgetExhausted,
    budgetSoftCap,
    nmCount: nmIds.length,
    candidateCount: decisions.length,
    changedCount,
    appliedCount,
    failedCount,
    dryRun: portfolio.dryRun,
    decisions: decisionResults,
  } satisfies Record<string, unknown>;

  await withTenantContext(db, portfolio.tenantId, async (tx) => {
    await tx.update(advertisingBidPortfolios)
      .set({
        lastRunAt: now,
        nextRunAt: portfolio.isEnabled ? computeNextRunAt(intervalMinutes, now) : null,
        lastStatus: status,
        lastSummary: summary,
        updatedAt: now,
      })
      .where(eq(advertisingBidPortfolios.id, portfolio.id));
  });

  return { portfolioId: portfolio.id, status, summary };
}

export async function runAdvertisingPortfolioNow(tenantId: string, portfolioId: string, userId: string | null) {
  const [portfolio] = await withTenantContext(db, tenantId, async (tx) =>
    tx.select()
      .from(advertisingBidPortfolios)
      .where(and(
        eq(advertisingBidPortfolios.id, portfolioId),
        eq(advertisingBidPortfolios.tenantId, tenantId),
      ))
      .limit(1),
  );

  if (!portfolio) {
    throw new AppError('Портфель не найден', 404);
  }

  return runPortfolio(portfolio, {
    triggerSource: 'manual',
    userId,
  });
}

export async function runDueAdvertisingPortfolios() {
  const now = new Date();
  // Admin-path: scheduler scans portfolios across all tenants. Per-portfolio
  // execution uses per-tenant context inside runPortfolio.
  const duePortfolios = await withAdminContext(db, (tx) =>
    tx
      .select()
      .from(advertisingBidPortfolios)
      .where(and(
        eq(advertisingBidPortfolios.isEnabled, true),
        or(
          isNull(advertisingBidPortfolios.nextRunAt),
          lte(advertisingBidPortfolios.nextRunAt, now),
        ),
      ))
      .orderBy(asc(advertisingBidPortfolios.nextRunAt))
      .limit(MAX_DUE_RULES),
  );

  const results: Array<Record<string, unknown>> = [];
  for (const portfolio of duePortfolios) {
    results.push(await runPortfolio(portfolio, {
      triggerSource: 'scheduled',
      userId: null,
    }));
  }

  return {
    checked: duePortfolios.length,
    results,
  };
}
