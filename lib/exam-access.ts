import type { SessionPayload } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { isOutsideSchoolFence } from "@/lib/school-scope";

// Who may open an exam's printable sheets.
//
// Both sheet routes used to check only "signed in + same club". Every role in
// the club could therefore print any child's paper — a groom, the farrier,
// the accountant, the external inspection officer, and other riders on the
// student portal — and the result sheet carries the child's name, date of
// birth and every mark. A school administrator pinned to one partner school
// could read another school's pupils the same way.
//
//   jury sheet   — the blank marking form: exam staff only.
//   result sheet — the rider-facing result: exam staff, plus the coaches who
//                  hand results to riders, plus a school administrator for
//                  their own school's pupils.
//
// An EXAMINER, as on the exam page, only for an exam they lead or co-judge.
export type ExamSheet = "jury" | "result";

type SheetExam = {
  examinerId: string | null;
  judges: { judgeId: string }[];
  rider: { schoolId: string | null };
};

export async function examSheetDenied(
  session: SessionPayload,
  exam: SheetExam,
  sheet: ExamSheet,
): Promise<string | null> {
  if (session.role === "EXAMINER") {
    const onPanel = exam.examinerId === session.userId || exam.judges.some((j) => j.judgeId === session.userId);
    return onPanel ? null : "NOT_YOUR_EXAM";
  }
  if (can(session.role, "exam.schedule")) return null;
  if (sheet === "result") {
    if (session.role === "COACH") return null;
    if (session.role === "SCHOOL_ADMINISTRATOR") {
      return (await isOutsideSchoolFence(session, exam.rider.schoolId)) ? "OUTSIDE_SCHOOL" : null;
    }
  }
  return "FORBIDDEN";
}
