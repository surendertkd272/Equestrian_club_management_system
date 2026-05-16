// Discipline-specific scoring + tie-break registry.
//
// CompetitionEntry stores three numeric channels (`score`, `faults`, `time`)
// plus a free-form `roundsJson` for per-phase detail. Each discipline below
// decides:
//   • How to display a single result (faults-and-time vs %)
//   • How to rank entries when computing placements
//   • What to print on results sheets
//
// Adding a new discipline = one entry here; the rest of the app reads from
// this module via getDisciplineRules().

export type Discipline = "generic" | "dressage" | "jumping" | "eventing" | "gymkhana";

export type EntryScore = {
  score: number | null;
  faults: number | null;
  time: number | null;
};

export type DisciplineRules = {
  key: Discipline;
  label: string;
  // Short label used in column headers.
  primaryColumn: string;
  // Pretty-print a row's headline result. Empty string when no data yet.
  formatHeadline(e: EntryScore): string;
  // Comparator that puts the WINNER first. Stable; ties fall back to the
  // next channel as appropriate for the discipline.
  rank(a: EntryScore, b: EntryScore): number;
};

function num(x: number | null | undefined): number {
  // Missing values sort to the bottom regardless of direction.
  return typeof x === "number" && !Number.isNaN(x) ? x : Number.POSITIVE_INFINITY;
}

const generic: DisciplineRules = {
  key: "generic",
  label: "Generic",
  primaryColumn: "Score",
  formatHeadline: (e) => (e.score === null ? "" : String(e.score)),
  rank: (a, b) => {
    // Higher score wins; null/undefined go last.
    const av = typeof a.score === "number" ? a.score : Number.NEGATIVE_INFINITY;
    const bv = typeof b.score === "number" ? b.score : Number.NEGATIVE_INFINITY;
    return bv - av;
  },
};

const dressage: DisciplineRules = {
  key: "dressage",
  label: "Dressage",
  primaryColumn: "%",
  formatHeadline: (e) => (e.score === null ? "" : `${e.score.toFixed(2)}%`),
  rank: (a, b) => {
    // Highest percentage wins; tie → fewer faults (collective penalties).
    const sa = typeof a.score === "number" ? a.score : Number.NEGATIVE_INFINITY;
    const sb = typeof b.score === "number" ? b.score : Number.NEGATIVE_INFINITY;
    if (sa !== sb) return sb - sa;
    return num(a.faults) - num(b.faults);
  },
};

const jumping: DisciplineRules = {
  key: "jumping",
  label: "Show jumping",
  primaryColumn: "Faults / Time",
  formatHeadline: (e) => {
    if (e.faults === null && e.time === null) return "";
    const f = e.faults ?? 0;
    const t = e.time !== null ? ` · ${e.time.toFixed(2)}s` : "";
    return `${f} fault${f === 1 ? "" : "s"}${t}`;
  },
  rank: (a, b) => {
    // Fewest faults wins; tie → fastest time.
    const fa = num(a.faults);
    const fb = num(b.faults);
    if (fa !== fb) return fa - fb;
    return num(a.time) - num(b.time);
  },
};

const eventing: DisciplineRules = {
  key: "eventing",
  label: "Eventing",
  primaryColumn: "Penalty total",
  formatHeadline: (e) => {
    if (e.score === null && e.faults === null) return "";
    const pen = e.score ?? 0;
    return `${pen.toFixed(1)} pen.`;
  },
  rank: (a, b) => {
    // Lowest penalty total wins; tie → cross-country closest to optimal
    // (we encode that as the smaller `time` value being better; teams set
    // negative time when under optimum). Final tie → dressage % via faults
    // channel (higher better).
    const pa = num(a.score);
    const pb = num(b.score);
    if (pa !== pb) return pa - pb;
    const ta = num(a.time);
    const tb = num(b.time);
    if (ta !== tb) return ta - tb;
    const fa = typeof a.faults === "number" ? a.faults : Number.NEGATIVE_INFINITY;
    const fb = typeof b.faults === "number" ? b.faults : Number.NEGATIVE_INFINITY;
    return fb - fa;
  },
};

const gymkhana: DisciplineRules = {
  key: "gymkhana",
  label: "Gymkhana",
  primaryColumn: "Time",
  formatHeadline: (e) => {
    if (e.time === null) return "";
    const f = e.faults ?? 0;
    const fStr = f > 0 ? ` (+${f} pen.)` : "";
    return `${e.time.toFixed(2)}s${fStr}`;
  },
  rank: (a, b) => {
    // Fastest time wins; tie → fewer faults.
    const ta = num(a.time);
    const tb = num(b.time);
    if (ta !== tb) return ta - tb;
    return num(a.faults) - num(b.faults);
  },
};

const REGISTRY: Record<Discipline, DisciplineRules> = {
  generic,
  dressage,
  jumping,
  eventing,
  gymkhana,
};

export function getDisciplineRules(d: string | null | undefined): DisciplineRules {
  if (d && (REGISTRY as Record<string, DisciplineRules>)[d]) return REGISTRY[d as Discipline];
  return generic;
}

export function rankEntries<T extends EntryScore>(d: string | null | undefined, entries: T[]): T[] {
  const rules = getDisciplineRules(d);
  return [...entries].sort((a, b) => rules.rank(a, b));
}

export const DISCIPLINES: Discipline[] = ["generic", "dressage", "jumping", "eventing", "gymkhana"];
