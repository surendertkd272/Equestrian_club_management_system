import { describe, it, expect } from "vitest";
import { buildTourSteps } from "@/lib/onboarding/tour";

describe("buildTourSteps", () => {
  const base = { roleTitle: "Coach", userName: "Asha Rao", topLabels: ["Lessons", "Attendance", "Progress"] };

  it("desktop: 4 steps, spotlights the sidebar, names the role's top screens", () => {
    const s = buildTourSteps({ ...base, isMobile: false });
    expect(s).toHaveLength(4);
    expect(s[0].target).toBeUndefined(); // welcome is a centered modal
    expect(s[1].target).toBe('[data-tour="sidebar"]');
    expect(s[1].body).toContain("Lessons");
    expect(s[1].body).toContain("Coach");
    expect(s[2].target).toBe('[data-tour="help"]');
    expect(s[3].target).toBeUndefined(); // finish is centered
    expect(s[0].body).toContain("Asha");
  });

  it("mobile: spotlights the menu button instead of the hidden sidebar", () => {
    const s = buildTourSteps({ ...base, isMobile: true });
    expect(s[1].target).toBe('[data-tour="menu-button"]');
  });

  it("handles a role with no listed screens and no name without crashing", () => {
    const s = buildTourSteps({ roleTitle: "Inspection Officer", userName: null, topLabels: [], isMobile: false });
    expect(s).toHaveLength(4);
    expect(s[1].body).toContain("the screens in your menu");
    expect(s[0].body).not.toContain("Hi ");
  });
});
