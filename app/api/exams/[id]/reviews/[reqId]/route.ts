import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { centreFence } from "@/lib/authz-centre";
import { getSession } from "@/lib/auth";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { ExamPanelError, isExamManager } from "@/lib/exam-panel";
import { reopenExam } from "@/lib/exam-reopen";

// Decide a family's review request: reopen the exam for correction (the
// normal reopen, with their request as the reason) or decline with a reply.
// Either way the family is told, on the child's page.
const schema = z.object({
  action: z.enum(["reopen", "decline"]),
  response: z.string().trim().max(1000).optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string; reqId: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!isExamManager(session.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
  const d = parsed.data;
  if (d.action === "decline" && !d.response) {
    return NextResponse.json({ error: "VALIDATION", message: "Tell the family why the result stands." }, { status: 400 });
  }
  const request = await prisma.examReviewRequest.findUnique({
    where: { id: params.reqId },
    include: { exam: { select: { id: true, centreId: true, level: true, riderId: true } } },
  });
  if (!request || request.examId !== params.id) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const fence = await centreFence(session, request.exam.centreId);
  if (fence) return NextResponse.json({ error: fence }, { status: 403 });
  if (request.status !== "open") {
    return NextResponse.json({ error: "ALREADY_DECIDED", message: "This request has already been answered." }, { status: 409 });
  }

  if (d.action === "reopen") {
    try {
      await reopenExam(session, request.examId, `Review requested by the family: ${request.reason}`.slice(0, 300));
    } catch (e) {
      if (e instanceof ExamPanelError) return NextResponse.json({ error: e.code, message: e.message }, { status: e.status });
      throw e;
    }
  }
  const claimed = await prisma.examReviewRequest.updateMany({
    where: { id: request.id, status: "open" },
    data: {
      status: d.action === "reopen" ? "reopened" : "declined",
      response: d.response || null,
      decidedById: session.userId,
      decidedAt: new Date(),
    },
  });
  if (claimed.count === 0) {
    return NextResponse.json({ error: "ALREADY_DECIDED", message: "This request has already been answered." }, { status: 409 });
  }
  await audit({
    userId: session.userId,
    action: d.action === "reopen" ? "exam.review_reopened" : "exam.review_declined",
    tableName: "examReviewRequest",
    rowId: request.id,
    after: { examId: request.examId, response: d.response ?? null },
  });
  await notify({
    userId: request.requestedById,
    centreId: request.exam.centreId,
    type: "exam.review_decided",
    title:
      d.action === "reopen"
        ? `The Level ${request.exam.level} result is being reviewed`
        : `Your review request for Level ${request.exam.level} was answered`,
    body:
      d.action === "reopen"
        ? `The judges are re-checking their marks${d.response ? ` — ${d.response}` : ""}. You'll see the corrected result on the child's page.`
        : d.response!,
    link: `/parent/${request.exam.riderId}`,
  });
  return NextResponse.json({ ok: true, status: d.action === "reopen" ? "reopened" : "declined" });
}
