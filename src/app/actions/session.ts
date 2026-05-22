'use server';

import { createClient } from '@/lib/supabase/server';
import { syncActiveTenantForUser } from '@/lib/auth/user-bootstrap';
import {
  clearActiveTenantCookie,
  readActiveTenantCookie,
  setActiveTenantCookie,
} from '@/lib/auth/tenant-access';
import { getActivePlatformImpersonationSessionForUser } from '@/lib/auth/platform-impersonation-session';
import { ALL_TENANT_FEATURE_PERMISSIONS } from '@/lib/auth/feature-access';

export async function getInitialSessionData() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const impersonation = await getActivePlatformImpersonationSessionForUser(user.id);
  if (impersonation) {
    const currentCookie = await readActiveTenantCookie();
    if (currentCookie !== impersonation.tenantId) {
      await setActiveTenantCookie(impersonation.tenantId);
    }

    return {
      tenantId: impersonation.tenantId,
      role: 'owner' as const,
      featurePermissions: ALL_TENANT_FEATURE_PERMISSIONS,
      needsTenantSetup: false,
      isPlatformImpersonation: true,
      platformImpersonationSessionId: impersonation.id,
    };
  }

  const state = await syncActiveTenantForUser(user.id);

  // Keep the cookie in sync with the DB-resolved active tenant so that
  // API routes (which trust the cookie) and the client store agree.
  const currentCookie = await readActiveTenantCookie();
  if (state.tenantId && state.tenantId !== currentCookie) {
    await setActiveTenantCookie(state.tenantId);
  } else if (!state.tenantId && currentCookie) {
    await clearActiveTenantCookie();
  }

  return state;
}
