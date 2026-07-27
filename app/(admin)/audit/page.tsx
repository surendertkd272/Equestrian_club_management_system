import { prisma } from "@/lib/prisma";
import { getOrgIdForSession } from "@/lib/features-gate";
import { requireSession } from "@/lib/auth";
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
  searchParams: { page?: string; pageSize?: string; action?: string; table?: string; user?: string; q?: string };
}) {
  const session = await requireSession();
  if (session.role !== "SUPER_ADMIN") redirect("/dashboard");

  const { page, pageSize, skip, take } = parsePaging(searchParams, { pageSize: 50 });

  // Filters. `action` matches the dotted-prefix family (e.g. ?action=requisition
  // covers requisition.create, requisition.approve, etc). `table` is exact.
  // `q` does a substring search over the JSON `before`/`after` payloads —
  // useful for finding "all events touching horse Bijli".
  // Every other admin screen is org-bound; this one had no clause at all, so a
  // tenant admin paged through every other tenant's audit log — who did what,
  // to which row, with before/after values. The CSV export beside it already
  // scoped correctly, which is how the gap survived: the screen and its export
  // disagreed.
  const auditOrgId = await getOrgIdForSession(session);
  if (!auditOrgId) redirect("/no-organisation");
  const where: any = {
    user: { OR: [{ orgId: auditOrgId }, { centre: { orgId: auditOrgId } }] },
  };
  if (searchParams.action) where.action = { startsWith: searchParams.action };
  if (searchParams.table) where.tableName = searchParams.table;
  // Filter to one person's actions — e.g. "show me everything this coach did".
  if (searchParams.user) where.userId = searchParams.user;
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
    prisma.auditLog.groupBy({ by: ["action"], where, _count: true, orderBy: { action: "asc" } }),
    prisma.auditLog.groupBy({ by: ["tableName"], where, _count: true, orderBy: { tableName: "asc" } }),
  ]);

  // Collapse action variants (requisition.create, requisition.approve) into
  // the dotted prefix the filter actually filters on.
  const actionPrefixes = Array.from(new Set(
    distinctActions.map((a) => a.action.split(".")[0]).filter((s): s is string => !!s),
  )).sort();

  // People who appear in the log → the "filter by user" dropdown, so an admin
  // can isolate one coach's activity.
  const userGroups = await prisma.auditLog.groupBy({ by: ["userId"], _count: true });
  const userIds = userGroups.map((g) => g.userId).filter((id): id is string => !!id);
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, role: true } })
    : [];
  users.sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Audit Log</h1>
          <p className="text-sm text-muted-foreground">{total} total entries.</p>
        </div>
        <ExportCsvButton entity="audit" />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Events</CardTitle>
          <form className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
            <select aria-label="Filter by user"
              name="user"
              defaultValue={searchParams.user ?? ""}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              <option value="">All Users</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
              ))}
            </select>
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
                  <th className="pb-2">Changes</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="border-t align-top">
                    <td className="py-2 whitespace-nowrap">{formatDate(l.at)}</td>
                    <td className="py-2">{l.user?.name ?? "—"}</td>
                    <td className="py-2">{l.action}</td>
                    <td className="py-2">{l.tableName}</td>
                    <td className="py-2"><ChangeDetail before={l.before} after={l.after} /></td>
                  </tr>
                ))}
                {logs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-muted-foreground">
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

// before/after are stringified JSON payloads on each audit row. Parse to an
// object (null if not an object) so we can show a field-level diff.
function parseObj(s: string | null): Record<string, unknown> | null {
  if (!s) return null;
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function fmtVal(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

// Expandable per-row detail: shows which fields changed (before → after), or
// the recorded values for create/one-sided events. Native <details> — no JS.
function ChangeDetail({ before, after }: { before: string | null; after: string | null }) {
  const b = parseObj(before);
  const a = parseObj(after);
  const keys = Array.from(new Set([...(a ? Object.keys(a) : []), ...(b ? Object.keys(b) : [])]));
  if (keys.length === 0) {
    const raw = after ?? before;
    return <span className="text-muted-foreground">{raw ? raw.slice(0, 60) : "—"}</span>;
  }
  const changed = keys.filter((k) => JSON.stringify(b?.[k]) !== JSON.stringify(a?.[k]));
  const list = (changed.length ? changed : keys).slice(0, 8);
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-primary">
        {changed.length ? `${changed.length} field${changed.length === 1 ? "" : "s"} changed` : "view"}
      </summary>
      <div className="mt-1 space-y-0.5">
        {list.map((k) => {
          const isChanged = !!b && JSON.stringify(b[k]) !== JSON.stringify(a?.[k]);
          return (
            <div key={k}>
              <span className="font-mono text-muted-foreground">{k}:</span>{" "}
              {isChanged ? (
                <>
                  <span className="text-rose-600 line-through">{fmtVal(b[k])}</span>{" → "}
                  <span className="text-emerald-700">{fmtVal(a?.[k])}</span>
                </>
              ) : (
                <span>{fmtVal(a ? a[k] : b?.[k])}</span>
              )}
            </div>
          );
        })}
      </div>
    </details>
  );
}
