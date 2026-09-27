import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { centreFence } from "@/lib/authz-centre";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { parseDateOnly } from "@/lib/schemas/attendance";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import {
  BookingError,
  MAX_EXAMINERS_PER_POOL,
  MAX_RIDERS_PER_SITTING,
  checkBookings,
  createSittingTx,
  examinerPool,
} from "@/lib/exam-booking";

// Bulk-schedule a sitting: one date + level, N riders, and a POOL of examiners.
// Creates the ExamSitting + the examiner pool (ExamSittingExaminer) + one
// scheduled Exam per rider, all UNASSIGNED. Any examiner in the pool then
// "claims" a rider from the sitting (see /api/exams/[id]/claim) to mark it —
// first-come, locked to them. Re-attempts are linked automatically. One txn.
// Booking rules (who may sit, level order, double-booking) live in
// lib/exam-booking.ts, shared with whole exam days (/api/exam-days).
const schema = z.object({
  level: z.coerce.number().int().min(1).max(10),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default("09:00"),
  examinerIds: z.array(z.string().min(1)).min(1).max(MAX_EXAMINERS_PER_POOL),
  riderIds: z.array(z.string().min(1)).min(1).max(MAX_RIDERS_PER_SITTING),
  notes: z.string().max(500).optional(),
  // Set after the scheduler confirmed booking riders past the next level up.
  allowSkipLevels: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "exam.schedule")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const block = await blockIfReadOnly(session);
  if (block) return block;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  try {
    // Sitting centre = the session's centre, or (for HQ) the pool's shared centre.
    const probe = await prisma.user.findMany({
      where: { id: { in: d.examinerIds } },
      select: { centreId: true },
    });
    const centreId = session.centreId ?? probe.find((u) => u.centreId)?.centreId ?? null;
    if (!centreId) return NextResponse.json({ error: "NO_CENTRE_CONTEXT" }, { status: 400 });
    const fence = await centreFence(session, centreId);
    if (fence) return NextResponse.json({ error: fence }, { status: 403 });

    const examDate = parseDateOnly(d.date);
    const pool = await examinerPool(prisma, session, centreId, d.examinerIds, examDate);
    const riderIds = Array.from(new Set(d.riderIds));
    const { ladder, priorFails, skipped } = await checkBookings(prisma, {
      centreId,
      entries: riderIds.map((riderId) => ({ riderId, level: d.level })),
      allowSkipLevels: d.allowSkipLevels,
    });
    const template = ladder.byRank.get(d.level)!;

    const sittingId = await prisma.$transaction((tx) =>
      createSittingTx(tx, {
        centreId,
        level: d.level,
        date: examDate,
        time: d.time,
        notes: d.notes,
        pool,
        riderIds,
        rubric: template.categoriesJson,
        priorFails,
      }),
    );

    await audit({
      userId: session.userId,
      action: "exam.sitting_created",
      tableName: "examSitting",
      rowId: sittingId,
      after: {
        level: d.level,
        date: d.date,
        time: d.time,
        riderCount: riderIds.length,
        examinerCount: pool.length,
        ...(skipped.length ? { skippedLevels: skipped } : {}),
      },
    });
    return NextResponse.json({ id: sittingId, examsCreated: riderIds.length });
  } catch (e) {
    if (e instanceof BookingError) {
      return NextResponse.json({ error: e.code, message: e.message, details: e.details }, { status: e.status });
    }
    throw e;
  }
}
