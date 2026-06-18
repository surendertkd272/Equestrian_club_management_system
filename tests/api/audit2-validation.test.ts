// Audit-2 batch ③ — server-side validation gaps:
//   1. Event PATCH could invert the date window (one-sided edit) — the create
//      refine can't fire when only one of start/end is supplied.
//   2. Exam score submission accepted a per-item score above the rubric max,
//      inflating the total and potentially flipping a fail into an auto-pass.
//   3. Injury occurredAt / recoveredAt had no date sanity (future-dated injury,
//      recovery before the injury).

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkOrg, mkCentre, mkUser, mkRider } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { signSession } from "@/lib/auth";
import { mockReq } from "../helpers/request";
import type { SessionPayload } from "@/lib/auth";
import type { Role } from "@/lib/roles";

const cookieJar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (n: string) => cookieJar.get(n),
    set: (n: string, v: string) => cookieJar.set(n, { value: v }),
    delete: (n: string) => cookieJar.delete(n),
  }),
}));

const { PATCH: eventPatch } = await import("@/app/api/events/[id]/route");
const { PATCH: examScore } = await import("@/app/api/exams/[id]/score/route");
const { POST: injuryPost } = await import("@/app/api/injuries/route");
const { PATCH: injuryPatch } = await import("@/app/api/injuries/[id]/route");

async function login(u: { id: string; role: string; centreId: string | null; name: string }) {
  cookieJar.clear();
  const payload: SessionPayload = { userId: u.id, role: u.role as Role, centreId: u.centreId, name: u.name, tokenVersion: 0 };
  cookieJar.set("ew_session", { value: await signSession(payload) });
}

function jsonReq(url: string, body: unknown) {
  return mockReq(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

beforeEach(async () => {
  await resetDb();
});

describe("event PATCH cross-field date guard", () => {
  it("rejects a one-sided edit that inverts the start/end window", async () => {
    const org = await mkOrg();
    const centre = await mkCentre({ orgId: org.id });
    const su = await mkUser({ role: "SUPER_ADMIN", centreId: null, orgId: org.id, name: "SU" });
    const ev = await prisma.event.create({
      data: { centreId: centre.id, title: "Spring Clinic", type: "clinic", status: "open",
        startDate: new Date("2026-06-10T00:00:00Z"), endDate: new Date("2026-06-20T00:00:00Z") },
    });
    await login(su);

    // Move endDate before the stored startDate → 400.
    const r1 = await eventPatch(jsonReq(`http://localhost/api/events/${ev.id}`, { endDate: "2026-06-05" }), { params: { id: ev.id } });
    expect(r1.status).toBe(400);
    expect((await r1.json()).error).toBe("INVALID_DATE_RANGE");

    // Move startDate past the stored endDate (endDate absent) → 400.
    const r2 = await eventPatch(jsonReq(`http://localhost/api/events/${ev.id}`, { startDate: "2026-06-25" }), { params: { id: ev.id } });
    expect(r2.status).toBe(400);

    // The row is unchanged after the rejected edits.
    const after = await prisma.event.findUniqueOrThrow({ where: { id: ev.id } });
    expect(after.startDate.toISOString()).toBe("2026-06-10T00:00:00.000Z");
    expect(after.endDate.toISOString()).toBe("2026-06-20T00:00:00.000Z");

    // A valid widening edit succeeds.
    const ok = await eventPatch(jsonReq(`http://localhost/api/events/${ev.id}`, { endDate: "2026-06-22" }), { params: { id: ev.id } });
    expect(ok.status).toBe(200);
  });
});

describe("exam score per-item range guard", () => {
  it("rejects a score above the rubric item max and accepts an in-range score", async () => {
    const org = await mkOrg();
    const centre = await mkCentre({ orgId: org.id });
    const su = await mkUser({ role: "SUPER_ADMIN", centreId: null, orgId: org.id, name: "SU" });
    const rider = await mkRider({ centreId: centre.id });
    await prisma.scoringTemplate.create({
      data: {
        centreId: centre.id, levelKey: "1", levelName: "Level 1", passThreshold: 70,
        categoriesJson: [{ name: "Flat", items: [{ name: "Walk", max_score: 10 }] }],
      },
    });
    const exam = await prisma.exam.create({
      data: { centreId: centre.id, riderId: rider.id, level: 1, date: new Date("2026-06-15T00:00:00Z"), status: "scheduled" },
    });
    await login(su);

    const bad = await examScore(jsonReq(`http://localhost/api/exams/${exam.id}/score`, { scores: { "Flat_Walk": 100 } }), { params: { id: exam.id } });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("SCORE_OUT_OF_RANGE");
    // Nothing persisted.
    expect((await prisma.exam.findUniqueOrThrow({ where: { id: exam.id } })).totalScore).toBeNull();

    const ok = await examScore(jsonReq(`http://localhost/api/exams/${exam.id}/score`, { scores: { "Flat_Walk": 8 } }), { params: { id: exam.id } });
    expect(ok.status).toBe(200);
    expect((await ok.json()).totalScore).toBe(8);
  });
});

describe("injury date sanity", () => {
  async function setup() {
    const org = await mkOrg(); // mkOrg seeds org features (incl. "injuries")
    const centre = await mkCentre({ orgId: org.id });
    const coach = await mkUser({ role: "COACH", centreId: centre.id, name: "Coach" });
    const rider = await mkRider({ centreId: centre.id });
    return { centre, coach, rider };
  }

  it("rejects a future-dated injury on create", async () => {
    const { coach, rider } = await setup();
    await login(coach);
    const future = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    const res = await injuryPost(mockReq("http://localhost/api/injuries", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subjectType: "rider", subjectId: rider.id, occurredAt: future, severity: "minor", initialNotes: "x" }),
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("OCCURRED_IN_FUTURE");
  });

  it("rejects a recovery date before the injury date", async () => {
    const { coach, centre, rider } = await setup();
    const row = await prisma.injuryLog.create({
      data: { centreId: centre.id, subjectType: "rider", subjectId: rider.id, occurredAt: new Date("2026-06-10T00:00:00Z"), initialNotes: "y", severity: "minor" },
    });
    await login(coach);
    const res = await injuryPatch(jsonReq(`http://localhost/api/injuries/${row.id}`, { status: "recovered", recoveredAt: "2026-06-05" }), { params: { id: row.id } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("RECOVERED_BEFORE_OCCURRED");

    // A valid recovery date stamps recoveredAt.
    const ok = await injuryPatch(jsonReq(`http://localhost/api/injuries/${row.id}`, { status: "recovered", recoveredAt: "2026-06-12" }), { params: { id: row.id } });
    expect(ok.status).toBe(200);
    expect((await prisma.injuryLog.findUniqueOrThrow({ where: { id: row.id } })).recoveredAt?.toISOString()).toBe("2026-06-12T00:00:00.000Z");
  });
});
