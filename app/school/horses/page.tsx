import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { schoolContext } from "@/lib/school-portal";
import { ResponsiveTable } from "@/components/ui/responsive-table";
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
      select: {
        id: true,
        name: true,
        breed: true,
        sex: true,
        dob: true,
        ageYears: true,
        identificationMarks: true,
      },
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
        <h1 className="text-2xl font-bold">Horse Workload</h1>
        <p className="text-sm text-muted-foreground">
          Last 30 Days at {ctx.centreName} · Your Riders Logged {totalMyHours.toFixed(1)} Hours in
          the Saddle
        </p>
      </div>

      {busy.length > 0 && (
        <Card className="border-l-4 border-l-amber-500">
          <CardHeader>
            <CardTitle className="text-base">
              {busy.length} Horse{busy.length === 1 ? "" : "s"} in Heavy Work
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
          <CardTitle className="text-base">Every Horse at the Club ({rows.length})</CardTitle>
          <CardDescription>
            Busiest first. &ldquo;Your riders&rsquo; share&rdquo; is how much of each horse&apos;s
            work was done by students from {ctx.title}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveTable
            rows={rows}
            getRowKey={({ horse }) => horse.id}
            emptyMessage="No horses recorded at this club."
            columns={[
              {
                key: "horse",
                header: "Horse",
                primary: true,
                cell: ({ horse }) => <span className="font-medium">{horse.name}</span>,
              },
              {
                key: "breed",
                header: "Breed",
                cell: ({ horse }) => (
                  <span className="text-xs text-muted-foreground">{horse.breed ?? "—"}</span>
                ),
              },
              {
                // A school's people meet these horses at the gate. "The bay
                // with the white blaze" is how they will be talked about, so
                // the description is worth more here than the club's own
                // identifiers (microchip, EFI id), which stay withheld.
                key: "marks",
                header: "Markings",
                hideOnMobile: true,
                cell: ({ horse }) => (
                  <span className="text-xs text-muted-foreground">
                    {horse.identificationMarks ?? "—"}
                  </span>
                ),
              },
              { key: "sessions", header: "Sessions", numeric: true, cell: ({ s }) => s.sessions },
              { key: "hours", header: "Hours", numeric: true, cell: ({ s }) => s.hours.toFixed(1) },
              {
                key: "perWeek",
                header: "Hrs / Week",
                numeric: true,
                cell: ({ s }) => {
                  const perWeek = s.hours / (30 / 7);
                  return perWeek > BUSY_HOURS_PER_WEEK ? (
                    <Badge variant="warning">{perWeek.toFixed(1)}</Badge>
                  ) : (
                    <span>{perWeek.toFixed(1)}</span>
                  );
                },
              },
              {
                // "Your Riders: 10 (15.0h)" left the reader to find the total
                // four columns away and divide. The question this column exists
                // to answer is what share of the horse's work was ours, so it
                // answers it.
                key: "mine",
                header: "Your Riders' Share",
                numeric: true,
                cell: ({ s }) =>
                  s.mySessions > 0 ? (
                    <div className="leading-tight">
                      <div className="font-medium">
                        {Math.round((s.mySessions / s.sessions) * 100)}%
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {s.mySessions} of {s.sessions} · {s.myHours.toFixed(1)}h
                      </div>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  ),
              },
              {
                key: "lastWorked",
                header: "Last Worked",
                hideOnMobile: true,
                cell: ({ s }) => (
                  <span className="text-xs text-muted-foreground">{fmtDate(s.lastWorked)}</span>
                ),
              },
            ]}
          />
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
