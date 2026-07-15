import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { scopeCentre, tenantWhere } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { parseDateOnly, toDateOnly } from "@/lib/schemas/attendance";
import { ENROLLED_RIDER_STATUSES } from "@/lib/rider-status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AttendanceMarker } from "./marker";
import { ExportCsvButton } from "@/components/ui/export-csv";

export const dynamic = "force-dynamic";

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: { date?: string; batch?: string };
}) {
  const session = (await getSession())!;
  const centreId = scopeCentre(session);
  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/dashboard");
  const where = tenantWhere(centreId, orgId);

  const today = toDateOnly(new Date());
  const date = searchParams.date && /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date) ? searchParams.date : today;

  // Coaches only see their own batches; managers/admins see all.
  const batchWhere: any = { ...where };
  if (session.role === "COACH") batchWhere.coachId = session.userId;
  const batches = await prisma.batch.findMany({
    where: batchWhere,
    orderBy: { name: "asc" },
    include: { _count: { select: { riders: true } } },
  });

  const selectedBatchId = searchParams.batch ?? batches[0]?.id ?? null;
  const selectedBatch = selectedBatchId ? batches.find((b) => b.id === selectedBatchId) ?? null : null;

  let roster: { id: string; firstName: string; lastName: string }[] = [];
  let existing: { riderId: string; status: string; reason: string | null }[] = [];

  if (selectedBatch) {
    // Show every ENROLLED rider in the batch — including "pending_payment"
    // (fee not yet collected online). A child attending class must be markable
    // regardless of fee status; only unapproved self-enrolments stay hidden.
    roster = await prisma.rider.findMany({
      where: { batchId: selectedBatch.id, status: { in: [...ENROLLED_RIDER_STATUSES] } },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    });
    existing = await prisma.attendance.findMany({
      where: { batchId: selectedBatch.id, date: parseDateOnly(date) },
      select: { riderId: true, status: true, reason: true },
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Attendance</h1>
        </div>
        <form className="flex flex-wrap items-end gap-2 text-sm" method="get">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Batch</label>
            <select aria-label="Filter by batch"
              name="batch"
              defaultValue={selectedBatchId ?? ""}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              {batches.length === 0 && <option value="">(no batches)</option>}
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} · {b._count.riders} riders
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Date</label>
            <input
              type="date"
              name="date"
              defaultValue={date}
              max={today}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <button className="inline-flex h-9 items-center rounded-md border bg-card px-3 text-sm hover:bg-muted">
            Load
          </button>
          <ExportCsvButton entity="attendance" label="Export (30d)" />
        </form>
      </div>

      {!selectedBatch ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            {session.role === "COACH"
              ? "No batches assigned to you yet. Ask your Centre Manager to add you to a batch."
              : "No batches set up yet. Create one from Batches."}{" "}
            <Link className="text-primary underline" href="/batches">
              Go to Batches
            </Link>
          </CardContent>
        </Card>
      ) : roster.length === 0 ? (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>{selectedBatch.name}</CardTitle>
              <Badge variant="outline">{date}</Badge>
            </div>
          </CardHeader>
          <CardContent className="py-12 text-center text-muted-foreground">
            No riders assigned to this batch yet.{" "}
            <Link className="text-primary underline" href="/riders">
              Assign one from Riders
            </Link>
            .
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>
                {selectedBatch.name}{" "}
                <span className="text-sm font-normal text-muted-foreground">
                  · {selectedBatch.dayOfWeek} {selectedBatch.startTime}–{selectedBatch.endTime}
                </span>
              </CardTitle>
              <Badge variant="outline">{date}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <AttendanceMarker
              batchId={selectedBatch.id}
              date={date}
              roster={roster}
              existing={existing}
              // SCHOOL_ADMINISTRATOR is read-only — they observe student
              // attendance without marking. Other roles edit only for
              // today-or-earlier (future-date attendance doesn't exist yet).
              canEdit={date <= today && session.role !== "SCHOOL_ADMINISTRATOR"}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
