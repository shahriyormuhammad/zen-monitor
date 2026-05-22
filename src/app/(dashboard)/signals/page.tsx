import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { Loader2 } from 'lucide-react';

import { SignalsFeed } from '@/components/dashboard/SignalsFeed';
import { readActiveTenantCookie } from '@/lib/auth/tenant-access';

function SignalsFeedFallback() {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="flex min-h-40 items-center justify-center gap-3 text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm font-semibold">Собираем задачи...</span>
      </div>
    </div>
  );
}

export default async function SignalsPage() {
  const tenantId = await readActiveTenantCookie();
  if (!tenantId) redirect('/settings');

  return (
    <div className="space-y-4 pb-8">
      <Suspense fallback={<SignalsFeedFallback />}>
        <SignalsFeed surface="simple" />
      </Suspense>
    </div>
  );
}
