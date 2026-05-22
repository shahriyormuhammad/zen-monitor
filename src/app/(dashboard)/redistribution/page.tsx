import { redirect } from 'next/navigation';

import { readActiveTenantCookie } from '@/lib/auth/tenant-access';

import { RedistributionPageClient } from './RedistributionPageClient';

export default async function RedistributionPage() {
  const tenantId = await readActiveTenantCookie();
  if (!tenantId) redirect('/settings');
  return <RedistributionPageClient tenantId={tenantId} />;
}
