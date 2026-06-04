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

  // Images embed inline and print with the form in one job. PDFs can't be
  // embedded (the app's CSP blocks framing, and browsers don't print framed
  // PDFs into the parent job anyway) — they open in their own tab to print.
  const images = docs.filter((d) => !d.isPdf);
  const pdfs = docs.filter((d) => d.isPdf);

  // Honour the picker: only force the form in when nothing at all was selected
  // (so the page is never blank). A PDF-only selection shows just the PDF card.
  const showForm = includeForm || docs.length === 0;
  // Only auto-open the print dialog when there's something to print inline.
  const hasInline = showForm || images.length > 0;

  return (
    <div className="print-packet">
      {hasInline && <AutoPrint />}
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
            .pkg-open { font-size: 11px; }
            .toolbar { margin-bottom: 16px; }
            .pdf-card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
            .pdf-btn { display: inline-block; background: #0f172a; color: #fff; padding: 8px 14px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 13px; white-space: nowrap; }
            .pdf-note { display: none; color: #64748b; font-size: 12px; }
            @media print {
              .toolbar { display: none !important; }
              .pdf-card { display: none !important; }
              .pdf-note { display: block; }
            }
          `,
        }}
      />

      <div className="toolbar flex flex-col gap-1 rounded-md border bg-slate-50 p-3 text-sm text-slate-600">
        <span>
          Packet for <strong>{profile.staff.name}</strong>.{" "}
          {hasInline ? (
            <>The print dialog opens automatically — if it doesn&apos;t, press <kbd>Ctrl/Cmd&nbsp;+&nbsp;P</kbd>.</>
          ) : (
            <>Use the button(s) below to open and print each document.</>
          )}
        </span>
        {pdfs.length > 0 && (
          <span className="text-slate-500">
            {pdfs.length} PDF attachment{pdfs.length === 1 ? "" : "s"} can&apos;t be embedded — open{" "}
            {pdfs.length === 1 ? "it" : "each"} below to print at full quality.
          </span>
        )}
      </div>

      {showForm && (
        <section className="pkg-page">
          <h1 className="pkg-h">{profile.staff.name} — Employee Registration</h1>
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

      {images.map((d) => (
        <section key={d.key} className="pkg-page">
          <p className="pkg-doc-title">
            {d.label} — {profile.staff.name}{" "}
            <a className="pkg-open" href={d.url} target="_blank" rel="noopener">
              (open ↗)
            </a>
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="pkg-doc-img" src={d.url} alt={d.label} />
        </section>
      ))}

      {pdfs.map((d) => (
        <section key={d.key} className="pkg-page">
          <p className="pkg-doc-title">{d.label} — {profile.staff.name}</p>
          {/* PDFs can't embed under the app's CSP — open to print natively. */}
          <div className="pdf-card">
            <span style={{ fontSize: 13, color: "#334155" }}>
              This is a PDF. Open it to view and print at full quality.
            </span>
            <a className="pdf-btn" href={d.url} target="_blank" rel="noopener">
              Open &amp; print PDF ↗
            </a>
          </div>
          <p className="pdf-note">PDF attachment — printed separately: {d.url}</p>
        </section>
      ))}
    </div>
  );
}
