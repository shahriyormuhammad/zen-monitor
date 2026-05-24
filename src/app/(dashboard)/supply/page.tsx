import { redirect } from 'next/navigation';

import { readActiveTenantCookie } from '@/lib/auth/tenant-access';

import { SupplyPageClient } from './SupplyPageClient';

export default async function SupplyPage() {
  const tenantId = await readActiveTenantCookie();
  if (!tenantId) redirect('/settings');
  return <SupplyPageClient tenantId={tenantId} />;
}
