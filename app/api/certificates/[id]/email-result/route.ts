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
import { centreFence } from "@/lib/authz-centre";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { blockIfFeatureOff } from "@/lib/features-gate";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { RESULT_RECIPIENT_SELECT } from "@/lib/result-recipients";
import { sendExamResultEmail } from "@/lib/result-email";

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
        select: { id: true, firstName: true, lastName: true, ...RESULT_RECIPIENT_SELECT },
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
  // isHQ alone let an HQ caller of ANY organisation through. centreFence
  // keeps the centre rule and adds the org rule HQ never had.
  const fence = await centreFence(session, cert.centreId);
  if (fence) {
    return NextResponse.json({ error: fence }, { status: 403 });
  }

  if (!cert.exam) {
    return NextResponse.json(
      { error: "NO_EXAM_LINKED", message: "This certificate is not linked to an exam (e.g. participation cert). Use a different surface." },
      { status: 409 },
    );
  }
  const r = await sendExamResultEmail(cert.exam.id, session.userId);
  if (!r.ok) {
    return NextResponse.json({ error: r.code, message: r.message }, { status: r.code === "NOT_FOUND" ? 404 : 409 });
  }
  const recipients = r.sentTo;

  await audit({
    userId: session.userId,
    action: "certificate.email_result",
    tableName: "certificate",
    rowId: cert.id,
    after: { sentTo: recipients, examId: cert.exam.id },
  });

  return NextResponse.json({ ok: true, sentTo: recipients.join(", ") });
}
