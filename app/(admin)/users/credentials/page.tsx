import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { getOrgIdForSession } from "@/lib/features-gate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CredentialSheet } from "./client";

export const dynamic = "force-dynamic";

// The handover sheet for onboarding a club.
//
// HQ only — issuing credentials for other people is the same power as creating
// them, so it sits behind the same gate as /users.
export default async function CredentialsPage({
  searchParams,
}: {
  searchParams: { centreId?: string };
}) {
  const session = await requireSession();
  if (session.role !== "SUPER_ADMIN" && session.role !== "ADMIN") redirect("/dashboard");

  const orgId = await getOrgIdForSession(session);
  const centres = await prisma.centre.findMany({
    where: orgId ? { orgId } : {},
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Credential Sheet</h1>
        <p className="text-sm text-muted-foreground">
          Issue sign-in details for a centre&apos;s staff and hand them over. You can re-open this
          sheet later — until each person sets their own password, at which point it disappears and
          cannot be recovered.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What this can and cannot show you</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Passwords here are <strong>system-generated and single-use</strong> — everyone is forced
            to pick their own at first sign-in. That is the moment the entry vanishes from this
            sheet.
          </p>
          <p>
            A password someone chose for themselves is <strong>never</strong> shown, to you or to
            anyone. Those are stored as one-way hashes, so there is nothing to reveal. If someone
            has lost theirs, re-issue below — it replaces their password and signs them out
            everywhere.
          </p>
          <p>Every issue and every read of this page is recorded in the audit log against your name.</p>
        </CardContent>
      </Card>

      <CredentialSheet centres={centres} initialCentreId={searchParams.centreId ?? centres[0]?.id ?? ""} />
    </div>
  );
}
