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

// Roles that may be seated on an exam jury. Examiners are the point of the
// role; senior coaching staff and centre management routinely co-judge at
// club level. Everyone else — grooms, farriers, vets, accountants, inventory,
// school observers, inspection officers, riders, parents — must not appear on
// a jury panel, because that panel is printed on the result sheet.
//
// Every role here must hold exam.score. The exam completes only when every
// card on the panel is submitted, so a judge who cannot open the scorer (a
// plain COACH could be seated but never mark) would hold the exam open forever.
export const JUDGE_ELIGIBLE_ROLES: readonly string[] = [
  "EXAMINER",
  "HEAD_COACH",
  "CENTRE_MANAGER",
  "ADMIN",
  "SUPER_ADMIN",
];

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
  // Per revoked certificate: the level the rider was rolled back to (undefined = untouched).
  revokedLevelRollback: (string | null | undefined)[];
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
  const revokedLevelRollback: (string | null | undefined)[] = [];

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
      revokedLevelRollback.push(await revokeCertificate(tx, c, actorUserId, "Exam re-marked after correction — did not pass"));
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
    revokedLevelRollback,
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
    sittingId: string | null;
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
  for (const [i, id] of r.revokedCertificateIds.entries()) {
    const rolledBackTo = r.revokedLevelRollback[i];
    await audit({
      userId: actorUserId,
      action: "certificate.revoke",
      tableName: "certificate",
      rowId: id,
      after: {
        reason: "Exam re-marked after correction — did not pass",
        examId: exam.id,
        ...(rolledBackTo !== undefined
          ? { riderLevelRolledBackFrom: r.levelName, riderLevelRolledBackTo: rolledBackTo }
          : {}),
      },
    });
  }
  try {
    await sendResultNotifications(exam, r, actorUserId);
    if (exam.sittingId) await notifyIfSittingComplete(exam.sittingId);
  } catch (err) {
    console.warn("[exam-panel] result notifications failed:", err);
  }
}

// ONE summary to the centre manager when the last rider in a sitting is
// marked — and one more when the last sitting of an exam day finishes —
// instead of a notification per rider (a 200-rider day sent 194). The
// completedNotifiedAt claim makes it exactly-once even when the last two
// cards land at the same moment.
export async function notifyIfSittingComplete(sittingId: string): Promise<void> {
  const open = await prisma.exam.count({ where: { sittingId, status: { in: ["scheduled", "in_progress"] } } });
  if (open > 0) return;
  const claimed = await prisma.examSitting.updateMany({
    where: { id: sittingId, completedNotifiedAt: null },
    data: { completedNotifiedAt: new Date() },
  });
  if (claimed.count === 0) return;
  const s = await prisma.examSitting.findUnique({
    where: { id: sittingId },
    include: { exams: { select: { passed: true } }, examDay: { select: { id: true, name: true } } },
  });
  if (!s || s.exams.length === 0) return;
  const passed = s.exams.filter((e) => e.passed === true).length;
  await notifyCentreManager(s.centreId, {
    type: "exam.sitting_complete",
    title: `Level ${s.level}${s.groupNo ? ` · Group ${s.groupNo}` : ""} sitting complete — ${passed} of ${s.exams.length} passed`,
    body: `${s.exams.length - passed} did not pass.${s.examDay ? ` Part of ${s.examDay.name}.` : ""}`,
    link: `/exams/sittings/${s.id}`,
    payload: { sittingId: s.id, passed, total: s.exams.length },
  });
  if (!s.examDay) return;
  const dayOpen = await prisma.exam.count({
    where: { sitting: { examDayId: s.examDay.id }, status: { in: ["scheduled", "in_progress"] } },
  });
  if (dayOpen > 0) return;
  const dayClaimed = await prisma.examDay.updateMany({
    where: { id: s.examDay.id, completedNotifiedAt: null },
    data: { completedNotifiedAt: new Date() },
  });
  if (dayClaimed.count === 0) return;
  const all = await prisma.exam.findMany({ where: { sitting: { examDayId: s.examDay.id } }, select: { passed: true } });
  const dayPassed = all.filter((e) => e.passed === true).length;
  await notifyCentreManager(s.centreId, {
    type: "exam.day_complete",
    title: `${s.examDay.name} complete — ${dayPassed} of ${all.length} passed`,
    body: "Every rider on the day has been marked. Certificates for the passes are issued.",
    link: `/exams/days/${s.examDay.id}`,
    payload: { examDayId: s.examDay.id, passed: dayPassed, total: all.length },
  });
}

async function sendResultNotifications(
  exam: Parameters<typeof afterExamCompleted>[0],
  r: FinalizeResult,
  actorUserId: string,
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
  // A rider marked in a sitting is covered by the sitting's summary; the
  // manager still hears about every correction individually.
  const tellManager = !exam.sittingId || corrected;

  if (passed === true) {
    if (tellManager) await notifyCentreManager(exam.centreId, {
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
    if (tellManager) await notifyCentreManager(exam.centreId, {
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
  // The examiner who pressed Submit already saw the result on screen.
  if (exam.examinerId && exam.examinerId !== actorUserId) {
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
