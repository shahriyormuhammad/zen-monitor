'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { GripVertical } from 'lucide-react';
import { userCanAccessFeature } from '@/lib/auth/feature-access';
import { useStore } from '@/store/useStore';
import { dashboardNavItems, isActiveDashboardPath, type DashboardNavItem } from './dashboard-navigation';
import { ZenMonitorLogo } from '@/components/brand/ZenMonitorLogo';

const DEFAULT_NAV_ORDER = dashboardNavItems.map((item) => item.href);
const SIDEBAR_NAV_ORDER_STORAGE_KEY = 'dashboard-sidebar-nav-order:v1';
const INTERNAL_APPROVALS_TENANT_IDS = new Set([
  'ae0b36db-1b98-44e0-bda3-0014691824c0',
  '8c5ec45d-c1c5-47ee-b22d-00ae7f689e76',
]);

function normalizeNavOrder(order: unknown) {
  const knownHrefs = new Set(DEFAULT_NAV_ORDER);
  const storedOrder = Array.isArray(order)
    ? order.filter((href): href is string => typeof href === 'string' && knownHrefs.has(href))
    : [];
  const storedHrefSet = new Set(storedOrder);

  return [
    ...storedOrder,
    ...DEFAULT_NAV_ORDER.filter((href) => !storedHrefSet.has(href)),
  ];
}

function readStoredNavOrder() {
  if (typeof window === 'undefined') {
    return DEFAULT_NAV_ORDER;
  }

  try {
    return normalizeNavOrder(JSON.parse(window.localStorage.getItem(SIDEBAR_NAV_ORDER_STORAGE_KEY) ?? 'null'));
  } catch {
    return DEFAULT_NAV_ORDER;
  }
}

function orderNavItems(items: DashboardNavItem[], order: string[]) {
  const orderIndex = new Map(order.map((href, index) => [href, index]));

  return [...items].sort((left, right) => (
    (orderIndex.get(left.href) ?? Number.MAX_SAFE_INTEGER)
    - (orderIndex.get(right.href) ?? Number.MAX_SAFE_INTEGER)
  ));
}

function canShowNavItem(
  item: DashboardNavItem,
  tenantId: string | null,
  userRole: string | null,
  featurePermissions: Parameters<typeof userCanAccessFeature>[1],
) {
  if (item.feature === 'approvals') {
    return Boolean(
      tenantId
      && INTERNAL_APPROVALS_TENANT_IDS.has(tenantId)
      && userRole
      && userCanAccessFeature(userRole, featurePermissions, item.feature),
    );
  }

  return !userRole || userCanAccessFeature(userRole, featurePermissions, item.feature);
}

export function Sidebar() {
  const pathname = usePathname();
  const { tenantId, userRole, featurePermissions } = useStore();
  const [navOrder, setNavOrder] = useState(DEFAULT_NAV_ORDER);
  const navOrderLoadedRef = useRef(false);
  const [draggingHref, setDraggingHref] = useState<string | null>(null);
  const [dragOverHref, setDragOverHref] = useState<string | null>(null);
  const visibleItems = useMemo(() => (
    orderNavItems(
      dashboardNavItems.filter((item) => canShowNavItem(item, tenantId, userRole, featurePermissions)),
      navOrder,
    )
  ), [featurePermissions, navOrder, tenantId, userRole]);

  useEffect(() => {
    queueMicrotask(() => {
      navOrderLoadedRef.current = true;
      setNavOrder(readStoredNavOrder());
    });
  }, []);

  useEffect(() => {
    if (!navOrderLoadedRef.current) {
      return;
    }

    window.localStorage.setItem(SIDEBAR_NAV_ORDER_STORAGE_KEY, JSON.stringify(navOrder));
  }, [navOrder]);

  function moveNavItem(sourceHref: string, targetHref: string) {
    if (sourceHref === targetHref) {
      return;
    }

    setNavOrder((currentOrder) => {
      const nextOrder = normalizeNavOrder(currentOrder);
      const sourceIndex = nextOrder.indexOf(sourceHref);
      const targetIndex = nextOrder.indexOf(targetHref);

      if (sourceIndex === -1 || targetIndex === -1) {
        return currentOrder;
      }

      const [movedHref] = nextOrder.splice(sourceIndex, 1);
      if (!movedHref) {
        return currentOrder;
      }
      nextOrder.splice(targetIndex, 0, movedHref);

      return nextOrder;
    });
  }

  return (
    <aside className="group relative z-[80] hidden h-screen w-[76px] shrink-0 md:block">
      <div className="absolute inset-y-0 left-0 flex w-[76px] flex-col overflow-hidden border-r border-border bg-card text-card-foreground shadow-[var(--shadow-sm)] transition-[width,box-shadow] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] group-hover:w-[338px] group-hover:shadow-[0_24px_80px_-38px_rgba(15,23,42,0.45)] motion-reduce:transition-none dark:bg-[#08090d]">
        <div className="flex h-[92px] shrink-0 items-center gap-4 border-b border-border px-4">
          <Link
            href="/overview"
            prefetch={false}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl transition-transform hover:-translate-y-0.5"
            title="Zen Monitor"
            aria-label="Zen Monitor"
          >
            <ZenMonitorLogo size={48} />
          </Link>
          <div className="min-w-0 opacity-0 transition-opacity delay-0 duration-200 group-hover:opacity-100 group-hover:delay-150">
            <p className="truncate text-xl font-black tracking-tight text-foreground">Zen Monitor</p>
            <p className="truncate text-sm font-semibold text-muted-foreground">аналитика Вайлдберриз</p>
          </div>
        </div>

        <nav className="sidebar-scroll flex flex-1 flex-col gap-2 overflow-y-auto px-3 py-5">
          {visibleItems.map((item) => {
            const Icon = item.icon;
            const active = isActiveDashboardPath(pathname, item.href);

            return (
              <div
                key={`${item.href}-${item.name}`}
                onDragOver={(event) => {
                  if (!draggingHref || draggingHref === item.href) {
                    return;
                  }
                  event.preventDefault();
                  setDragOverHref((currentHref) => (currentHref === item.href ? currentHref : item.href));
                }}
                onDragLeave={() => {
                  setDragOverHref((currentHref) => (currentHref === item.href ? null : currentHref));
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const sourceHref = event.dataTransfer.getData('text/plain') || draggingHref;
                  if (sourceHref) {
                    moveNavItem(sourceHref, item.href);
                  }
                  setDraggingHref(null);
                  setDragOverHref(null);
                }}
                className={`group/item relative block h-12 w-full min-w-0 overflow-hidden rounded-2xl border transition-all ${
                  active
                    ? 'border-cyan-500/25 bg-cyan-500/12 text-foreground shadow-[var(--shadow-sm)]'
                    : 'border-transparent text-muted-foreground hover:border-border-strong hover:bg-accent hover:text-foreground'
                } ${draggingHref === item.href ? 'opacity-50' : ''} ${dragOverHref === item.href ? 'ring-2 ring-cyan-400/35' : ''}`}
              >
                <Link
                  href={item.href}
                  prefetch={false}
                  title={item.name}
                  aria-label={item.name}
                  draggable={false}
                  className="block h-full w-full min-w-0"
                >
                  <span className="absolute left-1.5 flex h-full w-10 items-center justify-center">
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${active ? 'bg-emerald-500/16' : item.bg}`}>
                      <Icon
                        className={`h-5 w-5 transition-colors ${
                          active ? 'text-emerald-500' : item.tone
                        }`}
                        strokeWidth={2.15}
                      />
                    </span>
                  </span>
                  <span className="absolute left-16 right-12 top-1/2 min-w-0 -translate-y-1/2 truncate text-base font-semibold opacity-0 transition-opacity delay-0 duration-200 group-hover:opacity-100 group-hover:delay-150">
                    {item.name}
                  </span>
                </Link>
                {active ? (
                  <span className="absolute right-10 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-cyan-400 opacity-0 shadow-[0_0_18px_rgba(34,211,238,0.95)] transition-opacity delay-0 duration-200 group-hover:opacity-100 group-hover:delay-150" />
                ) : null}
                <button
                  type="button"
                  aria-label={`Переместить раздел ${item.name}`}
                  title="Перетащить раздел"
                  draggable
                  onClick={(event) => {
                    event.preventDefault();
                  }}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', item.href);
                    setDraggingHref(item.href);
                  }}
                  onDragEnd={() => {
                    setDraggingHref(null);
                    setDragOverHref(null);
                  }}
                  className="pointer-events-none absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-xl border border-transparent text-muted-foreground/70 opacity-0 transition-all delay-0 duration-150 hover:border-border hover:bg-background hover:text-foreground group-hover:pointer-events-auto group-hover:opacity-100 group-hover:delay-150"
                >
                  <GripVertical className="h-4 w-4" strokeWidth={2.2} />
                </button>
              </div>
            );
          })}
        </nav>

      </div>
    </aside>
  );
}

export function MobileDashboardNav() {
  const pathname = usePathname();
  const { tenantId, userRole, featurePermissions } = useStore();
  const visibleItems = dashboardNavItems.filter((item) => canShowNavItem(item, tenantId, userRole, featurePermissions));

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/94 px-3 py-2 shadow-[0_-12px_28px_-22px_rgba(15,23,42,0.55)] backdrop-blur-xl md:hidden dark:bg-[#08090d]/94">
      <div className="flex gap-2 overflow-x-auto">
        {visibleItems.map((item) => {
          const Icon = item.icon;
          const active = isActiveDashboardPath(pathname, item.href);

          return (
            <Link
              key={`${item.href}-${item.name}`}
              href={item.href}
              prefetch={false}
              aria-label={item.name}
              className={`flex min-w-[62px] flex-col items-center justify-center gap-1 rounded-2xl border px-2 py-2 text-[10px] font-bold transition-colors ${
                active
                  ? 'border-cyan-500/30 bg-cyan-500 text-white'
                  : 'border-transparent text-muted-foreground hover:bg-accent hover:text-foreground'
              }`}
            >
              <Icon className={`h-4 w-4 ${active ? 'text-white' : item.tone}`} />
              <span className="max-w-[54px] truncate">{item.name}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
