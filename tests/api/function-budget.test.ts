// The app is billed by the second that a serverless function is alive, so a
// route that holds a connection open is not a performance question — it is the
// difference between the site being up and the platform switching it off.
//
// This has happened twice. The notifications bell used Server-Sent Events,
// which keeps a function running for as long as a staff member has the app
// open: roughly 1.7 GB-hours per user per hour on Vercel's default memory, so
// one person working one week spent the whole month's function budget. Both
// times the symptom was the entire site answering 402 DEPLOYMENT_DISABLED —
// the admin panel, the registration links on school noticeboards, and the
// consent links already sitting in parents' inboxes.
//
// A long-lived stream is a reasonable thing to want and an easy thing to
// reintroduce, especially since the code reads as an optimisation. This fails
// the build instead, and says what to do about it.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

function routeFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? routeFiles(full) : e.name === "route.ts" ? [full] : [];
  });
}

describe("no route may hold a serverless function open", () => {
  it("has no Server-Sent Events endpoints", () => {
    const streaming = routeFiles("app/api").filter((f) =>
      fs.readFileSync(f, "utf8").includes("text/event-stream"),
    );
    expect(
      streaming,
      `These routes stream, which bills for the whole time a client stays connected and\n` +
        `has twice paused the project (402 DEPLOYMENT_DISABLED). Poll a cheap endpoint on\n` +
        `an interval instead — see components/shell/notifications-dropdown.tsx — or move\n` +
        `off per-second function billing before adding one:\n  ${streaming.join("\n  ")}`,
    ).toEqual([]);
  });

  it("keeps long maxDuration for scheduled work only", () => {
    // A 5-minute budget is right for a nightly sweep and wrong for anything a
    // browser opens: the ceiling is per invocation, so a user-facing route that
    // can run for minutes is a bill with a UI attached.
    const cfg = JSON.parse(fs.readFileSync("vercel.json", "utf8"));
    const SCHEDULED = ["app/api/cron/", "app/api/reports/monthly-dispatch/"];
    const longRunning = Object.entries(cfg.functions ?? {})
      .filter(([, v]) => ((v as { maxDuration?: number }).maxDuration ?? 0) > 60)
      .map(([k]) => k)
      .filter((k) => !SCHEDULED.some((s) => k.startsWith(s)));
    expect(
      longRunning,
      `Routes with maxDuration over 60s that aren't scheduled jobs:\n  ${longRunning.join("\n  ")}`,
    ).toEqual([]);
  });
});
