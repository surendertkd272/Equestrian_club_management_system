import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { getChildIfLinked } from "@/lib/parent";
import { notifyCentreManager } from "@/lib/notify";
import { REVIEW_WINDOW_DAYS } from "@/lib/exam-reopen";

// POST — a parent asks for their child's exam result to be looked at again.
// Families had no way to question a result except by phoning the club. The
// request lands with the centre manager, who reopens the exam for correction
// or declines with a reply the family sees on the child's page.
const schema = z.object({ reason: z.string().trim().min(10, "Tell the club what you'd like looked at (at least 10 characters).").max(1000) });

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (session.role !== "PARENT") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", message: parsed.error.issues[0]?.message }, { status: 400 });
  }
  // The exam's rider must be this parent's child (binds the child's org for RLS).
  const examRider = await findExamRider(params.id);
  if (!examRider) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const linked = await getChildIfLinked(session.userId, examRider.riderId);
  if (!linked) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const exam = await prisma.exam.findUnique({
    where: { id: params.id },
    select: { id: true, centreId: true, riderId: true, level: true, date: true, status: true, updatedAt: true },
  });
  if (!exam || exam.riderId !== examRider.riderId) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (exam.status !== "completed") {
    return NextResponse.json({ error: "NOT_COMPLETED", message: "This exam doesn't have a result yet." }, { status: 409 });
  }
  if (Date.now() - exam.date.getTime() > REVIEW_WINDOW_DAYS * 86400000) {
    return NextResponse.json(
      { error: "TOO_LATE", message: `Reviews can be asked for within ${REVIEW_WINDOW_DAYS} days of the exam. Please speak to the centre.` },
      { status: 409 },
    );
  }
  const open = await prisma.examReviewRequest.findFirst({ where: { examId: exam.id, status: "open" }, select: { id: true } });
  if (open) {
    return NextResponse.json({ error: "ALREADY_OPEN", message: "A review of this result has already been asked for." }, { status: 409 });
  }
  const row = await prisma.examReviewRequest.create({
    data: {
      centreId: exam.centreId,
      examId: exam.id,
      riderId: exam.riderId,
      requestedById: session.userId,
      reason: parsed.data.reason,
    },
  });
  await audit({ userId: session.userId, action: "exam.review_requested", tableName: "examReviewRequest", rowId: row.id, after: { examId: exam.id } });
  await notifyCentreManager(exam.centreId, {
    type: "exam.review_requested",
    title: `Review asked for: ${linked.rider.firstName} ${linked.rider.lastName}, Level ${exam.level}`,
    body: parsed.data.reason.slice(0, 200),
    link: `/exams/${exam.id}`,
  });
  return NextResponse.json({ ok: true, id: row.id });
}

// Which rider an exam belongs to, read before the org is bound (the parent's
// session carries no org of its own; getChildIfLinked binds the child's).
async function findExamRider(examId: string) {
  const { runWithRlsBypass } = await import("@/lib/tenant-context");
  return runWithRlsBypass(() => prisma.exam.findUnique({ where: { id: examId }, select: { riderId: true } }));
}
