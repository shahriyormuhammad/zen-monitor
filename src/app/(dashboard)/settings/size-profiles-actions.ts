'use server';

import { revalidatePath } from 'next/cache';

import { requireTenantFeatureAccess } from '@/lib/auth/tenant-access';
import {
  deleteProfile,
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
};

export async function loadSizeProfilesSnapshot(tenantId: string): Promise<SizeProfilesSnapshot> {
  await requireTenantFeatureAccess(tenantId, 'settings');
  const [articles, profiles] = await Promise.all([
    listArticleCatalog(tenantId),
    listProfiles(tenantId),
  ]);
  return { articles, profiles };
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
