import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { scopeCentre, tenantWhere } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { parseRubric } from "@/lib/schemas/exam";
import { TemplateEditor } from "./editor";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const session = await requireSession();
  if (session.role !== "SUPER_ADMIN" && session.role !== "ADMIN") redirect("/exams");

  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/no-organisation");
  const centreId = scopeCentre(session);
  const where = tenantWhere(centreId, orgId);
  // Pull the canonical catalog AND any centre-specific rubric overrides.
  // The page now leads with the catalog (HQ source of truth) and only
  // shows the per-centre override section beneath, grouped by level — so
  // "Level 1, Level 2, Level 1, Level 2…" stops happening when an admin
  // sees cross-centre data.
  const [levels, templates] = await Promise.all([
    prisma.examLevel.findMany({
      where: { active: true },
      orderBy: [{ discipline: "asc" }, { orderIndex: "asc" }],
    }),
    prisma.scoringTemplate.findMany({
      where,
      include: { centre: { select: { name: true, slug: true } } },
      orderBy: [{ levelKey: "asc" }, { centreId: "asc" }],
    }),
  ]);
  // Group templates per level so we can show "Level 1 — overridden by N
  // centres" rather than the long flat repeating list.
  const overridesByLevel = new Map<string, typeof templates>();
  for (const t of templates) {
    if (!overridesByLevel.has(t.levelKey)) overridesByLevel.set(t.levelKey, []);
    overridesByLevel.get(t.levelKey)!.push(t);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">Scoring Templates</h1>
        </div>
        <Button asChild variant="outline">
          <Link href="/exams/levels">Manage level catalog →</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Level Catalog</CardTitle>
          <CardDescription>
            Master progression — every centre picks from this list. Edit it from{" "}
            <Link href="/exams/levels" className="text-primary underline">
              Level catalog
            </Link>
            .
          </CardDescription>
        </CardHeader>
        <CardContent>
          {levels.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No levels in the catalog yet. <Link href="/exams/levels" className="text-primary underline">Add some →</Link>
            </p>
          ) : (
            (() => {
              const byDiscipline = new Map<string, typeof levels>();
              for (const l of levels) {
                if (!byDiscipline.has(l.discipline)) byDiscipline.set(l.discipline, []);
                byDiscipline.get(l.discipline)!.push(l);
              }
              return Array.from(byDiscipline.entries()).map(([discipline, rows]) => (
                <div key={discipline} className="mb-4 last:mb-0">
                  <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{discipline}</div>
                  <ul className="space-y-1">
                    {rows.map((l) => {
                      const overrides = overridesByLevel.get(l.code) ?? [];
                      return (
                        <li key={l.id} className="flex items-center justify-between rounded border bg-muted/20 px-3 py-2 text-sm">
                          <div>
                            <span className="font-mono text-xs text-muted-foreground">#{l.orderIndex}</span>{" "}
                            <span className="font-semibold">{l.code}</span> — {l.name}
                          </div>
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-muted-foreground">pass ≥ {l.passThreshold}%</span>
                            {overrides.length > 0 && (
                              <Badge variant="outline" className="text-[10px]">
                                in {overrides.length} club{overrides.length === 1 ? "" : "s"}
                              </Badge>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ));
            })()
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Centre rubrics{centreId ? "" : " — pick a club"}</CardTitle>
          <CardDescription>
            Each club has its own per-level rubric (seeded from the catalog; editable here).
            {centreId
              ? " Showing the selected club below."
              : " Select a club from the top-bar centre filter to view or edit its rubric — otherwise every club's rows would list together."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!centreId ? (
            <p className="text-sm text-muted-foreground">
              No club selected. Use the centre switcher in the top bar to choose one club; its
              four level rubrics will appear here. (The catalog above shows how many clubs have a
              rubric for each level.)
            </p>
          ) : templates.length === 0 ? (
            <p className="text-sm text-muted-foreground">No rubric rows for this club yet.</p>
          ) : (
            <ul className="divide-y">
              {templates.map((t) => {
                const rubric = parseRubric(t.categoriesJson);
                const numericMax = rubric.reduce(
                  (s, c) =>
                    s +
                    (c.type && c.type !== "numeric"
                      ? 0
                      : c.items
                          .filter((i) => !i.type || i.type === "numeric")
                          .reduce((ss, i) => {
                            // Parent (has subitems) — score sums from subs;
                            // otherwise the leaf's own max.
                            if (Array.isArray(i.subitems) && i.subitems.length > 0) {
                              return ss + i.subitems.reduce((t, s) => t + (s.max_score ?? 0), 0);
                            }
                            return ss + (i.max_score ?? 0);
                          }, 0)),
                  0,
                );
                return (
                  <li key={t.id} className="flex items-center justify-between py-3 text-sm">
                    <div>
                      <div className="font-semibold">{t.levelName}</div>
                      <div className="text-xs text-muted-foreground">
                        {t.centre.name} · {rubric.length} sections · max {numericMax} · pass {t.passThreshold}%
                      </div>
                    </div>
                    <Badge variant="outline">level {t.levelKey}</Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {centreId && (
        <Card>
          <CardHeader>
            <CardTitle>Create / Replace Template</CardTitle>
            <CardDescription>
              Submitting overwrites the template for that level (centre-scoped). Use the example below as a starting
              point.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TemplateEditor existing={templates.map((t) => ({ levelKey: t.levelKey, levelName: t.levelName, passThreshold: t.passThreshold, categoriesJson: t.categoriesJson }))} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
