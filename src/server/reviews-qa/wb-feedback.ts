import { eq } from 'drizzle-orm';

import { AppError } from '@/lib/auth/tenant-access';
import { db } from '@/lib/db';
import { tenants } from '@/lib/db/schema';
import { decryptIfNeeded } from '@/lib/encryption';
import { ensureWbApiResponseOk, fetchWithExponentialBackoff } from '@/lib/wb-api/client';

const WB_FEEDBACKS_BASE_URL = 'https://feedbacks-api.wildberries.ru';

export type ReviewsQaCollectionKind = 'reviews' | 'questions';
export type ReviewsQaItemType = 'review' | 'question';
export type ReviewsQaAnswerOutcome = 'approved' | 'rejected' | 'unknown';
export type ReviewsQaDashboardScope = '24h' | '7d' | 'filter';

export type ReviewsQaItem = {
  id: string;
  itemType: ReviewsQaItemType;
  text: string;
  answerText: string | null;
  isAnswered: boolean;
  answerOutcome: ReviewsQaAnswerOutcome;
  rating: number | null;
  createdAt: string | null;
  nmId: number | null;
  productName: string | null;
  brandName: string | null;
  userName: string | null;
};

export type FetchWbReviewsQaItemsParams = {
  tenantId: string;
  kind: ReviewsQaCollectionKind;
  isAnswered: boolean;
  take: number;
  skip: number;
};

export type ReviewsQaRatingDistribution = {
  five: number;
  four: number;
  three: number;
  two: number;
  one: number;
};

export type ReviewsQaDailySummary = {
  periodHours: number;
  processedReviews: number;
  sentToWb: number;
  approved: number;
  rejected: number;
  ratingDistribution: ReviewsQaRatingDistribution;
  exact: boolean;
};

export type ReviewsQaDashboardStats = {
  daily: ReviewsQaDailySummary;
  generatedAt: string;
};

export type FetchWbReviewsQaDashboardStatsParams = {
  scope?: ReviewsQaDashboardScope;
  filterFrom?: Date | null;
  filterTo?: Date | null;
};

export type PublishWbReplyParams = {
  tenantId: string;
  itemType: ReviewsQaItemType;
  itemId: string;
  replyText: string;
};

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'answered', 'done', 'processed']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'new', 'open', 'pending']);
const HOURS_IN_DAY = 24;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = HOURS_IN_DAY * HOUR_MS;
const DAILY_SUMMARY_PERIOD_HOURS = 24;
const WEEKLY_SUMMARY_PERIOD_HOURS = 7 * HOURS_IN_DAY;
const DAILY_SUMMARY_SCAN_TAKE = 100;
const DAILY_SUMMARY_MAX_PAGES = 30;
const WB_FEEDBACK_ANSWER_MIN_INTERVAL_MS = process.env.NODE_ENV === 'test'
  ? 0
  : Math.max(0, Number.parseInt(process.env.WB_FEEDBACK_ANSWER_MIN_INTERVAL_MS ?? '1500', 10) || 0);

let lastWbFeedbackAnswerAt = 0;
let wbFeedbackAnswerQueue: Promise<void> = Promise.resolve();

const wait = (ms: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, ms);
});

async function waitForWbFeedbackAnswerSlot() {
  if (WB_FEEDBACK_ANSWER_MIN_INTERVAL_MS <= 0) {
    return;
  }

  const queued = wbFeedbackAnswerQueue.catch(() => undefined).then(async () => {
    if (lastWbFeedbackAnswerAt > 0) {
      const elapsed = Date.now() - lastWbFeedbackAnswerAt;
      if (elapsed < WB_FEEDBACK_ANSWER_MIN_INTERVAL_MS) {
        await wait(WB_FEEDBACK_ANSWER_MIN_INTERVAL_MS - elapsed);
      }
    }

    lastWbFeedbackAnswerAt = Date.now();
  });

  wbFeedbackAnswerQueue = queued;
  await queued;
}

function toObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function getPathValue(input: unknown, path: string): unknown {
  const segments = path.split('.');
  let current: unknown = input;

  for (const segment of segments) {
    const currentObject = toObject(current);
    if (!currentObject) {
      return undefined;
    }
    current = currentObject[segment];
  }

  return current;
}

function firstNonEmptyString(input: unknown, paths: readonly string[]): string | null {
  for (const path of paths) {
    const value = getPathValue(input, path);
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }

  return null;
}

function firstNumber(input: unknown, paths: readonly string[]): number | null {
  for (const path of paths) {
    const value = getPathValue(input, path);
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return null;
}

function firstBoolean(input: unknown, paths: readonly string[]): boolean | null {
  for (const path of paths) {
    const value = getPathValue(input, path);
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value !== 0;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (TRUE_VALUES.has(normalized)) {
        return true;
      }
      if (FALSE_VALUES.has(normalized)) {
        return false;
      }
    }
  }

  return null;
}

function parseIsAnswered(input: unknown, answerText: string | null): boolean {
  const parsed = firstBoolean(input, [
    'isAnswered',
    'answered',
    'status',
    'state',
    'answer.isAnswered',
    'answer.exists',
  ]);

  if (parsed !== null) {
    return parsed;
  }

  return Boolean(answerText && answerText.trim().length > 0);
}

function resolveReviewAnswerOutcome(input: unknown, isAnswered: boolean): ReviewsQaAnswerOutcome {
  if (!isAnswered) {
    return 'unknown';
  }

  const rawStatus = firstNonEmptyString(input, [
    'answer.state',
    'answer.status',
    'answer.result',
    'answer.moderationStatus',
    'answerStatus',
    'answerState',
    'moderationStatus',
    'moderation.state',
  ]);

  if (!rawStatus) {
    return 'approved';
  }

  const normalized = rawStatus.trim().toLowerCase();
  if (/(reject|declin|denied|blocked|ban|fail|error|отклон|заблок|ошиб)/i.test(normalized)) {
    return 'rejected';
  }
  if (/(approv|accept|publish|success|applied|done|одобр|принят|опублик)/i.test(normalized)) {
    return 'approved';
  }

  return 'unknown';
}

function extractCollection(payload: unknown, kind: ReviewsQaCollectionKind): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  const candidates = kind === 'reviews'
    ? [
      'data.feedbacks',
      'data.data.feedbacks',
      'feedbacks',
      'data.items',
      'items',
    ]
    : [
      'data.questions',
      'data.data.questions',
      'questions',
      'data.items',
      'items',
    ];

  for (const path of candidates) {
    const value = getPathValue(payload, path);
    if (Array.isArray(value)) {
      return value;
    }
  }

  return [];
}

function toIsoDateOrNull(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toISOString();
}

function normalizeReview(item: unknown): ReviewsQaItem | null {
  const id = firstNonEmptyString(item, ['id', 'feedbackId', 'feedback_id', 'wbFeedbackId']);
  if (!id) {
    return null;
  }

  const directText = firstNonEmptyString(item, ['text', 'reviewText', 'content']);
  const pros = firstNonEmptyString(item, ['pros']);
  const cons = firstNonEmptyString(item, ['cons']);

  const synthesizedText = [
    pros ? `Плюсы: ${pros}` : null,
    cons ? `Минусы: ${cons}` : null,
  ].filter((value): value is string => Boolean(value)).join('\n');

  const answerText = firstNonEmptyString(item, ['answer.text', 'answerText', 'answer']);
  const isAnswered = parseIsAnswered(item, answerText);

  return {
    id,
    itemType: 'review',
    text: directText ?? (synthesizedText.length > 0 ? synthesizedText : 'Отзыв без текста'),
    answerText,
    isAnswered,
    answerOutcome: resolveReviewAnswerOutcome(item, isAnswered),
    rating: firstNumber(item, ['productValuation', 'valuation', 'rating']),
    createdAt: toIsoDateOrNull(firstNonEmptyString(item, ['createdDate', 'createdAt', 'date', 'updatedAt'])),
    nmId: firstNumber(item, ['nmId', 'productDetails.nmId', 'imtId']),
    productName: firstNonEmptyString(item, ['productName', 'subjectName', 'imtName', 'productDetails.productName']),
    brandName: firstNonEmptyString(item, ['brandName', 'brand', 'productDetails.brandName', 'productDetails.brand', 'product.brand']),
    userName: firstNonEmptyString(item, ['userName', 'user.name', 'wbUserName']),
  };
}

function normalizeQuestion(item: unknown): ReviewsQaItem | null {
  const id = firstNonEmptyString(item, ['id', 'questionId', 'question_id']);
  if (!id) {
    return null;
  }

  const answerText = firstNonEmptyString(item, ['answer.text', 'answerText', 'answer']);

  return {
    id,
    itemType: 'question',
    text: firstNonEmptyString(item, ['text', 'questionText', 'question', 'content']) ?? 'Вопрос без текста',
    answerText,
    isAnswered: parseIsAnswered(item, answerText),
    answerOutcome: 'unknown',
    rating: null,
    createdAt: toIsoDateOrNull(firstNonEmptyString(item, ['createdDate', 'createdAt', 'date', 'updatedAt'])),
    nmId: firstNumber(item, ['nmId', 'productDetails.nmId', 'imtId']),
    productName: firstNonEmptyString(item, ['productName', 'subjectName', 'imtName', 'productDetails.productName']),
    brandName: firstNonEmptyString(item, ['brandName', 'brand', 'productDetails.brandName', 'productDetails.brand', 'product.brand']),
    userName: firstNonEmptyString(item, ['userName', 'user.name']),
  };
}

function buildWbHeaders(token: string): HeadersInit {
  return {
    Authorization: token,
    'Content-Type': 'application/json',
  };
}

async function getTenantWbApiToken(tenantId: string): Promise<string> {
  const [tenant] = await db
    .select({ wbApiToken: tenants.wbApiToken })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  if (!tenant) {
    throw new AppError('Tenant not found', 404);
  }

  const token = decryptIfNeeded(tenant.wbApiToken ?? '').trim();
  if (!token) {
    throw new AppError('Для кабинета не сохранён WB API token. Добавьте токен в настройках.', 400);
  }

  return token;
}

async function readResponseText(response: Response): Promise<string> {
  try {
    const text = (await response.text()).trim();
    if (!text) {
      return '';
    }
    return text.length > 400 ? `${text.slice(0, 400)}...` : text;
  } catch {
    return '';
  }
}

async function fetchWbCollectionPayload(
  token: string,
  kind: ReviewsQaCollectionKind,
  isAnswered: boolean,
  take: number,
  skip: number,
): Promise<unknown> {
  const endpoint = kind === 'reviews' ? '/api/v1/feedbacks' : '/api/v1/questions';
  const url = new URL(endpoint, WB_FEEDBACKS_BASE_URL);
  url.searchParams.set('isAnswered', String(isAnswered));
  url.searchParams.set('take', String(take));
  url.searchParams.set('skip', String(skip));

  const response = await fetchWithExponentialBackoff(
    url.toString(),
    {
      method: 'GET',
      headers: buildWbHeaders(token),
    },
    {
      operation: `WB ${kind} list`,
      timeoutMs: 30_000,
    },
  );

  await ensureWbApiResponseOk(`WB ${kind} list`, response);
  return response.json();
}

function toTimestampOrNull(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  return timestamp;
}

function toUtcDayStartTimestamp(value: Date): number {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

function resolveDashboardWindow(
  params: FetchWbReviewsQaDashboardStatsParams | undefined,
): { periodHours: number; sinceTimestamp: number; untilExclusiveTimestamp: number } {
  const nowTimestamp = Date.now();
  const scope = params?.scope ?? '24h';

  if (scope === '7d') {
    return {
      periodHours: WEEKLY_SUMMARY_PERIOD_HOURS,
      sinceTimestamp: nowTimestamp - (WEEKLY_SUMMARY_PERIOD_HOURS * HOUR_MS),
      untilExclusiveTimestamp: nowTimestamp,
    };
  }

  if (scope === 'filter' && params?.filterFrom instanceof Date && params.filterTo instanceof Date) {
    const fromTimestamp = toUtcDayStartTimestamp(params.filterFrom);
    const toTimestamp = toUtcDayStartTimestamp(params.filterTo);
    if (Number.isFinite(fromTimestamp) && Number.isFinite(toTimestamp) && toTimestamp >= fromTimestamp) {
      const untilExclusiveTimestamp = toTimestamp + DAY_MS;
      return {
        periodHours: Math.max(1, Math.round((untilExclusiveTimestamp - fromTimestamp) / HOUR_MS)),
        sinceTimestamp: fromTimestamp,
        untilExclusiveTimestamp,
      };
    }
  }

  return {
    periodHours: DAILY_SUMMARY_PERIOD_HOURS,
    sinceTimestamp: nowTimestamp - (DAILY_SUMMARY_PERIOD_HOURS * HOUR_MS),
    untilExclusiveTimestamp: nowTimestamp,
  };
}

async function fetchRecentReviewsByAnswered(
  token: string,
  isAnswered: boolean,
  sinceTimestamp: number,
  untilExclusiveTimestamp: number,
): Promise<{ items: ReviewsQaItem[]; exact: boolean }> {
  const items: ReviewsQaItem[] = [];
  let exact = true;

  for (let page = 0; page < DAILY_SUMMARY_MAX_PAGES; page += 1) {
    const payload = await fetchWbCollectionPayload(
      token,
      'reviews',
      isAnswered,
      DAILY_SUMMARY_SCAN_TAKE,
      page * DAILY_SUMMARY_SCAN_TAKE,
    );

    const pageItems = extractCollection(payload, 'reviews')
      .map((item) => normalizeReview(item))
      .filter((item): item is ReviewsQaItem => Boolean(item));

    if (pageItems.length === 0) {
      break;
    }

    let hasRowsWithKnownDate = false;
    let hasRowsWithUnknownDate = false;
    let oldestKnownTimestamp = Number.POSITIVE_INFINITY;

    for (const item of pageItems) {
      const createdAtTimestamp = toTimestampOrNull(item.createdAt);
      if (createdAtTimestamp === null) {
        hasRowsWithUnknownDate = true;
        continue;
      }

      hasRowsWithKnownDate = true;
      oldestKnownTimestamp = Math.min(oldestKnownTimestamp, createdAtTimestamp);
      if (createdAtTimestamp >= sinceTimestamp && createdAtTimestamp < untilExclusiveTimestamp) {
        items.push(item);
      }
    }

    if (hasRowsWithUnknownDate) {
      exact = false;
    }

    if (pageItems.length < DAILY_SUMMARY_SCAN_TAKE) {
      break;
    }

    if (
      hasRowsWithKnownDate
      && !hasRowsWithUnknownDate
      && Number.isFinite(oldestKnownTimestamp)
      && oldestKnownTimestamp < sinceTimestamp
    ) {
      break;
    }

    if (page === DAILY_SUMMARY_MAX_PAGES - 1) {
      exact = false;
    }
  }

  return { items, exact };
}

function buildDailyRatingDistribution(items: ReviewsQaItem[]): ReviewsQaRatingDistribution {
  const distribution: ReviewsQaRatingDistribution = {
    five: 0,
    four: 0,
    three: 0,
    two: 0,
    one: 0,
  };

  for (const item of items) {
    if (typeof item.rating !== 'number' || !Number.isFinite(item.rating)) {
      continue;
    }

    const rating = Math.round(item.rating);
    if (rating === 5) {
      distribution.five += 1;
    } else if (rating === 4) {
      distribution.four += 1;
    } else if (rating === 3) {
      distribution.three += 1;
    } else if (rating === 2) {
      distribution.two += 1;
    } else if (rating === 1) {
      distribution.one += 1;
    }
  }

  return distribution;
}

export async function fetchWbReviewsQaItems(params: FetchWbReviewsQaItemsParams): Promise<ReviewsQaItem[]> {
  const token = await getTenantWbApiToken(params.tenantId);
  const payload = await fetchWbCollectionPayload(
    token,
    params.kind,
    params.isAnswered,
    params.take,
    params.skip,
  );

  const rawItems = extractCollection(payload, params.kind);
  const normalized = rawItems
    .map((item) => (params.kind === 'reviews' ? normalizeReview(item) : normalizeQuestion(item)))
    .filter((item): item is ReviewsQaItem => Boolean(item));

  return normalized;
}

export async function fetchWbReviewsQaDashboardStats(
  tenantId: string,
  params?: FetchWbReviewsQaDashboardStatsParams,
): Promise<ReviewsQaDashboardStats> {
  const token = await getTenantWbApiToken(tenantId);
  const window = resolveDashboardWindow(params);

  const [answeredRecent, pendingRecent] = await Promise.all([
    fetchRecentReviewsByAnswered(token, true, window.sinceTimestamp, window.untilExclusiveTimestamp),
    fetchRecentReviewsByAnswered(token, false, window.sinceTimestamp, window.untilExclusiveTimestamp),
  ]);

  const processedReviews = answeredRecent.items.length + pendingRecent.items.length;
  const sentToWb = answeredRecent.items.length;
  const rejected = answeredRecent.items.filter((item) => item.answerOutcome === 'rejected').length;
  const approved = answeredRecent.items.filter((item) => item.answerOutcome === 'approved').length;
  const ratingDistribution = buildDailyRatingDistribution([
    ...answeredRecent.items,
    ...pendingRecent.items,
  ]);

  return {
    daily: {
      periodHours: window.periodHours,
      processedReviews,
      sentToWb,
      approved,
      rejected,
      ratingDistribution,
      exact: answeredRecent.exact && pendingRecent.exact,
    },
    generatedAt: new Date().toISOString(),
  };
}

export async function publishWbReply(params: PublishWbReplyParams): Promise<void> {
  const token = await getTenantWbApiToken(params.tenantId);

  if (params.itemType === 'review') {
    await waitForWbFeedbackAnswerSlot();
    const response = await fetchWithExponentialBackoff(
      `${WB_FEEDBACKS_BASE_URL}/api/v1/feedbacks/answer`,
      {
        method: 'POST',
        headers: buildWbHeaders(token),
        body: JSON.stringify({
          id: params.itemId,
          text: params.replyText,
        }),
      },
      {
        operation: 'WB review answer',
        timeoutMs: 30_000,
      },
    );

    await ensureWbApiResponseOk('WB review answer', response);
    return;
  }

  const attempts: Array<{ method: 'PATCH' | 'PUT' | 'POST'; path: string; body: Record<string, string> }> = [
    {
      method: 'PATCH',
      path: '/api/v1/questions',
      body: { id: params.itemId, text: params.replyText },
    },
    {
      method: 'PUT',
      path: '/api/v1/questions',
      body: { id: params.itemId, text: params.replyText },
    },
    {
      method: 'POST',
      path: '/api/v1/questions/answer',
      body: { id: params.itemId, text: params.replyText },
    },
    {
      method: 'PUT',
      path: '/api/v1/questions/answer',
      body: { id: params.itemId, text: params.replyText },
    },
    {
      method: 'POST',
      path: `/api/v1/questions/${encodeURIComponent(params.itemId)}/answer`,
      body: { text: params.replyText },
    },
    {
      method: 'PUT',
      path: `/api/v1/questions/${encodeURIComponent(params.itemId)}/answer`,
      body: { text: params.replyText },
    },
    {
      method: 'PATCH',
      path: `/api/v1/questions/${encodeURIComponent(params.itemId)}`,
      body: { text: params.replyText },
    },
    {
      method: 'PUT',
      path: `/api/v1/questions/${encodeURIComponent(params.itemId)}`,
      body: { text: params.replyText },
    },
  ];

  let lastError = 'WB API не принял ответ на вопрос';

  for (const attempt of attempts) {
    await waitForWbFeedbackAnswerSlot();
    const response = await fetchWithExponentialBackoff(
      `${WB_FEEDBACKS_BASE_URL}${attempt.path}`,
      {
        method: attempt.method,
        headers: buildWbHeaders(token),
        body: JSON.stringify(attempt.body),
      },
      {
        operation: `WB question answer ${attempt.method} ${attempt.path}`,
        timeoutMs: 30_000,
      },
    );

    if (response.ok) {
      return;
    }

    const detail = await readResponseText(response);
    lastError = `${attempt.method} ${attempt.path} -> ${response.status}${detail ? `: ${detail}` : ''}`;
  }

  throw new AppError(`WB API не принял ответ на вопрос: ${lastError}`, 502);
}
