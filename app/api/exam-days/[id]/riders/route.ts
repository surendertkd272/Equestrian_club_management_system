import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { centreFence } from "@/lib/authz-centre";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { audit } from "@/lib/audit";
import {
  BookingError,
  MAX_EXAMINERS_PER_POOL,
  MAX_RIDERS_PER_SITTING,
  addExamsToSittingTx,
  checkBookings,
  createSittingTx,
  examinerPool,
  splitIntoGroups,
} from "@/lib/exam-booking";
import { assertDayRoom, assertNotPast, panelOf, sittingDefaults } from "@/lib/exam-late-riders";

// Add late riders to an exam day, each at their own level. A rider joins
// their level's sitting (the emptiest group with room); a level that's full
// opens a new group with the same examiners; a level not on the day yet opens
// a new sitting with the examiners picked for it.
const schema = z.object({
  entries: z
    .array(z.object({ riderId: z.string().min(1), level: z.coerce.number().int().min(1).max(10) }))
    .min(1)
    .max(MAX_RIDERS_PER_SITTING),
  // Only needed for a level that isn't on the day yet.
  pools: z.record(z.array(z.string().min(1)).min(1).max(MAX_EXAMINERS_PER_POOL)).optional(),
  allowSkipLevels: z.boolean().optional(),
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
  const day = await prisma.examDay.findUnique({
    where: { id: params.id },
    select: { id: true, centreId: true, date: true, time: true, holdResults: true },
  });
  if (!day) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const fence = await centreFence(session, day.centreId);
  if (fence) return NextResponse.json({ error: fence }, { status: 403 });

  try {
    await assertNotPast(day.centreId, day.date);
    await assertDayRoom(prisma, day.id, d.entries.length);
    const { ladder, priorFails, skipped } = await checkBookings(prisma, {
      centreId: day.centreId,
      entries: d.entries,
      allowSkipLevels: d.allowSkipLevels,
    });
    const byLevel = new Map<number, string[]>();
    for (const e of d.entries) byLevel.set(e.level, [...(byLevel.get(e.level) ?? []), e.riderId]);

    const placed = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ExamDay" WHERE id = ${day.id} FOR UPDATE`;
      const out: { level: number; sittingId: string; group: number | null; added: number; newSitting: boolean }[] = [];
      for (const [level, riderIds] of Array.from(byLevel.entries()).sort((a, b) => a[0] - b[0])) {
        const sittings = await tx.examSitting.findMany({
          where: { examDayId: day.id, level },
          select: {
            id: true, groupNo: true, panelJudgeIds: true,
            examiners: { select: { examinerId: true, examinerName: true } },
            _count: { select: { exams: true } },
          },
          orderBy: [{ groupNo: "asc" }, { createdAt: "asc" }],
        });
        let left = [...riderIds];
        // Fill the emptiest group first, so groups stay even.
        for (const s of [...sittings].sort((a, b) => a._count.exams - b._count.exams)) {
          const room = MAX_RIDERS_PER_SITTING - s._count.exams;
          if (room <= 0 || left.length === 0) continue;
          const take = left.slice(0, room);
          left = left.slice(room);
          const { rubric, time } = await sittingDefaults(tx, s.id, level, ladder, day.time);
          await addExamsToSittingTx(tx, {
            sittingId: s.id, centreId: day.centreId, level, date: day.date, time,
            riderIds: take, rubric, priorFails, panel: await panelOf(tx, s.panelJudgeIds),
          });
          await tx.examSitting.update({ where: { id: s.id }, data: { completedNotifiedAt: null } });
          out.push({ level, sittingId: s.id, group: s.groupNo, added: take.length, newSitting: false });
        }
        if (left.length === 0) continue;

        // Overflow, or a level new to the day: open sitting(s) for it.
        const poolIds = d.pools?.[String(level)] ?? sittings[0]?.examiners.map((x) => x.examinerId) ?? [];
        if (poolIds.length === 0) {
          throw new BookingError("POOL_REQUIRED", `Level ${level} isn't on this day yet — pick its examiners.`, 400);
        }
        const pool = await examinerPool(tx, session, day.centreId, poolIds, day.date);
        const panel = sittings[0] ? await panelOf(tx, sittings[0].panelJudgeIds) : [];
        // A level that becomes several groups numbers them; the original
        // single sitting becomes Group 1.
        const groups = splitIntoGroups(left, MAX_RIDERS_PER_SITTING);
        let next = Math.max(0, ...sittings.map((s) => s.groupNo ?? 0));
        if (sittings.length > 0 && next === 0) {
          await tx.examSitting.updateMany({ where: { id: { in: sittings.map((s) => s.id) } }, data: { groupNo: 1 } });
          next = 1;
        }
        const numbered = sittings.length > 0 || groups.length > 1;
        for (const ids of groups) {
          const group = numbered ? ++next : null;
          const id = await createSittingTx(tx, {
            centreId: day.centreId, level, date: day.date, time: day.time, examDayId: day.id,
            groupNo: group, holdResults: day.holdResults, pool, panel, riderIds: ids,
            rubric: ladder.byRank.get(level)!.categoriesJson, priorFails,
          });
          out.push({ level, sittingId: id, group, added: ids.length, newSitting: true });
        }
      }
      // Open riders again — the day's "all marked" summary is due again.
      await tx.examDay.update({ where: { id: day.id }, data: { completedNotifiedAt: null } });
      return out;
    });

    await audit({
      userId: session.userId,
      action: "exam.day_riders_added",
      tableName: "examDay",
      rowId: day.id,
      after: { entries: d.entries, placed, ...(skipped.length ? { skippedLevels: skipped } : {}) },
    });
    return NextResponse.json({ ok: true, added: d.entries.length, placed });
  } catch (e) {
    if (e instanceof BookingError) {
      return NextResponse.json({ error: e.code, message: e.message, details: e.details }, { status: e.status });
    }
    throw e;
  }
}
