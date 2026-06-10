import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { scopeCentre } from "@/lib/tenancy";
import { getOrgIdForSession, getOrgIdForCentre } from "@/lib/features-gate";
import { qrSvg, verifyUrl } from "@/lib/cert";
import { Button } from "@/components/ui/button";
import { PrintButton } from "./print-button";
import { SendResultButton } from "./send-result-button";
import { ChevronLeft } from "lucide-react";
import { formatDate } from "@/lib/utils";

const SEND_RESULT_ROLES = new Set([
  "SUPER_ADMIN",
  "ADMIN",
  "CENTRE_MANAGER",
  "HEAD_COACH",
  "COACH",
]);

export const dynamic = "force-dynamic";

export default async function CertificateView({ params }: { params: { id: string } }) {
  const session = (await getSession())!;
  const centreId = scopeCentre(session);

  const cert = await prisma.certificate.findUnique({
    where: { id: params.id },
    include: {
      rider: { select: { firstName: true, lastName: true, email: true } },
      centre: { select: { name: true, address: true } },
    },
  });
  if (!cert) notFound();
  if (centreId && cert.centreId !== centreId) notFound();
  // HQ users (centreId=null) skip the centre guard above, so bound them by org:
  // an HQ user must not open another org's certificate by id.
  const orgId = await getOrgIdForSession(session);
  if (!orgId || (await getOrgIdForCentre(cert.centreId)) !== orgId) notFound();
  const canSendResult = SEND_RESULT_ROLES.has(session.role) && !!cert.examId;

  const signer = cert.signedBy ? await prisma.user.findUnique({ where: { id: cert.signedBy }, select: { name: true, role: true } }) : null;
  const qr = await qrSvg(verifyUrl(cert.serialNo), { size: 160 });

  return (
    <div className="space-y-4">
      {/* Certificates print as landscape; the global default is portrait. */}
      <style>{`@media print { @page { size: A4 landscape; margin: 12mm; } }`}</style>
      <div className="flex items-center justify-between print:hidden">
        <Button asChild variant="ghost" size="sm">
          <Link href="/certificates">
            <ChevronLeft className="h-4 w-4" /> Back
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          {canSendResult && (
            <SendResultButton
              certId={cert.id}
              alreadySentAt={cert.resultEmailSentAt?.toISOString() ?? null}
              parentEmail={cert.rider.email}
            />
          )}
          <PrintButton />
        </div>
      </div>
      {canSendResult && cert.resultEmailSentAt && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[11px] text-emerald-900 print:hidden">
          ✓ Result emailed to parent on{" "}
          <span className="font-mono">
            {cert.resultEmailSentAt.toLocaleString("en-IN")}
          </span>
        </div>
      )}

      <div className="mx-auto max-w-[800px] bg-white">
        <div className="relative mx-auto aspect-[1.414/1] border-[12px] border-primary/80 p-12 shadow-xl print:shadow-none print:border-[8px]">
          {/* Inner border */}
          <div className="absolute inset-3 border-2 border-amber-500/60" />

          <div className="relative flex h-full flex-col items-center justify-between text-center">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-amber-700">Equiwings · {cert.centre.name}</div>
              <h1 className="mt-2 text-4xl font-extrabold tracking-tight text-primary">Certificate of {cert.type === "promotion" ? "Promotion" : cert.type === "winner" ? "Achievement" : "Participation"}</h1>
              <p className="mt-2 text-sm italic text-muted-foreground">This is to certify that</p>
            </div>

            <div className="w-full">
              <p className="border-b-2 border-amber-500/40 pb-1 text-5xl font-extrabold text-foreground">
                {cert.rider.firstName} {cert.rider.lastName}
              </p>
              <p className="mt-6 text-base leading-relaxed text-foreground">
                has successfully completed all requirements of the riding program and is hereby promoted to
                <br />
                <span className="text-2xl font-bold text-primary">{cert.levelName ?? "—"}</span>
              </p>
              <p className="mt-4 text-sm text-muted-foreground">
                Awarded on {formatDate(cert.issuedAt)} at {cert.centre.name}
              </p>
            </div>

            <div className="grid w-full grid-cols-3 items-end gap-6 text-xs">
              <div className="text-left">
                <div className="border-t-2 border-foreground pt-2 font-semibold">
                  {signer?.name ?? "Centre Manager"}
                </div>
                <div className="text-muted-foreground">{signer?.role?.replaceAll("_", " ") ?? "Authority"}</div>
              </div>
              <div className="flex flex-col items-center">
                <div
                  className="h-32 w-32"
                  dangerouslySetInnerHTML={{ __html: qr }}
                  aria-label={`QR code for verifying ${cert.serialNo}`}
                />
                <div className="mt-1 text-[10px] text-muted-foreground">Scan to verify</div>
              </div>
              <div className="text-right">
                <div className="border-t-2 border-foreground pt-2 font-semibold">Equiwings HQ</div>
                <div className="text-muted-foreground">Issuing authority</div>
              </div>
            </div>

            <div className="w-full text-[10px] tracking-wider text-muted-foreground">
              Serial: <span className="font-mono font-bold">{cert.serialNo}</span> · Verify at {verifyUrl(cert.serialNo)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
