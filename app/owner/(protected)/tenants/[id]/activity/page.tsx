import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

// Tenant activity timeline. Merges PlatformAuditLog rows (platform-side
// actions: plan changes, suspensions, billing events) with tenant-side
// AuditLog rows (logins, deletes, etc.) for users of this tenant.
//
// The two tables don't share a schema, so we normalise to a common
// `{at, source, action, actorId, details}` shape and sort merged.
//
// Cap at 200 rows for now — page-level pagination is the next step
// once a tenant has heavy traffic.
type SP = { id: string };

export default async function TenantActivityPage({ params }: { params: SP }) {
  const org = await prisma.organisation.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, slug: true, centres: { select: { id: true } } },
  });
  if (!org) notFound();
  const centreIds = org.centres.map((c) => c.id);

  const userIds = (
    await prisma.user.findMany({
      where: { OR: [{ orgId: org.id }, { centreId: { in: centreIds } }] },
      select: { id: true },
    })
  ).map((u) => u.id);

  const [platformEvents, tenantEvents] = await Promise.all([
    prisma.platformAuditLog.findMany({
      where: { orgId: org.id },
      orderBy: { at: "desc" },
      take: 200,
      select: { id: true, action: true, actorId: true, at: true, before: true, after: true },
    }),
    prisma.auditLog.findMany({
      where: { userId: { in: userIds } },
      orderBy: { at: "desc" },
      take: 200,
      select: { id: true, action: true, userId: true, tableName: true, rowId: true, at: true },
    }),
  ]);

  // Merge + sort.
  type Row = {
    id: string;
    source: "platform" | "tenant";
    at: Date;
    action: string;
    actorId: string | null;
    details: string;
  };
  const merged: Row[] = [];
  for (const e of platformEvents) {
    merged.push({
      id: `p-${e.id}`,
      source: "platform",
      at: e.at,
      action: e.action,
      actorId: e.actorId,
      details: summarisePlatform(e.action, e.before, e.after),
    });
  }
  for (const e of tenantEvents) {
    merged.push({
      id: `t-${e.id}`,
      source: "tenant",
      at: e.at,
      action: e.action,
      actorId: e.userId,
      details: `${e.tableName}/${e.rowId.slice(0, 8)}`,
    });
  }
  merged.sort((a, b) => b.at.getTime() - a.at.getTime());

  return (
    <div className="space-y-6 text-foreground">
      <div>
        <Link href={`/owner/tenants/${org.id}`} className="text-xs text-muted-foreground hover:underline">
          ← Back to tenant
        </Link>
        <h1 className="mt-1 text-2xl font-bold">Activity · {org.name}</h1>
        <p className="text-sm text-muted-foreground">
          Latest 200 events combining platform-side actions and the tenant's own audit log.
        </p>
      </div>

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">Timeline</CardTitle>
          <CardDescription className="text-muted-foreground">Newest first.</CardDescription>
        </CardHeader>
        <CardContent>
          {merged.length === 0 ? (
            <p className="text-sm text-muted-foreground">No events recorded yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {merged.slice(0, 200).map((row) => (
                <li key={row.id} className="grid grid-cols-[140px_80px_1fr] items-start gap-3 py-2 text-xs">
                  <span className="text-muted-foreground">
                    {row.at.toLocaleString("en-IN", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <Badge
                    variant="outline"
                    className={`w-fit text-[10px] ${row.source === "platform" ? "border-amber-700 text-amber-300" : "border-border text-foreground"}`}
                  >
                    {row.source}
                  </Badge>
                  <div>
                    <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-foreground">
                      {row.action}
                    </code>
                    <span className="ml-2 text-muted-foreground">{row.details}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function summarisePlatform(action: string, before: string | null, after: string | null): string {
  try {
    const b = before ? JSON.parse(before) : null;
    const a = after ? JSON.parse(after) : null;
    if (action.includes("plan_changed") && b?.plan && a?.plan) return `${b.plan} → ${a.plan}`;
    if (action.includes("status") && b?.status && a?.status) return `${b.status} → ${a.status}`;
    if (action === "owner.feature_toggled" && a?.featureKey) return `${a.featureKey} ${a.enabled ? "on" : "off"}`;
    return a ? Object.keys(a).slice(0, 3).join(", ") : "";
  } catch {
    return "";
  }
}
