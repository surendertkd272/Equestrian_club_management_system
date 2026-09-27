import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { centreFence } from "@/lib/authz-centre";
import { requireSession } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { ClaimButton } from "./claim-button";
import { can } from "@/lib/permissions";
import { ExportCsvButton } from "@/components/ui/export-csv";
import { RescheduleForm, RemoveExamButton, CancelSittingButton } from "../../exam-actions";

export const dynamic = "force-dynamic";

// COACH is not here: the page-access table (middleware) never lets a coach
// reach /exams/*, so listing them only suggested an access they don't have.
const CAN_VIEW = ["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER", "HEAD_COACH", "EXAMINER"];

// Marking queue for a sitting: pool of examiners + riders. Pool examiners pick
// (claim) an unassigned rider to mark; claimed riders lock to their examiner.
export default async function SittingDetail({ params }: { params: { id: string } }) {
  const session = await requireSession();
  if (!CAN_VIEW.includes(session.role)) redirect("/exams");

  const sitting = await prisma.examSitting.findUnique({
    where: { id: params.id },
    include: {
      examDay: { select: { id: true, name: true } },
      examiners: { orderBy: { examinerName: "asc" } },
      exams: {
        include: { rider: { select: { firstName: true, lastName: true } } },
        orderBy: { rider: { firstName: "asc" } },
      },
    },
  });
  if (!sitting) notFound();
  // HQ roles carry centreId = null, so this comparison 404'd ADMIN on every
  // one of these screens while org-fencing nobody. Same helper the API uses.
  if (await centreFence(session, sitting.centreId)) notFound();

  const isManager = ["SUPER_ADMIN", "CENTRE_MANAGER"].includes(session.role);
  const inPool = sitting.examiners.some((e) => e.examinerId === session.userId);
  // Examiners see the sittings they work — not every level's rider list.
  if (session.role === "EXAMINER" && !inPool && !sitting.exams.some((e) => e.examinerId === session.userId)) {
    redirect("/exams");
  }
  const unassigned = sitting.exams.filter((e) => !e.examinerId).length;
  // Managers (anyone who can schedule exams) can move the sitting, cancel it,
  // or take a rider off it. A rider with a result on record stays put.
  const canSchedule = can(session.role, "exam.schedule");
  const hasResult = (e: (typeof sitting.exams)[number]) => e.status === "completed" || !!e.reopenedAt;
  const withResults = sitting.exams.filter(hasResult).length;
  const waiting = sitting.exams.length - withResults;
  const startTime = sitting.exams[0]?.time ?? "09:00";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Exam sitting — Level {sitting.level}</h1>
        <p className="text-sm text-muted-foreground">
          {formatDate(sitting.date)} · {sitting.exams.length} rider{sitting.exams.length === 1 ? "" : "s"} ·{" "}
          {unassigned} unassigned
        </p>
        {sitting.examDay && (
          <p className="mt-1 text-sm">
            Part of{" "}
            <Link href={`/exams/days/${sitting.examDay.id}`} className="text-primary underline">
              {sitting.examDay.name}
            </Link>
          </p>
        )}
        {sitting.notes && <p className="mt-1 text-sm">{sitting.notes}</p>}
        {canSchedule && (
          <div className="mt-3 flex flex-wrap items-start gap-2">
            <ExportCsvButton entity="exams" label="Export results" query={`sittingId=${sitting.id}`} />
            {/* A sitting inside an exam day moves with its day. */}
            {withResults === 0 && !sitting.examDay && (
              <RescheduleForm
                url={`/api/exam-sittings/${sitting.id}`}
                initialDate={sitting.date.toISOString().slice(0, 10)}
                initialTime={startTime}
                label="Change date / time"
              />
            )}
            <CancelSittingButton sittingId={sitting.id} waiting={waiting} withResults={withResults} />
          </div>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Examiner Pool</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {sitting.examiners.map((ex) => (
            <Badge key={ex.id} variant={ex.examinerId === session.userId ? "success" : "outline"}>
              {ex.examinerName}
              {ex.examinerId === session.userId ? " (you)" : ""}
            </Badge>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Riders</CardTitle>
          {inPool && unassigned > 0 && (
            <p className="text-xs text-muted-foreground">Pick a rider to start marking — it locks to you.</p>
          )}
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="pb-2">Rider</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {sitting.exams.map((e) => {
                  const name = `${e.rider.firstName} ${e.rider.lastName}`;
                  const mine = e.examinerId === session.userId;
                  return (
                    <tr key={e.id} className="border-t">
                      <td className="py-2 font-medium">{name}</td>
                      <td className="py-2">
                        {e.status === "completed" ? (
                          <Badge variant="success">Completed</Badge>
                        ) : !e.examinerId ? (
                          <Badge variant="outline">Unassigned</Badge>
                        ) : (
                          <Badge variant="warning">Marking · {e.examinerName}</Badge>
                        )}
                      </td>
                      <td className="py-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                        {e.status === "completed" ? (
                          <Link href={`/exams/${e.id}`} className="text-xs text-primary underline">
                            View
                          </Link>
                        ) : !e.examinerId ? (
                          inPool ? (
                            <ClaimButton examId={e.id} />
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )
                        ) : mine ? (
                          <Button asChild size="sm" variant="outline">
                            <Link href={`/exams/${e.id}`}>Continue marking</Link>
                          </Button>
                        ) : isManager ? (
                          <Link href={`/exams/${e.id}`} className="text-xs text-primary underline">
                            Open
                          </Link>
                        ) : (
                          <span className="text-xs text-muted-foreground">Locked · {e.examinerName}</span>
                        )}
                        {canSchedule && !hasResult(e) && (
                          <RemoveExamButton examId={e.id} riderName={name} inSitting compact />
                        )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
