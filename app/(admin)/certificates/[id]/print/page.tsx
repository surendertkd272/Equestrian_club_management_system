import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { centreFence } from "@/lib/authz-centre";
import { requireSession } from "@/lib/auth";
import { PrintButton } from "./print-button";
import { PrintableCertificate } from "@/components/certificates/printable-certificate";

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
  // HQ roles carry centreId = null, so this comparison 404'd ADMIN on every
  // one of these screens while org-fencing nobody. Same helper the API uses.
  if (await centreFence(session, cert.centreId)) notFound();

  // signedBy stores a User.id as a plain string (no FK relation) — fetch separately.
  const signer = cert.signedBy
    ? await prisma.user.findUnique({ where: { id: cert.signedBy }, select: { name: true } })
    : null;

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

      <PrintableCertificate cert={cert} signerName={signer?.name ?? null} />

      <div className="no-print mt-6 flex justify-end">
        <PrintButton />
      </div>
    </main>
  );
}
