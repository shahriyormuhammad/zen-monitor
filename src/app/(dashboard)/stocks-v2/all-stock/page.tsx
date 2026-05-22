import { redirect } from 'next/navigation';
import { readActiveTenantCookie } from '@/lib/auth/tenant-access';
import { AllStockPageClient } from './AllStockPageClient';

export default async function AllStockPage() {
  const tenantId = await readActiveTenantCookie();
  if (!tenantId) redirect('/settings');
  return <AllStockPageClient tenantId={tenantId} />;
}
