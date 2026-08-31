import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { scopeCentre, tenantWhere } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ImportForm } from "./import-form";

export const dynamic = "force-dynamic";

export default async function RidersImportPage() {
  const session = await requireSession();
  if (!["SUPER_ADMIN", "CENTRE_MANAGER"].includes(session.role)) {
    redirect("/riders");
  }
  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/no-organisation");
  const centreId = scopeCentre(session);
  // Name the destination. Import is centre-wise and irreversible in practice —
  // nobody wants to discover afterwards that a club's whole roll went into the
  // wrong centre — so the page states where the rows will land, and refuses to
  // show the form at all when an HQ user is on "All centres".
  const targetCentre = centreId
    ? await prisma.centre.findFirst({
        where: { id: centreId, orgId },
        select: { name: true },
      })
    : null;

  // Live state for the "what happens next" checklist below.
  //
  // Importing creates riders as ACTIVE with no approval step and no signature —
  // a spreadsheet cannot carry one. So the roster is usable the moment it
  // lands, which is exactly why the outstanding work has to be visible here
  // rather than explained once and forgotten. Real counts, not prose: "12
  // riders have no consent on file" gets acted on; "remember to collect
  // consent" does not.
  const [noConsent, noBatchCount, batchesNoCoach, noLogin] = centreId
    ? await Promise.all([
        prisma.rider.count({
          where: {
            centreId,
            indemnitySignedAt: null,
            status: { notIn: ["withdrawn", "rejected", "cancelled"] },
          },
        }),
        prisma.rider.count({
          where: {
            centreId,
            batchId: null,
            status: { notIn: ["withdrawn", "rejected", "cancelled"] },
          },
        }),
        prisma.batch.count({ where: { centreId, coachId: null } }),
        prisma.rider.count({
          where: {
            centreId,
            userId: null,
            status: { notIn: ["withdrawn", "rejected", "cancelled"] },
          },
        }),
      ])
    : [0, 0, 0, 0];

  // Examiners are surfaced as a dropdown so the import can optionally
  // schedule exams in the same shot (any row that has a `level` column
  // gets an exam with the chosen examiner).
  const examiners = await prisma.user.findMany({
    where: {
      ...tenantWhere(centreId, orgId),
      role: { in: ["EXAMINER", "HEAD_COACH", "CENTRE_MANAGER", "SUPER_ADMIN"] as any },
      status: "active",
    },
    select: { id: true, name: true, role: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <Button asChild variant="ghost" size="sm">
          <Link href="/riders">
            <ChevronLeft className="h-4 w-4" /> Back to riders
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Bulk upload riders</CardTitle>
          <CardDescription>
            Create rider profiles from the Excel template. Preview first — it catches
            duplicates and bad rows before anything is written.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {targetCentre ? (
            <>
              <div className="mb-4 rounded-md border border-info/30 bg-info-soft px-3 py-2 text-sm text-info-foreground">
                Riders in this file will be added to{" "}
                <strong>{targetCentre.name}</strong>. Upload one file per centre — the
                spreadsheet has no centre column, so the destination is whichever centre is
                selected here.
              </div>
              <ImportForm examiners={examiners} />
            </>
          ) : (
            <div className="rounded-md border border-warning/30 bg-warning-soft px-3 py-3 text-sm text-warning-foreground">
              <p className="font-medium">Pick a centre first.</p>
              <p className="mt-1">
                You&apos;re viewing <strong>All centres</strong>. Riders are imported into one
                centre, so choose the destination from the centre selector in the top bar, then
                come back.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Column Reference</CardTitle>
          <CardDescription>
            Headers are case-insensitive; aliases shown in parentheses also work.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <ul className="space-y-1">
            <li>
              <code className="rounded bg-muted px-1">first_name</code> (firstname / fname / given_name) — required
            </li>
            <li>
              <code className="rounded bg-muted px-1">last_name</code> (lastname / surname) — required
            </li>
            <li>
              <code className="rounded bg-muted px-1">mobile</code> (phone / contact) — required, used for dedup
            </li>
            <li>
              <code className="rounded bg-muted px-1">email</code> — optional, used for dedup
            </li>
            <li>
              <code className="rounded bg-muted px-1">dob</code> (date_of_birth / birthday) — required, format <code>YYYY-MM-DD</code>
            </li>
            <li>
              <code className="rounded bg-muted px-1">gender</code> (sex) — optional, M / F / O
            </li>
            <li>
              <code className="rounded bg-muted px-1">school</code> — optional
            </li>
            <li>
              <code className="rounded bg-muted px-1">joining_date</code> — optional, format <code>YYYY-MM-DD</code>
            </li>
            <li>
              <code className="rounded bg-muted px-1">level</code> (exam_level) — optional integer. If present
              AND an examiner is selected, a scheduled exam is created for the rider at that level.
            </li>
          </ul>
          <details className="rounded-md border bg-muted/30 p-3 text-xs">
            <summary className="cursor-pointer font-medium">Example CSV</summary>
            <pre className="mt-2 overflow-x-auto whitespace-pre">
{`first_name,last_name,mobile,email,dob,gender,school,level
Riya,Sharma,9876543210,riya@example.in,2012-04-12,F,DPS Bangalore,1
Aarav,Patel,9876501234,aarav@example.in,2010-11-03,M,Bishop Cotton,2
`}
            </pre>
          </details>
        </CardContent>
      </Card>

      {targetCentre && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">After the upload — what still needs doing</CardTitle>
            <CardDescription>
              Imported riders are created <strong>active straight away</strong>: no approval step,
              and no signature, because a spreadsheet can&apos;t carry one. These are the things a
              roster can&apos;t do for itself.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3 text-sm">
              <li className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-3">
                <div>
                  <span className="font-medium">1 · Collect the indemnity and injury NOC</span>
                  <p className="text-xs text-muted-foreground">
                    Until this is signed, a rider is active and could be put on a horse with
                    nothing on file. Riders with no email are listed by name for a paper form.
                  </p>
                </div>
                <span className="flex items-center gap-2">
                  {noConsent > 0 ? (
                    <Badge variant="destructive">{noConsent} unsigned</Badge>
                  ) : (
                    <Badge variant="success">All signed</Badge>
                  )}
                  <Link href="/riders/consent" className="text-xs text-primary underline">
                    Open
                  </Link>
                </span>
              </li>

              <li className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-3">
                <div>
                  <span className="font-medium">2 · Put riders in a batch</span>
                  <p className="text-xs text-muted-foreground">
                    Attendance is built from batch membership — a rider with no batch can never
                    be marked present. The spreadsheet deliberately doesn&apos;t carry batches:
                    select several riders on the Riders page and assign them in one action.
                  </p>
                </div>
                <span className="flex items-center gap-2">
                  {noBatchCount > 0 ? (
                    <Badge variant="warning">{noBatchCount} unassigned</Badge>
                  ) : (
                    <Badge variant="success">All assigned</Badge>
                  )}
                  <Link href="/riders" className="text-xs text-primary underline">
                    Open
                  </Link>
                </span>
              </li>

              <li className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-3">
                <div>
                  <span className="font-medium">3 · Give every batch a coach</span>
                  <p className="text-xs text-muted-foreground">
                    Attendance needs a coach AND riders. Assigning riders to a batch with no coach
                    still leaves a register nobody can open.
                  </p>
                </div>
                <span className="flex items-center gap-2">
                  {batchesNoCoach > 0 ? (
                    <Badge variant="destructive">{batchesNoCoach} without a coach</Badge>
                  ) : (
                    <Badge variant="success">All covered</Badge>
                  )}
                  <Link href="/batches" className="text-xs text-primary underline">
                    Open
                  </Link>
                </span>
              </li>

              <li className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <span className="font-medium">4 · Create portal logins (optional)</span>
                  <p className="text-xs text-muted-foreground">
                    Only possible for riders with an email — theirs or a parent&apos;s. Passwords
                    land on the Credential Sheet so they can be handed over later.
                  </p>
                </div>
                <span className="flex items-center gap-2">
                  <Badge variant="outline">{noLogin} without a login</Badge>
                  <Link href="/riders/consent" className="text-xs text-primary underline">
                    Open
                  </Link>
                </span>
              </li>
            </ol>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
