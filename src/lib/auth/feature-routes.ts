import type { TenantFeature } from '@/lib/auth/feature-access';

export const DASHBOARD_ROUTE_FEATURES: Array<{ href: string; feature: TenantFeature }> = [
  { href: '/overview', feature: 'overview' },
  { href: '/signals', feature: 'signals' },
  { href: '/sales-plan', feature: 'salesPlan' },
  { href: '/costs', feature: 'costs' },
  { href: '/economics-v2', feature: 'economics' },
  { href: '/economics', feature: 'economics' },
  { href: '/finance', feature: 'finance' },
  { href: '/aosn', feature: 'aosn' },
  { href: '/advertising', feature: 'advertising' },
  { href: '/seo', feature: 'seo' },
  { href: '/stocks-v2', feature: 'stocks' },
  { href: '/dynamics', feature: 'dynamics' },
  { href: '/dynamics-lab', feature: 'dynamics' },
  { href: '/explorer', feature: 'explorer' },
  { href: '/redistribution', feature: 'redistribution' },
  { href: '/reviews-qa', feature: 'reviews' },
  { href: '/approvals', feature: 'approvals' },
  { href: '/settings', feature: 'settings' },
  { href: '/cabinets', feature: 'team' },
];

const API_ROUTE_FEATURES: Array<{ href: string; feature: TenantFeature }> = [
  { href: '/api/views/advertising', feature: 'advertising' },
  { href: '/api/views/seo', feature: 'seo' },
  { href: '/api/views/aosn', feature: 'aosn' },
  { href: '/api/views/approvals', feature: 'approvals' },
  { href: '/api/views/dashboard', feature: 'overview' },
  { href: '/api/views/dynamics', feature: 'dynamics' },
  { href: '/api/views/economics', feature: 'economics' },
  { href: '/api/views/economics-template', feature: 'economics' },
  { href: '/api/views/explorer', feature: 'explorer' },
  { href: '/api/views/kpi-drilldown', feature: 'overview' },
  { href: '/api/views/profit-report', feature: 'finance' },
  { href: '/api/views/redistribution', feature: 'redistribution' },
  { href: '/api/views/reviews-qa', feature: 'reviews' },
  { href: '/api/views/stocks-v2', feature: 'stocks' },
];

export function resolveFeatureForPath(pathname: string): TenantFeature | null {
  return [...DASHBOARD_ROUTE_FEATURES, ...API_ROUTE_FEATURES]
    .filter((route) => pathname === route.href || pathname.startsWith(`${route.href}/`))
    .sort((left, right) => right.href.length - left.href.length)[0]?.feature ?? null;
}
