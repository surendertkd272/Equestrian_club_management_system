import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { scopeCentre } from "@/lib/tenancy";
import { Card, CardContent } from "@/components/ui/card";
import { canManageCatalog } from "@/lib/schemas/catalog";
import { CatalogManager } from "./catalog-manager";
import { assertSessionFeature } from "@/lib/features-gate";

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
  const session = (await getSession())!;
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

  const [centre, feePlans, levels] = await Promise.all([
    prisma.centre.findUnique({ where: { id: centreId }, select: { name: true } }),
    prisma.feePlan.findMany({ where: { centreId }, orderBy: { levelName: "asc" } }),
    prisma.progressLevel.findMany({
      where: { centreId },
      orderBy: { order: "asc" },
      include: { skills: { orderBy: [{ discipline: "asc" }, { name: "asc" }] } },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Club Catalog</h1>
        <p className="text-sm text-muted-foreground">
          Manage <strong>{centre?.name ?? "this club"}</strong>'s fee plans, progress levels, and
          skills. Add, edit, or remove any of them — changes apply to this club only.
        </p>
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
