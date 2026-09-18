// A page that calls notFound() can only answer 404 if nothing above it streams.
//
// Next flushes the response headers as soon as a segment has a loading.tsx, so
// by the time the page runs and calls notFound() the status is already sent —
// and a link to a record that does not exist, or that this account may not see,
// answers 200 with the not-found page in the body. Nothing leaks; the app just
// says "fine" about a thing that is not.
//
// This was true of 28 of the 31 pages in this app that call notFound(), which is
// why it is a test and not a note. Two other fixes were tried and did not work,
// so don't reach for them again: a layout-level existence check (layouts resolve
// inside the same boundary) and notFound() from generateMetadata (metadata does
// not gate the flush either). The only thing that works is having no loading.tsx
// above the page.
//
// That is a real trade — a loading file is what makes a click feel instant — so
// the skeletons that shadow nothing were deliberately kept, including the two
// heaviest pages in the app, /dashboard and /hq-dashboard. If you are adding a
// loading.tsx and this test fails, the question is not "how do I silence it" but
// "does this segment contain a page addressed by an id". If it does, the skeleton
// costs you the status code.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

function pagesCallingNotFound(dir = "app"): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name === "page.tsx" && fs.readFileSync(full, "utf8").includes("notFound()")) {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out;
}

describe("notFound() can still set a 404", () => {
  it("has no loading.tsx above any page that calls notFound()", () => {
    const offenders: string[] = [];
    for (const page of pagesCallingNotFound()) {
      let seg = path.dirname(page);
      while (seg.startsWith("app")) {
        if (fs.existsSync(path.join(seg, "loading.tsx"))) {
          offenders.push(`${page}\n      ← streamed by ${path.join(seg, "loading.tsx")}`);
        }
        seg = path.dirname(seg);
      }
    }
    expect(
      offenders,
      "These pages answer 200 instead of 404, because a loading.tsx above them " +
        "flushes the headers first:\n  " + offenders.join("\n  "),
    ).toEqual([]);
  });

  it("still has skeletons where they cost nothing", () => {
    // The point of the rule above is not "skeletons are bad". These shadow no
    // notFound() page, so they keep instant feedback on the slowest screens.
    for (const f of [
      "app/(admin)/dashboard/loading.tsx",
      "app/(admin)/hq-dashboard/loading.tsx",
      "app/student/loading.tsx",
      "app/account/loading.tsx",
    ]) {
      expect(fs.existsSync(f), `${f} should still exist`).toBe(true);
    }
  });
});
