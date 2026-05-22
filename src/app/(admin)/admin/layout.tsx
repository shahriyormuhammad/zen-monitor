import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { AppError } from '@/lib/errors';
import { requirePlatformAdmin } from '@/lib/auth/platform-admin';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  try {
    await requirePlatformAdmin();
  } catch (error) {
    if (error instanceof AppError && error.status === 401) {
      redirect('/login');
    }
    throw error;
  }

  return (
    <div className="min-h-screen bg-[#f4f7fb] text-foreground dark:bg-[#050609]">
      <header className="sticky top-0 z-30 border-b border-border bg-card/90 px-4 py-3 shadow-[var(--shadow-xs)] backdrop-blur-xl dark:bg-[#08090d]/90 lg:px-6">
        <div className="mx-auto flex max-w-[1780px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Link href="/admin" className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.32em] text-muted-foreground">Внутренняя панель</p>
            <p className="mt-1 text-lg font-black tracking-tight text-foreground">Zen Monitor: админка</p>
          </Link>

          <nav className="flex flex-wrap gap-2">
            <Link className="rounded-lg px-3 py-2 text-sm font-bold text-muted-foreground hover:bg-accent hover:text-foreground" href="/admin">
              Сводка
            </Link>
            <Link className="rounded-lg px-3 py-2 text-sm font-bold text-muted-foreground hover:bg-accent hover:text-foreground" href="/admin/customers">
              Аккаунты
            </Link>
            <Link className="rounded-lg px-3 py-2 text-sm font-bold text-muted-foreground hover:bg-accent hover:text-foreground" href="/admin/leads">
              Лиды
            </Link>
            <Link className="rounded-lg px-3 py-2 text-sm font-bold text-muted-foreground hover:bg-accent hover:text-foreground" href="/admin/subscriptions">
              Подписки
            </Link>
            <Link className="rounded-lg px-3 py-2 text-sm font-bold text-muted-foreground hover:bg-accent hover:text-foreground" href="/admin/ops/storage">
              Хранилище
            </Link>
            <Link className="rounded-lg px-3 py-2 text-sm font-bold text-muted-foreground hover:bg-accent hover:text-foreground" href="/overview">
              В продукт
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-[1780px] px-4 py-6 lg:px-6">
        {children}
      </main>
    </div>
  );
}
