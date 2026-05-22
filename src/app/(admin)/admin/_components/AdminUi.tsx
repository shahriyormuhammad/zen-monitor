import Link from 'next/link';
import type { ReactNode } from 'react';

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const dateTimeFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const moneyFormatter = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  maximumFractionDigits: 0,
});

const badgeTone: Record<string, string> = {
  active: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-900/20 dark:text-emerald-300',
  trialing: 'border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-800/40 dark:bg-cyan-900/20 dark:text-cyan-300',
  grace: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-300',
  past_due: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800/40 dark:bg-rose-900/20 dark:text-rose-300',
  expired: 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
  canceled: 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
  healthy: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-900/20 dark:text-emerald-300',
  warning: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-300',
  invalid: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800/40 dark:bg-rose-900/20 dark:text-rose-300',
  completed: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-900/20 dark:text-emerald-300',
  failed: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800/40 dark:bg-rose-900/20 dark:text-rose-300',
  completed_with_errors: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-300',
  running: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800/40 dark:bg-sky-900/20 dark:text-sky-300',
  pending: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800/40 dark:bg-blue-900/20 dark:text-blue-300',
  unknown: 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
  owner: 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800/40 dark:bg-violet-900/20 dark:text-violet-300',
  admin: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800/40 dark:bg-blue-900/20 dark:text-blue-300',
  viewer: 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
  normal: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-900/20 dark:text-emerald-300',
  medium: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-300',
  heavy: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800/40 dark:bg-rose-900/20 dark:text-rose-300',
  registered: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800/40 dark:bg-blue-900/20 dark:text-blue-300',
  paid: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-900/20 dark:text-emerald-300',
  lost: 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

const statusLabel: Record<string, string> = {
  active: 'активна',
  trialing: 'пробный период',
  grace: 'льготный период',
  past_due: 'просрочена',
  expired: 'истекла',
  canceled: 'отменена',
  missing: 'нет подписки',
  healthy: 'в порядке',
  warning: 'внимание',
  invalid: 'ошибка',
  completed: 'завершено',
  failed: 'ошибка',
  completed_with_errors: 'завершено с ошибками',
  running: 'выполняется',
  pending: 'ожидает',
  unknown: 'неизвестно',
  owner: 'владелец',
  admin: 'администратор',
  viewer: 'просмотр',
  normal: 'норма',
  medium: 'средняя',
  heavy: 'тяжелая',
  manual: 'вручную',
  yookassa: 'ЮКасса',
  cloudpayments: 'КлаудПэйментс',
  stripe: 'Страйп',
  registered: 'зарегистрирован',
  paid: 'оплатил',
  lost: 'потерян',
};

const reasonLabel: Record<string, string> = {
  no_subscription: 'подписка не создана',
  trial_active: 'пробный период активен',
  trial_expired: 'пробный период истёк',
  active: 'доступ активен',
  active_in_grace: 'активная подписка в льготном периоде',
  past_due: 'оплата просрочена',
  past_due_in_grace: 'просрочка в льготном периоде',
  grace_active: 'льготный период активен',
  grace_expired: 'льготный период истёк',
  canceled: 'подписка отменена',
  expired: 'подписка истекла',
  unknown_status: 'неизвестный статус',
};

const triggerSourceLabel: Record<string, string> = {
  manual: 'вручную',
  onboarding_initial: 'первый запуск',
  scheduled: 'по расписанию',
  api: 'через интеграцию',
  system: 'система',
};

const planNameLabel: Record<string, string> = {
  solo: 'Старт',
  growth: 'Рост',
  team: 'Команда',
  ops: 'Операционный',
};

export function formatDate(value: Date | string | null | undefined) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return dateFormatter.format(date);
}

export function formatDateTime(value: Date | string | null | undefined) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return dateTimeFormatter.format(date);
}

export function formatMoney(value: number | null | undefined) {
  return moneyFormatter.format(value ?? 0);
}

export function formatBytes(value: number | null | undefined) {
  const bytes = value ?? 0;
  if (bytes < 1024) return `${bytes} Б`;

  const units = ['КБ', 'МБ', 'ГБ', 'ТБ'];
  let size = bytes / 1024;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toLocaleString('ru-RU', { maximumFractionDigits: size >= 10 ? 0 : 1 })} ${units[unitIndex]}`;
}

export function formatPlural(value: number, one: string, few: string, many: string) {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function formatStatus(value: string | null | undefined) {
  if (!value) return statusLabel.unknown;
  return statusLabel[value] ?? value;
}

export function formatReason(value: string | null | undefined) {
  if (!value) return '—';
  return reasonLabel[value] ?? value;
}

export function formatTriggerSource(value: string | null | undefined) {
  if (!value) return '—';
  return triggerSourceLabel[value] ?? value;
}

export function formatPlanName(planCode: string | null | undefined, planName: string | null | undefined) {
  if (planCode && planNameLabel[planCode]) return planNameLabel[planCode];
  return planName ?? '—';
}

export function AdminPageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 border-b border-border pb-5 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-[0.32em] text-muted-foreground">Администратор платформы</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-foreground">{title}</h1>
        <p className="mt-2 max-w-3xl text-sm font-medium leading-6 text-muted-foreground">{description}</p>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function AdminPanel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-border bg-card text-card-foreground shadow-[var(--shadow-xs)] ${className}`}>
      {children}
    </section>
  );
}

export function StatTile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-[var(--shadow-xs)]">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-3 text-2xl font-black tracking-tight text-foreground">{value}</p>
      {hint ? <p className="mt-1 text-xs font-semibold text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function StatusBadge({ value, label }: { value: string | null | undefined; label?: string }) {
  const key = value ?? 'unknown';
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-bold ${badgeTone[key] ?? badgeTone.unknown}`}>
      {label ?? formatStatus(key)}
    </span>
  );
}

export function AdminTable({
  children,
  headers,
}: {
  children: ReactNode;
  headers: string[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-border text-sm">
        <thead className="bg-subtle">
          <tr>
            {headers.map((header) => (
              <th key={header} className="whitespace-nowrap px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {children}
        </tbody>
      </table>
    </div>
  );
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-subtle p-8 text-center">
      <p className="text-sm font-bold text-foreground">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

export function AdminNavLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-lg border border-border bg-card px-3 py-2 text-sm font-bold text-muted-foreground transition-colors hover:border-border-strong hover:bg-accent hover:text-foreground"
    >
      {children}
    </Link>
  );
}

export function AdminPagination({
  page,
  totalPages,
  totalItems,
  hrefForPage,
}: {
  page: number;
  totalPages: number;
  totalItems: number;
  hrefForPage: (page: number) => string;
}) {
  if (totalPages <= 1) {
    return (
      <div className="border-t border-border px-4 py-3 text-sm font-semibold text-muted-foreground">
        Записей: {totalItems}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 border-t border-border px-4 py-3 text-sm font-semibold text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      <span>Записей: {totalItems} · страница {page} из {totalPages}</span>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link href={hrefForPage(page - 1)} className="rounded-lg border border-border px-3 py-2 hover:bg-accent hover:text-foreground">
            Назад
          </Link>
        ) : null}
        {page < totalPages ? (
          <Link href={hrefForPage(page + 1)} className="rounded-lg border border-border px-3 py-2 hover:bg-accent hover:text-foreground">
            Вперёд
          </Link>
        ) : null}
      </div>
    </div>
  );
}
