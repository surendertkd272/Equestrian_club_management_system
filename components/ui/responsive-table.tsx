import * as React from "react";
import { cn } from "@/lib/utils";

// One column config drives BOTH a real <table> at md+ and a stacked card list
// below md — so wide tables stop forcing barn-phone users to scroll sideways.
// Server-renderable (no hooks). The `primary` column becomes each card's title;
// columns marked `hideOnMobile` are dropped from the card to keep it compact.
//
//   <ResponsiveTable
//     rows={staff}
//     getRowKey={(s) => s.id}
//     columns={[
//       { key: "name", header: "Name", primary: true, cell: (s) => <Link…/> },
//       { key: "role", header: "Role", cell: (s) => <Badge…/> },
//       …
//     ]}
//     emptyMessage="No staff yet."
//   />

export type Column<T> = {
  key: string;
  /** ReactNode, not string: a select-all checkbox is a legitimate header.
   *  Rendered as-is in the <th> and as the <dt> label on the mobile card. */
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  /** Becomes the card title on mobile (first such column wins; defaults to col 0). */
  primary?: boolean;
  /** Drop from the mobile card (low-priority columns). Still shown on desktop. */
  hideOnMobile?: boolean;
  className?: string;
  headerClassName?: string;
  /** Right-align and use tabular figures. Digits then line up in a column, so
   *  the eye can compare down a numeric column instead of re-reading each row. */
  numeric?: boolean;
};

export function ResponsiveTable<T>({
  columns,
  rows,
  getRowKey,
  emptyMessage,
}: {
  columns: Column<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  emptyMessage?: React.ReactNode;
}) {
  if (rows.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-muted-foreground">
        {emptyMessage ?? "Nothing to show."}
      </div>
    );
  }

  const primary = columns.find((c) => c.primary) ?? columns[0];
  const cardCols = columns.filter((c) => c !== primary && !c.hideOnMobile);

  return (
    <>
      {/* Desktop / tablet: a real table. */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm tabular-nums">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={cn("pb-2 pr-3", c.numeric && "text-right", c.headerClassName)}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={getRowKey(row)} className="border-t align-top transition-colors hover:bg-muted/40">
                {columns.map((c) => (
                  <td key={c.key} className={cn("py-2 pr-3", c.numeric && "text-right", c.className)}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phone: stacked cards — title + label/value pairs, full-width tap area. */}
      <ul className="space-y-2 md:hidden">
        {rows.map((row) => (
          <li key={getRowKey(row)} className="rounded-lg border bg-card p-3">
            <div className="mb-2 text-sm font-medium">{primary.cell(row)}</div>
            <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-sm">
              {cardCols.map((c) => (
                <React.Fragment key={c.key}>
                  <dt className="text-xs text-muted-foreground">{c.header}</dt>
                  <dd className="min-w-0 break-words text-right">{c.cell(row)}</dd>
                </React.Fragment>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}
