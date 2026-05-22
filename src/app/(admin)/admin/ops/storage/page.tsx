import Link from 'next/link';

import { getAdminStorageOps } from '@/server/admin/storage';

import {
  AdminPageHeader,
  AdminPanel,
  AdminTable,
  EmptyState,
  StatusBadge,
  formatBytes,
  formatDateTime,
} from '../../_components/AdminUi';

export default async function AdminStorageOpsPage() {
  const data = await getAdminStorageOps();

  return (
    <div>
      <AdminPageHeader
        title="Данные / Хранилище"
        description="Операционный обзор: какие таблицы и клиенты сильнее всего раздувают базу. Показываем только агрегаты, без сырых клиентских строк."
      />

      <div className="grid gap-5 xl:grid-cols-2">
        <AdminPanel>
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-base font-black text-foreground">Топ таблиц по размеру</h2>
          </div>
          <AdminTable headers={['Таблица', 'Источник', 'Размер', 'Строк оценочно']}>
            {data.tableLeaders.map((item) => (
              <tr key={item.table}>
                <td className="px-4 py-3 text-sm font-bold text-foreground">{item.table}</td>
                <td className="px-4 py-3 text-sm font-semibold text-muted-foreground">{item.label}</td>
                <td className="px-4 py-3 text-sm font-bold text-foreground">{formatBytes(item.tableSizeBytes)}</td>
                <td className="px-4 py-3 text-sm font-semibold text-muted-foreground">{Math.round(item.totalRowsEstimate).toLocaleString('ru-RU')}</td>
              </tr>
            ))}
          </AdminTable>
        </AdminPanel>

        <AdminPanel>
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-base font-black text-foreground">Топ клиентов по примерному размеру</h2>
            <p className="mt-1 text-xs font-semibold text-muted-foreground">
              Размер tenant оценочный: размер таблицы умножается на долю строк клиента.
            </p>
          </div>
          <AdminTable headers={['Клиент', 'Размер', 'Строк', 'Действие']}>
            {data.tenantSizeLeaders.map((item) => (
              <tr key={item.tenantId}>
                <td className="px-4 py-3">
                  <p className="text-sm font-bold text-foreground">{item.shopName || item.tenantName}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{item.tenantId}</p>
                </td>
                <td className="px-4 py-3 text-sm font-bold text-foreground">{formatBytes(item.approxTenantSizeBytes)}</td>
                <td className="px-4 py-3 text-sm font-semibold text-muted-foreground">{item.rows.toLocaleString('ru-RU')}</td>
                <td className="px-4 py-3">
                  <Link href={`/admin/customers/${item.tenantId}`} className="text-sm font-bold text-cyan-700 hover:underline dark:text-cyan-300">
                    Открыть кабинет
                  </Link>
                </td>
              </tr>
            ))}
          </AdminTable>
        </AdminPanel>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <AdminPanel>
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-base font-black text-foreground">Топ клиентов по числу строк</h2>
          </div>
          <AdminTable headers={['Клиент', 'Строк', 'Размер', 'Действие']}>
            {data.tenantRowLeaders.map((item) => (
              <tr key={item.tenantId}>
                <td className="px-4 py-3">
                  <p className="text-sm font-bold text-foreground">{item.shopName || item.tenantName}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{item.tenantId}</p>
                </td>
                <td className="px-4 py-3 text-sm font-bold text-foreground">{item.rows.toLocaleString('ru-RU')}</td>
                <td className="px-4 py-3 text-sm font-semibold text-muted-foreground">{formatBytes(item.approxTenantSizeBytes)}</td>
                <td className="px-4 py-3">
                  <Link href={`/admin/customers/${item.tenantId}`} className="text-sm font-bold text-cyan-700 hover:underline dark:text-cyan-300">
                    Открыть кабинет
                  </Link>
                </td>
              </tr>
            ))}
          </AdminTable>
        </AdminPanel>

        <AdminPanel>
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-base font-black text-foreground">Клиенты без свежего sync</h2>
          </div>
          {data.staleSyncTenants.length > 0 ? (
            <AdminTable headers={['Клиент', 'Последний sync', 'Статус', 'Действие']}>
              {data.staleSyncTenants.map((item) => (
                <tr key={item.tenantId}>
                  <td className="px-4 py-3">
                    <p className="text-sm font-bold text-foreground">{item.shopName || item.tenantName}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{item.tenantId}</p>
                  </td>
                  <td className="px-4 py-3 text-sm font-semibold text-muted-foreground">{formatDateTime(item.latestSyncAt)}</td>
                  <td className="px-4 py-3"><StatusBadge value={item.latestSyncStatus ?? 'unknown'} /></td>
                  <td className="px-4 py-3">
                    <Link href={`/admin/customers/${item.tenantId}`} className="text-sm font-bold text-cyan-700 hover:underline dark:text-cyan-300">
                      Открыть кабинет
                    </Link>
                  </td>
                </tr>
              ))}
            </AdminTable>
          ) : (
            <div className="p-4"><EmptyState title="Просроченных sync нет" description="Все клиенты синхронизировались за последние 24 часа." /></div>
          )}
        </AdminPanel>
      </div>

      <AdminPanel className="mt-5">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-base font-black text-foreground">Клиенты с большим ростом данных</h2>
          <p className="mt-1 text-xs font-semibold text-muted-foreground">
            Сейчас это оценка по строкам, созданным за последние 7 дней. Исторический тренд размера можно добавить отдельной daily snapshot-задачей.
          </p>
        </div>
        <AdminTable headers={['Клиент', 'Новых строк за 7 дней', 'Всего строк', 'Действие']}>
          {data.growingTenants.map((item) => (
            <tr key={item.tenantId}>
              <td className="px-4 py-3">
                <p className="text-sm font-bold text-foreground">{item.shopName || item.tenantName}</p>
                <p className="mt-1 text-xs text-muted-foreground">{item.tenantId}</p>
              </td>
              <td className="px-4 py-3 text-sm font-bold text-foreground">{item.recentRows7d.toLocaleString('ru-RU')}</td>
              <td className="px-4 py-3 text-sm font-semibold text-muted-foreground">{item.rows.toLocaleString('ru-RU')}</td>
              <td className="px-4 py-3">
                <Link href={`/admin/customers/${item.tenantId}`} className="text-sm font-bold text-cyan-700 hover:underline dark:text-cyan-300">
                  Открыть кабинет
                </Link>
              </td>
            </tr>
          ))}
        </AdminTable>
      </AdminPanel>
    </div>
  );
}
