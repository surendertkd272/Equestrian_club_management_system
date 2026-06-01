// Discipline taxonomy for the competition builder.
//
// This is SEPARATE from the scoring engine in lib/discipline.ts (which keeps the
// generic/dressage/jumping/eventing/gymkhana enum that drives ranking + scoreboard
// columns). These are the human-facing disciplines a competition can offer; each
// selected sub-discipline becomes one class/event on the competition.

export const COMPETITION_DISCIPLINE_OPTIONS = [
  { key: "hacks", label: "Hacks" },
  { key: "jumping", label: "Jumping" },
  { key: "dressage", label: "Dressage" },
  { key: "tent_pegging", label: "Tent Pegging" },
  { key: "endurance", label: "Endurance" },
  { key: "eventing", label: "Eventing" },
  { key: "polo", label: "Polo" },
  { key: "gymkhana", label: "Gymkhana Events" },
] as const;

export type CompetitionDisciplineKey = (typeof COMPETITION_DISCIPLINE_OPTIONS)[number]["key"];

// Suggested sub-disciplines per discipline. Lists are non-exhaustive — staff can
// also type custom sub-disciplines in the builder.
export const SUB_DISCIPLINE_PRESETS: Record<string, string[]> = {
  jumping: ["50 cm", "60 cm", "80 cm"],
  tent_pegging: ["Individual Lance", "Individual Sword", "Individual Rings & Peg"],
  polo: ["Arena Polo", "4 Goal Tournament", "6 Goal Tournament"],
  gymkhana: ["Ball & Bucket Race", "Stick & Ball Race", "Pole Bending Race"],
  hacks: [],
  dressage: [],
  endurance: [],
  eventing: [],
};

export function disciplineLabel(key: string): string {
  return COMPETITION_DISCIPLINE_OPTIONS.find((d) => d.key === key)?.label ?? key;
}
