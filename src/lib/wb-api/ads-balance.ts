import { fetchWithExponentialBackoff, ensureWbApiResponseOk } from './client';

const ADS_BASE = 'https://advert-api.wildberries.ru';

const getHeaders = (token: string) => ({
  Authorization: token,
  'Content-Type': 'application/json',
});

export interface WbAdBalance {
  realMoney: number;
  bonus: {
    sum: number;
    percent: number;
    expiresAt: string | null;
  };
}

export interface WbAdBudget {
  cash: number;
  netting: number;
  total: number;
}

interface WbBalanceRaw {
  balance?: number;
  net?: number;
  bonus?: number;
  cashbacks?: Array<{
    sum?: number;
    percent?: number;
    expiration_date?: string;
  }>;
}

interface WbBudgetRaw {
  cash?: number;
  netting?: number;
  total?: number;
}

export async function wbGetAdBalance(
  token: string,
  options?: {
    signal?: AbortSignal;
  },
): Promise<WbAdBalance> {
  const response = await fetchWithExponentialBackoff(
    `${ADS_BASE}/adv/v1/balance`,
    { headers: getHeaders(token) },
    { operation: 'getAdBalance', signal: options?.signal }
  );
  await ensureWbApiResponseOk('getAdBalance', response);
  const raw: WbBalanceRaw = await response.json();
  const cashback = Array.isArray(raw.cashbacks) ? raw.cashbacks[0] : undefined;

  return {
    realMoney: raw.balance ?? 0,
    bonus: {
      sum: raw.bonus ?? cashback?.sum ?? 0,
      percent: cashback?.percent ?? 0,
      expiresAt: cashback?.expiration_date ?? null,
    },
  };
}

export async function wbGetAdBudget(
  token: string,
  campaignId: number,
  options?: {
    signal?: AbortSignal;
  },
): Promise<WbAdBudget> {
  const params = new URLSearchParams({
    id: String(Math.trunc(campaignId)),
  });

  const response = await fetchWithExponentialBackoff(
    `${ADS_BASE}/adv/v1/budget?${params}`,
    { headers: getHeaders(token) },
    { operation: 'getAdBudget', signal: options?.signal, timeoutMs: 5_000 }
  );
  await ensureWbApiResponseOk('getAdBudget', response);
  const raw: WbBudgetRaw = await response.json();

  return {
    cash: Number(raw.cash ?? 0),
    netting: Number(raw.netting ?? 0),
    total: Number(raw.total ?? 0),
  };
}

export interface WbAdSpendPoint {
  date: string;
  spendRub: number;
}

interface WbUpdItem {
  updTime?: string;
  updSum?: number;
  advertId?: number;
  campName?: string;
  advertType?: number;
  paymentType?: string;
  advertStatus?: number;
}

export interface WbAdSpendHistoryEntry {
  updNum: number;
  updTime: string | null;
  updSum: number;
  advertId: number;
  campName: string | null;
  advertType: number | null;
  paymentType: string | null;
  advertStatus: number | null;
}

function normalizeHistoryEntry(item: WbUpdItem): WbAdSpendHistoryEntry | null {
  const advertId = Number(item.advertId ?? 0);
  const updSum = Number(item.updSum ?? 0);

  if (!Number.isFinite(advertId) || advertId <= 0 || !Number.isFinite(updSum)) {
    return null;
  }

  const updNum = Number((item as { updNum?: unknown }).updNum ?? 0);
  const advertType = Number(item.advertType);
  const advertStatus = Number(item.advertStatus);

  return {
    updNum: Number.isFinite(updNum) ? Math.trunc(updNum) : 0,
    updTime: typeof item.updTime === 'string' && item.updTime.trim().length > 0
      ? item.updTime
      : null,
    updSum,
    advertId,
    campName: typeof item.campName === 'string' && item.campName.trim().length > 0
      ? item.campName
      : null,
    advertType: Number.isFinite(advertType) ? Math.trunc(advertType) : null,
    paymentType: typeof item.paymentType === 'string' && item.paymentType.trim().length > 0
      ? item.paymentType
      : null,
    advertStatus: Number.isFinite(advertStatus) ? Math.trunc(advertStatus) : null,
  };
}

export async function wbGetAdSpendHistoryEntries(
  token: string,
  from: string,
  to: string,
  options?: {
    signal?: AbortSignal;
  },
): Promise<WbAdSpendHistoryEntry[]> {
  const params = new URLSearchParams({
    from,
    to,
  });

  const response = await fetchWithExponentialBackoff(
    `${ADS_BASE}/adv/v1/upd?${params}`,
    { headers: getHeaders(token) },
    { operation: 'getAdSpendHistory', signal: options?.signal }
  );
  await ensureWbApiResponseOk('getAdSpendHistory', response);
  const raw: WbUpdItem[] = await response.json();

  return raw
    .map((item) => normalizeHistoryEntry(item))
    .filter((item): item is WbAdSpendHistoryEntry => item !== null);
}

export async function wbGetAdSpendHistory(token: string, days: number): Promise<WbAdSpendPoint[]> {
  const dateTo = new Date();
  const dateFrom = new Date(dateTo.getTime() - days * 86_400_000);
  const entries = await wbGetAdSpendHistoryEntries(
    token,
    dateFrom.toISOString().slice(0, 10),
    dateTo.toISOString().slice(0, 10),
  );

  const byDay: Record<string, number> = {};
  for (const item of entries) {
    if (!item.updTime) continue;
    const day = item.updTime.slice(0, 10);
    byDay[day] = (byDay[day] ?? 0) + item.updSum;
  }

  return Object.entries(byDay)
    .map(([date, spendRub]) => ({ date, spendRub }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function wbDepositAdBudget(
  token: string,
  campaignId: number,
  amountRub: number
): Promise<void> {
  const params = new URLSearchParams({
    id: String(campaignId),
  });

  const response = await fetchWithExponentialBackoff(
    `${ADS_BASE}/adv/v1/budget/deposit?${params}`,
    {
      method: 'POST',
      headers: getHeaders(token),
      body: JSON.stringify({
        sum: Math.round(amountRub),
        type: 1,
        return: true,
      }),
    },
    { operation: 'depositAdBudget' }
  );
  await ensureWbApiResponseOk('depositAdBudget', response);
}
