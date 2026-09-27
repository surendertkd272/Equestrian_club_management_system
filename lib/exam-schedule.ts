import type { Prisma } from "@prisma/client";
import { ExamPanelError } from "@/lib/exam-panel";

// Rules for taking an exam OFF the schedule (a rider removed from a sitting,
// a sitting cancelled). Before these existed nothing could cancel or move an
// exam at all, so a wrong date or a rider who left the club stayed on the
// examiners' queue for good.

export const OPEN_EXAM_STATUSES = ["scheduled", "in_progress"];

export const removableExamInclude = {
  judges: { select: { scoresJson: true } },
  _count: { select: { attachments: true, certificates: true } },
} satisfies Prisma.ExamInclude;

type RemovableExam = Prisma.ExamGetPayload<{ include: typeof removableExamInclude }>;

function hasMarks(e: RemovableExam): boolean {
  const filled = (v: unknown) => !!v && typeof v === "object" && Object.keys(v as object).length > 0;
  return filled(e.scoresJson) || e.judges.some((j) => filled(j.scoresJson)) || e._count.attachments > 0;
}

// Why this exam can't be removed, or null when it can. A result on record —
// completed, reopened for correction, or carrying a certificate — is never
// deleted; marks or attachments already saved need an explicit discardMarks.
// Callers evaluate this INSIDE their transaction, on a locked row.
export function removalProblem(e: RemovableExam, discardMarks: boolean): ExamPanelError | null {
  if (e.status === "completed" || e.reopenedAt || e._count.certificates > 0) {
    return new ExamPanelError(
      "HAS_RESULT",
      "This exam has a result on record, so it can't be removed. To fix the marks, reopen it for correction instead.",
      409,
    );
  }
  if (hasMarks(e) && !discardMarks) {
    return new ExamPanelError(
      "HAS_MARKS",
      "Marks or attachments have already been saved on this exam. Confirm that they should be discarded.",
      409,
    );
  }
  return null;
}

// What gets written to the audit log when an exam is removed, so the removal
// can be reconstructed later.
export function removalSnapshot(e: RemovableExam) {
  return {
    riderId: e.riderId,
    level: e.level,
    date: e.date,
    time: e.time,
    status: e.status,
    sittingId: e.sittingId,
    examinerId: e.examinerId,
    scoresJson: e.scoresJson,
    attachments: e._count.attachments,
  };
}
