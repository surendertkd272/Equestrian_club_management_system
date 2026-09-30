// Exam module round 3 (2026-09-30): hold results until published, slot notices,
// gate check-in, coach nominations, offline packs, optional parent phone.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkOrg, mkCentre, mkUser, mkRider, linkParent } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { signSession } from "@/lib/auth";
import { mockReq } from "../helpers/request";
import type { SessionPayload } from "@/lib/auth";
import type { Role } from "@/lib/roles";
import { familyExamWhere, familyCertWhere } from "@/lib/exam-visibility";

const cookieJar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (n: string) => cookieJar.get(n),
    set: (n: string, v: string) => cookieJar.set(n, { value: v }),
    delete: (n: string) => cookieJar.delete(n),
  }),
}));

const { POST: results } = await import("@/app/api/exam-results/route");
const { POST: notifySlots } = await import("@/app/api/exam-slots/notify/route");
const { POST: checkIn } = await import("@/app/api/exams/[id]/check-in/route");
const { POST: claimNext } = await import("@/app/api/exam-sittings/[id]/claim-next/route");
const { POST: examReady } = await import("@/app/api/riders/[id]/exam-ready/route");
const { POST: offlinePack } = await import("@/app/api/exam-sittings/[id]/offline-pack/route");
const { POST: onboard } = await import("@/app/api/onboarding/route");
const { PATCH: scorePatch } = await import("@/app/api/exams/[id]/score/route");

type U = { id: string; role: string; centreId: string | null; name: string };
async function login(u: U) {
  cookieJar.clear();
  const payload: SessionPayload = { userId: u.id, role: u.role as Role, centreId: u.centreId, name: u.name, tokenVersion: 0 };
  cookieJar.set("ew_session", { value: await signSession(payload) });
}
const req = (body: unknown, method = "POST", headers: Record<string, string> = {}) =>
  mockReq("http://localhost/x", { method, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: { id } });
const RUBRIC = [{ name: "Flat", items: [{ name: "Walk", max_score: 10 }] }];

beforeEach(async () => {
  await resetDb();
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3100";
});

async function world(n = 2) {
  const org = await mkOrg();
  const centre = await mkCentre({ orgId: org.id });
  const manager = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id, name: "Mgr" });
  await prisma.centre.update({ where: { id: centre.id }, data: { managerId: manager.id } });
  await prisma.scoringTemplate.create({
    data: { centreId: centre.id, levelKey: "1", levelName: "Level 1", passThreshold: 70, categoriesJson: RUBRIC },
  });
  const judge = await mkUser({ role: "EXAMINER", centreId: centre.id, name: "Judge" });
  const day = await prisma.examDay.create({ data: { centreId: centre.id, name: "Day", date: new Date(Date.now() + 86400000), time: "09:00" } });
  const sitting = await prisma.examSitting.create({
    data: { centreId: centre.id, level: 1, date: day.date, examDayId: day.id, slotMinutes: 10 },
  });
  await prisma.examSittingExaminer.create({ data: { sittingId: sitting.id, examinerId: judge.id, examinerName: "Judge" } });
  const exams = [];
  for (let i = 0; i < n; i++) {
    const rider = await mkRider({ centreId: centre.id, firstName: `R${i}`, email: `r${i}@fam.in` });
    exams.push(
      await prisma.exam.create({
        data: {
          centreId: centre.id, riderId: rider.id, level: 1, date: day.date, time: `09:${String(i * 10).padStart(2, "0")}`,
          runOrder: i + 1, status: "scheduled", sittingId: sitting.id, rubricSnapshotJson: RUBRIC,
        },
      }),
    );
  }
  return { org, centre, manager, judge, day, sitting, exams };
}

describe("holding results until published (1)", () => {
  it("a held day tells no family and hides the result; publishing shows and announces it", async () => {
    const w = await world(1);
    const parent = await mkUser({ role: "PARENT", email: "p@fam.in" });
    await linkParent({ parentUserId: parent.id, riderId: w.exams[0].riderId });
    await login(w.manager);
    expect((await results(req({ action: "hold", scope: "day", id: w.day.id }))).status).toBe(200);
    // The judge marks and submits.
    await prisma.exam.update({ where: { id: w.exams[0].id }, data: { examinerId: w.judge.id, examinerName: "Judge", status: "in_progress" } });
    await login(w.judge);
    const sub = await scorePatch(req({ scores: { Flat_Walk: 9 }, final: true }, "PATCH"), ctx(w.exams[0].id));
    expect(sub.status).toBe(200);
    expect(await prisma.notification.count({ where: { userId: parent.id } })).toBe(0);
    expect(await prisma.exam.count({ where: { id: w.exams[0].id, ...familyExamWhere } })).toBe(0);
    expect(await prisma.certificate.count({ where: { examId: w.exams[0].id, ...familyCertWhere } })).toBe(0);

    await login(w.manager);
    const pub = await results(req({ action: "publish", scope: "day", id: w.day.id }));
    expect(await pub.json()).toMatchObject({ announced: 1 });
    expect(await prisma.notification.count({ where: { userId: parent.id, type: "exam.passed" } })).toBe(1);
    expect(await prisma.exam.count({ where: { id: w.exams[0].id, ...familyExamWhere } })).toBe(1);
    // Published results can't be held again.
    expect((await (await results(req({ action: "hold", scope: "day", id: w.day.id }))).json()).error).toBe("ALREADY_PUBLISHED");
  });
});

describe("telling families their slot (2)", () => {
  it("sends each family their time once, then only changes", async () => {
    const w = await world(2);
    const parent = await mkUser({ role: "PARENT", email: "p@fam.in" });
    await linkParent({ parentUserId: parent.id, riderId: w.exams[0].riderId });
    await login(w.manager);
    expect(await (await notifySlots(req({ scope: "day", id: w.day.id }))).json()).toMatchObject({ sent: 2, changed: 0 });
    expect(await prisma.notification.count({ where: { userId: parent.id, type: "exam.slot" } })).toBe(1);
    expect((await (await notifySlots(req({ scope: "day", id: w.day.id }))).json()).sent).toBe(0);
    await prisma.exam.update({ where: { id: w.exams[0].id }, data: { time: "10:00" } });
    expect(await (await notifySlots(req({ scope: "day", id: w.day.id }))).json()).toMatchObject({ sent: 1, changed: 1 });
    const n = await prisma.notification.findFirstOrThrow({ where: { userId: parent.id, type: "exam.slot" }, orderBy: { createdAt: "desc" } });
    expect(n.title).toContain("New time");
    expect(n.body).toContain("10:00");
  });
});

describe("gate check-in (4)", () => {
  it("once riders are checked in, Pick next only offers riders who are here", async () => {
    const w = await world(3);
    await login(w.judge);
    expect((await checkIn(req({ arrived: true }), ctx(w.exams[2].id))).status).toBe(200);
    const next = await (await claimNext(req({}), ctx(w.sitting.id))).json();
    expect(next.id).toBe(w.exams[2].id);
    expect((await (await claimNext(req({}), ctx(w.sitting.id))).json()).error).toBe("QUEUE_EMPTY");
  });
});

describe("coach nominations (6)", () => {
  it("a coach nominates a rider for a level on the ladder, and can withdraw it", async () => {
    const w = await world(1);
    const coach = await mkUser({ role: "COACH", centreId: w.centre.id });
    await login(coach);
    expect((await (await examReady(req({ level: 5 }), ctx(w.exams[0].riderId))).json()).error).toBe("UNKNOWN_LEVEL");
    expect((await examReady(req({ level: 1, note: "Solid canter" }), ctx(w.exams[0].riderId))).status).toBe(200);
    expect(await prisma.rider.findUniqueOrThrow({ where: { id: w.exams[0].riderId } })).toMatchObject({ examReadyLevel: 1, examReadyNote: "Solid canter", examReadyBy: coach.id });
    await examReady(req({ level: null }), ctx(w.exams[0].riderId));
    expect((await prisma.rider.findUniqueOrThrow({ where: { id: w.exams[0].riderId } })).examReadyLevel).toBeNull();
    const groom = await mkUser({ role: "GROOM", centreId: w.centre.id });
    await login(groom);
    expect((await examReady(req({ level: 1 }), ctx(w.exams[0].riderId))).status).toBe(403);
  });
});

describe("offline packs (7)", () => {
  it("claims the judge's next riders and returns their cards with the rubric", async () => {
    const w = await world(3);
    await login(w.judge);
    const pack = await (await offlinePack(req({ take: 2 }), ctx(w.sitting.id))).json();
    expect(pack.claimed).toBe(2);
    expect(pack.cards.map((c: { examId: string }) => c.examId)).toEqual([w.exams[0].id, w.exams[1].id]);
    expect(pack.cards[0].rubric[0].name).toBe("Flat");
    expect(await prisma.exam.count({ where: { sittingId: w.sitting.id, examinerId: w.judge.id } })).toBe(2);
    const stranger = await mkUser({ role: "EXAMINER", centreId: w.centre.id });
    await login(stranger);
    expect((await offlinePack(req({ take: 1 }), ctx(w.sitting.id))).status).toBe(403);
  });
});

describe("contact details are optional (B)", () => {
  it("a child can register with no parent phone or email", async () => {
    const org = await mkOrg();
    const centre = await mkCentre({ orgId: org.id });
    const res = await onboard(
      req(
        {
          centreSlug: centre.slug, firstName: "Nophone", lastName: "Kid", dob: "2014-01-01", gender: "male",
          school: "HPS", schoolClass: "5", schoolSection: "A", addressPresent: "Hyd", pincode: "500016",
          fullNameSignature: "Parent", agreed: true, injuryNocAgreed: true,
          parentName: "Parent", parentRelation: "father", parentConsentAgreed: true,
        },
        "POST",
        { "x-forwarded-for": "49.1.1.1" },
      ),
    );
    expect(res.status).toBe(200);
    const r = await prisma.rider.findFirstOrThrow({ where: { firstName: "Nophone" } });
    expect(r.mobile ?? null).toBeFalsy();
    expect((r.parentalConsentJson as { parentPhone: unknown }).parentPhone).toBeNull();
  });
});
