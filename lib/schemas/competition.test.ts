import { describe, it, expect } from "vitest";
import { createCompetitionSchema, updateCompetitionSchema, COMPETITION_SCOPES } from "./competition";

describe("createCompetitionSchema — scope", () => {
  const base = {
    name: "Spring Cup",
    slug: "spring-cup-2026",
    startDate: "2026-05-14",
    endDate: "2026-05-15",
    classes: [{ name: "L1 Walk/Trot", fee: 500 }],
  };

  it("defaults scope to 'internal' when omitted", () => {
    const r = createCompetitionSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.scope).toBe("internal");
  });

  it.each(COMPETITION_SCOPES.map((s) => [s]))("accepts scope %s", (scope) => {
    const r = createCompetitionSchema.safeParse({ ...base, scope });
    expect(r.success).toBe(true);
  });

  it("rejects unknown scope values", () => {
    const r = createCompetitionSchema.safeParse({ ...base, scope: "regional" });
    expect(r.success).toBe(false);
  });
});

describe("updateCompetitionSchema — scope", () => {
  it("allows scope on its own (no status/name needed)", () => {
    const r = updateCompetitionSchema.safeParse({ scope: "state" });
    expect(r.success).toBe(true);
  });
  it("rejects unknown scope on update", () => {
    const r = updateCompetitionSchema.safeParse({ scope: "club" });
    expect(r.success).toBe(false);
  });
});
