import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { scopeCentre, tenantWhere } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/utils";
import { istTodayStr, coachUpdateDateKey, DAILY_UPDATE_ROLES } from "@/lib/coach-update";

export const dynamic = "force-dynamic";

// Managers/admins reviewing the whole team's daily coach updates for a given
// day. Read-only — coaches file via /daily-update.
const CAN_VIEW = ["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER", "HEAD_COACH"];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function TeamDailyUpdatesPage({
  searchParams,
}: {
  searchParams: { date?: string };
}) {
  const session = await requireSession();
  if (!CAN_VIEW.includes(session.role)) redirect("/daily-update");

  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/dashboard");
  // HQ (SUPER_ADMIN/ADMIN) with no club picked → show the WHOLE org's updates
  // (each labelled with its club) instead of dead-ending on "pick a club".
  // Centre-scoped roles resolve to their own club.
  // scopeCentre → the picked club for centre-scoped roles, or null for HQ with
  // no club selected (which tenantWhere widens to the whole org).
  const centreId = scopeCentre(session);

  // Coaches file sporadically, so defaulting to "today" left this page almost
  // always empty ("No updates filed for this day") and reading as broken. When
  // the viewer hasn't picked a date, open on the most recent day that actually
  // has updates in scope — falling back to today only when none exist at all.
  const explicitDate = DATE_RE.test(searchParams.date ?? "") ? searchParams.date! : null;
  let dateStr = explicitDate ?? istTodayStr();
  if (!explicitDate) {
    const latest = await prisma.coachDailyUpdate.findFirst({
      where: tenantWhere(centreId, orgId),
      orderBy: { date: "desc" },
      select: { date: true },
    });
    if (latest) dateStr = latest.date.toISOString().slice(0, 10);
  }
  const dateKey = coachUpdateDateKey(dateStr);

  const [updates, coaches] = await Promise.all([
    prisma.coachDailyUpdate.findMany({
      where: { ...tenantWhere(centreId, orgId), date: dateKey },
      include: { coach: { select: { name: true } }, centre: { select: { name: true } } },
      orderBy: [{ centre: { name: "asc" } }, { coach: { name: "asc" } }],
    }),
    prisma.user.findMany({
      where: { ...tenantWhere(centreId, orgId), status: "active", role: { in: [...DAILY_UPDATE_ROLES] } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const filedIds = new Set(updates.map((u) => u.coachUserId));
  const notFiled = coaches.filter((c) => !filedIds.has(c.id));

  // When the current view is empty, look PAST the club filter so the empty
  // state can explain *why* it's empty — the recurring "the page is broken"
  // report is almost always an HQ user filtered to one club while the coach
  // who filed sits in another. Distinguish three cases:
  //   • updates exist under a different club  → tell them to pick "All Centres"
  //   • nobody in the org has filed at all    → the coach's submit never landed
  //   • filed, but on a different date        → point at that date
  const clubName = centreId
    ? (await prisma.centre.findUnique({ where: { id: centreId }, select: { name: true } }))?.name ?? null
    : null;
  let latestAnywhere:
    | { date: Date; coachName: string; centreName: string | null; sameClub: boolean }
    | null = null;
  if (updates.length === 0) {
    const row = await prisma.coachDailyUpdate.findFirst({
      where: tenantWhere(null, orgId), // org-wide — deliberately ignores the club filter
      orderBy: { date: "desc" },
      include: { coach: { select: { name: true } }, centre: { select: { name: true } } },
    });
    if (row) {
      latestAnywhere = {
        date: row.date,
        coachName: row.coach.name,
        centreName: row.centre?.name ?? null,
        sameClub: centreId != null && row.centreId === centreId,
      };
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Team Daily Updates</h1>
        </div>
        {/* GET form keeps this a server component — no client JS needed. */}
        <form className="flex items-end gap-2">
          <div className="space-y-1">
            <label className="text-[10px] tracking-wider text-muted-foreground">Date</label>
            <Input type="date" name="date" defaultValue={dateStr} className="h-9" />
          </div>
          <Button type="submit" variant="outline" size="sm">View</Button>
        </form>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Filed" value={`${updates.length}/${coaches.length}`} />
        <Stat label="Yet to File" value={notFiled.length} tone={notFiled.length > 0 ? "amber" : "green"} />
        <Stat label="Injuries Flagged" value={updates.filter((u) => u.injuriesNoted).length} tone={updates.some((u) => u.injuriesNoted) ? "rose" : undefined} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filed · {formatDate(new Date(dateStr))}</CardTitle>
        </CardHeader>
        <CardContent>
          {updates.length === 0 ? (
            <div className="space-y-2 py-4 text-center text-sm text-muted-foreground">
              <p>
                No updates were filed on this date
                {clubName ? <> for <span className="font-medium">{clubName}</span></> : null}.
              </p>
              {!latestAnywhere ? (
                <p>
                  No coach in your organisation has filed a daily update yet. Coaches file theirs from
                  &ldquo;Daily Coach Update&rdquo; in their own login &mdash; if a coach says they submitted,
                  ask them to reopen it and check it shows &ldquo;Already filed&rdquo;.
                </p>
              ) : clubName && !latestAnywhere.sameClub ? (
                <p className="font-medium text-amber-700">
                  A coach <span className="font-semibold">has</span> filed &mdash; just under a different club.
                  The most recent is {latestAnywhere.coachName}
                  {latestAnywhere.centreName ? <> at {latestAnywhere.centreName}</> : null} on{" "}
                  {formatDate(latestAnywhere.date)}. Set the club picker at the top of the page to
                  &ldquo;All Centres&rdquo; to see every club&apos;s updates.
                </p>
              ) : (
                <p>
                  The most recent update was filed on {formatDate(latestAnywhere.date)} &mdash; pick that
                  date above to read it.
                </p>
              )}
            </div>
          ) : (
            <ul className="space-y-3 text-sm">
              {updates.map((u) => (
                <li key={u.id} className="border-b pb-3 last:border-0">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">
                      {u.coach.name}
                      {u.centre?.name && <span className="ml-2 text-[11px] font-normal text-muted-foreground">· {u.centre.name}</span>}
                    </span>
                    <span className="flex gap-2 text-[11px] text-muted-foreground">
                      {u.horsesWorked != null && <span>{u.horsesWorked} horses</span>}
                      {u.ridersTaught != null && <span>{u.ridersTaught} riders</span>}
                      {u.minutesSpent != null && <span>{u.minutesSpent} min</span>}
                    </span>
                  </div>
                  <p className="mt-1 text-muted-foreground">{u.summary}</p>
                  {u.injuriesNoted && (
                    <p className="mt-1">
                      <Badge variant="warning">injury noted</Badge>{" "}
                      <span className="text-xs text-muted-foreground">{u.injuriesNoted}</span>
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {notFiled.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Yet to file ({notFiled.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {notFiled.map((c) => (
                <Badge key={c.id} variant="outline">{c.name}</Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: "amber" | "rose" | "green" }) {
  const cls = tone === "rose" ? "text-rose-600" : tone === "amber" ? "text-amber-700" : tone === "green" ? "text-emerald-600" : "";
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${cls}`}>{value}</div>
    </div>
  );
}
