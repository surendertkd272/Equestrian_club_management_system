import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { parseDateOnly } from "@/lib/schemas/attendance";
import { audit } from "@/lib/audit";

// Bulk-schedule a sitting: one date, one level, one examiner, N riders.
// Creates the ExamSitting row + a scheduled Exam per rider in a single
// transaction. Re-attempts (most recent failed exam at this level) are
// linked automatically.
const schema = z.object({
  level: z.coerce.number().int().min(1).max(10),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default("09:00"),
  examinerId: z.string().min(1),
  riderIds: z.array(z.string().min(1)).min(1).max(50),
  notes: z.string().max(500).optional(),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "exam.schedule")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  const examiner = await prisma.user.findUnique({
    where: { id: d.examinerId },
    select: { id: true, name: true, role: true, centreId: true, status: true },
  });
  if (!examiner || examiner.status !== "active") {
    return NextResponse.json({ error: "EXAMINER_NOT_FOUND" }, { status: 404 });
  }

  // Use the examiner's centre as the sitting's centre — falls back to the
  // session's centre when the examiner is SUPER_ADMIN with no fixed centre.
  const centreId = examiner.centreId ?? session.centreId;
  if (!centreId) return NextResponse.json({ error: "NO_CENTRE_CONTEXT" }, { status: 400 });
  if (session.role !== "SUPER_ADMIN" && centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  // All riders must belong to that centre.
  const riders = await prisma.rider.findMany({
    where: { id: { in: d.riderIds }, centreId },
    select: { id: true },
  });
  if (riders.length !== d.riderIds.length) {
    return NextResponse.json({ error: "RIDER_SCOPE_MISMATCH" }, { status: 400 });
  }

  const template = await prisma.scoringTemplate.findUnique({
    where: { centreId_levelKey: { centreId, levelKey: String(d.level) } },
  });
  if (!template) {
    return NextResponse.json({ error: "NO_TEMPLATE_FOR_LEVEL" }, { status: 400 });
  }

  // For re-attempt linking — load each rider's most recent failed exam at
  // this level in one go.
  const priorFails = await prisma.exam.findMany({
    where: {
      riderId: { in: riders.map((r) => r.id) },
      level: d.level,
      status: "completed",
      passed: false,
    },
    orderBy: { date: "desc" },
    select: { id: true, riderId: true, attemptNumber: true },
  });
  const priorByRider = new Map<string, { id: string; attemptNumber: number }>();
  for (const p of priorFails) {
    if (!priorByRider.has(p.riderId)) priorByRider.set(p.riderId, { id: p.id, attemptNumber: p.attemptNumber });
  }

  const sitting = await prisma.examSitting.create({
    data: {
      centreId,
      level: d.level,
      date: parseDateOnly(d.date),
      examinerId: examiner.id,
      examinerName: examiner.name,
      notes: d.notes,
    },
  });

  const examData = riders.map((r) => {
    const prior = priorByRider.get(r.id);
    return {
      centreId,
      riderId: r.id,
      examinerId: examiner.id,
      examinerName: examiner.name,
      level: d.level,
      date: parseDateOnly(d.date),
      time: d.time,
      status: "scheduled",
      sittingId: sitting.id,
      previousExamId: prior?.id ?? null,
      attemptNumber: prior ? prior.attemptNumber + 1 : 1,
    };
  });
  await prisma.exam.createMany({ data: examData });

  await audit({
    userId: session.userId,
    action: "exam.sitting_created",
    tableName: "examSitting",
    rowId: sitting.id,
    after: { level: d.level, date: d.date, time: d.time, riderCount: riders.length },
  });

  return NextResponse.json({ id: sitting.id, examsCreated: riders.length });
}
