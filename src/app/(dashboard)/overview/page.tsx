import { redirect } from 'next/navigation';
import { readActiveTenantCookie } from '@/lib/auth/tenant-access';
import { OverviewPageClient } from './OverviewPageClient';

export default async function OverviewPage() {
  const tenantId = await readActiveTenantCookie();
  if (!tenantId) redirect('/settings');
  return <OverviewPageClient tenantId={tenantId} />;
}
