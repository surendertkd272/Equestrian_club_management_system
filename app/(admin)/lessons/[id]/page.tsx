import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AllocationGrid } from "./allocation-grid";
import { LessonStatusPanel } from "./status-panel";

export const dynamic = "force-dynamic";

export default async function LessonDetailPage({ params }: { params: { id: string } }) {
  const session = (await getSession())!;
  const lesson = await prisma.lesson.findUnique({
    where: { id: params.id },
    include: {
      batch: { select: { name: true, level: true } },
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

  // Riders + active horses for this centre — the picker pool.
  const [riders, horses] = await Promise.all([
    prisma.rider.findMany({
      where: { centreId: lesson.centreId, status: "active" },
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
            Lesson · {new Date(lesson.date).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
          </h1>
          <div className="mt-1 flex items-center gap-2">
            {lesson.batch ? (
              <Badge variant="outline">{lesson.batch.name}{lesson.batch.level ? ` · ${lesson.batch.level}` : ""}</Badge>
            ) : (
              <Badge variant="outline">Ad-hoc</Badge>
            )}
            <Badge variant={lesson.status === "completed" ? "default" : lesson.status === "cancelled" ? "destructive" : "secondary"}>
              {lesson.status}
            </Badge>
          </div>
          {lesson.notes ? <p className="mt-2 text-sm italic text-muted-foreground">{lesson.notes}</p> : null}
        </div>
        <LessonStatusPanel lessonId={lesson.id} status={lesson.status} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rider → Horse allocation</CardTitle>
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
