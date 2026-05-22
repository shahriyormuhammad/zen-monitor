import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getAdminCustomerDetail } from '@/server/admin/backoffice';
import { getAdminTenantStorageMetrics } from '@/server/admin/storage';
import { DeleteCustomerAccountButton } from './DeleteCustomerAccountButton';
import { PlatformImpersonationButton } from './PlatformImpersonationButton';

import {
  AdminPageHeader,
  AdminPanel,
  AdminTable,
  EmptyState,
  StatusBadge,
  formatDate,
  formatDateTime,
  formatBytes,
  formatMoney,
  formatPlanName,
  formatStatus,
  formatTriggerSource,
} from '../../_components/AdminUi';

export default async function AdminCustomerDetailPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const detail = await getAdminCustomerDetail(tenantId);
  if (!detail) notFound();
  const storageMetrics = await getAdminTenantStorageMetrics(tenantId);

  const title = detail.tenant.shopName || detail.tenant.name;

  return (
    <div>
      <AdminPageHeader
        title={title}
        description={`Кабинет ${detail.tenant.tenantId}. Карточка магазина: команда, подписки, платежи, синхронизации и журнал действий.`}
        actions={(
          <>
            <PlatformImpersonationButton tenantId={detail.tenant.tenantId} />
            <Link href="/admin/customers" className="rounded-lg border border-border bg-card px-3 py-2 text-sm font-bold text-muted-foreground hover:bg-accent hover:text-foreground">Назад к аккаунтам</Link>
          </>
        )}
      />

      <div className="grid gap-4 xl:grid-cols-4">
        <AdminPanel className="p-4">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">Токен ВБ</p>
          <div className="mt-3"><StatusBadge value={detail.tenant.wbTokenHealthStatus} /></div>
          <p className="mt-2 text-xs text-muted-foreground">Проверен: {formatDateTime(detail.tenant.wbTokenCheckedAt)}</p>
        </AdminPanel>
        <AdminPanel className="p-4">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">ЛК ВБ</p>
          <div className="mt-3"><StatusBadge value={detail.tenant.wbLkSessionStatus} /></div>
          <p className="mt-2 text-xs text-muted-foreground">Телефон: {detail.tenant.wbLkPhone ?? '—'}</p>
        </AdminPanel>
        <AdminPanel className="p-4">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">Налоги</p>
          <p className="mt-3 text-xl font-black text-foreground">{detail.tenant.taxType}</p>
          <p className="mt-2 text-xs text-muted-foreground">Ставка {detail.tenant.taxRate}%</p>
        </AdminPanel>
        <AdminPanel className="p-4">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">Уведомления</p>
          <p className="mt-3 text-xl font-black text-foreground">{detail.tenant.notificationsEnabled ? 'Включены' : 'Выключены'}</p>
          <p className="mt-2 text-xs text-muted-foreground">Чат Telegram: {detail.tenant.telegramChatId ?? '—'}</p>
        </AdminPanel>
      </div>

      <AdminPanel className="mt-5">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-base font-black text-foreground">Данные / Хранилище</h2>
          <p className="mt-1 text-xs font-semibold text-muted-foreground">
            Размер примерный: Postgres точно знает размер таблицы целиком, а размер tenant считается по доле строк внутри общей таблицы.
          </p>
        </div>
        <AdminTable headers={['Источник/таблица', 'Строк', 'Размер', 'Первая дата', 'Последняя дата', 'Статус', 'Комментарий']}>
          {storageMetrics.map((metric) => (
            <tr key={metric.key}>
              <td className="px-4 py-3">
                <p className="text-sm font-bold text-foreground">{metric.label}</p>
                <p className="mt-1 text-xs text-muted-foreground">{metric.table}</p>
              </td>
              <td className="px-4 py-3 text-sm font-bold text-foreground">
                {metric.tenantRows.toLocaleString('ru-RU')}
              </td>
              <td className="px-4 py-3">
                <p className="text-sm font-bold text-foreground">{formatBytes(metric.approxTenantSizeBytes)}</p>
                <p className="mt-1 text-xs text-muted-foreground">таблица: {formatBytes(metric.tableSizeBytes)}</p>
              </td>
              <td className="px-4 py-3 text-sm font-semibold text-muted-foreground">{formatDate(metric.firstDate)}</td>
              <td className="px-4 py-3 text-sm font-semibold text-muted-foreground">{formatDate(metric.lastDate)}</td>
              <td className="px-4 py-3"><StatusBadge value={metric.status} /></td>
              <td className="max-w-[320px] px-4 py-3 text-xs text-muted-foreground">{metric.comment}</td>
            </tr>
          ))}
        </AdminTable>
      </AdminPanel>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_1fr]">
        <AdminPanel>
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-base font-black text-foreground">Команда</h2>
          </div>
          {detail.members.length > 0 ? (
            <AdminTable headers={['Почта', 'Роль', 'В кабинете с']}>
              {detail.members.map((member) => (
                <tr key={member.userId}>
                  <td className="px-4 py-3">
                    <p className="text-sm font-bold text-foreground">{member.email ?? '—'}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{member.userId}</p>
                  </td>
                  <td className="px-4 py-3"><StatusBadge value={member.role} /></td>
                  <td className="px-4 py-3 text-sm font-semibold text-muted-foreground">{formatDate(member.joinedAt)}</td>
                </tr>
              ))}
            </AdminTable>
          ) : (
            <div className="p-4"><EmptyState title="Команда пустая" description="Нет связанных пользователей." /></div>
          )}
        </AdminPanel>

        <AdminPanel>
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-base font-black text-foreground">Подписки</h2>
          </div>
          {detail.subscriptions.length > 0 ? (
            <AdminTable headers={['Тариф', 'Статус', 'Период', 'Способ оплаты']}>
              {detail.subscriptions.map((item) => (
                <tr key={item.subscriptionId}>
                  <td className="px-4 py-3">
                    <p className="text-sm font-bold text-foreground">{formatPlanName(item.planCode, item.planName)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{formatMoney(item.priceRub)}</p>
                  </td>
                  <td className="px-4 py-3"><StatusBadge value={item.effectiveStatus} /></td>
                  <td className="px-4 py-3 text-sm font-semibold text-muted-foreground">{formatDate(item.currentPeriodStart)} → {formatDate(item.currentPeriodEnd)}</td>
                  <td className="px-4 py-3 text-sm font-semibold text-muted-foreground">{formatStatus(item.provider)}</td>
                </tr>
              ))}
            </AdminTable>
          ) : (
            <div className="p-4"><EmptyState title="Подписок нет" description="Магазин пока не подключен к платежной модели." /></div>
          )}
        </AdminPanel>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_1fr]">
        <AdminPanel>
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-base font-black text-foreground">Платежи</h2>
          </div>
          {detail.payments.length > 0 ? (
            <AdminTable headers={['Статус', 'Сумма', 'Способ оплаты', 'Дата']}>
              {detail.payments.map((payment) => (
                <tr key={payment.id}>
                  <td className="px-4 py-3"><StatusBadge value={payment.status} /></td>
                  <td className="px-4 py-3 text-sm font-bold text-foreground">{formatMoney(payment.amountRub)}</td>
                  <td className="px-4 py-3">
                    <p className="text-sm font-semibold text-foreground">{formatStatus(payment.provider)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{payment.providerPaymentId ?? '—'}</p>
                  </td>
                  <td className="px-4 py-3 text-sm font-semibold text-muted-foreground">{formatDateTime(payment.paidAt ?? payment.createdAt)}</td>
                </tr>
              ))}
            </AdminTable>
          ) : (
            <div className="p-4"><EmptyState title="Платежей нет" description="История платежей появится после ручного платежа или подключения ЮКассы." /></div>
          )}
        </AdminPanel>

        <AdminPanel>
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-base font-black text-foreground">Последние синхронизации</h2>
          </div>
          {detail.syncRuns.length > 0 ? (
            <AdminTable headers={['Статус', 'Источник', 'Запрошен', 'Ошибка']}>
              {detail.syncRuns.map((run) => (
                <tr key={run.id}>
                  <td className="px-4 py-3"><StatusBadge value={run.status} /></td>
                  <td className="px-4 py-3 text-sm font-semibold text-foreground">{formatTriggerSource(run.triggerSource)}</td>
                  <td className="px-4 py-3 text-sm font-semibold text-muted-foreground">{formatDateTime(run.requestedAt)}</td>
                  <td className="max-w-[280px] truncate px-4 py-3 text-xs text-muted-foreground">{run.errorMessage ?? '—'}</td>
                </tr>
              ))}
            </AdminTable>
          ) : (
            <div className="p-4"><EmptyState title="Синхронизаций нет" description="Синхронизации по этому магазину ещё не запускались." /></div>
          )}
        </AdminPanel>
      </div>

      <AdminPanel className="mt-5 border-rose-200 dark:border-rose-900/40">
        <div className="border-b border-rose-200 px-4 py-3 dark:border-rose-900/40">
          <h2 className="text-base font-black text-foreground">Опасная зона</h2>
          <p className="mt-1 text-xs font-semibold text-muted-foreground">
            Только для владельца платформы. Действие пишет audit log и удаляет клиентские данные без восстановления.
          </p>
        </div>
        <div className="p-4">
          <DeleteCustomerAccountButton tenantId={detail.tenant.tenantId} tenantName={title} />
        </div>
      </AdminPanel>

      <AdminPanel className="mt-5">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-base font-black text-foreground">Журнал действий админки</h2>
        </div>
        {detail.audit.length > 0 ? (
          <AdminTable headers={['Действие', 'Кто выполнил', 'Объект', 'Причина', 'Дата']}>
            {detail.audit.map((item) => (
              <tr key={item.id}>
                <td className="px-4 py-3 text-sm font-bold text-foreground">{item.action}</td>
                <td className="px-4 py-3 text-sm font-semibold text-muted-foreground">{item.actorRole}</td>
                <td className="px-4 py-3 text-sm font-semibold text-muted-foreground">{item.entityType} · {item.entityId ?? '—'}</td>
                <td className="px-4 py-3 text-sm text-muted-foreground">{item.reason ?? '—'}</td>
                <td className="px-4 py-3 text-sm font-semibold text-muted-foreground">{formatDateTime(item.createdAt)}</td>
              </tr>
            ))}
          </AdminTable>
        ) : (
            <div className="p-4"><EmptyState title="Журнал пустой" description="Ручные действия по подпискам и админке будут появляться здесь." /></div>
        )}
      </AdminPanel>
    </div>
  );
}
