import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { centreFence } from "@/lib/authz-centre";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { audit } from "@/lib/audit";
import { ExamPanelError, lockExam, notifyIfSittingComplete } from "@/lib/exam-panel";
import { OPEN_EXAM_STATUSES } from "@/lib/exam-schedule";
import { appendToRunningOrderTx } from "@/lib/exam-running-order";

// Mark a rider absent — they didn't turn up — or undo it.
//
// A no-show could only be deleted, which left no record, and until someone
// did, the sitting and the day never finished: the manager's "all marked"
// summary never came. An absent rider now counts as done for the sitting,
// keeps their place on record, and is free to be booked onto another exam.
//
// Managers, and the examiners working the sitting (they're the ones standing
// in the arena when the rider doesn't come).
const schema = z.object({
  absent: z.boolean(),
  reason: z.string().trim().max(200).optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
  const d = parsed.data;

  const exam = await prisma.exam.findUnique({
    where: { id: params.id },
    select: {
      id: true, centreId: true, riderId: true, level: true, status: true, sittingId: true, examinerId: true,
      sitting: { select: { examDayId: true, examiners: { select: { examinerId: true } } } },
    },
  });
  if (!exam) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const fence = await centreFence(session, exam.centreId);
  if (fence) return NextResponse.json({ error: fence }, { status: 403 });
  const inPool = !!exam.sitting?.examiners.some((x) => x.examinerId === session.userId) || exam.examinerId === session.userId;
  if (!can(session.role, "exam.schedule") && !(session.role === "EXAMINER" && inPool)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  try {
    await prisma.$transaction(async (tx) => {
      const fresh = await lockExam(tx, exam.id);
      if (!fresh) throw new ExamPanelError("NOT_FOUND", "This exam no longer exists.", 404);
      if (d.absent) {
        if (!OPEN_EXAM_STATUSES.includes(fresh.status)) {
          throw new ExamPanelError("NOT_OPEN", `This exam is ${fresh.status.replaceAll("_", " ")}, so it can't be marked absent.`, 409);
        }
        const marked =
          !!fresh.leadSubmittedAt ||
          (fresh.scoresJson && typeof fresh.scoresJson === "object" && Object.keys(fresh.scoresJson).length > 0) ||
          fresh.judges.some((j) => j.submittedAt || (j.scoresJson && Object.keys(j.scoresJson as object).length > 0));
        if (marked || fresh.reopenedAt) {
          throw new ExamPanelError(
            "HAS_MARKS",
            "Marks have already been given on this exam, so the rider can't be marked absent. Reset the card first if they really didn't ride.",
            409,
          );
        }
        await tx.exam.update({
          where: { id: exam.id },
          data: { status: "absent", absentAt: new Date(), absentReason: d.reason || null, examinerId: null, examinerName: null },
        });
        // Their horse is free for someone else.
        await tx.horseAllocation.deleteMany({ where: { examId: exam.id } });
      } else {
        if (fresh.status !== "absent") throw new ExamPanelError("NOT_ABSENT", "This rider isn't marked absent.", 409);
        const rebooked = await tx.exam.findFirst({
          where: { riderId: exam.riderId, level: exam.level, status: { in: OPEN_EXAM_STATUSES }, id: { not: exam.id } },
          select: { date: true },
        });
        if (rebooked) {
          throw new ExamPanelError(
            "ALREADY_REBOOKED",
            `This rider has since been booked for Level ${exam.level} on ${rebooked.date.toISOString().slice(0, 10)} — remove that booking first.`,
            409,
          );
        }
        await tx.exam.update({ where: { id: exam.id }, data: { status: "scheduled", absentAt: null, absentReason: null } });
        // Their place went when they were marked absent (or a re-done order
        // passed them by): they ride next after everyone already in the order.
        if (exam.sittingId && fresh.runOrder === null) await appendToRunningOrderTx(tx, exam.sittingId, [exam.id]);
        // Open again, so the sitting's (and day's) summary is due again.
        if (exam.sittingId) await tx.examSitting.update({ where: { id: exam.sittingId }, data: { completedNotifiedAt: null } });
        if (exam.sitting?.examDayId) {
          await tx.examDay.update({ where: { id: exam.sitting.examDayId }, data: { completedNotifiedAt: null } });
        }
      }
    });
  } catch (e) {
    if (e instanceof ExamPanelError) return NextResponse.json({ error: e.code, message: e.message }, { status: e.status });
    throw e;
  }

  await audit({
    userId: session.userId,
    action: d.absent ? "exam.marked_absent" : "exam.absent_undone",
    tableName: "exam",
    rowId: exam.id,
    before: { status: exam.status },
    after: { status: d.absent ? "absent" : "scheduled", reason: d.reason ?? null },
  });
  // The last rider being absent can be what finishes the sitting.
  if (d.absent && exam.sittingId) {
    try {
      await notifyIfSittingComplete(exam.sittingId);
    } catch (err) {
      console.warn("[absent] sitting summary failed", err);
    }
  }
  return NextResponse.json({ ok: true, status: d.absent ? "absent" : "scheduled" });
}
