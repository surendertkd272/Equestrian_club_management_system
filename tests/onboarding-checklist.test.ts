import { describe, it, expect } from "vitest";
import { buildChecklist } from "@/lib/onboarding/checklist";

describe("buildChecklist", () => {
  it("gives a staff role the universal items + their role tasks", () => {
    const tasks = buildChecklist("COACH");
    const keys = tasks.map((t) => t.key);
    expect(keys).toContain("tour");
    expect(keys).toContain("photo");
    expect(keys).toContain("attendance");
    // universal items are auto-detected; role items are manual
    expect(tasks.find((t) => t.key === "tour")?.auto).toBe("tour");
    expect(tasks.find((t) => t.key === "attendance")?.auto).toBeUndefined();
  });

  it("returns nothing for admin roles (they have the SetupChecklist instead)", () => {
    expect(buildChecklist("SUPER_ADMIN")).toEqual([]);
    expect(buildChecklist("ADMIN")).toEqual([]);
    expect(buildChecklist("CENTRE_MANAGER")).toEqual([]);
  });

  it("returns nothing for portal / non-dashboard roles", () => {
    expect(buildChecklist("RIDER")).toEqual([]);
    expect(buildChecklist("PARENT")).toEqual([]);
    expect(buildChecklist("SCHOOL_ADMINISTRATOR")).toEqual([]);
    expect(buildChecklist("INSPECTION_OFFICER")).toEqual([]);
  });

  it("every task has a key, label, and href", () => {
    for (const role of ["COACH", "VET", "ACCOUNTANT", "GROOM"] as const) {
      for (const t of buildChecklist(role)) {
        expect(t.key).toBeTruthy();
        expect(t.label).toBeTruthy();
        expect(t.href).toBeTruthy();
      }
    }
  });
});
