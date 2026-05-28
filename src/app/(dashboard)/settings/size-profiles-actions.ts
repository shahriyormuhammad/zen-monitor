'use server';

import { revalidatePath } from 'next/cache';

import { requireTenantFeatureAccess } from '@/lib/auth/tenant-access';
import {
  deleteProfile,
  detectArticleSizes,
  ensureProfilesForTenant,
  listArticleCatalog,
  listProfiles,
  rebuildProfilesForArticle,
  setProfileDefault,
  upsertProfile,
  type SizeProfile,
  type SizeProfileInput,
} from '@/server/size-profiles/service';
import { syncProductSizes, type ProductSizesSyncSummary } from '@/server/size-profiles/sync';

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
  const sizes = await detectArticleSizes(tenantId, nmId);
  return sizes.map((s) => s.size);
}

/**
 * Pull size catalogue (tech_size + barcode) for every product from WB
 * Content API. After it runs, profiles get the barcodes baked in.
 */
export async function syncProductSizesAction(tenantId: string): Promise<ProductSizesSyncSummary> {
  await requireTenantFeatureAccess(tenantId, 'settings', ['owner', 'admin', 'manager']);
  const summary = await syncProductSizes(tenantId);
  revalidatePath('/settings');
  return summary;
}

/**
 * Wipe auto-generated profiles for one article and rebuild them from the
 * latest detected sizes/barcodes. Used by the "Пересоздать" button on each
 * article row when the user wants to re-pull a fresh template.
 */
export async function rebuildProfilesForArticleAction(
  tenantId: string,
  nmId: number,
  vendorCode: string,
): Promise<{ deleted: number; created: number }> {
  await requireTenantFeatureAccess(tenantId, 'settings', ['owner', 'admin', 'manager']);
  const result = await rebuildProfilesForArticle(tenantId, nmId, vendorCode);
  revalidatePath('/settings');
  revalidatePath('/supply');
  return result;
}
