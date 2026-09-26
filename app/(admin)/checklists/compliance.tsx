import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ResponsiveTable } from "@/components/ui/responsive-table";
import { roleLabel } from "@/lib/labels";
import { endOfDayInTz, parseWallTimeInTz, startOfDayInTz, wallPartsInTz } from "@/lib/tz";

// "Did the coaches do their morning checks?"
//
// The checklist page recorded every submission and answered none of the
// questions a manager actually asks of it. Recent Submissions listed a date,
// a shift and a tick count — never WHO — so there was no way to tell which
// coach had done the morning round, and no way at all to see who had not.
// An absence doesn't appear in a list of what happened. This inverts it: one
// row per person expected to submit, and a gap where a submission should be.

// The people who do yard rounds. Managers and HQ review; they aren't on the
// hook for a morning checklist of their own.
const EXPECTED_ROLES = ["HEAD_COACH", "COACH", "STABLE_MANAGER", "GROOM"] as const;

type Centre = { id: string; name: string; timezone: string | null };

export async function ChecklistCompliance({
  centres,
  date,
}: {
  centres: Centre[];
  /** YYYY-MM-DD in each centre's own zone; omitted = that centre's today. */
  date?: string;
}) {
  const blocks = await Promise.all(centres.map((c) => loadCentre(c, date)));
  const dayLabel = blocks[0]?.dayYmd ?? date ?? "";

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <CardTitle>Who Has Done Their Checks</CardTitle>
          <form method="get" className="flex items-center gap-2 text-sm">
            <input
              type="date"
              name="date"
              defaultValue={dayLabel}
              aria-label="Day to review"
              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
            />
            <button className="h-8 rounded-md border bg-card px-3 text-sm hover:bg-muted">Show</button>
          </form>
        </div>
        <CardDescription>
          Every coach, head coach, stable manager and groom, with the time they submitted the
          general checklist for each shift. A blank is a check that was not submitted.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {blocks.map((b) => (
          <div key={b.centre.id} className="space-y-2">
            {centres.length > 1 && (
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold">{b.centre.name}</h3>
                <span className="text-xs text-muted-foreground">
                  Morning {b.morningDone}/{b.rows.length} · Evening {b.eveningDone}/{b.rows.length}
                </span>
              </div>
            )}
            {centres.length === 1 && b.rows.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {b.dayYmd} · Morning {b.morningDone}/{b.rows.length} · Evening {b.eveningDone}/
                {b.rows.length}
              </p>
            )}
            <ResponsiveTable
              rows={b.rows}
              getRowKey={(r) => r.id}
              emptyMessage="No coaches, stable managers or grooms at this centre."
              columns={[
                {
                  key: "name",
                  header: "Name",
                  primary: true,
                  cell: (r) => (
                    <Link href={`/staff/${r.id}`} className="font-medium hover:underline">
                      {r.name}
                    </Link>
                  ),
                },
                { key: "role", header: "Role", cell: (r) => <Badge variant="outline">{roleLabel(r.role)}</Badge> },
                { key: "morning", header: "Morning", cell: (r) => <Slot time={r.morning} /> },
                { key: "evening", header: "Evening", cell: (r) => <Slot time={r.evening} /> },
                {
                  key: "horses",
                  header: "Horse Reports",
                  numeric: true,
                  cell: (r) => (r.horseReports > 0 ? r.horseReports : <span className="text-muted-foreground">—</span>),
                },
                {
                  key: "issues",
                  header: "Issues Flagged",
                  numeric: true,
                  cell: (r) =>
                    r.issues > 0 ? (
                      <span className="font-semibold text-amber-700 dark:text-amber-400">{r.issues}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    ),
                },
              ]}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function Slot({ time }: { time: string | null }) {
  return time ? (
    <Badge variant="success">✓ {time}</Badge>
  ) : (
    <Badge variant="destructive">Not submitted</Badge>
  );
}

async function loadCentre(centre: Centre, date?: string) {
  const tz = centre.timezone ?? "Asia/Kolkata";
  // The centre's own calendar day. A UTC day is the wrong 24 hours for an
  // Indian yard by 5½ of them — a 6 am round would land on "yesterday".
  const anchor = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? parseWallTimeInTz(date, tz) : new Date();
  const from = startOfDayInTz(anchor, tz);
  const to = endOfDayInTz(anchor, tz);
  const dayYmd = wallPartsInTz(from, tz).date;

  const [people, subs] = await Promise.all([
    prisma.user.findMany({
      where: { centreId: centre.id, status: "active", role: { in: [...EXPECTED_ROLES] } },
      select: { id: true, name: true, role: true },
      orderBy: [{ role: "asc" }, { name: "asc" }],
    }),
    prisma.checklistSubmission.findMany({
      where: { centreId: centre.id, submittedAt: { gte: from, lte: to } },
      select: {
        submittedByUserId: true,
        submittedAt: true,
        shift: true,
        template: { select: { scope: true } },
        items: { select: { status: true } },
      },
      orderBy: { submittedAt: "asc" },
    }),
  ]);

  const byUser = new Map<string, { morning: Date | null; evening: Date | null; horseReports: number; issues: number }>();
  for (const s of subs) {
    const row = byUser.get(s.submittedByUserId) ?? { morning: null, evening: null, horseReports: 0, issues: 0 };
    if (s.template.scope === "general") {
      // Earliest submission per shift is the one that counts for "did they
      // do it"; a second one the same shift is a correction, not a new round.
      if (s.shift === "evening") row.evening ??= s.submittedAt;
      else row.morning ??= s.submittedAt;
    } else {
      row.horseReports += 1;
    }
    row.issues += s.items.filter((i) => i.status === "not_done").length;
    byUser.set(s.submittedByUserId, row);
  }

  const fmt = (d: Date | null) => (d ? wallPartsInTz(d, tz).time : null);
  const rows = people.map((p) => {
    const r = byUser.get(p.id);
    return {
      id: p.id,
      name: p.name,
      role: p.role,
      morning: fmt(r?.morning ?? null),
      evening: fmt(r?.evening ?? null),
      horseReports: r?.horseReports ?? 0,
      issues: r?.issues ?? 0,
    };
  });

  return {
    centre,
    dayYmd,
    rows,
    morningDone: rows.filter((r) => r.morning).length,
    eveningDone: rows.filter((r) => r.evening).length,
  };
}
