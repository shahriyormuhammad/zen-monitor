import Link from 'next/link';

import { listAdminLeads, type AdminLeadListItem } from '@/server/admin/backoffice';

import {
  AdminNavLink,
  AdminPageHeader,
  AdminPanel,
  AdminPagination,
  AdminTable,
  EmptyState,
  StatTile,
  StatusBadge,
  formatDateTime,
  formatPlanName,
  formatPlural,
} from '../_components/AdminUi';
import { DeleteLeadButton } from './DeleteLeadButton';

const PAGE_SIZE = 50;

type LeadsSearchParams = {
  message?: string;
  messageType?: string;
  page?: string;
  q?: string;
  scope?: string;
  status?: string;
};

function normalizePage(value: string | undefined) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function buildLeadsHref(params: LeadsSearchParams, overrides: LeadsSearchParams) {
  const next = new URLSearchParams();
  const merged = { ...params, ...overrides };

  for (const [key, value] of Object.entries(merged)) {
    if (!value || value === 'all' || value === '1') continue;
    next.set(key, value);
  }

  const query = next.toString();
  return query ? `/admin/leads?${query}` : '/admin/leads';
}

function getLeadStage(lead: AdminLeadListItem) {
  if (lead.status === 'paid') return 'оплатил';
  if (lead.status === 'trialing') return 'пробный пакет';
  if (lead.tenantId) return 'есть магазин';
  if (lead.isBackfilled) return 'ранняя регистрация';
  return 'только регистрация';
}

function formatLeadSource(lead: AdminLeadListItem) {
  if (lead.isBackfilled) return 'ранняя база';
  if (lead.source === 'site') return 'сайт';
  if (lead.source === 'auth') return 'регистрация';
  return lead.source || '—';
}

function formatLeadMetadata(lead: AdminLeadListItem) {
  const metadata = lead.metadata ?? {};
  const pairs = ([
    ['utm_source', 'utm'],
    ['utm_campaign', 'кампания'],
    ['utm_medium', 'канал'],
    ['landing', 'страница'],
    ['referrer', 'ref'],
  ] satisfies Array<[string, string]>).flatMap(([key, label]) => {
    const value = metadata[key];
    return typeof value === 'string' && value.trim() ? [`${label}: ${value.trim()}`] : [];
  });

  return pairs.join(' · ');
}

export default async function AdminLeadsPage({
  searchParams,
}: {
  searchParams: Promise<LeadsSearchParams>;
}) {
  const params = await searchParams;
  const status = params.status ?? 'all';
  const scope = params.scope ?? 'all';
  const leads = await listAdminLeads(status);
  const query = params.q?.trim().toLowerCase() ?? '';
  const filteredLeads = leads.filter((lead) => {
    if (scope === 'without_store' && lead.tenantId) return false;
    if (scope === 'with_store' && !lead.tenantId) return false;
    if (scope === 'early' && !lead.isBackfilled) return false;

    if (!query) return true;
    return [
      lead.email,
      lead.name,
      lead.phone,
      lead.source,
      lead.status,
      lead.selectedPlanCode,
      lead.tenantName,
      lead.tenantNames,
      lead.tenantId,
      getLeadStage(lead),
      formatLeadSource(lead),
      formatLeadMetadata(lead),
    ].filter(Boolean).join(' ').toLowerCase().includes(query);
  });

  const withoutStoreCount = leads.filter((lead) => !lead.tenantId).length;
  const withStoreCount = leads.length - withoutStoreCount;
  const earlyCount = leads.filter((lead) => lead.isBackfilled).length;
  const trialCount = leads.filter((lead) => lead.status === 'trialing').length;

  const requestedPage = normalizePage(params.page);
  const totalPages = Math.max(1, Math.ceil(filteredLeads.length / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const visibleLeads = filteredLeads.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const hrefForPage = (nextPage: number) => buildLeadsHref(params, { page: String(nextPage) });

  const filterLinks = [
    { href: buildLeadsHref(params, { status: 'all', page: '1' }), label: 'Все' },
    { href: buildLeadsHref(params, { scope: scope === 'without_store' ? 'all' : 'without_store', page: '1' }), label: 'Без магазина' },
    { href: buildLeadsHref(params, { scope: scope === 'with_store' ? 'all' : 'with_store', page: '1' }), label: 'С магазином' },
    { href: buildLeadsHref(params, { scope: scope === 'early' ? 'all' : 'early', page: '1' }), label: 'Ранние' },
    { href: buildLeadsHref(params, { status: 'registered', page: '1' }), label: 'Зарегистрированы' },
    { href: buildLeadsHref(params, { status: 'trialing', page: '1' }), label: 'Trial' },
    { href: buildLeadsHref(params, { status: 'paid', page: '1' }), label: 'Оплатили' },
    { href: buildLeadsHref(params, { status: 'lost', page: '1' }), label: 'Потеряны' },
  ];

  return (
    <div>
      <AdminPageHeader
        title="Лиды"
        description="Все регистрации и входящие заявки: контакт, источник, выбранный пакет, этап воронки и связь с клиентским кабинетом."
        actions={(
          <>
            <form action="/admin/leads" className="flex items-center gap-2">
              {status !== 'all' ? <input type="hidden" name="status" value={status} /> : null}
              {scope !== 'all' ? <input type="hidden" name="scope" value={scope} /> : null}
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

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Регистрации" value={leads.length} hint="Все пользователи и лиды" />
        <StatTile label="Без магазина" value={withoutStoreCount} hint="Нужен онбординг до WB-ключа" />
        <StatTile label="С магазином" value={withStoreCount} hint="Есть связь с клиентским кабинетом" />
        <StatTile label="Trial" value={trialCount} hint={`${earlyCount} ранних регистраций`} />
      </div>

      <AdminPanel className="mt-5">
        <div className="border-b border-border px-4 py-3 text-sm font-semibold text-muted-foreground">
          Показано {visibleLeads.length} из {filteredLeads.length} {formatPlural(filteredLeads.length, 'лид', 'лида', 'лидов')}
        </div>
        {visibleLeads.length > 0 ? (
          <AdminTable headers={['Контакт', 'Этап', 'Источник', 'Пакет', 'Кабинет', 'Активность', 'Действия']}>
            {visibleLeads.map((lead) => (
              <tr key={lead.id} className="hover:bg-accent/60">
                <td className="px-4 py-3">
                  <p className="text-sm font-bold text-foreground">{lead.email}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {[lead.name, lead.phone].filter(Boolean).join(' · ') || 'контакт не заполнен'}
                  </p>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge value={lead.status} />
                  <p className="mt-1 text-xs font-semibold text-muted-foreground">{getLeadStage(lead)}</p>
                </td>
                <td className="px-4 py-3">
                  <p className="text-sm font-semibold text-foreground">{formatLeadSource(lead)}</p>
                  <p className="mt-1 max-w-[240px] truncate text-xs text-muted-foreground">
                    {formatLeadMetadata(lead) || 'источник не детализирован'}
                  </p>
                </td>
                <td className="px-4 py-3 text-sm font-semibold text-foreground">
                  {formatPlanName(lead.selectedPlanCode, null)}
                </td>
                <td className="px-4 py-3">
                  {lead.tenantId ? (
                    <>
                      <Link href={`/admin/customers/${lead.tenantId}`} className="text-sm font-bold text-foreground hover:text-cyan-700">
                        {lead.tenantName ?? 'Клиентский кабинет'}
                      </Link>
                      {lead.tenantCount > 1 ? (
                        <p className="mt-1 max-w-[220px] truncate text-xs font-semibold text-muted-foreground">
                          {lead.tenantCount} {formatPlural(lead.tenantCount, 'магазин', 'магазина', 'магазинов')}: {lead.tenantNames}
                        </p>
                      ) : null}
                      <p className="mt-1 max-w-[220px] truncate text-xs text-muted-foreground">{lead.tenantId}</p>
                    </>
                  ) : (
                    <span className="text-sm font-semibold text-muted-foreground">ещё не подключен</span>
                  )}
                </td>
                <td className="px-4 py-3 text-sm font-semibold text-foreground">
                  {formatDateTime(lead.lastActivityAt)}
                  <p className="mt-1 text-xs text-muted-foreground">создан {formatDateTime(lead.createdAt)}</p>
                </td>
                <td className="px-4 py-3">
                  <DeleteLeadButton
                    id={lead.id}
                    userId={lead.userId}
                    email={lead.email}
                    disabled={Boolean(lead.tenantId || lead.tenantCount > 0)}
                  />
                </td>
              </tr>
            ))}
          </AdminTable>
        ) : (
          <div className="p-4">
            <EmptyState title="Лиды не найдены" description="Измените поиск или фильтры." />
          </div>
        )}
        <AdminPagination page={page} totalPages={totalPages} totalItems={filteredLeads.length} hrefForPage={hrefForPage} />
      </AdminPanel>
    </div>
  );
}
