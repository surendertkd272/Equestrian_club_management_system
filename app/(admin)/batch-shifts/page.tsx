// Admin review queue for rider-initiated BatchShiftRequest rows.
// Mounted as a separate page (not stitched into the generic /approvals
// surface) because batch shift requests have their own decision flow:
// per-request kind (single_day vs permanent) drives who can approve,
// and approval creates side-effects (Attendance row OR rider.batchId
// flip) we don't want to thread into the ApprovalRequest table.
//
// Permission: CENTRE_MANAGER + HEAD_COACH + HQ admins always see all
// pending. COACH sees pending single_day requests targeting their
// own batches.

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { CalendarRange } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { DecideButtons } from "./decide-buttons";

export const dynamic = "force-dynamic";

function canView(role: string): boolean {
  return (
    role === "SUPER_ADMIN" ||
    role === "ADMIN" ||
    role === "CENTRE_MANAGER" ||
    role === "HEAD_COACH" ||
    role === "COACH"
  );
}

export default async function BatchShiftsPage() {
  const session = (await getSession())!;
  if (!canView(session.role)) redirect("/dashboard");

  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  const isCoach = session.role === "COACH";

  // Scope query — coach only sees single-day requests for THEIR batches.
  const where = isHQ
    ? {}
    : isCoach
      ? { kind: "single_day", toBatch: { coachId: session.userId } }
      : session.centreId
        ? { toBatch: { centreId: session.centreId } }
        : { id: "no-match" };

  const requests = await prisma.batchShiftRequest.findMany({
    where,
    include: {
      rider: { select: { id: true, firstName: true, lastName: true } },
      toBatch: { select: { id: true, name: true } },
      fromBatch: { select: { id: true, name: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
  });

  const pending = requests.filter((r) => r.status === "pending");
  const decided = requests.filter((r) => r.status !== "pending");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Batch shift requests</h1>
        <p className="text-sm text-muted-foreground">
          Riders ask to move to a different batch — for one day or permanently. Approve or reject below.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pending ({pending.length})</CardTitle>
          <CardDescription>
            Single-day shifts can be approved by the target batch's coach. Permanent
            shifts need a centre manager (roster decision).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {pending.length === 0 ? (
            <EmptyState
              icon={<CalendarRange className="h-8 w-8" />}
              title="Nothing waiting"
              body="Riders submit shift requests from their portal. They show up here for the right approver."
            />
          ) : (
            <ul className="space-y-2">
              {pending.map((r) => (
                <li key={r.id} className="rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="font-medium">
                        {r.rider.firstName} {r.rider.lastName}{" "}
                        <Badge variant="outline" className="ml-1">
                          {r.kind === "single_day" ? "Single day" : "Permanent"}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {r.fromBatch?.name ?? "No batch"} → <b>{r.toBatch.name}</b>
                        {r.kind === "single_day" && r.shiftDate && (
                          <> · on {formatDate(r.shiftDate)}</>
                        )}
                        {" · submitted "}{formatDate(r.createdAt)}
                      </div>
                      {r.reason && (
                        <div className="mt-1 text-xs italic text-muted-foreground">"{r.reason}"</div>
                      )}
                    </div>
                    <DecideButtons id={r.id} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {decided.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent decisions</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {decided.slice(0, 50).map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm">
                  <div>
                    <span className="font-medium">{r.rider.firstName} {r.rider.lastName}</span>
                    {" · "}
                    {r.kind === "single_day" ? "Single day" : "Permanent"}
                    {" → "}
                    <b>{r.toBatch.name}</b>
                    {r.kind === "single_day" && r.shiftDate && <> on {formatDate(r.shiftDate)}</>}
                  </div>
                  <Badge variant={r.status === "approved" ? "success" : "destructive"}>{r.status}</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
