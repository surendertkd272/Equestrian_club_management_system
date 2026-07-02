import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Building2 } from "lucide-react";
import { CentreEditForm } from "./edit-form";
import { NewCentreCard, CentreDeleteButton, SignupLink } from "./client";
import { EmergencyContactsPanel } from "./emergency-contacts-panel";
import { parseEmergencyContacts } from "@/lib/json-narrow";

export const dynamic = "force-dynamic";

export default async function CentresPage() {
  const session = (await getSession())!;
  // HQ-tier only — clubs are a brand-level concept. Both SUPER_ADMIN and
  // ADMIN can now create / edit / delete clubs (per the "everything" scope).
  if (session.role !== "SUPER_ADMIN" && session.role !== "ADMIN") redirect("/dashboard");
  const canManageClubs = session.role === "SUPER_ADMIN" || session.role === "ADMIN";

  const centres = await prisma.centre.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: {
        select: {
          users: true,
          riders: true,
          horses: true,
          batches: true,
          medicines: true,
          invoices: true,
          certificates: true,
        },
      },
    },
  });

  const managerIds = centres.map((c) => c.managerId).filter((x): x is string => !!x);
  const managers = managerIds.length
    ? await prisma.user.findMany({
        where: { id: { in: managerIds } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const managerById = new Map(managers.map((m) => [m.id, m]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Clubs</h1>
      </div>

      {canManageClubs && <NewCentreCard />}

      <div className="space-y-4">
        {centres.map((c) => {
          const mgr = c.managerId ? managerById.get(c.managerId) : null;
          // "Empty" = no operational data — only then can the club be hard-deleted.
          const isEmpty =
            c._count.users === 0 &&
            c._count.riders === 0 &&
            c._count.horses === 0 &&
            c._count.batches === 0 &&
            c._count.medicines === 0 &&
            c._count.invoices === 0 &&
            c._count.certificates === 0;
          return (
            <Card key={c.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle>{c.name}</CardTitle>
                    <SignupLink slug={c.slug} />
                  </div>
                  <div className="flex flex-wrap items-start gap-1.5 text-[10px]">
                    <Badge variant="outline">{c._count.users} users</Badge>
                    <Badge variant="outline">{c._count.riders} riders</Badge>
                    <Badge variant="outline">{c._count.horses} horses</Badge>
                    <Badge variant="outline">{c._count.batches} batches</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="mb-3 text-xs text-muted-foreground">
                  Manager: {mgr ? `${mgr.name} <${mgr.email}>` : <em>not assigned</em>}
                </div>
                <CentreEditForm
                  id={c.id}
                  initial={{
                    name: c.name,
                    address: c.address ?? "",
                    gstNo: c.gstNo ?? "",
                  }}
                />
                <div className="mt-4 border-t pt-3">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Emergency Contacts
                  </div>
                  <EmergencyContactsPanel
                    centreId={c.id}
                    initial={parseEmergencyContacts(c.emergencyContactsJson)}
                  />
                </div>
                {canManageClubs && (
                  <div className="mt-4 border-t pt-3">
                    <CentreDeleteButton id={c.id} name={c.name} isEmpty={isEmpty} />
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
        {centres.length === 0 && (
          // No CTA — the "New club" form is on the same page, just scroll
          // up. Keeping the empty state hero-shaped matches the riders /
          // approvals pattern so the experience feels consistent.
          <EmptyState
            icon={<Building2 className="h-8 w-8" />}
            title="No Clubs Yet"
            body="Each club gets its own riders, staff, horses, and invoices. Scroll up and use 'New club' to create your first one — five minutes of setup."
          />
        )}
      </div>
    </div>
  );
}

