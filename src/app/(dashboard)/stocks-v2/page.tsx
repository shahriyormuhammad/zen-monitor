import { redirect } from 'next/navigation';
import { readActiveTenantCookie } from '@/lib/auth/tenant-access';
import { StocksV2PageClient } from './StocksV2PageClient';

export default async function StocksV2Page() {
  const tenantId = await readActiveTenantCookie();
  if (!tenantId) redirect('/settings');
  return <StocksV2PageClient tenantId={tenantId} />;
}
