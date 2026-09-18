import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { assertRoute } from "@/lib/route-guard";
import { scopeCentre, tenantWhere } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { ResponsiveTable } from "@/components/ui/responsive-table";
import { formatEnum } from "@/lib/labels";
export const dynamic = "force-dynamic";

const STATUS_VARIANT: Record<string, "success" | "warning" | "outline" | "destructive"> = {
  scheduled: "outline",
  in_progress: "warning",
  completed: "success",
};

export default async function ExamsPage({
  searchParams,
}: {
  searchParams: { status?: string; level?: string };
}) {
  const session = await assertRoute("/exams");
  const centreId = scopeCentre(session);
  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/no-organisation");

  const where: any = { ...tenantWhere(centreId, orgId) };
  if (searchParams.status) where.status = searchParams.status;
  if (searchParams.level) where.level = Number(searchParams.level);
  if (session.role === "EXAMINER") {
    // Show exams already claimed by this examiner AND the unclaimed ones from
    // sittings she is staffed on. Filtering on examinerId alone deadlocked the
    // whole exam day: /api/exam-sittings deliberately creates every exam with
    // examinerId = null ("unassigned until claimed"), so an examiner's list was
    // empty until she claimed a rider — which she could not do, because she
    // could not see one. Her only way in was a URL someone sent her.
    where.OR = [
      { examinerId: session.userId },
      { examinerId: null, sitting: { examiners: { some: { examinerId: session.userId } } } },
    ];
  }

  const [exams, templates, catalog] = await Promise.all([
    prisma.exam.findMany({
      where,
      include: { rider: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: [{ date: "desc" }, { time: "asc" }],
      take: 100,
    }),
    prisma.scoringTemplate.findMany({
      where: tenantWhere(centreId, orgId),
      select: { levelKey: true, levelName: true },
      distinct: ["levelKey"],
      orderBy: { levelKey: "asc" },
    }),
    // Only the general ladder. Exam.level is a bare Int with no discipline, so
    // pulling every discipline's catalog and keying the label map on
    // orderIndex made the disciplines collide — five rows share orderIndex 1,
    // and whichever the DB returned last won. Every general "Level 1" exam was
    // therefore labelled "gymkhana · G1 — Lead-line games" on this screen while
    // the marking sheet correctly said "Level 1".
    prisma.examLevel.findMany({
      where: { active: true, discipline: "general" },
      select: { orderIndex: true, code: true, name: true, discipline: true },
    }),
  ]);

  const canSchedule = ["SUPER_ADMIN", "CENTRE_MANAGER"].includes(session.role);
  const canManageTemplates = session.role === "SUPER_ADMIN";
  // Lookup table: Exam.level (Int) → label. The centre's own ScoringTemplate
  // wins, because that is the rubric the exam is actually marked against and
  // the name the marking sheet shows; the general catalog is the fallback for
  // a level with no template yet, and "L<n>" the last resort.
  const levelLabel = new Map<number, string>();
  for (const c of catalog) {
    levelLabel.set(
      c.orderIndex,
      `${c.discipline === "general" ? "" : c.discipline + " · "}${c.code} — ${c.name}`,
    );
  }
  for (const t of templates) {
    const n = Number(t.levelKey);
    if (Number.isFinite(n) && t.levelName) levelLabel.set(n, t.levelName);
  }
  const levels = Array.from(new Set(templates.map((t) => t.levelKey))).sort();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Exams</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManageTemplates && (
            <Button asChild variant="outline">
              <Link href="/exams/templates">Manage templates</Link>
            </Button>
          )}
          {canSchedule && (
            // One scheduling path: the batch flow (multi-rider + examiner pool).
            // The single-rider form still backs the per-rider "Schedule exam"
            // shortcut on a rider's profile, but isn't a top-level option here.
            <Button asChild>
              <Link href="/exams/sittings/new">
                <Plus className="h-4 w-4" /> Schedule exams
              </Link>
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <form className="flex flex-wrap items-end gap-2 text-sm" method="get">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Status</label>
              <select aria-label="Filter by status"
                name="status"
                defaultValue={searchParams.status ?? ""}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">All</option>
                <option value="scheduled">Scheduled</option>
                <option value="in_progress">In Progress</option>
                <option value="completed">Completed</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Level</label>
              <select aria-label="Filter by level"
                name="level"
                defaultValue={searchParams.level ?? ""}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">All</option>
                {levels.map((l) => (
                  <option key={l} value={l}>
                    Level {l}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" size="sm" variant="outline">
              Filter
            </Button>
          </form>
        </CardHeader>
        <CardContent>
          <ResponsiveTable
            rows={exams}
            getRowKey={(e) => e.id}
            emptyMessage={
              <>
                No exams yet.
                {canSchedule && (
                  <>
                    {" "}
                    <Link href="/exams/sittings/new" className="text-primary underline">
                      Schedule the first one
                    </Link>
                    .
                  </>
                )}
              </>
            }
            columns={[
              {
                key: "rider",
                header: "Rider",
                primary: true,
                cell: (e) => (
                  <span className="font-medium">
                    {e.rider.firstName} {e.rider.lastName}
                  </span>
                ),
              },
              { key: "date", header: "Date", cell: (e) => formatDate(e.date) },
              { key: "time", header: "Time", cell: (e) => e.time },
              { key: "examiner", header: "Examiner", cell: (e) => e.examinerName },
              { key: "level", header: "Level", cell: (e) => levelLabel.get(e.level) ?? `L${e.level}` },
              {
                key: "score",
                header: "Score",
                cell: (e) => (
                  <>
                    {e.totalScore !== null ? (
                      <span className="font-mono">{e.totalScore}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                    {e.passed === true && <Badge variant="success" className="ml-2">Pass</Badge>}
                    {e.passed === false && <Badge variant="destructive" className="ml-2">Fail</Badge>}
                  </>
                ),
              },
              {
                key: "status",
                header: "Status",
                cell: (e) => (
                  <Badge variant={STATUS_VARIANT[e.status] ?? "outline"}>{formatEnum(e.status)}</Badge>
                ),
              },
              {
                key: "open",
                header: "",
                hideOnMobile: true,
                cell: (e) => (
                  <Link href={`/exams/${e.id}`} className="text-xs text-primary underline">
                    Open →
                  </Link>
                ),
              },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
