import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { getOrgIdForSession } from "@/lib/features-gate";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DEFAULT_SUPPORT_EMAIL } from "@/lib/contact";
import { PublicContactForm } from "./form";

export const dynamic = "force-dynamic";

// Org-level settings the two HQ roles manage themselves. Today: the public
// contact details shown to users on the Help Center + portals.
export default async function SettingsPage() {
  const session = await requireSession();
  if (session.role !== "SUPER_ADMIN" && session.role !== "ADMIN") redirect("/dashboard");

  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/no-organisation");

  const org = await prisma.organisation.findUnique({
    where: { id: orgId },
    select: { supportEmail: true, supportPhone: true },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Public Contact</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">
            Shown to riders, parents, and staff on the Help Center and portals whenever they need
            to reach you. Leave the email blank to use the default ({DEFAULT_SUPPORT_EMAIL}).
          </p>
          <PublicContactForm
            initial={{
              supportEmail: org?.supportEmail ?? "",
              supportPhone: org?.supportPhone ?? "",
            }}
            defaultEmail={DEFAULT_SUPPORT_EMAIL}
          />
        </CardContent>
      </Card>
    </div>
  );
}
