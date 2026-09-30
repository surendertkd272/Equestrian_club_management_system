import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { centreFence } from "@/lib/authz-centre";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { audit } from "@/lib/audit";
import { BookingError, MAX_EXAMINERS_PER_POOL, examinerPool } from "@/lib/exam-booking";
import { OPEN_EXAM_STATUSES } from "@/lib/exam-schedule";

// Change a sitting's examiner pool after it's booked — the judges who pick
// riders from the queue. It was fixed at booking, so a judge who fell ill on
// the morning couldn't be replaced, and a spare judge couldn't be brought in
// when the queue ran long.
const addSchema = z.object({ examinerIds: z.array(z.string().min(1)).min(1).max(MAX_EXAMINERS_PER_POOL) });
const removeSchema = z.object({ examinerId: z.string().min(1) });

async function guard(id: string) {
  const session = await getSession();
  if (!session) return { error: NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 }) };
  if (!can(session.role, "exam.schedule")) return { error: NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }) };
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return { error: readOnlyBlock };
  const sitting = await prisma.examSitting.findUnique({
    where: { id },
    select: { id: true, centreId: true, date: true, panelJudgeIds: true, examiners: { select: { examinerId: true } } },
  });
  if (!sitting) return { error: NextResponse.json({ error: "NOT_FOUND" }, { status: 404 }) };
  const fence = await centreFence(session, sitting.centreId);
  if (fence) return { error: NextResponse.json({ error: fence }, { status: 403 }) };
  return { session, sitting };
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(params.id);
  if (g.error) return g.error;
  const { session, sitting } = g;
  const parsed = addSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
  const current = sitting.examiners.map((x) => x.examinerId);
  const fresh = Array.from(new Set(parsed.data.examinerIds)).filter((id) => !current.includes(id));
  try {
    if (current.length + fresh.length > MAX_EXAMINERS_PER_POOL) {
      throw new BookingError("POOL_FULL", `A sitting's pool holds at most ${MAX_EXAMINERS_PER_POOL} examiners.`, 400);
    }
    const onPanel = fresh.filter((id) => sitting.panelJudgeIds.includes(id));
    if (onPanel.length) {
      throw new BookingError(
        "JUDGE_ON_PANEL",
        "That judge sits on this sitting's jury panel (co-judging every rider). Take them off the panel first.",
        409,
      );
    }
    const users = await examinerPool(prisma, session, sitting.centreId, fresh, sitting.date);
    await prisma.examSittingExaminer.createMany({
      data: users.map((u) => ({ sittingId: sitting.id, examinerId: u.id, examinerName: u.name })),
      skipDuplicates: true,
    });
    await audit({
      userId: session.userId,
      action: "exam.sitting_pool_added",
      tableName: "examSitting",
      rowId: sitting.id,
      after: { examinerIds: users.map((u) => u.id) },
    });
    return NextResponse.json({ ok: true, added: users.length });
  } catch (e) {
    if (e instanceof BookingError) return NextResponse.json({ error: e.code, message: e.message }, { status: e.status });
    throw e;
  }
}

// Take an examiner out of the pool. Riders they picked but haven't marked go
// back to the queue. Riders they've started marking stay theirs until a
// manager hands them to another examiner — their marks are on that card.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(params.id);
  if (g.error) return g.error;
  const { session, sitting } = g;
  const parsed = removeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
  const { examinerId } = parsed.data;
  if (!sitting.examiners.some((x) => x.examinerId === examinerId)) {
    return NextResponse.json({ error: "NOT_IN_POOL" }, { status: 404 });
  }

  const claimed = await prisma.exam.findMany({
    where: { sittingId: sitting.id, examinerId, status: { in: OPEN_EXAM_STATUSES } },
    select: { id: true, scoresJson: true, leadSubmittedAt: true, rider: { select: { firstName: true, lastName: true } } },
  });
  const started = claimed.filter(
    (e) => e.leadSubmittedAt || (e.scoresJson && typeof e.scoresJson === "object" && Object.keys(e.scoresJson).length > 0),
  );
  if (started.length > 0) {
    return NextResponse.json(
      {
        error: "HAS_STARTED_CARDS",
        message: `They've started marking ${started.map((e) => `${e.rider.firstName} ${e.rider.lastName}`).join(", ")}. Hand ${started.length === 1 ? "that rider" : "those riders"} to another examiner from the exam page first.`,
      },
      { status: 409 },
    );
  }
  const stillOpen = await prisma.exam.count({ where: { sittingId: sitting.id, status: { in: OPEN_EXAM_STATUSES } } });
  if (sitting.examiners.length === 1 && stillOpen > 0) {
    return NextResponse.json(
      { error: "LAST_EXAMINER", message: "They're the only examiner and riders are still waiting — add another examiner first." },
      { status: 409 },
    );
  }
  const released = await prisma.$transaction(async (tx) => {
    const r = await tx.exam.updateMany({
      where: { id: { in: claimed.map((e) => e.id) }, examinerId, leadSubmittedAt: null },
      data: { examinerId: null, examinerName: null, status: "scheduled" },
    });
    await tx.examSittingExaminer.deleteMany({ where: { sittingId: sitting.id, examinerId } });
    return r.count;
  });
  await audit({
    userId: session.userId,
    action: "exam.sitting_pool_removed",
    tableName: "examSitting",
    rowId: sitting.id,
    before: { examinerId },
    after: { ridersReleased: released },
  });
  return NextResponse.json({ ok: true, ridersReleased: released });
}
