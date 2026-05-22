'use client';

import { useStore, type UserRole } from '@/store/useStore';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getTenantSettings, getAvailableTenants, switchActiveTenant } from '@/app/(dashboard)/settings/actions';
import type { TenantFeaturePermissions } from '@/lib/auth/feature-access';

type TenantOption = {
  id: string | null;
  name: string | null;
  shopName: string | null;
  role: string;
  accessPreset: string | null;
  featurePermissions: TenantFeaturePermissions;
  hasStoredToken: boolean;
  wbTokenHealthStatus: 'unknown' | 'healthy' | 'warning' | 'invalid' | null;
  wbTokenCheckedAt: Date | null;
  wbLkSessionStatus: 'unknown' | 'healthy' | 'warning' | 'invalid';
};

function getTokenBadge(hasStoredToken: boolean, status?: TenantOption['wbTokenHealthStatus']) {
  if (!hasStoredToken) {
    return {
      tone: 'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400',
      label: 'Без токена',
    };
  }

  if (status === 'healthy') {
    return {
      tone: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-900/20 dark:text-emerald-300',
      label: 'OK',
    };
  }

  if (status === 'invalid') {
    return {
      tone: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800/40 dark:bg-rose-900/20 dark:text-rose-300',
      label: 'Риск',
    };
  }

  if (status === 'warning') {
    return {
      tone: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-300',
      label: 'Предупр.',
    };
  }

  return {
    tone: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800/40 dark:bg-blue-900/20 dark:text-blue-300',
    label: 'Не проверен',
  };
}

export function TenantSwitcher() {
  const { tenantId, setTenantId, setUserRole, setFeaturePermissions, setNeedsTenantSetup } = useStore();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  // 1. Текущий активный кабинет
  const { data: tenant } = useQuery({
    queryKey: ['tenant', tenantId],
    queryFn: () => tenantId ? getTenantSettings(tenantId) : null,
    enabled: !!tenantId,
  });

  // 2. Список всех доступных кабинетов
  const { data: allTenants = [] } = useQuery<TenantOption[]>({
    queryKey: ['available-tenants', tenantId],
    queryFn: () => getAvailableTenants(),
  });
  const validTenants = allTenants.filter((tenant): tenant is TenantOption & { id: string } => Boolean(tenant.id));
  const activeHealthBadge = getTokenBadge(tenant?.hasStoredToken ?? false, tenant?.tokenHealth?.status);

  // 3. Мутация для смены кабинета
  const switchMutation = useMutation({
    mutationFn: (id: string) => switchActiveTenant(id),
    onSuccess: (result, newId) => {
      setTenantId(newId);
      setUserRole(result.role as UserRole);
      setFeaturePermissions(result.featurePermissions);
      setNeedsTenantSetup(false);
      queryClient.invalidateQueries({ queryKey: ['tenant'] });
      queryClient.invalidateQueries({ queryKey: ['available-tenants'] });
      setIsOpen(false);
    }
  });

  // Клик вне списка для закрытия
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={dropdownRef}>
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="group flex h-9 min-w-[172px] max-w-[190px] cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-2.5 py-1 text-left shadow-sm outline-none transition-all hover:border-emerald-300 hover:shadow-md dark:border-slate-700 dark:bg-slate-800 dark:hover:border-emerald-600 dark:hover:shadow-lg"
      >
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-xs font-bold text-emerald-600 shadow-inner transition-colors group-hover:bg-emerald-200">
          {tenant?.shopName?.[0]?.toUpperCase() || tenant?.name?.[0]?.toUpperCase() || 'W'}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[8px] font-bold uppercase leading-none tracking-[0.18em] text-slate-400">Кабинет</div>
          <div className="mt-0.5 truncate text-[13px] font-bold leading-none text-slate-800 dark:text-slate-100">
            {tenant?.shopName || tenant?.name || 'Выбрать'}
          </div>
        </div>
        <span className={`hidden rounded-full border px-1.5 py-0.5 text-[7px] font-bold uppercase tracking-widest 2xl:inline-flex ${activeHealthBadge.tone}`}>
          {activeHealthBadge.label}
        </span>
        <svg xmlns="http://www.w3.org/2000/svg" className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Выпадающее меню */}
      {isOpen && (
        <div className="absolute left-0 top-full z-50 mt-2 min-w-[260px] overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-2xl animate-in fade-in slide-in-from-top-2 duration-200 dark:border-slate-700 dark:bg-slate-800 dark:shadow-slate-900">
          <div className="p-2 max-h-[300px] overflow-y-auto">
            {validTenants.map((t) => {
              const badge = getTokenBadge(t.hasStoredToken, t.wbTokenHealthStatus);

              return (
              <button
                key={t.id}
                onClick={() => switchMutation.mutate(t.id)}
                disabled={t.id === tenantId}
                className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all text-left ${
                  t.id === tenantId
                    ? 'bg-slate-50 cursor-default opacity-80 dark:bg-slate-800/50'
                    : 'hover:bg-emerald-50 active:scale-[0.98] dark:hover:bg-emerald-900/20'
                }`}
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs ${
                  t.id === tenantId ? 'bg-emerald-200 text-emerald-700' : 'bg-slate-100 text-slate-500'
                }`}>
                  {t.shopName?.[0]?.toUpperCase() || t.name?.[0]?.toUpperCase() || 'W'}
                </div>
                <div className="flex-1 overflow-hidden">
                  <div className="text-sm font-bold text-slate-800 truncate">{t.shopName || t.name}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <div className="text-[10px] text-slate-400 font-medium capitalize">{t.role}</div>
                    <span className={`rounded-full border px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest ${badge.tone}`}>
                      {badge.label}
                    </span>
                  </div>
                </div>
                {t.id === tenantId && (
                  <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                )}
              </button>
            )})}
          </div>
          <div className="p-2 border-t border-slate-50 bg-slate-50/50 dark:border-slate-700 dark:bg-slate-800/50">
            <Link 
              href="/settings"
              prefetch={false}
              onClick={() => setIsOpen(false)}
              className="w-full flex items-center justify-center gap-2 p-2 rounded-lg text-xs font-bold text-emerald-600 hover:text-emerald-700 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              Добавить кабинет
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
