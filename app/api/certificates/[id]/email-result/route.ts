// POST /api/certificates/[id]/email-result
//
// Manually emails the result breakdown to the parent. Replaces the auto-
// email that used to fire on exam submit, so staff control the moment of
// parent communication (review the score first, then click).
//
// Gated to: COACH, HEAD_COACH, CENTRE_MANAGER, ADMIN, SUPER_ADMIN.
// Cross-centre block: non-HQ users only on their own centre.
// Idempotency: re-clicking sends again (it's a Resend). The previous
// send's timestamp + sender are kept on Certificate.resultEmailSentAt /
// resultEmailSentBy and updated on each resend.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { blockIfFeatureOff } from "@/lib/features-gate";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { sendEmail, renderEmail } from "@/lib/email";
import { renderExamBreakdownHtml } from "@/lib/exam-email-breakdown";

const ALLOWED_ROLES = new Set([
  "SUPER_ADMIN",
  "ADMIN",
  "CENTRE_MANAGER",
  "HEAD_COACH",
  "COACH",
]);

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const featureBlock = await blockIfFeatureOff(session, "certificates");
  if (featureBlock) return featureBlock;
  if (!ALLOWED_ROLES.has(session.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const cert = await prisma.certificate.findUnique({
    where: { id: params.id },
    include: {
      rider: {
        select: { id: true, firstName: true, lastName: true, email: true },
      },
      centre: { select: { name: true } },
      exam: {
        select: {
          id: true,
          level: true,
          totalScore: true,
          scoresJson: true,
          rubricSnapshotJson: true,
          examinerName: true,
          date: true,
          centreId: true,
        },
      },
    },
  });
  if (!cert) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  // Cross-centre block. HQ (SUPER_ADMIN / ADMIN) bypass; everyone else
  // stays in their centre.
  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  if (!isHQ && cert.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  if (!cert.exam) {
    return NextResponse.json(
      { error: "NO_EXAM_LINKED", message: "This certificate is not linked to an exam (e.g. participation cert). Use a different surface." },
      { status: 409 },
    );
  }
  if (!cert.rider.email) {
    return NextResponse.json(
      { error: "NO_PARENT_EMAIL", message: "No email on file for this rider — add one on the rider profile first." },
      { status: 409 },
    );
  }

  // The rubric snapshot is what the examiner scored against. Fall back to
  // the live template for legacy exams that pre-date the snapshot column.
  let rubricJson = cert.exam.rubricSnapshotJson as unknown;
  if (!rubricJson) {
    const t = await prisma.scoringTemplate.findUnique({
      where: { centreId_levelKey: { centreId: cert.exam.centreId, levelKey: String(cert.exam.level) } },
      select: { categoriesJson: true },
    });
    rubricJson = t?.categoriesJson ?? null;
  }

  const scores =
    cert.exam.scoresJson && typeof cert.exam.scoresJson === "object" && !Array.isArray(cert.exam.scoresJson)
      ? (cert.exam.scoresJson as Record<string, number | string>)
      : {};
  const breakdown = renderExamBreakdownHtml(rubricJson, scores);
  const riderName = `${cert.rider.firstName} ${cert.rider.lastName}`;
  const examDate = cert.exam.date.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });

  await sendEmail({
    to: cert.rider.email,
    subject: `🎉 ${riderName} passed Level ${cert.exam.level}!`,
    html: renderEmail({
      centreName: cert.centre.name,
      heading: `Congratulations — Level ${cert.exam.level} passed!`,
      body: `<p>Dear Parent / Guardian,</p>
<p>We are delighted to report that <b>${riderName}</b> successfully passed the Level ${cert.exam.level} examination on <b>${examDate}</b> with a score of <b>${cert.exam.totalScore ?? "—"}</b>.</p>
<p>Examiner: <b>${cert.exam.examinerName}</b></p>
${breakdown}
<p>Certificate <span style="font-family:monospace">${cert.serialNo}</span> has been auto-issued and is ready for collection at the centre.</p>
<p>Well done ${cert.rider.firstName}! 🐎</p>`,
    }),
    ref: { type: "exam.passed.manual", rowId: cert.id, payload: { certId: cert.id, examId: cert.exam.id, riderId: cert.rider.id } },
  });

  await prisma.certificate.update({
    where: { id: cert.id },
    data: { resultEmailSentAt: new Date(), resultEmailSentBy: session.userId },
  });
  await audit({
    userId: session.userId,
    action: "certificate.email_result",
    tableName: "certificate",
    rowId: cert.id,
    after: { sentTo: cert.rider.email, examId: cert.exam.id },
  });

  return NextResponse.json({ ok: true, sentTo: cert.rider.email });
}
