'use client';

/**
 * Поставка — single dashboard page with three sub-tabs ported from Postal:
 *   • План поставки  → distribute new article boxes across okrugs
 *   • Накладная      → bulk-import a printed invoice and resolve rostvka
 *   • ШК коробов     → generate sequential box barcodes + XLSX
 *
 * MVP: the «План поставки» tab is functional; «Накладная» and «ШК коробов»
 * follow in the next deploys but already render the shell so the user sees
 * the full flow.
 */

import { useState } from 'react';
import { ClipboardList, FileText, QrCode } from 'lucide-react';

import { DeliveryPlanTab } from '@/components/supply/DeliveryPlanTab';
import { InvoiceTab } from '@/components/supply/InvoiceTab';
import { BarcodesTab } from '@/components/supply/BarcodesTab';

type Step = 'plan' | 'invoice' | 'barcodes';

const TABS: { key: Step; label: string; sub: string; icon: typeof ClipboardList }[] = [
  { key: 'plan',     label: 'Шаг 1: План поставки', sub: 'Распределение по округам', icon: ClipboardList },
  { key: 'invoice',  label: 'Шаг 2: Накладная',     sub: 'Артикул × коробок',         icon: FileText },
  { key: 'barcodes', label: 'Шаг 3: ШК коробов',    sub: 'Генерация + XLSX',         icon: QrCode },
];

export function SupplyPageClient({ tenantId }: { tenantId: string }) {
  const [step, setStep] = useState<Step>('plan');

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
      {step === 'plan' && <DeliveryPlanTab tenantId={tenantId} />}
      {step === 'invoice' && <InvoiceTab tenantId={tenantId} />}
      {step === 'barcodes' && <BarcodesTab tenantId={tenantId} />}
    </div>
  );
}
