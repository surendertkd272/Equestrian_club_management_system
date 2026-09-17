import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { schoolContext } from "@/lib/school-portal";
import { NoCentreCard } from "../no-centre";

export const dynamic = "force-dynamic";

// Horse workload, for the school that sends the children.
//
// A school's interest here is welfare and safety, not stable management: is
// the pony my pupils ride being worked into the ground, and how much saddle
// time are my own children actually getting. So the table is per horse, and
// the two columns that matter are total hours worked at the club and the share
// of that which was this school's riders.
//
// Deliberately NOT here: vet records, medicines, insurance, purchase price.
// Those are the club's business and a school has no standing in them.

// A horse in steady work is ridden roughly 1-2 hours a day, six days a week.
// Anything past this in a rolling week is worth a school noticing and asking
// about; it is a conversation-starter, not a clinical judgement, and the page
// says so rather than implying a welfare finding.
const BUSY_HOURS_PER_WEEK = 18;

export default async function SchoolHorsesPage() {
  const ctx = await schoolContext();
  if (!ctx) return <NoCentreCard />;

  const since = new Date(Date.now() - 30 * 86400000);

  // Allocations for horses at this centre over the last 30 days. Every horse
  // at the club is included, because a school's pupils can be put on any of
  // them and an empty row ("this horse did no work") is information too.
  const [horses, allocations, myRiderIds] = await Promise.all([
    prisma.horse.findMany({
      where: { centreId: ctx.centreId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, breed: true, sex: true, dob: true, ageYears: true },
    }),
    prisma.horseAllocation.findMany({
      where: { horse: { centreId: ctx.centreId }, startAt: { gte: since } },
      select: { horseId: true, riderId: true, startAt: true, endAt: true, purpose: true },
    }),
    prisma.rider
      .findMany({ where: ctx.riderWhere, select: { id: true } })
      .then((rs) => new Set(rs.map((r) => r.id))),
  ]);

  type Row = {
    sessions: number;
    hours: number;
    mySessions: number;
    myHours: number;
    lastWorked: Date | null;
  };
  const stats = new Map<string, Row>();
  for (const a of allocations) {
    const row =
      stats.get(a.horseId) ??
      ({ sessions: 0, hours: 0, mySessions: 0, myHours: 0, lastWorked: null } as Row);
    // Guard against a bad range: an endAt before startAt would otherwise
    // subtract hours from the total and make an overworked horse look idle.
    const ms = Math.max(0, a.endAt.getTime() - a.startAt.getTime());
    const hours = ms / 3_600_000;
    row.sessions += 1;
    row.hours += hours;
    if (a.riderId && myRiderIds.has(a.riderId)) {
      row.mySessions += 1;
      row.myHours += hours;
    }
    if (!row.lastWorked || a.startAt > row.lastWorked) row.lastWorked = a.startAt;
    stats.set(a.horseId, row);
  }

  // Busiest first — the reason a school opens this page.
  const rows = horses
    .map((h) => ({
      horse: h,
      s: stats.get(h.id) ?? { sessions: 0, hours: 0, mySessions: 0, myHours: 0, lastWorked: null },
    }))
    .sort((a, b) => b.s.hours - a.s.hours);

  const totalMyHours = rows.reduce((n, r) => n + r.s.myHours, 0);
  const busy = rows.filter((r) => r.s.hours / (30 / 7) > BUSY_HOURS_PER_WEEK);

  const fmtDate = (d: Date | null) =>
    d
      ? d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" })
      : "—";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Horse workload</h1>
        <p className="text-sm text-muted-foreground">
          Last 30 days at {ctx.centreName} · your riders logged {totalMyHours.toFixed(1)} hours in
          the saddle
        </p>
      </div>

      {busy.length > 0 && (
        <Card className="border-l-4 border-l-amber-500">
          <CardHeader>
            <CardTitle className="text-base">
              {busy.length} horse{busy.length === 1 ? "" : "s"} in heavy work
            </CardTitle>
            <CardDescription>
              Averaging more than {BUSY_HOURS_PER_WEEK} hours a week over the last 30 days:{" "}
              <strong>{busy.map((b) => b.horse.name).join(", ")}</strong>. That is a prompt to ask
              the club how the rota is being managed, not a welfare finding on its own — a horse
              doing short, light lessons is not the same as one jumping all day.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Every horse at the club ({rows.length})</CardTitle>
          <CardDescription>
            Busiest first. &ldquo;Your riders&rdquo; is the share of that work done by students
            from {ctx.title}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No horses recorded at this club.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th className="pb-2 pr-3">Horse</th>
                    <th className="pb-2 pr-3">Breed</th>
                    <th className="pb-2 pr-3 text-right">Sessions</th>
                    <th className="pb-2 pr-3 text-right">Hours</th>
                    <th className="pb-2 pr-3 text-right">Hrs / week</th>
                    <th className="pb-2 pr-3 text-right">Your riders</th>
                    <th className="pb-2 text-right">Last worked</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ horse, s }) => {
                    const perWeek = s.hours / (30 / 7);
                    return (
                      <tr key={horse.id} className="border-b last:border-0">
                        <td className="py-2 pr-3 font-medium">{horse.name}</td>
                        <td className="py-2 pr-3 text-xs text-muted-foreground">
                          {horse.breed ?? "—"}
                        </td>
                        <td className="py-2 pr-3 text-right font-mono">{s.sessions}</td>
                        <td className="py-2 pr-3 text-right font-mono">{s.hours.toFixed(1)}</td>
                        <td className="py-2 pr-3 text-right">
                          {perWeek > BUSY_HOURS_PER_WEEK ? (
                            <Badge variant="warning">{perWeek.toFixed(1)}</Badge>
                          ) : (
                            <span className="font-mono">{perWeek.toFixed(1)}</span>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-right font-mono">
                          {s.mySessions > 0 ? (
                            <>
                              {s.mySessions}
                              <span className="text-muted-foreground">
                                {" "}
                                ({s.myHours.toFixed(1)}h)
                              </span>
                            </>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-2 text-right text-xs text-muted-foreground">
                          {fmtDate(s.lastWorked)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Workload is counted from booked allocations — lessons, exams and competitions. Hacking
            out or turnout that nobody booked does not appear here, so treat these as a floor
            rather than a total.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
