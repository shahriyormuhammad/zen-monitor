'use server';

import { revalidatePath } from 'next/cache';

import { requireTenantFeatureAccess } from '@/lib/auth/tenant-access';
import {
  deleteProfile,
  detectArticleSizes,
  ensureProfilesForTenant,
  listArticleCatalog,
  listProfiles,
  setProfileDefault,
  upsertProfile,
  type SizeProfile,
  type SizeProfileInput,
} from '@/server/size-profiles/service';

export type SizeProfilesSnapshot = {
  articles: Awaited<ReturnType<typeof listArticleCatalog>>;
  profiles: SizeProfile[];
  /** Stats from the auto-materialisation pass (Постал's ensureDefaultProfile). */
  ensured: { articlesProcessed: number; profilesCreated: number };
};

/**
 * Load the Settings → Ростовки snapshot.
 *
 * Side effect: idempotently materialises default + template-split profiles
 * for every article that has order history (Постал's ensureDefaultProfile
 * pattern). Wide-range articles (e.g. 37-45) get auto-split into separate
 * "37-41" and "41-45" profiles without the user lifting a finger.
 */
export async function loadSizeProfilesSnapshot(tenantId: string): Promise<SizeProfilesSnapshot> {
  await requireTenantFeatureAccess(tenantId, 'settings');

  // Materialisation is best-effort: never let it block the snapshot. If
  // detection or insert fails (e.g. transient DB issue, weird tech_size
  // values), the user should still see their existing profiles.
  let ensured = { articlesProcessed: 0, profilesCreated: 0 };
  try {
    ensured = await ensureProfilesForTenant(tenantId);
  } catch (error) {
    console.error('[size-profiles] ensureProfilesForTenant failed', error);
  }

  const [articles, profiles] = await Promise.all([
    listArticleCatalog(tenantId),
    listProfiles(tenantId),
  ]);
  return { articles, profiles, ensured };
}

export async function upsertSizeProfileAction(
  tenantId: string,
  input: SizeProfileInput,
): Promise<SizeProfile> {
  await requireTenantFeatureAccess(tenantId, 'settings', ['owner', 'admin', 'manager']);
  const profile = await upsertProfile(tenantId, input);
  revalidatePath('/settings');
  revalidatePath('/supply');
  return profile;
}

export async function deleteSizeProfileAction(tenantId: string, id: string): Promise<void> {
  await requireTenantFeatureAccess(tenantId, 'settings', ['owner', 'admin', 'manager']);
  await deleteProfile(tenantId, id);
  revalidatePath('/settings');
  revalidatePath('/supply');
}

export async function setSizeProfileDefaultAction(tenantId: string, id: string): Promise<void> {
  await requireTenantFeatureAccess(tenantId, 'settings', ['owner', 'admin', 'manager']);
  await setProfileDefault(tenantId, id);
  revalidatePath('/settings');
  revalidatePath('/supply');
}

export async function detectArticleSizesAction(tenantId: string, nmId: number): Promise<string[]> {
  await requireTenantFeatureAccess(tenantId, 'settings');
  return detectArticleSizes(tenantId, nmId);
}
