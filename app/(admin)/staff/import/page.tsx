import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { scopeCentre } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";
import { ASSIGNABLE_STAFF_ROLES } from "@/lib/schemas/staff";
import { StaffImportForm } from "./import-form";

export const dynamic = "force-dynamic";

export default async function StaffImportPage() {
  const session = await requireSession();
  // Same gate as the API and as Add Staff — one permission, so the page can
  // never be the soft spot.
  if (!can(session.role, "staff.manage")) redirect("/staff");

  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/no-organisation");
  const centreId = scopeCentre(session);

  // Name the destination. Import is centre-wise and creates real login
  // accounts, so the page states where the rows will land and refuses to show
  // the form at all when an HQ user is on "All centres".
  const targetCentre = centreId
    ? await prisma.centre.findFirst({ where: { id: centreId, orgId }, select: { name: true } })
    : null;

  // The Credential Sheet is HQ-only, so linking a centre manager to it would
  // hand them a 403. They get told where the passwords are instead.
  const canSeeCredentials = ["SUPER_ADMIN", "ADMIN"].includes(session.role);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <Button asChild variant="ghost" size="sm">
          <Link href="/staff">
            <ChevronLeft className="h-4 w-4" /> Back to staff
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Bulk upload staff</CardTitle>
          <CardDescription>
            Create staff accounts from the Excel template. Preview first — it catches
            duplicate emails and bad roles before anything is written.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {targetCentre ? (
            <>
              <div className="mb-4 rounded-md border border-info/30 bg-info-soft px-3 py-2 text-sm text-info-foreground">
                Staff in this file will be added to <strong>{targetCentre.name}</strong>. Upload
                one file per centre — the spreadsheet has no centre column, so the destination is
                whichever centre is selected here.
              </div>
              <StaffImportForm />
            </>
          ) : (
            <div className="rounded-md border border-warning/30 bg-warning-soft px-3 py-3 text-sm text-warning-foreground">
              <p className="font-medium">Pick a centre first.</p>
              <p className="mt-1">
                You&apos;re viewing <strong>All centres</strong>. Staff are created in one centre,
                so choose the destination from the centre selector in the top bar, then come back.
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
              <code className="rounded bg-muted px-1">name</code> (full_name / employee_name) —
              required
            </li>
            <li>
              <code className="rounded bg-muted px-1">email</code> — required, this is their login
              and must be unique across the platform
            </li>
            <li>
              <code className="rounded bg-muted px-1">role</code> (designation / job_title) —
              required
            </li>
            <li>
              <code className="rounded bg-muted px-1">phone</code> (mobile / contact) — optional,
              Indian mobile
            </li>
            <li>
              <code className="rounded bg-muted px-1">salary_band</code> (band / salary_grade) —
              optional
            </li>
            <li>
              <code className="rounded bg-muted px-1">joining_date</code> (doj /
              date_of_joining) — optional, format <code>YYYY-MM-DD</code>
            </li>
          </ul>
          <p className="rounded-md border bg-muted/30 p-2 text-xs">
            <strong>There is no password column, deliberately.</strong> A spreadsheet of
            plaintext passwords gets emailed around and left in Downloads. Each account gets its
            own generated password instead, kept encrypted and reprintable
            {canSeeCredentials ? (
              <>
                {" "}
                from the{" "}
                <Link href="/users/credentials" className="text-primary underline">
                  Credential Sheet
                </Link>
                .
              </>
            ) : (
              " from the Credential Sheet, which an HQ admin can open for you."
            )}
          </p>
          <details className="rounded-md border bg-muted/30 p-3 text-xs">
            <summary className="cursor-pointer font-medium">
              Accepted roles ({ASSIGNABLE_STAFF_ROLES.length})
            </summary>
            <p className="mt-2 font-mono leading-relaxed">{ASSIGNABLE_STAFF_ROLES.join(" · ")}</p>
            <p className="mt-2 text-muted-foreground">
              Everyday job titles are understood too — &ldquo;Head Coach&rdquo;,
              &ldquo;Instructor&rdquo;, &ldquo;Syce&rdquo;, &ldquo;Storekeeper&rdquo;,
              &ldquo;Accounts&rdquo;. An unrecognised title is reported by name rather than
              guessed at: quietly filing someone as a coach would hand them a coach&apos;s access
              to children&apos;s records.
            </p>
          </details>
          <details className="rounded-md border bg-muted/30 p-3 text-xs">
            <summary className="cursor-pointer font-medium">Example CSV</summary>
            <pre className="mt-2 overflow-x-auto whitespace-pre">
{`name,email,role,phone,salary_band,joining_date
Ravi Kumar,ravi@club.in,COACH,9876543210,C2,2026-04-01
Meena Rao,meena@club.in,Head Coach,9876501234,C1,2026-04-01
Imran Shaikh,imran@club.in,Syce,9876512345,,2026-05-15
`}
            </pre>
          </details>
        </CardContent>
      </Card>

      {targetCentre && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">What this does and does not create</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              <li>
                <span className="font-medium">Creates:</span> an active login account and a staff
                record at this centre, with the role from the sheet.
              </li>
              <li>
                <span className="font-medium">Does not create:</span> KYC documents. Aadhaar, PAN,
                bank proof and police verification can&apos;t travel in a spreadsheet — send new
                hires the self-onboarding link from{" "}
                <Link href="/staff/onboarding" className="text-primary underline">
                  Employee Onboarding
                </Link>{" "}
                so they upload their own, or add them per person from the staff profile.
              </li>
              <li>
                <span className="font-medium">Police verification stays empty</span> until a
                certificate is attached — it is mandatory before anyone works with minors, and a
                bulk upload must not be a way to skip it.
              </li>
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
