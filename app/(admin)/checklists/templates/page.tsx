import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { scopeCentre, tenantWhere } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TemplateEditor } from "./template-editor";

export const dynamic = "force-dynamic";

// One template per centre per scope (general daily, per-horse daily).
// SUPER_ADMIN + ADMIN edit/add/delete items here; coach-side submission
// reads from the same template. Soft-delete (active=false) preserves the
// FK on historic ChecklistSubmissionItem rows.
export default async function ChecklistTemplatesPage() {
  const session = (await getSession())!;
  if (session.role !== "SUPER_ADMIN" && session.role !== "ADMIN") {
    redirect("/dashboard");
  }
  const centreId = scopeCentre(session);
  if (!centreId) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Daily checklist · templates</h1>
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Pick a centre from the top-bar filter to edit its templates.
          </CardContent>
        </Card>
      </div>
    );
  }

  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/dashboard");

  const [centre, templates] = await Promise.all([
    // Bound the centre lookup to the caller's org so an HQ user can't read a
    // foreign org's centre by passing its id via the picker/cookie.
    prisma.centre.findFirst({ where: { id: centreId, orgId }, select: { name: true, slug: true } }),
    prisma.checklistTemplate.findMany({
      where: tenantWhere(centreId, orgId),
      include: {
        items: { orderBy: { orderIndex: "asc" } },
      },
      orderBy: { scope: "asc" },
    }),
  ]);

  const general = templates.find((t) => t.scope === "general") ?? null;
  const perHorse = templates.find((t) => t.scope === "per_horse") ?? null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Daily checklist · templates</h1>
        <p className="text-sm text-muted-foreground">
          Edit the daily checks coaches see for <strong>{centre?.name ?? "this centre"}</strong>.
          Renaming an item preserves its identity (historic submissions keep their original wording);
          deleting an item soft-deactivates it so old submissions still resolve.
        </p>
      </div>

      {general ? (
        <Card>
          <CardHeader>
            <CardTitle>General daily checklist</CardTitle>
            <CardDescription>
              One submission per day per centre. Section A = horse health (16 items canonical).
              Section B = feed &amp; stable (8 items canonical).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TemplateEditor
              templateId={general.id}
              scope="general"
              items={general.items.map((i) => ({
                id: i.id,
                label: i.label,
                section: i.section ?? null,
                orderIndex: i.orderIndex,
                active: i.active,
              }))}
            />
          </CardContent>
        </Card>
      ) : (
        <MissingTemplate label="General" />
      )}

      {perHorse ? (
        <Card>
          <CardHeader>
            <CardTitle>Per-horse daily checklist</CardTitle>
            <CardDescription>
              One submission per horse per day. Coaches tick each horse's eight checks separately.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TemplateEditor
              templateId={perHorse.id}
              scope="per_horse"
              items={perHorse.items.map((i) => ({
                id: i.id,
                label: i.label,
                section: i.section ?? null,
                orderIndex: i.orderIndex,
                active: i.active,
              }))}
            />
          </CardContent>
        </Card>
      ) : (
        <MissingTemplate label="Per-horse" />
      )}
    </div>
  );
}

function MissingTemplate({ label }: { label: string }) {
  return (
    <Card>
      <CardContent className="py-6 text-sm text-muted-foreground">
        No {label.toLowerCase()} template exists for this centre yet. Run the seed script
        (<code>scripts/_seed-checklists.ts</code>) to provision the canonical defaults, then
        return here to customise.
      </CardContent>
    </Card>
  );
}
