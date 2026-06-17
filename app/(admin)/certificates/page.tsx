import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { assertRoute } from "@/lib/route-guard";
import { scopeCentre, tenantWhere } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { can } from "@/lib/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { ResponsiveTable } from "@/components/ui/responsive-table";
import { BulkIssuePanel } from "./bulk-issue-panel";
import { RevokeButton } from "./revoke-button";
import { SendResultButton } from "./[id]/send-result-button";

const SEND_RESULT_ROLES = new Set([
  "SUPER_ADMIN",
  "ADMIN",
  "CENTRE_MANAGER",
  "HEAD_COACH",
  "COACH",
]);

export const dynamic = "force-dynamic";

export default async function CertificatesPage({
  searchParams,
}: {
  searchParams: { type?: string; batch?: string; revoked?: string };
}) {
  const session = await assertRoute("/certificates");
  const centreId = scopeCentre(session);
  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/dashboard");
  const canBulk = can(session.role, "certificate.bulk");

  const where: any = { ...tenantWhere(centreId, orgId) };
  if (searchParams.type) where.type = searchParams.type;
  if (searchParams.batch) where.batchTag = searchParams.batch;
  if (searchParams.revoked === "yes") where.revokedAt = { not: null };
  else if (searchParams.revoked === "no") where.revokedAt = null;

  const canSendResult = SEND_RESULT_ROLES.has(session.role);
  const [certs, events, sittings] = await Promise.all([
    prisma.certificate.findMany({
      where,
      include: {
        rider: { select: { firstName: true, lastName: true, email: true } },
        centre: { select: { name: true } },
      },
      orderBy: { issuedAt: "desc" },
      take: 150,
    }),
    canBulk
      ? prisma.event.findMany({
          where: { ...tenantWhere(centreId, orgId), status: { in: ["live", "completed"] as any } },
          select: { id: true, title: true, startDate: true },
          orderBy: { startDate: "desc" },
          take: 50,
        })
      : Promise.resolve([]),
    canBulk
      ? prisma.examSitting.findMany({
          where: { ...tenantWhere(centreId, orgId) },
          select: { id: true, level: true, date: true },
          orderBy: { date: "desc" },
          take: 50,
        })
      : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Certificates</h1>
        <p className="text-sm text-muted-foreground">
          Auto-issued on exam pass. Bulk-issue for exam sittings / events;
          revoke a cert without losing the audit trail.
        </p>
      </div>

      {canBulk && (
        <BulkIssuePanel
          events={events.map((e) => ({ id: e.id, label: `${e.title} · ${e.startDate.toISOString().slice(0, 10)}` }))}
          sittings={sittings.map((s) => ({
            id: s.id,
            label: `L${s.level} · ${s.date.toISOString().slice(0, 10)}`,
          }))}
        />
      )}

      <Card>
        <CardHeader>
          <form method="get" className="flex flex-wrap items-end gap-2 text-sm">
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">Type</label>
              <select aria-label="Filter by type"
                name="type"
                defaultValue={searchParams.type ?? ""}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">All</option>
                <option value="promotion">Promotion (exam)</option>
                <option value="participation">Participation</option>
                <option value="event_attendance">Event attendance</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">Revoked</label>
              <select aria-label="Filter by revoked"
                name="revoked"
                defaultValue={searchParams.revoked ?? ""}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Both</option>
                <option value="no">Active only</option>
                <option value="yes">Revoked only</option>
              </select>
            </div>
            <Button type="submit" size="sm" variant="outline">Filter</Button>
          </form>
        </CardHeader>
        <CardContent>
          <ResponsiveTable
            rows={certs}
            getRowKey={(c) => c.id}
            emptyMessage="No certificates yet."
            columns={[
              {
                key: "rider",
                header: "Rider",
                primary: true,
                cell: (c) => (
                  <span className={`font-medium ${c.revokedAt ? "opacity-60" : ""}`}>
                    {c.rider.firstName} {c.rider.lastName}
                  </span>
                ),
              },
              { key: "issued", header: "Issued", cell: (c) => formatDate(c.issuedAt) },
              {
                key: "type",
                header: "Type",
                cell: (c) => (
                  <>
                    <Badge variant="outline">{c.type}</Badge>
                    {c.revokedAt && <Badge variant="destructive" className="ml-1">REVOKED</Badge>}
                  </>
                ),
              },
              { key: "level", header: "Level / Title", cell: (c) => c.levelName ?? "—" },
              {
                key: "serial",
                header: "Serial",
                cell: (c) => <span className="font-mono text-xs">{c.serialNo}</span>,
              },
              {
                key: "batch",
                header: "Batch",
                cell: (c) => (
                  <span className="text-[10px] font-mono text-muted-foreground">
                    {c.batchTag ? (
                      <Link
                        href={`/certificates?batch=${encodeURIComponent(c.batchTag)}`}
                        className="hover:underline"
                        title="Filter by this batch"
                      >
                        {c.batchTag.slice(0, 24)}…
                      </Link>
                    ) : (
                      "—"
                    )}
                  </span>
                ),
              },
              {
                key: "actions",
                header: "",
                cell: (c) => (
                  <div className="flex items-center justify-end gap-2">
                    {canSendResult && c.examId && !c.revokedAt && (
                      <SendResultButton
                        certId={c.id}
                        alreadySentAt={c.resultEmailSentAt?.toISOString() ?? null}
                        parentEmail={c.rider.email}
                      />
                    )}
                    <Link href={`/certificates/${c.id}`} className="text-xs text-primary underline">
                      Print
                    </Link>
                    <Link
                      href={`/verify/${c.serialNo}`}
                      className="text-xs text-primary underline"
                      target="_blank"
                    >
                      Verify ↗
                    </Link>
                    {canBulk && !c.revokedAt && <RevokeButton id={c.id} />}
                  </div>
                ),
              },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
