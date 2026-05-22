import { db, type DrizzleTransaction, withAdminContext } from '@/lib/db';
import { platformLeads } from '@/lib/db/schema';

function normalizeEmail(email: string | null | undefined) {
  const value = email?.trim().toLowerCase();
  return value || null;
}

function normalizeText(value: string | null | undefined, maxLength = 255) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

export type SignupLeadInput = {
  email: string;
  name?: string | null;
  phone?: string | null;
  userId?: string | null;
  source?: string | null;
  attribution?: Record<string, string>;
};

export async function recordSignupLead(input: SignupLeadInput) {
  const email = normalizeEmail(input.email);
  if (!email) return;

  const now = new Date();
  const name = normalizeText(input.name);
  const phone = normalizeText(input.phone, 64);
  const source = normalizeText(input.source, 120) ?? input.attribution?.source ?? 'site';

  await withAdminContext(db, async (tx) => {
    await tx.insert(platformLeads).values({
      email,
      name,
      phone,
      source,
      status: 'registered',
      userId: input.userId ?? null,
      metadata: input.attribution ?? {},
      lastActivityAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: platformLeads.email,
      set: {
        name,
        phone,
        source,
        status: 'registered',
        userId: input.userId ?? null,
        metadata: input.attribution ?? {},
        lastActivityAt: now,
        updatedAt: now,
      },
    });
  });
}

export async function markLeadTrialStarted(
  tx: DrizzleTransaction,
  input: {
    email?: string | null;
    userId: string;
    tenantId: string;
    selectedPlanCode: string;
  },
) {
  const email = normalizeEmail(input.email);
  if (!email) return;

  const now = new Date();
  await tx.insert(platformLeads).values({
    email,
    source: 'site',
    status: 'trialing',
    userId: input.userId,
    tenantId: input.tenantId,
    selectedPlanCode: input.selectedPlanCode,
    metadata: {},
    lastActivityAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: platformLeads.email,
    set: {
      status: 'trialing',
      userId: input.userId,
      tenantId: input.tenantId,
      selectedPlanCode: input.selectedPlanCode,
      lastActivityAt: now,
      updatedAt: now,
    },
  });
}

export async function markLeadSelectedPlan(
  email: string | null | undefined,
  selectedPlanCode: string,
) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return;
  const now = new Date();

  await withAdminContext(db, async (tx) => {
    await tx.insert(platformLeads).values({
      email: normalizedEmail,
      source: 'site',
      status: 'registered',
      selectedPlanCode,
      metadata: {},
      lastActivityAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: platformLeads.email,
      set: {
        selectedPlanCode,
        lastActivityAt: now,
        updatedAt: now,
      },
    });
  });
}
