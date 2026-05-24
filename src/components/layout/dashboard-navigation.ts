import {
  ArrowLeftRight,
  BellRing,
  Boxes,
  Calculator,
  ClipboardCheck,
  ClipboardList,
  HandCoins,
  LayoutDashboard,
  LayoutList,
  Megaphone,
  MessageSquareText,
  PackagePlus,
  PanelsTopLeft,
  Search,
  Settings,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

import type { TenantFeature } from '@/lib/auth/feature-access';

export type DashboardNavItem = {
  name: string;
  pageTitle: string;
  href: string;
  feature: TenantFeature;
  icon: LucideIcon;
  tone: string;
  bg: string;
};

export const dashboardNavItems: DashboardNavItem[] = [
  { name: 'Дашборд', pageTitle: 'Аналитика продаж', href: '/overview', feature: 'overview', icon: LayoutDashboard, tone: 'text-emerald-500', bg: 'bg-emerald-500/14' },
  { name: 'Что сделать', pageTitle: 'Что сделать', href: '/signals', feature: 'signals', icon: BellRing, tone: 'text-rose-500', bg: 'bg-rose-500/14' },
  { name: 'План продаж', pageTitle: 'План продаж', href: '/sales-plan', feature: 'salesPlan', icon: ClipboardList, tone: 'text-cyan-500', bg: 'bg-cyan-500/14' },
  { name: 'Себестоимость', pageTitle: 'Себестоимость', href: '/costs', feature: 'costs', icon: HandCoins, tone: 'text-cyan-500', bg: 'bg-cyan-500/14' },
  { name: 'Юнит-экономика', pageTitle: 'Юнит-экономика', href: '/economics-v2', feature: 'economics', icon: LayoutList, tone: 'text-violet-500', bg: 'bg-violet-500/14' },
  { name: 'Финансы', pageTitle: 'Финансы', href: '/finance', feature: 'finance', icon: Wallet, tone: 'text-emerald-500', bg: 'bg-emerald-500/14' },
  { name: 'АУСН', pageTitle: 'Взаимозачет АУСН по документам WB', href: '/aosn', feature: 'aosn', icon: Calculator, tone: 'text-lime-600', bg: 'bg-lime-500/14' },
  { name: 'Реклама', pageTitle: 'Реклама', href: '/advertising', feature: 'advertising', icon: Megaphone, tone: 'text-orange-500', bg: 'bg-orange-500/14' },
  { name: 'SEO', pageTitle: 'SEO карточек', href: '/seo', feature: 'seo', icon: Search, tone: 'text-sky-500', bg: 'bg-sky-500/14' },
  { name: 'Остатки', pageTitle: 'Остатки', href: '/stocks-v2', feature: 'stocks', icon: Boxes, tone: 'text-amber-500', bg: 'bg-amber-500/14' },
  { name: 'Динамика (РНП)', pageTitle: 'Динамика (РНП)', href: '/dynamics', feature: 'dynamics', icon: PanelsTopLeft, tone: 'text-cyan-500', bg: 'bg-cyan-500/14' },
  { name: 'Перераспределение', pageTitle: 'Что куда везти', href: '/redistribution', feature: 'redistribution', icon: ArrowLeftRight, tone: 'text-teal-500', bg: 'bg-teal-500/14' },
  { name: 'Поставка', pageTitle: 'Поставка', href: '/supply', feature: 'supply', icon: PackagePlus, tone: 'text-rose-500', bg: 'bg-rose-500/14' },
  { name: 'Отзывы', pageTitle: 'Отзывы и вопросы', href: '/reviews-qa', feature: 'reviews', icon: MessageSquareText, tone: 'text-fuchsia-500', bg: 'bg-fuchsia-500/14' },
  { name: 'Согласования', pageTitle: 'Согласования', href: '/approvals', feature: 'approvals', icon: ClipboardCheck, tone: 'text-rose-500', bg: 'bg-rose-500/14' },
  { name: 'Настройки', pageTitle: 'Настройки', href: '/settings', feature: 'settings', icon: Settings, tone: 'text-slate-500', bg: 'bg-slate-500/14' },
];

const routeTitles = [
  ...dashboardNavItems.map((item) => ({ href: item.href, title: item.pageTitle })),
  { href: '/stocks-v2/all-stock', title: 'Все остатки' },
  { href: '/stocks-v2/localization', title: 'Локализация' },
  { href: '/stocks-v2/own-stock', title: 'Свой склад' },
  { href: '/stocks-v2/china-stock', title: 'Склад Китай' },
  { href: '/stocks-v2/batches', title: 'Партии' },
  { href: '/stocks-v2/by-warehouse', title: 'По складам' },
  { href: '/stocks-v2/wb-supplies', title: 'WB-поставки' },
  { href: '/overview-test', title: 'Тестовая вкладка' },
  { href: '/explorer', title: 'Проводник данных' },
  { href: '/cabinets', title: 'Управление командой' },
  { href: '/supply/delivery-plan', title: 'План поставки' },
  { href: '/supply/invoice', title: 'Накладная' },
  { href: '/supply/barcodes', title: 'ШК коробов' },
].sort((left, right) => right.href.length - left.href.length);

export function isActiveDashboardPath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function getDashboardPageTitle(pathname: string | null) {
  const currentPath = pathname ?? '/overview';
  return routeTitles.find((item) => isActiveDashboardPath(currentPath, item.href))?.title ?? 'Zen Monitor';
}
