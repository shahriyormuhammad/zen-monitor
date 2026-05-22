import { and, desc, eq, sql } from 'drizzle-orm';

import { AppError } from '@/lib/auth/tenant-access';
import { db, withTenantContext } from '@/lib/db';
import {
  advertisingClusterActions,
  tenants,
} from '@/lib/db/schema';
import { decryptIfNeeded } from '@/lib/encryption';
import { wbApi } from '@/lib/wb-api';
import { logger } from '@/lib/logger';

const MAX_CLUSTER_LIST_LIMIT = 300;
const ACTIONABLE_STATUSES = new Set([4, 9, 11]);

export type ClusterRiskLevel = 'high' | 'medium' | 'low' | 'none';

export type AdvertisingClusterListRow = {
  nmId: number;
  cluster: string;
  vendorCode: string | null;
  brand: string | null;
  photoUrl: string | null;
  adSpend: number;
  views: number;
  clicks: number;
  orders: number;
  activeDays: number;
  revenue: number;
  ctrPct: number | null;
  cpc: number | null;
  orderRatePct: number | null;
  acosProxyPct: number | null;
  riskLevel: ClusterRiskLevel;
  riskReason: string | null;
};

export type AdvertisingClusterListResponse = {
  generatedAt: string;
  hasData: boolean;
  total: number;
  summary: {
    adSpend: number;
    clicks: number;
    orders: number;
    revenue: number;
    highRiskClusters: number;
  };
  rows: AdvertisingClusterListRow[];
};

export type AdvertisingClusterCampaignState = {
  advertId: number;
  status: number | null;
  paymentType: 'cpm' | 'cpc' | null;
  searchPlacement: boolean;
  recommendationPlacement: boolean;
  actionable: boolean;
  isExcluded: boolean;
  minusPhrasesCount: number;
  currentBid: number | null;
};

export type AdvertisingClusterActionLog = {
  id: string;
  createdAt: string;
  action: 'exclude' | 'include';
  status: 'success' | 'failed';
  advertId: number;
  beforeMinusCount: number;
  afterMinusCount: number;
  errorMessage: string | null;
};

export type AdvertisingClusterControlResponse = {
  generatedAt: string;
  nmId: number;
  cluster: string;
  campaigns: AdvertisingClusterCampaignState[];
  recommendation: {
    advertId: number;
    baseCompetitiveBidRub: number | null;
    baseLeadersBidRub: number | null;
    baseTop2BidRub: number | null;
    clusterReachMinRub: number | null;
    clusterReachMediumRub: number | null;
    clusterReachMaxRub: number | null;
    clusterReachMaxMinRub: number | null;
  } | null;
  recentActions: AdvertisingClusterActionLog[];
};

export type AdvertisingClusterToggleResponse = {
  ok: true;
  changed: boolean;
  mode: 'exclude' | 'include';
  advertId: number;
  nmId: number;
  cluster: string;
  minusPhrasesCount: number;
};

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

function toNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toInt(value: unknown) {
  return Math.max(0, Math.round(toNumber(value)));
}

function round(value: number, precision = 2) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function toNullableRatio(numerator: number, denominator: number, precision = 2) {
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  return round(numerator / denominator, precision);
}

function toNullablePct(numerator: number, denominator: number, precision = 2) {
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  return round((numerator / denominator) * 100, precision);
}

function normalizeCluster(value: string) {
  return value.trim().toLocaleLowerCase('ru-RU');
}

function normalizePhraseList(phrases: string[]) {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const rawPhrase of phrases) {
    const phrase = String(rawPhrase ?? '').trim();
    if (!phrase) {
      continue;
    }

    const key = normalizeCluster(phrase);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(phrase);
  }

  return result;
}

function buildClusterRisk(clicks: number, orders: number, views: number, cpc: number | null, ctrPct: number | null) {
  if (clicks >= 25 && orders === 0) {
    return {
      riskLevel: 'high' as const,
      riskReason: 'Клики есть, заказов нет. Кандидат на минусацию.',
    };
  }

  if (cpc !== null && cpc >= 80 && clicks >= 15) {
    return {
      riskLevel: 'medium' as const,
      riskReason: 'Высокий CPC при заметном трафике.',
    };
  }

  if (ctrPct !== null && ctrPct < 0.45 && views >= 1000) {
    return {
      riskLevel: 'low' as const,
      riskReason: 'Низкий CTR для кластера.',
    };
  }

  return {
    riskLevel: 'none' as const,
    riskReason: null,
  };
}

function buildClusterBaseCte(tenantId: string, fromIso: string, toExclusiveIso: string) {
  return sql`
    WITH cluster_base AS (
      SELECT
        nm_id,
        cluster,
        SUM(amount)::numeric AS ad_spend,
        SUM(views)::bigint AS views,
        SUM(clicks)::bigint AS clicks,
        SUM(order_count)::bigint AS orders,
        COUNT(DISTINCT DATE_TRUNC('day', date))::int AS active_days
      FROM raw_api_ad_clusters
      WHERE tenant_id = ${tenantId}
        AND date >= ${fromIso}::timestamp
        AND date < ${toExclusiveIso}::timestamp
      GROUP BY nm_id, cluster
    ),
    sales_by_nm AS (
      SELECT
        nm_id,
        SUM(price_with_discount)::numeric AS revenue
      FROM raw_api_sales
      WHERE tenant_id = ${tenantId}
        AND is_storno = false
        AND date >= ${fromIso}::timestamp
        AND date < ${toExclusiveIso}::timestamp
      GROUP BY nm_id
    )
  `;
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

export async function getAdvertisingClusters(
  tenantId: string,
  dateFrom: Date,
  dateTo: Date,
  options?: {
    search?: string;
    limit?: number;
  },
): Promise<AdvertisingClusterListResponse> {
  const from = toUtcDayStart(dateFrom);
  const to = toUtcDayStart(dateTo);
  const toExclusive = addUtcDays(to, 1);

  const fromIso = from.toISOString();
  const toExclusiveIso = toExclusive.toISOString();
  const search = (options?.search ?? '').trim().toLocaleLowerCase('ru-RU');
  const searchPattern = `%${search}%`;
  const limit = Math.min(Math.max(1, options?.limit ?? 120), MAX_CLUSTER_LIST_LIMIT);

  const searchFilter = search
    ? sql`(
      LOWER(c.cluster) LIKE ${searchPattern}
      OR CAST(c.nm_id AS text) LIKE ${searchPattern}
      OR LOWER(COALESCE(p.vendor_code, '')) LIKE ${searchPattern}
      OR LOWER(COALESCE(p.brand, '')) LIKE ${searchPattern}
    )`
    : sql`TRUE`;

  const totalRowsRaw = await withTenantContext(db, tenantId, async (tx) => tx.execute(sql`
    ${buildClusterBaseCte(tenantId, fromIso, toExclusiveIso)}
    SELECT COUNT(*)::int AS total
    FROM cluster_base c
    LEFT JOIN products p
      ON p.tenant_id = ${tenantId}
     AND p.nm_id = c.nm_id
     AND COALESCE(p.is_hidden, FALSE) = FALSE
    WHERE ${searchFilter}
  `));

  const total = toInt((totalRowsRaw[0] as Record<string, unknown> | undefined)?.total);

  const rowsRaw = await withTenantContext(db, tenantId, async (tx) => tx.execute(sql`
    ${buildClusterBaseCte(tenantId, fromIso, toExclusiveIso)}
    SELECT
      c.nm_id,
      c.cluster,
      c.ad_spend,
      c.views,
      c.clicks,
      c.orders,
      c.active_days,
      COALESCE(s.revenue, 0)::numeric AS revenue,
      p.vendor_code,
      p.brand,
      p.photo_url
    FROM cluster_base c
    LEFT JOIN products p
      ON p.tenant_id = ${tenantId}
     AND p.nm_id = c.nm_id
     AND COALESCE(p.is_hidden, FALSE) = FALSE
    LEFT JOIN sales_by_nm s
      ON s.nm_id = c.nm_id
    WHERE ${searchFilter}
    ORDER BY c.ad_spend DESC, c.clicks DESC
    LIMIT ${limit}
  `));

  const rows: AdvertisingClusterListRow[] = rowsRaw.map((rawRow) => {
    const row = rawRow as Record<string, unknown>;
    const adSpend = round(toNumber(row.ad_spend), 2);
    const clicks = toInt(row.clicks);
    const orders = toInt(row.orders);
    const views = toInt(row.views);
    const revenue = round(toNumber(row.revenue), 2);
    const ctrPct = toNullablePct(clicks, views);
    const cpc = toNullableRatio(adSpend, clicks);
    const risk = buildClusterRisk(clicks, orders, views, cpc, ctrPct);

    return {
      nmId: toInt(row.nm_id),
      cluster: String(row.cluster ?? '').trim(),
      vendorCode: (row.vendor_code as string | null) ?? null,
      brand: (row.brand as string | null) ?? null,
      photoUrl: (row.photo_url as string | null) ?? null,
      adSpend,
      views,
      clicks,
      orders,
      activeDays: toInt(row.active_days),
      revenue,
      ctrPct,
      cpc,
      orderRatePct: toNullablePct(orders, clicks),
      acosProxyPct: toNullablePct(adSpend, revenue),
      riskLevel: risk.riskLevel,
      riskReason: risk.riskReason,
    };
  });

  const summary = {
    adSpend: round(rows.reduce((sum, row) => sum + row.adSpend, 0), 2),
    clicks: rows.reduce((sum, row) => sum + row.clicks, 0),
    orders: rows.reduce((sum, row) => sum + row.orders, 0),
    revenue: round(rows.reduce((sum, row) => sum + row.revenue, 0), 2),
    highRiskClusters: rows.filter((row) => row.riskLevel === 'high').length,
  };

  return {
    generatedAt: new Date().toISOString(),
    hasData: rows.length > 0,
    total,
    summary,
    rows,
  };
}

async function getRecentClusterActions(
  tenantId: string,
  nmId: number,
  cluster: string,
): Promise<AdvertisingClusterActionLog[]> {
  const logs = await withTenantContext(db, tenantId, async (tx) =>
    tx.select({
      id: advertisingClusterActions.id,
      createdAt: advertisingClusterActions.createdAt,
      action: advertisingClusterActions.action,
      status: advertisingClusterActions.status,
      advertId: advertisingClusterActions.advertId,
      beforeMinusCount: advertisingClusterActions.beforeMinusCount,
      afterMinusCount: advertisingClusterActions.afterMinusCount,
      errorMessage: advertisingClusterActions.errorMessage,
    })
      .from(advertisingClusterActions)
      .where(and(
        eq(advertisingClusterActions.tenantId, tenantId),
        eq(advertisingClusterActions.nmId, nmId),
        eq(advertisingClusterActions.cluster, cluster),
      ))
      .orderBy(desc(advertisingClusterActions.createdAt))
      .limit(20),
  );

  return logs.map((row) => ({
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    action: row.action === 'include' ? 'include' : 'exclude',
    status: row.status === 'failed' ? 'failed' : 'success',
    advertId: row.advertId,
    beforeMinusCount: row.beforeMinusCount,
    afterMinusCount: row.afterMinusCount,
    errorMessage: row.errorMessage,
  }));
}

export async function getAdvertisingClusterControl(
  tenantId: string,
  nmId: number,
  cluster: string,
): Promise<AdvertisingClusterControlResponse> {
  if (!Number.isFinite(nmId) || nmId <= 0) {
    throw new AppError('Некорректный nmId', 400);
  }

  const normalizedCluster = String(cluster ?? '').trim();
  if (!normalizedCluster) {
    throw new AppError('Передайте название кластера', 400);
  }

  const token = await getTenantWbToken(tenantId);
  const campaigns = await wbApi.getAdCampaigns(token);
  const campaignPool = campaigns
    .filter((item) => item.searchPlacement && item.nmIds.includes(nmId))
    .map((item) => ({
      advertId: item.advertId,
      status: item.status ?? null,
      paymentType: item.paymentType ?? null,
      searchPlacement: item.searchPlacement,
      recommendationPlacement: item.recommendationPlacement,
      actionable: item.status === undefined || ACTIONABLE_STATUSES.has(item.status),
    }));

  const minusItems = campaignPool.map((item) => ({ advertId: item.advertId, nmId }));
  const minusRows = minusItems.length > 0
    ? await wbApi.getCampaignMinusPhrases(token, minusItems)
    : [];

  const minusMap = new Map<string, string[]>();
  for (const item of minusRows) {
    minusMap.set(`${item.advertId}:${item.nmId}`, normalizePhraseList(item.normQueries));
  }

  const bidRows = [] as Awaited<ReturnType<typeof wbApi.getSearchClusterBids>>;
  for (const campaign of campaignPool) {
    if (campaign.paymentType !== 'cpm') {
      continue;
    }

    try {
      const bids = await wbApi.getSearchClusterBids(token, [{ advertId: campaign.advertId, nmId }]);
      bidRows.push(...bids);
    } catch (error) {
      logger.warn(
        { err: error, tenantId, advertId: campaign.advertId, nmId },
        '[Advertising Clusters] getSearchClusterBids failed',
      );
    }
  }

  const clusterKey = normalizeCluster(normalizedCluster);
  const campaignsState: AdvertisingClusterCampaignState[] = campaignPool.map((campaign) => {
    const key = `${campaign.advertId}:${nmId}`;
    const minusPhrases = minusMap.get(key) ?? [];
    const bidMatch = bidRows.find((row) => (
      row.advertId === campaign.advertId
      && row.nmId === nmId
      && normalizeCluster(row.keyword) === clusterKey
    ));

    return {
      advertId: campaign.advertId,
      status: campaign.status,
      paymentType: campaign.paymentType,
      searchPlacement: campaign.searchPlacement,
      recommendationPlacement: campaign.recommendationPlacement,
      actionable: campaign.actionable,
      isExcluded: minusPhrases.some((phrase) => normalizeCluster(phrase) === clusterKey),
      minusPhrasesCount: minusPhrases.length,
      currentBid: bidMatch?.bid ?? null,
    };
  });

  let recommendation: AdvertisingClusterControlResponse['recommendation'] = null;
  const recommendationCampaign = campaignsState.find((item) => item.paymentType === 'cpm');
  if (recommendationCampaign) {
    try {
      const rawRecommendation = await wbApi.getBidsRecommendations(
        token,
        recommendationCampaign.advertId,
        nmId,
      );

      if (rawRecommendation) {
        const clusterRecommendation = rawRecommendation.normQueries.find(
          (item) => normalizeCluster(item.keyword) === clusterKey,
        );

        recommendation = {
          advertId: rawRecommendation.advertId,
          baseCompetitiveBidRub: rawRecommendation.base.competitiveBidKopecks === null
            ? null
            : round(rawRecommendation.base.competitiveBidKopecks / 100, 2),
          baseLeadersBidRub: rawRecommendation.base.leadersBidKopecks === null
            ? null
            : round(rawRecommendation.base.leadersBidKopecks / 100, 2),
          baseTop2BidRub: rawRecommendation.base.top2BidKopecks === null
            ? null
            : round(rawRecommendation.base.top2BidKopecks / 100, 2),
          clusterReachMinRub: clusterRecommendation?.reachMinBidKopecks === null || clusterRecommendation?.reachMinBidKopecks === undefined
            ? null
            : round(clusterRecommendation.reachMinBidKopecks / 100, 2),
          clusterReachMediumRub: clusterRecommendation?.reachMediumBidKopecks === null || clusterRecommendation?.reachMediumBidKopecks === undefined
            ? null
            : round(clusterRecommendation.reachMediumBidKopecks / 100, 2),
          clusterReachMaxRub: clusterRecommendation?.reachMaxBidKopecks === null || clusterRecommendation?.reachMaxBidKopecks === undefined
            ? null
            : round(clusterRecommendation.reachMaxBidKopecks / 100, 2),
          clusterReachMaxMinRub: clusterRecommendation?.reachMaxMinBidKopecks === null || clusterRecommendation?.reachMaxMinBidKopecks === undefined
            ? null
            : round(clusterRecommendation.reachMaxMinBidKopecks / 100, 2),
        };
      }
    } catch (error) {
      logger.warn(
        { err: error, tenantId, advertId: recommendationCampaign.advertId, nmId },
        '[Advertising Clusters] getBidsRecommendations failed',
      );
    }
  }

  const recentActions = await getRecentClusterActions(tenantId, nmId, normalizedCluster);

  return {
    generatedAt: new Date().toISOString(),
    nmId,
    cluster: normalizedCluster,
    campaigns: campaignsState,
    recommendation,
    recentActions,
  };
}

type ToggleClusterParams = {
  tenantId: string;
  userId: string | null;
  advertId: number;
  nmId: number;
  cluster: string;
  mode: 'exclude' | 'include';
};

export async function toggleAdvertisingCluster(
  params: ToggleClusterParams,
): Promise<AdvertisingClusterToggleResponse> {
  const { tenantId, userId, advertId, nmId, mode } = params;
  const cluster = String(params.cluster ?? '').trim();

  if (!cluster) {
    throw new AppError('Кластер не передан', 400);
  }

  if (!Number.isFinite(advertId) || advertId <= 0) {
    throw new AppError('Некорректный advertId', 400);
  }

  if (!Number.isFinite(nmId) || nmId <= 0) {
    throw new AppError('Некорректный nmId', 400);
  }

  if (mode !== 'exclude' && mode !== 'include') {
    throw new AppError('Некорректный режим действия', 400);
  }

  const token = await getTenantWbToken(tenantId);
  const clusterKey = normalizeCluster(cluster);
  let beforeMinusCount = 0;
  let afterMinusCount = 0;

  try {
    const currentState = await wbApi.getCampaignMinusPhrases(token, [{ advertId, nmId }]);
    const currentMinus = normalizePhraseList(currentState[0]?.normQueries ?? []);
    beforeMinusCount = currentMinus.length;

    const exists = currentMinus.some((phrase) => normalizeCluster(phrase) === clusterKey);
    const nextMinus = mode === 'exclude'
      ? (exists ? currentMinus : [...currentMinus, cluster])
      : currentMinus.filter((phrase) => normalizeCluster(phrase) !== clusterKey);

    const changed = mode === 'exclude' ? !exists : exists;
    afterMinusCount = nextMinus.length;

    if (changed) {
      await wbApi.setCampaignMinusPhrases(token, advertId, nmId, nextMinus);
    }

    await withTenantContext(db, tenantId, async (tx) => {
      await tx.insert(advertisingClusterActions).values({
        tenantId,
        userId,
        advertId,
        nmId,
        cluster,
        action: mode,
        status: 'success',
        beforeMinusCount,
        afterMinusCount,
        meta: {
          changed,
          reason: changed ? 'wb_set_minus' : 'state_unchanged',
        },
      });
    });

    return {
      ok: true,
      changed,
      mode,
      advertId,
      nmId,
      cluster,
      minusPhrasesCount: afterMinusCount,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await withTenantContext(db, tenantId, async (tx) => {
      await tx.insert(advertisingClusterActions).values({
        tenantId,
        userId,
        advertId,
        nmId,
        cluster,
        action: mode,
        status: 'failed',
        beforeMinusCount,
        afterMinusCount,
        errorMessage: message,
        meta: {
          reason: 'wb_set_minus_failed',
        },
      });
    });

    throw new AppError(`Не удалось применить действие к кластеру: ${message}`, 502);
  }
}
