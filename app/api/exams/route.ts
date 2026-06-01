import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { createExamSchema } from "@/lib/schemas/exam";
import { parseDateOnly } from "@/lib/schemas/attendance";
import { audit } from "@/lib/audit";
import { blockIfFeatureOff } from "@/lib/features-gate";
import { blockIfReadOnly } from "@/lib/readonly-gate";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "exam.schedule")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const featureBlock = await blockIfFeatureOff(session, "external-exams");
  if (featureBlock) return featureBlock;
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = createExamSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  const rider = await prisma.rider.findUnique({
    where: { id: d.riderId },
    select: { id: true, centreId: true, firstName: true, lastName: true },
  });
  if (!rider) return NextResponse.json({ error: "RIDER_NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && rider.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  const examiner = await prisma.user.findUnique({
    where: { id: d.examinerId },
    select: { id: true, name: true, role: true, centreId: true, status: true },
  });
  if (!examiner || examiner.status !== "active") {
    return NextResponse.json({ error: "EXAMINER_NOT_FOUND" }, { status: 404 });
  }
  if (!["EXAMINER", "JURY", "HEAD_COACH", "CENTRE_MANAGER", "COACH", "SUPER_ADMIN"].includes(examiner.role)) {
    return NextResponse.json({ error: "INVALID_EXAMINER_ROLE" }, { status: 400 });
  }
  if (examiner.role !== "SUPER_ADMIN" && examiner.centreId !== rider.centreId) {
    return NextResponse.json({ error: "EXAMINER_CROSS_CENTRE" }, { status: 400 });
  }

  // Template must exist for the level (otherwise scoring is impossible).
  const template = await prisma.scoringTemplate.findUnique({
    where: { centreId_levelKey: { centreId: rider.centreId, levelKey: String(d.level) } },
  });
  if (!template) {
    return NextResponse.json(
      { error: "NO_TEMPLATE_FOR_LEVEL", message: `No scoring template defined for Level ${d.level}.` },
      { status: 400 },
    );
  }

  // Block parallel attempts — if the rider already has a scheduled or
  // in-progress exam at this level, refuse rather than create a second
  // one. Otherwise an admin who double-clicks "Schedule" or forgets to
  // cancel the old draft ends up with two open exams to score.
  const pending = await prisma.exam.findFirst({
    where: {
      riderId: rider.id,
      level: d.level,
      status: { in: ["scheduled", "in_progress"] },
    },
    select: { id: true, status: true, date: true },
  });
  if (pending) {
    return NextResponse.json(
      {
        error: "EXAM_ALREADY_OPEN",
        message: `${rider.firstName} already has a ${pending.status} Level ${d.level} exam on ${pending.date.toISOString().slice(0, 10)}. Complete or cancel it before scheduling another.`,
        detail: { existingExamId: pending.id, status: pending.status },
      },
      { status: 409 },
    );
  }

  // Detect a re-attempt: most recent failed exam at the same level for the
  // same rider. Link via previousExamId so the result sheet can show
  // "Attempt 2" and the scorer surfaces the prior result.
  const lastFailed = await prisma.exam.findFirst({
    where: { riderId: rider.id, level: d.level, status: "completed", passed: false },
    orderBy: { date: "desc" },
    select: { id: true, attemptNumber: true },
  });

  // Freeze the centre's current rubric onto the exam so edits to the
  // canonical ScoringTemplate later don't garble this exam's historical
  // breakdown. Falls back to ExamLevel.defaultRubricJson if the centre
  // has no template yet (rare — bootstrap seeds one per centre on
  // creation). Null if neither exists; reader paths handle that.
  const tpl = await prisma.scoringTemplate.findUnique({
    where: { centreId_levelKey: { centreId: rider.centreId, levelKey: String(d.level) } },
    select: { categoriesJson: true },
  });
  const fallback = !tpl
    ? await prisma.examLevel.findFirst({
        where: { discipline: "general", code: String(d.level) },
        select: { defaultRubricJson: true },
      })
    : null;
  const rubricSnapshot = tpl?.categoriesJson ?? fallback?.defaultRubricJson ?? null;

  const exam = await prisma.exam.create({
    data: {
      centreId: rider.centreId,
      riderId: rider.id,
      examinerId: examiner.id,
      examinerName: examiner.name,
      level: d.level,
      date: parseDateOnly(d.date),
      time: d.time,
      status: "scheduled",
      previousExamId: lastFailed?.id ?? null,
      attemptNumber: lastFailed ? lastFailed.attemptNumber + 1 : 1,
      rubricSnapshotJson: rubricSnapshot as Prisma.InputJsonValue,
    },
  });

  await audit({
    userId: session.userId,
    action: "exam.schedule",
    tableName: "exam",
    rowId: exam.id,
    after: { riderId: rider.id, examinerId: examiner.id, level: d.level, date: d.date, time: d.time },
  });

  return NextResponse.json({ id: exam.id });
}
