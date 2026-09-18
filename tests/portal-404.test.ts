// A page that calls notFound() can only answer 404 if nothing above it streams.
//
// Next flushes the response headers as soon as a segment has a loading.tsx, so
// by the time the page runs and calls notFound() the status is already sent —
// and a link to a record you may not see answers 200 with the not-found page in
// the body. Nothing leaks, but the app says "fine" about a thing that is not.
//
// This bites the school portal specifically, because /school/riders/[id] is
// reached by an id in the URL and is the fence between one partner school and
// another's children. A 200 there is the one that would be believed.
//
// Scoped to /school on purpose: 27 other pages in this app have the same shape,
// and the fix for them is not free — the admin workspace's skeletons cover real
// dashboards against a remote database, so dropping them to correct a status
// code is a trade worth making deliberately rather than in a test like this one.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

function ancestorsOf(dir: string): string[] {
  const out: string[] = [];
  let cur = dir;
  while (cur.startsWith("app")) {
    out.push(cur);
    cur = path.dirname(cur);
  }
  return out;
}

describe("the school portal can still answer 404", () => {
  it("has no loading.tsx above a page that calls notFound()", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name === "page.tsx" && fs.readFileSync(full, "utf8").includes("notFound()")) {
          for (const a of ancestorsOf(dir)) {
            if (fs.existsSync(path.join(a, "loading.tsx"))) {
              offenders.push(`${full} is streamed by ${path.join(a, "loading.tsx")}`);
            }
          }
        }
      }
    };
    walk("app/school");
    expect(
      offenders,
      "A loading.tsx above these pages makes notFound() answer 200 instead of 404:\n  " +
        offenders.join("\n  "),
    ).toEqual([]);
  });
});
