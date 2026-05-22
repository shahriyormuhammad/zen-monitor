import Link from 'next/link';

import { listAdminAccounts } from '@/server/admin/backoffice';

import {
  AdminNavLink,
  AdminPageHeader,
  AdminPanel,
  AdminPagination,
  AdminTable,
  EmptyState,
  StatusBadge,
  formatDateTime,
  formatPlanName,
  formatPlural,
} from '../_components/AdminUi';

const PAGE_SIZE = 50;

type AccountSearchParams = {
  message?: string;
  messageType?: string;
  page?: string;
  q?: string;
  risk?: string;
  status?: string;
};

function normalizePage(value: string | undefined) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function buildAccountsHref(params: AccountSearchParams, overrides: AccountSearchParams) {
  const next = new URLSearchParams();
  const merged = { ...params, ...overrides };

  for (const [key, value] of Object.entries(merged)) {
    if (key === 'message' || key === 'messageType') continue;
    if (!value || value === 'all' || value === '1') continue;
    next.set(key, value);
  }

  const query = next.toString();
  return query ? `/admin/customers?${query}` : '/admin/customers';
}

function isStaleSync(value: Date | null) {
  if (!value) return true;
  return value.getTime() < Date.now() - 24 * 60 * 60 * 1000;
}

export default async function AdminCustomersPage({
  searchParams,
}: {
  searchParams: Promise<AccountSearchParams>;
}) {
  const params = await searchParams;
  const accounts = await listAdminAccounts();
  const query = params.q?.trim().toLowerCase() ?? '';
  const status = params.status ?? 'all';
  const risk = params.risk ?? 'all';
  const totalStores = accounts.reduce((sum, account) => sum + account.storeCount, 0);

  const filteredAccounts = accounts.filter((account) => {
    const haystack = [
      account.ownerEmail,
      account.accountKey,
      ...account.stores.flatMap((store) => [
        store.name,
        store.shopName,
        store.tenantId,
        store.subscription.planName,
        store.subscription.planCode,
      ]),
    ].filter(Boolean).join(' ').toLowerCase();

    if (query && !haystack.includes(query)) return false;
    if (status === 'no_subscription' && !account.stores.some((store) => !store.subscription.status)) return false;
    if (status !== 'all' && status !== 'no_subscription' && !account.stores.some((store) => store.subscription.effectiveStatus === status)) return false;
    if (risk === 'token' && !account.stores.some((store) => ['warning', 'invalid'].includes(store.wbTokenHealthStatus))) return false;
    if (risk === 'stale_sync' && !account.stores.some((store) => isStaleSync(store.latestSync.at))) return false;
    return true;
  });

  const requestedPage = normalizePage(params.page);
  const totalPages = Math.max(1, Math.ceil(filteredAccounts.length / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const visibleAccounts = filteredAccounts.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const hrefForPage = (nextPage: number) => buildAccountsHref(params, { page: String(nextPage) });

  const filterLinks = [
    { href: buildAccountsHref(params, { status: 'all', page: '1' }), label: 'Все' },
    { href: buildAccountsHref(params, { status: 'active', page: '1' }), label: 'Активные' },
    { href: buildAccountsHref(params, { status: 'trialing', page: '1' }), label: 'Пробный период' },
    { href: buildAccountsHref(params, { status: 'past_due', page: '1' }), label: 'Просрочка' },
    { href: buildAccountsHref(params, { status: 'expired', page: '1' }), label: 'Истекли' },
    { href: buildAccountsHref(params, { status: 'no_subscription', page: '1' }), label: 'Без подписки' },
    { href: buildAccountsHref(params, { risk: risk === 'token' ? 'all' : 'token', page: '1' }), label: 'Риск по ВБ' },
    { href: buildAccountsHref(params, { risk: risk === 'stale_sync' ? 'all' : 'stale_sync', page: '1' }), label: 'Нет свежей синхронизации' },
  ];

  return (
    <div>
      <AdminPageHeader
        title="Аккаунты"
        description="Аккаунты владельцев и магазины внутри каждого аккаунта: тарифы, подписки, состояние ВБ и последняя синхронизация."
        actions={(
          <>
            <form action="/admin/customers" className="flex items-center gap-2">
              {status !== 'all' ? <input type="hidden" name="status" value={status} /> : null}
              {risk !== 'all' ? <input type="hidden" name="risk" value={risk} /> : null}
              <input
                name="q"
                defaultValue={params.q ?? ''}
                placeholder="Поиск"
                className="h-9 w-44 rounded-lg border border-border bg-card px-3 text-sm font-semibold text-foreground outline-none focus:border-cyan-500"
              />
              <button className="h-9 rounded-lg border border-border bg-card px-3 text-sm font-bold text-muted-foreground hover:bg-accent hover:text-foreground">
                Найти
              </button>
            </form>
            {filterLinks.map((filter) => (
              <AdminNavLink key={`${filter.label}-${filter.href}`} href={filter.href}>{filter.label}</AdminNavLink>
            ))}
          </>
        )}
      />

      {params.message ? (
        <div className={`mb-5 rounded-lg border px-4 py-3 text-sm font-bold ${
          params.messageType === 'success'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300'
            : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-300'
        }`}
        >
          {params.message}
        </div>
      ) : null}

      <AdminPanel>
        <div className="border-b border-border px-4 py-3 text-sm font-semibold text-muted-foreground">
          Показано {visibleAccounts.length} из {filteredAccounts.length} {formatPlural(filteredAccounts.length, 'аккаунт', 'аккаунта', 'аккаунтов')}; всего {totalStores} {formatPlural(totalStores, 'магазин', 'магазина', 'магазинов')}
        </div>
        {visibleAccounts.length > 0 ? (
          <AdminTable headers={['Аккаунт', 'Магазины', 'Подписки', 'ВБ', 'ЛК ВБ', 'Синхронизация']}>
            {visibleAccounts.map((account) => (
              <tr key={account.accountKey} className="hover:bg-accent/60">
                <td className="px-4 py-3">
                  <p className="text-sm font-bold text-foreground">{account.ownerEmail ?? 'Владелец не указан'}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {account.storeCount} {formatPlural(account.storeCount, 'магазин', 'магазина', 'магазинов')}
                  </p>
                </td>
                <td className="px-4 py-3">
                  <div className="space-y-2">
                    {account.stores.map((store) => (
                      <div key={store.tenantId}>
                        <Link href={`/admin/customers/${store.tenantId}`} className="font-bold text-foreground hover:text-cyan-700">
                          {store.shopName || store.name}
                        </Link>
                        <p className="mt-1 max-w-[220px] truncate text-xs text-muted-foreground">{store.tenantId}</p>
                      </div>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="space-y-2">
                    {account.stores.map((store) => (
                      <div key={store.tenantId}>
                        <StatusBadge value={store.subscription.effectiveStatus} />
                        <p className="mt-1 text-xs text-muted-foreground">{formatPlanName(store.subscription.planCode, store.subscription.planName)}</p>
                      </div>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="space-y-2">
                    {account.stores.map((store) => (
                      <div key={store.tenantId}>
                        <StatusBadge value={store.wbTokenHealthStatus} />
                        <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(store.wbTokenCheckedAt)}</p>
                      </div>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="space-y-2">
                    {account.stores.map((store) => (
                      <div key={store.tenantId}>
                        <StatusBadge value={store.wbLkSessionStatus} />
                        <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(store.wbLkSessionCheckedAt)}</p>
                      </div>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="space-y-2">
                    {account.stores.map((store) => (
                      <div key={store.tenantId}>
                        <StatusBadge value={store.latestSync.status ?? 'unknown'} />
                        <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(store.latestSync.at)}</p>
                      </div>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </AdminTable>
        ) : (
          <div className="p-4">
            <EmptyState title="Аккаунты не найдены" description="Измените поиск или фильтры." />
          </div>
        )}
        <AdminPagination page={page} totalPages={totalPages} totalItems={filteredAccounts.length} hrefForPage={hrefForPage} />
      </AdminPanel>
    </div>
  );
}
