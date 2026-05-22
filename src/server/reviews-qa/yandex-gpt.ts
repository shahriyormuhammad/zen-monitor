import { createHash } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

import { AppError } from '@/lib/auth/tenant-access';
import { ensureWbApiResponseOk, fetchWithExponentialBackoff } from '@/lib/wb-api/client';
import { logger } from '@/lib/logger';

type Tone = 'friendly' | 'neutral' | 'formal';

export type GenerateReplyParams = {
  tenantId: string;
  itemType: 'review' | 'question';
  sourceText: string;
  tone: Tone;
  rating?: number | null;
  productName?: string | null;
  brandName?: string | null;
  customerName?: string | null;
};

export type GenerateReplyResult = {
  reply: string;
  cacheHit: boolean;
};

const YANDEX_COMPLETION_URL = 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion';
const DEFAULT_YANDEX_MODEL = 'yandexgpt/latest';
const PROMPT_VERSION = 'reviews_qa_v3_brand_only_no_legal_name';
const CACHE_DIR = path.resolve(process.cwd(), 'output', 'reviews-qa-cache');
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 45;
const CACHE_MAX_ENTRIES_PER_TENANT = 5000;

type CacheEntry = {
  reply: string;
  createdAt: string;
  lastUsedAt: string;
  hits: number;
  promptVersion: string;
};

type TenantCacheState = {
  loaded: boolean;
  entries: Map<string, CacheEntry>;
};

const tenantCaches = new Map<string, TenantCacheState>();
const persistLocks = new Map<string, Promise<void>>();

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeForCache(value: string | null | undefined): string {
  return normalizeText(value).toLowerCase();
}

function sanitizeBrandName(value: string | null | undefined): string | null {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }

  const lower = normalized.toLowerCase();
  const hasLegalForm = /(^|\s)(ип|ooo|ооо|ao|ао|пао|зао)(\s|$)/i.test(normalized)
    || lower.includes('индивидуальный предприниматель')
    || lower.includes('общество с ограниченной ответственностью');
  if (hasLegalForm) {
    return null;
  }

  if (normalized.length < 2 || normalized.length > 80) {
    return null;
  }

  return normalized;
}

function sanitizeCustomerName(value: string | null | undefined): string | null {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }

  const firstToken = normalized.split(' ')[0] ?? '';
  const cleaned = firstToken.replace(/[^A-Za-zА-Яа-яЁё-]/g, '');
  if (cleaned.length < 2 || cleaned.length > 24) {
    return null;
  }

  return cleaned;
}

function sanitizeReply(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\*\*/g, '')
    .trim();
}

function resolveToneLabel(tone: Tone) {
  switch (tone) {
    case 'formal':
      return 'деловом и сдержанном';
    case 'neutral':
      return 'нейтральном';
    default:
      return 'дружелюбном';
  }
}

function buildPrompt(params: GenerateReplyParams) {
  const customerName = sanitizeCustomerName(params.customerName);
  const brandName = sanitizeBrandName(params.brandName);

  const contextParts: string[] = [];
  if (params.productName && params.productName.trim().length > 0) {
    contextParts.push(`Товар: ${params.productName.trim()}.`);
  }
  if (brandName) {
    contextParts.push(`Бренд продавца: ${brandName}.`);
  }
  if (customerName) {
    contextParts.push(`Имя клиента: ${customerName}.`);
  }
  if (params.itemType === 'review' && typeof params.rating === 'number' && Number.isFinite(params.rating)) {
    contextParts.push(`Оценка клиента: ${params.rating} из 5.`);
  }

  const context = contextParts.join(' ');
  const opening = params.itemType === 'review'
    ? 'Сгенерируй ответ продавца на отзыв клиента Wildberries.'
    : 'Сгенерируй ответ продавца на вопрос клиента Wildberries.';

  return [
    opening,
    `Пиши на русском в ${resolveToneLabel(params.tone)} тоне.`,
    customerName ? 'Начни ответ с естественного обращения по имени клиента.' : 'Обращайся к клиенту нейтрально и вежливо.',
    brandName ? 'Добавь бренд продавца 1 раз органично, без рекламных лозунгов.' : 'Пиши от лица продавца без выдуманных деталей.',
    'Никогда не упоминай юридическую форму продавца (ИП, ООО, АО, ПАО, ЗАО) и фамилию предпринимателя как бренд.',
    params.itemType === 'review'
      ? 'Если оценка 1-3, добавь эмпатию и предложи понятный следующий шаг. Если оценка 4-5, поблагодари и кратко усили позитив.'
      : 'Отвечай только на вопрос клиента. Если данных не хватает, попроси уточнение вместо выдумывания фактов.',
    'Ограничения: 2-4 предложения, до 420 символов, без markdown, без эмодзи, без вымышленных гарантий и без ссылок.',
    context,
    `Текст клиента: "${params.sourceText.trim()}"`,
  ].filter((part) => part.length > 0).join(' ');
}

function getYandexConfig() {
  const apiKey = process.env.YANDEX_GPT_API_KEY?.trim();
  const folderId = process.env.YANDEX_GPT_FOLDER_ID?.trim();
  const modelName = process.env.YANDEX_GPT_MODEL_NAME?.trim() || DEFAULT_YANDEX_MODEL;

  if (!apiKey || !folderId) {
    throw new AppError(
      'Yandex GPT не настроен. Укажите YANDEX_GPT_API_KEY и YANDEX_GPT_FOLDER_ID в переменных окружения.',
      503,
    );
  }

  return {
    apiKey,
    folderId,
    modelUri: `gpt://${folderId}/${modelName}`,
  };
}

function getTenantCacheState(tenantId: string): TenantCacheState {
  const existing = tenantCaches.get(tenantId);
  if (existing) {
    return existing;
  }

  const created: TenantCacheState = {
    loaded: false,
    entries: new Map<string, CacheEntry>(),
  };
  tenantCaches.set(tenantId, created);
  return created;
}

function getTenantCachePath(tenantId: string) {
  const sanitizedTenantId = tenantId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(CACHE_DIR, `${sanitizedTenantId}.json`);
}

function isCacheEntryExpired(entry: CacheEntry) {
  const createdAtMs = Date.parse(entry.createdAt);
  if (Number.isNaN(createdAtMs)) {
    return true;
  }

  return Date.now() - createdAtMs > CACHE_TTL_MS;
}

function pruneTenantCache(state: TenantCacheState) {
  for (const [key, entry] of state.entries) {
    if (isCacheEntryExpired(entry)) {
      state.entries.delete(key);
    }
  }

  if (state.entries.size <= CACHE_MAX_ENTRIES_PER_TENANT) {
    return;
  }

  const sortedByLastUsed = Array.from(state.entries.entries())
    .sort((a, b) => Date.parse(a[1].lastUsedAt) - Date.parse(b[1].lastUsedAt));
  const overflow = sortedByLastUsed.length - CACHE_MAX_ENTRIES_PER_TENANT;
  for (let i = 0; i < overflow; i += 1) {
    const entry = sortedByLastUsed[i];
    if (entry) {
      state.entries.delete(entry[0]);
    }
  }
}

async function ensureTenantCacheLoaded(tenantId: string) {
  const state = getTenantCacheState(tenantId);
  if (state.loaded) {
    return state;
  }

  await mkdir(CACHE_DIR, { recursive: true });
  const filePath = getTenantCachePath(tenantId);
  try {
    const raw = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, CacheEntry>;
    for (const [key, entry] of Object.entries(parsed)) {
      if (!entry || typeof entry.reply !== 'string' || typeof entry.createdAt !== 'string') {
        continue;
      }
      state.entries.set(key, {
        reply: entry.reply,
        createdAt: entry.createdAt,
        lastUsedAt: entry.lastUsedAt || entry.createdAt,
        hits: typeof entry.hits === 'number' && Number.isFinite(entry.hits) ? entry.hits : 1,
        promptVersion: typeof entry.promptVersion === 'string' ? entry.promptVersion : PROMPT_VERSION,
      });
    }
  } catch (error: unknown) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError?.code !== 'ENOENT') {
      logger.warn({ err: error }, '[Reviews QA Cache] failed to read cache file');
    }
  }

  pruneTenantCache(state);
  state.loaded = true;
  return state;
}

async function persistTenantCache(tenantId: string) {
  const state = getTenantCacheState(tenantId);
  const filePath = getTenantCachePath(tenantId);
  const payload = Object.fromEntries(state.entries.entries());

  const previousLock = persistLocks.get(tenantId) ?? Promise.resolve();
  const nextLock = previousLock
    .catch(() => undefined)
    .then(async () => {
      await mkdir(CACHE_DIR, { recursive: true });
      await writeFile(filePath, JSON.stringify(payload), 'utf-8');
    });

  persistLocks.set(tenantId, nextLock);
  await nextLock;
}

function buildCacheKey(params: GenerateReplyParams, modelUri: string) {
  const normalizedPayload = {
    promptVersion: PROMPT_VERSION,
    modelUri,
    tenantId: params.tenantId,
    itemType: params.itemType,
    tone: params.tone,
    rating: params.rating ?? null,
    sourceText: normalizeForCache(params.sourceText),
    productName: normalizeForCache(params.productName),
    brandName: normalizeForCache(params.brandName),
    customerName: normalizeForCache(params.customerName),
  };

  return createHash('sha256')
    .update(JSON.stringify(normalizedPayload), 'utf-8')
    .digest('hex');
}

function parseCompletionText(payload: unknown): string {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new AppError('Yandex GPT вернул некорректный payload.', 502);
  }

  const root = payload as Record<string, unknown>;
  const resultObj = root.result;
  if (!resultObj || typeof resultObj !== 'object' || Array.isArray(resultObj)) {
    throw new AppError('Yandex GPT вернул пустой ответ.', 502);
  }

  const alternatives = (resultObj as Record<string, unknown>).alternatives;
  if (!Array.isArray(alternatives) || alternatives.length === 0) {
    throw new AppError('Yandex GPT не вернул вариантов ответа.', 502);
  }

  const firstAlternative = alternatives[0];
  if (!firstAlternative || typeof firstAlternative !== 'object' || Array.isArray(firstAlternative)) {
    throw new AppError('Некорректный формат ответа Yandex GPT.', 502);
  }

  const messageObj = (firstAlternative as Record<string, unknown>).message;
  if (!messageObj || typeof messageObj !== 'object' || Array.isArray(messageObj)) {
    throw new AppError('Yandex GPT не вернул текст сообщения.', 502);
  }

  const text = (messageObj as Record<string, unknown>).text;
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new AppError('Yandex GPT вернул пустой текст ответа.', 502);
  }

  return sanitizeReply(text);
}

export async function generateReplyWithYandexGpt(params: GenerateReplyParams): Promise<GenerateReplyResult> {
  if (!params.tenantId || params.tenantId.trim().length === 0) {
    throw new AppError('Missing tenantId for Yandex GPT cache key.', 400);
  }

  const { apiKey, folderId, modelUri } = getYandexConfig();
  const cacheKey = buildCacheKey(params, modelUri);
  const cacheState = await ensureTenantCacheLoaded(params.tenantId);
  pruneTenantCache(cacheState);

  const nowIso = new Date().toISOString();
  const cachedEntry = cacheState.entries.get(cacheKey);
  if (cachedEntry) {
    cachedEntry.lastUsedAt = nowIso;
    cachedEntry.hits += 1;
    return {
      reply: cachedEntry.reply,
      cacheHit: true,
    };
  }

  const response = await fetchWithExponentialBackoff(
    YANDEX_COMPLETION_URL,
    {
      method: 'POST',
      headers: {
        Authorization: `Api-Key ${apiKey}`,
        'x-folder-id': folderId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        modelUri,
        completionOptions: {
          stream: false,
          temperature: params.tone === 'friendly' ? 0.7 : params.tone === 'formal' ? 0.45 : 0.55,
          maxTokens: 280,
        },
        messages: [
          {
            role: 'system',
            text: 'Ты senior-менеджер поддержки продавца Wildberries. Отвечай кратко, тепло и по делу, чтобы удержать клиента и сохранить доверие к бренду.',
          },
          {
            role: 'user',
            text: buildPrompt(params),
          },
        ],
      }),
    },
    {
      operation: 'Yandex GPT completion',
      timeoutMs: 30_000,
    },
  );

  await ensureWbApiResponseOk('Yandex GPT completion', response);
  const payload = await response.json();
  const reply = parseCompletionText(payload);

  cacheState.entries.set(cacheKey, {
    reply,
    createdAt: nowIso,
    lastUsedAt: nowIso,
    hits: 1,
    promptVersion: PROMPT_VERSION,
  });
  pruneTenantCache(cacheState);
  await persistTenantCache(params.tenantId);

  return {
    reply,
    cacheHit: false,
  };
}
