import { redirect } from 'next/navigation';
import { readActiveTenantCookie } from '@/lib/auth/tenant-access';
import { OwnStockPageClient } from '../own-stock/OwnStockPageClient';

export default async function ChinaStockPage() {
  const tenantId = await readActiveTenantCookie();
  if (!tenantId) redirect('/settings');
  return <OwnStockPageClient tenantId={tenantId} stockLocation="china" />;
}
