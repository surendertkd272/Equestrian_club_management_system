import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { scopeCentre } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { hasBaseUrl } from "@/lib/absolute-url";
import { consentRecipient } from "@/lib/rider-consent-request";
import { ConsentRequestPanel } from "./client";
import { VerifySignatureButton } from "./verify-button";

export const dynamic = "force-dynamic";

const ROLES = ["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER"];

// Chasing consent for riders who never saw the registration form.
//
// Bulk import and staff-created riders arrive with no signature at all, which
// is invisible on a profile — it looks like an empty field rather than a rider
// mounting with nothing on file. This page makes that population countable,
// emailable, and then verifiable once they sign.
export default async function RiderConsentPage() {
  const session = await requireSession();
  if (!ROLES.includes(session.role)) redirect("/dashboard");

  const centreId = scopeCentre(session);
  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/no-organisation");

  if (!centreId) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Consent collection</h1>
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            Pick a centre in the top bar. Consent requests are sent per centre, because the email
            names the club the rider actually attends.
          </CardContent>
        </Card>
      </div>
    );
  }

  const [unsigned, awaitingVerification] = await Promise.all([
    prisma.rider.findMany({
      where: {
        centreId,
        indemnitySignedAt: null,
        status: { notIn: ["withdrawn", "rejected", "cancelled"] },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        status: true,
        mobile: true,
        fatherPhone: true,
        motherPhone: true,
        // Feeds consentRecipient's parent-email fallback and consentPhone.
        parentalConsentJson: true,
        parentLinks: { select: { parent: { select: { email: true } } } },
        consentRequests: {
          where: { signedAt: null, expiresAt: { gt: new Date() } },
          select: { sentAt: true },
          orderBy: { sentAt: "desc" },
          take: 1,
        },
      },
      orderBy: [{ firstName: "asc" }],
    }),
    // Signed, but nobody has confirmed it at the club's end yet. This is the
    // "we again verify them" half of the loop.
    prisma.rider.findMany({
      where: { centreId, indemnitySignedAt: { not: null }, verifiedAt: null },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        indemnitySignedAt: true,
        indemnityConsentJson: true,
      },
      orderBy: { indemnitySignedAt: "desc" },
      take: 200,
    }),
  ]);

  const rows = unsigned.map((r) => ({
    id: r.id,
    name: `${r.firstName} ${r.lastName}`,
    email: consentRecipient(r),
    pendingSince: r.consentRequests[0]?.sentAt?.toISOString() ?? null,
  }));
  const reachable = rows.filter((r) => r.email).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Consent collection</h1>
        <p className="text-sm text-muted-foreground">
          Riders added by import or by staff never saw the registration form, so they have no
          indemnity on file. Email them a signing link, then confirm the signatures as they arrive.
        </p>
      </div>

      {!hasBaseUrl() && (
        <Card className="border-destructive">
          <CardContent className="pt-6 text-sm">
            No public site address is configured (<code>NEXT_PUBLIC_APP_URL</code>), so a signing
            link would arrive in the inbox broken. Sending is disabled until it is set.
          </CardContent>
        </Card>
      )}

      <ConsentRequestPanel
        centreId={centreId}
        rows={rows}
        reachable={reachable}
        canSend={hasBaseUrl()}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Signed — awaiting your confirmation</CardTitle>
          <CardDescription>
            {awaitingVerification.length} signature
            {awaitingVerification.length === 1 ? "" : "s"} to check. Confirming records that
            somebody at the club looked at it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {awaitingVerification.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing waiting. Signatures appear here as they come in.
            </p>
          ) : (
            <ul className="divide-y text-sm">
              {awaitingVerification.map((r) => {
                const c = (r.indemnityConsentJson ?? {}) as {
                  signature?: string;
                  signerRelation?: string;
                  collectedVia?: string;
                };
                return (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div>
                      <Link href={`/riders/${r.id}`} className="font-medium hover:underline">
                        {r.firstName} {r.lastName}
                      </Link>
                      <div className="text-[11px] text-muted-foreground">
                        Signed{" "}
                        {r.indemnitySignedAt?.toLocaleString("en-IN", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        {c.signature ? ` by ${c.signature}` : ""}
                        {c.signerRelation && c.signerRelation !== "self"
                          ? ` (${c.signerRelation})`
                          : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {c.collectedVia === "consent_request" && (
                        <Badge variant="outline">Emailed link</Badge>
                      )}
                      <VerifySignatureButton riderId={r.id} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
