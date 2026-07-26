import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { scopeCentre, tenantWhere } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { startOfDayInTz, endOfDayInTz, wallPartsInTz } from "@/lib/tz";
import { can } from "@/lib/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { NewLessonForm } from "./new-form";
import { LessonDeleteButton } from "./delete-button";
import { LessonCoachPicker } from "./coach-picker";
import { formatEnum } from "@/lib/labels";
export const dynamic = "force-dynamic";

type SP = { date?: string };

export default async function LessonsPage({ searchParams }: { searchParams: SP }) {
  const session = await requireSession();
  const centreId = scopeCentre(session);
  if (!centreId) {
    return <div className="p-6 text-sm text-muted-foreground">Pick a centre to see lessons.</div>;
  }

  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/dashboard");

  const centre = await prisma.centre.findUnique({ where: { id: centreId }, select: { timezone: true } });
  const tz = centre?.timezone ?? "Asia/Kolkata";
  // Default to the centre's local "today" — the server's UTC date is already
  // yesterday/tomorrow for part of the IST day, which would open the wrong page.
  const todayLocal = wallPartsInTz(new Date(), tz).date;
  const rawDate = searchParams.date ?? todayLocal;
  // Bucket by the centre's local day, not the server's UTC day — matches
  // GET /api/lessons (#132). A noon-UTC anchor pins the right calendar date
  // before bucketing for IST-like (positive-offset) zones. `date` is always a
  // valid YYYY-MM-DD (falls back to local today) so the form + nav links can't
  // build an invalid Date.
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : todayLocal;
  const date = safeDate;
  const ref = new Date(`${safeDate}T12:00:00Z`);
  const dayStart = startOfDayInTz(ref, tz);
  const dayEnd = endOfDayInTz(ref, tz);

  const [lessons, batches, coaches] = await Promise.all([
    prisma.lesson.findMany({
      where: { ...tenantWhere(centreId, orgId), date: { gte: dayStart, lte: dayEnd } },
      orderBy: { date: "asc" },
      include: {
        batch: { select: { name: true, level: true } },
        allocations: {
          include: {
            rider: { select: { firstName: true, lastName: true } },
            horse: { select: { name: true, stableNo: true } },
          },
        },
      },
    }),
    prisma.batch.findMany({ where: tenantWhere(centreId, orgId), orderBy: { name: "asc" }, select: { id: true, name: true, startTime: true, endTime: true, coachId: true } }),
    // Who can take a session. Coaching staff at this centre, so a manager can
    // hand a lesson over when someone calls in sick.
    prisma.user.findMany({
      where: { ...(centreId ? { centreId } : {}), status: "active", role: { in: ["COACH", "HEAD_COACH", "CENTRE_MANAGER"] } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, role: true },
    }),
  ]);

  // Compute prev/next day links so coaches can scrub through the week.
  const d = new Date(`${date}T12:00:00`);
  const prev = new Date(d); prev.setDate(d.getDate() - 1);
  const next = new Date(d); next.setDate(d.getDate() + 1);
  const fmt = (x: Date) => x.toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">Lessons</h1>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Link href={`/lessons?date=${fmt(prev)}`} className="rounded border px-2 py-1 hover:bg-accent">← {fmt(prev)}</Link>
          <form className="flex items-center gap-2">
            <input type="date" name="date" defaultValue={date} className="h-8 rounded border bg-card px-2 text-xs" />
            <button className="rounded border px-2 py-1 text-xs hover:bg-accent">Go</button>
          </form>
          <Link href={`/lessons?date=${fmt(next)}`} className="rounded border px-2 py-1 hover:bg-accent">{fmt(next)} →</Link>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Schedule an Ad-Hoc Lesson</CardTitle>
        </CardHeader>
        <CardContent>
          <NewLessonForm centreId={centreId} batches={batches} coaches={coaches} defaultDate={date} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Today's sessions ({lessons.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {lessons.length === 0 ? (
            <p className="text-sm text-muted-foreground">No lessons on this date yet.</p>
          ) : (
            <ul className="divide-y">
              {lessons.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">
                        {new Date(l.date).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: tz })}
                        {" – "}
                        {new Date(l.endAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: tz })}
                      </span>
                      {l.batch ? (
                        <Badge variant="outline" className="text-xs">{l.batch.name}{l.batch.level ? ` · ${l.batch.level}` : ""}</Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs">Ad-hoc</Badge>
                      )}
                      <Badge
                        variant={l.status === "completed" ? "default" : l.status === "cancelled" ? "destructive" : "secondary"}
                        className="text-xs"
                      >
                        {formatEnum(l.status)}
                      </Badge>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {l.allocations.length > 0
                        ? `${l.allocations.length} rider${l.allocations.length === 1 ? "" : "s"}: ${l.allocations
                            .slice(0, 3)
                            .map((a) => `${a.rider?.firstName ?? "?"} → ${a.horse.name}${a.horse.stableNo ? ` (${a.horse.stableNo})` : ""}`)
                            .join(", ")}${l.allocations.length > 3 ? ` + ${l.allocations.length - 3} more` : ""}`
                        : "No riders allocated yet."}
                    </div>
                    {l.notes ? <div className="mt-1 text-xs italic text-muted-foreground">{l.notes}</div> : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex flex-col items-end gap-0.5">
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Coach</span>
                      <LessonCoachPicker
                        lessonId={l.id}
                        coachId={l.coachId}
                        coaches={coaches}
                        canEdit={can(session.role, "lesson.write")}
                      />
                    </div>
                    <Link href={`/lessons/${l.id}`} className="rounded border px-3 py-1 text-xs hover:bg-accent">
                      Allocate / edit
                    </Link>
                    {can(session.role, "lesson.write") && (
                      <LessonDeleteButton
                        id={l.id}
                        timeLabel={`${new Date(l.date).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: tz })}`}
                        riderCount={l.allocations.length}
                      />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
