import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { updateExamScoreSchema, parseRubric, computeTotal, findScoreViolations } from "@/lib/schemas/exam";
import { audit } from "@/lib/audit";
import { generateUniqueSerial, verifyUrl } from "@/lib/cert";
import { notifyCentreManager, notify, notifyRiderAndParents } from "@/lib/notify";
import { sendSms } from "@/lib/sms";
import { sendEmail, renderEmail } from "@/lib/email";
import { sendWhatsApp } from "@/lib/whatsapp";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "exam.score")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = updateExamScoreSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const { scores, final, judgeId, deductions, timeFaults } = parsed.data;

  const exam = await prisma.exam.findUnique({
    where: { id: params.id },
    include: { judges: true },
  });
  if (!exam) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && exam.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }
  // Determine which judge is submitting. If `judgeId` is supplied, only that
  // judge (or a manager/admin) may submit on their row. With no judgeId we
  // fall back to the legacy single-judge flow on Exam.scoresJson, and require
  // that the caller IS the lead examiner.
  const isManager = session.role === "SUPER_ADMIN" || session.role === "CENTRE_MANAGER";
  const judgeRow = judgeId ? exam.judges.find((j) => j.judgeId === judgeId) : null;
  if (judgeId) {
    if (!judgeRow) {
      return NextResponse.json({ error: "JUDGE_NOT_ON_EXAM" }, { status: 400 });
    }
    if (!isManager && session.userId !== judgeId) {
      return NextResponse.json({ error: "NOT_YOUR_CARD" }, { status: 403 });
    }
  } else if (session.role === "EXAMINER" && exam.examinerId !== session.userId) {
    return NextResponse.json({ error: "NOT_YOUR_EXAM" }, { status: 403 });
  }
  if (exam.status === "completed") {
    return NextResponse.json({ error: "ALREADY_COMPLETED" }, { status: 409 });
  }

  const template = await prisma.scoringTemplate.findUnique({
    where: { centreId_levelKey: { centreId: exam.centreId, levelKey: String(exam.level) } },
  });
  if (!template) return NextResponse.json({ error: "NO_TEMPLATE_FOR_LEVEL" }, { status: 400 });
  // The score handler runs DURING an active exam — use the snapshot the
  // exam was created with so a mid-exam rubric edit doesn't change the
  // scoring rules under the examiner's feet. The live template still
  // contributes passThreshold + levelName.
  const rubric = parseRubric(exam.rubricSnapshotJson ?? template.categoriesJson);

  // Reject any per-item score outside its rubric [0, max] before aggregating —
  // an over-max entry would inflate the total past `max` and could flip a fail
  // into a pass (and auto-issue a certificate).
  const violations = findScoreViolations(rubric, scores);
  if (violations.length > 0) {
    return NextResponse.json({ error: "SCORE_OUT_OF_RANGE", violations }, { status: 400 });
  }

  // Per-judge subtotal first.
  const { total: thisJudgeTotal, max } = computeTotal(rubric, scores);

  // If this is a co-judge submission, persist their card. Then aggregate
  // across every submitted judge card (mean of submitted subtotals). For
  // legacy single-judge exams we just take thisJudgeTotal directly.
  let aggregate: number;
  if (judgeRow) {
    await prisma.examJudge.update({
      where: { id: judgeRow.id },
      data: {
        // jsonb column — pass the score map object directly.
        scoresJson: scores,
        subTotal: thisJudgeTotal,
        submittedAt: final ? new Date() : null,
      },
    });
    const allJudges = await prisma.examJudge.findMany({ where: { examId: exam.id } });
    const submitted = allJudges.filter((j) => typeof j.subTotal === "number");
    if (submitted.length === 0) {
      aggregate = thisJudgeTotal;
    } else {
      aggregate =
        submitted.reduce((s, j) => s + (j.subTotal ?? 0), 0) / submitted.length;
    }
  } else {
    aggregate = thisJudgeTotal;
  }

  const effectiveDeductions = deductions ?? exam.deductions;
  const effectiveTimeFaults = timeFaults ?? exam.timeFaults;
  // Final score = aggregate of rubric scores minus deductions and time
  // faults. Pass mark applies to this adjusted total.
  const total = Math.max(0, aggregate - effectiveDeductions - effectiveTimeFaults);
  const passed = max > 0 ? total / max >= template.passThreshold / 100 : null;

  const updated = await prisma.exam.update({
    where: { id: exam.id },
    data: {
      // Single-judge legacy: persist the score map on the exam too. With the
      // co-judge case, leave Exam.scoresJson alone (the lead's existing card
      // stays untouched). jsonb column — write the object directly.
      ...(judgeRow ? {} : { scoresJson: scores as Prisma.InputJsonValue }),
      totalScore: total,
      deductions: effectiveDeductions,
      timeFaults: effectiveTimeFaults,
      status: final ? "completed" : "in_progress",
      passed: final ? passed : null,
    },
  });

  // Auto-issue certificate + bump rider level on a passing final submission.
  let certificateId: string | null = null;
  if (final) {
    const rider = await prisma.rider.findUnique({
      where: { id: exam.riderId },
      select: { firstName: true, lastName: true, mobile: true, fatherPhone: true, motherPhone: true, email: true, centre: { select: { name: true } } },
    });
    const riderName = rider ? `${rider.firstName} ${rider.lastName}` : "Rider";
    const parentPhone = rider?.fatherPhone ?? rider?.motherPhone ?? rider?.mobile;

    if (passed === true) {
      await notifyCentreManager(exam.centreId, {
        type: "exam.passed",
        title: `${riderName} passed Level ${exam.level}`,
        body: `Examiner ${exam.examinerName} submitted ${total} / ${max}. Certificate auto-issued.`,
        link: `/exams/${exam.id}`,
        payload: { examId: exam.id, riderId: exam.riderId, totalScore: total, max },
      });
      // In-app notification to the rider (student portal) and every linked parent.
      await notifyRiderAndParents(exam.riderId, {
        centreId: exam.centreId,
        type: "exam.passed",
        title: `🎉 ${riderName} passed Level ${exam.level}`,
        body: `Score ${total} / ${max}. Certificate is being issued.`,
        link: `/parent/${exam.riderId}`,
        payload: { examId: exam.id, totalScore: total, max },
      });
      // Parent SMS — the headline good-news moment.
      if (parentPhone) {
        await sendSms({
          to: parentPhone,
          body: `Congratulations! ${riderName} passed Level ${exam.level} with ${total}/${max}. Certificate ready for collection. — Equiwings`,
          ref: { type: "exam.passed", rowId: exam.id, payload: { riderId: exam.riderId } },
        });
        // Parent WhatsApp — pre-approved template `ew_exam_passed`.
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
      // Parent email is NOT sent here. Staff trigger it manually from the
      // certificate detail or certificates list ('Send result to parent'
      // button) so they can review the score before parents see it.
    } else {
      await notifyCentreManager(exam.centreId, {
        type: "exam.failed",
        title: `${riderName} did not pass Level ${exam.level}`,
        body: `Score ${total} / ${max}. Coach can re-schedule.`,
        link: `/exams/${exam.id}`,
        payload: { examId: exam.id, riderId: exam.riderId, totalScore: total, max },
      });
      // No "you failed" SMS — coach delivers that in person.
      // Parent in-app gets a softer message so they're informed without an SMS ping.
      await notifyRiderAndParents(exam.riderId, {
        centreId: exam.centreId,
        type: "exam.not_passed",
        title: `${riderName}'s Level ${exam.level} result is in`,
        body: `Your coach will follow up on next steps.`,
        link: `/parent/${exam.riderId}`,
        payload: { examId: exam.id },
      });
      // Failed exams have no certificate, so no manual 'Send result' UI
      // exists — coach owns the in-person follow-up. In-app notification
      // above is the only parent-visible artifact.
    }
    // Also notify the examiner themselves so it shows in their feed (when the
    // exam has an assigned examiner — sitting exams are always claimed by now).
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
  if (final && passed === true) {
    const serial = await generateUniqueSerial(exam.level);
    const cert = await prisma.certificate.create({
      data: {
        centreId: exam.centreId,
        riderId: exam.riderId,
        examId: exam.id,
        type: "promotion",
        levelName: template.levelName,
        serialNo: serial,
        qrCode: verifyUrl(serial),
        signedBy: session.userId,
      },
    });
    certificateId = cert.id;
    await prisma.rider.update({
      where: { id: exam.riderId },
      data: { currentLevel: template.levelName },
    });
    await audit({
      userId: session.userId,
      action: "certificate.auto_issue",
      tableName: "certificate",
      rowId: cert.id,
      after: { serial, levelName: template.levelName, riderId: exam.riderId, examId: exam.id },
    });
  }

  await audit({
    userId: session.userId,
    action: final ? "exam.submit" : "exam.draft",
    tableName: "exam",
    rowId: exam.id,
    before: { status: exam.status, totalScore: exam.totalScore },
    after: { status: updated.status, totalScore: updated.totalScore, passed: updated.passed, certificateId },
  });

  return NextResponse.json({
    ok: true,
    status: updated.status,
    totalScore: updated.totalScore,
    max,
    passed,
    certificateId,
  });
}

// Reset draft → back to scheduled, scores cleared.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "exam.score")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const exam = await prisma.exam.findUnique({ where: { id: params.id } });
  if (!exam) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && exam.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }
  if (session.role === "EXAMINER" && exam.examinerId !== session.userId) {
    return NextResponse.json({ error: "NOT_YOUR_EXAM" }, { status: 403 });
  }
  if (exam.status === "completed") {
    return NextResponse.json({ error: "ALREADY_COMPLETED" }, { status: 409 });
  }

  await prisma.exam.update({
    where: { id: exam.id },
    data: { scoresJson: Prisma.DbNull, totalScore: null, status: "scheduled", passed: null },
  });

  await audit({
    userId: session.userId,
    action: "exam.reset_draft",
    tableName: "exam",
    rowId: exam.id,
    before: { status: exam.status },
  });

  return NextResponse.json({ ok: true });
}
