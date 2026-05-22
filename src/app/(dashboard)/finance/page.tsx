import { redirect } from 'next/navigation';

import { readActiveTenantCookie } from '@/lib/auth/tenant-access';
import { FinancePageClient } from './FinancePageClient';

export default async function FinancePage() {
  const tenantId = await readActiveTenantCookie();
  if (!tenantId) redirect('/settings');
  return <FinancePageClient tenantId={tenantId} />;
}
