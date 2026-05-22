'use client';

import {
  COLUMN_FORMULA_HINTS,
  COLUMN_HELP_HINTS,
  COLUMNS,
  STRONG_GROUP_SEPARATOR_COLUMNS,
  resolveStrictWidthClasses,
  resolveStickyIdentityColumnClass,
  type TemplateColumn,
} from './columns';

// Explicit slate-300 instead of theme `border-border` — the latter is too
// soft on busy data and was barely visible. Strong group separators get
// sky-400 + 2px width for additional emphasis.
const GRID_BORDER = 'border-slate-300';
const SEPARATOR_FILL = 'bg-muted';

function buildTooltip(columnId: string): string | undefined {
  const help = COLUMN_HELP_HINTS[columnId];
  const formula = COLUMN_FORMULA_HINTS[columnId];
  if (help && formula) {
    return `${help}\n\nФормула: ${formula}`;
  }
  return help || formula || undefined;
}

function ColumnHeader({ column }: { column: TemplateColumn }) {
  const tooltip = buildTooltip(column.id);

  // Tooltip surfaces via the native `title` attribute and `cursor-help` —
  // we deliberately avoid an inline icon to keep column widths unchanged.
  const cls = [
    'px-2 py-2 font-semibold whitespace-pre-line leading-tight sticky top-0 z-10',
    resolveStickyIdentityColumnClass(column.id),
    resolveStickyIdentityColumnClass(column.id) ? 'z-30' : '',
    column.align === 'right' ? 'text-right' : '',
    column.align === 'center' ? 'text-center' : '',
    'border-b border-r first:border-l',
    'bg-muted',
    GRID_BORDER,
    resolveStrictWidthClasses(column.minWidthClass),
    STRONG_GROUP_SEPARATOR_COLUMNS.has(column.id) ? 'border-r-2 border-sky-400' : '',
    column.id === 'separator' ? SEPARATOR_FILL : '',
    tooltip ? 'cursor-help' : '',
  ]
    .filter(Boolean)
    .join(' ');

  if (!column.label) {
    return <th scope="col" key={column.id} className={cls}>{' '}</th>;
  }

  return (
    <th scope="col" className={cls} title={tooltip}>
      {column.label}
    </th>
  );
}

/**
 * Sticky table header for the Unit Economics wide table.
 *
 * Renders all 80 columns from `COLUMNS` (or a custom `columns` override) as
 * a single `<thead><tr>` block. Columns with a `COLUMN_FORMULA_HINTS` entry
 * show a tooltip on hover so analysts can inspect the calculation logic.
 *
 * Usage:
 *   <table className="...">
 *     <TableHeader />
 *     <tbody>…</tbody>
 *   </table>
 */
export function TableHeader({ columns = COLUMNS }: { columns?: TemplateColumn[] }) {
  return (
    <thead className="border-b border-border bg-muted text-[12px] tracking-[0.01em] text-muted-foreground">
      <tr>
        {columns.map((column) => (
          <ColumnHeader key={column.id} column={column} />
        ))}
      </tr>
    </thead>
  );
}
