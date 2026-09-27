// Bugs from the 200-rider exam-day simulation (2026-09-28):
//   1. Result / jury sheets were readable by every role in the club (and
//      across the school fence).
//   3. Un-revoking an old certificate demoted a rider who had moved up since,
//      and the un-revoke route had no org fence.

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

const { GET: resultSheet } = await import("@/app/api/exams/[id]/result-sheet/route");
const { GET: jurySheet } = await import("@/app/api/exams/[id]/test-sheet/route");
const { POST: revoke, DELETE: unrevoke } = await import("@/app/api/certificates/[id]/revoke/route");

type U = { id: string; role: string; centreId: string | null; name: string };
async function login(u: U) {
  cookieJar.clear();
  const payload: SessionPayload = { userId: u.id, role: u.role as Role, centreId: u.centreId, name: u.name, tokenVersion: 0 };
  cookieJar.set("ew_session", { value: await signSession(payload) });
}
const get = (fn: typeof resultSheet, id: string) => fn(mockReq(`http://localhost/x/${id}`), { params: { id } });

const RUBRIC = [{ name: "Flat", items: [{ name: "Walk", max_score: 10 }] }];

beforeEach(async () => {
  await resetDb();
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3100";
});

async function world() {
  const org = await mkOrg();
  const centre = await mkCentre({ orgId: org.id });
  const [dps, ryan] = await Promise.all([
    prisma.school.create({ data: { centreId: centre.id, name: "Delhi Public School" } }),
    prisma.school.create({ data: { centreId: centre.id, name: "Ryan International" } }),
  ]);
  const rider = await mkRider({ centreId: centre.id });
  await prisma.rider.update({ where: { id: rider.id }, data: { schoolId: ryan.id } });
  const lead = await mkUser({ role: "EXAMINER", centreId: centre.id, name: "Lead" });
  await prisma.scoringTemplate.create({
    data: { centreId: centre.id, levelKey: "1", levelName: "Level 1", passThreshold: 70, categoriesJson: RUBRIC },
  });
  const exam = await prisma.exam.create({
    data: {
      centreId: centre.id, riderId: rider.id, examinerId: lead.id, examinerName: "Lead", level: 1,
      date: new Date("2026-10-01T12:00:00Z"), status: "completed", scoresJson: { Flat_Walk: 9 },
      totalScore: 9, passed: true, rubricSnapshotJson: RUBRIC,
    },
  });
  return { org, centre, dps, ryan, rider, lead, exam };
}

describe("exam sheets are not readable by the whole club (bug 1)", () => {
  it("allows exam staff and the rider's coaches, refuses everyone else", async () => {
    const w = await world();
    const role = (r: string) => mkUser({ role: r, centreId: w.centre.id, name: r });
    const cases: [string, number, number][] = [
      // role, result sheet, jury sheet
      ["CENTRE_MANAGER", 200, 200],
      ["HEAD_COACH", 200, 200],
      ["COACH", 200, 403],
      ["GROOM", 403, 403],
      ["VET", 403, 403],
      ["ACCOUNTANT", 403, 403],
      ["FARRIER", 403, 403],
      ["INSPECTION_OFFICER", 403, 403],
      ["RIDER", 403, 403],
    ];
    for (const [r, resultStatus, juryStatus] of cases) {
      await login(await role(r));
      expect([r, (await get(resultSheet, w.exam.id)).status]).toEqual([r, resultStatus]);
      expect([r, (await get(jurySheet, w.exam.id)).status]).toEqual([r, juryStatus]);
    }
    // Examiners: only for an exam they lead or judge.
    await login(w.lead);
    expect((await get(resultSheet, w.exam.id)).status).toBe(200);
    await login(await role("EXAMINER"));
    expect((await get(resultSheet, w.exam.id)).status).toBe(403);
    expect((await get(jurySheet, w.exam.id)).status).toBe(403);
  });

  it("holds the school fence: another school's administrator is refused", async () => {
    const w = await world();
    const sa = await mkUser({ role: "SCHOOL_ADMINISTRATOR", centreId: w.centre.id, name: "DPS admin" });
    await prisma.user.update({ where: { id: sa.id }, data: { schoolId: w.dps.id } });
    await login(sa);
    expect((await get(resultSheet, w.exam.id)).status).toBe(403);
    await prisma.user.update({ where: { id: sa.id }, data: { schoolId: w.ryan.id } });
    expect((await get(resultSheet, w.exam.id)).status).toBe(200);
  });
});

describe("un-revoking a certificate (bug 3)", () => {
  async function certs() {
    const w = await world();
    await prisma.scoringTemplate.create({
      data: { centreId: w.centre.id, levelKey: "2", levelName: "Level 2", passThreshold: 70, categoriesJson: RUBRIC },
    });
    const mk = (levelName: string, serialNo: string) =>
      prisma.certificate.create({
        data: { centreId: w.centre.id, riderId: w.rider.id, type: "promotion", levelName, serialNo, qrCode: `q-${serialNo}` },
      });
    const l1 = await mk("Level 1", "EW-L1-TEST0001");
    const su = await mkUser({ role: "SUPER_ADMIN", centreId: null, orgId: w.org.id, name: "SU" });
    return { ...w, l1, mk, su };
  }

  it("never demotes a rider who has passed a higher level since", async () => {
    const w = await certs();
    await prisma.rider.update({ where: { id: w.rider.id }, data: { currentLevel: "Level 1" } });
    await login(w.su);
    await revoke(mockReq("http://localhost/x", { method: "POST", body: JSON.stringify({ reason: "typo" }) }), { params: { id: w.l1.id } });
    expect((await prisma.rider.findUniqueOrThrow({ where: { id: w.rider.id } })).currentLevel).toBeNull();

    // Rider then passes Level 2.
    await w.mk("Level 2", "EW-L2-TEST0002");
    await prisma.rider.update({ where: { id: w.rider.id }, data: { currentLevel: "Level 2" } });

    const r = await unrevoke(mockReq("http://localhost/x", { method: "DELETE" }), { params: { id: w.l1.id } });
    expect(r.status).toBe(200);
    expect((await prisma.rider.findUniqueOrThrow({ where: { id: w.rider.id } })).currentLevel).toBe("Level 2");
  });

  it("still restores the level when the rider has nothing higher", async () => {
    const w = await certs();
    await prisma.rider.update({ where: { id: w.rider.id }, data: { currentLevel: "Level 1" } });
    await login(w.su);
    await revoke(mockReq("http://localhost/x", { method: "POST", body: JSON.stringify({ reason: "typo" }) }), { params: { id: w.l1.id } });
    await unrevoke(mockReq("http://localhost/x", { method: "DELETE" }), { params: { id: w.l1.id } });
    expect((await prisma.rider.findUniqueOrThrow({ where: { id: w.rider.id } })).currentLevel).toBe("Level 1");
  });

  it("rolls back to the HIGHEST level still held, not the newest certificate", async () => {
    const w = await certs();
    await prisma.certificate.delete({ where: { id: w.l1.id } });
    await prisma.scoringTemplate.create({
      data: { centreId: w.centre.id, levelKey: "3", levelName: "Level 3", passThreshold: 70, categoriesJson: RUBRIC },
    });
    const at = (d: string) => new Date(`2026-0${d}T10:00:00Z`);
    await w.mk("Level 2", "EW-L2-TEST0003");
    await prisma.certificate.update({ where: { serialNo: "EW-L2-TEST0003" }, data: { issuedAt: at("1-01") } });
    await w.mk("Level 1", "EW-L1-TEST0004"); // a newer, LOWER re-sit
    await prisma.certificate.update({ where: { serialNo: "EW-L1-TEST0004" }, data: { issuedAt: at("2-01") } });
    const l3 = await w.mk("Level 3", "EW-L3-TEST0005");
    await prisma.certificate.update({ where: { id: l3.id }, data: { issuedAt: at("3-01") } });
    await prisma.rider.update({ where: { id: w.rider.id }, data: { currentLevel: "Level 3" } });
    await login(w.su);
    await revoke(mockReq("http://localhost/x", { method: "POST", body: JSON.stringify({ reason: "wrong rider" }) }), { params: { id: l3.id } });
    expect((await prisma.rider.findUniqueOrThrow({ where: { id: w.rider.id } })).currentLevel).toBe("Level 2");
  });

  it("refuses another organisation's super admin", async () => {
    const w = await certs();
    await prisma.certificate.update({ where: { id: w.l1.id }, data: { revokedAt: new Date(), revokedBy: w.su.id, revokeReason: "x" } });
    const otherOrg = await mkOrg("Other");
    const intruder = await mkUser({ role: "SUPER_ADMIN", centreId: null, orgId: otherOrg.id, name: "Intruder" });
    await login(intruder);
    const r = await unrevoke(mockReq("http://localhost/x", { method: "DELETE" }), { params: { id: w.l1.id } });
    expect(r.status).toBe(403);
    expect((await prisma.certificate.findUniqueOrThrow({ where: { id: w.l1.id } })).revokedAt).not.toBeNull();
  });
});
