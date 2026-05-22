export const OPEN_EXPENSE_BREAKDOWN_EVENT = 'enterprise-wb-analytics:open-expense-breakdown';
export const OPEN_KPI_DRILLDOWN_EVENT = 'enterprise-wb-analytics:open-kpi-drilldown';

export type KpiDrilldownMetric = 'finance' | 'orders' | 'buyouts' | 'ads' | 'storage' | 'stocks' | 'spp' | 'conversion';

export function dispatchOpenExpenseBreakdown() {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new Event(OPEN_EXPENSE_BREAKDOWN_EVENT));
}

export function dispatchOpenKpiDrilldown(metric: KpiDrilldownMetric) {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new CustomEvent(OPEN_KPI_DRILLDOWN_EVENT, { detail: { metric } }));
}
