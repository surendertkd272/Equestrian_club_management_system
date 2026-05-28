import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CentreEditForm } from "./edit-form";
import { NewCentreCard, CentreDeleteButton } from "./client";
import { EmergencyContactsPanel } from "./emergency-contacts-panel";

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
          competitions: true,
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
        <p className="text-sm text-muted-foreground">
          HQ control · {centres.length} club{centres.length === 1 ? "" : "s"} under Equiwings.
          Add new clubs, rename existing ones, or remove an empty one. Slugs are baked into
          public onboarding URLs and can't be changed once set.
        </p>
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
            c._count.competitions === 0 &&
            c._count.invoices === 0 &&
            c._count.certificates === 0;
          return (
            <Card key={c.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle>{c.name}</CardTitle>
                    <CardDescription className="font-mono text-xs">slug: {c.slug}</CardDescription>
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
                    Emergency contacts
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
          <p className="py-12 text-center text-sm text-muted-foreground">
            No clubs yet — create the first one above.
          </p>
        )}
      </div>
    </div>
  );
}

// Tolerant parser — invalid/legacy JSON returns an empty list rather than 500.
// Accepts both string (legacy / tests) and JsonValue (native jsonb column).
function parseEmergencyContacts(json: unknown): { label: string; number: string; type: string }[] {
  if (json === null || json === undefined || json === "") return [];
  try {
    const parsed = typeof json === "string" ? JSON.parse(json) : json;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x) => x && typeof x === "object" && typeof x.label === "string" && typeof x.number === "string")
      .map((x) => ({
        label: x.label,
        number: x.number,
        type: typeof x.type === "string" ? x.type : "other",
      }));
  } catch {
    return [];
  }
}
