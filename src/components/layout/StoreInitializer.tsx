'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useStore } from '@/store/useStore';
import { getInitialSessionData } from '@/app/actions/session';
import { userCanAccessFeature } from '@/lib/auth/feature-access';
import { resolveFeatureForPath } from '@/lib/auth/feature-routes';

export function StoreInitializer() {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { tenantId, setTenantId, setUserRole, setFeaturePermissions, setNeedsTenantSetup } = useStore();

  useEffect(() => {
    async function init() {
      const data = await getInitialSessionData();

      if (!data) {
        setTenantId(null);
        setUserRole(null);
        setFeaturePermissions(null);
        setNeedsTenantSetup(false);
        return;
      }

      if (tenantId !== null && tenantId !== data.tenantId) {
        queryClient.clear();
      }

      setTenantId(data.tenantId);
      setUserRole(data.role);
      setFeaturePermissions(data.featurePermissions);
      setNeedsTenantSetup(data.needsTenantSetup);

      if (data.needsTenantSetup && pathname !== '/settings' && pathname !== '/setup') {
        router.replace('/settings');
        return;
      }

      const feature = resolveFeatureForPath(pathname);
      if (
        feature
        && data.role
        && !userCanAccessFeature(data.role, data.featurePermissions, feature)
      ) {
        router.replace('/overview');
      }
    }
    init();
  }, [pathname, queryClient, router, setFeaturePermissions, setNeedsTenantSetup, setTenantId, setUserRole, tenantId]);

  return null;
}
