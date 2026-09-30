import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { familyCertWhere } from "@/lib/exam-visibility";
import { PrintableCertificate } from "@/components/certificates/printable-certificate";
import { PrintButton } from "@/app/(admin)/certificates/[id]/print/print-button";

// A family's own certificate, to view, print or save as PDF. Families saw only
// a serial number in a list; the certificate itself was staff-only. The caller
// has already proved the rider is theirs (and bound the org for RLS).
export async function FamilyCertificateView({ certId, riderId, backHref }: { certId: string; riderId: string; backHref: string }) {
  const cert = await prisma.certificate.findFirst({
    where: { id: certId, riderId, ...familyCertWhere },
    include: {
      centre: { select: { name: true, address: true, org: { select: { name: true } } } },
      rider: { select: { firstName: true, lastName: true, currentLevel: true } },
      exam: { select: { date: true, level: true } },
    },
  });
  if (!cert) return null;
  const signer = cert.signedBy ? await prisma.user.findUnique({ where: { id: cert.signedBy }, select: { name: true } }) : null;
  return (
    <main className="mx-auto min-h-screen max-w-[210mm] bg-white p-4 text-slate-900 sm:p-12 print:p-0">
      <style>{`
        @page { size: A4 portrait; margin: 0 }
        @media print {
          body { background:#fff; margin:0 }
          .no-print { display:none !important }
          .cert-page { min-height: 297mm; padding: 36mm 24mm }
        }
      `}</style>
      <div className="no-print mb-4 flex items-center justify-between gap-2">
        <Link href={backHref} className="text-sm text-slate-600 hover:underline">
          ← Back
        </Link>
        <PrintButton />
      </div>
      <PrintableCertificate cert={cert} signerName={signer?.name ?? null} />
    </main>
  );
}
