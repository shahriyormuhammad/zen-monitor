'use client';

import { toNumber } from '../helpers';
import type {
  ManualFields,
  PriceScenarioId,
  RowSummary,
  UnitTemplateRow,
} from '../types';
import { COLUMNS, STRONG_GROUP_SEPARATOR_COLUMNS, resolveStickyIdentityColumnClass, resolveStrictWidthClasses } from './columns';
import { resolveCellText, INTERACTIVE_COLUMN } from './cellValue';
import { NumberInput } from './NumberInput';

const GRID_BORDER = 'border-border/90';
const SEPARATOR_FILL = 'bg-muted';

/** First scenario-aware column id — everything before stays empty in scenario rows. */
const FINANCE_DETAIL_START = 'price';
const FINANCE_DETAIL_START_INDEX = COLUMNS.findIndex((c) => c.id === FINANCE_DETAIL_START);

/** Tag the scenario chip with a coloured pill that's readable in both themes. */
const SCENARIO_LABEL_CLASS: Record<PriceScenarioId, string> = {
  excellent: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  good: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  average: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  poor: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
};

type ScenarioRowProps = {
  scenarioId: PriceScenarioId;
  scenarioLabel: string;
  row: UnitTemplateRow;
  manualFields: ManualFields;
  scenarioSummary: RowSummary;
  isActive: boolean;
  onSetActive: () => void;
  onUpdate: (next: ManualFields) => void;
};

/**
 * Renders a single scenario row inside the main `<tbody>`. Mirrors the legacy
 * monolith layout (UnitEconomicsTemplateTable.tsx ~lines 4127-4169 +
 * `renderScenarioExpandedCell` ~3174-3303).
 *
 * Cells before the «price» column are blank; from «price» onwards each cell
 * either becomes an editable input (price / discounts / buyout / marketing /
 * purchase qty / turnover) or shows a read-only number derived from
 * `scenarioSummary` for that specific scenario id.
 */
export function ScenarioRow({
  scenarioId,
  scenarioLabel,
  row,
  manualFields,
  scenarioSummary,
  isActive,
  onSetActive,
  onUpdate,
}: ScenarioRowProps) {
  const scenarioDraft = manualFields.priceScenarios[scenarioId];
  const soldQuantity = toNumber(row.soldQuantity);

  const updateScenario = (
    key: 'sellerPriceBeforeDiscount' | 'sellerDiscount' | 'wbDiscount' | 'buyoutPercent',
    value: string,
  ) => {
    onUpdate({
      ...manualFields,
      priceScenarios: {
        ...manualFields.priceScenarios,
        [scenarioId]: { ...scenarioDraft, [key]: value },
      },
    });
  };
  const updateField = (key: keyof ManualFields, value: string) => {
    onUpdate({ ...manualFields, [key]: value });
  };

  const renderScenarioCell = (columnId: string): React.ReactNode => {
    switch (columnId) {
      case 'price':
        return (
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center justify-end gap-2">
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${SCENARIO_LABEL_CLASS[scenarioId]}`}
              >
                {scenarioLabel}
              </span>
              <button
                type="button"
                onClick={onSetActive}
                className={`rounded-md px-2 py-0.5 text-[10px] font-bold transition-colors ${
                  isActive
                    ? 'bg-emerald-600 text-white'
                    : 'bg-muted text-foreground hover:bg-muted/70'
                }`}
              >
                {isActive ? 'Активный' : 'Выбрать'}
              </button>
            </div>
            <NumberInput
              value={scenarioDraft.sellerPriceBeforeDiscount}
              placeholder="0"
              onChange={(v) => updateScenario('sellerPriceBeforeDiscount', v)}
              widthClass="w-24"
            />
          </div>
        );
      case 'seller_discount':
        return (
          <NumberInput
            value={scenarioDraft.sellerDiscount}
            placeholder="0"
            onChange={(v) => updateScenario('sellerDiscount', v)}
            widthClass="w-20"
          />
        );
      case 'wb_discount':
        return (
          <NumberInput
            value={scenarioDraft.wbDiscount}
            placeholder="0"
            onChange={(v) => updateScenario('wbDiscount', v)}
            widthClass="w-20"
          />
        );
      case 'buyout':
        return (
          <NumberInput
            value={scenarioDraft.buyoutPercent}
            placeholder="0"
            onChange={(v) => updateScenario('buyoutPercent', v)}
            widthClass="w-20"
          />
        );
      case 'purchase_qty_total':
        return (
          <NumberInput
            value={manualFields.purchaseQtyTotal}
            placeholder={soldQuantity > 0 ? String(soldQuantity) : '0'}
            onChange={(v) => updateField('purchaseQtyTotal', v)}
            widthClass="w-24"
          />
        );
      case 'turnover_days':
        return (
          <NumberInput
            value={manualFields.turnoverDays}
            placeholder="30"
            onChange={(v) => updateField('turnoverDays', v)}
            widthClass="w-20"
          />
        );
      case 'drr_percent':
        return (
          <NumberInput
            value={manualFields.drrPercent}
            placeholder="0"
            onChange={(v) => updateField('drrPercent', v)}
            widthClass="w-20"
          />
        );
      case 'marketing_internal':
        if (manualFields.drrPercent.trim()) {
          return (
            <span className="inline-flex min-h-9 items-center justify-end rounded-xl bg-muted px-3 py-1 text-[13px] font-semibold tabular-nums text-foreground">
              {scenarioSummary.marketingInternal > 0
                ? scenarioSummary.marketingInternal.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                : '0'} ₽
            </span>
          );
        }
        return (
          <NumberInput
            value={manualFields.marketingInternal}
            placeholder="0"
            onChange={(v) => updateField('marketingInternal', v)}
            widthClass="w-24"
          />
        );
      case 'marketing_external':
        return (
          <NumberInput
            value={manualFields.marketingExternal}
            placeholder="0"
            onChange={(v) => updateField('marketingExternal', v)}
            widthClass="w-24"
          />
        );
      case 'content_cost':
        return (
          <NumberInput
            value={manualFields.contentCost}
            placeholder="0"
            onChange={(v) => updateField('contentCost', v)}
            widthClass="w-24"
          />
        );
      case 'other_costs':
        return (
          <NumberInput
            value={manualFields.otherCosts}
            placeholder="0"
            onChange={(v) => updateField('otherCosts', v)}
            widthClass="w-24"
          />
        );
      // CPO and CPS are computed from internal WB ads only in row-summary —
      // no manual override. Fall through to
      // the default branch which renders the formatted value via cellValue.
      case 'tax_percent_1':
      case 'tax_percent_2':
        return (
          <span className="inline-flex items-center rounded-md bg-muted px-2 py-1 text-[13px] font-semibold tabular-nums text-muted-foreground">
            {scenarioSummary.taxPercent > 0 ? `${scenarioSummary.taxPercent}%` : '—'}
          </span>
        );
      // For all other columns — read-only computed under this scenario
      default: {
        const text = resolveCellText(columnId, row, scenarioSummary, manualFields);
        if (text === INTERACTIVE_COLUMN) {
          // photo / article — leave empty (covered by leading-cells branch)
          return '';
        }
        return text;
      }
    }
  };

  return (
    <tr
      className={isActive ? 'bg-emerald-500/10' : 'bg-card/60'}
    >
      {COLUMNS.map((column, index) => {
        const isLeading = index < FINANCE_DETAIL_START_INDEX;
        const stickyIdentityClass = resolveStickyIdentityColumnClass(column.id);
        return (
          <td
            key={`scenario-${scenarioId}-${column.id}`}
            className={[
              'px-2 py-2 align-middle whitespace-nowrap',
              column.align === 'right' ? 'text-right font-medium tabular-nums' : '',
              column.align === 'center' ? 'text-center' : '',
              'border-b border-r first:border-l',
              GRID_BORDER,
              resolveStrictWidthClasses(column.minWidthClass),
              STRONG_GROUP_SEPARATOR_COLUMNS.has(column.id) ? 'border-r-2 border-sky-500/20' : '',
              column.id === 'separator' ? SEPARATOR_FILL : '',
              stickyIdentityClass ? `${stickyIdentityClass} z-[4] ${isActive ? 'bg-emerald-500/10' : 'bg-card/60'}` : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {isLeading ? null : renderScenarioCell(column.id)}
          </td>
        );
      })}
    </tr>
  );
}
