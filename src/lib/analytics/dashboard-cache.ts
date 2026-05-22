import { unstable_cache, revalidateTag } from 'next/cache';

export const DASHBOARD_CACHE_TTL_SECONDS = 60;

export function getDashboardCacheTag(tenantId: string) {
  return `dashboard:${tenantId}`;
}

export function getDashboardDataTrustCacheTag(tenantId: string) {
  return `dashboard-data-trust:${tenantId}`;
}

export function invalidateDashboardCache(tenantId: string) {
  if (!tenantId) return;
  revalidateTag(getDashboardCacheTag(tenantId), 'default');
  revalidateTag(getDashboardDataTrustCacheTag(tenantId), 'default');
}

type AsyncFn<TArgs extends unknown[], TResult> = (...args: TArgs) => Promise<TResult>;

export function createTenantDashboardCache<TArgs extends unknown[], TResult>(
  keyPrefix: string,
  tagBuilder: (tenantId: string) => string,
  loader: (tenantId: string, ...args: TArgs) => Promise<TResult>,
): (tenantId: string, ...args: TArgs) => Promise<TResult> {
  const cachePerTenant = new Map<string, AsyncFn<TArgs, TResult>>();

  return (tenantId: string, ...args: TArgs) => {
    let cached = cachePerTenant.get(tenantId);
    if (!cached) {
      cached = unstable_cache(
        (...innerArgs: TArgs) => loader(tenantId, ...innerArgs),
        [keyPrefix, tenantId],
        {
          revalidate: DASHBOARD_CACHE_TTL_SECONDS,
          tags: [tagBuilder(tenantId)],
        },
      );
      cachePerTenant.set(tenantId, cached);
    }
    return cached(...args);
  };
}
