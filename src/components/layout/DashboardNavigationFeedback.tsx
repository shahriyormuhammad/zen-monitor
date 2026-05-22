'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

type PendingNavigation = {
  fromPathname: string;
};

const MAX_PENDING_MS = 20_000;

function getPendingNavigation(event: MouseEvent): PendingNavigation | null {
  if (
    event.defaultPrevented
    || event.button !== 0
    || event.metaKey
    || event.ctrlKey
    || event.shiftKey
    || event.altKey
  ) {
    return null;
  }

  const target = event.target instanceof Element ? event.target : null;
  const link = target?.closest('a[href]');
  if (!(link instanceof HTMLAnchorElement)) {
    return null;
  }

  const href = link.getAttribute('href');
  if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) {
    return null;
  }
  if ((link.target && link.target !== '_self') || link.hasAttribute('download')) {
    return null;
  }

  const nextUrl = new URL(link.href, window.location.href);
  if (nextUrl.origin !== window.location.origin) {
    return null;
  }
  if (nextUrl.pathname === window.location.pathname) {
    return null;
  }

  return {
    fromPathname: window.location.pathname,
  };
}

export function DashboardNavigationFeedback() {
  const pathname = usePathname();
  const clearTimerRef = useRef<number | null>(null);
  const [pending, setPending] = useState<PendingNavigation | null>(null);

  useEffect(() => {
    function clearPendingTimer() {
      if (clearTimerRef.current !== null) {
        window.clearTimeout(clearTimerRef.current);
        clearTimerRef.current = null;
      }
    }

    function handleClick(event: MouseEvent) {
      const nextPending = getPendingNavigation(event);
      if (!nextPending) {
        return;
      }

      clearPendingTimer();
      setPending(nextPending);
      clearTimerRef.current = window.setTimeout(() => {
        setPending(null);
        clearTimerRef.current = null;
      }, MAX_PENDING_MS);
    }

    document.addEventListener('click', handleClick, true);

    return () => {
      document.removeEventListener('click', handleClick, true);
      clearPendingTimer();
    };
  }, []);

  const visiblePending = pending?.fromPathname === pathname ? pending : null;

  if (!visiblePending) {
    return null;
  }

  return (
    <div
      data-testid="dashboard-navigation-feedback"
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-[90] md:left-[76px]"
    >
      <div className="h-1 overflow-hidden bg-cyan-500/10">
        <div className="dashboard-route-progress h-full w-1/3 bg-cyan-400 shadow-[0_0_18px_rgba(34,211,238,0.9)]" />
      </div>
    </div>
  );
}
