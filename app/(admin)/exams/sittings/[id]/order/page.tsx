import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { centreFence } from "@/lib/authz-centre";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { formatDate } from "@/lib/utils";
import { sittingLabel } from "@/lib/exam-labels";
import { resolveCentreTz } from "@/lib/centre-tz";
import { startOfDayInTz, endOfDayInTz } from "@/lib/tz";
import { DEFAULT_WORKLOAD_CAP_MIN } from "@/lib/schemas/horse";
import { RunningOrderEditor } from "./editor";

export const dynamic = "force-dynamic";

const CAN_VIEW = ["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER", "HEAD_COACH", "EXAMINER"];

// Who rides when, and on which horse. Managers generate the order and book
// horses; the sitting's examiners can read it (and print it for the arena).
export default async function RunningOrderPage({ params }: { params: { id: string } }) {
  const session = await requireSession();
  if (!CAN_VIEW.includes(session.role)) redirect("/exams");
  const sitting = await prisma.examSitting.findUnique({
    where: { id: params.id },
    include: {
      examDay: { select: { id: true, name: true, time: true } },
      examiners: { select: { examinerId: true } },
      exams: {
        include: {
          rider: { select: { firstName: true, lastName: true, schoolClass: true, school: true, schoolRef: { select: { name: true } } } },
          horseAllocation: { select: { horseId: true } },
        },
        orderBy: [{ runOrder: { sort: "asc", nulls: "last" } }, { rider: { firstName: "asc" } }],
      },
    },
  });
  if (!sitting) notFound();
  if (await centreFence(session, sitting.centreId)) notFound();
  const involved =
    sitting.examiners.some((x) => x.examinerId === session.userId) || sitting.panelJudgeIds.includes(session.userId);
  if (session.role === "EXAMINER" && !involved) redirect("/exams");
  const canEdit = can(session.role, "exam.schedule");
  const canHorses = canEdit || can(session.role, "horse.manage");

  const tz = await resolveCentreTz(sitting.centreId);
  const [template, horses, dayAllocs, holds] = await Promise.all([
    prisma.scoringTemplate.findUnique({
      where: { centreId_levelKey: { centreId: sitting.centreId, levelKey: String(sitting.level) } },
      select: { levelName: true },
    }),
    prisma.horse.findMany({
      where: { centreId: sitting.centreId, status: "active" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.horseAllocation.findMany({
      where: {
        horse: { centreId: sitting.centreId },
        startAt: { gte: startOfDayInTz(sitting.date, tz), lte: endOfDayInTz(sitting.date, tz) },
      },
      select: { horseId: true, startAt: true, endAt: true, purpose: true },
    }),
    prisma.medicineUsage.findMany({
      where: { horse: { centreId: sitting.centreId }, withdrawalUntil: { gt: new Date() } },
      select: { horseId: true, withdrawalUntil: true },
    }),
  ]);
  const minutes = new Map<string, { min: number; rides: number }>();
  for (const a of dayAllocs) {
    const m = minutes.get(a.horseId) ?? { min: 0, rides: 0 };
    m.min += (a.endAt.getTime() - a.startAt.getTime()) / 60000;
    m.rides += 1;
    minutes.set(a.horseId, m);
  }
  const held = new Set(holds.map((h) => h.horseId));
  const title = sittingLabel(template?.levelName ?? `Level ${sitting.level}`, sitting.groupNo);
  const firstSlot = sitting.exams.find((e) => e.runOrder)?.time ?? sitting.examDay?.time ?? sitting.exams[0]?.time ?? "09:00";

  return (
    <div className="space-y-4">
      <div className="print:hidden">
        <Link href={`/exams/sittings/${sitting.id}`} className="text-xs text-muted-foreground hover:underline">
          ← {title}
        </Link>
      </div>
      <div>
        <h1 className="text-2xl font-bold">Running order — {title}</h1>
        <p className="text-sm text-muted-foreground">
          {formatDate(sitting.date)}
          {sitting.examDay ? ` · ${sitting.examDay.name}` : ""} · {sitting.exams.length} rider
          {sitting.exams.length === 1 ? "" : "s"}
          {sitting.slotMinutes ? ` · ${sitting.slotMinutes}-minute slots` : " · no running order yet"}
        </p>
      </div>
      <RunningOrderEditor
        sittingId={sitting.id}
        title={title}
        date={formatDate(sitting.date)}
        canEdit={canEdit}
        canHorses={canHorses}
        hasOrder={!!sitting.slotMinutes}
        defaults={{ start: firstSlot, slotMinutes: sitting.slotMinutes ?? 8 }}
        capMinutes={DEFAULT_WORKLOAD_CAP_MIN}
        horses={horses.map((h) => ({
          id: h.id,
          name: h.name,
          held: held.has(h.id),
          minutes: Math.round(minutes.get(h.id)?.min ?? 0),
          rides: minutes.get(h.id)?.rides ?? 0,
        }))}
        rows={sitting.exams.map((e) => ({
          id: e.id,
          order: e.runOrder,
          time: e.time,
          name: `${e.rider.firstName} ${e.rider.lastName}`,
          school: [e.rider.schoolRef?.name ?? e.rider.school, e.rider.schoolClass && `Class ${e.rider.schoolClass}`]
            .filter(Boolean)
            .join(" · "),
          status: e.status,
          horseId: e.horseAllocation?.horseId ?? null,
        }))}
      />
    </div>
  );
}
