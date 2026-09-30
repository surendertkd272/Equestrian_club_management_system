import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { centreFence } from "@/lib/authz-centre";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { audit } from "@/lib/audit";
import { resolveCentreTz } from "@/lib/centre-tz";
import { slotTimes, syncExamHorsesTx } from "@/lib/exam-running-order";

// Generate the sitting's running order: each rider still waiting gets a place
// and a time slot. Riders already being marked, marked or absent keep theirs.
// Run again to re-order (e.g. after late riders join, or a delayed start).
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const schema = z.object({
  start: hhmm,
  slotMinutes: z.coerce.number().int().min(2).max(60),
  breakEvery: z.coerce.number().int().min(1).max(200).nullable().optional(),
  breakMinutes: z.coerce.number().int().min(1).max(120).nullable().optional(),
  sort: z.enum(["current", "name", "school", "random"]).default("current"),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "exam.schedule")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", message: parsed.error.issues[0]?.message }, { status: 400 });
  }
  const d = parsed.data;
  const sitting = await prisma.examSitting.findUnique({ where: { id: params.id }, select: { id: true, centreId: true } });
  if (!sitting) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const fence = await centreFence(session, sitting.centreId);
  if (fence) return NextResponse.json({ error: fence }, { status: 403 });
  const tz = await resolveCentreTz(sitting.centreId);

  const exams = await prisma.exam.findMany({
    where: { sittingId: sitting.id },
    select: {
      id: true, status: true, examinerId: true, runOrder: true,
      rider: { select: { firstName: true, lastName: true, schoolClass: true, school: true, schoolRef: { select: { name: true } } } },
    },
  });
  // Only riders not yet picked up are re-ordered; the rest have ridden or are riding.
  const settled = exams.filter((e) => e.status !== "scheduled" || e.examinerId);
  const waiting = exams.filter((e) => e.status === "scheduled" && !e.examinerId);
  const name = (e: (typeof exams)[number]) => `${e.rider.firstName} ${e.rider.lastName}`.toLowerCase();
  const school = (e: (typeof exams)[number]) => (e.rider.schoolRef?.name ?? e.rider.school ?? "").toLowerCase();
  const byName = (a: (typeof exams)[number], b: (typeof exams)[number]) => name(a).localeCompare(name(b));
  if (d.sort === "name") waiting.sort(byName);
  else if (d.sort === "school") {
    waiting.sort((a, b) => school(a).localeCompare(school(b)) || (a.rider.schoolClass ?? "").localeCompare(b.rider.schoolClass ?? "", undefined, { numeric: true }) || byName(a, b));
  } else if (d.sort === "random") {
    for (let i = waiting.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [waiting[i], waiting[j]] = [waiting[j], waiting[i]];
    }
  } else waiting.sort((a, b) => (a.runOrder ?? 1e9) - (b.runOrder ?? 1e9) || byName(a, b));

  const times = slotTimes(waiting.length, d);
  if (!times) {
    return NextResponse.json(
      { error: "PAST_MIDNIGHT", message: "At that pace the running order runs past midnight — start earlier or shorten the slots." },
      { status: 400 },
    );
  }
  // Places continue after the riders who have ridden or are riding. An absent
  // rider gives up their place (it would otherwise hold a number the new order
  // skips over, and a waiting rider could be given the same one).
  const rode = settled.filter((e) => e.status !== "absent");
  const first = Math.max(0, ...rode.map((e) => e.runOrder ?? 0));
  const absentIds = settled.filter((e) => e.status === "absent").map((e) => e.id);
  const released = await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ExamSitting" WHERE id = ${sitting.id} FOR UPDATE`;
      await tx.examSitting.update({ where: { id: sitting.id }, data: { slotMinutes: d.slotMinutes } });
      if (absentIds.length) await tx.exam.updateMany({ where: { id: { in: absentIds } }, data: { runOrder: null } });
      for (const [i, e] of waiting.entries()) {
        await tx.exam.update({ where: { id: e.id }, data: { runOrder: first + i + 1, time: times[i] } });
      }
      return syncExamHorsesTx(tx, waiting.map((e) => e.id), tz);
    },
    { timeout: 30_000 },
  );
  await audit({
    userId: session.userId,
    action: "exam.running_order_set",
    tableName: "examSitting",
    rowId: sitting.id,
    after: { ...d, riders: waiting.length, horsesReleased: released.length },
  });
  return NextResponse.json({
    ok: true,
    ordered: waiting.length,
    first: times[0] ?? null,
    last: times[times.length - 1] ?? null,
    horsesReleased: released,
  });
}
