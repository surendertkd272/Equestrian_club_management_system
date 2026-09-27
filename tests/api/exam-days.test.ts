// Gaps from the 200-rider exam-day simulation (2026-09-28): exam days,
// bookability + level order, the 50-rider cap, one summary notification per
// sitting/day, the day/sitting export filters, and temp-password API access.

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

const { POST: createDay } = await import("@/app/api/exam-days/route");
const { PATCH: patchDay, DELETE: cancelDay } = await import("@/app/api/exam-days/[id]/route");
const { POST: createSitting } = await import("@/app/api/exam-sittings/route");
const { POST: claim } = await import("@/app/api/exams/[id]/claim/route");
const { PATCH: score } = await import("@/app/api/exams/[id]/score/route");
const { GET: exportGet } = await import("@/app/api/export/[entity]/route");
const { middleware } = await import("@/middleware");

type U = { id: string; role: string; centreId: string | null; name: string };
async function login(u: U) {
  cookieJar.clear();
  const payload: SessionPayload = { userId: u.id, role: u.role as Role, centreId: u.centreId, name: u.name, tokenVersion: 0 };
  cookieJar.set("ew_session", { value: await signSession(payload) });
}
const json = (method: string, url: string, body?: unknown) =>
  mockReq(`http://localhost${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const RUBRIC = [{ name: "Flat", items: [{ name: "Walk", max_score: 10 }] }];

beforeEach(async () => {
  await resetDb();
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3100";
});

async function world(riderCount = 6) {
  const org = await mkOrg();
  const centre = await mkCentre({ orgId: org.id });
  const manager = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id, name: "Manager" });
  await prisma.centre.update({ where: { id: centre.id }, data: { managerId: manager.id } });
  const ex1 = await mkUser({ role: "EXAMINER", centreId: centre.id, name: "Ex One" });
  const ex2 = await mkUser({ role: "EXAMINER", centreId: centre.id, name: "Ex Two" });
  for (const k of ["1", "2", "3"]) {
    await prisma.scoringTemplate.create({
      data: { centreId: centre.id, levelKey: k, levelName: `Level ${k}`, passThreshold: 70, categoriesJson: RUBRIC },
    });
  }
  const riders = [];
  for (let i = 0; i < riderCount; i++) {
    riders.push(await mkRider({ centreId: centre.id, firstName: `R${i}`, mobile: `98765${String(10000 + i)}` }));
  }
  return { org, centre, manager, ex1, ex2, riders };
}

describe("exam days", () => {
  it("books several levels on one date as one day, one sitting per level", async () => {
    const w = await world();
    await prisma.rider.update({ where: { id: w.riders[4].id }, data: { currentLevel: "Level 1" } });
    await prisma.rider.update({ where: { id: w.riders[5].id }, data: { currentLevel: "Level 2" } });
    await login(w.manager);
    const r = await createDay(
      json("POST", "/api/exam-days", {
        name: "Autumn exams",
        date: "2026-10-10",
        time: "08:00",
        entries: [
          ...w.riders.slice(0, 4).map((x) => ({ riderId: x.id, level: 1 })),
          { riderId: w.riders[4].id, level: 2 },
          { riderId: w.riders[5].id, level: 3 },
        ],
        pools: { "1": [w.ex1.id], "2": [w.ex2.id], "3": [w.ex1.id, w.ex2.id] },
      }),
    );
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.examsCreated).toBe(6);
    const sittings = await prisma.examSitting.findMany({ where: { examDayId: body.id }, include: { exams: true, examiners: true }, orderBy: { level: "asc" } });
    expect(sittings.map((s) => [s.level, s.exams.length, s.examiners.length])).toEqual([[1, 4, 1], [2, 1, 1], [3, 1, 2]]);
    expect(sittings.every((s) => s.exams.every((e) => e.rubricSnapshotJson !== null && e.time === "08:00"))).toBe(true);
  });

  it("refuses riders who can't be booked, with the reason", async () => {
    const w = await world(2);
    await prisma.rider.update({ where: { id: w.riders[1].id }, data: { status: "pending_consent" } });
    await login(w.manager);
    const r = await createDay(
      json("POST", "/api/exam-days", {
        name: "Day",
        date: "2026-10-10",
        entries: w.riders.map((x) => ({ riderId: x.id, level: 1 })),
        pools: { "1": [w.ex1.id] },
      }),
    );
    expect(r.status).toBe(409);
    const b = await r.json();
    expect(b.error).toBe("RIDER_NOT_BOOKABLE");
    expect(b.message).toMatch(/consent/);
    expect(await prisma.examDay.count()).toBe(0);
  });

  it("needs a deliberate yes to skip a level, and an examiner pool per level", async () => {
    const w = await world(1);
    await login(w.manager);
    const base = { name: "Day", date: "2026-10-10", entries: [{ riderId: w.riders[0].id, level: 3 }] };
    const noPool = await createDay(json("POST", "/api/exam-days", { ...base, pools: {} }));
    expect((await noPool.json()).error).toBe("POOL_REQUIRED");
    const skip = await createDay(json("POST", "/api/exam-days", { ...base, pools: { "3": [w.ex1.id] } }));
    expect(skip.status).toBe(409);
    expect((await skip.json()).error).toBe("LEVEL_SKIP");
    const ok = await createDay(json("POST", "/api/exam-days", { ...base, pools: { "3": [w.ex1.id] }, allowSkipLevels: true }));
    expect(ok.status).toBe(200);
    // Same rule on a single sitting.
    const r2 = await mkRider({ centreId: w.centre.id, mobile: "9123412345" });
    const s = await createSitting(json("POST", "/api/exam-sittings", { level: 2, date: "2026-10-10", examinerIds: [w.ex1.id], riderIds: [r2.id] }));
    expect((await s.json()).error).toBe("LEVEL_SKIP");
  });

  it("moves every level together, and stops moving once there are results; cancelling keeps results", async () => {
    const w = await world(3);
    await login(w.manager);
    const day = await (await createDay(
      json("POST", "/api/exam-days", {
        name: "Day", date: "2026-10-10",
        entries: w.riders.map((x) => ({ riderId: x.id, level: 1 })),
        pools: { "1": [w.ex1.id] },
      }),
    )).json();
    const mv = await patchDay(json("PATCH", `/api/exam-days/${day.id}`, { date: "2026-10-17", time: "07:30" }), { params: { id: day.id } });
    expect((await mv.json()).examsMoved).toBe(3);
    const exams = await prisma.exam.findMany({ where: { sitting: { examDayId: day.id } } });
    expect(exams.every((e) => e.date.toISOString().startsWith("2026-10-17") && e.time === "07:30")).toBe(true);

    await prisma.exam.update({ where: { id: exams[0].id }, data: { status: "completed", passed: true, totalScore: 9 } });
    const frozen = await patchDay(json("PATCH", `/api/exam-days/${day.id}`, { date: "2026-10-24" }), { params: { id: day.id } });
    expect((await frozen.json()).error).toBe("DAY_HAS_RESULTS");

    const c = await (await cancelDay(json("DELETE", `/api/exam-days/${day.id}`, {}), { params: { id: day.id } })).json();
    expect(c).toMatchObject({ removed: 2, kept: 1, dayRemoved: false });
    expect(await prisma.exam.count({ where: { id: exams[0].id } })).toBe(1);
  });

  it("books more than 50 riders into one sitting", async () => {
    const w = await world(60);
    await login(w.manager);
    const r = await createSitting(json("POST", "/api/exam-sittings", { level: 1, date: "2026-10-10", examinerIds: [w.ex1.id], riderIds: w.riders.map((x) => x.id) }));
    expect(r.status).toBe(200);
    expect((await r.json()).examsCreated).toBe(60);
  });
});

describe("one summary per sitting and per day, not one per rider", () => {
  it("tells the manager once when each level finishes and once when the day does", async () => {
    const w = await world(3);
    await login(w.manager);
    const day = await (await createDay(
      json("POST", "/api/exam-days", {
        name: "Summary day", date: "2026-10-10",
        entries: [
          { riderId: w.riders[0].id, level: 1 },
          { riderId: w.riders[1].id, level: 1 },
          { riderId: w.riders[2].id, level: 1 },
        ],
        pools: { "1": [w.ex1.id] },
      }),
    )).json();
    const exams = await prisma.exam.findMany({ where: { sitting: { examDayId: day.id } } });
    await login(w.ex1);
    for (const [i, e] of exams.entries()) {
      await claim(json("POST", `/api/exams/${e.id}/claim`, {}), { params: { id: e.id } });
      const r = await score(json("PATCH", `/api/exams/${e.id}/score`, { scores: { Flat_Walk: i === 0 ? 3 : 9 }, final: true }), { params: { id: e.id } });
      expect(r.status).toBe(200);
    }
    const notes = await prisma.notification.findMany({ where: { userId: w.manager.id }, select: { type: true, title: true } });
    const types = notes.map((n) => n.type).sort();
    expect(types).toEqual(["exam.day_complete", "exam.sitting_complete"]);
    expect(notes.find((n) => n.type === "exam.sitting_complete")!.title).toMatch(/2 of 3 passed/);
    // The examiner who pressed Submit isn't notified about their own submission.
    expect(await prisma.notification.count({ where: { userId: w.ex1.id, type: { in: ["exam.passed", "exam.failed"] } } })).toBe(0);
  });
});

describe("results export filters", () => {
  it("exports one exam day on its own", async () => {
    const w = await world(4);
    await login(w.manager);
    const mk = (ids: string[]) =>
      createDay(json("POST", "/api/exam-days", { name: "Day A", date: "2026-10-10", entries: ids.map((riderId) => ({ riderId, level: 1 })), pools: { "1": [w.ex1.id] } }));
    const a = await (await mk([w.riders[0].id, w.riders[1].id])).json();
    expect(a.id, JSON.stringify(a)).toBeTruthy();
    await mk([w.riders[2].id, w.riders[3].id]);
    const res = await exportGet(json("GET", `/api/export/exams?dayId=${a.id}`), { params: { entity: "exams" } });
    expect([res.status, res.headers.get("x-total-count")]).toEqual([200, "2"]);
    const lines = (await res.text()).replace(/^﻿/, "").trim().split("\r\n");
    expect(lines.length - 1).toBe(2);
  });
});

describe("temporary password", () => {
  it("blocks API calls until the password is changed, except the change itself", async () => {
    const payload: SessionPayload = { userId: "u1", role: "EXAMINER" as Role, centreId: "c1", name: "New", tokenVersion: 0, mustRotate: true };
    const token = await signSession(payload);
    const call = (path: string) =>
      middleware(mockReq(`http://localhost${path}`, { method: "POST", headers: { cookie: `ew_session=${token}` } }));
    const blocked = await call("/api/exams/x/claim");
    expect(blocked.status).toBe(403);
    expect((await blocked.json()).error).toBe("PASSWORD_ROTATION_REQUIRED");
    const allowed = await call("/api/account/change-password");
    expect(allowed.status).not.toBe(403);
    // A normal session is untouched.
    const normal = await signSession({ ...payload, mustRotate: undefined });
    const ok = await middleware(mockReq("http://localhost/api/exams/x/claim", { method: "POST", headers: { cookie: `ew_session=${normal}` } }));
    expect(ok.status).not.toBe(403);
  });
});
