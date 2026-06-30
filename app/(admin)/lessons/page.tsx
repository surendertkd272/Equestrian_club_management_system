import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { scopeCentre, tenantWhere } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { startOfDayInTz, endOfDayInTz } from "@/lib/tz";
import { can } from "@/lib/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { NewLessonForm } from "./new-form";
import { LessonDeleteButton } from "./delete-button";

export const dynamic = "force-dynamic";

type SP = { date?: string };

export default async function LessonsPage({ searchParams }: { searchParams: SP }) {
  const session = (await getSession())!;
  const centreId = scopeCentre(session);
  if (!centreId) {
    return <div className="p-6 text-sm text-muted-foreground">Pick a centre to see lessons.</div>;
  }

  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/dashboard");

  const date = searchParams.date ?? new Date().toISOString().slice(0, 10);
  // Bucket by the centre's local day, not the server's UTC day — matches
  // GET /api/lessons (#132). A noon-UTC anchor pins the right calendar date
  // before bucketing for IST-like (positive-offset) zones.
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().slice(0, 10);
  const centre = await prisma.centre.findUnique({ where: { id: centreId }, select: { timezone: true } });
  const tz = centre?.timezone ?? "Asia/Kolkata";
  const ref = new Date(`${safeDate}T12:00:00Z`);
  const dayStart = startOfDayInTz(ref, tz);
  const dayEnd = endOfDayInTz(ref, tz);

  const [lessons, batches] = await Promise.all([
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
    prisma.batch.findMany({ where: tenantWhere(centreId, orgId), orderBy: { name: "asc" }, select: { id: true, name: true, startTime: true, endTime: true } }),
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
          <p className="text-sm text-muted-foreground">
            Concrete sessions for {date}. Batches define the recurring slot; each lesson is one date.
          </p>
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
          <CardTitle className="text-base">Schedule an ad-hoc lesson</CardTitle>
        </CardHeader>
        <CardContent>
          <NewLessonForm centreId={centreId} batches={batches} defaultDate={date} />
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
                        {new Date(l.date).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                        {" – "}
                        {new Date(l.endAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
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
                        {l.status}
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
                    <Link href={`/lessons/${l.id}`} className="rounded border px-3 py-1 text-xs hover:bg-accent">
                      Allocate / edit
                    </Link>
                    {can(session.role, "lesson.write") && (
                      <LessonDeleteButton
                        id={l.id}
                        timeLabel={`${new Date(l.date).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`}
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
