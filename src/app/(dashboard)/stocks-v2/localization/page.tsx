import { redirect } from 'next/navigation';
import { readActiveTenantCookie } from '@/lib/auth/tenant-access';
import { LocalizationPageClient } from './LocalizationPageClient';

export default async function LocalizationPage() {
  const tenantId = await readActiveTenantCookie();
  if (!tenantId) redirect('/settings');
  return <LocalizationPageClient tenantId={tenantId} />;
}
