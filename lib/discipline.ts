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

export type Discipline =
  | "generic"
  | "dressage"
  | "jumping"
  | "eventing"
  | "gymkhana"
  | "tent_pegging"
  | "polo"
  | "hacks"
  | "endurance";

export type EntryScore = {
  score: number | null;
  faults: number | null;
  time: number | null;
};

// The three numeric channels a judge can fill on an entry.
export type ScoreChannel = "score" | "faults" | "time";

export type DisciplineRules = {
  key: Discipline;
  label: string;
  // Short label used in column headers.
  primaryColumn: string;
  // Which channels this discipline actually uses — drives which input columns
  // the ringside judge view shows (so we don't ask for "faults" on a hack class).
  inputs: ScoreChannel[];
  // Label for the `score` channel input ("%", "Goals", "Points", "Marks").
  // Defaults to "Score" when omitted.
  scoreLabel?: string;
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
  inputs: ["score"],
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
  inputs: ["score"],
  scoreLabel: "%",
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
  inputs: ["faults", "time"],
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
  inputs: ["score", "faults", "time"],
  scoreLabel: "Penalty",
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
  inputs: ["time", "faults"],
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

// ── The four disciplines that previously borrowed generic/gymkhana now have
// their own engines. ────────────────────────────────────────────────────────

// Tent pegging: accuracy POINTS decide it (carry 6 / draw 4 / strike 2 …),
// fastest run breaks ties. Distinct from gymkhana (time-first) and generic
// (ignores time entirely).
const tentPegging: DisciplineRules = {
  key: "tent_pegging",
  label: "Tent Pegging",
  primaryColumn: "Points / Time",
  inputs: ["score", "time"],
  scoreLabel: "Points",
  formatHeadline: (e) => {
    if (e.score === null && e.time === null) return "";
    const pts = e.score ?? 0;
    const t = e.time !== null ? ` · ${e.time.toFixed(2)}s` : "";
    return `${pts} pt${pts === 1 ? "" : "s"}${t}`;
  },
  rank: (a, b) => {
    // Most points wins; tie → fastest time.
    const sa = typeof a.score === "number" ? a.score : Number.NEGATIVE_INFINITY;
    const sb = typeof b.score === "number" ? b.score : Number.NEGATIVE_INFINITY;
    if (sa !== sb) return sb - sa;
    return num(a.time) - num(b.time);
  },
};

// Polo: goals scored, highest wins.
const polo: DisciplineRules = {
  key: "polo",
  label: "Polo",
  primaryColumn: "Goals",
  inputs: ["score"],
  scoreLabel: "Goals",
  formatHeadline: (e) => (e.score === null ? "" : `${e.score} goal${e.score === 1 ? "" : "s"}`),
  rank: (a, b) => {
    const av = typeof a.score === "number" ? a.score : Number.NEGATIVE_INFINITY;
    const bv = typeof b.score === "number" ? b.score : Number.NEGATIVE_INFINITY;
    return bv - av;
  },
};

// Hacks: judged on the horse's way of going / manners — highest marks win.
const hacks: DisciplineRules = {
  key: "hacks",
  label: "Hacks",
  primaryColumn: "Marks",
  inputs: ["score"],
  scoreLabel: "Marks",
  formatHeadline: (e) => (e.score === null ? "" : `${e.score} marks`),
  rank: (a, b) => {
    const av = typeof a.score === "number" ? a.score : Number.NEGATIVE_INFINITY;
    const bv = typeof b.score === "number" ? b.score : Number.NEGATIVE_INFINITY;
    return bv - av;
  },
};

// Endurance: complete the ride in the fastest time (vet gates gate eligibility
// upstream). No faults/penalties channel — purely time.
const endurance: DisciplineRules = {
  key: "endurance",
  label: "Endurance",
  primaryColumn: "Time",
  inputs: ["time"],
  formatHeadline: (e) => (e.time === null ? "" : `${e.time.toFixed(2)}`),
  rank: (a, b) => num(a.time) - num(b.time),
};

const REGISTRY: Record<Discipline, DisciplineRules> = {
  generic,
  dressage,
  jumping,
  eventing,
  gymkhana,
  tent_pegging: tentPegging,
  polo,
  hacks,
  endurance,
};

export function getDisciplineRules(d: string | null | undefined): DisciplineRules {
  if (d && (REGISTRY as Record<string, DisciplineRules>)[d]) return REGISTRY[d as Discipline];
  return generic;
}

// Maps a competition-builder discipline (lib/competition-disciplines.ts keys) to
// the scoring engine that ranks + formats its events. A competition can now span
// several disciplines, so each class/event resolves its own engine from here;
// the competition-wide "scoring type" is only the fallback for events with no
// discipline (legacy rows) or a discipline not listed below.
const DISCIPLINE_TO_ENGINE: Record<string, Discipline> = {
  jumping: "jumping",
  dressage: "dressage",
  eventing: "eventing",
  gymkhana: "gymkhana",
  // Each of these now has its own engine (was a generic/gymkhana placeholder).
  tent_pegging: "tent_pegging",
  endurance: "endurance",
  polo: "polo",
  hacks: "hacks",
};

// Resolve the scoring engine key for a single event. `classDiscipline` is the
// event's parent discipline (a builder key); `fallback` is the competition's
// scoring-type selector (already an engine key).
export function scoringEngineFor(
  classDiscipline: string | null | undefined,
  fallback: string | null | undefined,
): Discipline {
  if (classDiscipline && DISCIPLINE_TO_ENGINE[classDiscipline]) return DISCIPLINE_TO_ENGINE[classDiscipline];
  if (fallback && (REGISTRY as Record<string, DisciplineRules>)[fallback]) return fallback as Discipline;
  return "generic";
}

// Convenience: rules for an event, resolved per-discipline with a fallback.
export function getDisciplineRulesForClass(
  classDiscipline: string | null | undefined,
  fallback: string | null | undefined,
): DisciplineRules {
  return getDisciplineRules(scoringEngineFor(classDiscipline, fallback));
}

export function rankEntries<T extends EntryScore>(d: string | null | undefined, entries: T[]): T[] {
  const rules = getDisciplineRules(d);
  return [...entries].sort((a, b) => rules.rank(a, b));
}

export const DISCIPLINES: Discipline[] = ["generic", "dressage", "jumping", "eventing", "gymkhana"];
