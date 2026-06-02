import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { parseDateOnly } from "@/lib/schemas/attendance";
import { audit } from "@/lib/audit";

// Bulk-schedule a sitting: one date + level, N riders, and a PANEL of examiners
// (first id = lead). Creates the ExamSitting + a scheduled Exam per rider, and
// attaches every panel examiner to every exam (lead implicit at position 1,
// co-examiners as ExamJudge rows at positions 2+, mirroring the judges panel).
// Re-attempts (most recent failed exam at this level) are linked automatically.
// All in one transaction.
const ALLOWED_EXAMINER_ROLES = new Set([
  "EXAMINER", "JURY", "HEAD_COACH", "CENTRE_MANAGER", "COACH", "SUPER_ADMIN", "ADMIN",
]);
const schema = z.object({
  level: z.coerce.number().int().min(1).max(10),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default("09:00"),
  // First id = lead examiner; the rest are co-examiners on the panel.
  examinerIds: z.array(z.string().min(1)).min(1).max(8),
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

  // Resolve the panel — first id is the lead examiner, the rest co-examiners.
  const examinerIds = Array.from(new Set(d.examinerIds));
  const leadId = examinerIds[0];
  const examinerUsers = await prisma.user.findMany({
    where: { id: { in: examinerIds }, status: "active" },
    select: { id: true, name: true, role: true, centreId: true },
  });
  if (examinerUsers.length !== examinerIds.length) {
    return NextResponse.json({ error: "EXAMINER_NOT_FOUND" }, { status: 404 });
  }
  if (examinerUsers.some((u) => !ALLOWED_EXAMINER_ROLES.has(u.role))) {
    return NextResponse.json({ error: "INVALID_EXAMINER_ROLE" }, { status: 400 });
  }
  const lead = examinerUsers.find((u) => u.id === leadId)!;
  const examinerNameById = new Map(examinerUsers.map((u) => [u.id, u.name]));

  // Sitting centre = lead's centre (falls back to session centre for HQ leads).
  const centreId = lead.centreId ?? session.centreId;
  if (!centreId) return NextResponse.json({ error: "NO_CENTRE_CONTEXT" }, { status: 400 });
  if (session.role !== "SUPER_ADMIN" && centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }
  // Every panel examiner must share the centre unless a SUPER_ADMIN is staffing
  // across centres.
  if (session.role !== "SUPER_ADMIN" && examinerUsers.some((u) => u.centreId && u.centreId !== centreId)) {
    return NextResponse.json({ error: "EXAMINER_CROSS_CENTRE" }, { status: 400 });
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

  const examDate = parseDateOnly(d.date);
  const coExaminerIds = examinerIds.slice(1); // panel co-judges (lead implicit at pos 1)

  const { sittingId, examsCreated } = await prisma.$transaction(async (tx) => {
    const sitting = await tx.examSitting.create({
      data: {
        centreId,
        level: d.level,
        date: examDate,
        examinerId: leadId,
        examinerName: lead.name,
        notes: d.notes,
      },
    });

    await tx.exam.createMany({
      data: riders.map((r) => {
        const prior = priorByRider.get(r.id);
        return {
          centreId,
          riderId: r.id,
          examinerId: leadId,
          examinerName: lead.name,
          level: d.level,
          date: examDate,
          time: d.time,
          status: "scheduled",
          sittingId: sitting.id,
          previousExamId: prior?.id ?? null,
          attemptNumber: prior ? prior.attemptNumber + 1 : 1,
        };
      }),
    });

    // Attach co-examiners to every exam (lead stays implicit at position 1;
    // co-judges take positions 2…N), the same shape the judges panel produces.
    if (coExaminerIds.length > 0) {
      const created = await tx.exam.findMany({
        where: { sittingId: sitting.id },
        select: { id: true },
      });
      const judgeRows = created.flatMap((ex) =>
        coExaminerIds.map((jid, idx) => ({
          examId: ex.id,
          judgeId: jid,
          judgeName: examinerNameById.get(jid)!,
          position: idx + 2,
        })),
      );
      await tx.examJudge.createMany({ data: judgeRows });
    }

    return { sittingId: sitting.id, examsCreated: riders.length };
  });

  await audit({
    userId: session.userId,
    action: "exam.sitting_created",
    tableName: "examSitting",
    rowId: sittingId,
    after: { level: d.level, date: d.date, time: d.time, riderCount: examsCreated, examinerCount: examinerIds.length },
  });

  return NextResponse.json({ id: sittingId, examsCreated });
}
