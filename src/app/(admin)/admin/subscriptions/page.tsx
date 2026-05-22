import Link from 'next/link';

import { listAdminSubscriptions } from '@/server/admin/backoffice';

import {
  AdminNavLink,
  AdminPageHeader,
  AdminPanel,
  AdminPagination,
  AdminTable,
  EmptyState,
  StatusBadge,
  formatDate,
  formatMoney,
  formatPlanName,
  formatReason,
  formatStatus,
} from '../_components/AdminUi';

const PAGE_SIZE = 50;

type SubscriptionSearchParams = {
  page?: string;
  status?: string;
};

const statusFilters = [
  { href: '/admin/subscriptions', label: 'Все' },
  { href: '/admin/subscriptions?status=trialing', label: 'Пробный период' },
  { href: '/admin/subscriptions?status=active', label: 'Активные' },
  { href: '/admin/subscriptions?status=past_due', label: 'Просрочка' },
  { href: '/admin/subscriptions?status=grace', label: 'Льготный период' },
  { href: '/admin/subscriptions?status=expired', label: 'Истекли' },
];

function normalizePage(value: string | undefined) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function buildSubscriptionsHref(params: SubscriptionSearchParams, overrides: SubscriptionSearchParams) {
  const next = new URLSearchParams();
  const merged = { ...params, ...overrides };

  for (const [key, value] of Object.entries(merged)) {
    if (!value || value === 'all' || value === '1') continue;
    next.set(key, value);
  }

  const query = next.toString();
  return query ? `/admin/subscriptions?${query}` : '/admin/subscriptions';
}

export default async function AdminSubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<SubscriptionSearchParams>;
}) {
  const params = await searchParams;
  const subscriptions = await listAdminSubscriptions(params.status);
  const requestedPage = normalizePage(params.page);
  const totalPages = Math.max(1, Math.ceil(subscriptions.length / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const visibleSubscriptions = subscriptions.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const hrefForPage = (nextPage: number) => buildSubscriptionsHref(params, { page: String(nextPage) });

  return (
    <div>
      <AdminPageHeader
        title="Подписки"
        description="Очередь подписок: тариф, период, статус доступа, способ оплаты и владелец аккаунта."
        actions={statusFilters.map((filter) => (
          <AdminNavLink key={filter.href} href={filter.href}>{filter.label}</AdminNavLink>
        ))}
      />

      <AdminPanel>
        <div className="border-b border-border px-4 py-3 text-sm font-semibold text-muted-foreground">
          Показано {visibleSubscriptions.length} из {subscriptions.length}
        </div>
        {visibleSubscriptions.length > 0 ? (
          <AdminTable headers={['Магазин', 'Тариф', 'Статус', 'Период', 'Способ оплаты', 'Владелец']}>
            {visibleSubscriptions.map((item) => (
              <tr key={item.subscriptionId} className="hover:bg-accent/60">
                <td className="px-4 py-3">
                  <Link href={`/admin/customers/${item.tenantId}`} className="font-bold text-foreground hover:text-cyan-700">
                    {item.shopName || item.tenantName}
                  </Link>
                  <p className="mt-1 max-w-[220px] truncate text-xs text-muted-foreground">{item.subscriptionId}</p>
                </td>
                <td className="px-4 py-3">
                  <p className="text-sm font-bold text-foreground">{formatPlanName(item.planCode, item.planName)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{formatMoney(item.priceRub)}</p>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge value={item.effectiveStatus} />
                  <p className="mt-1 text-xs text-muted-foreground">{formatReason(item.reason)}</p>
                </td>
                <td className="px-4 py-3 text-sm font-semibold text-muted-foreground">
                  <p>{formatDate(item.currentPeriodStart)} → {formatDate(item.currentPeriodEnd)}</p>
                  <p className="mt-1 text-xs">пробный до {formatDate(item.trialEndsAt)} · льготный до {formatDate(item.graceUntil)}</p>
                </td>
                <td className="px-4 py-3">
                  <p className="text-sm font-bold text-foreground">{formatStatus(item.provider)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{item.cancelAtPeriodEnd ? 'отмена в конце периода' : 'продление активно'}</p>
                </td>
                <td className="px-4 py-3 text-sm font-semibold text-muted-foreground">{item.ownerEmails[0] ?? '—'}</td>
              </tr>
            ))}
          </AdminTable>
        ) : (
          <div className="p-4">
            <EmptyState title="Подписок пока нет" description="После создания подписок они появятся здесь." />
          </div>
        )}
        <AdminPagination page={page} totalPages={totalPages} totalItems={subscriptions.length} hrefForPage={hrefForPage} />
      </AdminPanel>
    </div>
  );
}
