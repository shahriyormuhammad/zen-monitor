'use client';

import Link from 'next/link';
import { HelpCircle, Sparkles, UserCircle2 } from 'lucide-react';
import { usePathname } from 'next/navigation';

import { ThemeToggle } from '@/components/ThemeToggle';

import { DashboardScaleControl } from './DashboardScaleControl';
import { getDashboardPageTitle } from './dashboard-navigation';
import { SignalNotificationsMenu } from './SignalNotificationsMenu';
import { TenantSwitcher } from './TenantSwitcher';
import { WBNewsMenu } from './WBNewsMenu';

export function Header() {
  const pathname = usePathname();
  const pageTitle = getDashboardPageTitle(pathname);

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-card/88 px-3 py-1.5 shadow-[var(--shadow-xs)] backdrop-blur-xl dark:bg-[#08090d]/88 lg:px-5">
      <div className="flex min-h-11 items-center gap-3">
        <div className="min-w-[190px] shrink-0 lg:min-w-[250px]">
          <p className="text-[10px] font-bold uppercase tracking-[0.34em] text-muted-foreground">Про цифры</p>
          <h1 className="mt-0.5 truncate text-lg font-extrabold tracking-tight text-foreground xl:text-xl">
            {pageTitle}
          </h1>
        </div>

        <DashboardScaleControl />

        <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
          <WBNewsMenu />
          <button
            type="button"
            className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-border bg-subtle text-muted-foreground transition-colors hover:border-border-strong hover:bg-accent hover:text-foreground lg:inline-flex"
            title="Помощь по странице"
          >
            <HelpCircle className="h-3.5 w-3.5" />
          </button>

          <Link
            href="/reviews-qa"
            prefetch={false}
            className="hidden h-8 shrink-0 items-center gap-1.5 rounded-xl border border-violet-400/30 bg-[linear-gradient(135deg,#6366f1,#d946ef)] px-2.5 text-[11px] font-black text-white shadow-[0_12px_28px_-18px_rgba(168,85,247,0.9)] transition-transform hover:-translate-y-0.5 xl:inline-flex"
          >
            <Sparkles className="h-3.5 w-3.5" />
            AI
          </Link>

          <div className="hidden shrink-0 xl:block">
            <TenantSwitcher />
          </div>

          <SignalNotificationsMenu />
          <ThemeToggle />

          <Link
            href="/settings"
            prefetch={false}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground shadow-xs transition-colors hover:border-border-strong hover:bg-accent hover:text-foreground"
            title="Профиль"
            aria-label="Профиль"
          >
            <UserCircle2 className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </header>
  );
}
