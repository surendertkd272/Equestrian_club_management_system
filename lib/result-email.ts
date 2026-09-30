import { prisma } from "@/lib/prisma";
import { sendEmail, renderEmail } from "@/lib/email";
import { renderExamBreakdownHtml } from "@/lib/exam-email-breakdown";
import { resultRecipients, RESULT_RECIPIENT_SELECT } from "@/lib/result-recipients";
import { resultsHeld } from "@/lib/exam-panel";

// Email one exam's result, with the mark breakdown, to the rider's family.
//
// Shared by the per-certificate "Send result to parent" button and the bulk
// "Email results" for a sitting or an exam day. It covers riders who did not
// pass too — they got nothing before, because the only send was hung off the
// certificate a pass creates. Callers check who may send and write the audit.

export type ResultEmailOutcome =
  | { ok: true; sentTo: string[]; passed: boolean | null }
  | { ok: false; code: "NOT_FOUND" | "NOT_COMPLETED" | "NO_PARENT_EMAIL" | "RESULTS_HELD"; message: string };

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function sendExamResultEmail(examId: string, actorUserId: string): Promise<ResultEmailOutcome> {
  const exam = await prisma.exam.findUnique({
    where: { id: examId },
    select: {
      id: true, centreId: true, level: true, date: true, status: true, totalScore: true, passed: true, sittingId: true,
      scoresJson: true, rubricSnapshotJson: true, examinerName: true,
      rider: { select: { id: true, firstName: true, lastName: true, ...RESULT_RECIPIENT_SELECT } },
      centre: { select: { name: true } },
      certificates: {
        where: { type: "promotion", revokedAt: null },
        select: { id: true, serialNo: true },
        take: 1,
      },
    },
  });
  if (!exam) return { ok: false, code: "NOT_FOUND", message: "This exam no longer exists." };
  if (exam.status !== "completed") {
    return { ok: false, code: "NOT_COMPLETED", message: "The exam hasn't been marked yet." };
  }
  if (await resultsHeld(exam.sittingId)) {
    return { ok: false, code: "RESULTS_HELD", message: "This day's results are held — publish them first." };
  }
  const to = resultRecipients(exam.rider);
  if (to.length === 0) {
    return {
      ok: false,
      code: "NO_PARENT_EMAIL",
      message: "No parent or rider email on file — link a parent or add an email on the rider profile first.",
    };
  }

  const template = await prisma.scoringTemplate.findUnique({
    where: { centreId_levelKey: { centreId: exam.centreId, levelKey: String(exam.level) } },
    select: { categoriesJson: true, passThreshold: true, levelName: true },
  });
  const rubricJson = (exam.rubricSnapshotJson ?? template?.categoriesJson ?? null) as unknown;
  const scores =
    exam.scoresJson && typeof exam.scoresJson === "object" && !Array.isArray(exam.scoresJson)
      ? (exam.scoresJson as Record<string, number | string>)
      : {};
  const breakdown = renderExamBreakdownHtml(rubricJson, scores);
  const riderName = `${exam.rider.firstName} ${exam.rider.lastName}`;
  const levelName = template?.levelName ?? `Level ${exam.level}`;
  // Date-only column stored as UTC midnight — format it in UTC so the day never shifts.
  const examDate = exam.date.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" });
  const cert = exam.certificates[0];
  const passed = exam.passed === true;

  const subject = passed ? `🎉 ${riderName} passed ${levelName}!` : `${riderName}'s ${levelName} exam result`;
  const heading = passed ? `Congratulations — ${levelName} passed!` : `${levelName} exam result`;
  const body = passed
    ? `<p>Dear Parent / Guardian,</p>
<p>We are delighted to report that <b>${esc(riderName)}</b> successfully passed the ${esc(levelName)} examination on <b>${examDate}</b> with a score of <b>${exam.totalScore ?? "—"}</b>.</p>
<p>Examiner: <b>${esc(exam.examinerName ?? "—")}</b></p>
${breakdown}
${cert ? `<p>Certificate <span style="font-family:monospace">${cert.serialNo}</span> has been issued and is ready for collection at the centre.</p>` : ""}
<p>Well done ${esc(exam.rider.firstName)}! 🐎</p>`
    : `<p>Dear Parent / Guardian,</p>
<p><b>${esc(riderName)}</b> sat the ${esc(levelName)} examination on <b>${examDate}</b> and scored <b>${exam.totalScore ?? "—"}</b>${template ? ` (the pass mark is ${template.passThreshold}%)` : ""}. They did not pass this time.</p>
<p>The breakdown below shows where the marks were given. The coaches will work with ${esc(exam.rider.firstName)} on the rest before the next attempt.</p>
${breakdown}
<p>If you have a question about the result, reply to this email or speak to the centre.</p>`;

  for (const addr of to) {
    await sendEmail({
      to: addr,
      subject,
      html: renderEmail({ centreName: exam.centre.name, heading, body }),
      ref: {
        type: passed ? "exam.passed.manual" : "exam.result.manual",
        rowId: exam.id,
        payload: { examId: exam.id, riderId: exam.rider.id, ...(cert ? { certId: cert.id } : {}) },
      },
    });
  }
  const now = new Date();
  await prisma.exam.update({ where: { id: exam.id }, data: { resultEmailSentAt: now, resultEmailSentBy: actorUserId } });
  if (cert) {
    await prisma.certificate.update({ where: { id: cert.id }, data: { resultEmailSentAt: now, resultEmailSentBy: actorUserId } });
  }
  return { ok: true, sentTo: to, passed: exam.passed };
}
