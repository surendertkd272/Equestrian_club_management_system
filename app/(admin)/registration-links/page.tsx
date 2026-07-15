import { redirect } from "next/navigation";
import { headers } from "next/headers";
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

  // Build the ABSOLUTE base URL server-side from the request host, so the link
  // we show (and copy/share) is always a full, tappable https://… URL — never a
  // bare path (a path shared over WhatsApp/SMS won't open on a phone). Falls
  // back to the configured app URL, then the known production domain.
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  const baseUrl = host
    ? `${proto}://${host}`
    : process.env.NEXT_PUBLIC_APP_URL ?? "https://cms.bharatsportsventure.com";

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
              <RegistrationLinks slug={c.slug} baseUrl={baseUrl} />
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
