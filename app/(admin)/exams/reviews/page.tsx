import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { scopeCentre, tenantWhere } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { isExamManager } from "@/lib/exam-panel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

// Families' requests for an exam result to be reviewed, oldest first.
export default async function ExamReviewsPage() {
  const session = await requireSession();
  if (!isExamManager(session.role)) redirect("/exams");
  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/no-organisation");
  // Through the exam: the request table has no centre relation of its own.
  const where = { exam: tenantWhere(scopeCentre(session), orgId) };
  const [open, recent] = await Promise.all([
    prisma.examReviewRequest.findMany({
      where: { ...where, status: "open" },
      orderBy: { createdAt: "asc" },
      include: { exam: { select: { id: true, level: true, date: true, totalScore: true, passed: true, rider: { select: { firstName: true, lastName: true } } } } },
    }),
    prisma.examReviewRequest.findMany({
      where: { ...where, status: { not: "open" } },
      orderBy: { decidedAt: "desc" },
      take: 20,
      include: { exam: { select: { id: true, level: true, rider: { select: { firstName: true, lastName: true } } } } },
    }),
  ]);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/exams" className="text-xs text-muted-foreground hover:underline">
          ← Exams
        </Link>
        <h1 className="text-2xl font-bold">Result review requests</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Waiting for an answer ({open.length})</CardTitle>
          <CardDescription>Open one to reopen the exam for correction, or decline with a reply to the family.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {open.length === 0 && <p className="text-sm text-muted-foreground">Nothing waiting.</p>}
          {open.map((r) => (
            <Link key={r.id} href={`/exams/${r.exam.id}`} className="block rounded-md border p-3 hover:bg-muted/40">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">
                  {r.exam.rider.firstName} {r.exam.rider.lastName} · Level {r.exam.level}
                </span>
                <span className="text-xs text-muted-foreground">asked {formatDate(r.createdAt)}</span>
              </div>
              <div className="mt-1 text-sm">{r.reason}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Exam {formatDate(r.exam.date)} · {r.exam.passed ? "passed" : "not passed"} · score {r.exam.totalScore ?? "—"}
              </div>
            </Link>
          ))}
        </CardContent>
      </Card>
      {recent.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Answered</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {recent.map((r) => (
                <li key={r.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                  <Link href={`/exams/${r.exam.id}`} className="hover:underline">
                    {r.exam.rider.firstName} {r.exam.rider.lastName} · Level {r.exam.level}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    {r.status === "reopened" ? "Reopened" : "Declined"} {r.decidedAt ? formatDate(r.decidedAt) : ""}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
