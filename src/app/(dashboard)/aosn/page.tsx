import { redirect } from 'next/navigation';

import { readActiveTenantCookie } from '@/lib/auth/tenant-access';
import { AosnPageClient } from './AosnPageClient';

export default async function AosnPage() {
  const tenantId = await readActiveTenantCookie();
  if (!tenantId) redirect('/settings');
  return <AosnPageClient tenantId={tenantId} />;
}
