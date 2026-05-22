import { redirect } from 'next/navigation';
import { readActiveTenantCookie } from '@/lib/auth/tenant-access';
import { ByWarehousePageClient } from './ByWarehousePageClient';

export default async function ByWarehousePage() {
  const tenantId = await readActiveTenantCookie();
  if (!tenantId) redirect('/settings');
  return <ByWarehousePageClient tenantId={tenantId} />;
}
