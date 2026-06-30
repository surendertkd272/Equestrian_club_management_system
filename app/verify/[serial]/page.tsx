import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/utils";
import { CheckCircle2, XCircle, Ban } from "lucide-react";
import { bindRlsBypass } from "@/lib/tenant-context";

// Public certificate verification page — same content for every visitor.
// Cache for 5 minutes; certificates rarely change after issue and
// revocation propagating within 5 min is acceptable for a verification
// URL that's already meant for slow-paced human inspection.
export const revalidate = 300;

export default async function VerifyPage({ params }: { params: { serial: string } }) {
  bindRlsBypass(); // public-by-unguessable-id flow (no session to bind an org from)
  const cert = await prisma.certificate.findUnique({
    where: { serialNo: params.serial },
    include: {
      rider: { select: { firstName: true, lastName: true } },
      centre: { select: { name: true, address: true } },
    },
  });

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-secondary to-background p-4">
      <div className="w-full max-w-md rounded-lg border bg-card p-8 shadow-xl">
        {cert ? (
          <>
            <div className="mb-4 flex items-center gap-3">
              {cert.revokedAt ? (
                <>
                  <Ban className="h-10 w-10 text-rose-600" />
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wider text-rose-700">Revoked</div>
                    <div className="text-sm text-muted-foreground">
                      Revoked on {formatDate(cert.revokedAt)}.
                      {cert.revokeReason ? ` Reason: ${cert.revokeReason}` : ""}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-10 w-10 text-emerald-600" />
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wider text-emerald-700">Verified</div>
                    <div className="text-sm text-muted-foreground">This certificate is authentic.</div>
                  </div>
                </>
              )}
            </div>
            <dl className="grid grid-cols-3 gap-y-3 border-t pt-4 text-sm">
              <dt className="col-span-1 text-muted-foreground">Rider</dt>
              <dd className="col-span-2 font-semibold">
                {cert.rider.firstName} {cert.rider.lastName}
              </dd>

              <dt className="col-span-1 text-muted-foreground">Award</dt>
              <dd className="col-span-2 font-semibold capitalize">
                {cert.type === "promotion" ? "Level promotion" : cert.type}
                {cert.levelName ? ` — ${cert.levelName}` : ""}
              </dd>

              <dt className="col-span-1 text-muted-foreground">Issued</dt>
              <dd className="col-span-2">{formatDate(cert.issuedAt)}</dd>

              <dt className="col-span-1 text-muted-foreground">Centre</dt>
              <dd className="col-span-2">{cert.centre.name}</dd>

              <dt className="col-span-1 text-muted-foreground">Serial</dt>
              <dd className="col-span-2 font-mono text-xs">{cert.serialNo}</dd>
            </dl>
            <div className="mt-6 border-t pt-4 text-center text-[11px] text-muted-foreground">
              Issued by Equiwings · scan from a printed certificate to confirm authenticity.
            </div>
          </>
        ) : (
          <>
            <div className="mb-4 flex items-center gap-3">
              <XCircle className="h-10 w-10 text-destructive" />
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-destructive">Not found</div>
                <div className="text-sm text-muted-foreground">No certificate matches this serial.</div>
              </div>
            </div>
            <p className="mt-2 text-sm">
              The serial <code className="font-mono">{params.serial}</code> is either invalid, has been revoked, or
              was mistyped. Please contact Equiwings if you believe this is an error.
            </p>
            <div className="mt-6">
              <Link href="/" className="text-sm text-primary underline">
                ← Back to home
              </Link>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
