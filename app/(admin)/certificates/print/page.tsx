import { redirect } from "next/navigation";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { centreFence } from "@/lib/authz-centre";
import { requireSession } from "@/lib/auth";
import { examinerCertificateScope } from "@/lib/exam-access";
import { PrintableCertificate } from "@/components/certificates/printable-certificate";
import { PrintButton } from "../[id]/print/print-button";

export const dynamic = "force-dynamic";

// Print many certificates at once — every live certificate from a sitting, an
// exam day, or a bulk-issue batch, one A4 page each. They were printed one at
// a time: a day with 180 passes meant opening 180 pages.
const MAX = 400;

export default async function BulkCertificatePrintPage({
  searchParams,
}: {
  searchParams: { sitting?: string; day?: string; batch?: string };
}) {
  const session = await requireSession();
  const where: Prisma.CertificateWhereInput | null = searchParams.sitting
    ? { exam: { sittingId: searchParams.sitting } }
    : searchParams.day
      ? { exam: { sitting: { examDayId: searchParams.day } } }
      : searchParams.batch
        ? { batchTag: searchParams.batch }
        : null;
  if (!where) redirect("/certificates");
  const scope = examinerCertificateScope(session);
  const certs = await prisma.certificate.findMany({
    where: { ...where, revokedAt: null, ...(scope ?? {}) },
    include: {
      centre: { select: { name: true, address: true, org: { select: { name: true } } } },
      rider: { select: { firstName: true, lastName: true, currentLevel: true } },
      exam: { select: { date: true, level: true, runOrder: true } },
    },
    orderBy: [{ levelName: "asc" }, { rider: { firstName: "asc" } }],
    take: MAX,
  });
  for (const centreId of new Set(certs.map((c) => c.centreId))) {
    if (await centreFence(session, centreId)) redirect("/certificates");
  }
  const signerIds = Array.from(new Set(certs.map((c) => c.signedBy).filter((x): x is string => !!x)));
  const signers = new Map(
    (await prisma.user.findMany({ where: { id: { in: signerIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]),
  );

  return (
    <main className="mx-auto max-w-[210mm] bg-white text-slate-900">
      <style>{`
        @page { size: A4 portrait; margin: 0 }
        @media print {
          body { background:#fff; margin:0 }
          .no-print { display:none !important }
          .cert-page { min-height: 297mm; padding: 36mm 24mm }
          .cert-sheet { break-after: page; }
          .cert-sheet:last-child { break-after: auto; }
        }
      `}</style>
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2 p-4">
        <div>
          <Link href="/certificates" className="text-xs text-muted-foreground hover:underline">
            ← Certificates
          </Link>
          <p className="text-sm">
            {certs.length} certificate{certs.length === 1 ? "" : "s"} to print
            {certs.length === MAX ? ` (the first ${MAX})` : ""}. Revoked certificates are left out.
          </p>
        </div>
        {certs.length > 0 && <PrintButton />}
      </div>
      {certs.length === 0 && <p className="p-4 text-sm text-muted-foreground">No live certificates here yet.</p>}
      {certs.map((c) => (
        <div key={c.id} className="cert-sheet mb-8 print:mb-0">
          <PrintableCertificate cert={c} signerName={c.signedBy ? signers.get(c.signedBy) ?? null : null} />
        </div>
      ))}
    </main>
  );
}
