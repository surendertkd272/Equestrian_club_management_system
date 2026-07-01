// Gate-log summary view. Aggregates raw IN/OUT events from /gate into
// "per-staff hours worked today" + "currently on premises" + late arrivals.
// Centre managers + HR use this to read presence at a glance instead of
// scrolling the event log.

import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

// Configurable "expected start" — anyone with their first IN after this
// clock-hour gets flagged as "late". 9 AM is a sensible default for Indian
// equestrian centres; can be lifted to per-centre config later.
const LATE_AFTER_HOUR = 9;

export default async function GateSummaryPage({
  searchParams,
}: {
  searchParams: { centre?: string; date?: string };
}) {
  const session = (await getSession())!;
  if (!can(session.role, "staff.attendance")) redirect("/dashboard");

  // Resolve centre context (same picker dance as the kiosk).
  let centreId = session.centreId;
  if (!centreId && session.role === "SUPER_ADMIN") {
    centreId = searchParams.centre ?? null;
  }
  if (!centreId) redirect("/gate"); // The kiosk page renders the picker.

  // Day window. Default today; ?date=YYYY-MM-DD jumps to a specific day.
  const day = searchParams.date ? new Date(searchParams.date) : new Date();
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const dayEnd = new Date(dayStart.getTime() + 86400000);

  const events = await prisma.staffGateEvent.findMany({
    where: { centreId, occurredAt: { gte: dayStart, lt: dayEnd } },
    include: { staff: { select: { id: true, name: true, role: true } } },
    orderBy: { occurredAt: "asc" },
  });

  // Pair adjacent IN→OUT into shifts per staff. Stray INs (no matching OUT
  // yet) are "still on premises". Stray OUTs (no preceding IN) are weird
  // but shown as "(no in)".
  type Shift = { start: Date; end: Date | null };
  type Row = {
    staffId: string;
    staffName: string;
    staffRole: string;
    shifts: Shift[];
    firstIn: Date | null;
    onPremises: boolean;
    totalMin: number;
    late: boolean;
  };
  const byStaff = new Map<string, Row>();
  for (const e of events) {
    let row = byStaff.get(e.staffUserId);
    if (!row) {
      row = {
        staffId: e.staffUserId,
        staffName: e.staff.name,
        staffRole: e.staff.role,
        shifts: [],
        firstIn: null,
        onPremises: false,
        totalMin: 0,
        late: false,
      };
      byStaff.set(e.staffUserId, row);
    }
    if (e.direction === "in") {
      if (!row.firstIn) row.firstIn = e.occurredAt;
      row.shifts.push({ start: e.occurredAt, end: null });
      row.onPremises = true;
    } else {
      // Pair OUT with the latest open shift if any.
      const open = [...row.shifts].reverse().find((s) => s.end === null);
      if (open) open.end = e.occurredAt;
      row.onPremises = false;
    }
  }

  // Compute totals + late flag.
  const nowMs = Date.now();
  for (const r of byStaff.values()) {
    let totalMs = 0;
    for (const s of r.shifts) {
      const endMs = (s.end ?? new Date(Math.min(nowMs, dayEnd.getTime()))).getTime();
      totalMs += Math.max(0, endMs - s.start.getTime());
    }
    r.totalMin = Math.round(totalMs / 60000);
    r.late = r.firstIn ? r.firstIn.getHours() >= LATE_AFTER_HOUR : false;
  }

  const rows = Array.from(byStaff.values()).sort((a, b) => a.staffName.localeCompare(b.staffName));
  const onPremisesCount = rows.filter((r) => r.onPremises).length;
  const lateCount = rows.filter((r) => r.late).length;

  const yyyy = day.getFullYear();
  const mm = String(day.getMonth() + 1).padStart(2, "0");
  const dd = String(day.getDate()).padStart(2, "0");
  const dateStr = `${yyyy}-${mm}-${dd}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Gate Summary</h1>
          <p className="text-sm text-muted-foreground">
            {rows.length} staff with events on {dateStr}
            {" · "}
            <Link className="text-primary underline" href={session.role === "SUPER_ADMIN" ? `/gate?centre=${centreId}` : "/gate"}>
              Back to kiosk
            </Link>
          </p>
        </div>
        <form className="flex items-center gap-2 text-sm">
          {session.role === "SUPER_ADMIN" && (
            <input type="hidden" name="centre" value={centreId} />
          )}
          <label className="text-xs uppercase text-muted-foreground">Date</label>
          <input
            type="date"
            name="date"
            defaultValue={dateStr}
            className="h-9 rounded-md border bg-background px-2"
          />
          <button type="submit" className="rounded-md border px-3 py-1 text-xs">View</button>
        </form>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">On Premises Now</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{onPremisesCount}</div>
            <p className="text-xs text-muted-foreground">{rows.length} staff active today</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Late Arrivals</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{lateCount}</div>
            <p className="text-xs text-muted-foreground">First IN after {LATE_AFTER_HOUR}:00</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Average Hours</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {rows.length > 0 ? (rows.reduce((s, r) => s + r.totalMin, 0) / rows.length / 60).toFixed(1) : "0"}
              <span className="text-base font-normal text-muted-foreground">h</span>
            </div>
            <p className="text-xs text-muted-foreground">across staff with events</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Per-Staff Timesheet</CardTitle>
          <CardDescription>
            Shifts are inferred by pairing each IN with the next OUT. Open shifts (no OUT yet) are clamped to "now" for the duration calc.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No gate events recorded on this day.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="pb-2">Staff</th>
                    <th className="pb-2">Role</th>
                    <th className="pb-2">First IN</th>
                    <th className="pb-2">Shifts</th>
                    <th className="pb-2">Hours</th>
                    <th className="pb-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.staffId} className="border-t">
                      <td className="py-2 font-medium">{r.staffName}</td>
                      <td className="py-2 text-xs text-muted-foreground">{r.staffRole.replaceAll("_", " ")}</td>
                      <td className="py-2 font-mono text-xs">
                        {r.firstIn?.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) ?? "—"}
                      </td>
                      <td className="py-2 text-xs">
                        {r.shifts.map((s, i) => (
                          <span key={i} className="mr-1 inline-block rounded bg-muted px-1.5 py-0.5 font-mono">
                            {s.start.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                            {" – "}
                            {s.end ? s.end.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "now"}
                          </span>
                        ))}
                      </td>
                      <td className="py-2 font-mono">{(r.totalMin / 60).toFixed(1)}h</td>
                      <td className="py-2 space-x-1">
                        {r.onPremises && <Badge variant="success">In</Badge>}
                        {r.late && <Badge variant="warning">Late</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
