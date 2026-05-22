import { and, eq, ne } from 'drizzle-orm';

import { db } from '@/lib/db';
import { tenants } from '@/lib/db/schema';
import { generateReplyWithYandexGpt } from '@/server/reviews-qa/yandex-gpt';
import { fetchWbReviewsQaItems, publishWbReply } from '@/server/reviews-qa/wb-feedback';

type AutoReplyTone = 'friendly' | 'neutral' | 'formal';

type TenantAutoReplyResult = {
  tenantId: string;
  tenantName: string;
  tone: AutoReplyTone;
  queueSize: number;
  attempted: number;
  replied: number;
  cacheHits: number;
  failed: number;
  skippedDueToLock: boolean;
  errors: string[];
};

const AUTO_REPLY_BATCH_SIZE = (() => {
  const parsed = Number.parseInt(process.env.REVIEWS_QA_AUTO_BATCH_SIZE ?? '15', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 15;
  }
  return Math.min(50, parsed);
})();

function resolveAutoReplyTone(): AutoReplyTone {
  const raw = (process.env.REVIEWS_QA_AUTO_TONE ?? 'friendly').trim().toLowerCase();
  if (raw === 'neutral') {
    return 'neutral';
  }
  if (raw === 'formal') {
    return 'formal';
  }
  return 'friendly';
}

function summarizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return 'Unknown error';
  }
}

const tenantLocks = new Set<string>();

export async function runReviewsQaAutoReplyForTenant(tenantId: string, tenantName: string): Promise<TenantAutoReplyResult> {
  if (tenantLocks.has(tenantId)) {
    return {
      tenantId,
      tenantName,
      tone: resolveAutoReplyTone(),
      queueSize: 0,
      attempted: 0,
      replied: 0,
      cacheHits: 0,
      failed: 0,
      skippedDueToLock: true,
      errors: [],
    };
  }

  tenantLocks.add(tenantId);

  try {
    const tone = resolveAutoReplyTone();
    const items = await fetchWbReviewsQaItems({
      tenantId,
      kind: 'reviews',
      isAnswered: false,
      take: AUTO_REPLY_BATCH_SIZE,
      skip: 0,
    });

    let attempted = 0;
    let replied = 0;
    let cacheHits = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const item of items) {
      attempted += 1;

      try {
        const generated = await generateReplyWithYandexGpt({
          tenantId,
          itemType: 'review',
          sourceText: item.text,
          tone,
          rating: item.rating,
          productName: item.productName,
          brandName: item.brandName,
          customerName: item.userName,
        });

        await publishWbReply({
          tenantId,
          itemType: 'review',
          itemId: item.id,
          replyText: generated.reply,
        });

        replied += 1;
        if (generated.cacheHit) {
          cacheHits += 1;
        }
      } catch (error: unknown) {
        failed += 1;
        if (errors.length < 5) {
          errors.push(`review:${item.id} ${summarizeError(error)}`);
        }
      }
    }

    return {
      tenantId,
      tenantName,
      tone,
      queueSize: items.length,
      attempted,
      replied,
      cacheHits,
      failed,
      skippedDueToLock: false,
      errors,
    };
  } finally {
    tenantLocks.delete(tenantId);
  }
}

export async function runDueReviewsQaAutoReplies() {
  const activeTenants = await db
    .select({
      id: tenants.id,
      name: tenants.name,
    })
    .from(tenants)
    .where(and(
      eq(tenants.reviewsAutoReplyEnabled, true),
      ne(tenants.wbTokenHealthStatus, 'invalid'),
    ));

  const tenantsResults: TenantAutoReplyResult[] = [];

  for (const tenant of activeTenants) {
    tenantsResults.push(await runReviewsQaAutoReplyForTenant(tenant.id, tenant.name));
  }

  return {
    scannedTenants: activeTenants.length,
    skippedDueToLock: tenantsResults.filter((result) => result.skippedDueToLock).length,
    queuedReviews: tenantsResults.reduce((sum, result) => sum + result.queueSize, 0),
    attempted: tenantsResults.reduce((sum, result) => sum + result.attempted, 0),
    replied: tenantsResults.reduce((sum, result) => sum + result.replied, 0),
    cacheHits: tenantsResults.reduce((sum, result) => sum + result.cacheHits, 0),
    failed: tenantsResults.reduce((sum, result) => sum + result.failed, 0),
    tenants: tenantsResults,
  };
}
