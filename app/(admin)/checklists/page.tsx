import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { scopeCentre, tenantWhere } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { ResponsiveTable } from "@/components/ui/responsive-table";
import { ChecklistSubmissionForm } from "./checklist-form";
import { SignOffButton } from "./sign-off-button";
import { ChecklistCompliance } from "./compliance";
import { wallPartsInTz } from "@/lib/tz";

export const dynamic = "force-dynamic";

const MANAGERS = new Set(["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER", "STABLE_MANAGER", "HEAD_COACH"]);

const CAN_SUBMIT = new Set([
  "SUPER_ADMIN",
  "ADMIN",
  "CENTRE_MANAGER",
  "HEAD_COACH",
  "COACH",
  "STABLE_MANAGER",
  "GROOM",
]);

export default async function ChecklistsPage({
  searchParams,
}: {
  searchParams: { date?: string };
}) {
  const session = await requireSession();
  if (!CAN_SUBMIT.has(session.role)) redirect("/dashboard");

  const isManager = MANAGERS.has(session.role);
  const centreId = scopeCentre(session);
  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/no-organisation");

  if (!centreId) {
    // HQ looking at "All centres". Submitting needs one centre, but the
    // question HQ is here to ask — who has done their checks — does not, and
    // this page used to answer it with nothing at all until a centre was
    // picked.
    const centres = await prisma.centre.findMany({
      where: { orgId },
      select: { id: true, name: true, timezone: true },
      orderBy: { name: "asc" },
    });
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Daily Checklist</h1>
        <ChecklistCompliance centres={centres} date={searchParams.date} />
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            Pick a centre from the top-bar filter to submit a checklist or sign one off.
          </CardContent>
        </Card>
      </div>
    );
  }

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

  // submittedByUserId is recorded on every submission but has no relation, so
  // resolve the names in one query rather than per row.
  const submitterIds = [...new Set(recent.map((s) => s.submittedByUserId))];
  const submitters = submitterIds.length
    ? await prisma.user.findMany({ where: { id: { in: submitterIds } }, select: { id: true, name: true } })
    : [];
  const submitterName = new Map(submitters.map((u) => [u.id, u.name]));
  const centre = isManager
    ? await prisma.centre.findUnique({ where: { id: centreId }, select: { id: true, name: true, timezone: true } })
    : null;
  const tz = centre?.timezone ?? "Asia/Kolkata";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Daily Checklist</h1>
        </div>
        {isHQ && (
          <Button asChild variant="outline">
            <Link href="/checklists/templates">Edit templates →</Link>
          </Button>
        )}
      </div>

      {/* Reviewers first: this is the question they open the page to ask. */}
      {isManager && centre && <ChecklistCompliance centres={[centre]} date={searchParams.date} />}

      {general && general.items.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>General Daily Checks</CardTitle>
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
            <CardTitle>Per-Horse Daily Report</CardTitle>
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
          <CardTitle>Recent Submissions</CardTitle>
          <CardDescription>Last 20 across both templates.</CardDescription>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <div className="py-4 text-center text-sm text-muted-foreground">
              No submissions yet.
            </div>
          ) : (
            <ResponsiveTable
              rows={recent}
              getRowKey={(s) => s.id}
              columns={[
                {
                  key: "submitted",
                  header: "Submitted",
                  primary: true,
                  cell: (s) => (
                    <span>
                      {formatDate(s.submittedAt)}{" "}
                      <span className="text-xs text-muted-foreground">
                        {wallPartsInTz(s.submittedAt, tz).time}
                      </span>
                    </span>
                  ),
                },
                {
                  // The column that was missing: without it the list could not
                  // say which coach had done the round.
                  key: "by",
                  header: "By",
                  cell: (s) => submitterName.get(s.submittedByUserId) ?? "—",
                },
                {
                  key: "type",
                  header: "Type",
                  cell: (s) => (
                    <Badge variant="outline">
                      {s.template.scope === "general" ? "General" : "Per-horse"}
                    </Badge>
                  ),
                },
                {
                  key: "shift",
                  header: "Shift",
                  className: "capitalize",
                  cell: (s) => s.shift ?? "—",
                },
                {
                  key: "horse",
                  header: "Horse",
                  cell: (s) =>
                    s.horse
                      ? `${s.horse.name}${s.horse.stableNo ? ` (${s.horse.stableNo})` : ""}`
                      : "—",
                },
                {
                  key: "done",
                  header: "Done",
                  className: "text-center",
                  headerClassName: "text-center",
                  cell: (s) => s.items.filter((i) => i.status === "done").length,
                },
                {
                  key: "issues",
                  header: "Issues",
                  headerClassName: "text-center",
                  cell: (s) => {
                    const issues = s.items.filter((i) => i.status === "not_done").length;
                    return (
                      <div className={`text-center ${issues > 0 ? "font-semibold text-amber-700" : ""}`}>
                        {issues}
                      </div>
                    );
                  },
                },
                {
                  key: "signedOff",
                  header: "Signed Off",
                  cell: (s) => (
                    <SignOffButton
                      submissionId={s.id}
                      reviewedAt={s.reviewedAt ? s.reviewedAt.toISOString() : null}
                      canReview={isManager}
                    />
                  ),
                },
              ]}
            />
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
