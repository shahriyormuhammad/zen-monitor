import { eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { tenants } from '@/lib/db/schema';
import { decrypt } from '@/lib/encryption';

const SELLER_ORIGIN = 'https://seller.wildberries.ru';
const SELLER_REFERER = `${SELLER_ORIGIN}/analytics-reports/warehouse-remains`;
const WB_LK_AUTH_TOKEN_URL = `${SELLER_ORIGIN}/ns/suppliers-auth/suppliers-portal-core/auth/token`;
const WB_LK_READ_ONLY_PROBE_URL = 'https://seller-weekly-report.wildberries.ru/ns/balances/analytics-back/api/v2/balances?limit=1&offset=0&total=0';
const DEFAULT_TIMEOUT_MS = 15_000;
const FALLBACK_ROOT_VERSION = 'v1.93.1';
const DEFAULT_BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

type StorageStateCookie = {
  name?: unknown;
  value?: unknown;
};

type StorageStateOrigin = {
  origin?: unknown;
  localStorage?: Array<{ name?: unknown; value?: unknown }>;
};

type WbLkStorageState = {
  cookies?: StorageStateCookie[];
  origins?: StorageStateOrigin[];
};

type WbLkAuthInputs = {
  authorizeV3: string;
  rootVersion: string;
  cookieHeader: string;
};

export type WbLkStorageStateAuthSummary = {
  hasAuthorizeV3: boolean;
  hasWbxRefresh: boolean;
  hasWbxValidationKey: boolean;
  hasLegacyWbToken: boolean;
  rootVersion: string | null;
};

export type WbLkReadSession = {
  accessToken: string;
  expiresAt: Date;
  ttlSeconds: number | null;
  userId: number | null;
  rootVersion: string;
  readOnlyProbe: {
    endpoint: string;
    status: number;
  };
  headers: {
    authorizeV3: string;
    cookie: string;
  };
};

export type WbLkRefreshFlowCheckResult = {
  tenantId: string;
  status: 'healthy' | 'warning' | 'invalid';
  ok: boolean;
  checkedAt: string;
  code: string;
  message: string;
  rootVersion: string | null;
  tokenTtlSeconds: number | null;
  tokenExpiresAt: string | null;
  authHttpStatus: number | null;
  readOnlyHttpStatus: number | null;
};

export class WbLkRefreshFlowError extends Error {
  readonly code: string;
  readonly status: 'warning' | 'invalid';
  readonly authHttpStatus: number | null;
  readonly readOnlyHttpStatus: number | null;
  readonly rootVersion: string | null;

  constructor(params: {
    code: string;
    message: string;
    status?: 'warning' | 'invalid';
    authHttpStatus?: number | null;
    readOnlyHttpStatus?: number | null;
    rootVersion?: string | null;
  }) {
    super(params.message);
    this.name = 'WbLkRefreshFlowError';
    this.code = params.code;
    this.status = params.status ?? 'warning';
    this.authHttpStatus = params.authHttpStatus ?? null;
    this.readOnlyHttpStatus = params.readOnlyHttpStatus ?? null;
    this.rootVersion = params.rootVersion ?? null;
  }
}

function parseStorageState(storageStateText: string): WbLkStorageState {
  const parsed = JSON.parse(storageStateText) as WbLkStorageState;
  return {
    cookies: Array.isArray(parsed.cookies) ? parsed.cookies : [],
    origins: Array.isArray(parsed.origins) ? parsed.origins : [],
  };
}

function getSellerLocalStorage(storageState: WbLkStorageState) {
  const sellerOrigin = storageState.origins?.find((origin) => origin.origin === SELLER_ORIGIN);
  return new Map(
    (sellerOrigin?.localStorage ?? [])
      .filter((entry) => typeof entry.name === 'string' && typeof entry.value === 'string')
      .map((entry) => [entry.name as string, entry.value as string]),
  );
}

function buildCookieHeader(cookies: StorageStateCookie[]) {
  const map = new Map<string, string>();
  for (const cookie of cookies) {
    if (typeof cookie.name !== 'string' || typeof cookie.value !== 'string') {
      continue;
    }
    map.set(cookie.name, cookie.value);
  }
  return Array.from(map.entries()).map(([name, value]) => `${name}=${value}`).join('; ');
}

export function inspectWbLkStorageStateAuth(storageStateText: string): WbLkStorageStateAuthSummary {
  const storageState = parseStorageState(storageStateText);
  const localStorage = getSellerLocalStorage(storageState);
  const cookieNames = new Set(
    (storageState.cookies ?? [])
      .map((cookie) => (typeof cookie.name === 'string' ? cookie.name.toLowerCase() : null))
      .filter((name): name is string => Boolean(name)),
  );

  return {
    hasAuthorizeV3: Boolean(localStorage.get('wb-eu-passport-v2.access-token')),
    hasWbxRefresh: cookieNames.has('wbx-refresh'),
    hasWbxValidationKey: cookieNames.has('wbx-validation-key'),
    hasLegacyWbToken: cookieNames.has('wbtoken'),
    rootVersion: localStorage.get('@root/latest-app-version') ?? null,
  };
}

function extractAuthInputs(storageStateText: string): WbLkAuthInputs {
  const storageState = parseStorageState(storageStateText);
  const localStorage = getSellerLocalStorage(storageState);
  const authorizeV3 = localStorage.get('wb-eu-passport-v2.access-token');
  const rootVersion = localStorage.get('@root/latest-app-version') ?? FALLBACK_ROOT_VERSION;
  const cookieHeader = buildCookieHeader(storageState.cookies ?? []);
  const cookieNames = new Set(
    (storageState.cookies ?? [])
      .map((cookie) => (typeof cookie.name === 'string' ? cookie.name.toLowerCase() : null))
      .filter((name): name is string => Boolean(name)),
  );

  if (!authorizeV3) {
    throw new WbLkRefreshFlowError({
      code: 'missing_authorizev3',
      status: 'invalid',
      rootVersion,
      message: 'В WB ЛК storageState нет wb-eu-passport-v2.access-token.',
    });
  }
  if (!cookieNames.has('wbx-refresh') || !cookieNames.has('wbx-validation-key')) {
    throw new WbLkRefreshFlowError({
      code: 'missing_modern_cookies',
      status: 'invalid',
      rootVersion,
      message: 'В WB ЛК storageState нет wbx-refresh или wbx-validation-key.',
    });
  }
  if (!cookieHeader) {
    throw new WbLkRefreshFlowError({
      code: 'missing_cookies',
      status: 'invalid',
      rootVersion,
      message: 'В WB ЛК storageState нет cookies.',
    });
  }

  return { authorizeV3, rootVersion, cookieHeader };
}

function buildBaseHeaders(auth: WbLkAuthInputs, accessToken?: string): Record<string, string> {
  return {
    accept: 'application/json',
    'accept-language': 'ru-RU',
    'content-type': 'application/json',
    referer: SELLER_REFERER,
    'root-version': auth.rootVersion,
    authorizev3: auth.authorizeV3,
    cookie: auth.cookieHeader,
    'sec-ch-ua': '"Chromium";v="130", "Not.A/Brand";v="8", "Google Chrome";v="130"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'user-agent': DEFAULT_BROWSER_UA,
    ...(accessToken ? { 'wb-seller-lk': accessToken } : {}),
  };
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const [, payload] = token.split('.');
  if (!payload) {
    return {};
  }
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as Record<string, unknown>;
}

function parseAuthTokenResponse(text: string): {
  token: string;
  expiresAt: Date;
  ttlSeconds: number | null;
  userId: number | null;
} {
  const json = JSON.parse(text) as {
    result?: { data?: { token?: unknown; userID?: unknown; exp?: unknown } };
  };
  const token = json.result?.data?.token;
  if (typeof token !== 'string' || !token) {
    throw new WbLkRefreshFlowError({
      code: 'auth_token_missing',
      status: 'invalid',
      message: 'WB auth/token не вернул короткий LK access-token.',
    });
  }

  const payload = decodeJwtPayload(token);
  const exp = typeof payload.exp === 'number'
    ? payload.exp
    : typeof json.result?.data?.exp === 'number' ? json.result.data.exp : null;
  const iat = typeof payload.iat === 'number' ? payload.iat : null;
  const userId = typeof json.result?.data?.userID === 'number' ? json.result.data.userID : null;

  return {
    token,
    expiresAt: exp ? new Date(exp * 1000) : new Date(Date.now() + 5 * 60 * 1000),
    ttlSeconds: exp && iat ? exp - iat : null,
    userId,
  };
}

function timeoutSignal(timeoutMs: number) {
  return AbortSignal.timeout(timeoutMs);
}

export async function createWbLkReadSessionFromStorageState(
  storageStateText: string,
  options?: { timeoutMs?: number },
): Promise<WbLkReadSession> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const auth = extractAuthInputs(storageStateText);

  const authResponse = await fetch(WB_LK_AUTH_TOKEN_URL, {
    method: 'POST',
    headers: buildBaseHeaders(auth),
    body: JSON.stringify({ params: {}, jsonrpc: '2.0', id: `json-rpc_procifry_${Date.now()}` }),
    signal: timeoutSignal(timeoutMs),
  }).catch((error) => {
    throw new WbLkRefreshFlowError({
      code: 'auth_token_network_error',
      status: 'warning',
      rootVersion: auth.rootVersion,
      message: error instanceof Error ? error.message : 'WB auth/token network error.',
    });
  });

  const authText = await authResponse.text();
  if (!authResponse.ok) {
    throw new WbLkRefreshFlowError({
      code: 'auth_token_failed',
      status: authResponse.status === 401 || authResponse.status === 403 ? 'invalid' : 'warning',
      authHttpStatus: authResponse.status,
      rootVersion: auth.rootVersion,
      message: `WB auth/token вернул HTTP ${authResponse.status}.`,
    });
  }

  let parsedToken: ReturnType<typeof parseAuthTokenResponse>;
  try {
    parsedToken = parseAuthTokenResponse(authText);
  } catch (error) {
    if (error instanceof WbLkRefreshFlowError) {
      throw new WbLkRefreshFlowError({
        code: error.code,
        status: error.status,
        authHttpStatus: authResponse.status,
        rootVersion: auth.rootVersion,
        message: error.message,
      });
    }
    throw error;
  }

  const probeResponse = await fetch(WB_LK_READ_ONLY_PROBE_URL, {
    method: 'POST',
    headers: buildBaseHeaders(auth, parsedToken.token),
    body: JSON.stringify({
      groups: ['brand', 'subject'],
      filters: { brands: [], subjects: [], warehouses: [], kiz: 0, dimension: 0 },
    }),
    signal: timeoutSignal(timeoutMs),
  }).catch((error) => {
    throw new WbLkRefreshFlowError({
      code: 'read_only_probe_network_error',
      status: 'warning',
      authHttpStatus: authResponse.status,
      rootVersion: auth.rootVersion,
      message: error instanceof Error ? error.message : 'WB LK read-only probe network error.',
    });
  });

  await probeResponse.arrayBuffer().catch(() => null);
  if (!probeResponse.ok) {
    throw new WbLkRefreshFlowError({
      code: 'read_only_probe_failed',
      status: probeResponse.status === 401 || probeResponse.status === 403 ? 'invalid' : 'warning',
      authHttpStatus: authResponse.status,
      readOnlyHttpStatus: probeResponse.status,
      rootVersion: auth.rootVersion,
      message: `WB LK read-only probe вернул HTTP ${probeResponse.status}.`,
    });
  }

  return {
    accessToken: parsedToken.token,
    expiresAt: parsedToken.expiresAt,
    ttlSeconds: parsedToken.ttlSeconds,
    userId: parsedToken.userId,
    rootVersion: auth.rootVersion,
    readOnlyProbe: {
      endpoint: WB_LK_READ_ONLY_PROBE_URL,
      status: probeResponse.status,
    },
    headers: {
      authorizeV3: auth.authorizeV3,
      cookie: auth.cookieHeader,
    },
  };
}

export async function fetchWbLkReadOnlyJson<T>(
  session: WbLkReadSession,
  url: string,
  init?: {
    method?: 'GET' | 'POST';
    body?: unknown;
    timeoutMs?: number;
  },
): Promise<T> {
  const auth: WbLkAuthInputs = {
    authorizeV3: session.headers.authorizeV3,
    cookieHeader: session.headers.cookie,
    rootVersion: session.rootVersion,
  };
  const response = await fetch(url, {
    method: init?.method ?? 'GET',
    headers: buildBaseHeaders(auth, session.accessToken),
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    signal: timeoutSignal(init?.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new WbLkRefreshFlowError({
      code: 'read_only_request_failed',
      status: response.status === 401 || response.status === 403 ? 'invalid' : 'warning',
      readOnlyHttpStatus: response.status,
      rootVersion: session.rootVersion,
      message: `WB LK read-only request вернул HTTP ${response.status}.`,
    });
  }
  return await response.json() as T;
}

async function persistTenantFlowStatus(
  tenantId: string,
  status: 'healthy' | 'warning' | 'invalid',
  message: string | null,
  checkedAt: Date,
) {
  await db.update(tenants)
    .set({
      wbLkSessionStatus: status,
      wbLkSessionCheckedAt: checkedAt,
      wbLkSessionError: message,
    })
    .where(eq(tenants.id, tenantId));
}

function toFailureResult(
  tenantId: string,
  checkedAt: Date,
  error: unknown,
): WbLkRefreshFlowCheckResult {
  if (error instanceof WbLkRefreshFlowError) {
    return {
      tenantId,
      status: error.status,
      ok: false,
      checkedAt: checkedAt.toISOString(),
      code: error.code,
      message: error.message,
      rootVersion: error.rootVersion,
      tokenTtlSeconds: null,
      tokenExpiresAt: null,
      authHttpStatus: error.authHttpStatus,
      readOnlyHttpStatus: error.readOnlyHttpStatus,
    };
  }

  return {
    tenantId,
    status: 'warning',
    ok: false,
    checkedAt: checkedAt.toISOString(),
    code: 'unknown_error',
    message: error instanceof Error ? error.message : 'WB LK refresh-flow failed.',
    rootVersion: null,
    tokenTtlSeconds: null,
    tokenExpiresAt: null,
    authHttpStatus: null,
    readOnlyHttpStatus: null,
  };
}

export async function checkTenantWbLkRefreshFlow(
  tenantId: string,
  options?: { persistHealth?: boolean; timeoutMs?: number },
): Promise<WbLkRefreshFlowCheckResult> {
  const checkedAt = new Date();
  const [tenant] = await db.select({ storage: tenants.wbLkStorageState }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);

  if (!tenant?.storage) {
    const result: WbLkRefreshFlowCheckResult = {
      tenantId,
      status: 'invalid',
      ok: false,
      checkedAt: checkedAt.toISOString(),
      code: 'missing_storage_state',
      message: 'WB ЛК storageState не сохранён.',
      rootVersion: null,
      tokenTtlSeconds: null,
      tokenExpiresAt: null,
      authHttpStatus: null,
      readOnlyHttpStatus: null,
    };
    if (options?.persistHealth) {
      await persistTenantFlowStatus(tenantId, result.status, result.message, checkedAt);
    }
    return result;
  }

  let storageStateText: string;
  try {
    storageStateText = decrypt(tenant.storage);
  } catch (error) {
    const result = toFailureResult(
      tenantId,
      checkedAt,
      new WbLkRefreshFlowError({
        code: 'storage_decrypt_failed',
        status: 'invalid',
        message: error instanceof Error ? error.message : 'WB ЛК storageState не удалось расшифровать.',
      }),
    );
    if (options?.persistHealth) {
      await persistTenantFlowStatus(tenantId, result.status, result.message, checkedAt);
    }
    return result;
  }

  try {
    const session = await createWbLkReadSessionFromStorageState(storageStateText, { timeoutMs: options?.timeoutMs });
    const result: WbLkRefreshFlowCheckResult = {
      tenantId,
      status: 'healthy',
      ok: true,
      checkedAt: checkedAt.toISOString(),
      code: 'ok',
      message: 'WB LK refresh-flow OK: auth/token и read-only probe прошли.',
      rootVersion: session.rootVersion,
      tokenTtlSeconds: session.ttlSeconds,
      tokenExpiresAt: session.expiresAt.toISOString(),
      authHttpStatus: 200,
      readOnlyHttpStatus: session.readOnlyProbe.status,
    };
    if (options?.persistHealth) {
      await persistTenantFlowStatus(tenantId, result.status, null, checkedAt);
    }
    return result;
  } catch (error) {
    const result = toFailureResult(tenantId, checkedAt, error);
    if (options?.persistHealth) {
      await persistTenantFlowStatus(tenantId, result.status, result.message, checkedAt);
    }
    return result;
  }
}
