// Outside (visiting) examiners — found by the 500-rider HPS simulation:
//   • a centre manager could not register one (only HQ could);
//   • their accounts never expired;
//   • as EXAMINERs they could read, search and export every rider in the club.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkOrg, mkCentre, mkUser, mkRider } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { signSession, getSession } from "@/lib/auth";
import { accountStateGate } from "@/lib/sign-in";
import { mockReq } from "../helpers/request";
import type { SessionPayload } from "@/lib/auth";
import type { Role } from "@/lib/roles";
import { examinerRiderScope, riderOutsideExaminerScope } from "@/lib/exam-access";

const cookieJar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (n: string) => cookieJar.get(n),
    set: (n: string, v: string) => cookieJar.set(n, { value: v }),
    delete: (n: string) => cookieJar.delete(n),
  }),
}));

const { POST: register } = await import("@/app/api/examiners/route");
const { PATCH: manage } = await import("@/app/api/examiners/[id]/route");
const { POST: createSitting } = await import("@/app/api/exam-sittings/route");
const { GET: exportGet } = await import("@/app/api/export/[entity]/route");
const { GET: search } = await import("@/app/api/search/route");

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
const inDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const RUBRIC = [{ name: "Flat", items: [{ name: "Walk", max_score: 10 }] }];

beforeEach(async () => {
  await resetDb();
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3100";
});

async function world() {
  const org = await mkOrg();
  const centre = await mkCentre({ orgId: org.id });
  const manager = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id, name: "Manager" });
  await prisma.scoringTemplate.create({
    data: { centreId: centre.id, levelKey: "1", levelName: "Level 1", passThreshold: 70, categoriesJson: RUBRIC },
  });
  return { org, centre, manager };
}

describe("registering a visiting examiner", () => {
  it("a centre manager registers one with an end date and gets a one-time password", async () => {
    const w = await world();
    await login(w.manager);
    const r = await register(json("POST", "/api/examiners", { name: "Judge A", email: "judge.a@panel.org", accessUntil: inDays(5) }));
    expect(r.status).toBe(201);
    const b = await r.json();
    expect(b.tempPassword).toMatch(/.{8,}/);
    const u = await prisma.user.findUniqueOrThrow({ where: { email: "judge.a@panel.org" } });
    expect(u.role).toBe("EXAMINER");
    expect(u.centreId).toBe(w.centre.id);
    expect(u.mustChangePassword).toBe(true);
    expect(u.accessExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 4 * 86400000);
  });

  it("only managers and HQ may register one", async () => {
    const w = await world();
    for (const role of ["HEAD_COACH", "COACH", "EXAMINER"]) {
      await login(await mkUser({ role, centreId: w.centre.id, name: role }));
      const r = await register(json("POST", "/api/examiners", { name: "Judge", email: `j-${role}@panel.org`, accessUntil: inDays(3) }));
      expect([role, r.status]).toEqual([role, 403]);
    }
  });

  it("a returning judge is reactivated; someone else's email is refused", async () => {
    const w = await world();
    await login(w.manager);
    await register(json("POST", "/api/examiners", { name: "Judge B", email: "judge.b@panel.org", accessUntil: inDays(2) }));
    await prisma.user.update({ where: { email: "judge.b@panel.org" }, data: { accessExpiresAt: new Date(Date.now() - 1000) } });
    const again = await (await register(json("POST", "/api/examiners", { name: "Judge B", email: "judge.b@panel.org", accessUntil: inDays(9) }))).json();
    expect(again.reactivated).toBe(true);
    expect(again.tempPassword).toBeUndefined();
    const coach = await mkUser({ role: "COACH", centreId: w.centre.id, email: "coach@club.in" });
    const clash = await register(json("POST", "/api/examiners", { name: "Xavier", email: coach.email, accessUntil: inDays(2) }));
    expect(clash.status).toBe(409);
  });
});

describe("access ends on its own", () => {
  it("expired: sign-in refused and a live session stops working", async () => {
    const w = await world();
    const judge = await mkUser({ role: "EXAMINER", centreId: w.centre.id, name: "Judge C" });
    await prisma.user.update({ where: { id: judge.id }, data: { accessExpiresAt: new Date(Date.now() + 60_000) } });
    await login(judge);
    expect(await getSession()).not.toBeNull();
    await prisma.user.update({ where: { id: judge.id }, data: { accessExpiresAt: new Date(Date.now() - 1000) } });
    expect(await getSession()).toBeNull();
    const row = await prisma.user.findUniqueOrThrow({ where: { id: judge.id } });
    const gate = accountStateGate(row as never);
    expect(gate?.status).toBe(403);
    expect((await gate!.json()).error).toBe("ACCESS_EXPIRED");
  });

  it("'End access now' cuts a signed-in judge off immediately", async () => {
    const w = await world();
    await login(w.manager);
    const { tempPassword } = await (await register(json("POST", "/api/examiners", { name: "Judge D", email: "judge.d@panel.org", accessUntil: inDays(3) }))).json();
    expect(tempPassword).toBeTruthy();
    const judge = await prisma.user.findUniqueOrThrow({ where: { email: "judge.d@panel.org" } });
    const r = await manage(json("PATCH", `/api/examiners/${judge.id}`, { endNow: true }), { params: { id: judge.id } });
    expect(r.status).toBe(200);
    await login({ id: judge.id, role: "EXAMINER", centreId: w.centre.id, name: "Judge D" });
    expect(await getSession()).toBeNull();
  });

  it("a judge whose access ends before the exam can't be put in its pool", async () => {
    const w = await world();
    const rider = await mkRider({ centreId: w.centre.id });
    await login(w.manager);
    await register(json("POST", "/api/examiners", { name: "Judge E", email: "judge.e@panel.org", accessUntil: inDays(2) }));
    const judge = await prisma.user.findUniqueOrThrow({ where: { email: "judge.e@panel.org" } });
    const r = await createSitting(json("POST", "/api/exam-sittings", { level: 1, date: inDays(10), examinerIds: [judge.id], riderIds: [rider.id] }));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("EXAMINER_ACCESS_ENDS");
    const ok = await createSitting(json("POST", "/api/exam-sittings", { level: 1, date: inDays(1), examinerIds: [judge.id], riderIds: [rider.id] }));
    expect(ok.status).toBe(200);
  });
});

describe("an examiner sees only the riders they examine", () => {
  it("scope, search and export", async () => {
    const w = await world();
    const mine = await mkRider({ centreId: w.centre.id, firstName: "Mine", lastName: "Rider", mobile: "9876500001" });
    const other = await mkRider({ centreId: w.centre.id, firstName: "Other", lastName: "Rider", mobile: "9876500002" });
    const judge = await mkUser({ role: "EXAMINER", centreId: w.centre.id, name: "Judge F" });
    await login(w.manager);
    await createSitting(json("POST", "/api/exam-sittings", { level: 1, date: inDays(3), examinerIds: [judge.id], riderIds: [mine.id] }));

    const js: SessionPayload = { userId: judge.id, role: "EXAMINER" as Role, centreId: w.centre.id, name: "Judge F" };
    expect(await riderOutsideExaminerScope(js, mine.id)).toBe(false);
    expect(await riderOutsideExaminerScope(js, other.id)).toBe(true);
    expect(await prisma.rider.count({ where: { centreId: w.centre.id, ...examinerRiderScope(js)! } })).toBe(1);

    await login(judge);
    const exp = await exportGet(json("GET", "/api/export/riders"), { params: { entity: "riders" } });
    expect(exp.status).toBe(403);
    const s = await (await search(json("GET", "/api/search?q=Rider"))).json();
    const text = JSON.stringify(s);
    expect(text).toContain("Mine");
    expect(text).not.toContain("Other");
  });
});
