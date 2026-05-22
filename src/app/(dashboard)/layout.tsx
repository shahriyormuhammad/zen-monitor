import { MobileDashboardNav, Sidebar } from '@/components/layout/Sidebar';
import { DashboardDataFreshnessControls } from '@/components/dashboard/DashboardDataFreshnessControls';
import { DashboardNavigationFeedback } from '@/components/layout/DashboardNavigationFeedback';
import { Header } from '@/components/layout/Header';
import { PlatformImpersonationBanner } from '@/components/layout/PlatformImpersonationBanner';
import { StoreInitializer } from '@/components/layout/StoreInitializer';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen overflow-hidden bg-[#f4f7fb] text-foreground dark:bg-[#050609]">
      <StoreInitializer />
      <DashboardNavigationFeedback />
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header />
        <PlatformImpersonationBanner />
        <main className="dashboard-scroll flex-1 overflow-auto bg-[#f4f7fb] p-4 pb-24 text-foreground dark:bg-[#050609] md:pb-4 lg:p-6">
          <div className="dashboard-zoom-target mx-auto w-full max-w-[var(--dashboard-content-max-width)]">
            <DashboardDataFreshnessControls />
            {children}
          </div>
        </main>
      </div>
      <MobileDashboardNav />
    </div>
  );
}
