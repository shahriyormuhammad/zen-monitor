import { redirect } from 'next/navigation';
import { readActiveTenantCookie } from '@/lib/auth/tenant-access';
import { CostingPageClient } from './CostingPageClient';

export default async function CostsPage() {
  const tenantId = await readActiveTenantCookie();
  if (!tenantId) redirect('/settings');
  return <CostingPageClient tenantId={tenantId} />;
}
