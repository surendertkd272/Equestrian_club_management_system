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

// ─── What an examiner may see of the club's riders ─────────────────────────
// Examiners are often judges from OUTSIDE the club, in for one exam day. They
// held rider.read like any coach, so a visiting judge could browse all 500
// riders, open any child's profile (address, parents' phones, medical notes),
// search the roster, and download it as a CSV. They now see the riders on an
// exam they lead, co-judge, or are in the examiner pool for — and nobody else.

type RiderScope = import("@prisma/client").Prisma.RiderWhereInput;

export function examinerRiderScope(session: SessionPayload): RiderScope | null {
  if (session.role !== "EXAMINER") return null;
  const uid = session.userId;
  return {
    exams: {
      some: {
        OR: [
          { examinerId: uid },
          { judges: { some: { judgeId: uid } } },
          { sitting: { examiners: { some: { examinerId: uid } } } },
        ],
      },
    },
  };
}

// True when this examiner may NOT see this rider (always false for other roles).
export async function riderOutsideExaminerScope(session: SessionPayload, riderId: string): Promise<boolean> {
  const scope = examinerRiderScope(session);
  if (!scope) return false;
  const { prisma } = await import("@/lib/prisma");
  return (await prisma.rider.count({ where: { id: riderId, ...scope } })) === 0;
}

// Certificates an examiner may see: those from exams they marked.
export function examinerCertificateScope(
  session: SessionPayload,
): import("@prisma/client").Prisma.CertificateWhereInput | null {
  if (session.role !== "EXAMINER") return null;
  const uid = session.userId;
  return { exam: { OR: [{ examinerId: uid }, { judges: { some: { judgeId: uid } } }] } };
}
