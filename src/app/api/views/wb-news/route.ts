import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { apiRoute } from '@/lib/api-response';
import { AppError, requireActiveTenant } from '@/lib/auth/tenant-access';
import { db, withTenantContext } from '@/lib/db';
import { tenants } from '@/lib/db/schema';
import { decryptIfNeeded } from '@/lib/encryption';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const WB_NEWS_URL = 'https://common-api.wildberries.ru/api/communications/v2/news';
const NEWS_LOOKBACK_DAYS = 90;
const NEWS_CACHE_TTL_MS = 5 * 60 * 1000;

type NormalizedNewsItem = {
  id: string;
  title: string;
  content: string;
  date: string | null;
  types: string[];
};

type NewsPayload = {
  items: NormalizedNewsItem[];
  fetchedAt: string;
  stale: boolean;
  source: string;
};

type CacheEntry = {
  expiresAt: number;
  payload: NewsPayload;
};

const newsCache = new Map<string, CacheEntry>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function getStringField(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = asString(record[key]);
    if (value) {
      return value;
    }
  }
  return '';
}

function getNewsItemsPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!isRecord(payload)) {
    return [];
  }

  if (Array.isArray(payload.data)) {
    return payload.data;
  }

  if (isRecord(payload.data) && Array.isArray(payload.data.news)) {
    return payload.data.news;
  }

  if (Array.isArray(payload.news)) {
    return payload.news;
  }

  return [];
}

function getTypeLabels(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (typeof item === 'string') {
        return item.trim();
      }
      if (isRecord(item)) {
        return asString(item.name) || asString(item.title);
      }
      return '';
    })
    .filter((label): label is string => label.length > 0);
}

function normalizeNewsPayload(payload: unknown): NormalizedNewsItem[] {
  return getNewsItemsPayload(payload)
    .map((item, index) => {
      if (!isRecord(item)) {
        return null;
      }

      const date = getStringField(item, ['date', 'createdAt', 'created_at', 'publicationDate']) || null;
      const title = getStringField(item, ['header', 'title', 'name']) || 'Новость WB';
      const content = getStringField(item, ['content', 'text', 'body', 'description']);
      const id = String(item.id ?? item.newsId ?? `${date ?? 'news'}-${index}`);

      return {
        id,
        title,
        content,
        date,
        types: getTypeLabels(item.types),
      };
    })
    .filter((item): item is NormalizedNewsItem => Boolean(item))
    .sort((left, right) => {
      const leftTime = left.date ? new Date(left.date).getTime() : 0;
      const rightTime = right.date ? new Date(right.date).getTime() : 0;
      return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
    })
    .slice(0, 30);
}

function getLookbackDate() {
  const date = new Date(Date.now() - NEWS_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

async function getTenantToken(tenantId: string) {
  const rows = await withTenantContext(db, tenantId, (tx) => (
    tx.select({ wbApiToken: tenants.wbApiToken })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1)
  ));

  const encryptedToken = rows[0]?.wbApiToken?.trim();
  if (!encryptedToken) {
    throw new AppError('Для кабинета не задан WB API токен.', 400);
  }

  return decryptIfNeeded(encryptedToken, tenantId).trim();
}

async function fetchWbNews(token: string) {
  const url = new URL(WB_NEWS_URL);
  url.searchParams.set('from', getLookbackDate());

  const response = await fetch(url, {
    cache: 'no-store',
    headers: {
      Authorization: token,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const status = response.status;
    throw new AppError(
      status === 429
        ? 'WB ограничил запросы к новостям. Показываем кеш, если он уже был загружен.'
        : `Новости WB не загрузились: WB вернул ${status}.`,
      status === 401 ? 401 : 502,
    );
  }

  return response.json() as Promise<unknown>;
}

export const GET = apiRoute(async (request: Request) => {
  const { tenantId } = await requireActiveTenant(request);
  const cached = newsCache.get(tenantId);
  const now = Date.now();

  if (cached && cached.expiresAt > now) {
    return NextResponse.json(cached.payload);
  }

  try {
    const token = await getTenantToken(tenantId);
    const payload = await fetchWbNews(token);
    const responsePayload: NewsPayload = {
      items: normalizeNewsPayload(payload),
      fetchedAt: new Date().toISOString(),
      stale: false,
      source: WB_NEWS_URL,
    };

    newsCache.set(tenantId, {
      expiresAt: now + NEWS_CACHE_TTL_MS,
      payload: responsePayload,
    });

    return NextResponse.json(responsePayload);
  } catch (error) {
    if (cached) {
      return NextResponse.json({
        ...cached.payload,
        stale: true,
      });
    }

    throw error;
  }
});
