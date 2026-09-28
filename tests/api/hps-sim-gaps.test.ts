// Gaps from the 500-rider HPS Hyderabad simulation (2026-09-29):
//   1. A level over 200 riders was refused — it now runs as groups.
//   2. The public form's 10/hour per-connection limit stopped a school drive.
//   3. Enrolments were approved one at a time, verify then approve.
//   5. No way to set many returning riders' levels.
//   6. Co-judges were added per exam — no sitting-level jury panel.
//   7. A late rider couldn't join a sitting or an exam day already booked.
//   8. Parent logins were one at a time (student logins took the family email).
//  10. Judge readiness on the exam-day screens (lib/examiner-readiness).
// Gap 4 (consent by phone) is in consent-request-send.test.ts, gap 8's
// student-login half in portal-access-bulk.test.ts. Gap 9 is UI only.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkOrg, mkCentre, mkUser, mkRider } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { signSession } from "@/lib/auth";
import { mockReq } from "../helpers/request";
import type { SessionPayload } from "@/lib/auth";
import type { Role } from "@/lib/roles";
import { examinerReadiness } from "@/lib/examiner-readiness";
import { splitIntoGroups } from "@/lib/exam-booking";
import { createDriveToken, readDriveToken } from "@/lib/signup-drive";

const cookieJar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (n: string) => cookieJar.get(n),
    set: (n: string, v: string) => cookieJar.set(n, { value: v }),
    delete: (n: string) => cookieJar.delete(n),
  }),
}));

const { POST: bookDay } = await import("@/app/api/exam-days/route");
const { POST: addDayRiders } = await import("@/app/api/exam-days/[id]/riders/route");
const { POST: addSittingRiders } = await import("@/app/api/exam-sittings/[id]/riders/route");
const { POST: addPanel, DELETE: removePanel } = await import("@/app/api/exam-sittings/[id]/panel/route");
const { POST: bulkEnrol } = await import("@/app/api/enrolments/bulk/route");
const { POST: setLevels } = await import("@/app/api/riders/levels/route");
const { POST: parentAccess } = await import("@/app/api/riders/parent-access/bulk/route");
const { POST: newDrive } = await import("@/app/api/signup-drives/route");
const { POST: onboard } = await import("@/app/api/onboarding/route");

type U = { id: string; role: string; centreId: string | null; name: string };
async function login(u: U) {
  cookieJar.clear();
  const payload: SessionPayload = { userId: u.id, role: u.role as Role, centreId: u.centreId, name: u.name, tokenVersion: 0 };
  cookieJar.set("ew_session", { value: await signSession(payload) });
}
const req = (body: unknown, method = "POST", headers: Record<string, string> = {}) =>
  mockReq("http://localhost/x", {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
const ymd = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

const RUBRIC = [{ name: "Flat", items: [{ name: "Walk", max_score: 10 }] }];

beforeEach(async () => {
  await resetDb();
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3100";
});

async function club() {
  const org = await mkOrg();
  const centre = await mkCentre({ orgId: org.id, name: "HPS" });
  const manager = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id, name: "Anita" });
  await prisma.centre.update({ where: { id: centre.id }, data: { managerId: manager.id } });
  for (const n of [1, 2]) {
    await prisma.scoringTemplate.create({
      data: { centreId: centre.id, levelKey: String(n), levelName: `Level ${n}`, passThreshold: 70, categoriesJson: RUBRIC },
    });
  }
  const [a, b, c] = await Promise.all(
    ["Judge A", "Judge B", "Judge C"].map((name) => mkUser({ role: "EXAMINER", centreId: centre.id, name })),
  );
  return { org, centre, manager, a, b, c };
}

async function riders(centreId: string, n: number, prefix = "Rider") {
  await prisma.rider.createMany({
    data: Array.from({ length: n }, (_, i) => ({
      centreId,
      firstName: `${prefix}${String(i).padStart(3, "0")}`,
      lastName: "Test",
      dob: new Date("2012-01-01"),
      mobile: "9876543210",
      status: "active",
    })),
  });
  return (await prisma.rider.findMany({ where: { centreId, firstName: { startsWith: prefix } }, orderBy: { firstName: "asc" } })).map(
    (r) => r.id,
  );
}

async function smallDay(w: Awaited<ReturnType<typeof club>>, n = 2, panel: string[] = []) {
  const ids = await riders(w.centre.id, n);
  await login(w.manager);
  const res = await bookDay(
    req({
      name: "Autumn exams",
      date: ymd(10),
      entries: ids.map((riderId) => ({ riderId, level: 1 })),
      pools: { "1": [w.a.id] },
      ...(panel.length ? { panels: { "1": panel } } : {}),
    }),
  );
  expect(res.status).toBe(200);
  const body = await res.json();
  return { dayId: body.id as string, sittingId: body.sittings[0].id as string, ids };
}

describe("a big level runs as groups (gap 1)", () => {
  it("splits evenly", () => {
    expect(splitIntoGroups(Array.from({ length: 250 }), 200).map((g) => g.length)).toEqual([125, 125]);
    expect(splitIntoGroups(Array.from({ length: 401 }), 200).map((g) => g.length)).toEqual([134, 134, 133]);
    expect(splitIntoGroups(Array.from({ length: 200 }), 200)).toHaveLength(1);
  });

  it("books 250 riders at one level as two groups sharing the examiners", async () => {
    const w = await club();
    const l1 = await riders(w.centre.id, 250, "Big");
    const l2 = await riders(w.centre.id, 3, "Small");
    await prisma.rider.updateMany({ where: { id: { in: l2 } }, data: { currentLevel: "Level 1" } });
    await login(w.manager);
    const res = await bookDay(
      req({
        name: "HPS exam day",
        date: ymd(14),
        entries: [...l1.map((riderId) => ({ riderId, level: 1 })), ...l2.map((riderId) => ({ riderId, level: 2 }))],
        pools: { "1": [w.a.id, w.b.id], "2": [w.c.id] },
      }),
    );
    expect(res.status).toBe(200);
    const sittings = await prisma.examSitting.findMany({
      where: { examDayId: (await res.json()).id },
      include: { examiners: true, _count: { select: { exams: true } } },
      orderBy: [{ level: "asc" }, { groupNo: "asc" }],
    });
    expect(sittings.map((s) => [s.level, s.groupNo, s._count.exams])).toEqual([
      [1, 1, 125],
      [1, 2, 125],
      [2, null, 3],
    ]);
    expect(sittings[1].examiners.map((x) => x.examinerId).sort()).toEqual([w.a.id, w.b.id].sort());
  });
});

describe("a sitting-level jury panel (gap 6)", () => {
  it("seats the day's panel on every rider of the level", async () => {
    const w = await club();
    const { sittingId } = await smallDay(w, 3, [w.b.id]);
    const cards = await prisma.examJudge.findMany({ where: { exam: { sittingId } } });
    expect(cards).toHaveLength(3);
    expect(cards.every((c) => c.judgeId === w.b.id && c.position === 2)).toBe(true);
    expect((await prisma.examSitting.findUnique({ where: { id: sittingId } }))!.panelJudgeIds).toEqual([w.b.id]);
  });

  it("refuses a pool examiner or an ineligible role on the panel", async () => {
    const w = await club();
    const { sittingId } = await smallDay(w);
    const coach = await mkUser({ role: "COACH", centreId: w.centre.id, name: "Coach" });
    const p = (judgeIds: string[]) => addPanel(req({ judgeIds }), { params: { id: sittingId } });
    expect((await (await p([w.a.id])).json()).error).toBe("JUDGE_IN_POOL");
    expect((await (await p([coach.id])).json()).error).toBe("JUDGE_NOT_ELIGIBLE");
    const ok = await p([w.b.id, w.c.id]);
    expect(ok.status).toBe(200);
    expect((await ok.json()).cardsSeated).toBe(4);
    // Seating again changes nothing.
    expect((await (await p([w.b.id])).json()).cardsSeated).toBe(0);
  });

  it("taking a judge off removes their open cards and completes an exam waiting only on them", async () => {
    const w = await club();
    const { sittingId } = await smallDay(w, 2, [w.b.id]);
    const [done] = await prisma.exam.findMany({ where: { sittingId }, orderBy: { id: "asc" } });
    // The lead has submitted; only the panel judge's card is outstanding.
    await prisma.exam.update({
      where: { id: done.id },
      data: { examinerId: w.a.id, examinerName: "Judge A", status: "in_progress", scoresJson: { Flat_Walk: 9 }, leadSubmittedAt: new Date() },
    });
    await login(w.manager);
    const res = await removePanel(req({ judgeId: w.b.id }, "DELETE"), { params: { id: sittingId } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ cardsRemoved: 2, examsCompleted: 1 });
    expect((await prisma.exam.findUnique({ where: { id: done.id } }))!.status).toBe("completed");
    expect((await prisma.examSitting.findUnique({ where: { id: sittingId } }))!.panelJudgeIds).toEqual([]);
  });
});

describe("late riders join a booked sitting or day (gap 7)", () => {
  it("adds a rider to a sitting, seated with its panel", async () => {
    const w = await club();
    const { sittingId } = await smallDay(w, 2, [w.b.id]);
    await prisma.examSitting.update({ where: { id: sittingId }, data: { completedNotifiedAt: new Date() } });
    const [late] = await riders(w.centre.id, 1, "Late");
    const res = await addSittingRiders(req({ riderIds: [late] }), { params: { id: sittingId } });
    expect(res.status).toBe(200);
    const exam = await prisma.exam.findFirstOrThrow({ where: { sittingId, riderId: late }, include: { judges: true } });
    expect(exam.status).toBe("scheduled");
    expect(exam.judges.map((j) => j.judgeId)).toEqual([w.b.id]);
    expect((await prisma.examSitting.findUnique({ where: { id: sittingId } }))!.completedNotifiedAt).toBeNull();
    // The same rider can't be booked twice.
    expect((await (await addSittingRiders(req({ riderIds: [late] }), { params: { id: sittingId } })).json()).error).toBe(
      "RIDER_ALREADY_SCHEDULED",
    );
  });

  it("adds riders to a day: into their level's sitting, or a new level with its examiners", async () => {
    const w = await club();
    const { dayId, sittingId } = await smallDay(w, 2);
    const [l1, l2] = await riders(w.centre.id, 2, "Late");
    await prisma.rider.update({ where: { id: l2 }, data: { currentLevel: "Level 1" } });
    const add = (body: unknown) => addDayRiders(req(body), { params: { id: dayId } });

    const noPool = await add({ entries: [{ riderId: l2, level: 2 }] });
    expect((await noPool.json()).error).toBe("POOL_REQUIRED");

    const res = await add({ entries: [{ riderId: l1, level: 1 }, { riderId: l2, level: 2 }], pools: { "2": [w.c.id] } });
    expect(res.status).toBe(200);
    expect((await prisma.exam.findFirstOrThrow({ where: { riderId: l1 } })).sittingId).toBe(sittingId);
    const newSitting = await prisma.examSitting.findFirstOrThrow({ where: { examDayId: dayId, level: 2 }, include: { examiners: true } });
    expect(newSitting.examiners.map((x) => x.examinerId)).toEqual([w.c.id]);
  });

  it("won't add to an exam that's already past", async () => {
    const w = await club();
    const sitting = await prisma.examSitting.create({
      data: { centreId: w.centre.id, level: 1, date: new Date(Date.now() - 3 * 86400000) },
    });
    const [late] = await riders(w.centre.id, 1, "Late");
    await login(w.manager);
    const res = await addSittingRiders(req({ riderIds: [late] }), { params: { id: sitting.id } });
    expect((await res.json()).error).toBe("EXAM_IN_PAST");
  });
});

describe("bulk enrolment approval (gap 3)", () => {
  async function pending(centreId: string, n: number) {
    const ids = await riders(centreId, n, "Pending");
    await prisma.rider.updateMany({ where: { id: { in: ids } }, data: { status: "pending_approval", selfEnrolled: true } });
    return ids;
  }

  it("verifies and approves a batch only with the manager's attestation", async () => {
    const w = await club();
    const ids = await pending(w.centre.id, 3);
    await login(w.manager);
    const refused = await bulkEnrol(req({ riderIds: ids, action: "verify_approve" }));
    expect((await refused.json()).error).toBe("NOT_ATTESTED");

    const res = await bulkEnrol(req({ riderIds: ids, action: "verify_approve", attested: true }));
    expect(await res.json()).toMatchObject({ done: 3, skipped: [] });
    const after = await prisma.rider.findMany({ where: { id: { in: ids } } });
    expect(after.every((r) => r.status === "active" && r.verifiedAt && r.verifyNote?.startsWith("Bulk review"))).toBe(true);
  });

  it("plain approve skips riders nobody verified, and names them", async () => {
    const w = await club();
    const [verified, unverified] = await pending(w.centre.id, 2);
    await prisma.rider.update({ where: { id: verified }, data: { verifiedAt: new Date() } });
    await login(w.manager);
    const body = await (await bulkEnrol(req({ riderIds: [verified, unverified], action: "approve" }))).json();
    expect(body.done).toBe(1);
    expect(body.skipped).toHaveLength(1);
    expect(body.skipped[0].id).toBe(unverified);
  });

  it("a school administrator can't bulk-verify", async () => {
    const w = await club();
    const ids = await pending(w.centre.id, 1);
    const sa = await mkUser({ role: "SCHOOL_ADMINISTRATOR", centreId: w.centre.id });
    await login(sa);
    expect((await bulkEnrol(req({ riderIds: ids, action: "verify_approve", attested: true }))).status).toBe(403);
  });
});

describe("setting many riders' levels (gap 5)", () => {
  it("sets levels on the ladder, and only for this centre's riders", async () => {
    const w = await club();
    const ids = await riders(w.centre.id, 3);
    const other = await mkCentre({ orgId: w.org.id });
    const outsider = await mkRider({ centreId: other.id });
    await login(w.manager);
    const set = (changes: unknown) => setLevels(req({ changes }));

    expect((await (await set([{ riderId: ids[0], level: "Level 9" }])).json()).error).toBe("UNKNOWN_LEVEL");
    expect((await (await set([{ riderId: outsider.id, level: "Level 1" }])).json()).error).toBe("RIDER_SCOPE_MISMATCH");
    const ok = await set([
      { riderId: ids[0], level: "Level 2" },
      { riderId: ids[1], level: "Level 1" },
      { riderId: ids[2], level: null },
    ]);
    expect(await ok.json()).toMatchObject({ updated: 2, unchanged: 1 });
    const levels = Object.fromEntries(
      (await prisma.rider.findMany({ where: { id: { in: ids } } })).map((r) => [r.id, r.currentLevel]),
    );
    expect([levels[ids[0]], levels[ids[1]], levels[ids[2]]]).toEqual(["Level 2", "Level 1", null]);
  });

  it("a coach can't", async () => {
    const w = await club();
    const [id] = await riders(w.centre.id, 1);
    await login(await mkUser({ role: "COACH", centreId: w.centre.id }));
    expect((await setLevels(req({ changes: [{ riderId: id, level: "Level 1" }] }))).status).toBe(403);
  });
});

describe("parent logins in bulk (gap 8)", () => {
  it("one login per family address, every sibling linked; existing parents reused", async () => {
    const w = await club();
    const [s1, s2, solo, reuse] = await riders(w.centre.id, 4, "Kid");
    const fam = { parentEmail: "Reddy.Family@Mail.in", parentName: "Lakshmi Reddy", parentRelation: "mother", parentPhone: "9100014662" };
    await prisma.rider.updateMany({ where: { id: { in: [s1, s2] } }, data: { parentalConsentJson: fam } });
    // A minor whose only address is on their own record: that's the family's.
    await prisma.rider.update({ where: { id: solo }, data: { email: "rao.home@mail.in" } });
    await prisma.rider.update({ where: { id: reuse }, data: { parentalConsentJson: { parentEmail: "already@mail.in" } } });
    const existing = await mkUser({ role: "PARENT", email: "already@mail.in" });
    await login(w.manager);

    const dry = await (await parentAccess(req({ dryRun: true }))).json();
    expect(dry).toMatchObject({ wouldCreate: 2, wouldLinkExisting: 1 });
    expect(await prisma.user.count({ where: { role: "PARENT" } })).toBe(1);

    const body = await (await parentAccess(req({}))).json();
    expect(body.created.map((c: { email: string }) => c.email).sort()).toEqual(["rao.home@mail.in", "reddy.family@mail.in"]);
    const mum = await prisma.user.findUniqueOrThrow({ where: { email: "reddy.family@mail.in" }, include: { parentLinks: true } });
    expect(mum).toMatchObject({ role: "PARENT", name: "Lakshmi Reddy", centreId: null, mustChangePassword: true });
    expect(mum.parentLinks.map((l) => l.riderId).sort()).toEqual([s1, s2].sort());
    expect(mum.parentLinks.every((l) => l.relationship === "mother")).toBe(true);
    expect(await prisma.parentLink.count({ where: { parentUserId: existing.id, riderId: reuse } })).toBe(1);

    // A second run finds nobody left to do.
    const again = await (await parentAccess(req({}))).json();
    expect(again.created).toHaveLength(0);
  });

  it("reports an address that already backs someone else's login", async () => {
    const w = await club();
    const [kid] = await riders(w.centre.id, 1, "Kid");
    await prisma.rider.update({ where: { id: kid }, data: { parentalConsentJson: { parentEmail: "taken@mail.in" } } });
    await mkUser({ role: "RIDER", email: "taken@mail.in", centreId: w.centre.id });
    await login(w.manager);
    const body = await (await parentAccess(req({}))).json();
    expect(body.created).toHaveLength(0);
    expect(body.emailTaken[0]).toMatchObject({ email: "taken@mail.in", role: "RIDER" });
  });
});

describe("school sign-up drive links (gap 2)", () => {
  function application(centreSlug: string, i: number, over: Record<string, unknown> = {}) {
    return {
      centreSlug,
      firstName: `Child${i}`,
      lastName: "Drive",
      dob: "2013-04-11",
      gender: "male",
      mobile: "9876543210",
      school: "The Hyderabad Public School",
      schoolClass: "6",
      schoolSection: "B",
      addressPresent: "Begumpet",
      pincode: "500016",
      emergencyName: "Parent",
      emergencyPhone: "9876543211",
      fullNameSignature: "Parent",
      agreed: true,
      injuryNocAgreed: true,
      parentName: "Parent",
      parentRelation: "father",
      parentPhone: "9876543211",
      parentConsentAgreed: true,
      ...over,
    };
  }
  const submit = (body: unknown, ip: string) => onboard(req(body, "POST", { "x-forwarded-for": ip }));

  it("without a drive link the 11th family on one connection is refused; with one they all get through", async () => {
    const w = await club();
    for (let i = 0; i < 10; i++) expect((await submit(application(w.centre.slug, i), "49.36.10.10")).status).toBe(200);
    expect((await submit(application(w.centre.slug, 10), "49.36.10.10")).status).toBe(429);

    const { token } = await createDriveToken({ centreId: w.centre.id, school: "The Hyderabad Public School", days: 3 });
    for (let i = 20; i < 35; i++) {
      expect((await submit(application(w.centre.slug, i, { driveToken: token }), "49.36.20.20")).status).toBe(200);
    }
  });

  it("a drive token for another centre, or a forged one, counts for nothing", async () => {
    const w = await club();
    const other = await mkCentre({ orgId: w.org.id });
    const { token } = await createDriveToken({ centreId: other.id, days: 3 });
    expect(await readDriveToken(token, w.centre.id)).toBeNull();
    expect(await readDriveToken(`${token.slice(0, -4)}AAAA`, other.id)).toBeNull();
    expect(await readDriveToken(token, other.id)).toMatchObject({ centreId: other.id, school: null });
    for (let i = 0; i < 10; i++) {
      await submit(application(w.centre.slug, i, { driveToken: token }), "49.36.30.30");
    }
    expect((await submit(application(w.centre.slug, 10, { driveToken: token }), "49.36.30.30")).status).toBe(429);
  });

  it("the centre manager issues the link; a coach can't", async () => {
    const w = await club();
    await login(w.manager);
    const res = await newDrive(req({ school: "HPS", days: 7 }));
    expect(res.status).toBe(200);
    const { url } = await res.json();
    expect(url).toMatch(new RegExp(`^http://localhost:3100/onboarding\\?centre=${w.centre.slug}&drive=`));
    const drive = await readDriveToken(new URL(url).searchParams.get("drive"), w.centre.id);
    expect(drive?.school).toBe("HPS");
    await login(await mkUser({ role: "COACH", centreId: w.centre.id }));
    expect((await newDrive(req({ days: 3 }))).status).toBe(403);
  });
});

describe("judge readiness on exam-day screens (gap 10)", () => {
  const examDate = new Date(Date.now() + 5 * 86400000);
  it("names why a judge can't mark", () => {
    const base = { status: "active", mustChangePassword: false, accessExpiresAt: null };
    expect(examinerReadiness(base, examDate)).toMatchObject({ ok: true, label: "ready" });
    expect(examinerReadiness({ ...base, mustChangePassword: true }, examDate)).toMatchObject({ ok: false, label: "hasn't signed in yet" });
    expect(examinerReadiness({ ...base, accessExpiresAt: new Date(Date.now() + 86400000) }, examDate).label).toBe(
      "access ends before the exam",
    );
    expect(examinerReadiness({ ...base, accessExpiresAt: new Date(Date.now() - 1000) }, examDate).label).toBe("access ended");
    expect(examinerReadiness({ ...base, status: "inactive" }, examDate).ok).toBe(false);
  });
});
