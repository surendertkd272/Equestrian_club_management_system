import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { scopeCentre, tenantWhere } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { ChecklistSubmissionForm } from "./checklist-form";
import { SignOffButton } from "./sign-off-button";

export const dynamic = "force-dynamic";

const CAN_SUBMIT = new Set([
  "SUPER_ADMIN",
  "ADMIN",
  "CENTRE_MANAGER",
  "HEAD_COACH",
  "COACH",
  "STABLE_MANAGER",
  "GROOM",
]);

export default async function ChecklistsPage() {
  const session = (await getSession())!;
  if (!CAN_SUBMIT.has(session.role)) redirect("/dashboard");

  const centreId = scopeCentre(session);
  if (!centreId) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Daily Checklist</h1>
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Pick a centre from the top-bar filter to submit checklists.
          </CardContent>
        </Card>
      </div>
    );
  }

  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/dashboard");

  const [templates, horses, recent] = await Promise.all([
    prisma.checklistTemplate.findMany({
      where: { ...tenantWhere(centreId, orgId), active: true },
      include: {
        items: {
          where: { active: true },
          orderBy: { orderIndex: "asc" },
        },
      },
    }),
    prisma.horse.findMany({
      where: { ...tenantWhere(centreId, orgId), status: { not: "retired" } },
      select: { id: true, name: true, stableNo: true },
      orderBy: { name: "asc" },
    }),
    prisma.checklistSubmission.findMany({
      where: tenantWhere(centreId, orgId),
      orderBy: { submittedAt: "desc" },
      take: 20,
      include: {
        template: { select: { scope: true, name: true } },
        horse: { select: { name: true, stableNo: true } },
        items: { select: { status: true } },
      },
    }),
  ]);

  const general = templates.find((t) => t.scope === "general") ?? null;
  const perHorse = templates.find((t) => t.scope === "per_horse") ?? null;
  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  const isManager = new Set(["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER", "STABLE_MANAGER", "HEAD_COACH"]).has(session.role);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Daily Checklist</h1>
          <p className="text-sm text-muted-foreground">
            Run through the daily ticks for horse health, feed, and per-horse care. Items come
            from the centre's template — admins can edit them at any time.
          </p>
        </div>
        {isHQ && (
          <Button asChild variant="outline">
            <Link href="/checklists/templates">Edit templates →</Link>
          </Button>
        )}
      </div>

      {general && general.items.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>General daily checks</CardTitle>
            <CardDescription>
              Pick the shift, run through each section, tick the declaration, and submit.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChecklistSubmissionForm
              templateId={general.id}
              scope="general"
              items={general.items.map((i) => ({
                id: i.id,
                label: i.label,
                section: i.section ?? null,
                orderIndex: i.orderIndex,
              }))}
              horses={[]}
            />
          </CardContent>
        </Card>
      ) : (
        <EmptyTemplate label="general" isHQ={isHQ} />
      )}

      {perHorse && perHorse.items.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Per-horse daily report</CardTitle>
            <CardDescription>
              Pick a horse, then tick its eight checks. Repeat for each horse.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChecklistSubmissionForm
              templateId={perHorse.id}
              scope="per_horse"
              items={perHorse.items.map((i) => ({
                id: i.id,
                label: i.label,
                section: i.section ?? null,
                orderIndex: i.orderIndex,
              }))}
              horses={horses.map((h) => ({ id: h.id, name: h.name, stableNo: h.stableNo }))}
            />
          </CardContent>
        </Card>
      ) : (
        <EmptyTemplate label="per-horse" isHQ={isHQ} />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Recent submissions</CardTitle>
          <CardDescription>Last 20 across both templates.</CardDescription>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <div className="py-4 text-center text-sm text-muted-foreground">
              No submissions yet.
            </div>
          ) : (
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="pb-2">Submitted</th>
                  <th className="pb-2">Type</th>
                  <th className="pb-2">Shift</th>
                  <th className="pb-2">Horse</th>
                  <th className="pb-2 text-center">Done</th>
                  <th className="pb-2 text-center">Issues</th>
                  <th className="pb-2">Signed off</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((s) => {
                  const done = s.items.filter((i) => i.status === "done").length;
                  const issues = s.items.filter((i) => i.status === "not_done").length;
                  return (
                    <tr key={s.id} className="border-t">
                      <td className="py-2">{formatDate(s.submittedAt)}</td>
                      <td className="py-2">
                        <Badge variant="outline">
                          {s.template.scope === "general" ? "General" : "Per-horse"}
                        </Badge>
                      </td>
                      <td className="py-2 capitalize">{s.shift ?? "—"}</td>
                      <td className="py-2">
                        {s.horse
                          ? `${s.horse.name}${s.horse.stableNo ? ` (${s.horse.stableNo})` : ""}`
                          : "—"}
                      </td>
                      <td className="py-2 text-center">{done}</td>
                      <td className={`py-2 text-center ${issues > 0 ? "font-semibold text-amber-700" : ""}`}>
                        {issues}
                      </td>
                      <td className="py-2">
                        <SignOffButton
                          submissionId={s.id}
                          reviewedAt={s.reviewedAt ? s.reviewedAt.toISOString() : null}
                          canReview={isManager}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function EmptyTemplate({ label, isHQ }: { label: string; isHQ: boolean }) {
  return (
    <Card>
      <CardContent className="py-6 text-sm text-muted-foreground">
        No {label} template configured for this centre.{" "}
        {isHQ && (
          <Link href="/checklists/templates" className="text-primary underline">
            Set one up →
          </Link>
        )}
      </CardContent>
    </Card>
  );
}
