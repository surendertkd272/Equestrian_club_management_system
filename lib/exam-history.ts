// Server-side helper that loads a rider's completed exams with the rubric
// each was scored against. Shared by the three exam-history surfaces:
//   /student        — rider sees own past exams + category breakdown
//   /parent/[id]    — parent sees child's exams + category breakdown
//   /riders/[id]    — staff (incl. coaches) see exam history on the profile
//
// The rubric is read from the centre's CURRENT ScoringTemplate per levelKey.
// Note: this is the same approach the result-sheet PDF uses — if the rubric
// has been edited since the exam was scored, the score keys may not all
// resolve. Acceptable trade-off for now; snapshotting the rubric per exam
// is a future migration.

import { prisma } from "./prisma";
import { parseRubric, type RubricCategory } from "./schemas/exam";

export type ExamHistoryEntry = {
  id: string;
  date: Date;
  level: number;
  examinerName: string | null;
  totalScore: number | null;
  passed: boolean | null;
  scoresJson: Record<string, number | string> | null;
  rubric: RubricCategory[];
  passThreshold: number;
};

export async function loadRiderExamHistory(
  riderId: string,
  centreId: string,
  opts: { take?: number } = {},
): Promise<ExamHistoryEntry[]> {
  const exams = await prisma.exam.findMany({
    where: { riderId, status: "completed" },
    select: {
      id: true,
      date: true,
      level: true,
      examinerName: true,
      totalScore: true,
      passed: true,
      scoresJson: true,
    },
    orderBy: { date: "desc" },
    take: opts.take ?? 10,
  });
  if (exams.length === 0) return [];

  // Distinct level keys seen across the rider's exams — one rubric fetch per.
  const levelKeys = Array.from(new Set(exams.map((e) => String(e.level))));
  const templates = await prisma.scoringTemplate.findMany({
    where: { centreId, levelKey: { in: levelKeys } },
    select: { levelKey: true, categoriesJson: true, passThreshold: true },
  });
  const tplByLevel = new Map(templates.map((t) => [t.levelKey, t]));

  return exams.map((e) => {
    const t = tplByLevel.get(String(e.level));
    return {
      id: e.id,
      date: e.date,
      level: e.level,
      examinerName: e.examinerName,
      totalScore: e.totalScore,
      passed: e.passed,
      scoresJson:
        e.scoresJson && typeof e.scoresJson === "object" && !Array.isArray(e.scoresJson)
          ? (e.scoresJson as Record<string, number | string>)
          : null,
      rubric: t ? parseRubric(t.categoriesJson) : [],
      passThreshold: t?.passThreshold ?? 70,
    };
  });
}
