import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { ClaimButton } from "./claim-button";

export const dynamic = "force-dynamic";

const CAN_VIEW = ["SUPER_ADMIN", "CENTRE_MANAGER", "HEAD_COACH", "COACH", "EXAMINER"];

// Marking queue for a sitting: pool of examiners + riders. Pool examiners pick
// (claim) an unassigned rider to mark; claimed riders lock to their examiner.
export default async function SittingDetail({ params }: { params: { id: string } }) {
  const session = await requireSession();
  if (!CAN_VIEW.includes(session.role)) redirect("/exams");

  const sitting = await prisma.examSitting.findUnique({
    where: { id: params.id },
    include: {
      examiners: { orderBy: { examinerName: "asc" } },
      exams: {
        include: { rider: { select: { firstName: true, lastName: true } } },
        orderBy: { rider: { firstName: "asc" } },
      },
    },
  });
  if (!sitting) notFound();
  if (session.role !== "SUPER_ADMIN" && sitting.centreId !== session.centreId) notFound();

  const isManager = ["SUPER_ADMIN", "CENTRE_MANAGER"].includes(session.role);
  const inPool = sitting.examiners.some((e) => e.examinerId === session.userId);
  const unassigned = sitting.exams.filter((e) => !e.examinerId).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Exam sitting — Level {sitting.level}</h1>
        <p className="text-sm text-muted-foreground">
          {formatDate(sitting.date)} · {sitting.exams.length} rider{sitting.exams.length === 1 ? "" : "s"} ·{" "}
          {unassigned} unassigned
        </p>
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
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
