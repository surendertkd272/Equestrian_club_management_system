import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
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
  const session = (await getSession())!;
  if (!CAN_VIEW.includes(session.role)) redirect("/daily-update");

  const centreId = scopeCentre(session);
  if (!centreId) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Team Daily Updates</h1>
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Pick a club from the top bar to see its coaches' daily updates. HQ accounts aren't tied
            to a single centre.
          </CardContent>
        </Card>
      </div>
    );
  }

  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/dashboard");

  const dateStr = DATE_RE.test(searchParams.date ?? "") ? searchParams.date! : istTodayStr();
  const dateKey = coachUpdateDateKey(dateStr);

  const [updates, coaches] = await Promise.all([
    prisma.coachDailyUpdate.findMany({
      where: { ...tenantWhere(centreId, orgId), date: dateKey },
      include: { coach: { select: { name: true } } },
      orderBy: { coach: { name: "asc" } },
    }),
    prisma.user.findMany({
      where: { ...tenantWhere(centreId, orgId), status: "active", role: { in: [...DAILY_UPDATE_ROLES] } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const filedIds = new Set(updates.map((u) => u.coachUserId));
  const notFiled = coaches.filter((c) => !filedIds.has(c.id));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Team Daily Updates</h1>
          <p className="text-sm text-muted-foreground">
            Every coach's end-of-day note for the selected day.
          </p>
        </div>
        {/* GET form keeps this a server component — no client JS needed. */}
        <form className="flex items-end gap-2">
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Date</label>
            <Input type="date" name="date" defaultValue={dateStr} className="h-9" />
          </div>
          <Button type="submit" variant="outline" size="sm">View</Button>
        </form>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Filed" value={`${updates.length}/${coaches.length}`} />
        <Stat label="Yet to file" value={notFiled.length} tone={notFiled.length > 0 ? "amber" : "green"} />
        <Stat label="Injuries flagged" value={updates.filter((u) => u.injuriesNoted).length} tone={updates.some((u) => u.injuriesNoted) ? "rose" : undefined} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filed · {formatDate(new Date(dateStr))}</CardTitle>
        </CardHeader>
        <CardContent>
          {updates.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No updates filed for this day.</p>
          ) : (
            <ul className="space-y-3 text-sm">
              {updates.map((u) => (
                <li key={u.id} className="border-b pb-3 last:border-0">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{u.coach.name}</span>
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
