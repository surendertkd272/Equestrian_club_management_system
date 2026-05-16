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
  searchParams: { page?: string; pageSize?: string };
}) {
  const session = (await getSession())!;
  if (session.role !== "SUPER_ADMIN") redirect("/dashboard");

  const { page, pageSize, skip, take } = parsePaging(searchParams, { pageSize: 50 });
  const [total, logs] = await Promise.all([
    prisma.auditLog.count(),
    prisma.auditLog.findMany({
      orderBy: { at: "desc" },
      skip,
      take,
      include: { user: { select: { name: true, email: true } } },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Audit Log</h1>
          <p className="text-sm text-muted-foreground">§4.23 · {total} total entries.</p>
        </div>
        <ExportCsvButton entity="audit" />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Events</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
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
