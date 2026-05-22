import { create } from 'zustand';
import { subDays } from 'date-fns';
import type { TenantFeaturePermissions } from '@/lib/auth/feature-access';

export type UserRole = 'owner' | 'admin' | 'manager' | 'viewer';

const DATE_RANGE_STORAGE_KEY = 'procifry:date-range:v1';

interface GlobalState {
  tenantId: string | null;
  userRole: UserRole | null;
  featurePermissions: TenantFeaturePermissions | null;
  needsTenantSetup: boolean;
  dateFrom: Date;
  dateTo: Date;
  setTenantId: (id: string | null) => void;
  setUserRole: (role: UserRole | null) => void;
  setFeaturePermissions: (permissions: TenantFeaturePermissions | null) => void;
  setNeedsTenantSetup: (needsSetup: boolean) => void;
  setDateRange: (from: Date, to: Date) => void;
}

function dayOnly(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function dateKey(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function parseDateKey(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function defaultDateRange() {
  const dateTo = dayOnly(new Date());
  return {
    dateFrom: subDays(dateTo, 29),
    dateTo,
  };
}

function readStoredDateRange() {
  const fallback = defaultDateRange();
  if (typeof window === 'undefined') return fallback;

  try {
    const raw = window.localStorage.getItem(DATE_RANGE_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const dateFrom = parseDateKey(parsed.dateFrom);
    const dateTo = parseDateKey(parsed.dateTo);
    if (!dateFrom || !dateTo || dateFrom > dateTo) return fallback;
    return { dateFrom, dateTo };
  } catch {
    return fallback;
  }
}

function writeStoredDateRange(from: Date, to: Date) {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(DATE_RANGE_STORAGE_KEY, JSON.stringify({
      dateFrom: dateKey(from),
      dateTo: dateKey(to),
    }));
  } catch {
    // Storage can be unavailable in restricted browser modes.
  }
}

const initialDateRange = readStoredDateRange();

export const useStore = create<GlobalState>((set) => ({
  tenantId: null,
  userRole: null,
  featurePermissions: null,
  needsTenantSetup: false,
  dateFrom: initialDateRange.dateFrom,
  dateTo: initialDateRange.dateTo,
  setTenantId: (id) => set({ tenantId: id }),
  setUserRole: (role) => set({ userRole: role }),
  setFeaturePermissions: (permissions) => set({ featurePermissions: permissions }),
  setNeedsTenantSetup: (needsSetup) => set({ needsTenantSetup: needsSetup }),
  setDateRange: (from, to) => {
    const nextFrom = dayOnly(from);
    const nextTo = dayOnly(to);
    writeStoredDateRange(nextFrom, nextTo);
    set({ dateFrom: nextFrom, dateTo: nextTo });
  },
}));
