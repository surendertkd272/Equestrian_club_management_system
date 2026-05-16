// Dressage scoring math + a small built-in test catalog for first-day
// usage. Real federation tests live in the DressageTest table — the seed
// below populates 3 starter rows so new tenants can score immediately
// without waiting on a SUPER_ADMIN to enter the EFI catalogue.

export type DressageMovement = {
  no: number;
  letter: string;
  description: string;
  coefficient: number; // usually 1, sometimes 2 (collective marks often have coefficient 2)
};

export type DressageCollective = {
  name: string;
  coefficient: number;
};

export type DressageMark = {
  no: number;
  mark: number | null; // null = not yet marked
  comment?: string;
};

// Compute the percentage for one judge: sum of (mark × coefficient × 10) over
// movements + collectives, divided by maxScore, expressed as 0-100. We
// follow FEI convention: each movement is scored 0-10 in 0.5 increments,
// max per movement is 10 × coefficient. maxScore is the sum of all
// (coefficient × 10) across movements + collectives.
export function computeDressagePercentage(
  movementMarks: DressageMark[],
  collectiveMarks: DressageMark[],
  movements: DressageMovement[],
  collectives: DressageCollective[],
  maxScore: number,
): number | null {
  let total = 0;
  let counted = 0;
  for (const m of movements) {
    const found = movementMarks.find((x) => x.no === m.no);
    if (found?.mark === null || found?.mark === undefined) continue;
    total += found.mark * m.coefficient;
    counted++;
  }
  for (let i = 0; i < collectives.length; i++) {
    const found = collectiveMarks.find((x) => x.no === i + 1);
    if (found?.mark === null || found?.mark === undefined) continue;
    total += found.mark * collectives[i].coefficient;
    counted++;
  }
  // Require at least half the movements scored before we publish a percentage.
  if (counted < Math.ceil(movements.length / 2)) return null;
  if (maxScore === 0) return 0;
  return Math.round((total / maxScore) * 1000) / 10; // one decimal place
}

// Default catalog — short, illustrative tests an academy can use day one.
// The 14-movement preliminary is a simple grade-school test; the others
// are placeholders that SUPER_ADMIN will replace with the real EFI tests.
export const DEFAULT_DRESSAGE_TESTS: Array<{
  code: string;
  name: string;
  level: string;
  body: string;
  movements: DressageMovement[];
  collectives: DressageCollective[];
}> = [
  {
    code: "PRELIM_14",
    name: "Preliminary 14 (sample)",
    level: "preliminary",
    body: "custom",
    movements: [
      { no: 1, letter: "A", description: "Enter working trot rising", coefficient: 1 },
      { no: 2, letter: "X", description: "Halt, salute", coefficient: 1 },
      { no: 3, letter: "C", description: "Track left, working trot rising", coefficient: 1 },
      { no: 4, letter: "E", description: "Half-20m circle", coefficient: 1 },
      { no: 5, letter: "A", description: "Working canter left lead", coefficient: 1 },
      { no: 6, letter: "B", description: "Half-circle 15m", coefficient: 1 },
      { no: 7, letter: "C", description: "Working trot", coefficient: 1 },
      { no: 8, letter: "M", description: "Working canter right lead", coefficient: 1 },
      { no: 9, letter: "F", description: "Working trot rising", coefficient: 1 },
      { no: 10, letter: "A", description: "Down centre line, working trot", coefficient: 1 },
      { no: 11, letter: "X", description: "Halt, salute", coefficient: 1 },
      { no: 12, letter: "—", description: "Walks (free walk on a long rein)", coefficient: 2 },
      { no: 13, letter: "—", description: "Transitions", coefficient: 1 },
      { no: 14, letter: "—", description: "Accuracy of figures", coefficient: 1 },
    ],
    collectives: [
      { name: "Paces", coefficient: 1 },
      { name: "Impulsion", coefficient: 1 },
      { name: "Submission", coefficient: 1 },
      { name: "Rider position + seat", coefficient: 1 },
    ],
  },
  {
    code: "NOVICE_27",
    name: "Novice 27 (placeholder)",
    level: "novice",
    body: "custom",
    movements: Array.from({ length: 20 }).map((_, i) => ({
      no: i + 1,
      letter: "—",
      description: `Movement ${i + 1} (please customise)`,
      coefficient: 1,
    })),
    collectives: [
      { name: "Paces", coefficient: 1 },
      { name: "Impulsion", coefficient: 1 },
      { name: "Submission", coefficient: 1 },
      { name: "Rider position + seat", coefficient: 1 },
    ],
  },
  {
    code: "ELEMENTARY_43",
    name: "Elementary 43 (placeholder)",
    level: "elementary",
    body: "custom",
    movements: Array.from({ length: 24 }).map((_, i) => ({
      no: i + 1,
      letter: "—",
      description: `Movement ${i + 1} (please customise)`,
      coefficient: 1,
    })),
    collectives: [
      { name: "Paces", coefficient: 1 },
      { name: "Impulsion", coefficient: 1 },
      { name: "Submission", coefficient: 1 },
      { name: "Rider position + seat", coefficient: 1 },
    ],
  },
];

export function dressageMaxScore(
  movements: DressageMovement[],
  collectives: DressageCollective[],
): number {
  const a = movements.reduce((s, m) => s + m.coefficient * 10, 0);
  const b = collectives.reduce((s, c) => s + c.coefficient * 10, 0);
  return a + b;
}

// CDI averaging modes — combine multiple judges' submitted sheets into
// one round percentage. Returns null when there aren't enough sheets to
// produce a meaningful number (e.g. trimmed_mean needs ≥3 sheets).
export type JudgingMode = "simple" | "trimmed_mean" | "per_movement";

export type SubmittedSheet = {
  judgeUserId: string;
  judgePosition: string | null;
  percentage: number | null;
  marksJson: string;
  collectiveMarksJson: string | null;
};

export function combineDressageSheets(
  sheets: SubmittedSheet[],
  mode: JudgingMode,
  movements: DressageMovement[],
  collectives: DressageCollective[],
  maxScore: number,
): { percentage: number | null; mode: JudgingMode; judgeCount: number; spread: number | null } {
  // Filter to sheets that have a percentage (i.e., enough movements marked).
  const valid = sheets.filter((s): s is SubmittedSheet & { percentage: number } => s.percentage !== null);
  if (valid.length === 0) return { percentage: null, mode, judgeCount: 0, spread: null };

  const pcts = valid.map((s) => s.percentage);
  const spread = pcts.length > 1 ? Math.max(...pcts) - Math.min(...pcts) : 0;

  if (mode === "simple" || valid.length < 3) {
    const avg = pcts.reduce((a, b) => a + b, 0) / pcts.length;
    return {
      percentage: Math.round(avg * 10) / 10,
      mode: valid.length < 3 ? "simple" : mode,
      judgeCount: valid.length,
      spread: Math.round(spread * 10) / 10,
    };
  }

  if (mode === "trimmed_mean") {
    // Drop one highest + one lowest.
    const sorted = [...pcts].sort((a, b) => a - b);
    const trimmed = sorted.slice(1, -1);
    const avg = trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
    return {
      percentage: Math.round(avg * 10) / 10,
      mode,
      judgeCount: valid.length,
      spread: Math.round(spread * 10) / 10,
    };
  }

  // per_movement — average each movement's mark across judges, then
  // compute one combined percentage. Mathematically distinct because
  // judges with NULL marks on a specific movement get excluded for that
  // movement only, instead of dragging the whole sheet down.
  const movementSums = new Map<number, { sum: number; n: number }>();
  const collectiveSums = new Map<number, { sum: number; n: number }>();
  for (const s of valid) {
    const marks = JSON.parse(s.marksJson) as Array<{ no: number; mark: number | null }>;
    for (const m of marks) {
      if (m.mark === null || m.mark === undefined) continue;
      const slot = movementSums.get(m.no) ?? { sum: 0, n: 0 };
      slot.sum += m.mark;
      slot.n += 1;
      movementSums.set(m.no, slot);
    }
    if (s.collectiveMarksJson) {
      const cMarks = JSON.parse(s.collectiveMarksJson) as Array<{ no: number; mark: number | null }>;
      for (const m of cMarks) {
        if (m.mark === null || m.mark === undefined) continue;
        const slot = collectiveSums.get(m.no) ?? { sum: 0, n: 0 };
        slot.sum += m.mark;
        slot.n += 1;
        collectiveSums.set(m.no, slot);
      }
    }
  }
  let total = 0;
  for (const m of movements) {
    const slot = movementSums.get(m.no);
    if (!slot) continue;
    total += (slot.sum / slot.n) * m.coefficient;
  }
  for (let i = 0; i < collectives.length; i++) {
    const slot = collectiveSums.get(i + 1);
    if (!slot) continue;
    total += (slot.sum / slot.n) * collectives[i].coefficient;
  }
  if (maxScore === 0) return { percentage: 0, mode, judgeCount: valid.length, spread: Math.round(spread * 10) / 10 };
  return {
    percentage: Math.round((total / maxScore) * 1000) / 10,
    mode,
    judgeCount: valid.length,
    spread: Math.round(spread * 10) / 10,
  };
}
