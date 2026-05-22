import { eq } from 'drizzle-orm';

import { getActivePlatformImpersonationSessionForUser } from '@/lib/auth/platform-impersonation-session';
import { db, withAdminContext } from '@/lib/db';
import { tenants } from '@/lib/db/schema';
import { createClient } from '@/lib/supabase/server';

export async function PlatformImpersonationBanner() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const session = await getActivePlatformImpersonationSessionForUser(user.id);
  if (!session) return null;

  const tenant = await withAdminContext(db, (tx) =>
    tx.query.tenants.findFirst({
      where: eq(tenants.id, session.tenantId),
      columns: {
        name: true,
        shopName: true,
      },
    }),
  );

  return (
    <div className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200">
      <div className="mx-auto flex max-w-[1780px] flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span>
          Режим клиента: {tenant?.shopName || tenant?.name || session.tenantId}. Доступ полный, действия пишутся в audit log.
        </span>
        <form action="/admin/impersonation/stop" method="post">
          <button type="submit" className="font-black underline underline-offset-4">
            Завершить просмотр
          </button>
        </form>
      </div>
    </div>
  );
}
