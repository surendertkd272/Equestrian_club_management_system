import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { PrintButton } from "./print-button";
import { qrSvg, verifyUrl } from "@/lib/cert";

export const dynamic = "force-dynamic";

// Print-ready certificate. Parents will print these and put them on the
// fridge — design optimised for A4 portrait. Uses serif type, a centred
// medallion layout, and `@media print` to hide the action bar.
//
// Browser's Cmd/Ctrl+P → Save as PDF produces the same output a paid
// PDF library would, without the dependency cost.
export default async function CertificatePrintPage({ params }: { params: { id: string } }) {
  const session = await requireSession();
  const cert = await prisma.certificate.findUnique({
    where: { id: params.id },
    include: {
      centre: { select: { name: true, address: true, org: { select: { name: true } } } },
      rider: { select: { firstName: true, lastName: true, currentLevel: true } },
      exam: { select: { date: true, level: true } },
    },
  });
  if (!cert) notFound();
  if (session.role !== "SUPER_ADMIN" && cert.centreId !== session.centreId) notFound();

  // signedBy stores a User.id as a plain string (no FK relation) — fetch separately.
  const signer = cert.signedBy
    ? await prisma.user.findUnique({ where: { id: cert.signedBy }, select: { name: true } })
    : null;

  const issuedDate = new Date(cert.issuedAt).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const occasion =
    cert.type === "promotion" && cert.exam
      ? `Level ${cert.exam.level} promotion · ${new Date(cert.exam.date).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })}`
      : null;

  const verifyHref = verifyUrl(cert.serialNo);

  // Rendered locally with the `qrcode` package, exactly like the certificate
  // detail page. This used to point at Google's Charts/Infographics QR
  // endpoint — which Google has since switched off, so every certificate this
  // page printed carried a QR that resolved to a 404 image. Generating it here
  // also means printing works offline and no certificate serial is handed to a
  // third party on every render.
  const qr = await qrSvg(verifyHref, { size: 160 });

  return (
    <main className="mx-auto min-h-screen max-w-[210mm] bg-white p-12 text-slate-900 print:p-0">
      <style>{`
        @page { size: A4 portrait; margin: 0 }
        @media print {
          body { background:#fff; margin:0 }
          .no-print { display:none !important }
          .cert-page { min-height: 297mm; padding: 36mm 24mm }
        }
      `}</style>

      <div className="cert-page relative border-[6px] border-double border-amber-700/60 px-12 py-16 text-center">
        {/* Top crest band */}
        <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-amber-800">
          {cert.centre.org.name}
        </div>
        <div className="mt-1 text-[14px] text-slate-600">{cert.centre.name}</div>

        {/* Title */}
        <h1 className="mt-12 font-serif text-5xl tracking-wide">
          {cert.type === "winner"
            ? "Certificate of Excellence"
            : cert.type === "promotion"
              ? "Certificate of Promotion"
              : cert.type === "participation"
                ? "Certificate of Participation"
                : "Certificate of Attendance"}
        </h1>

        <div className="mx-auto mt-8 h-px w-32 bg-amber-700/50" />

        <p className="mt-10 text-sm uppercase tracking-widest text-slate-500">presented to</p>
        <p className="mt-3 font-serif text-4xl">
          {cert.rider.firstName} {cert.rider.lastName}
        </p>

        <p className="mx-auto mt-10 max-w-md text-sm leading-7 text-slate-700">
          {cert.type === "promotion" ? (
            <>
              In recognition of successful promotion to <strong>{cert.levelName ?? cert.rider.currentLevel ?? "—"}</strong>{" "}
              after passing the formal examination.
            </>
          ) : cert.type === "winner" ? (
            <>
              In recognition of placing <strong>{cert.levelName ?? ""}</strong>.
            </>
          ) : cert.type === "participation" ? (
            <>
              For participating{cert.levelName ? <> in <strong>{cert.levelName}</strong></> : null}.
            </>
          ) : (
            <>For attending the event.</>
          )}
        </p>

        {occasion && (
          <p className="mt-4 text-xs italic text-slate-500">{occasion}</p>
        )}

        {/* Footer block */}
        <div className="mt-16 flex items-end justify-between">
          <div className="text-left">
            <div className="h-px w-40 bg-slate-400" />
            <div className="mt-1 text-[11px] uppercase tracking-wider text-slate-500">Issued by</div>
            <div className="text-sm font-medium">{signer?.name ?? cert.centre.name}</div>
            <div className="text-[10px] text-slate-500">{issuedDate}</div>
          </div>

          <div className="text-center">
            <div
              className="mx-auto h-[120px] w-[120px]"
              dangerouslySetInnerHTML={{ __html: qr }}
              aria-label={`QR code for verifying ${cert.serialNo}`}
            />
            <div className="mt-1 font-mono text-[10px] text-slate-500">{cert.serialNo}</div>
            <div className="text-[9px] text-slate-400">Scan to verify</div>
          </div>

          <div className="text-right">
            <div className="ml-auto h-px w-40 bg-slate-400" />
            <div className="mt-1 text-[11px] uppercase tracking-wider text-slate-500">Authorised signatory</div>
            <div className="text-sm font-medium">{cert.centre.name}</div>
            <div className="text-[10px] text-slate-500">{cert.centre.address ?? ""}</div>
          </div>
        </div>

        {cert.revokedAt && (
          <div className="absolute inset-0 flex items-center justify-center bg-rose-50/40">
            <div className="rotate-[-15deg] border-4 border-rose-700 px-12 py-4 font-serif text-5xl font-bold uppercase tracking-widest text-rose-700/80">
              Revoked
            </div>
          </div>
        )}
      </div>

      <div className="no-print mt-6 flex justify-end">
        <PrintButton />
      </div>
    </main>
  );
}
