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
import { can } from "@/lib/permissions";
import { isExamManager } from "@/lib/exam-panel";
import { ExportCsvButton } from "@/components/ui/export-csv";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

const STATUS_VARIANT: Record<string, "success" | "warning" | "outline" | "destructive"> = {
  scheduled: "outline",
  in_progress: "warning",
  completed: "success",
};

export default async function ExamsPage({
  searchParams,
}: {
  searchParams: { status?: string; level?: string; q?: string; page?: string };
}) {
  const session = await assertRoute("/exams");
  const centreId = scopeCentre(session);
  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/no-organisation");

  const where: any = { ...tenantWhere(centreId, orgId) };
  if (searchParams.status) where.status = searchParams.status;
  if (searchParams.level) where.level = Number(searchParams.level);
  const q = (searchParams.q ?? "").trim();
  if (q) {
    where.rider = {
      OR: [
        { firstName: { contains: q, mode: "insensitive" } },
        { lastName: { contains: q, mode: "insensitive" } },
      ],
    };
  }
  // Paged, not capped: a hard take:100 hid half of a 200-rider exam day.
  const page = Math.max(1, Math.floor(Number(searchParams.page) || 1));
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
      // Seated as a co-judge. The exam completes only when every judge has
      // submitted, so a co-judge who can't find the exam holds it open.
      { judges: { some: { judgeId: session.userId } } },
    ];
  }

  const isExaminer = session.role === "EXAMINER";
  const [exams, total, days, templates, catalog] = await Promise.all([
    prisma.exam.findMany({
      where,
      include: { rider: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: [{ date: "desc" }, { time: "asc" }, { id: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.exam.count({ where }),
    // Exam days — the whole-day view managers and head coaches work from.
    isExaminer
      ? Promise.resolve([])
      : prisma.examDay.findMany({
          where: tenantWhere(centreId, orgId),
          orderBy: { date: "desc" },
          take: 8,
          include: { sittings: { select: { exams: { select: { status: true } } } } },
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

  // Anyone who may schedule gets the buttons — head coaches hold
  // exam.schedule but were never shown them.
  const canSchedule = can(session.role, "exam.schedule");
  // Same permission the export route checks (app/api/export/[entity]).
  const canExport = can(session.role, "exam.schedule");
  const exportQuery = new URLSearchParams({
    ...(searchParams.status ? { status: searchParams.status } : {}),
    ...(searchParams.level ? { level: searchParams.level } : {}),
  }).toString();
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageHref = (n: number) =>
    `/exams?${new URLSearchParams({
      ...(searchParams.status ? { status: searchParams.status } : {}),
      ...(searchParams.level ? { level: searchParams.level } : {}),
      ...(q ? { q } : {}),
      ...(n > 1 ? { page: String(n) } : {}),
    }).toString()}`;
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
          {canExport && <ExportCsvButton entity="exams" label="Export results" query={exportQuery || undefined} />}
          {canManageTemplates && (
            <Button asChild variant="outline">
              <Link href="/exams/templates">Manage templates</Link>
            </Button>
          )}
          {isExamManager(session.role) && (
            <Button asChild variant="outline">
              <Link href="/exams/examiners">Examiners</Link>
            </Button>
          )}
          {canSchedule && (
            <Button asChild variant="outline">
              <Link href="/exams/sittings/new">Single sitting</Link>
            </Button>
          )}
          {canSchedule && (
            // An exam day books every level on one date at once; a single
            // sitting (one level) stays available for small top-ups.
            <Button asChild>
              <Link href="/exams/days/new">
                <Plus className="h-4 w-4" /> Schedule exam day
              </Link>
            </Button>
          )}
        </div>
      </div>

      {days.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Exam days</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {days.map((d) => {
              const all = d.sittings.flatMap((s) => s.exams);
              const done = all.filter((e) => e.status === "completed").length;
              return (
                <Link
                  key={d.id}
                  href={`/exams/days/${d.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted/40"
                >
                  <span className="min-w-0">
                    <span className="font-medium">{d.name}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {formatDate(d.date)} · {d.sittings.length} level{d.sittings.length === 1 ? "" : "s"}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {done} / {all.length} marked
                  </span>
                </Link>
              );
            })}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <form className="flex flex-wrap items-end gap-2 text-sm" method="get">
            <div className="min-w-0">
              <label className="mb-1 block text-xs text-muted-foreground">Rider</label>
              <input
                aria-label="Search by rider name"
                name="q"
                defaultValue={q}
                placeholder="Name…"
                className="h-9 w-44 max-w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
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
                <option value="absent">Absent</option>
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
                    <Link href="/exams/days/new" className="text-primary underline">
                      Schedule the first exam day
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
          {total > 0 && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
              <span>
                Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
              </span>
              {pages > 1 && (
                <span className="flex gap-2">
                  {page > 1 ? (
                    <Link href={pageHref(page - 1)} className="rounded-md border px-3 py-1 hover:bg-muted">
                      ← Previous
                    </Link>
                  ) : null}
                  <span className="px-1 py-1">
                    Page {page} of {pages}
                  </span>
                  {page < pages ? (
                    <Link href={pageHref(page + 1)} className="rounded-md border px-3 py-1 hover:bg-muted">
                      Next →
                    </Link>
                  ) : null}
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
