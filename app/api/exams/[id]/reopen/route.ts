import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { centreFence } from "@/lib/authz-centre";
import { getSession } from "@/lib/auth";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { ExamPanelError, isExamManager } from "@/lib/exam-panel";
import { reopenExam } from "@/lib/exam-reopen";

const schema = z.object({
  reason: z.string().trim().min(5, "Say why the result needs correcting (at least 5 characters).").max(300),
});

// Reopen a completed exam so a mistake in the marks can be corrected.
//
// A completed exam used to be final for everyone, Super Admin included: a
// mis-tapped score or the wrong rider's card could only be "fixed" by revoking
// the certificate and booking a whole new sitting, which recorded a fake
// second attempt. Reopening unlocks every card on the panel (marks are kept,
// so judges correct rather than re-mark from scratch) and the exam completes
// again through the normal path when the last card is re-submitted. The
// certificate stays as it is until then: kept if the corrected result is still
// a pass, revoked if it is not (lib/exam-panel.ts).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!isExamManager(session.role)) {
    return NextResponse.json(
      { error: "FORBIDDEN", message: "Only a centre manager or HQ admin can reopen a completed exam." },
      { status: 403 },
    );
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Give a reason for reopening.";
    return NextResponse.json({ error: "VALIDATION", message }, { status: 400 });
  }

  const exam = await prisma.exam.findUnique({ where: { id: params.id }, select: { id: true, centreId: true } });
  if (!exam) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const fence = await centreFence(session, exam.centreId);
  if (fence) {
    return NextResponse.json({ error: fence }, { status: 403 });
  }

  try {
    await reopenExam(session, exam.id, parsed.data.reason);
  } catch (e) {
    if (e instanceof ExamPanelError) {
      return NextResponse.json({ error: e.code, message: e.message }, { status: e.status });
    }
    throw e;
  }

  return NextResponse.json({ ok: true });
}
