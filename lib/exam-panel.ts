import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { computeTotal, parseRubric, type RubricCategory } from "@/lib/schemas/exam";
import { generateUniqueSerial, verifyUrl } from "@/lib/cert";
import { hasBaseUrl } from "@/lib/absolute-url";
import { revokeCertificate } from "@/lib/certificate-revoke";
import { audit } from "@/lib/audit";
import { notify, notifyCentreManager, notifyRiderAndParents } from "@/lib/notify";
import { sendSms } from "@/lib/sms";
import { sendWhatsApp } from "@/lib/whatsapp";

// ─── The exam jury panel ────────────────────────────────────────────────────
// An exam is marked on one or more CARDS: the lead examiner's (stored on
// Exam.scoresJson, locked by Exam.leadSubmittedAt) and one per co-judge
// (ExamJudge rows, locked by submittedAt). Each judge locks their own card.
// The exam completes — result, pass/fail, certificate, promotion, parent
// messages — only when the LAST card on the panel is locked.
//
// It used to complete on whichever card was submitted first, averaging in the
// other judges' half-finished drafts and then locking them out of their own
// cards. Everything that decides the result lives here so the score route and
// the "remove a co-judge" route cannot drift apart.

type Tx = Prisma.TransactionClient;
export type ScoreMap = Record<string, number | string>;

// Roles that act on an exam on the examiners' behalf: mark any card, reopen a
// completed exam for correction.
export const EXAM_MANAGER_ROLES: readonly string[] = ["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER"];
export function isExamManager(role: string): boolean {
  return EXAM_MANAGER_ROLES.includes(role);
}

// A refusal raised inside a transaction. Throwing rolls the whole transaction
// back; the route turns it into a JSON response.
export class ExamPanelError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export function asScoreMap(v: unknown): ScoreMap | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as ScoreMap;
}

// Lock the exam row for the rest of the transaction, then read it fresh.
// Two judges pressing Submit at the same moment must be serialised, or both
// see the other's card as unlocked and neither completes the exam.
export async function lockExam(tx: Tx, examId: string) {
  await tx.$queryRaw`SELECT id FROM "Exam" WHERE id = ${examId} FOR UPDATE`;
  return tx.exam.findUnique({
    where: { id: examId },
    include: { judges: { orderBy: { position: "asc" } } },
  });
}
export type LockedExam = NonNullable<Awaited<ReturnType<typeof lockExam>>>;

type PanelState = {
  examinerName: string | null;
  scoresJson: unknown;
  leadSubmittedAt: Date | null;
  judges: { judgeName: string; subTotal: number | null; submittedAt: Date | null }[];
};

// Names of the judges whose card is not locked yet.
export function pendingCards(exam: PanelState): string[] {
  const out: string[] = [];
  if (!exam.leadSubmittedAt) out.push(exam.examinerName ?? "Lead examiner");
  for (const j of exam.judges) if (!j.submittedAt) out.push(j.judgeName);
  return out;
}

// Mean rubric total across the cards that carry marks. Before completion this
// is a provisional figure for the lists; at completion every card is locked.
// The lead's subtotal is recomputed from their score map rather than read
// from Exam.totalScore, which already has deductions applied.
export function panelAggregate(rubric: RubricCategory[], exam: PanelState): number {
  const subtotals: number[] = [];
  const lead = asScoreMap(exam.scoresJson);
  if (exam.leadSubmittedAt || (lead && Object.keys(lead).length > 0)) {
    subtotals.push(computeTotal(rubric, lead ?? {}).total);
  }
  for (const j of exam.judges) if (typeof j.subTotal === "number") subtotals.push(j.subTotal);
  return subtotals.length > 0 ? subtotals.reduce((s, v) => s + v, 0) / subtotals.length : 0;
}

export function adjustedTotal(aggregate: number, deductions: number, timeFaults: number): number {
  return Math.max(0, aggregate - deductions - timeFaults);
}

export type FinalizeResult = {
  total: number;
  max: number;
  passed: boolean | null;
  certificateId: string | null;
  certificateMinted: boolean;
  // Set only when this completion minted the certificate.
  certificateSerial: string | null;
  levelName: string;
  revokedCertificateIds: string[];
};

// Complete the exam if every card on its panel is locked; otherwise null.
// Must run inside the caller's transaction on a row taken with lockExam(), so
// the result, the certificate and the promotion commit together or not at all.
export async function completeIfPanelDone(
  tx: Tx,
  exam: LockedExam,
  actorUserId: string,
): Promise<FinalizeResult | null> {
  if (exam.status === "completed") return null;
  if (pendingCards(exam).length > 0) return null;

  const template = await tx.scoringTemplate.findUnique({
    where: { centreId_levelKey: { centreId: exam.centreId, levelKey: String(exam.level) } },
  });
  if (!template) {
    throw new ExamPanelError("NO_TEMPLATE_FOR_LEVEL", `There is no scoring template for Level ${exam.level}.`, 400);
  }
  const rubric = parseRubric(exam.rubricSnapshotJson ?? template.categoriesJson);
  const { max } = computeTotal(rubric, {});
  const total = adjustedTotal(panelAggregate(rubric, exam), exam.deductions, exam.timeFaults);
  const passed = max > 0 ? total / max >= template.passThreshold / 100 : null;

  await tx.exam.update({
    where: { id: exam.id },
    data: { status: "completed", totalScore: total, passed },
  });

  let certificateId: string | null = null;
  let certificateMinted = false;
  let certificateSerial: string | null = null;
  const revokedCertificateIds: string[] = [];

  if (passed === true) {
    // One live certificate per rider per level. Re-marking an exam, or sitting
    // the same level twice, used to mint a second serial — and both then
    // verified as authentic on the public page. A revoked one does not count,
    // so a legitimate re-sit after revocation still issues.
    const alreadyHeld = await tx.certificate.findFirst({
      where: { riderId: exam.riderId, levelName: template.levelName, type: "promotion", revokedAt: null },
      select: { id: true },
    });
    if (alreadyHeld) {
      certificateId = alreadyHeld.id;
    } else {
      // Thrown inside the transaction, so the result rolls back with it
      // rather than leaving a pass on record with no certificate behind it.
      if (!hasBaseUrl()) {
        throw new ExamPanelError(
          "NO_PUBLIC_URL",
          "No public site address is configured (NEXT_PUBLIC_APP_URL), so this certificate's QR code would be unscannable. Set it, then submit again — nothing was saved.",
          503,
        );
      }
      const serial = await generateUniqueSerial(exam.level);
      const cert = await tx.certificate.create({
        data: {
          centreId: exam.centreId,
          riderId: exam.riderId,
          examId: exam.id,
          type: "promotion",
          levelName: template.levelName,
          serialNo: serial,
          qrCode: verifyUrl(serial),
          signedBy: actorUserId,
        },
      });
      await tx.rider.update({
        where: { id: exam.riderId },
        data: { currentLevel: template.levelName },
      });
      certificateId = cert.id;
      certificateMinted = true;
      certificateSerial = serial;
    }
  } else if (passed === false) {
    // An exam reopened for correction and re-marked as not passed must not
    // leave the certificate its first result issued still verifying as live.
    const live = await tx.certificate.findMany({
      where: { examId: exam.id, type: "promotion", revokedAt: null },
      select: { id: true, type: true, levelName: true, riderId: true },
    });
    for (const c of live) {
      await revokeCertificate(tx, c, actorUserId, "Exam re-marked after correction — did not pass");
      revokedCertificateIds.push(c.id);
    }
  }

  return {
    total,
    max,
    passed,
    certificateId,
    certificateMinted,
    certificateSerial,
    levelName: template.levelName,
    revokedCertificateIds,
  };
}

// Audit + notify for a completed exam. Runs AFTER the transaction commits —
// a slow SMS gateway must never hold the exam row lock, and a failed message
// must never turn a recorded result into a 500.
export async function afterExamCompleted(
  exam: {
    id: string;
    centreId: string;
    riderId: string;
    level: number;
    examinerId: string | null;
    examinerName: string | null;
    reopenedAt: Date | null;
  },
  r: FinalizeResult,
  actorUserId: string,
): Promise<void> {
  if (r.certificateMinted && r.certificateId) {
    await audit({
      userId: actorUserId,
      action: "certificate.auto_issue",
      tableName: "certificate",
      rowId: r.certificateId,
      after: { serial: r.certificateSerial, levelName: r.levelName, riderId: exam.riderId, examId: exam.id },
    });
  }
  for (const id of r.revokedCertificateIds) {
    await audit({
      userId: actorUserId,
      action: "certificate.revoke",
      tableName: "certificate",
      rowId: id,
      after: { reason: "Exam re-marked after correction — did not pass", examId: exam.id },
    });
  }
  try {
    await sendResultNotifications(exam, r);
  } catch (err) {
    console.warn("[exam-panel] result notifications failed:", err);
  }
}

async function sendResultNotifications(
  exam: Parameters<typeof afterExamCompleted>[0],
  r: FinalizeResult,
): Promise<void> {
  const { total, max, passed } = r;
  // A corrected result tells people it changed, and only re-sends the
  // congratulations SMS when the correction actually produced a new pass.
  const corrected = exam.reopenedAt !== null;
  const rider = await prisma.rider.findUnique({
    where: { id: exam.riderId },
    select: { firstName: true, lastName: true, mobile: true, fatherPhone: true, motherPhone: true },
  });
  const riderName = rider ? `${rider.firstName} ${rider.lastName}` : "Rider";
  const parentPhone = rider?.fatherPhone ?? rider?.motherPhone ?? rider?.mobile;

  if (passed === true) {
    await notifyCentreManager(exam.centreId, {
      type: "exam.passed",
      title: corrected
        ? `${riderName}'s Level ${exam.level} result was corrected — passed`
        : `${riderName} passed Level ${exam.level}`,
      body: corrected
        ? `Re-marked ${total} / ${max}. ${r.certificateMinted ? "Certificate issued." : "The existing certificate stands."}`
        : `Examiner ${exam.examinerName} submitted ${total} / ${max}. Certificate auto-issued.`,
      link: `/exams/${exam.id}`,
      payload: { examId: exam.id, riderId: exam.riderId, totalScore: total, max },
    });
    // In-app notification to the rider (student portal) and every linked parent.
    await notifyRiderAndParents(exam.riderId, {
      centreId: exam.centreId,
      type: "exam.passed",
      title:
        corrected && !r.certificateMinted
          ? `${riderName}'s Level ${exam.level} result was updated`
          : `🎉 ${riderName} passed Level ${exam.level}`,
      body:
        corrected && !r.certificateMinted
          ? `Score ${total} / ${max}. Still a pass — the certificate stands.`
          : `Score ${total} / ${max}. Certificate is being issued.`,
      link: `/parent/${exam.riderId}`,
      payload: { examId: exam.id, totalScore: total, max },
    });
    // Parent SMS + WhatsApp — the headline good-news moment. Parent email is
    // NOT sent here: staff trigger it from the certificate so they can review
    // the score before parents see it.
    if (parentPhone && (!corrected || r.certificateMinted)) {
      await sendSms({
        to: parentPhone,
        body: `Congratulations! ${riderName} passed Level ${exam.level} with ${total}/${max}. Certificate ready for collection. — Equiwings`,
        ref: { type: "exam.passed", rowId: exam.id, payload: { riderId: exam.riderId } },
      });
      await sendWhatsApp({
        to: parentPhone,
        centreId: exam.centreId,
        template: {
          name: "ew_exam_passed",
          bodyParams: [riderName, String(exam.level), String(total), String(max)],
        },
        previewBody: `${riderName} passed Level ${exam.level} with ${total}/${max}`,
        ref: { type: "exam.passed", rowId: exam.id, payload: { riderId: exam.riderId } },
      });
    }
  } else {
    await notifyCentreManager(exam.centreId, {
      type: "exam.failed",
      title: corrected
        ? `${riderName}'s Level ${exam.level} result was corrected — did not pass`
        : `${riderName} did not pass Level ${exam.level}`,
      body:
        `Score ${total} / ${max}. Coach can re-schedule.` +
        (r.revokedCertificateIds.length > 0 ? " The certificate from the earlier result was revoked." : ""),
      link: `/exams/${exam.id}`,
      payload: { examId: exam.id, riderId: exam.riderId, totalScore: total, max },
    });
    // No "you failed" SMS — the coach delivers that in person. Parents get a
    // softer in-app message so they're informed without an SMS ping.
    await notifyRiderAndParents(exam.riderId, {
      centreId: exam.centreId,
      type: "exam.not_passed",
      title: corrected
        ? `${riderName}'s Level ${exam.level} result was updated`
        : `${riderName}'s Level ${exam.level} result is in`,
      body: `Your coach will follow up on next steps.`,
      link: `/parent/${exam.riderId}`,
      payload: { examId: exam.id },
    });
  }
  if (exam.examinerId) {
    await notify({
      userId: exam.examinerId,
      centreId: exam.centreId,
      type: passed ? "exam.passed" : "exam.failed",
      title: `Exam submitted — ${passed ? "PASS" : "FAIL"}`,
      body: `${riderName} · Level ${exam.level} · ${total}/${max}`,
      link: `/exams/${exam.id}`,
    });
  }
}
