// After the exam day (2026-09-30): bulk result emails (passes and not),
// exam reports, and families' review requests.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkOrg, mkCentre, mkUser, mkRider, linkParent } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { signSession } from "@/lib/auth";
import { mockReq } from "../helpers/request";
import type { SessionPayload } from "@/lib/auth";
import type { Role } from "@/lib/roles";
import { summariseExams } from "@/lib/exam-reports";

const cookieJar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (n: string) => cookieJar.get(n),
    set: (n: string, v: string) => cookieJar.set(n, { value: v }),
    delete: (n: string) => cookieJar.delete(n),
  }),
}));
const sent: { to: string; subject: string }[] = [];
vi.mock("@/lib/email", async (orig) => ({
  ...(await orig<typeof import("@/lib/email")>()),
  sendEmail: async (o: { to: string; subject: string }) => {
    sent.push({ to: o.to, subject: o.subject });
    return { ok: true };
  },
}));

const { POST: sendResults } = await import("@/app/api/exams/send-results/route");
const { POST: askReview } = await import("@/app/api/parent/exams/[id]/review/route");
const { POST: decide } = await import("@/app/api/exams/[id]/reviews/[reqId]/route");

type U = { id: string; role: string; centreId: string | null; name: string };
async function login(u: U) {
  cookieJar.clear();
  const payload: SessionPayload = { userId: u.id, role: u.role as Role, centreId: u.centreId, name: u.name, tokenVersion: 0 };
  cookieJar.set("ew_session", { value: await signSession(payload) });
}
const req = (body: unknown) => mockReq("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const RUBRIC = [{ name: "Flat", items: [{ name: "Walk", max_score: 10 }] }];

beforeEach(async () => {
  await resetDb();
  sent.length = 0;
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3100";
});

async function world() {
  const org = await mkOrg();
  const centre = await mkCentre({ orgId: org.id });
  const manager = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id, name: "Mgr" });
  await prisma.centre.update({ where: { id: centre.id }, data: { managerId: manager.id } });
  await prisma.scoringTemplate.create({
    data: { centreId: centre.id, levelKey: "1", levelName: "Level 1", passThreshold: 70, categoriesJson: RUBRIC },
  });
  const sitting = await prisma.examSitting.create({ data: { centreId: centre.id, level: 1, date: new Date() } });
  const mk = async (name: string, email: string | null, passed: boolean) => {
    const rider = await mkRider({ centreId: centre.id, firstName: name, email });
    const exam = await prisma.exam.create({
      data: {
        centreId: centre.id, riderId: rider.id, level: 1, date: new Date(), status: "completed", sittingId: sitting.id,
        passed, totalScore: passed ? 9 : 4, scoresJson: { Flat_Walk: passed ? 9 : 4 }, rubricSnapshotJson: RUBRIC, examinerName: "Judge",
      },
    });
    if (passed) {
      await prisma.certificate.create({
        data: { centreId: centre.id, riderId: rider.id, examId: exam.id, type: "promotion", levelName: "Level 1", serialNo: `S-${exam.id}`, qrCode: "q" },
      });
    }
    return { rider, exam };
  };
  return { org, centre, manager, sitting, mk };
}

describe("emailing a sitting's results (5)", () => {
  it("sends passes and not-passes, names riders with no email, and doesn't resend", async () => {
    const w = await world();
    const pass = await w.mk("Asha", "asha@fam.in", true);
    const fail = await w.mk("Ben", "ben@fam.in", false);
    await w.mk("Chitra", null, true);
    await login(w.manager);
    const res = await (await sendResults(req({ scope: "sitting", id: w.sitting.id }))).json();
    expect(res).toMatchObject({ sent: 2, noEmail: ["Chitra Test"], remaining: 0 });
    expect(sent.find((m) => m.to === "asha@fam.in")!.subject).toContain("passed");
    expect(sent.find((m) => m.to === "ben@fam.in")!.subject).toContain("exam result");
    expect((await prisma.exam.findUniqueOrThrow({ where: { id: fail.exam.id } })).resultEmailSentAt).not.toBeNull();
    expect((await prisma.certificate.findFirstOrThrow({ where: { examId: pass.exam.id } })).resultEmailSentAt).not.toBeNull();

    sent.length = 0;
    const again = await (await sendResults(req({ scope: "sitting", id: w.sitting.id }))).json();
    expect(again.sent).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("a coach can't", async () => {
    const w = await world();
    await login(await mkUser({ role: "COACH", centreId: w.centre.id }));
    expect((await sendResults(req({ scope: "sitting", id: w.sitting.id }))).status).toBe(403);
  });
});

describe("exam reports (8)", () => {
  it("sums by level, school, examiner and month, and measures panel spread", () => {
    const base = { level: 1, rubricSnapshotJson: RUBRIC, examinerName: "Lead", riderName: "R", judges: [] as never[] };
    const r = summariseExams(
      [
        { ...base, id: "a", date: new Date("2026-09-10"), status: "completed", passed: true, totalScore: 9, scoresJson: { Flat_Walk: 9 }, school: "DPS",
          judges: [{ judgeName: "Co", subTotal: 5, submittedAt: new Date() }] },
        { ...base, id: "b", date: new Date("2026-09-11"), status: "completed", passed: false, totalScore: 5, scoresJson: { Flat_Walk: 5 }, school: "DPS" },
        { ...base, id: "c", date: new Date("2026-10-01"), status: "absent", passed: null, totalScore: null, scoresJson: null, school: "HPS" },
      ] as never,
      (n) => `Level ${n}`,
    );
    expect(r.totals).toEqual({ sat: 2, passed: 1, absent: 1, passRate: 50 });
    expect(r.byLevel[0]).toMatchObject({ label: "Level 1", sat: 2, passed: 1, absent: 1, avgPct: 70 });
    expect(r.bySchool.find((s) => s.label === "DPS")).toMatchObject({ sat: 2, passRate: 50 });
    expect(r.byMonth.map((m) => m.key)).toEqual(["2026-09", "2026-10"]);
    // Lead 9 vs co-judge 5 out of 10: a 40% spread; the lead leans +40 points.
    expect(r.spreads[0]).toMatchObject({ id: "a", spreadPct: 40, cards: 2 });
    expect(r.judges.find((j) => j.name === "Lead")).toMatchObject({ panels: 1, meanDev: 40 });
  });
});

describe("families asking for a review (10)", () => {
  it("a parent asks once; the manager declines with a reply or reopens the exam", async () => {
    const w = await world();
    const { rider, exam } = await w.mk("Dev", "dev@fam.in", false);
    const parent = await mkUser({ role: "PARENT", email: "papa@fam.in", name: "Papa" });
    await linkParent({ parentUserId: parent.id, riderId: rider.id });
    await login(parent);
    const res = await askReview(req({ reason: "The walk mark looks too low to us." }), { params: { id: exam.id } });
    expect(res.status).toBe(200);
    const { id } = await res.json();
    expect(await prisma.notification.count({ where: { userId: w.manager.id, type: "exam.review_requested" } })).toBe(1);
    expect((await (await askReview(req({ reason: "Asking a second time please." }), { params: { id: exam.id } })).json()).error).toBe("ALREADY_OPEN");

    await login(w.manager);
    expect((await decide(req({ action: "decline" }), { params: { id: exam.id, reqId: id } })).status).toBe(400);
    const reopened = await decide(req({ action: "reopen" }), { params: { id: exam.id, reqId: id } });
    expect(reopened.status).toBe(200);
    expect((await prisma.exam.findUniqueOrThrow({ where: { id: exam.id } })).status).toBe("in_progress");
    expect((await prisma.examReviewRequest.findUniqueOrThrow({ where: { id } })).status).toBe("reopened");
    expect(await prisma.notification.count({ where: { userId: parent.id, type: "exam.review_decided" } })).toBe(1);
  });

  it("another family can't ask about someone else's child", async () => {
    const w = await world();
    const { exam } = await w.mk("Esha", "esha@fam.in", true);
    const stranger = await mkUser({ role: "PARENT", email: "other@fam.in" });
    await login(stranger);
    expect((await askReview(req({ reason: "This is not my child at all." }), { params: { id: exam.id } })).status).toBe(404);
  });
});
