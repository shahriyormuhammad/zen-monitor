import Link from 'next/link';

import { getAdminOverview } from '@/server/admin/backoffice';

import {
  AdminPageHeader,
  AdminPanel,
  AdminTable,
  EmptyState,
  StatTile,
  StatusBadge,
  formatDate,
  formatDateTime,
  formatMoney,
  formatPlanName,
  formatPlural,
} from './_components/AdminUi';

export default async function AdminHomePage() {
  const overview = await getAdminOverview();

  return (
    <div>
      <AdminPageHeader
        title="Сводка платформы"
        description="Операционная картина по аккаунтам, магазинам, подпискам, оплатам, токенам ВБ и свежести синхронизаций."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile
          label="Регистрации"
          value={overview.stats.userCount}
          hint={`${overview.stats.accountCount} ${formatPlural(overview.stats.accountCount, 'клиентский аккаунт', 'клиентских аккаунта', 'клиентских аккаунтов')}, ${overview.stats.tenantCount} ${formatPlural(overview.stats.tenantCount, 'магазин', 'магазина', 'магазинов')}`}
        />
        <StatTile label="Активные подписки" value={overview.stats.activeSubscriptions} hint={`${overview.stats.trialingSubscriptions} на пробном периоде`} />
        <StatTile label="Истекают за 7 дней" value={overview.stats.endingSoonSubscriptions} hint="Нужен контроль продления" />
        <StatTile label="Просрочены" value={overview.stats.pastDueSubscriptions} hint={`${overview.stats.failedPaymentsLast30d} неуспешных оплат`} />
        <StatTile label="Оплаты за 30 дней" value={formatMoney(overview.stats.revenueLast30dRub)} hint="По успешным платежам" />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <StatTile label="Истекли или отменены" value={overview.stats.expiredSubscriptions} />
        <StatTile label="Нет свежей синхронизации" value={overview.stats.staleSyncTenants} hint="Нет синхронизации за 24 часа" />
        <StatTile label="Риск по токену ВБ" value={overview.stats.invalidTokenTenants} hint="Статус внимания или ошибки" />
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <AdminPanel>
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <h2 className="text-base font-black text-foreground">Последние аккаунты</h2>
              <p className="text-xs font-medium text-muted-foreground">Аккаунты владельцев и привязанные к ним магазины.</p>
            </div>
            <Link href="/admin/customers" className="text-sm font-bold text-cyan-700 hover:text-cyan-900 dark:text-cyan-300">
              Все аккаунты
            </Link>
          </div>
          {overview.latestAccounts.length > 0 ? (
            <AdminTable headers={['Аккаунт', 'Магазины', 'Подписки', 'ВБ', 'Синхронизация']}>
              {overview.latestAccounts.map((account) => (
                <tr key={account.accountKey} className="hover:bg-accent/60">
                  <td className="px-4 py-3">
                    <p className="font-bold text-foreground">{account.ownerEmail ?? 'Владелец не указан'}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {account.storeCount} {formatPlural(account.storeCount, 'магазин', 'магазина', 'магазинов')}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <div className="space-y-1">
                      {account.stores.map((store) => (
                        <Link key={store.tenantId} href={`/admin/customers/${store.tenantId}`} className="block font-semibold text-foreground hover:text-cyan-700">
                          {store.shopName || store.name}
                        </Link>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="space-y-2">
                      {account.stores.map((store) => (
                        <div key={store.tenantId} className="flex flex-wrap items-center gap-2">
                          <StatusBadge value={store.subscription.effectiveStatus} />
                          <span className="text-xs text-muted-foreground">{formatPlanName(store.subscription.planCode, store.subscription.planName)}</span>
                        </div>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="space-y-2">
                      {account.stores.map((store) => (
                        <div key={store.tenantId}><StatusBadge value={store.wbTokenHealthStatus} /></div>
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
              <EmptyState title="Аккаунтов пока нет" description="После подключения первого магазина он появится здесь." />
            </div>
          )}
        </AdminPanel>

        <AdminPanel>
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <h2 className="text-base font-black text-foreground">Подписки под контролем</h2>
              <p className="text-xs font-medium text-muted-foreground">Ближайшие окончания и проблемные статусы.</p>
            </div>
            <Link href="/admin/subscriptions" className="text-sm font-bold text-cyan-700 hover:text-cyan-900 dark:text-cyan-300">
              Все подписки
            </Link>
          </div>
          <div className="divide-y divide-border">
            {overview.endingSoon.length > 0 ? overview.endingSoon.map((item) => (
              <Link key={item.subscriptionId} href={`/admin/customers/${item.tenantId}`} className="block px-4 py-3 hover:bg-accent/60">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-foreground">{item.shopName || item.tenantName}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{formatPlanName(item.planCode, item.planName)} · до {formatDate(item.currentPeriodEnd ?? item.trialEndsAt ?? item.graceUntil)}</p>
                  </div>
                  <StatusBadge value={item.effectiveStatus} />
                </div>
              </Link>
            )) : (
              <div className="p-4">
                <EmptyState title="Нет подписок" description="После создания подписок здесь появится очередь контроля." />
              </div>
            )}
          </div>
        </AdminPanel>
      </div>
    </div>
  );
}
