import { and, eq } from 'drizzle-orm';

import { db, withTenantContext } from '@/lib/db';
import { advertisingDaypartingRules } from '@/lib/db/schema';

export type DaypartingTemplate = 'workday' | 'evening_weekend' | 'always_on' | 'custom';

// Templates: boolean[168] indexed as [dayOfWeek * 24 + hour], Mon=0
const TEMPLATES: Record<Exclude<DaypartingTemplate, 'custom'>, boolean[]> = {
  workday: buildTemplate((day, hour) => day < 5 && hour >= 9 && hour < 21),
  evening_weekend: buildTemplate((day, hour) => day >= 5 || (hour >= 18 && hour < 24)),
  always_on: buildTemplate(() => true),
};

function buildTemplate(fn: (day: number, hour: number) => boolean): boolean[] {
  return Array.from({ length: 168 }, (_, i) => fn(Math.floor(i / 24), i % 24));
}

export function getTemplateSchedule(template: Exclude<DaypartingTemplate, 'custom'>): boolean[] {
  return [...TEMPLATES[template]];
}

export async function getDaypartingRules(tenantId: string) {
  return withTenantContext(db, tenantId, (tx) => tx
    .select()
    .from(advertisingDaypartingRules)
    .where(and(eq(advertisingDaypartingRules.tenantId, tenantId))));
}

export async function upsertDaypartingRule(
  tenantId: string,
  campaignId: number,
  schedule: boolean[],
  templateName?: string,
  enabled = true,
) {
  if (schedule.length !== 168) {
    throw new Error('schedule must be exactly 168 booleans (7d × 24h)');
  }

  const [row] = await withTenantContext(db, tenantId, (tx) => tx
    .insert(advertisingDaypartingRules)
    .values({
      tenantId,
      campaignId,
      schedule,
      templateName: templateName ?? null,
      enabled,
    })
    .onConflictDoUpdate({
      target: [advertisingDaypartingRules.tenantId, advertisingDaypartingRules.campaignId],
      set: {
        schedule,
        templateName: templateName ?? null,
        enabled,
        updatedAt: new Date(),
      },
    })
    .returning());

  return row;
}

export async function deleteDaypartingRule(tenantId: string, campaignId: number) {
  await withTenantContext(db, tenantId, (tx) => tx
    .delete(advertisingDaypartingRules)
    .where(
      and(
        eq(advertisingDaypartingRules.tenantId, tenantId),
        eq(advertisingDaypartingRules.campaignId, campaignId),
      ),
    ));
}

/** Returns campaign IDs that should be PAUSED right now based on their schedule. */
export async function getCampaignsDueForPause(tenantId: string): Promise<number[]> {
  const now = new Date();
  // Moscow UTC+3 offset; WB operates on MSK
  const msk = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const day = (msk.getUTCDay() + 6) % 7; // Mon=0
  const hour = msk.getUTCHours();
  const slotIndex = day * 24 + hour;

  const rules = await withTenantContext(db, tenantId, (tx) => tx
    .select()
    .from(advertisingDaypartingRules)
    .where(
      and(
        eq(advertisingDaypartingRules.tenantId, tenantId),
        eq(advertisingDaypartingRules.enabled, true),
      ),
    ));

  return rules
    .filter((r) => r.schedule[slotIndex] === false)
    .map((r) => Number(r.campaignId));
}

/** Returns campaign IDs that should be RESUMED right now. */
export async function getCampaignsDueForResume(tenantId: string): Promise<number[]> {
  const now = new Date();
  const msk = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const day = (msk.getUTCDay() + 6) % 7;
  const hour = msk.getUTCHours();
  const slotIndex = day * 24 + hour;

  const rules = await withTenantContext(db, tenantId, (tx) => tx
    .select()
    .from(advertisingDaypartingRules)
    .where(
      and(
        eq(advertisingDaypartingRules.tenantId, tenantId),
        eq(advertisingDaypartingRules.enabled, true),
      ),
    ));

  return rules
    .filter((r) => r.schedule[slotIndex] === true)
    .map((r) => Number(r.campaignId));
}
