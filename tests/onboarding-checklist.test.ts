import { describe, it, expect } from "vitest";
import { buildChecklist } from "@/lib/onboarding/checklist";
import { FEATURE_KEYS } from "@/lib/features";

const ALL = new Set(FEATURE_KEYS); // every module enabled
const NONE = new Set<(typeof FEATURE_KEYS)[number]>();

describe("buildChecklist", () => {
  it("gives a staff role the universal items + their role tasks", () => {
    const tasks = buildChecklist("COACH", ALL);
    const keys = tasks.map((t) => t.key);
    expect(keys).toContain("tour");
    expect(keys).toContain("photo");
    expect(keys).toContain("attendance");
    expect(tasks.find((t) => t.key === "tour")?.auto).toBe("tour");
    expect(tasks.find((t) => t.key === "attendance")?.auto).toBeUndefined();
  });

  it("returns nothing for admin roles (they have the SetupChecklist / are HQ operators)", () => {
    expect(buildChecklist("SUPER_ADMIN", ALL)).toEqual([]);
    expect(buildChecklist("ADMIN", ALL)).toEqual([]);
    expect(buildChecklist("CENTRE_MANAGER", ALL)).toEqual([]);
  });

  it("returns nothing for portal / non-dashboard roles", () => {
    expect(buildChecklist("RIDER", ALL)).toEqual([]);
    expect(buildChecklist("PARENT", ALL)).toEqual([]);
    expect(buildChecklist("SCHOOL_ADMINISTRATOR", ALL)).toEqual([]);
    expect(buildChecklist("INSPECTION_OFFICER", ALL)).toEqual([]);
  });

  it("hides tasks whose feature the club has disabled, keeping the universal items", () => {
    // VET's three role tasks (medicines, vaccinations, vet-followups) are all
    // behind the vet-records feature. With no features enabled they drop out,
    // but the un-gated universal items remain.
    const vetNone = buildChecklist("VET", NONE);
    expect(vetNone.map((t) => t.key)).toEqual(["tour", "photo"]);
    const vetAll = buildChecklist("VET", ALL);
    expect(vetAll.length).toBeGreaterThan(2);
    expect(vetAll.map((t) => t.key)).toContain("medicines");
  });

  it("every task has a key, label, and href", () => {
    for (const role of ["COACH", "VET", "ACCOUNTANT", "GROOM"] as const) {
      for (const t of buildChecklist(role, ALL)) {
        expect(t.key).toBeTruthy();
        expect(t.label).toBeTruthy();
        expect(t.href).toBeTruthy();
      }
    }
  });
});
