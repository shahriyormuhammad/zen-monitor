import { redirect } from 'next/navigation';
import { readActiveTenantCookie } from '@/lib/auth/tenant-access';
import { OwnStockPageClient } from './OwnStockPageClient';

export default async function OwnStockPage() {
  const tenantId = await readActiveTenantCookie();
  if (!tenantId) redirect('/settings');
  return <OwnStockPageClient tenantId={tenantId} />;
}
