// Mobile-responsive table wrapper. On screens ≥ md the standard <table>
// renders; on narrow screens we collapse each row into a card stack. Usage:
//
//   <MobileTable
//     headers={["Horse", "Status", "Next due"]}
//     rows={vaccinations.map((v) => ({
//       key: v.id,
//       cells: [v.horse.name, v.status, formatDateIndia(v.nextDueAt)],
//       href: `/horses/${v.horseId}`,
//     }))}
//   />
//
// Skipped on shorter staff tables (riders, attendance) until those pages
// adopt this primitive — gradual rollout.

import Link from "next/link";

export type MobileTableRow = {
  key: string;
  cells: React.ReactNode[];
  href?: string;
};

export function MobileTable({
  headers,
  rows,
  empty,
}: {
  headers: string[];
  rows: MobileTableRow[];
  empty?: React.ReactNode;
}) {
  if (rows.length === 0 && empty) return <>{empty}</>;

  return (
    <>
      {/* Desktop / tablet */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-muted-foreground">
            <tr>
              {headers.map((h) => (
                <th key={h} className="pb-2">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t hover:bg-muted/40">
                {r.cells.map((c, i) => (
                  <td key={i} className="py-2">
                    {r.href && i === 0 ? <Link href={r.href} className="hover:underline">{c}</Link> : c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile — each row becomes a card */}
      <div className="space-y-2 md:hidden">
        {rows.map((r) => {
          const inner = (
            <div className="rounded-md border bg-card p-3 text-sm">
              {r.cells.map((c, i) => (
                <div key={i} className={i === 0 ? "font-medium" : "mt-1 text-xs text-muted-foreground"}>
                  {i > 0 && <span className="font-semibold text-muted-foreground/80">{headers[i]}:</span>} {c}
                </div>
              ))}
            </div>
          );
          return r.href ? (
            <Link key={r.key} href={r.href} className="block">{inner}</Link>
          ) : (
            <div key={r.key}>{inner}</div>
          );
        })}
      </div>
    </>
  );
}
