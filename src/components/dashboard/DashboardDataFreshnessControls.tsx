'use client';

import { usePathname } from 'next/navigation';
import { DataFreshnessBanner } from '@/components/dashboard/DataFreshnessBanner';
import { useStore } from '@/store/useStore';

const ROUTES_WITHOUT_DATE_CONTROLS = [
  '/approvals',
  '/costs',
  '/economics',
  '/economics-v2',
  '/reviews-qa',
  '/seo',
  '/settings',
  '/signals',
  '/stocks-v2',
] as const;

function routeMatches(pathname: string | null, route: string) {
  return pathname === route || Boolean(pathname?.startsWith(`${route}/`));
}

export function DashboardDataFreshnessControls() {
  const pathname = usePathname();
  const { tenantId, dateFrom, dateTo } = useStore();
  const showDateControls = !ROUTES_WITHOUT_DATE_CONTROLS.some((route) => routeMatches(pathname, route));

  if (!tenantId) {
    return null;
  }

  return (
    <div className="mb-3">
      <DataFreshnessBanner
        tenantId={tenantId}
        dateFrom={dateFrom}
        dateTo={dateTo}
        showDateControls={showDateControls}
        showSelectedRange={showDateControls}
      />
    </div>
  );
}
