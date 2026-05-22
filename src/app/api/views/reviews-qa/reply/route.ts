import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { apiRoute } from '@/lib/api-response';
import { withIdempotencyKey } from '@/lib/idempotency';
import { withRateLimit } from '@/lib/rate-limit';
import { db } from '@/lib/db';
import { tenants } from '@/lib/db/schema';
import { requireTenantMatchesActive } from '@/lib/auth/tenant-access';
import { generateReplyWithYandexGpt } from '@/server/reviews-qa/yandex-gpt';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const replyRequestSchema = z.object({
  tenantId: z.string().min(1),
  itemType: z.enum(['review', 'question']),
  sourceText: z.string().trim().min(2).max(8_000),
  tone: z.enum(['friendly', 'neutral', 'formal']).default('friendly'),
  rating: z.number().min(1).max(5).optional().nullable(),
  productName: z.string().trim().max(255).optional().nullable(),
  brandName: z.string().trim().max(255).optional().nullable(),
  customerName: z.string().trim().max(255).optional().nullable(),
});

function normalizeBrandName(value: string | null | undefined): string | null {
  const normalized = (value ?? '').replace(/\s+/g, ' ').trim();
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

export const POST = withRateLimit(withIdempotencyKey(apiRoute(async (request: Request) => {
  const body = await request.json();
  const payload = replyRequestSchema.parse(body);

  await requireTenantMatchesActive(payload.tenantId, ['owner', 'admin']);

  const [tenant] = await db
    .select({
      name: tenants.name,
      shopName: tenants.shopName,
    })
    .from(tenants)
    .where(eq(tenants.id, payload.tenantId))
    .limit(1);

  const brandFromPayload = normalizeBrandName(payload.brandName);
  const brandFromTenantShop = normalizeBrandName(tenant?.shopName ?? null);
  const brandFromTenantName = normalizeBrandName(tenant?.name ?? null);
  const brandName = brandFromPayload ?? brandFromTenantShop ?? brandFromTenantName ?? null;

  const reply = await generateReplyWithYandexGpt({
    tenantId: payload.tenantId,
    itemType: payload.itemType,
    sourceText: payload.sourceText,
    tone: payload.tone,
    rating: payload.rating ?? null,
    productName: payload.productName ?? null,
    brandName,
    customerName: payload.customerName ?? null,
  });

  return NextResponse.json({
    ok: true,
    reply: reply.reply,
    cacheHit: reply.cacheHit,
  });
})), { per: 'tenant', limit: 20, window: 60 });
