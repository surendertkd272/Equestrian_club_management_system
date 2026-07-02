import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";
import { Pagination } from "@/components/ui/pagination";
import { parsePaging } from "@/lib/paging";
import { ExportCsvButton } from "@/components/ui/export-csv";

export const dynamic = "force-dynamic";

export default async function AuditPage({
  searchParams,
}: {
  searchParams: { page?: string; pageSize?: string; action?: string; table?: string; q?: string };
}) {
  const session = (await getSession())!;
  if (session.role !== "SUPER_ADMIN") redirect("/dashboard");

  const { page, pageSize, skip, take } = parsePaging(searchParams, { pageSize: 50 });

  // Filters. `action` matches the dotted-prefix family (e.g. ?action=requisition
  // covers requisition.create, requisition.approve, etc). `table` is exact.
  // `q` does a substring search over the JSON `before`/`after` payloads —
  // useful for finding "all events touching horse Bijli".
  const where: any = {};
  if (searchParams.action) where.action = { startsWith: searchParams.action };
  if (searchParams.table) where.tableName = searchParams.table;
  if (searchParams.q) {
    where.OR = [
      { before: { contains: searchParams.q } },
      { after: { contains: searchParams.q } },
      { rowId: { contains: searchParams.q } },
    ];
  }

  // Build dropdown options from the live data so filters always reflect what's
  // actually in the log. Cheap on a few-thousand-row audit; revisit if it grows.
  const [total, logs, distinctActions, distinctTables] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { at: "desc" },
      skip,
      take,
      include: { user: { select: { name: true, email: true } } },
    }),
    prisma.auditLog.groupBy({ by: ["action"], _count: true, orderBy: { action: "asc" } }),
    prisma.auditLog.groupBy({ by: ["tableName"], _count: true, orderBy: { tableName: "asc" } }),
  ]);

  // Collapse action variants (requisition.create, requisition.approve) into
  // the dotted prefix the filter actually filters on.
  const actionPrefixes = Array.from(new Set(
    distinctActions.map((a) => a.action.split(".")[0]).filter((s): s is string => !!s),
  )).sort();

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Audit Log</h1>
        </div>
        <ExportCsvButton entity="audit" />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Events</CardTitle>
          <form className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <select aria-label="Filter by action"
              name="action"
              defaultValue={searchParams.action ?? ""}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              <option value="">All Actions</option>
              {actionPrefixes.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
            <select aria-label="Filter by table"
              name="table"
              defaultValue={searchParams.table ?? ""}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              <option value="">All Tables</option>
              {distinctTables.map((t) => (
                <option key={t.tableName} value={t.tableName}>{t.tableName} ({t._count})</option>
              ))}
            </select>
            <input aria-label="Search"
              type="search"
              name="q"
              defaultValue={searchParams.q ?? ""}
              placeholder="Search ID / payload"
              className="h-9 rounded-md border bg-background px-2 text-sm"
            />
            <button type="submit" className="h-9 rounded-md border bg-primary px-3 text-sm font-medium text-primary-foreground">
              Filter
            </button>
          </form>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="pb-2">When</th>
                  <th className="pb-2">User</th>
                  <th className="pb-2">Action</th>
                  <th className="pb-2">Table</th>
                  <th className="pb-2">Row</th>
                  <th className="pb-2">IP</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="border-t">
                    <td className="py-2 whitespace-nowrap">{formatDate(l.at)}</td>
                    <td className="py-2">{l.user?.name ?? "—"}</td>
                    <td className="py-2">{l.action}</td>
                    <td className="py-2">{l.tableName}</td>
                    <td className="py-2 font-mono text-xs">{l.rowId.slice(0, 8)}…</td>
                    <td className="py-2 font-mono text-xs">{l.ip ?? "—"}</td>
                  </tr>
                ))}
                {logs.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-muted-foreground">
                      No audit entries yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination total={total} page={page} pageSize={pageSize} />
        </CardContent>
      </Card>
    </div>
  );
}
