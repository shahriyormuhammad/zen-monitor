import {
  type AdvertisingActionItem,
  type AdvertisingOverviewResponse,
  type AdvertisingProductReasonCode,
  type AdvertisingSkuRow,
} from '@/server/analytics/advertising';
import { eq, sql } from 'drizzle-orm';

import { db, withTenantContext } from '@/lib/db';
import { tenants } from '@/lib/db/schema';
import { decryptIfNeeded } from '@/lib/encryption';
import { logger } from '@/lib/logger';
import { wbApi, type WbAdCampaign } from '@/lib/wb-api';
import { wbGetAdBalance, wbGetAdBudget, type WbAdBudget } from '@/lib/wb-api/ads-balance';

export type AdvertisingDecisionType = 'stop_now' | 'lower_bid' | 'raise_bid' | 'check_product' | 'quiet';
export type AdvertisingDecisionRisk = 'high' | 'medium' | 'low' | 'none';
export type AdvertisingDecisionAction =
  | 'confirm_cleanup'
  | 'confirm_lower_bid'
  | 'confirm_raise_bid'
  | 'open_bids'
  | 'open_products'
  | 'open_settings'
  | 'none';

export type AdvertisingDecisionExecutionPlan = {
  primary: string;
  expectedEffect: string;
  guardrail: string;
  followUp: string;
};

export type AdvertisingDecisionCard = {
  id: string;
  type: AdvertisingDecisionType;
  title: string;
  productTitle: string | null;
  vendorCode: string | null;
  brand: string | null;
  photoUrl: string | null;
  reason: string;
  money: string;
  risk: AdvertisingDecisionRisk;
  reasonCode: AdvertisingProductReasonCode | null;
  reasonLabel: string | null;
  actionLabel: string;
  action: AdvertisingDecisionAction;
  plan: AdvertisingDecisionExecutionPlan;
  nmId: number | null;
  groupId: string | null;
  groupName: string | null;
  attributionScope: 'sku' | 'group';
  advertId: number | null;
};

export type AdvertisingDecisionCenterResponse = {
  generatedAt: string;
  dateWindowDays: number;
  snapshot: {
    adSpend: number;
    revenue: number;
    orders: number;
    views: number;
    clicks: number;
    acosPct: number | null;
    cpc: number | null;
    ctrPct: number | null;
    activeScopes: number;
    activeCampaigns: number;
    riskyScopes: number;
    coveredFrom: string | null;
    coveredTo: string | null;
    activeDays: number;
    campaignCoveredFrom: string | null;
    campaignCoveredTo: string | null;
    campaignActiveDays: number;
    accountBalanceRub: number | null;
    accountBonusRub: number | null;
    accountAvailableRub: number | null;
    accountBalanceSyncedAt: string | null;
    campaigns: Array<{
      advertId: number;
      nmId: number | null;
      status: number | null;
      type: number | null;
      bidType: string | null;
      paymentType: string | null;
      searchPlacement: boolean;
      recommendationPlacement: boolean;
      productTitle: string | null;
      vendorCode: string | null;
      brand: string | null;
      photoUrl: string | null;
      adSpend: number;
      revenue: number;
      orders: number;
      views: number;
      clicks: number;
      acosPct: number | null;
      cpc: number | null;
      ctrPct: number | null;
      roas: number | null;
      cpo: number | null;
      skuCount: number;
      activeDays: number;
      lastDataAt: string | null;
      todayAdSpend: number;
      todayRevenue: number;
      todayOrders: number;
      yesterdayAdSpend: number;
      yesterdayRevenue: number;
      yesterdayOrders: number;
      openCards: number;
      carts: number;
      funnelOrders: number;
      cartRatePct: number | null;
      cartToOrderPct: number | null;
      currentSearchBidRub: number | null;
      currentRecommendationBidRub: number | null;
      minBidRub: number | null;
      maxBidRub: number | null;
      budgetCashRub: number | null;
      budgetNettingRub: number | null;
      budgetTotalRub: number | null;
      budgetLoadedAt: string | null;
      avgPosition: number | null;
      bestPosition: number | null;
      positionSamples: number;
      positionKeywords: number;
      positionUpdatedAt: string | null;
      searchClusterCount: number;
      searchClusterViews: number;
      searchClusterClicks: number;
      searchClusterOrders: number;
      searchClusterSpend: number;
      searchClusterCtrPct: number | null;
      searchClusterCpc: number | null;
      campaignCreatedAt: string | null;
      campaignStartedAt: string | null;
      campaignUpdatedAt: string | null;
      totalCampaigns?: number;
    }>;
  };
  cards: AdvertisingDecisionCard[];
};

function formatRub(value: number) {
  return `${Math.round(value).toLocaleString('ru-RU')} ₽`;
}

function formatPct(value: number | null) {
  return value === null ? 'н/д' : `${value.toFixed(1)}%`;
}

function toUtcDayStart(value: Date) {
  const next = new Date(value);
  next.setUTCHours(0, 0, 0, 0);
  return next;
}

function toNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toInt(value: unknown) {
  return Math.max(0, Math.round(toNumber(value)));
}

async function getTenantWbToken(tenantId: string) {
  const [tenant] = await db
    .select({ wbApiToken: tenants.wbApiToken })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  return decryptIfNeeded(tenant?.wbApiToken ?? '').trim();
}

type CampaignMetadata = {
  status: number | null;
  type: number | null;
  bidType: string | null;
  paymentType: string | null;
  searchPlacement: boolean;
  recommendationPlacement: boolean;
  nmSettings: WbAdCampaign['nmSettings'];
  timestamps: WbAdCampaign['timestamps'];
};

type CampaignBudget = WbAdBudget & {
  loadedAt: string;
};

const CAMPAIGN_BUDGET_FETCH_LIMIT = 24;
const ACCOUNT_BALANCE_TTL_MS = 5 * 60 * 1000;

type AdvertisingAccountBalance = {
  realMoney: number;
  bonusSum: number;
  syncedAt: string;
};

function emptyCampaignMetadataMap() {
  return new Map<number, CampaignMetadata>();
}

function emptyCampaignBudgetMap() {
  return new Map<number, CampaignBudget>();
}

async function loadLatestAdvertisingAccountBalance(tenantId: string): Promise<AdvertisingAccountBalance | null> {
  const snapshotRaw = await withTenantContext(db, tenantId, (tx) => tx.execute(sql`
    SELECT
      real_money::numeric AS real_money,
      bonus_sum::numeric AS bonus_sum,
      synced_at::text AS synced_at
    FROM advertising_balance_snapshots
    WHERE tenant_id = ${tenantId}
    ORDER BY synced_at DESC
    LIMIT 1
  `));
  const snapshot = (snapshotRaw[0] as Record<string, unknown> | undefined) ?? null;
  const snapshotSyncedAt = snapshot?.synced_at ? new Date(String(snapshot.synced_at)) : null;

  if (snapshot && snapshotSyncedAt && Date.now() - snapshotSyncedAt.getTime() <= ACCOUNT_BALANCE_TTL_MS) {
    return {
      realMoney: round(toNumber(snapshot.real_money), 2),
      bonusSum: round(toNumber(snapshot.bonus_sum), 2),
      syncedAt: String(snapshot.synced_at),
    };
  }

  const token = await getTenantWbToken(tenantId);
  if (!token) {
    return snapshot
      ? {
          realMoney: round(toNumber(snapshot.real_money), 2),
          bonusSum: round(toNumber(snapshot.bonus_sum), 2),
          syncedAt: String(snapshot.synced_at),
        }
      : null;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4_000);

  try {
    const balance = await wbGetAdBalance(token, { signal: controller.signal });
    const syncedAt = new Date();
    await withTenantContext(db, tenantId, async (tx) => {
      await tx.execute(sql`
        INSERT INTO advertising_balance_snapshots
          (tenant_id, real_money, bonus_sum, bonus_percent, bonus_expires_at, synced_at)
        VALUES (
          ${tenantId},
          ${String(balance.realMoney)}::numeric,
          ${String(balance.bonus.sum)}::numeric,
          ${balance.bonus.percent}::integer,
          ${balance.bonus.expiresAt ?? null}::timestamptz,
          ${syncedAt.toISOString()}::timestamptz
        )
      `);
    });
    return {
      realMoney: round(balance.realMoney, 2),
      bonusSum: round(balance.bonus.sum, 2),
      syncedAt: syncedAt.toISOString(),
    };
  } catch (error) {
    logger.warn({ err: error, tenantId }, '[Advertising Decision Center] account balance load failed');
    return snapshot
      ? {
          realMoney: round(toNumber(snapshot.real_money), 2),
          bonusSum: round(toNumber(snapshot.bonus_sum), 2),
          syncedAt: String(snapshot.synced_at),
        }
      : null;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function loadCampaignMetadataByAdvertId(tenantId: string, advertIds: number[]) {
  const normalizedAdvertIds = Array.from(new Set(
    advertIds
      .filter((value) => Number.isFinite(value) && value > 0)
      .map((value) => Math.trunc(value)),
  ));

  if (normalizedAdvertIds.length === 0) {
    return emptyCampaignMetadataMap();
  }

  const token = await getTenantWbToken(tenantId);
  if (!token) {
    return emptyCampaignMetadataMap();
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8_000);

  try {
    const campaigns = await wbApi.getAdCampaignsByAdvertIds(token, normalizedAdvertIds, { signal: controller.signal });
    return new Map(campaigns.map((campaign) => [campaign.advertId, {
      status: campaign.status ?? null,
      type: campaign.type ?? null,
      bidType: campaign.bidType ?? null,
      paymentType: campaign.paymentType ?? null,
      searchPlacement: campaign.searchPlacement === true,
      recommendationPlacement: campaign.recommendationPlacement === true,
      nmSettings: campaign.nmSettings,
      timestamps: campaign.timestamps,
    }]));
  } catch (error) {
    logger.warn({ err: error, tenantId, advertIds: normalizedAdvertIds.length }, '[Advertising Decision Center] campaign metadata load failed');
    return emptyCampaignMetadataMap();
  } finally {
    clearTimeout(timeoutId);
  }
}

async function loadCampaignBudgetsByAdvertId(tenantId: string, advertIds: number[]) {
  const normalizedAdvertIds = Array.from(new Set(
    advertIds
      .filter((value) => Number.isFinite(value) && value > 0)
      .map((value) => Math.trunc(value)),
  )).slice(0, CAMPAIGN_BUDGET_FETCH_LIMIT);

  if (normalizedAdvertIds.length === 0) {
    return emptyCampaignBudgetMap();
  }

  const token = await getTenantWbToken(tenantId);
  if (!token) {
    return emptyCampaignBudgetMap();
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 7_000);
  const loadedAt = new Date().toISOString();
  const budgets = new Map<number, CampaignBudget>();

  try {
    for (const advertId of normalizedAdvertIds) {
      if (controller.signal.aborted) {
        break;
      }

      try {
        const budget = await wbGetAdBudget(token, advertId, { signal: controller.signal });
        budgets.set(advertId, { ...budget, loadedAt });
      } catch (error) {
        logger.warn({ err: error, tenantId, advertId }, '[Advertising Decision Center] campaign budget load failed');
      }
    }
  } finally {
    clearTimeout(timeoutId);
  }

  return budgets;
}

function round(value: number, precision = 2) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function pct(numerator: number, denominator: number) {
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  return round((numerator / denominator) * 100, 2);
}

function ratio(numerator: number, denominator: number) {
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  return round(numerator / denominator, 2);
}

function kopecksToRub(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  return round(value / 100, 2);
}

function minMax(values: Array<number | null>) {
  const filtered = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (filtered.length === 0) {
    return { min: null, max: null };
  }
  return {
    min: Math.min(...filtered),
    max: Math.max(...filtered),
  };
}

function sanitizeCtr(value: number | null) {
  if (value === null) {
    return null;
  }
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    return null;
  }
  return value;
}

function scopeName(item: Pick<AdvertisingActionItem | AdvertisingSkuRow, 'attributionScope' | 'groupName' | 'nmId'>) {
  if (item.attributionScope === 'group') {
    return `склейка «${item.groupName ?? 'без названия'}»`;
  }
  return item.nmId ? `nmId ${item.nmId}` : 'SKU';
}

function decisionPlan(type: AdvertisingDecisionType): AdvertisingDecisionExecutionPlan {
  if (type === 'lower_bid') {
    return {
      primary: 'Проверяем снижение ставки на 10% по активной поисковой кампании.',
      expectedEffect: 'Цель: дешевле клик и расход, без просадки заказов по SKU или склейке.',
      guardrail: 'Не применяем, если WB не вернул текущую ставку, ставка ниже минимума или ДРР/заказы выглядят опасно.',
      followUp: 'После подтверждения мониторим 2 / 6 / 24 часа и показываем экономию или откат.',
    };
  }
  if (type === 'raise_bid') {
    return {
      primary: 'Проверяем рост ставки на 10% по активной поисковой кампании.',
      expectedEffect: 'Цель: купить больше заказов, пока ДРР и ROAS остаются рабочими.',
      guardrail: 'Рост блокируется без заказов, при высоком ДРР или если WB не подтвердил текущую ставку.',
      followUp: 'После подтверждения мониторим прирост заказов, перерасход и автооткат в режиме Автопилот.',
    };
  }
  if (type === 'stop_now') {
    return {
      primary: 'Сначала dry-run: ищем дорогие кластеры без заказов и выручки.',
      expectedEffect: 'Цель: остановить слив бюджета, не трогая рабочий трафик.',
      guardrail: 'Без подтверждения ничего не выключается; применяются только high-risk кластеры.',
      followUp: 'После подтверждения действие попадает в Операции и аудит.',
    };
  }
  if (type === 'check_product') {
    return {
      primary: 'Ставку не меняем: открываем товар и проверяем карточку.',
      expectedEffect: 'Цель: найти проблему в фото, SEO, цене, CTR, остатках или релевантности.',
      guardrail: 'Автопилот не поднимает ставку, пока карточка не проходит базовые проверки.',
      followUp: 'После правок товара реклама снова попадёт в рекомендации.',
    };
  }
  return {
    primary: 'Ничего не меняем.',
    expectedEffect: 'Критичных отклонений по рекламе нет.',
    guardrail: 'Guardrails остаются включены.',
    followUp: 'Продолжаем мониторинг и дневной отчет.',
  };
}

function baseFromAction(
  item: AdvertisingActionItem,
  type: AdvertisingDecisionType,
  title: string,
  risk: AdvertisingDecisionRisk,
  actionLabel: string,
  action: AdvertisingDecisionAction,
): AdvertisingDecisionCard {
  return {
    id: `${type}:${item.groupId ?? item.nmId ?? item.id}`,
    type,
    title,
    productTitle: null,
    vendorCode: item.vendorCode,
    brand: item.brand,
    photoUrl: null,
    reason: `${item.title}. ${item.details}`,
    money: item.metric,
    risk,
    reasonCode: item.reasonCode,
    reasonLabel: item.reasonLabel,
    actionLabel,
    action,
    plan: decisionPlan(type),
    nmId: item.nmId,
    groupId: item.groupId,
    groupName: item.groupName,
    attributionScope: item.attributionScope,
    advertId: null,
  };
}

function pickAction(
  items: AdvertisingActionItem[],
  predicate: (item: AdvertisingActionItem) => boolean,
) {
  return items.find(predicate) ?? null;
}

function sameDecisionScope(action: AdvertisingActionItem, row: AdvertisingSkuRow) {
  if (action.groupId || row.groupId) {
    return action.groupId !== null && action.groupId === row.groupId;
  }
  return action.nmId !== null && action.nmId === row.nmId;
}

export function buildAdvertisingDecisionCards(
  overview: Pick<AdvertisingOverviewResponse, 'generatedAt' | 'dateWindowDays' | 'summary' | 'topSku' | 'actionItems'>,
): AdvertisingDecisionCenterResponse {
  const cards: AdvertisingDecisionCard[] = [];

  const stopItem = pickAction(overview.actionItems, (item) => (
    item.code === 'negative_profit_after_ads'
    || item.code === 'spend_without_revenue'
    || item.code === 'no_orders_from_clicks'
  ));
  if (stopItem) {
    cards.push(baseFromAction(
      stopItem,
      'stop_now',
      'Срочно остановить',
      stopItem.priority === 'high' ? 'high' : 'medium',
      'Проверить действие',
      'confirm_cleanup',
    ));
  }

  const lowerItem = pickAction(overview.actionItems, (item) => (
    item.code === 'profit_eaten_by_ads'
    || item.code === 'high_acos'
    || item.code === 'expensive_click'
  ));
  if (lowerItem) {
    cards.push(baseFromAction(
      lowerItem,
      'lower_bid',
      'Снизить ставку',
      lowerItem.priority === 'high' ? 'high' : 'medium',
      'Проверить ставку',
      'confirm_lower_bid',
    ));
  }

  const raiseRow = overview.topSku.find((row) => (
    row.adSpend >= 300
    && row.revenue >= row.adSpend * 4
    && row.netProfit > 0
    && (row.profitMarginPct === null || row.profitMarginPct >= 8)
    && (row.adSpendToProfitBeforeAdsPct === null || row.adSpendToProfitBeforeAdsPct <= 35)
    && (row.acosPct === null || row.acosPct <= 18)
    && row.clusterOrders > 0
  ));
  if (raiseRow) {
    cards.push({
      id: `raise_bid:${raiseRow.groupId ?? raiseRow.nmId}`,
      type: 'raise_bid',
      title: 'Поднять ставку',
      productTitle: null,
      vendorCode: raiseRow.vendorCode,
      brand: raiseRow.brand,
      photoUrl: raiseRow.photoUrl,
      reason: `${scopeName(raiseRow)} прибыльна после рекламы: ЧП ${formatRub(raiseRow.netProfit)}, ДРР ${formatPct(raiseRow.acosPct)}, расход ${formatRub(raiseRow.adSpend)}.`,
      money: `ЧП ${formatRub(raiseRow.netProfit)} · ДРР ${formatPct(raiseRow.acosPct)} · ROAS ${raiseRow.roas === null ? 'н/д' : `${raiseRow.roas.toFixed(1)}×`}`,
      risk: 'low',
      reasonCode: 'bid_economics',
      reasonLabel: 'Ставка',
      actionLabel: 'Проверить рост',
      action: 'confirm_raise_bid',
      plan: decisionPlan('raise_bid'),
      nmId: raiseRow.nmId,
      groupId: raiseRow.groupId,
      groupName: raiseRow.groupName,
      attributionScope: raiseRow.attributionScope,
      advertId: null,
    });
  }

  const checkItem = pickAction(overview.actionItems, (item) => item.code === 'low_ctr');
  if (checkItem) {
    const checkRow = overview.topSku.find((row) => sameDecisionScope(checkItem, row) && row.productCheck.status !== 'ok') ?? null;
    const card = baseFromAction(
      checkItem,
      'check_product',
      'Проверить товар',
      'medium',
      'Открыть товары',
      'open_products',
    );
    if (checkRow?.productCheck.reasons[0]) {
      const primaryCheck = checkRow.productCheck.checks[0] ?? null;
      card.reason = `${checkItem.title}. ${checkRow.productCheck.reasons[0]}`;
      card.money = checkItem.metric;
      card.reasonCode = primaryCheck?.code ?? card.reasonCode;
      card.reasonLabel = primaryCheck?.label ?? card.reasonLabel;
    }
    cards.push(card);
  }

  if (cards.length === 0) {
    cards.push({
      id: 'quiet',
      type: 'quiet',
      title: 'Все спокойно',
      reason: 'Критичных отклонений по расходу, ДРР и кликам не найдено.',
      money: `Расход ${formatRub(overview.summary.adSpendEffective)} · ДРР ${formatPct(overview.summary.acosPct)}`,
      risk: 'none',
      reasonCode: null,
      reasonLabel: null,
      actionLabel: 'Смотреть сводку',
      action: 'none',
      plan: decisionPlan('quiet'),
      productTitle: null,
      vendorCode: null,
      brand: null,
      photoUrl: null,
      nmId: null,
      groupId: null,
      groupName: null,
      attributionScope: 'sku',
      advertId: null,
    });
  }

  return {
    generatedAt: overview.generatedAt,
    dateWindowDays: overview.dateWindowDays,
    snapshot: {
      adSpend: round(overview.summary.adSpendEffective, 2),
      revenue: round(overview.summary.revenue, 2),
      orders: toInt(overview.summary.clusterOrders),
      views: toInt(overview.summary.views),
      clicks: toInt(overview.summary.clicks),
      acosPct: overview.summary.acosPct,
      cpc: overview.summary.cpc,
      ctrPct: overview.summary.ctrPct,
      activeScopes: Math.max(0, overview.topSku.length),
      activeCampaigns: 0,
      riskyScopes: Math.max(0, overview.summary.riskySkuCount),
      coveredFrom: null,
      coveredTo: null,
      activeDays: 0,
      campaignCoveredFrom: null,
      campaignCoveredTo: null,
      campaignActiveDays: 0,
      accountBalanceRub: null,
      accountBonusRub: null,
      accountAvailableRub: null,
      accountBalanceSyncedAt: null,
      campaigns: [],
    },
    cards: cards.slice(0, 5),
  };
}

type FastDecisionRow = {
  advertId: number | null;
  nmId: number;
  productTitle: string | null;
  vendorCode: string | null;
  brand: string | null;
  photoUrl: string | null;
  groupId: string | null;
  groupName: string | null;
  groupNmCount: number;
  adSpend: number;
  views: number;
  clicks: number;
  orders: number;
  revenue: number;
  acosPct: number | null;
  cpc: number | null;
  ctrPct: number | null;
  roas: number | null;
  attributionScope: 'sku' | 'group';
};

function scopeLabel(row: Pick<FastDecisionRow, 'attributionScope' | 'groupName' | 'nmId'>) {
  return row.attributionScope === 'group'
    ? `склейка «${row.groupName ?? 'без названия'}»`
    : `nmId ${row.nmId}`;
}

function fastCard(
  row: FastDecisionRow,
  input: {
    type: AdvertisingDecisionType;
    title: string;
    reason: string;
    money: string;
    risk: AdvertisingDecisionRisk;
    reasonCode: AdvertisingProductReasonCode | null;
    reasonLabel: string | null;
    actionLabel: string;
    action: AdvertisingDecisionAction;
  },
): AdvertisingDecisionCard {
  return {
    id: `${input.type}:${row.groupId ?? row.nmId}`,
    type: input.type,
    title: input.title,
    productTitle: row.productTitle,
    vendorCode: row.vendorCode,
    brand: row.brand,
    photoUrl: row.photoUrl,
    reason: input.reason,
    money: input.money,
    risk: input.risk,
    reasonCode: input.reasonCode,
    reasonLabel: input.reasonLabel,
    actionLabel: input.actionLabel,
    action: input.action,
    plan: decisionPlan(input.type),
    nmId: row.nmId,
    groupId: row.groupId,
    groupName: row.groupName,
    attributionScope: row.attributionScope,
    advertId: row.advertId,
  };
}

function pickFastRow(rows: FastDecisionRow[], predicate: (row: FastDecisionRow) => boolean) {
  return rows.find(predicate) ?? null;
}

function buildFastDecisionCards(rows: FastDecisionRow[], summary: { spend: number; revenue: number }) {
  const cards: AdvertisingDecisionCard[] = [];

  const stopRow = pickFastRow(rows, (row) => (
    (row.adSpend >= 500 && row.revenue <= 0)
    || (row.clicks >= 20 && row.orders === 0)
  ));
  if (stopRow) {
    cards.push(fastCard(stopRow, {
      type: 'stop_now',
      title: 'Срочно остановить',
      reason: `${scopeLabel(stopRow)} тратит бюджет без заказов или выручки.`,
      money: `Расход ${formatRub(stopRow.adSpend)} · заказы ${stopRow.orders}`,
      risk: 'high',
      reasonCode: 'traffic_quality',
      reasonLabel: 'Трафик',
      actionLabel: 'Проверить действие',
      action: 'confirm_cleanup',
    }));
  }

  const lowerRow = pickFastRow(rows, (row) => (
    row.adSpend >= 300
    && (
      (row.acosPct !== null && row.acosPct >= 40)
      || (row.cpc !== null && row.cpc >= 35 && row.orders <= 1)
    )
  ));
  if (lowerRow) {
    cards.push(fastCard(lowerRow, {
      type: 'lower_bid',
      title: 'Снизить ставку',
      reason: `${scopeLabel(lowerRow)} выходит за рабочий ДРР или даёт дорогой клик.`,
      money: `Расход ${formatRub(lowerRow.adSpend)} · ДРР ${formatPct(lowerRow.acosPct)} · CPC ${lowerRow.cpc === null ? 'н/д' : formatRub(lowerRow.cpc)}`,
      risk: 'medium',
      reasonCode: 'bid_economics',
      reasonLabel: 'Ставка',
      actionLabel: 'Проверить ставку',
      action: 'confirm_lower_bid',
    }));
  }

  const raiseRow = pickFastRow(rows, (row) => (
    row.adSpend >= 300
    && row.orders > 0
    && row.revenue >= row.adSpend * 4
    && (row.acosPct === null || row.acosPct <= 20)
  ));
  if (raiseRow) {
    cards.push(fastCard(raiseRow, {
      type: 'raise_bid',
      title: 'Поднять ставку',
      reason: `${scopeLabel(raiseRow)} окупается по рекламе: ДРР ${formatPct(raiseRow.acosPct)}, ROAS ${raiseRow.roas === null ? 'н/д' : `${raiseRow.roas.toFixed(1)}×`}.`,
      money: `Выручка ${formatRub(raiseRow.revenue)} · расход ${formatRub(raiseRow.adSpend)}`,
      risk: 'low',
      reasonCode: 'bid_economics',
      reasonLabel: 'Ставка',
      actionLabel: 'Проверить рост',
      action: 'confirm_raise_bid',
    }));
  }

  const checkRow = pickFastRow(rows, (row) => (
    row.views >= 1000
    && (row.ctrPct === null || row.ctrPct < 0.4)
  ));
  if (checkRow) {
    cards.push(fastCard(checkRow, {
      type: 'check_product',
      title: 'Проверить товар',
      reason: `${scopeLabel(checkRow)} получает показы, но CTR слабый.`,
      money: `Показы ${checkRow.views.toLocaleString('ru-RU')} · CTR ${formatPct(checkRow.ctrPct)}`,
      risk: 'medium',
      reasonCode: 'card_content',
      reasonLabel: 'Карточка',
      actionLabel: 'Открыть товары',
      action: 'open_products',
    }));
  }

  const deduped = cards.filter((card, index, list) => (
    list.findIndex((item) => item.type === card.type) === index
  ));

  if (deduped.length === 0) {
    deduped.push({
      id: 'quiet',
      type: 'quiet',
      title: 'Все спокойно',
      reason: 'Критичных отклонений по расходу, заказам, ДРР и CTR не найдено.',
      money: `Расход ${formatRub(summary.spend)} · ДРР ${formatPct(pct(summary.spend, summary.revenue))}`,
      risk: 'none',
      reasonCode: null,
      reasonLabel: null,
      actionLabel: 'Смотреть сводку',
      action: 'none',
      plan: decisionPlan('quiet'),
      productTitle: null,
      vendorCode: null,
      brand: null,
      photoUrl: null,
      nmId: null,
      groupId: null,
      groupName: null,
      attributionScope: 'sku',
      advertId: null,
    });
  }

  return deduped.slice(0, 5);
}

export async function getAdvertisingDecisionCenter(
  tenantId: string,
  dateFrom: Date,
  dateTo: Date,
): Promise<AdvertisingDecisionCenterResponse> {
  const from = toUtcDayStart(dateFrom);
  const to = toUtcDayStart(dateTo);
  const dateWindowDays = Math.max(1, Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1);
  const fromDate = from.toISOString().slice(0, 10);
  const toDate = to.toISOString().slice(0, 10);

  const rowsRaw = await withTenantContext(db, tenantId, (tx) => tx.execute(sql`
    WITH group_map AS (
      SELECT
        gm.nm_id,
        pg.id AS group_id,
        pg.name AS group_name,
        COUNT(*) OVER (PARTITION BY pg.id)::int AS group_nm_count,
        ROW_NUMBER() OVER (PARTITION BY gm.nm_id ORDER BY pg.created_at, pg.id) AS rn
      FROM product_group_members gm
      JOIN product_groups pg
        ON pg.id = gm.group_id
       AND pg.tenant_id = ${tenantId}
    ),
    scoped AS (
      SELECT
        COALESCE(gm.group_id::text, 'sku:' || h.nm_id::text) AS scope_key,
        gm.group_id,
        gm.group_name,
        COALESCE(gm.group_nm_count, 1)::int AS group_nm_count,
        h.advert_id,
        h.nm_id,
        SUM(h.ad_spend)::numeric AS ad_spend,
        SUM(h.views)::bigint AS views,
        SUM(h.clicks)::bigint AS clicks,
        SUM(h.order_count)::bigint AS orders,
        SUM(h.order_sum)::numeric AS revenue
      FROM advertising_hourly_stats h
      LEFT JOIN group_map gm
        ON gm.nm_id = h.nm_id
       AND gm.rn = 1
      WHERE h.tenant_id = ${tenantId}
        AND h.stat_date >= ${fromDate}::date
        AND h.stat_date <= ${toDate}::date
      GROUP BY
        COALESCE(gm.group_id::text, 'sku:' || h.nm_id::text),
        gm.group_id,
        gm.group_name,
        COALESCE(gm.group_nm_count, 1),
        h.advert_id,
        h.nm_id
    ),
    scope_totals AS (
      SELECT
        scope_key,
        group_id,
        group_name,
        MAX(group_nm_count)::int AS group_nm_count,
        SUM(ad_spend)::numeric AS ad_spend,
        SUM(views)::bigint AS views,
        SUM(clicks)::bigint AS clicks,
        SUM(orders)::bigint AS orders,
        SUM(revenue)::numeric AS revenue
      FROM scoped
      GROUP BY scope_key, group_id, group_name
    ),
    primary_nm AS (
      SELECT DISTINCT ON (scope_key)
        scope_key,
        nm_id
      FROM scoped
      ORDER BY scope_key, ad_spend DESC, nm_id
    ),
    primary_advert AS (
      SELECT DISTINCT ON (scope_key)
        scope_key,
        advert_id
      FROM scoped
      WHERE advert_id > 0
      ORDER BY scope_key, ad_spend DESC, advert_id
    )
    SELECT
      pnm.nm_id,
      pad.advert_id,
      s.group_id,
      s.group_name,
      s.group_nm_count,
      s.ad_spend,
      s.views,
      s.clicks,
      s.orders,
      s.revenue,
      p.vendor_code,
      p.brand,
      p.photo_url,
      meta.title
    FROM scope_totals s
    JOIN primary_nm pnm
      ON pnm.scope_key = s.scope_key
    LEFT JOIN primary_advert pad
      ON pad.scope_key = s.scope_key
    LEFT JOIN products p
      ON p.tenant_id = ${tenantId}
     AND p.nm_id = pnm.nm_id
     AND COALESCE(p.is_hidden, FALSE) = FALSE
    LEFT JOIN raw_api_product_metadata meta
      ON meta.tenant_id = ${tenantId}
     AND meta.nm_id = pnm.nm_id
    WHERE s.ad_spend > 0 OR s.views > 0 OR s.clicks > 0 OR s.orders > 0 OR s.revenue > 0
    ORDER BY s.ad_spend DESC
    LIMIT 80
  `));

  const rows: FastDecisionRow[] = rowsRaw.map((row) => {
    const record = row as Record<string, unknown>;
    const adSpend = round(toNumber(record.ad_spend), 2);
    const revenue = round(toNumber(record.revenue), 2);
    const views = toInt(record.views);
    const clicks = toInt(record.clicks);
    const orders = toInt(record.orders);
    const groupId = (record.group_id as string | null) ?? null;
    const advertId = toInt(record.advert_id);
    return {
      advertId: advertId > 0 ? advertId : null,
      nmId: toInt(record.nm_id),
      productTitle: (record.title as string | null) ?? null,
      vendorCode: (record.vendor_code as string | null) ?? null,
      brand: (record.brand as string | null) ?? null,
      photoUrl: (record.photo_url as string | null) ?? null,
      groupId,
      groupName: (record.group_name as string | null) ?? null,
      groupNmCount: Math.max(1, toInt(record.group_nm_count)),
      adSpend,
      views,
      clicks,
      orders,
      revenue,
      acosPct: pct(adSpend, revenue),
      cpc: ratio(adSpend, clicks),
      ctrPct: pct(clicks, views),
      roas: ratio(revenue, adSpend),
      attributionScope: groupId ? 'group' : 'sku',
    };
  });

  const summary = rows.reduce((acc, row) => ({
    spend: acc.spend + row.adSpend,
    revenue: acc.revenue + row.revenue,
  }), { spend: 0, revenue: 0 });

  const campaignRaw = await withTenantContext(db, tenantId, (tx) => tx.execute(sql`
    WITH campaign_totals AS (
      SELECT
        h.advert_id,
        SUM(h.ad_spend)::numeric AS ad_spend,
        SUM(h.order_count)::bigint AS orders,
        SUM(h.order_sum)::numeric AS revenue,
        SUM(h.views)::bigint AS views,
        SUM(h.clicks)::bigint AS clicks,
        COUNT(DISTINCT h.nm_id)::int AS sku_count,
        COUNT(DISTINCT h.stat_date)::int AS active_days,
        MAX(h.updated_at)::text AS last_data_at,
        SUM(CASE WHEN h.stat_date = (NOW() AT TIME ZONE 'Europe/Moscow')::date THEN h.ad_spend ELSE 0 END)::numeric AS today_ad_spend,
        SUM(CASE WHEN h.stat_date = (NOW() AT TIME ZONE 'Europe/Moscow')::date THEN h.order_sum ELSE 0 END)::numeric AS today_revenue,
        SUM(CASE WHEN h.stat_date = (NOW() AT TIME ZONE 'Europe/Moscow')::date THEN h.order_count ELSE 0 END)::bigint AS today_orders,
        SUM(CASE WHEN h.stat_date = ((NOW() AT TIME ZONE 'Europe/Moscow')::date - INTERVAL '1 day')::date THEN h.ad_spend ELSE 0 END)::numeric AS yesterday_ad_spend,
        SUM(CASE WHEN h.stat_date = ((NOW() AT TIME ZONE 'Europe/Moscow')::date - INTERVAL '1 day')::date THEN h.order_sum ELSE 0 END)::numeric AS yesterday_revenue,
        SUM(CASE WHEN h.stat_date = ((NOW() AT TIME ZONE 'Europe/Moscow')::date - INTERVAL '1 day')::date THEN h.order_count ELSE 0 END)::bigint AS yesterday_orders
      FROM advertising_hourly_stats h
      WHERE h.tenant_id = ${tenantId}
        AND h.stat_date >= ${fromDate}::date
        AND h.stat_date <= ${toDate}::date
        AND h.advert_id > 0
      GROUP BY h.advert_id
    ),
    campaign_nm AS (
      SELECT
        h.advert_id,
        h.nm_id,
        SUM(h.ad_spend)::numeric AS nm_spend
      FROM advertising_hourly_stats h
      WHERE h.tenant_id = ${tenantId}
        AND h.stat_date >= ${fromDate}::date
        AND h.stat_date <= ${toDate}::date
        AND h.advert_id > 0
      GROUP BY h.advert_id, h.nm_id
    ),
    campaign_nm_distinct AS (
      SELECT DISTINCT advert_id, nm_id
      FROM campaign_nm
    ),
    campaign_funnel AS (
      SELECT
        cn.advert_id,
        SUM(f.open_card_count)::bigint AS open_cards,
        SUM(f.add_to_cart_count)::bigint AS carts,
        SUM(f.order_count)::bigint AS funnel_orders
      FROM campaign_nm_distinct cn
      JOIN raw_api_funnel_stats f
        ON f.tenant_id = ${tenantId}
       AND f.nm_id = cn.nm_id
       AND f.period_start = f.period_end
       AND (f.period_start AT TIME ZONE 'Europe/Moscow')::date >= ${fromDate}::date
       AND (f.period_start AT TIME ZONE 'Europe/Moscow')::date <= ${toDate}::date
      GROUP BY cn.advert_id
    ),
    campaign_positions AS (
      SELECT
        cn.advert_id,
        AVG(pos.position) FILTER (WHERE pos.position IS NOT NULL)::numeric AS avg_position,
        MIN(pos.position) FILTER (WHERE pos.position IS NOT NULL)::int AS best_position,
        COUNT(pos.position)::int AS position_samples,
        COUNT(DISTINCT pos.keyword)::int AS position_keywords,
        MAX(pos.source_updated_at)::text AS position_updated_at
      FROM campaign_nm_distinct cn
      JOIN procifry_search_positions pos
        ON pos.tenant_id = ${tenantId}
       AND pos.nm_id = cn.nm_id
       AND pos.observed_date >= ${fromDate}::date
       AND pos.observed_date <= ${toDate}::date
      GROUP BY cn.advert_id
    ),
    campaign_search_clusters AS (
      SELECT
        cn.advert_id,
        COUNT(DISTINCT ac.cluster)::int AS search_cluster_count,
        SUM(ac.views)::bigint AS search_cluster_views,
        SUM(ac.clicks)::bigint AS search_cluster_clicks,
        SUM(ac.order_count)::bigint AS search_cluster_orders,
        SUM(ac.amount)::numeric AS search_cluster_spend
      FROM campaign_nm_distinct cn
      JOIN raw_api_ad_clusters ac
        ON ac.tenant_id = ${tenantId}
       AND ac.nm_id = cn.nm_id
       AND (ac.date AT TIME ZONE 'Europe/Moscow')::date >= ${fromDate}::date
       AND (ac.date AT TIME ZONE 'Europe/Moscow')::date <= ${toDate}::date
      GROUP BY cn.advert_id
    ),
    primary_nm AS (
      SELECT DISTINCT ON (advert_id)
        advert_id,
        nm_id
      FROM campaign_nm
      ORDER BY advert_id, nm_spend DESC, nm_id
    )
    SELECT
      c.advert_id,
      c.ad_spend,
      c.orders,
      c.revenue,
      c.views,
      c.clicks,
      c.sku_count,
      c.active_days,
      c.last_data_at,
      c.today_ad_spend,
      c.today_revenue,
      c.today_orders,
      c.yesterday_ad_spend,
      c.yesterday_revenue,
      c.yesterday_orders,
      COALESCE(cf.open_cards, 0)::bigint AS open_cards,
      COALESCE(cf.carts, 0)::bigint AS carts,
      COALESCE(cf.funnel_orders, 0)::bigint AS funnel_orders,
      cp.avg_position,
      cp.best_position,
      COALESCE(cp.position_samples, 0)::int AS position_samples,
      COALESCE(cp.position_keywords, 0)::int AS position_keywords,
      cp.position_updated_at,
      COALESCE(csc.search_cluster_count, 0)::int AS search_cluster_count,
      COALESCE(csc.search_cluster_views, 0)::bigint AS search_cluster_views,
      COALESCE(csc.search_cluster_clicks, 0)::bigint AS search_cluster_clicks,
      COALESCE(csc.search_cluster_orders, 0)::bigint AS search_cluster_orders,
      COALESCE(csc.search_cluster_spend, 0)::numeric AS search_cluster_spend,
      (SELECT COUNT(*)::int FROM campaign_totals) AS total_campaigns,
      pnm.nm_id,
      p.vendor_code,
      p.brand,
      p.photo_url,
      meta.title
    FROM campaign_totals c
    LEFT JOIN campaign_funnel cf
      ON cf.advert_id = c.advert_id
    LEFT JOIN campaign_positions cp
      ON cp.advert_id = c.advert_id
    LEFT JOIN campaign_search_clusters csc
      ON csc.advert_id = c.advert_id
    LEFT JOIN primary_nm pnm
      ON pnm.advert_id = c.advert_id
    LEFT JOIN products p
      ON p.tenant_id = ${tenantId}
     AND p.nm_id = pnm.nm_id
     AND COALESCE(p.is_hidden, FALSE) = FALSE
    LEFT JOIN raw_api_product_metadata meta
      ON meta.tenant_id = ${tenantId}
     AND meta.nm_id = pnm.nm_id
    ORDER BY c.ad_spend DESC
    LIMIT 200
  `));

  const campaignCoverageRaw = await withTenantContext(db, tenantId, (tx) => tx.execute(sql`
    SELECT
      MIN(h.stat_date)::text AS covered_from,
      MAX(h.stat_date)::text AS covered_to,
      COUNT(DISTINCT h.stat_date)::int AS active_days
    FROM advertising_hourly_stats h
    WHERE h.tenant_id = ${tenantId}
      AND h.stat_date >= ${fromDate}::date
      AND h.stat_date <= ${toDate}::date
      AND h.advert_id > 0
      AND (
        h.ad_spend > 0
        OR h.views > 0
        OR h.clicks > 0
        OR h.order_count > 0
        OR h.order_sum > 0
      )
  `));

  const accountBalance = await loadLatestAdvertisingAccountBalance(tenantId);

  const kpiCoverageRaw = await withTenantContext(db, tenantId, (tx) => tx.execute(sql`
    WITH cost_days AS (
      SELECT
        (c.date AT TIME ZONE 'Europe/Moscow')::date AS day,
        SUM(c.amount)::numeric AS spend,
        SUM(c.order_count)::bigint AS orders,
        SUM(c.order_sum)::numeric AS revenue
      FROM raw_api_ad_costs c
      WHERE c.tenant_id = ${tenantId}
        AND (c.date AT TIME ZONE 'Europe/Moscow')::date >= ${fromDate}::date
        AND (c.date AT TIME ZONE 'Europe/Moscow')::date <= ${toDate}::date
      GROUP BY (c.date AT TIME ZONE 'Europe/Moscow')::date
    ),
    cluster_days AS (
      SELECT
        (cl.date AT TIME ZONE 'Europe/Moscow')::date AS day,
        SUM(cl.views)::bigint AS views,
        SUM(cl.clicks)::bigint AS clicks
      FROM raw_api_ad_clusters cl
      WHERE cl.tenant_id = ${tenantId}
        AND (cl.date AT TIME ZONE 'Europe/Moscow')::date >= ${fromDate}::date
        AND (cl.date AT TIME ZONE 'Europe/Moscow')::date <= ${toDate}::date
      GROUP BY (cl.date AT TIME ZONE 'Europe/Moscow')::date
    ),
    merged_days AS (
      SELECT
        COALESCE(cd.day, cld.day) AS day,
        COALESCE(cd.spend, 0)::numeric AS spend,
        COALESCE(cd.orders, 0)::bigint AS orders,
        COALESCE(cd.revenue, 0)::numeric AS revenue,
        COALESCE(cld.views, 0)::bigint AS views,
        COALESCE(cld.clicks, 0)::bigint AS clicks
      FROM cost_days cd
      FULL OUTER JOIN cluster_days cld
        ON cld.day = cd.day
    )
    SELECT
      MIN(day)::text AS covered_from,
      MAX(day)::text AS covered_to,
      COUNT(*)::int AS active_days,
      SUM(spend)::numeric AS ad_spend,
      SUM(orders)::bigint AS orders,
      SUM(revenue)::numeric AS revenue,
      SUM(views)::bigint AS views,
      SUM(clicks)::bigint AS clicks
    FROM merged_days
  `));

  const campaignAdvertIds = campaignRaw
    .map((row) => toInt((row as Record<string, unknown>).advert_id))
    .filter((advertId) => advertId > 0);
  const campaignMetaByAdvertId = await loadCampaignMetadataByAdvertId(tenantId, campaignAdvertIds);
  const campaignBudgetByAdvertId = await loadCampaignBudgetsByAdvertId(tenantId, campaignAdvertIds);

  const campaigns = campaignRaw.map((row) => {
    const record = row as Record<string, unknown>;
    const adSpend = round(toNumber(record.ad_spend), 2);
    const revenue = round(toNumber(record.revenue), 2);
    const views = toInt(record.views);
    const clicks = toInt(record.clicks);
    const advertId = toInt(record.advert_id);
    const orders = toInt(record.orders);
    const primaryNmId = toInt(record.nm_id) || null;
    const metadata = campaignMetaByAdvertId.get(advertId);
    const budget = campaignBudgetByAdvertId.get(advertId);
    const bidSettings = primaryNmId
      ? metadata?.nmSettings.find((item) => item.nmId === primaryNmId)
      : metadata?.nmSettings[0];
    const searchBidRub = kopecksToRub(bidSettings?.bidsKopecks.search);
    const recommendationBidRub = kopecksToRub(bidSettings?.bidsKopecks.recommendations);
    const allBidValues = (metadata?.nmSettings ?? []).flatMap((item) => [
      kopecksToRub(item.bidsKopecks.search),
      kopecksToRub(item.bidsKopecks.recommendations),
    ]);
    const bidRange = minMax(allBidValues);
    const openCards = toInt(record.open_cards);
    const carts = toInt(record.carts);
    const funnelOrders = toInt(record.funnel_orders);
    const searchClusterViews = toInt(record.search_cluster_views);
    const searchClusterClicks = toInt(record.search_cluster_clicks);
    const searchClusterOrders = toInt(record.search_cluster_orders);
    const searchClusterSpend = round(toNumber(record.search_cluster_spend), 2);
    return {
      advertId,
      nmId: primaryNmId,
      status: metadata?.status ?? null,
      type: metadata?.type ?? null,
      bidType: metadata?.bidType ?? null,
      paymentType: metadata?.paymentType ?? null,
      searchPlacement: metadata?.searchPlacement ?? false,
      recommendationPlacement: metadata?.recommendationPlacement ?? false,
      productTitle: (record.title as string | null) ?? null,
      vendorCode: (record.vendor_code as string | null) ?? null,
      brand: (record.brand as string | null) ?? null,
      photoUrl: (record.photo_url as string | null) ?? null,
      adSpend,
      revenue,
      orders,
      views,
      clicks,
      acosPct: pct(adSpend, revenue),
      cpc: ratio(adSpend, clicks),
      ctrPct: pct(clicks, views),
      roas: ratio(revenue, adSpend),
      cpo: ratio(adSpend, orders),
      skuCount: Math.max(1, toInt(record.sku_count)),
      activeDays: toInt(record.active_days),
      lastDataAt: (record.last_data_at as string | null) ?? null,
      todayAdSpend: round(toNumber(record.today_ad_spend), 2),
      todayRevenue: round(toNumber(record.today_revenue), 2),
      todayOrders: toInt(record.today_orders),
      yesterdayAdSpend: round(toNumber(record.yesterday_ad_spend), 2),
      yesterdayRevenue: round(toNumber(record.yesterday_revenue), 2),
      yesterdayOrders: toInt(record.yesterday_orders),
      openCards,
      carts,
      funnelOrders,
      cartRatePct: pct(carts, openCards),
      cartToOrderPct: pct(funnelOrders, carts),
      currentSearchBidRub: searchBidRub,
      currentRecommendationBidRub: recommendationBidRub,
      minBidRub: bidRange.min,
      maxBidRub: bidRange.max,
      budgetCashRub: budget ? round(budget.cash, 2) : null,
      budgetNettingRub: budget ? round(budget.netting, 2) : null,
      budgetTotalRub: budget ? round(budget.total, 2) : null,
      budgetLoadedAt: budget?.loadedAt ?? null,
      avgPosition: record.avg_position === null ? null : round(toNumber(record.avg_position), 2),
      bestPosition: record.best_position === null ? null : toInt(record.best_position),
      positionSamples: toInt(record.position_samples),
      positionKeywords: toInt(record.position_keywords),
      positionUpdatedAt: (record.position_updated_at as string | null) ?? null,
      searchClusterCount: toInt(record.search_cluster_count),
      searchClusterViews,
      searchClusterClicks,
      searchClusterOrders,
      searchClusterSpend,
      searchClusterCtrPct: pct(searchClusterClicks, searchClusterViews),
      searchClusterCpc: ratio(searchClusterSpend, searchClusterClicks),
      campaignCreatedAt: metadata?.timestamps?.created ?? null,
      campaignStartedAt: metadata?.timestamps?.started ?? null,
      campaignUpdatedAt: metadata?.timestamps?.updated ?? null,
      totalCampaigns: toInt(record.total_campaigns),
    };
  });

  const campaignCoverageRecord = (campaignCoverageRaw[0] as Record<string, unknown> | undefined) ?? {};
  const campaignCoveredFrom = (campaignCoverageRecord.covered_from as string | null) ?? null;
  const campaignCoveredTo = (campaignCoverageRecord.covered_to as string | null) ?? null;
  const campaignActiveDays = toInt(campaignCoverageRecord.active_days);
  const accountBalanceRub = accountBalance?.realMoney ?? null;
  const accountBonusRub = accountBalance?.bonusSum ?? null;
  const accountAvailableRub = accountBalanceRub === null && accountBonusRub === null
    ? null
    : round((accountBalanceRub ?? 0) + (accountBonusRub ?? 0), 2);

  const kpiCoverageRecord = (kpiCoverageRaw[0] as Record<string, unknown> | undefined) ?? {};
  const kpiCoveredFrom = (kpiCoverageRecord.covered_from as string | null) ?? null;
  const kpiCoveredTo = (kpiCoverageRecord.covered_to as string | null) ?? null;
  const kpiActiveDays = toInt(kpiCoverageRecord.active_days);
  const kpiTotalsFromRaw = {
    adSpend: round(toNumber(kpiCoverageRecord.ad_spend), 2),
    revenue: round(toNumber(kpiCoverageRecord.revenue), 2),
    orders: toInt(kpiCoverageRecord.orders),
    views: toInt(kpiCoverageRecord.views),
    clicks: toInt(kpiCoverageRecord.clicks),
  };

  const totals = rows.reduce((acc, row) => ({
    adSpend: acc.adSpend + row.adSpend,
    revenue: acc.revenue + row.revenue,
    orders: acc.orders + row.orders,
    views: acc.views + row.views,
    clicks: acc.clicks + row.clicks,
  }), { adSpend: 0, revenue: 0, orders: 0, views: 0, clicks: 0 });
  const campaignTotals = campaigns.reduce((acc, row) => ({
    adSpend: acc.adSpend + row.adSpend,
    views: acc.views + row.views,
    clicks: acc.clicks + row.clicks,
  }), { adSpend: 0, views: 0, clicks: 0 });

  const useRawTotals = kpiActiveDays > 0 && (
    kpiTotalsFromRaw.adSpend > 0
    || kpiTotalsFromRaw.views > 0
    || kpiTotalsFromRaw.clicks > 0
    || kpiTotalsFromRaw.orders > 0
    || kpiTotalsFromRaw.revenue > 0
  );
  const resolvedTotals = useRawTotals ? kpiTotalsFromRaw : {
    adSpend: round(totals.adSpend, 2),
    revenue: round(totals.revenue, 2),
    orders: totals.orders,
    views: totals.views,
    clicks: totals.clicks,
  };
  const rawCtrPct = pct(resolvedTotals.clicks, resolvedTotals.views);
  const normalizedCtrPct = sanitizeCtr(rawCtrPct);
  const campaignCtrPct = sanitizeCtr(pct(campaignTotals.clicks, campaignTotals.views));
  const effectiveCtrPct = resolvedTotals.adSpend > 0
    ? (normalizedCtrPct
      ?? campaignCtrPct
      ?? null)
    : null;
  const effectiveCpc = resolvedTotals.adSpend > 0
    ? (normalizedCtrPct === null && campaignCtrPct !== null
      ? ratio(campaignTotals.adSpend, campaignTotals.clicks)
      : ratio(resolvedTotals.adSpend, resolvedTotals.clicks))
    : null;

  const riskyScopes = rows.filter((row) => (
    (row.adSpend >= 500 && row.orders === 0)
    || (row.acosPct !== null && row.acosPct >= 35)
  )).length;

  return {
    generatedAt: new Date().toISOString(),
    dateWindowDays,
    snapshot: {
      adSpend: resolvedTotals.adSpend,
      revenue: resolvedTotals.revenue,
      orders: resolvedTotals.orders,
      views: resolvedTotals.views,
      clicks: resolvedTotals.clicks,
      acosPct: pct(resolvedTotals.adSpend, resolvedTotals.revenue),
      cpc: effectiveCpc,
      ctrPct: effectiveCtrPct,
      activeScopes: rows.length,
      activeCampaigns: campaigns[0]?.totalCampaigns ?? 0,
      riskyScopes,
      coveredFrom: useRawTotals ? kpiCoveredFrom : campaignCoveredFrom,
      coveredTo: useRawTotals ? kpiCoveredTo : campaignCoveredTo,
      activeDays: useRawTotals ? kpiActiveDays : campaignActiveDays,
      campaignCoveredFrom,
      campaignCoveredTo,
      campaignActiveDays,
      accountBalanceRub,
      accountBonusRub,
      accountAvailableRub,
      accountBalanceSyncedAt: accountBalance?.syncedAt ?? null,
      campaigns: campaigns.map(({ totalCampaigns: _totalCampaigns, ...campaign }) => campaign),
    },
    cards: buildFastDecisionCards(rows, summary),
  };
}
