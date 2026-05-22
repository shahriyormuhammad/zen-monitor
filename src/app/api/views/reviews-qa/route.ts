import { NextResponse } from 'next/server';

import { apiRoute } from '@/lib/api-response';
import { requireActiveTenant } from '@/lib/auth/tenant-access';
import { fetchWbReviewsQaItems, ReviewsQaCollectionKind } from '@/server/reviews-qa/wb-feedback';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const COLLECTION_KINDS: readonly ReviewsQaCollectionKind[] = ['reviews', 'questions'];
const DEFAULT_TAKE = 30;
const MAX_TAKE = 100;

function parseCollectionKind(rawKind: string | null): ReviewsQaCollectionKind {
  if (rawKind && COLLECTION_KINDS.includes(rawKind as ReviewsQaCollectionKind)) {
    return rawKind as ReviewsQaCollectionKind;
  }
  return 'reviews';
}

function parseBooleanFlag(rawValue: string | null, fallback: boolean): boolean {
  if (!rawValue) {
    return fallback;
  }

  const normalized = rawValue.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
}

function parsePositiveInt(rawValue: string | null, fallback: number, min: number, max: number): number {
  if (!rawValue) {
    return fallback;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, parsed));
}

export const GET = apiRoute(async (request: Request) => {
  const { tenantId } = await requireActiveTenant(request);
  const { searchParams } = new URL(request.url);

  const kind = parseCollectionKind(searchParams.get('kind'));
  const isAnswered = parseBooleanFlag(searchParams.get('isAnswered'), false);
  const take = parsePositiveInt(searchParams.get('take'), DEFAULT_TAKE, 1, MAX_TAKE);
  const skip = parsePositiveInt(searchParams.get('skip'), 0, 0, 10_000);

  const items = await fetchWbReviewsQaItems({
    tenantId,
    kind,
    isAnswered,
    take,
    skip,
  });

  return NextResponse.json({
    kind,
    isAnswered,
    take,
    skip,
    count: items.length,
    items,
  });
});
