// Guards the onboarding-content invariant: every sidebar item must have an
// in-app help guide, and there are no orphan guides. This is what makes new
// features "automatically covered" — ship a nav item without its blurb and
// the build fails here (same discipline as RLS-policy-per-table).

import { describe, it, expect } from "vitest";
import { NAV } from "@/components/shell/sidebar-nav";
import { FEATURE_GUIDES } from "@/lib/onboarding/content";

const navHrefs = NAV.flatMap((g) => g.items.map((i) => i.href));

describe("onboarding content coverage", () => {
  it("every sidebar item has a feature guide", () => {
    const missing = navHrefs.filter((h) => !FEATURE_GUIDES[h]);
    expect(missing, `Add a FEATURE_GUIDES entry in lib/onboarding/content.ts for: ${missing.join(", ")}`).toEqual([]);
  });

  it("has no orphan guides (every guide maps to a real sidebar item)", () => {
    const present = new Set(navHrefs);
    const orphans = Object.keys(FEATURE_GUIDES).filter((h) => !present.has(h));
    expect(orphans, `These guides have no matching nav item: ${orphans.join(", ")}`).toEqual([]);
  });

  it("every guide has a non-empty title and blurb", () => {
    for (const [href, g] of Object.entries(FEATURE_GUIDES)) {
      expect(g.title, `title for ${href}`).toBeTruthy();
      expect(g.blurb, `blurb for ${href}`).toBeTruthy();
    }
  });

  it("any emptyState defines a title and body", () => {
    for (const [href, g] of Object.entries(FEATURE_GUIDES)) {
      if (!g.emptyState) continue;
      expect(g.emptyState.title, `emptyState.title for ${href}`).toBeTruthy();
      expect(g.emptyState.body, `emptyState.body for ${href}`).toBeTruthy();
    }
  });
});
