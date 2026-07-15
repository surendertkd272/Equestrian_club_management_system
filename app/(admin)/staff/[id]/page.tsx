import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, FileText, Pencil } from "lucide-react";
import { getSession } from "@/lib/auth";
import { scopeCentre } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { loadEmployeeProfile, employeeFormRows } from "@/lib/employee-profile";
import {
  ONBOARDING_AGREEMENT,
  ONBOARDING_DECLARATION,
  ONBOARDING_AGREEMENT_HI,
  ONBOARDING_DECLARATION_HI,
  ONBOARDING_AGREEMENT_VERSION,
  ONBOARDING_DECLARATION_VERSION,
} from "@/lib/schemas/onboarding-staff";
import { PrintControl } from "./print-control";
import { formatEnum, roleLabel } from "@/lib/labels";
export const dynamic = "force-dynamic";

// Profile + consent record: SUPER_ADMIN + ADMIN + CENTRE_MANAGER (a manager can
// view their own centre's staff — the load is already centre-scoped). Managers
// need this to answer an employee's "I never agreed to that" dispute.
const CAN_VIEW = ["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER"];

export default async function StaffProfilePage({ params }: { params: { id: string } }) {
  const session = (await getSession())!;
  if (!CAN_VIEW.includes(session.role)) redirect("/staff");

  const profile = await loadEmployeeProfile(params.id, scopeCentre(session), await getOrgIdForSession(session));
  if (!profile) notFound();

  const { staff, docs, declarationName, hasOnboarding } = profile;
  const rows = employeeFormRows(profile.record);

  // Consent record — what the employee accepted, for showing back to them later.
  const rec = profile.record;
  const agreementAccepted = rec.agreementAccepted === true;
  const declarationAccepted = rec.declarationAccepted === true;
  const submittedAt = rec.submittedAt ? new Date(rec.submittedAt as string | number | Date) : null;
  const hasConsent = agreementAccepted || declarationAccepted || !!declarationName;

  return (
    <div className="space-y-6">
      <Link href="/staff" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to staff
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{staff.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="outline">{roleLabel(staff.role)}</Badge>
            <Badge variant={staff.status === "active" ? "success" : "warning"}>{formatEnum(staff.status)}</Badge>
            <span>· joined {formatDate(staff.joiningDate)}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/staff/${staff.id}/edit`}
            className="inline-flex items-center gap-1.5 rounded-md border bg-card px-3 py-1.5 text-sm font-medium hover:bg-muted"
          >
            <Pencil className="h-4 w-4" /> Edit
          </Link>
          <PrintControl staffId={staff.id} docs={docs.map((d) => ({ key: d.key, label: d.label }))} />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Registration Form</CardTitle>
          <CardDescription>
            {hasOnboarding
              ? "Submitted through the employee self-registration link."
              : "Reconstructed from this staff member's stored records (no self-registration on file)."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
            {rows.map((r) => (
              <div key={r.label} className="flex justify-between gap-3 border-b border-dashed py-1 text-sm">
                <dt className="text-muted-foreground">{r.label}</dt>
                <dd className="text-right font-medium">{r.value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      {/* Proof of consent — the exact agreement + declaration the employee
          accepted, so you can show it back to them if they later dispute it. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Consent &amp; Agreement</CardTitle>
          <CardDescription>
            {hasConsent
              ? "What this employee read and accepted during registration. Expand to see the exact wording."
              : "No recorded consent on file (added manually, not via the self-registration form)."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={agreementAccepted ? "success" : "outline"}>
              {agreementAccepted ? "✓ Employee Agreement accepted" : "Agreement — not recorded"}
            </Badge>
            <Badge variant={declarationAccepted ? "success" : "outline"}>
              {declarationAccepted ? "✓ Self-Declaration accepted" : "Declaration — not recorded"}
            </Badge>
          </div>

          {(declarationName || submittedAt) && (
            <p className="text-xs text-muted-foreground">
              {declarationName && (
                <>Signed by typing full name: <span className="font-medium text-foreground">{declarationName}</span></>
              )}
              {submittedAt && <> · on <span className="font-medium text-foreground">{formatDate(submittedAt)}</span></>}
              {" "}(legal e-signature).
            </p>
          )}

          <details className="rounded-md border bg-muted/20 p-2">
            <summary className="cursor-pointer text-xs font-medium text-primary">
              View Employee Agreement (English + हिंदी) · version {ONBOARDING_AGREEMENT_VERSION}
            </summary>
            <pre className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-foreground">{ONBOARDING_AGREEMENT}</pre>
            <pre className="mt-3 whitespace-pre-wrap border-t pt-2 text-xs leading-relaxed text-foreground">{ONBOARDING_AGREEMENT_HI}</pre>
          </details>

          <details className="rounded-md border bg-muted/20 p-2">
            <summary className="cursor-pointer text-xs font-medium text-primary">
              View Self-Declaration (English + हिंदी) · version {ONBOARDING_DECLARATION_VERSION}
            </summary>
            <pre className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-foreground">{ONBOARDING_DECLARATION}</pre>
            <pre className="mt-3 whitespace-pre-wrap border-t pt-2 text-xs leading-relaxed text-foreground">{ONBOARDING_DECLARATION_HI}</pre>
          </details>

          <p className="text-[11px] text-muted-foreground">
            This is the exact wording on file. Each registration also records a tamper-evident proof
            (version + content fingerprint + language + time) in the Audit Log.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Uploaded documents ({docs.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {docs.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No documents on file.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {docs.map((d) => (
                <a
                  key={d.key}
                  href={d.url}
                  target="_blank"
                  rel="noopener"
                  className="group overflow-hidden rounded-md border bg-card hover:border-primary"
                >
                  <div className="flex h-28 items-center justify-center bg-muted/40">
                    {d.isPdf ? (
                      <FileText className="h-10 w-10 text-muted-foreground" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={d.url} alt={d.label} className="h-full w-full object-cover" />
                    )}
                  </div>
                  <div className="px-2 py-1.5 text-xs">
                    <div className="font-medium group-hover:text-primary">{d.label}</div>
                    <div className="text-[10px] uppercase text-muted-foreground">{d.isPdf ? "PDF" : "Image"}</div>
                  </div>
                </a>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
