import { redirect } from 'next/navigation';

import { readActiveTenantCookie } from '@/lib/auth/tenant-access';

import { ApprovalsPageClient } from './ApprovalsPageClient';

export default async function ApprovalsPage() {
  const tenantId = await readActiveTenantCookie();
  if (!tenantId) redirect('/settings');

  return <ApprovalsPageClient tenantId={tenantId} />;
}
