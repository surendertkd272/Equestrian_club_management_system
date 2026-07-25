import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { DailyUpdateForm } from "./form";

export const dynamic = "force-dynamic";

const CAN_LOG = ["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER", "HEAD_COACH", "COACH"];

// Coach's daily 5-minute update — the quick end-of-day narrative the client
// asked for ("Daily 5 minute Task Update from Coach"). One per coach per day.
export default async function DailyUpdatePage() {
  const session = await requireSession();
  if (!CAN_LOG.includes(session.role)) redirect("/dashboard");
  if (!session.centreId) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Daily Coach Update</h1>
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            This quick update is filed against your own centre. HQ accounts don't have one.
          </CardContent>
        </Card>
      </div>
    );
  }

  const todayStr = (() => {
    const ist = new Date(Date.now() + 330 * 60_000);
    return ist.toISOString().slice(0, 10);
  })();
  const todayKey = new Date(`${todayStr}T12:00:00.000Z`);

  const [todays, recent] = await Promise.all([
    prisma.coachDailyUpdate.findUnique({
      where: {
        centreId_coachUserId_date: {
          centreId: session.centreId,
          coachUserId: session.userId,
          date: todayKey,
        },
      },
    }),
    prisma.coachDailyUpdate.findMany({
      where: { centreId: session.centreId, coachUserId: session.userId },
      orderBy: { date: "desc" },
      take: 10,
    }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Daily Coach Update</h1>
        </div>
        {["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER", "HEAD_COACH"].includes(session.role) && (
          <Link href="/daily-update/team" className="text-sm text-primary hover:underline">
            View team updates →
          </Link>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Today · {formatDate(new Date(todayStr))}</CardTitle>
          <CardDescription>{todays ? "Already filed — edit below." : "Not filed yet."}</CardDescription>
        </CardHeader>
        <CardContent>
          <DailyUpdateForm
            date={todayStr}
            initial={
              todays
                ? {
                    summary: todays.summary,
                    horsesWorked: todays.horsesWorked,
                    ridersTaught: todays.ridersTaught,
                    injuriesNoted: todays.injuriesNoted,
                    minutesSpent: todays.minutesSpent,
                  }
                : null
            }
          />
        </CardContent>
      </Card>

      {recent.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">My Recent Updates</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3 text-sm">
              {recent.map((u) => (
                <li key={u.id} className="border-b pb-3 last:border-0">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{formatDate(u.date)}</span>
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
          </CardContent>
        </Card>
      )}
    </div>
  );
}
