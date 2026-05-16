import { describe, it, expect } from "vitest";
import {
  parseRubric,
  computeTotal,
  rubricSchema,
  createExamSchema,
  updateExamScoreSchema,
  updateScoringTemplateSchema,
  type RubricCategory,
} from "./exam";

const SAMPLE: RubricCategory[] = [
  {
    name: "Position & Seat",
    items: [
      { name: "balance", max_score: 10 },
      { name: "alignment", max_score: 10 },
    ],
  },
  {
    name: "Aids",
    items: [
      { name: "leg", max_score: 5 },
      { name: "hand", max_score: 5 },
    ],
  },
];

describe("parseRubric", () => {
  it("parses a valid rubric JSON string", () => {
    const out = parseRubric(JSON.stringify(SAMPLE));
    expect(out).toHaveLength(2);
    expect(out[0].items).toHaveLength(2);
  });
  it("returns [] for null / undefined / empty", () => {
    expect(parseRubric(null)).toEqual([]);
    expect(parseRubric(undefined)).toEqual([]);
    expect(parseRubric("")).toEqual([]);
  });
  it("returns [] for malformed JSON without throwing", () => {
    expect(parseRubric("{not json")).toEqual([]);
  });
  it("returns [] when JSON parses but fails schema validation", () => {
    expect(parseRubric(JSON.stringify({ wrong: "shape" }))).toEqual([]);
    // Categories must have items: array.min(1)
    expect(parseRubric(JSON.stringify([{ name: "Cat", items: [] }]))).toEqual([]);
  });
});

describe("computeTotal", () => {
  it("sums numeric scores and computes max correctly", () => {
    const scores = {
      "Position & Seat_balance": 8,
      "Position & Seat_alignment": 7,
      "Aids_leg": 4,
      "Aids_hand": 5,
    };
    const { total, max } = computeTotal(SAMPLE, scores);
    expect(total).toBe(24);
    expect(max).toBe(30);
  });

  it("treats missing scores as zero contribution but still counts max", () => {
    const scores = { "Position & Seat_balance": 9 }; // others missing
    const { total, max } = computeTotal(SAMPLE, scores);
    expect(total).toBe(9);
    expect(max).toBe(30);
  });

  it("ignores string-typed scores (text / select items)", () => {
    const scores = {
      "Position & Seat_balance": 10,
      "Position & Seat_alignment": "good", // string — should not count
    };
    const { total, max } = computeTotal(SAMPLE, scores);
    expect(total).toBe(10);
    // max still includes the alignment item (its type is numeric by default).
    expect(max).toBe(30);
  });

  it("skips non-numeric categories entirely (e.g. type=text)", () => {
    const rubric: RubricCategory[] = [
      { name: "Numeric", items: [{ name: "a", max_score: 10 }] },
      { name: "Notes", type: "text", items: [{ name: "note", max_score: 0 }] },
    ];
    const { total, max } = computeTotal(rubric, { Numeric_a: 7, Notes_note: "looked tense" });
    expect(total).toBe(7);
    expect(max).toBe(10);
  });

  it("skips items typed as non-numeric within a numeric category", () => {
    const rubric: RubricCategory[] = [
      {
        name: "Mixed",
        items: [
          { name: "score", max_score: 10 },
          { name: "comment", max_score: 0, type: "text" },
        ],
      },
    ];
    const { total, max } = computeTotal(rubric, { Mixed_score: 9, Mixed_comment: "x" });
    expect(total).toBe(9);
    expect(max).toBe(10);
  });

  it("excludes the 'Miscellaneous Questions' category from totals", () => {
    const rubric: RubricCategory[] = [
      { name: "Core", items: [{ name: "a", max_score: 10 }] },
      { name: "Miscellaneous Questions", items: [{ name: "q1", max_score: 5 }] },
    ];
    const { total, max } = computeTotal(rubric, { Core_a: 8, "Miscellaneous Questions_q1": 5 });
    expect(total).toBe(8);
    expect(max).toBe(10);
  });

  it("returns zeros for empty rubric", () => {
    expect(computeTotal([], {})).toEqual({ total: 0, max: 0 });
  });
});

describe("rubricSchema", () => {
  it("accepts a well-formed rubric", () => {
    expect(rubricSchema.safeParse(SAMPLE).success).toBe(true);
  });
  it("rejects a category with no items", () => {
    expect(rubricSchema.safeParse([{ name: "X", items: [] }]).success).toBe(false);
  });
});

describe("createExamSchema", () => {
  it("accepts a minimal valid payload (time defaults)", () => {
    const r = createExamSchema.safeParse({
      riderId: "r1",
      examinerId: "e1",
      level: 2,
      date: "2026-05-14",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.time).toBe("09:00");
      expect(r.data.level).toBe(2);
    }
  });
  it("coerces a numeric level passed as string", () => {
    const r = createExamSchema.safeParse({
      riderId: "r1",
      examinerId: "e1",
      level: "3",
      date: "2026-05-14",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.level).toBe(3);
  });
  it("rejects malformed date", () => {
    const r = createExamSchema.safeParse({
      riderId: "r1",
      examinerId: "e1",
      level: 1,
      date: "14-05-2026",
    });
    expect(r.success).toBe(false);
  });
  it("rejects malformed time", () => {
    const r = createExamSchema.safeParse({
      riderId: "r1",
      examinerId: "e1",
      level: 1,
      date: "2026-05-14",
      time: "9am",
    });
    expect(r.success).toBe(false);
  });
  it("rejects level outside 1..10", () => {
    expect(
      createExamSchema.safeParse({ riderId: "r", examinerId: "e", level: 0, date: "2026-05-14" }).success,
    ).toBe(false);
    expect(
      createExamSchema.safeParse({ riderId: "r", examinerId: "e", level: 11, date: "2026-05-14" }).success,
    ).toBe(false);
  });
});

describe("updateExamScoreSchema", () => {
  it("accepts numeric and string scores", () => {
    const r = updateExamScoreSchema.safeParse({
      scores: { "Cat_a": 7, "Cat_b": "comment" },
      final: true,
    });
    expect(r.success).toBe(true);
  });
  it("defaults final to false", () => {
    const r = updateExamScoreSchema.safeParse({ scores: {} });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.final).toBe(false);
  });
});

describe("updateScoringTemplateSchema", () => {
  it("accepts a valid template payload", () => {
    const r = updateScoringTemplateSchema.safeParse({
      levelName: "L1",
      passThreshold: 60,
      categories: SAMPLE,
    });
    expect(r.success).toBe(true);
  });
  it("rejects passThreshold outside 0..100", () => {
    expect(
      updateScoringTemplateSchema.safeParse({
        levelName: "L1",
        passThreshold: 150,
        categories: SAMPLE,
      }).success,
    ).toBe(false);
  });
});
