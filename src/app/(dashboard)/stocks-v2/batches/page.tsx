import { redirect } from 'next/navigation';
import { readActiveTenantCookie } from '@/lib/auth/tenant-access';
import { BatchesPageClient } from './BatchesPageClient';

export default async function BatchesPage() {
  const tenantId = await readActiveTenantCookie();
  if (!tenantId) redirect('/settings');
  return <BatchesPageClient tenantId={tenantId} />;
}
