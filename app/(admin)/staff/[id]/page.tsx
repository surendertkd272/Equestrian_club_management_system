import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, FileText } from "lucide-react";
import { getSession } from "@/lib/auth";
import { scopeCentre } from "@/lib/tenancy";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { loadEmployeeProfile, employeeFormRows } from "@/lib/employee-profile";
import { PrintControl } from "./print-control";

export const dynamic = "force-dynamic";

// Per the request, the profile + print packet are an admin / super-admin tool.
const CAN_VIEW = ["SUPER_ADMIN", "ADMIN"];

export default async function StaffProfilePage({ params }: { params: { id: string } }) {
  const session = (await getSession())!;
  if (!CAN_VIEW.includes(session.role)) redirect("/staff");

  const profile = await loadEmployeeProfile(params.id, scopeCentre(session));
  if (!profile) notFound();

  const { staff, docs, declarationName, hasOnboarding } = profile;
  const rows = employeeFormRows(profile.record);

  return (
    <div className="space-y-6">
      <Link href="/staff" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to staff
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{staff.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="outline">{staff.role.replaceAll("_", " ")}</Badge>
            <Badge variant={staff.status === "active" ? "success" : "warning"}>{staff.status}</Badge>
            <span>· joined {formatDate(staff.joiningDate)}</span>
          </div>
        </div>
        <PrintControl staffId={staff.id} docs={docs.map((d) => ({ key: d.key, label: d.label }))} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Registration form</CardTitle>
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
          {declarationName && (
            <p className="mt-3 text-[11px] text-muted-foreground">
              Self-declaration accepted by typing: <span className="font-medium text-foreground">{declarationName}</span>
            </p>
          )}
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
