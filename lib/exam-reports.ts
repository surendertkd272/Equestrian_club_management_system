import { computeTotal, parseRubric } from "@/lib/schemas/exam";

// Exam results over a period, summed the ways a club asks about them: by
// level, by school, by lead examiner and by month, plus how far apart judges'
// cards are when a panel marks the same rider. Pure: the page loads the rows.

export type ReportExam = {
  id: string;
  level: number;
  date: Date;
  status: string;
  passed: boolean | null;
  totalScore: number | null;
  examinerName: string | null;
  scoresJson: unknown;
  rubricSnapshotJson: unknown;
  school: string;
  riderName: string;
  judges: { judgeName: string; subTotal: number | null; submittedAt: Date | null }[];
};

export type Row = { key: string; label: string; sat: number; passed: number; absent: number; passRate: number | null; avgPct: number | null };

const pct = (a: number, b: number) => (b ? Math.round((1000 * a) / b) / 10 : null);

function group(exams: ReportExam[], keyOf: (e: ReportExam) => [string, string], maxOf: (e: ReportExam) => number): Row[] {
  const m = new Map<string, { label: string; sat: number; passed: number; absent: number; pctSum: number; pctN: number }>();
  for (const e of exams) {
    const [key, label] = keyOf(e);
    const r = m.get(key) ?? { label, sat: 0, passed: 0, absent: 0, pctSum: 0, pctN: 0 };
    if (e.status === "absent") r.absent++;
    else if (e.status === "completed") {
      r.sat++;
      if (e.passed) r.passed++;
      const max = maxOf(e);
      if (max > 0 && typeof e.totalScore === "number") {
        r.pctSum += (100 * e.totalScore) / max;
        r.pctN++;
      }
    }
    m.set(key, r);
  }
  return Array.from(m.entries()).map(([key, r]) => ({
    key,
    label: r.label,
    sat: r.sat,
    passed: r.passed,
    absent: r.absent,
    passRate: pct(r.passed, r.sat),
    avgPct: r.pctN ? Math.round((10 * r.pctSum) / r.pctN) / 10 : null,
  }));
}

export function summariseExams(exams: ReportExam[], levelName: (level: number) => string) {
  const maxCache = new Map<string, number>();
  const rubricMax = (e: ReportExam) => {
    if (!maxCache.has(e.id)) maxCache.set(e.id, computeTotal(parseRubric(e.rubricSnapshotJson), {}).max);
    return maxCache.get(e.id)!;
  };
  const sat = exams.filter((e) => e.status === "completed");
  const totals = {
    sat: sat.length,
    passed: sat.filter((e) => e.passed).length,
    absent: exams.filter((e) => e.status === "absent").length,
    passRate: pct(sat.filter((e) => e.passed).length, sat.length),
  };
  const byLevel = group(exams, (e) => [String(e.level).padStart(3, "0"), levelName(e.level)], rubricMax).sort((a, b) =>
    a.key.localeCompare(b.key),
  );
  const bySchool = group(exams, (e) => [e.school || "—", e.school || "No school on file"], rubricMax).sort((a, b) => b.sat - a.sat);
  const byExaminer = group(exams, (e) => [e.examinerName ?? "—", e.examinerName ?? "Not recorded"], rubricMax)
    .filter((r) => r.sat > 0)
    .sort((a, b) => b.sat - a.sat);
  const byMonth = group(exams, (e) => {
    const k = e.date.toISOString().slice(0, 7);
    return [k, new Date(`${k}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" })];
  }, rubricMax).sort((a, b) => a.key.localeCompare(b.key));

  // Judge agreement: every exam marked by two or more locked cards.
  const spreads: { id: string; riderName: string; level: number; date: Date; cards: number; spreadPct: number }[] = [];
  const judgeDev = new Map<string, { panels: number; sum: number; abs: number }>();
  for (const e of sat) {
    const max = rubricMax(e);
    if (max <= 0) continue;
    const lead =
      e.scoresJson && typeof e.scoresJson === "object" && !Array.isArray(e.scoresJson)
        ? computeTotal(parseRubric(e.rubricSnapshotJson), e.scoresJson as Record<string, number | string>).total
        : null;
    const cards: { name: string; total: number }[] = [];
    if (lead !== null) cards.push({ name: e.examinerName ?? "Lead examiner", total: lead });
    for (const j of e.judges) if (j.submittedAt && typeof j.subTotal === "number") cards.push({ name: j.judgeName, total: j.subTotal });
    if (cards.length < 2) continue;
    const totalsOnly = cards.map((c) => c.total);
    spreads.push({
      id: e.id,
      riderName: e.riderName,
      level: e.level,
      date: e.date,
      cards: cards.length,
      spreadPct: Math.round((1000 * (Math.max(...totalsOnly) - Math.min(...totalsOnly))) / max) / 10,
    });
    for (const [i, c] of cards.entries()) {
      const others = cards.filter((_, k) => k !== i);
      const mean = others.reduce((n, o) => n + o.total, 0) / others.length;
      const dev = (100 * (c.total - mean)) / max;
      const d = judgeDev.get(c.name) ?? { panels: 0, sum: 0, abs: 0 };
      d.panels++;
      d.sum += dev;
      d.abs += Math.abs(dev);
      judgeDev.set(c.name, d);
    }
  }
  spreads.sort((a, b) => b.spreadPct - a.spreadPct);
  const judges = Array.from(judgeDev.entries())
    .map(([name, d]) => ({
      name,
      panels: d.panels,
      meanDev: Math.round((10 * d.sum) / d.panels) / 10,
      meanAbsDev: Math.round((10 * d.abs) / d.panels) / 10,
    }))
    .sort((a, b) => b.meanAbsDev - a.meanAbsDev);

  return { totals, byLevel, bySchool, byExaminer, byMonth, spreads: spreads.slice(0, 15), panelledExams: spreads.length, judges };
}
