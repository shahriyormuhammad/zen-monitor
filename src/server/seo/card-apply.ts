import { eq } from 'drizzle-orm';

import { AppError } from '@/lib/errors';
import { db, withTenantContext } from '@/lib/db';
import { rawApiProductMetadata, tenants } from '@/lib/db/schema';
import { decryptIfNeeded } from '@/lib/encryption';
import { logger } from '@/lib/logger';
import { wbApi, type WbProductCard, type WbProductCardUpdatePayload } from '@/lib/wb-api';
import { validateSeoTextPatch } from '@/server/seo/card-audit';

export type ApplySeoCardPatchInput = {
  tenantId: string;
  actorId: string;
  nmId: number;
  title: string;
  description: string;
  signal?: AbortSignal;
};

export type ApplySeoCardPatchResult = {
  ok: true;
  nmId: number;
  title: string;
  description: string;
  updatedAt: string;
  wbSyncNotice: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeAppliedText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function copyIfPresent(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  key: string,
) {
  if (source[key] !== undefined && source[key] !== null) {
    target[key] = source[key];
  }
}

function sanitizeDimensions(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new AppError('WB не вернул размеры карточки. Без полного payload правку применять нельзя.', 409);
  }

  const dimensions: Record<string, unknown> = {};
  for (const key of ['length', 'width', 'height', 'weightBrutto']) {
    copyIfPresent(dimensions, value, key);
  }

  if (Object.keys(dimensions).length === 0) {
    throw new AppError('В карточке нет размеров упаковки. Сначала синхронизируйте карточку в WB.', 409);
  }

  return dimensions;
}

function sanitizeCharacteristics(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new AppError('WB не вернул характеристики карточки. Без полного payload правку применять нельзя.', 409);
  }

  return value
    .filter(isRecord)
    .map((item) => ({
      id: item.id,
      value: item.value,
    }))
    .filter((item) => typeof item.id === 'number' && Number.isFinite(item.id) && item.value !== undefined);
}

function sanitizeSizes(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new AppError('WB не вернул размеры/SKU карточки. Без полного payload правку применять нельзя.', 409);
  }

  const sizes = value
    .filter(isRecord)
    .map((item) => {
      const size: Record<string, unknown> = {};
      for (const key of ['chrtID', 'techSize', 'wbSize', 'skus']) {
        copyIfPresent(size, item, key);
      }
      return size;
    })
    .filter((item) => Object.keys(item).length > 0);

  if (sizes.length === 0) {
    throw new AppError('В карточке нет SKU. WB update без sizes может повредить карточку.', 409);
  }

  return sizes;
}

export function buildWbCardUpdatePayload(
  card: WbProductCard,
  patch: { title: string; description: string },
): WbProductCardUpdatePayload {
  const source = card as unknown as Record<string, unknown>;
  const vendorCode = typeof source.vendorCode === 'string' ? source.vendorCode.trim() : '';

  if (!Number.isFinite(card.nmID) || card.nmID <= 0) {
    throw new AppError('WB вернул карточку без корректного nmID.', 409);
  }
  if (!vendorCode) {
    throw new AppError('WB вернул карточку без vendorCode. Применение остановлено.', 409);
  }

  const payload: WbProductCardUpdatePayload = {
    nmID: card.nmID,
    vendorCode,
    title: patch.title,
    description: patch.description,
    dimensions: sanitizeDimensions(source.dimensions),
    characteristics: sanitizeCharacteristics(source.characteristics),
    sizes: sanitizeSizes(source.sizes),
  };

  if (typeof source.brand === 'string') {
    payload.brand = source.brand;
  }
  if (typeof source.kizMarked === 'boolean') {
    payload.kizMarked = source.kizMarked;
  }
  if (source.wholesale !== undefined && source.wholesale !== null) {
    payload.wholesale = source.wholesale;
  }

  return payload;
}

async function getTenantWbApiToken(tenantId: string): Promise<string> {
  const rows = await withTenantContext(db, tenantId, async (tx) => (
    tx.select({ wbApiToken: tenants.wbApiToken })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1)
  ));

  const token = decryptIfNeeded(rows[0]?.wbApiToken ?? '', tenantId).trim();
  if (!token) {
    throw new AppError('Для кабинета не сохранён WB API token. Добавьте токен в настройках.', 400);
  }

  return token;
}

async function updateLocalSeoMetadata(
  tenantId: string,
  card: WbProductCard,
  title: string,
  description: string,
  updatedAt: Date,
) {
  await withTenantContext(db, tenantId, async (tx) => {
    await tx.insert(rawApiProductMetadata).values({
      tenantId,
      nmId: card.nmID,
      title,
      description,
      photosCount: Array.isArray(card.photos) ? card.photos.length : 0,
      hasVideo: Boolean(card.video),
      characteristicsCount: Array.isArray(card.characteristics) ? card.characteristics.length : 0,
      updatedAt,
    }).onConflictDoUpdate({
      target: [rawApiProductMetadata.tenantId, rawApiProductMetadata.nmId],
      set: {
        title,
        description,
        photosCount: Array.isArray(card.photos) ? card.photos.length : 0,
        hasVideo: Boolean(card.video),
        characteristicsCount: Array.isArray(card.characteristics) ? card.characteristics.length : 0,
        updatedAt,
      },
    });
  });
}

export async function applySeoCardPatch(input: ApplySeoCardPatchInput): Promise<ApplySeoCardPatchResult> {
  const title = normalizeAppliedText(input.title);
  const description = normalizeAppliedText(input.description);
  const validationErrors = validateSeoTextPatch({ title, description });

  if (validationErrors.length > 0) {
    throw new AppError(validationErrors.join(' '), 400);
  }

  const token = await getTenantWbApiToken(input.tenantId);
  const card = await wbApi.getCardByNmId(token, input.nmId, { signal: input.signal });

  if (!card) {
    throw new AppError('Карточка не найдена в WB Content API.', 404);
  }

  const currentTitle = normalizeAppliedText(card.title ?? '');
  const currentDescription = normalizeAppliedText(card.description ?? '');
  if (currentTitle === title && currentDescription === description) {
    throw new AppError('Нет изменений для применения.', 400);
  }

  const payload = buildWbCardUpdatePayload(card, { title, description });
  await wbApi.updateProductCards(token, [payload], { signal: input.signal });

  const updatedAt = new Date();
  await updateLocalSeoMetadata(input.tenantId, card, title, description, updatedAt);

  logger.info({
    tenantId: input.tenantId,
    actorId: input.actorId,
    nmId: input.nmId,
    changedTitle: currentTitle !== title,
    changedDescription: currentDescription !== description,
  }, '[seo] applied WB card text patch');

  return {
    ok: true,
    nmId: input.nmId,
    title,
    description,
    updatedAt: updatedAt.toISOString(),
    wbSyncNotice: 'WB принял правку. Синхронизация и модерация карточки могут занять до 30 минут.',
  };
}
