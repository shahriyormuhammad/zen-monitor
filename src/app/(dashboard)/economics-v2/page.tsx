import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { readActiveTenantCookie } from '@/lib/auth/tenant-access';
import { EconomicsV2PageClient } from './EconomicsV2PageClient';

export default async function EconomicsV2Page() {
  const tenantId = await readActiveTenantCookie();
  if (!tenantId) redirect('/settings');
  return (
    <Suspense fallback={null}>
      <EconomicsV2PageClient tenantId={tenantId} />
    </Suspense>
  );
}
