import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AllocationGrid } from "./allocation-grid";
import { LessonStatusPanel } from "./status-panel";
import { LessonTimeEditor } from "./time-editor";
import { wallPartsInTz } from "@/lib/tz";
import { ENROLLED_RIDER_STATUSES } from "@/lib/rider-status";
import { formatEnum } from "@/lib/labels";
export const dynamic = "force-dynamic";

export default async function LessonDetailPage({ params }: { params: { id: string } }) {
  const session = await requireSession();
  const lesson = await prisma.lesson.findUnique({
    where: { id: params.id },
    include: {
      batch: { select: { name: true, level: true } },
      centre: { select: { timezone: true } },
      allocations: {
        include: {
          rider: { select: { id: true, firstName: true, lastName: true } },
          horse: { select: { id: true, name: true, stableNo: true } },
        },
      },
    },
  });
  if (!lesson) notFound();
  if (session.role !== "SUPER_ADMIN" && lesson.centreId !== session.centreId) notFound();

  // Render + edit times in the centre's zone (the server is UTC on Vercel).
  const tz = lesson.centre.timezone;
  const startParts = wallPartsInTz(lesson.date, tz);
  const endParts = wallPartsInTz(lesson.endAt, tz);

  // Riders + active horses for this centre — the picker pool.
  const [riders, horses] = await Promise.all([
    prisma.rider.findMany({
      // Enrolled riders (incl. fee-pending) so a lesson can be allocated to any
      // attending rider, not only those who paid online. See lib/rider-status.
      where: { centreId: lesson.centreId, status: { in: [...ENROLLED_RIDER_STATUSES] } },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      select: { id: true, firstName: true, lastName: true },
    }),
    prisma.horse.findMany({
      where: { centreId: lesson.centreId, status: "active" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, stableNo: true },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <Link href="/lessons" className="text-xs text-muted-foreground hover:underline">← Back to lessons</Link>
          <h1 className="mt-1 text-2xl font-bold">
            Lesson · {new Date(lesson.date).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: tz })}
          </h1>
          <div className="mt-1 flex items-center gap-2">
            {lesson.batch ? (
              <Badge variant="outline">{lesson.batch.name}{lesson.batch.level ? ` · ${lesson.batch.level}` : ""}</Badge>
            ) : (
              <Badge variant="outline">Ad-hoc</Badge>
            )}
            <Badge variant={lesson.status === "completed" ? "default" : lesson.status === "cancelled" ? "destructive" : "secondary"}>
              {formatEnum(lesson.status)}
            </Badge>
          </div>
          {lesson.notes ? <p className="mt-2 text-sm italic text-muted-foreground">{lesson.notes}</p> : null}
          {/* Change the session's date/start/end — the piece that was missing
              (status buttons alone couldn't move a lesson's time). Hidden once
              a lesson has been superseded by a reschedule. Prefilled in the
              centre's zone so it matches the displayed time. */}
          {lesson.status !== "rescheduled" && (
            <div className="mt-2">
              <LessonTimeEditor
                lessonId={lesson.id}
                initialDate={startParts.date}
                initialStart={startParts.time}
                initialEnd={endParts.time}
              />
            </div>
          )}
        </div>
        <LessonStatusPanel lessonId={lesson.id} status={lesson.status} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rider → Horse Allocation</CardTitle>
        </CardHeader>
        <CardContent>
          <AllocationGrid
            lessonId={lesson.id}
            riders={riders}
            horses={horses}
            initial={lesson.allocations.map((a) => ({
              riderId: a.riderId ?? "",
              horseId: a.horseId,
              notes: a.notes ?? "",
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
