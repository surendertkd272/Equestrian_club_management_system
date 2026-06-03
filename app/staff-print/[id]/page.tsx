import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { scopeCentre } from "@/lib/tenancy";
import { formatDate } from "@/lib/utils";
import { loadEmployeeProfile, employeeFormRows } from "@/lib/employee-profile";
import { AutoPrint } from "./auto-print";

export const dynamic = "force-dynamic";

const CAN_VIEW = ["SUPER_ADMIN", "ADMIN"];

// Standalone, shell-less print packet for an employee. Lives outside the
// (admin) route group on purpose so the sidebar/topbar don't render into the
// print output. Auth is enforced here directly.
export default async function StaffPrintPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { items?: string };
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!CAN_VIEW.includes(session.role)) redirect("/staff");

  const profile = await loadEmployeeProfile(params.id, scopeCentre(session));
  if (!profile) notFound();

  const selected = new Set((searchParams.items ?? "form").split(",").map((s) => s.trim()).filter(Boolean));
  const includeForm = selected.has("form");
  const docs = profile.docs.filter((d) => selected.has(d.key));
  const rows = employeeFormRows(profile.record);
  const printedOn = formatDate(new Date());

  // Nothing selected → at least show the form so the page is never blank.
  const showForm = includeForm || docs.length === 0;

  return (
    <div className="print-packet">
      <AutoPrint />
      <style
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{
          __html: `
            @page { margin: 14mm; }
            html, body { background: #fff; }
            .print-packet { color: #0f172a; font-size: 13px; }
            .pkg-page { padding: 4px 0; }
            .pkg-page + .pkg-page { page-break-before: always; }
            .pkg-h { font-size: 18px; font-weight: 700; margin: 0 0 2px; }
            .pkg-sub { color: #64748b; font-size: 11px; margin: 0 0 14px; }
            .pkg-row { display: flex; justify-content: space-between; gap: 16px; padding: 4px 0; border-bottom: 1px dashed #e2e8f0; }
            .pkg-row dt { color: #64748b; }
            .pkg-row dd { margin: 0; font-weight: 600; text-align: right; }
            .pkg-doc-title { font-size: 13px; font-weight: 600; margin: 0 0 8px; }
            .pkg-doc-img { max-width: 100%; max-height: 250mm; display: block; margin: 0 auto; }
            .pkg-doc-frame { width: 100%; height: 250mm; border: 1px solid #e2e8f0; }
            .pkg-open { font-size: 11px; }
            .toolbar { margin-bottom: 16px; }
            @media print { .toolbar { display: none !important; } }
          `,
        }}
      />

      <div className="toolbar flex items-center gap-3 rounded-md border bg-slate-50 p-3 text-sm">
        <span className="text-slate-600">
          Printing packet for <strong>{profile.staff.name}</strong>. The print dialog opens automatically — if it
          doesn&apos;t, press <kbd>Ctrl/Cmd&nbsp;+&nbsp;P</kbd>.
        </span>
      </div>

      {showForm && (
        <section className="pkg-page">
          <h1 className="pkg-h">{profile.staff.name} — Employee registration</h1>
          <p className="pkg-sub">
            {profile.staff.role.replaceAll("_", " ")} · joined {formatDate(profile.staff.joiningDate)} · printed {printedOn}
          </p>
          <dl>
            {rows.map((r) => (
              <div key={r.label} className="pkg-row">
                <dt>{r.label}</dt>
                <dd>{r.value}</dd>
              </div>
            ))}
          </dl>
          {profile.declarationName && (
            <p className="pkg-sub" style={{ marginTop: 14 }}>
              Self-declaration accepted by typing: <strong>{profile.declarationName}</strong>
            </p>
          )}
        </section>
      )}

      {docs.map((d) => (
        <section key={d.key} className="pkg-page">
          <p className="pkg-doc-title">
            {d.label} — {profile.staff.name}{" "}
            <a className="pkg-open" href={d.url} target="_blank" rel="noopener">
              (open ↗)
            </a>
          </p>
          {d.isPdf ? (
            <iframe className="pkg-doc-frame" src={d.url} title={d.label} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="pkg-doc-img" src={d.url} alt={d.label} />
          )}
        </section>
      ))}
    </div>
  );
}
