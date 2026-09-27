import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { scopeCentre } from "@/lib/tenancy";
import { getOrgIdForSession, getOrgIdForCentre } from "@/lib/features-gate";
import { isExamManager } from "@/lib/exam-panel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AddVisitingExaminer, ExaminerRowActions } from "./examiner-actions";

export const dynamic = "force-dynamic";

const fmt = (d: Date) => d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

// The centre's examiners — its own and the judges it brings in for an exam
// day. A centre manager registers a visiting judge here with an access end
// date; after it their account stops working on its own.
export default async function ExaminersPage() {
  const session = await requireSession();
  if (!isExamManager(session.role)) redirect("/exams");
  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/no-organisation");
  const centreId = scopeCentre(session);
  if (!centreId) {
    return (
      <Card className="mx-auto max-w-xl">
        <CardHeader>
          <CardTitle>Examiners</CardTitle>
          <CardDescription>Examiners belong to one centre. Pick the centre in the top bar first.</CardDescription>
        </CardHeader>
      </Card>
    );
  }
  if ((await getOrgIdForCentre(centreId)) !== orgId) redirect("/exams");

  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const examiners = await prisma.user.findMany({
    where: { centreId, role: "EXAMINER" },
    select: {
      id: true, name: true, email: true, phone: true, status: true,
      accessExpiresAt: true, mustChangePassword: true, createdAt: true,
    },
    orderBy: [{ accessExpiresAt: { sort: "desc", nulls: "last" } }, { name: "asc" }],
  });
  const upcoming = await prisma.examSittingExaminer.groupBy({
    by: ["examinerId"],
    where: { examinerId: { in: examiners.map((e) => e.id) }, sitting: { date: { gte: today } } },
    _count: true,
  });
  const upcomingBy = new Map(upcoming.map((u) => [u.examinerId, u._count]));
  const defaultUntil = new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/exams" className="text-xs text-muted-foreground hover:underline">
            ← Exams
          </Link>
          <h1 className="text-2xl font-bold">Examiners</h1>
          <p className="text-sm text-muted-foreground">
            Your examiners and the visiting judges you bring in for exam days.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Register a visiting examiner</CardTitle>
          <CardDescription>
            For a judge from outside the club. They get a temporary password to hand over, see only the riders they
            examine, and their access ends automatically on the date you set.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AddVisitingExaminer defaultUntil={defaultUntil} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {examiners.length} examiner{examiners.length === 1 ? "" : "s"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {examiners.length === 0 && <p className="text-sm text-muted-foreground">No examiners yet.</p>}
          {examiners.map((e) => {
            const ended = e.status !== "active" || (e.accessExpiresAt !== null && e.accessExpiresAt <= now);
            return (
              <div key={e.id} className="flex flex-wrap items-start justify-between gap-3 rounded-md border p-3">
                <div className="min-w-0">
                  <div className="font-medium">{e.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {e.email}
                    {e.phone ? ` · ${e.phone}` : ""}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {ended ? (
                      <Badge variant="outline">Access ended</Badge>
                    ) : e.accessExpiresAt ? (
                      <Badge variant="warning">Visiting · until {fmt(e.accessExpiresAt)}</Badge>
                    ) : (
                      <Badge variant="outline">Permanent</Badge>
                    )}
                    {!ended && (e.mustChangePassword ? (
                      <Badge variant="warning">Hasn&rsquo;t signed in yet</Badge>
                    ) : (
                      <Badge variant="success">Signed in · ready</Badge>
                    ))}
                    {(upcomingBy.get(e.id) ?? 0) > 0 && (
                      <Badge variant="outline">
                        {upcomingBy.get(e.id)} upcoming sitting{upcomingBy.get(e.id) === 1 ? "" : "s"}
                      </Badge>
                    )}
                  </div>
                </div>
                <ExaminerRowActions
                  id={e.id}
                  name={e.name}
                  email={e.email}
                  visiting={e.accessExpiresAt !== null}
                  ended={ended}
                  until={e.accessExpiresAt ? e.accessExpiresAt.toISOString().slice(0, 10) : defaultUntil}
                />
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
