import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { scopeCentre, tenantWhere } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NewShortLinkForm } from "./form";
import { LinkList } from "./link-list";

export const dynamic = "force-dynamic";

export default async function LinksPage() {
  const session = (await getSession())!;
  // Mirror the API gate in app/api/short-links/route.ts — admins + senior
  // centre staff (Head Coach, Stable Manager) can self-serve generate links.
  const canManage =
    session.role === "SUPER_ADMIN"
    || session.role === "CENTRE_MANAGER"
    || session.role === "HEAD_COACH"
    || session.role === "STABLE_MANAGER";
  if (!canManage) redirect("/dashboard");
  const centreId = scopeCentre(session);
  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/dashboard");

  // Horses + recent riders feed the param picker (e.g. "report injury for X").
  const [links, horses] = await Promise.all([
    prisma.shortLink.findMany({
      where: tenantWhere(centreId, orgId),
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.horse.findMany({
      where: { ...tenantWhere(centreId, orgId), status: "active" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Create WhatsApp Deep-Link</CardTitle>
          <CardDescription>
            Generate a short link you can paste into WhatsApp. The recipient taps it from chat and
            lands directly on the right form — no scrolling, no menu hunting.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NewShortLinkForm horses={horses} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Active Links</CardTitle>
          <CardDescription>
            Most recent first. Each row has a "Copy" and "WhatsApp" button — copy pastes the URL,
            WhatsApp opens the chat-share sheet pre-filled.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LinkList
            links={links.map((l) => ({
              id: l.id,
              code: l.code,
              kind: l.kind,
              label: l.label,
              targetPath: l.targetPath,
              expiresAt: l.expiresAt?.toISOString() ?? null,
              singleUse: l.singleUse,
              redeemCount: l.redeemCount,
              createdAt: l.createdAt.toISOString(),
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
