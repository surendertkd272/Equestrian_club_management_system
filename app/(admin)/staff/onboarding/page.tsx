import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { scopeCentre, tenantWhere } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { ROLES } from "@/lib/roles";
import { FileText } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { pendingItems, parseWaived } from "@/lib/onboarding-items";
import { employeeFormRows, employeeDocs } from "@/lib/employee-profile";
import { GenerateLinkButton, ApproveControl, RejectControl, WaiveControl, LinkShareButtons } from "./onboarding-actions";

export const dynamic = "force-dynamic";

const CAN_MANAGE = ["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER"];
const STAFF_ROLES = ROLES.filter((r) => !["SUPER_ADMIN", "ADMIN", "RIDER", "PARENT"].includes(r));

// Thumbnail tile for one uploaded document — image preview (click to open full)
// or a PDF tile. Same look as the staff profile's document grid.
function DocTile({ url, label, isPdf }: { url: string; label: string; isPdf: boolean }) {
  return (
    <a href={url} target="_blank" rel="noopener" className="group overflow-hidden rounded-md border bg-card hover:border-primary">
      <div className="flex h-24 items-center justify-center bg-muted/40">
        {isPdf ? (
          <FileText className="h-8 w-8 text-muted-foreground" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={label} className="h-full w-full object-cover" />
        )}
      </div>
      <div className="px-2 py-1 text-[11px]">
        <div className="font-medium group-hover:text-primary">{label}</div>
        <div className="text-[10px] uppercase text-muted-foreground">{isPdf ? "PDF" : "image"} · open ↗</div>
      </div>
    </a>
  );
}

export default async function StaffOnboardingPage() {
  const session = (await getSession())!;
  if (!CAN_MANAGE.includes(session.role)) redirect("/staff");

  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/staff");
  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  // HQ sees every centre's onboarding IN THEIR ORG (never hidden behind the
  // centre picker); centre-scoped managers see only their own centre.
  const scopeId = isHQ ? null : scopeCentre(session);
  const rows = await prisma.employeeOnboarding.findMany({
    where: tenantWhere(scopeId, orgId),
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { centre: { select: { name: true } } },
  });

  const submitted = rows.filter((r) => r.status === "submitted");
  // Approved hires who still have blank, non-waived items.
  const awaiting = rows
    .filter((r) => r.status === "approved")
    .map((r) => ({ r, pending: pendingItems(r as unknown as Record<string, unknown>, parseWaived(r.waivedItemsJson)) }))
    .filter((x) => x.pending.length > 0);
  const others = rows.filter((r) => r.status !== "submitted");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Employee Onboarding</h1>
        <p className="text-sm text-muted-foreground">
          Generate a self-registration link to share with a new hire. They fill the form + upload documents; you review
          and approve to create their staff record.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">New Registration Link</CardTitle>
          <CardDescription>One link per employee. Filled once, then it lands below for review.</CardDescription>
        </CardHeader>
        <CardContent>
          <GenerateLinkButton roles={STAFF_ROLES} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pending Review ({submitted.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {submitted.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No submissions waiting for review.</p>
          ) : (
            submitted.map((r) => {
              const detailRows = employeeFormRows(r as unknown as Record<string, unknown>);
              const docs = employeeDocs(r as unknown as Record<string, unknown>);
              return (
              <div key={r.id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-medium">{r.fullName ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.email} · submitted {r.submittedAt ? formatDate(r.submittedAt) : "—"}
                      {isHQ ? <> · {r.centre.name}</> : null}
                      {r.intendedRole ? <> · pre-set role: <span className="font-medium">{r.intendedRole.replaceAll("_", " ").toLowerCase()}</span></> : null}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <ApproveControl id={r.id} roles={STAFF_ROLES} defaultRole={r.intendedRole} />
                    <RejectControl id={r.id} />
                  </div>
                </div>

                {/* Full submitted form — every field, blanks shown as — */}
                <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-0 sm:grid-cols-2">
                  {detailRows.map((row) => (
                    <div key={row.label} className="flex justify-between gap-3 border-b border-dashed py-1 text-xs">
                      <dt className="text-muted-foreground">{row.label}</dt>
                      <dd className="text-right font-medium">{row.value}</dd>
                    </div>
                  ))}
                </dl>

                {/* All uploaded documents — image previews / PDF tiles, click to open */}
                <div className="mt-3">
                  <div className="mb-1.5 text-xs font-medium text-muted-foreground">Documents ({docs.length})</div>
                  {docs.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No documents uploaded.</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {docs.map((d) => (
                        <DocTile key={d.key} url={d.url} label={d.label} isPdf={d.isPdf} />
                      ))}
                    </div>
                  )}
                </div>

                <p className="mt-3 text-[11px] text-muted-foreground">
                  Declaration accepted by typing: <span className="font-medium text-foreground">{r.declarationName ?? "—"}</span>
                </p>
              </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {awaiting.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Awaiting Documents ({awaiting.length})</CardTitle>
            <CardDescription>Approved staff with items still pending. Waive any that don&apos;t apply.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {awaiting.map(({ r, pending }) => {
              const overdue = r.documentsDueAt ? r.documentsDueAt < new Date() : false;
              return (
                <div key={r.id} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium">{r.fullName ?? r.email}</div>
                    {overdue ? (
                      <Badge variant="destructive">overdue · was due {r.documentsDueAt ? formatDate(r.documentsDueAt) : ""}</Badge>
                    ) : (
                      <Badge variant="warning">{pending.length} pending · due {r.documentsDueAt ? formatDate(r.documentsDueAt) : "—"}</Badge>
                    )}
                  </div>
                  <div className="mt-2">
                    <WaiveControl id={r.id} pending={pending.map((p) => ({ key: p.key, label: p.label }))} />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {others.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">All Links</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr><th className="pb-2">Candidate / Employee</th><th className="pb-2">Role</th><th className="pb-2">Created</th><th className="pb-2">Status</th></tr>
              </thead>
              <tbody>
                {others.map((r) => {
                  const active = r.status === "draft" && r.expiresAt >= new Date();
                  return (
                    <tr key={r.id} className="border-t align-top">
                      <td className="py-2">
                        {r.fullName ?? r.reviewNotes ?? <span className="text-muted-foreground">link not used yet</span>}
                        {isHQ ? <div className="text-[11px] text-muted-foreground">{r.centre.name}</div> : null}
                      </td>
                      <td className="py-2 text-xs text-muted-foreground">{r.intendedRole ? r.intendedRole.replaceAll("_", " ").toLowerCase() : "—"}</td>
                      <td className="py-2 text-xs text-muted-foreground">{formatDate(r.createdAt)}</td>
                      <td className="py-2">
                        {r.status === "approved" ? (
                          <Badge variant="success">approved → staff created</Badge>
                        ) : r.status === "rejected" ? (
                          <Badge variant="destructive">rejected</Badge>
                        ) : r.expiresAt < new Date() ? (
                          <Badge variant="outline">link expired</Badge>
                        ) : (
                          <Badge variant="warning">link active · expires {formatDate(r.expiresAt)}</Badge>
                        )}
                        {active && r.shareToken ? <LinkShareButtons token={r.shareToken} note={r.reviewNotes} /> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        Prefer to add someone directly? <Link href="/staff" className="underline">Staff</Link> still supports manual add.
      </p>
    </div>
  );
}
