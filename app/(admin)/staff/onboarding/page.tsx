import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { scopeCentre, centreWhere } from "@/lib/tenancy";
import { ROLES } from "@/lib/roles";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { pendingItems, parseWaived } from "@/lib/onboarding-items";
import { GenerateLinkButton, ApproveControl, WaiveControl } from "./onboarding-actions";

export const dynamic = "force-dynamic";

const CAN_MANAGE = ["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER"];
const STAFF_ROLES = ROLES.filter((r) => !["SUPER_ADMIN", "ADMIN", "RIDER", "PARENT"].includes(r));

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

function DocLink({ url, label }: { url: string | null; label: string }) {
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noopener" className="rounded border bg-card px-2 py-0.5 text-[11px] text-primary hover:bg-muted">
      📎 {label}
    </a>
  );
}

export default async function StaffOnboardingPage() {
  const session = (await getSession())!;
  if (!CAN_MANAGE.includes(session.role)) redirect("/staff");

  const centreId = scopeCentre(session);
  const rows = await prisma.employeeOnboarding.findMany({
    where: centreWhere(centreId),
    orderBy: { createdAt: "desc" },
    take: 100,
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
          <CardTitle className="text-base">New registration link</CardTitle>
          <CardDescription>One link per employee. Filled once, then it lands below for review.</CardDescription>
        </CardHeader>
        <CardContent>
          <GenerateLinkButton roles={STAFF_ROLES} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pending review ({submitted.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {submitted.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No submissions waiting for review.</p>
          ) : (
            submitted.map((r) => (
              <div key={r.id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-medium">{r.fullName ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.email} · submitted {r.submittedAt ? formatDate(r.submittedAt) : "—"}
                      {r.intendedRole ? <> · pre-set role: <span className="font-medium">{r.intendedRole.replaceAll("_", " ").toLowerCase()}</span></> : null}
                    </div>
                  </div>
                  <ApproveControl id={r.id} roles={STAFF_ROLES} defaultRole={r.intendedRole} />
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
                  {r.fatherName && <div><dt className="text-muted-foreground">Father</dt><dd>{r.fatherName}</dd></div>}
                  {r.dob && <div><dt className="text-muted-foreground">DOB</dt><dd>{formatDate(r.dob)}</dd></div>}
                  {r.emergencyContact && <div><dt className="text-muted-foreground">Emergency</dt><dd>{r.emergencyContact}</dd></div>}
                  {r.employmentType && <div><dt className="text-muted-foreground">Type</dt><dd>{r.employmentType.replaceAll("_", " ")}</dd></div>}
                  {r.dateOfJoining && <div><dt className="text-muted-foreground">Joining</dt><dd>{formatDate(r.dateOfJoining)}</dd></div>}
                  {r.agreedSalary != null && <div><dt className="text-muted-foreground">Salary</dt><dd>{inr(r.agreedSalary)}</dd></div>}
                  {r.foodCharges != null && <div><dt className="text-muted-foreground">Food</dt><dd>{inr(r.foodCharges)}</dd></div>}
                  {r.aadhaarNumber && <div><dt className="text-muted-foreground">Aadhaar</dt><dd className="font-mono">{r.aadhaarNumber}</dd></div>}
                  {r.panNumber && <div><dt className="text-muted-foreground">PAN</dt><dd className="font-mono">{r.panNumber}</dd></div>}
                  {r.bankAccountNumber && <div><dt className="text-muted-foreground">Bank A/c</dt><dd className="font-mono">{r.bankName ?? ""} {r.bankAccountNumber} {r.bankIfsc ?? ""}</dd></div>}
                </dl>
                {r.permanentAddress && <p className="mt-1 text-xs text-muted-foreground">{r.permanentAddress}</p>}
                {r.prevEmployment && <p className="mt-1 text-xs"><span className="text-muted-foreground">Previous: </span>{r.prevEmployment}</p>}
                {r.references && <p className="mt-1 text-xs"><span className="text-muted-foreground">References: </span>{r.references}</p>}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <DocLink url={r.photoUrl} label="Photo" />
                  <DocLink url={r.aadhaarUrl} label="Aadhaar" />
                  <DocLink url={r.panUrl} label="PAN" />
                  <DocLink url={r.bankProofUrl} label="Bank proof" />
                  <DocLink url={r.prevEmploymentUrl} label="Prev. employment" />
                  <DocLink url={r.characterCertUrl} label="Character cert" />
                  <DocLink url={r.policeVerificationUrl} label="Police verification" />
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Declaration accepted by typing: <span className="font-medium text-foreground">{r.declarationName ?? "—"}</span>
                </p>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {awaiting.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Awaiting documents ({awaiting.length})</CardTitle>
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
          <CardHeader><CardTitle className="text-base">All links</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr><th className="pb-2">Candidate / employee</th><th className="pb-2">Role</th><th className="pb-2">Created</th><th className="pb-2">Status</th></tr>
              </thead>
              <tbody>
                {others.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="py-2">{r.fullName ?? r.reviewNotes ?? <span className="text-muted-foreground">link not used yet</span>}</td>
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
                    </td>
                  </tr>
                ))}
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
