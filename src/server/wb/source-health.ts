import { eq, sql } from 'drizzle-orm';

import { db, withTenantContext } from '@/lib/db';
import { tenants } from '@/lib/db/schema';
import { decrypt } from '@/lib/encryption';
import { AppError } from '@/lib/errors';
import { getSessionFreshness } from '@/lib/wb-rpa/storage-state';
import { inspectWbLkStorageStateAuth } from '@/server/wb/lk-refresh-flow';

export type WbSourceStatus = 'healthy' | 'warning' | 'invalid' | 'unknown';

export type WbSourceHealthNode = {
  key: string;
  label: string;
  status: WbSourceStatus;
  configured: boolean;
  checkedAt: string | null;
  refreshedAt: string | null;
  lastSyncedAt: string | null;
  message: string;
};

export type WbSourceHealthResponse = {
  generatedAt: string;
  overallStatus: WbSourceStatus;
  auth: {
    wbApiToken: WbSourceHealthNode;
    wbLkSession: WbSourceHealthNode;
    wbLkTokenV3: WbSourceHealthNode;
  };
  contours: {
    advertisingApi: WbSourceHealthNode;
    contentApi: WbSourceHealthNode;
    lkBackedRead: WbSourceHealthNode;
  };
  readiness: {
    campaignSnapshot: WbSourceStatus;
    cardSnapshot: WbSourceStatus;
    lkBackedSnapshot: WbSourceStatus;
    missing: string[];
  };
};

type TokenCheckSummary = {
  key?: unknown;
  ok?: unknown;
  category?: unknown;
  message?: unknown;
};

type LatestSourceRows = Array<{
  advertisingHourlyAt: string | null;
  adCostsAt: string | null;
  adClustersAt: string | null;
  productMetadataAt: string | null;
  priceSnapshotAt: string | null;
}>;

type LkAuthCookieState = {
  configured: boolean;
  mode: 'token-v3' | 'modern-refresh-flow' | 'modern-cookies' | 'wb-token' | 'missing' | 'unreadable';
  message: string;
};

function normalizeSourceStatus(value: unknown): WbSourceStatus {
  if (value === 'healthy' || value === 'warning' || value === 'invalid') {
    return value;
  }
  if (value === 'active') {
    return 'healthy';
  }
  return 'unknown';
}

function dateToIso(value: Date | string | null | undefined) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function latestIso(values: Array<string | null | undefined>) {
  const timestamps = values
    .map((value) => dateToIso(value))
    .filter((value): value is string => Boolean(value))
    .sort();
  return timestamps.at(-1) ?? null;
}

function extractTokenCheck(summary: Record<string, unknown>, key: string): TokenCheckSummary | null {
  const checks = Array.isArray(summary.checks) ? summary.checks : [];
  const found = checks.find((item): item is TokenCheckSummary => (
    typeof item === 'object'
    && item !== null
    && 'key' in item
    && (item as TokenCheckSummary).key === key
  ));
  return found ?? null;
}

function tokenCheckStatus(check: TokenCheckSummary | null, fallback: WbSourceStatus): WbSourceStatus {
  if (!check) {
    return fallback;
  }
  if (check.ok === true) {
    return 'healthy';
  }
  if (check.category === 'missing_token') {
    return 'unknown';
  }
  if (check.category === 'wb_token_invalid' || check.category === 'wb_auth_failed') {
    return 'invalid';
  }
  return 'warning';
}

function tokenCheckMessage(check: TokenCheckSummary | null, fallback: string) {
  return typeof check?.message === 'string' && check.message.trim()
    ? check.message.trim()
    : fallback;
}

function combineOverall(statuses: WbSourceStatus[]): WbSourceStatus {
  if (statuses.includes('invalid')) {
    return 'invalid';
  }
  if (statuses.includes('warning')) {
    return 'warning';
  }
  if (statuses.includes('unknown')) {
    return 'warning';
  }
  return 'healthy';
}

function resolveLkAuthCookieState(params: {
  hasWbLkTokenV3: boolean;
  hasWbLkStorageState: boolean;
  encryptedStorageState: string | null;
}): LkAuthCookieState {
  if (params.hasWbLkTokenV3) {
    return {
      configured: true,
      mode: 'token-v3',
      message: 'WBTokenV3 сохранён; LK HTTP-read контур может работать без Playwright.',
    };
  }

  if (!params.hasWbLkStorageState) {
    return {
      configured: false,
      mode: 'missing',
      message: 'WB ЛК-сессия не сохранена.',
    };
  }

  let authSummary: ReturnType<typeof inspectWbLkStorageStateAuth>;
  try {
    authSummary = inspectWbLkStorageStateAuth(decrypt(params.encryptedStorageState ?? ''));
  } catch {
    return {
      configured: false,
      mode: 'unreadable',
      message: 'WB ЛК-сессия есть, но auth-cookie не удалось проверить.',
    };
  }

  if (authSummary.hasAuthorizeV3 && authSummary.hasWbxValidationKey && authSummary.hasWbxRefresh) {
    return {
      configured: true,
      mode: 'modern-refresh-flow',
      message: `Найдены authorizev3 + wbx-refresh + wbx-validation-key; LK refresh-flow доступен${authSummary.rootVersion ? ` (${authSummary.rootVersion})` : ''}.`,
    };
  }

  if (authSummary.hasWbxValidationKey && authSummary.hasWbxRefresh) {
    return {
      configured: true,
      mode: 'modern-cookies',
      message: 'Найдены wbx-refresh + wbx-validation-key, но нет authorizev3 из seller localStorage.',
    };
  }

  if (authSummary.hasLegacyWbToken) {
    return {
      configured: true,
      mode: 'wb-token',
      message: 'Найден legacy WBToken в сохранённой ЛК-сессии.',
    };
  }

  return {
    configured: false,
    mode: 'missing',
    message: 'В сохранённой ЛК-сессии нет auth-cookie для LK-backed чтения.',
  };
}

export async function getTenantSourceHealth(tenantId: string): Promise<WbSourceHealthResponse> {
  const [tenant] = await db
    .select({
      wbTokenHealthStatus: tenants.wbTokenHealthStatus,
      wbTokenCheckedAt: tenants.wbTokenCheckedAt,
      wbTokenHealthSummary: tenants.wbTokenHealthSummary,
      wbLkSessionStatus: tenants.wbLkSessionStatus,
      wbLkSessionCheckedAt: tenants.wbLkSessionCheckedAt,
      wbLkSessionError: tenants.wbLkSessionError,
      wbLkStorageState: tenants.wbLkStorageState,
      wbLkStorageStateRefreshedAt: tenants.wbLkStorageStateRefreshedAt,
      wbLkTokenV3RefreshedAt: tenants.wbLkTokenV3RefreshedAt,
      hasWbApiToken: sql<boolean>`COALESCE(${tenants.wbApiToken}, '') <> ''`,
      hasWbLkStorageState: sql<boolean>`COALESCE(${tenants.wbLkStorageState}, '') <> '' OR COALESCE(${tenants.wbLkStorageStatePath}, '') <> ''`,
      hasWbLkTokenV3: sql<boolean>`COALESCE(${tenants.wbLkTokenV3}, '') <> ''`,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  if (!tenant) {
    throw new AppError('Кабинет не найден', 404);
  }

  const [latest] = await withTenantContext(db, tenantId, async (tx) => (
    tx.execute(sql`
      SELECT
        (SELECT MAX(updated_at)::text FROM advertising_hourly_stats WHERE tenant_id = ${tenantId}) AS "advertisingHourlyAt",
        (SELECT MAX(created_at)::text FROM raw_api_ad_costs WHERE tenant_id = ${tenantId}) AS "adCostsAt",
        (SELECT MAX(created_at)::text FROM raw_api_ad_clusters WHERE tenant_id = ${tenantId}) AS "adClustersAt",
        (SELECT MAX(updated_at)::text FROM raw_api_product_metadata WHERE tenant_id = ${tenantId}) AS "productMetadataAt",
        (SELECT MAX(updated_at)::text FROM raw_api_price_snapshots WHERE tenant_id = ${tenantId}) AS "priceSnapshotAt"
    `)
  )) as LatestSourceRows;

  const tokenStatus = tenant.hasWbApiToken
    ? normalizeSourceStatus(tenant.wbTokenHealthStatus)
    : 'unknown';
  const tokenSummary = (tenant.wbTokenHealthSummary ?? {}) as Record<string, unknown>;
  const advertisingCheck = extractTokenCheck(tokenSummary, 'ads');
  const contentCheck = extractTokenCheck(tokenSummary, 'content');
  const lkSessionStatus = tenant.hasWbLkStorageState
    ? normalizeSourceStatus(tenant.wbLkSessionStatus)
    : 'unknown';
  const sessionFreshness = getSessionFreshness(tenant.wbLkStorageStateRefreshedAt);
  const lkAuthCookieState = resolveLkAuthCookieState({
    hasWbLkTokenV3: tenant.hasWbLkTokenV3,
    hasWbLkStorageState: tenant.hasWbLkStorageState,
    encryptedStorageState: tenant.wbLkStorageState,
  });
  const lkSessionMessage = tenant.wbLkSessionError?.trim()
    || (tenant.hasWbLkStorageState
      ? `Storage state: ${sessionFreshness.status}, ${Number.isFinite(sessionFreshness.ageDays) ? `${sessionFreshness.ageDays} дн.` : 'нет даты'}.`
      : 'WB ЛК-сессия не сохранена.');
  const advertisingLastSyncedAt = latestIso([
    latest?.advertisingHourlyAt,
    latest?.adCostsAt,
    latest?.adClustersAt,
  ]);
  const contentLastSyncedAt = latestIso([
    latest?.productMetadataAt,
    latest?.priceSnapshotAt,
  ]);
  const hasModernRefreshFlow = lkAuthCookieState.mode === 'modern-refresh-flow';
  const hasVerifiedLkAuth = lkAuthCookieState.mode === 'token-v3' || hasModernRefreshFlow;
  const lkAuthStatus: WbSourceStatus = hasVerifiedLkAuth
    ? lkSessionStatus === 'invalid' ? 'invalid' : 'healthy'
    : tenant.hasWbLkStorageState ? 'warning' : 'unknown';
  const lkReadStatus: WbSourceStatus = tenant.hasWbLkStorageState && hasVerifiedLkAuth
    ? lkSessionStatus === 'invalid' ? 'invalid' : 'healthy'
    : tenant.hasWbLkStorageState ? 'warning' : 'unknown';

  const auth = {
    wbApiToken: {
      key: 'wb_api_token',
      label: 'WB API token',
      status: tokenStatus,
      configured: tenant.hasWbApiToken,
      checkedAt: dateToIso(tenant.wbTokenCheckedAt),
      refreshedAt: null,
      lastSyncedAt: null,
      message: tenant.hasWbApiToken
        ? 'Токен сохранён; preflight хранится по контурам WB API.'
        : 'Токен WB API не сохранён.',
    },
    wbLkSession: {
      key: 'wb_lk_session',
      label: 'WB ЛК session',
      status: lkSessionStatus,
      configured: tenant.hasWbLkStorageState,
      checkedAt: dateToIso(tenant.wbLkSessionCheckedAt),
      refreshedAt: dateToIso(tenant.wbLkStorageStateRefreshedAt),
      lastSyncedAt: null,
      message: lkSessionMessage,
    },
    wbLkTokenV3: {
      key: 'wb_lk_auth',
      label: 'WB ЛК auth',
      status: lkAuthStatus,
      configured: lkAuthCookieState.configured,
      checkedAt: null,
      refreshedAt: dateToIso(tenant.wbLkTokenV3RefreshedAt ?? tenant.wbLkStorageStateRefreshedAt),
      lastSyncedAt: null,
      message: lkAuthCookieState.message,
    },
  } satisfies WbSourceHealthResponse['auth'];

  const contours = {
    advertisingApi: {
      key: 'advertising_api',
      label: 'Advertising API',
      status: tenant.hasWbApiToken ? tokenCheckStatus(advertisingCheck, tokenStatus) : 'unknown',
      configured: tenant.hasWbApiToken,
      checkedAt: dateToIso(tenant.wbTokenCheckedAt),
      refreshedAt: null,
      lastSyncedAt: advertisingLastSyncedAt,
      message: tokenCheckMessage(advertisingCheck, 'Контур рекламы использует WB API token: кампании, ставки, fullstats.'),
    },
    contentApi: {
      key: 'content_api',
      label: 'Content API',
      status: tenant.hasWbApiToken ? tokenCheckStatus(contentCheck, tokenStatus) : 'unknown',
      configured: tenant.hasWbApiToken,
      checkedAt: dateToIso(tenant.wbTokenCheckedAt),
      refreshedAt: null,
      lastSyncedAt: contentLastSyncedAt,
      message: tokenCheckMessage(contentCheck, 'Контур карточек использует WB Content/Prices API и локальные snapshots.'),
    },
    lkBackedRead: {
      key: 'lk_backed_read',
      label: 'LK-backed read',
      status: lkReadStatus,
      configured: tenant.hasWbLkStorageState && lkAuthCookieState.configured,
      checkedAt: dateToIso(tenant.wbLkSessionCheckedAt),
      refreshedAt: dateToIso(tenant.wbLkTokenV3RefreshedAt ?? tenant.wbLkStorageStateRefreshedAt),
      lastSyncedAt: null,
      message: lkReadStatus === 'healthy'
        ? hasModernRefreshFlow
          ? 'WB ЛК refresh-flow готов: перед LK-backed sync получаем короткий token и проверяем read-only probe.'
          : 'WB ЛК-сессия и LK auth-cookie готовы для read-only snapshot sync.'
        : tenant.hasWbLkStorageState
          ? 'WB ЛК-сессия есть, но HTTP LK-backed read требует refresh-flow вместо устаревшего WBTokenV3.'
          : 'Для LK-backed sync нужна WB ЛК-сессия через номер телефона.',
    },
  } satisfies WbSourceHealthResponse['contours'];

  const missing = [
    !auth.wbApiToken.configured ? 'WB API token' : null,
    contours.advertisingApi.status === 'invalid' ? 'валидный Advertising API доступ' : null,
    contours.contentApi.status === 'invalid' ? 'валидный Content API доступ' : null,
    !auth.wbLkSession.configured ? 'WB ЛК session' : null,
    !auth.wbLkTokenV3.configured ? 'WB ЛК auth' : null,
  ].filter((value): value is string => Boolean(value));

  const readiness = {
    campaignSnapshot: contours.advertisingApi.status,
    cardSnapshot: combineOverall([contours.contentApi.status]),
    lkBackedSnapshot: contours.lkBackedRead.status,
    missing,
  };

  return {
    generatedAt: new Date().toISOString(),
    overallStatus: combineOverall([
      auth.wbApiToken.status,
      contours.advertisingApi.status,
      contours.contentApi.status,
      contours.lkBackedRead.status,
    ]),
    auth,
    contours,
    readiness,
  };
}
