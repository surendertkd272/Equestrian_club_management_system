import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertRoute } from "@/lib/route-guard";
import { scopeCentre } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RegistrationLinks } from "./links-client";

export const dynamic = "force-dynamic";

// Public self-registration links for each club — Students, Employees, Vendors.
// One reusable link per type per club; share via WhatsApp/poster and people
// self-register into the relevant approval queue.
export default async function RegistrationLinksPage() {
  const session = await assertRoute("/registration-links");
  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/dashboard");

  // Centre-scoped users see their own club; HQ sees every club in the org.
  const centreId = scopeCentre(session);
  const centres = await prisma.centre.findMany({
    where: centreId ? { id: centreId, orgId } : { orgId },
    select: { id: true, name: true, slug: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Registration Links</h1>
        <p className="text-sm text-muted-foreground">
          Share these links to take registrations directly. Every submission goes to an approval queue before it&apos;s added — nothing goes live automatically.
        </p>
      </div>

      {centres.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">No clubs found.</CardContent>
        </Card>
      ) : (
        centres.map((c) => (
          <Card key={c.id}>
            <CardHeader>
              <CardTitle className="text-base">{c.name}</CardTitle>
              <CardDescription>Public registration links for this club</CardDescription>
            </CardHeader>
            <CardContent>
              <RegistrationLinks slug={c.slug} />
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
