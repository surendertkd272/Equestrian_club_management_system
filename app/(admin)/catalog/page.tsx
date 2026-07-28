import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { scopeCentre, tenantWhere } from "@/lib/tenancy";
import { Card, CardContent } from "@/components/ui/card";
import { canManageCatalog } from "@/lib/schemas/catalog";
import { CatalogManager } from "./catalog-manager";
import { assertSessionFeature, getOrgIdForCentre, getOrgIdForSession } from "@/lib/features-gate";

export const dynamic = "force-dynamic";

// Club Catalog — manage the per-centre master data that used to be seed-only:
// Fee Plans, Progress Levels, and exam Components (the level skill catalog;
// surfaced as "Components" in the UI to distinguish from the month-by-month
// Monthly Skills). SUPER_ADMIN / ADMIN / CENTRE_MANAGER.
//
// Gated behind the 'club-catalog' org-feature flag — default OFF. Owner
// toggles it on per-tenant in the feature matrix when a tenant explicitly
// wants to customise catalog. Centre-bootstrap seeds sensible defaults
// for every new club without this UI being exposed.
export default async function CatalogPage() {
  const session = await requireSession();
  if (!canManageCatalog(session.role)) redirect("/dashboard");
  await assertSessionFeature("club-catalog");

  const centreId = scopeCentre(session);
  if (!centreId) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Club Catalog</h1>
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Pick a club from the top-bar filter to manage its fee plans, levels, and skills.
          </CardContent>
        </Card>
      </div>
    );
  }

  // Org-bound the picked centre: an HQ user must not read another org's catalog
  // by pointing the centre picker / ew_hq_centre cookie at a foreign centreId.
  const orgId = await getOrgIdForSession(session);
  if (!orgId || (await getOrgIdForCentre(centreId)) !== orgId) redirect("/dashboard");

  const [centre, feePlans, levels] = await Promise.all([
    prisma.centre.findUnique({ where: { id: centreId }, select: { name: true } }),
    prisma.feePlan.findMany({ where: tenantWhere(centreId, orgId), orderBy: { levelName: "asc" } }),
    prisma.progressLevel.findMany({
      where: tenantWhere(centreId, orgId),
      orderBy: { order: "asc" },
      include: { skills: { orderBy: [{ discipline: "asc" }, { name: "asc" }] } },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Club Catalog</h1>
      </div>

      <CatalogManager
        feePlans={feePlans.map((f) => ({
          id: f.id,
          levelName: f.levelName,
          monthlyAmount: f.monthlyAmount,
          registrationAmount: f.registrationAmount,
        }))}
        levels={levels.map((l) => ({
          id: l.id,
          name: l.name,
          order: l.order,
          skills: l.skills.map((s) => ({ id: s.id, discipline: s.discipline, name: s.name })),
        }))}
      />
    </div>
  );
}
