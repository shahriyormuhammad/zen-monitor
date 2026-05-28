'use client';

/**
 * Поставка — main dashboard page with four sub-tabs (Постал-mirrored):
 *
 *   • План поставки — distribute new article boxes across okrugs by
 *     historical orders (panel-delivery-plan).
 *   • Шаг 1: Создать поставку — pick article + ростовка + boxes →
 *     accumulate supplyList → XLSX export (panel-plan / step-supply).
 *   • Шаг 2: Накладная — bulk-import «артикул × коробок» rows with
 *     fuzzy match (step-invoice).
 *   • Шаг 3: ШК коробов — generate sequential box barcodes from the
 *     accumulated supplyList (step-barcodes).
 */

import { useState } from 'react';
import { ClipboardList, FileText, MapPin, QrCode } from 'lucide-react';

import { DeliveryPlanTab } from '@/components/supply/DeliveryPlanTab';
import { SupplyStep1Tab } from '@/components/supply/SupplyStep1Tab';
import { InvoiceTab } from '@/components/supply/InvoiceTab';
import { BarcodesTab } from '@/components/supply/BarcodesTab';

type Step = 'delivery-plan' | 'step-1' | 'invoice' | 'barcodes';

const TABS: { key: Step; label: string; sub: string; icon: typeof ClipboardList }[] = [
  { key: 'delivery-plan', label: 'План поставки',  sub: 'Распределение по округам',  icon: MapPin },
  { key: 'step-1',        label: 'Шаг 1: Создать', sub: 'Артикул + ростовка + XLSX', icon: ClipboardList },
  { key: 'invoice',       label: 'Шаг 2: Накладная', sub: 'Артикул × коробок',         icon: FileText },
  { key: 'barcodes',      label: 'Шаг 3: ШК коробов', sub: 'Генерация + XLSX',         icon: QrCode },
];

export function SupplyPageClient({ tenantId }: { tenantId: string }) {
  const [step, setStep] = useState<Step>('delivery-plan');

  return (
    <div className="space-y-4 pb-10">
      {/* Sub-tabs */}
      <nav className="flex flex-wrap gap-2">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = step === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setStep(tab.key)}
              className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors ${
                active
                  ? 'border-rose-500/40 bg-rose-50 text-rose-800 shadow-sm dark:bg-rose-950/40 dark:text-rose-200'
                  : 'border-border bg-card text-foreground hover:border-rose-300'
              }`}
            >
              <Icon className={`h-5 w-5 ${active ? 'text-rose-500' : 'text-muted-foreground'}`} />
              <span className="flex flex-col leading-tight">
                <span className="text-[12px] font-bold">{tab.label}</span>
                <span className="text-[10px] text-muted-foreground">{tab.sub}</span>
              </span>
            </button>
          );
        })}
      </nav>

      {/* Active step */}
      {step === 'delivery-plan' && <DeliveryPlanTab tenantId={tenantId} />}
      {step === 'step-1' && <SupplyStep1Tab tenantId={tenantId} />}
      {step === 'invoice' && <InvoiceTab tenantId={tenantId} />}
      {step === 'barcodes' && <BarcodesTab tenantId={tenantId} />}
    </div>
  );
}
