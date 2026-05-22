import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { and, eq, gte, lte, sql } from 'drizzle-orm';

import type { ReviewsQaCollectionKind, ReviewsQaItem } from '@/server/reviews-qa/wb-feedback';

type Options = {
  tenantId: string;
  from: string;
  to: string;
  kind: 'reviews' | 'questions' | 'all';
  answerStatus: 'answered' | 'not_answered' | 'all';
  take: number;
  maxPages: number;
  clearRange: boolean;
};

function loadEnv() {
  const cwd = process.cwd();
  for (const rel of ['.env.runtime', '.env.production', '.env']) {
    const full = path.join(cwd, rel);
    if (fs.existsSync(full)) {
      dotenv.config({ path: full, override: false });
    }
  }
}

function parseArgs(argv: string[]): Options {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }
    args.set(key, value);
    i += 1;
  }

  const tenantId = args.get('tenant-id');
  const from = args.get('from');
  const to = args.get('to');
  const kindRaw = args.get('kind') ?? 'all';
  const kind = kindRaw === 'reviews' || kindRaw === 'questions' || kindRaw === 'all' ? kindRaw : null;
  const answerRaw = args.get('answer-status') ?? 'all';
  const answerStatus = answerRaw === 'answered' || answerRaw === 'not_answered' || answerRaw === 'all' ? answerRaw : null;
  const take = Math.min(500, Math.max(1, Number.parseInt(args.get('take') ?? '250', 10) || 250));
  const maxPages = Math.min(200, Math.max(1, Number.parseInt(args.get('max-pages') ?? '40', 10) || 40));
  const clearRangeRaw = args.get('clear-range') ?? '0';
  const clearRange = clearRangeRaw === '1' || clearRangeRaw.toLowerCase() === 'true';

  if (!tenantId || !from || !to || !kind || !answerStatus) {
    throw new Error(
      'Usage: npx tsx scripts/backfill_wb_reviews_qa.ts --tenant-id UUID --from YYYY-MM-DD --to YYYY-MM-DD [--kind reviews|questions|all] [--answer-status answered|not_answered|all] [--take 250] [--max-pages 40] [--clear-range 1]',
    );
  }

  return { tenantId, from, to, kind, answerStatus, take, maxPages, clearRange };
}

function toTimestamp(value: string | null) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function toDate(value: string | null) {
  const timestamp = toTimestamp(value);
  return timestamp === null ? null : new Date(timestamp);
}

function inRange(item: ReviewsQaItem, fromTs: number, toTs: number) {
  const timestamp = toTimestamp(item.createdAt);
  return timestamp !== null && timestamp >= fromTs && timestamp <= toTs;
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

async function main() {
  loadEnv();
  const options = parseArgs(process.argv.slice(2));
  const [{ db, withTenantContext }, schema, reviewsQa] = await Promise.all([
    import('@/lib/db'),
    import('@/lib/db/schema'),
    import('@/server/reviews-qa/wb-feedback'),
  ]);

  const { tenants, wbFeedbackSnapshots } = schema;
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, options.tenantId)).limit(1);
  if (!tenant) {
    throw new Error(`Tenant not found: ${options.tenantId}`);
  }

  const fromTs = Date.parse(`${options.from}T00:00:00.000Z`);
  const toTs = Date.parse(`${options.to}T23:59:59.999Z`);
  if (!Number.isFinite(fromTs) || !Number.isFinite(toTs) || fromTs > toTs) {
    throw new Error('Invalid --from/--to range');
  }

  const kinds: ReviewsQaCollectionKind[] = options.kind === 'all' ? ['reviews', 'questions'] : [options.kind];
  const answeredStates = options.answerStatus === 'all'
    ? [false, true]
    : [options.answerStatus === 'answered'];

  console.log(
    `[reviews-qa-backfill] tenant=${tenant.id} name="${tenant.name}" range=${options.from}..${options.to} kind=${options.kind} answerStatus=${options.answerStatus}`,
  );

  if (options.clearRange) {
    await withTenantContext(db, tenant.id, async (tx) => {
      for (const kind of kinds) {
        await tx.delete(wbFeedbackSnapshots).where(and(
          eq(wbFeedbackSnapshots.tenantId, tenant.id),
          eq(wbFeedbackSnapshots.itemType, kind === 'reviews' ? 'review' : 'question'),
          gte(wbFeedbackSnapshots.createdAtWb, new Date(fromTs)),
          lte(wbFeedbackSnapshots.createdAtWb, new Date(toTs)),
        ));
      }
    });
    console.log('[reviews-qa-backfill] cleared_existing_range');
  }

  let totalFetched = 0;
  let totalSaved = 0;
  let totalRepeatedPages = 0;
  const sourceUpdatedAt = new Date();

  for (const kind of kinds) {
    for (const isAnswered of answeredStates) {
      const seenPageSignatures = new Set<string>();
      const selected = new Map<string, ReviewsQaItem>();

      for (let page = 0; page < options.maxPages; page += 1) {
        const skip = page * options.take;
        const pageItems = await reviewsQa.fetchWbReviewsQaItems({
          tenantId: tenant.id,
          kind,
          isAnswered,
          take: options.take,
          skip,
        });
        totalFetched += pageItems.length;

        if (pageItems.length === 0) {
          break;
        }

        const signature = pageItems.slice(0, 10).map((item) => item.id).join('|');
        if (signature && seenPageSignatures.has(signature)) {
          totalRepeatedPages += 1;
          break;
        }
        seenPageSignatures.add(signature);

        let oldest = Number.POSITIVE_INFINITY;
        let hasKnownDates = false;
        for (const item of pageItems) {
          const timestamp = toTimestamp(item.createdAt);
          if (timestamp !== null) {
            hasKnownDates = true;
            oldest = Math.min(oldest, timestamp);
          }
          if (inRange(item, fromTs, toTs)) {
            selected.set(item.id, item);
          }
        }

        if (pageItems.length < options.take) {
          break;
        }
        if (hasKnownDates && Number.isFinite(oldest) && oldest < fromTs) {
          break;
        }
      }

      const rows = Array.from(selected.values()).map((item) => ({
        tenantId: tenant.id,
        itemType: kind === 'reviews' ? 'review' : 'question',
        wbItemId: item.id,
        nmId: item.nmId,
        rating: item.rating,
        text: item.text,
        answerText: item.answerText,
        isAnswered: item.isAnswered,
        answerOutcome: item.answerOutcome,
        productName: item.productName,
        brandName: item.brandName,
        userName: item.userName,
        createdAtWb: toDate(item.createdAt),
        sourceUpdatedAt,
        payload: item as unknown as Record<string, unknown>,
      }));

      let batches = 0;
      await withTenantContext(db, tenant.id, async (tx) => {
        for (const chunk of chunkArray(rows, 500)) {
          batches += 1;
          await tx.insert(wbFeedbackSnapshots).values(chunk).onConflictDoUpdate({
            target: [
              wbFeedbackSnapshots.tenantId,
              wbFeedbackSnapshots.itemType,
              wbFeedbackSnapshots.wbItemId,
            ],
            set: {
              nmId: sql`EXCLUDED.nm_id`,
              rating: sql`EXCLUDED.rating`,
              text: sql`EXCLUDED.text`,
              answerText: sql`EXCLUDED.answer_text`,
              isAnswered: sql`EXCLUDED.is_answered`,
              answerOutcome: sql`EXCLUDED.answer_outcome`,
              productName: sql`EXCLUDED.product_name`,
              brandName: sql`EXCLUDED.brand_name`,
              userName: sql`EXCLUDED.user_name`,
              createdAtWb: sql`EXCLUDED.created_at_wb`,
              sourceUpdatedAt: sql`EXCLUDED.source_updated_at`,
              payload: sql`EXCLUDED.payload`,
              updatedAt: sql`NOW()`,
            },
          });
        }
      });

      totalSaved += rows.length;
      console.log(
        `[reviews-qa-backfill] kind=${kind} answered=${isAnswered} selected=${rows.length} batches=${batches}`,
      );
    }
  }

  console.log(
    `[reviews-qa-backfill] finished fetched=${totalFetched} saved=${totalSaved} repeated_pages=${totalRepeatedPages}`,
  );
}

main().catch((error) => {
  console.error('[reviews-qa-backfill] failed', error);
  process.exit(1);
});
