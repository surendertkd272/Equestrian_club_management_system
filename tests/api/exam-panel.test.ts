// Exam module gaps (2026-09-28):
//   1. Exam.rubricSnapshotJson was read everywhere but never written.
//   2. A co-judge panel completed on whichever card was submitted FIRST.
//   3. A completed exam could never be corrected.
//   4. Result + certificate were not one transaction.
//   5. (UI) reset draft — server side: resetting one card leaves the others.
//   6. No way to reschedule/cancel/remove, no duplicate-booking guard, no
//      results export.

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

const { PATCH: score, DELETE: resetCard } = await import("@/app/api/exams/[id]/score/route");
const { POST: reopen } = await import("@/app/api/exams/[id]/reopen/route");
const { PATCH: examPatch, DELETE: examDelete } = await import("@/app/api/exams/[id]/route");
const { DELETE: removeJudge } = await import("@/app/api/exams/[id]/judges/[judgeRowId]/route");
const { POST: createSitting } = await import("@/app/api/exam-sittings/route");
const { PATCH: sittingPatch, DELETE: sittingDelete } = await import("@/app/api/exam-sittings/[id]/route");
const { GET: exportGet } = await import("@/app/api/export/[entity]/route");

type U = { id: string; role: string; centreId: string | null; name: string };
async function login(u: U) {
  cookieJar.clear();
  const payload: SessionPayload = { userId: u.id, role: u.role as Role, centreId: u.centreId, name: u.name, tokenVersion: 0 };
  cookieJar.set("ew_session", { value: await signSession(payload) });
}
function req(method: string, url: string, body?: unknown) {
  return mockReq(`http://localhost${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// Two-item rubric, max 20.
const RUBRIC = [{ name: "Flat", items: [{ name: "Walk", max_score: 10 }, { name: "Trot", max_score: 10 }] }];

async function world() {
  const org = await mkOrg();
  const centre = await mkCentre({ orgId: org.id });
  const manager = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id, name: "Manager" });
  const lead = await mkUser({ role: "EXAMINER", centreId: centre.id, name: "Lead" });
  const cojudge = await mkUser({ role: "HEAD_COACH", centreId: centre.id, name: "CoJudge" });
  const rider = await mkRider({ centreId: centre.id });
  await prisma.scoringTemplate.create({
    data: { centreId: centre.id, levelKey: "1", levelName: "Level 1", passThreshold: 70, categoriesJson: RUBRIC },
  });
  return { org, centre, manager, lead, cojudge, rider };
}

async function mkExam(w: Awaited<ReturnType<typeof world>>, over: { withCoJudge?: boolean } = {}) {
  const exam = await prisma.exam.create({
    data: {
      centreId: w.centre.id,
      riderId: w.rider.id,
      examinerId: w.lead.id,
      examinerName: w.lead.name,
      level: 1,
      date: new Date("2026-10-01T12:00:00Z"),
      status: "scheduled",
      rubricSnapshotJson: RUBRIC,
    },
  });
  if (over.withCoJudge) {
    await prisma.examJudge.create({
      data: { examId: exam.id, judgeId: w.cojudge.id, judgeName: w.cojudge.name, position: 2 },
    });
  }
  return exam;
}

const marks = (walk: number, trot: number) => ({ Flat_Walk: walk, Flat_Trot: trot });
const scoreReq = (id: string, body: unknown) => score(req("PATCH", `/api/exams/${id}/score`, body), { params: { id } });

beforeEach(async () => {
  await resetDb();
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3100";
});

describe("rubric snapshot (gap 1)", () => {
  it("a new sitting pins the rubric, so a later template edit doesn't change how it is marked", async () => {
    const w = await world();
    await login(w.manager);
    const res = await createSitting(
      req("POST", "/api/exam-sittings", { level: 1, date: "2026-10-01", examinerIds: [w.lead.id], riderIds: [w.rider.id] }),
    );
    expect(res.status).toBe(200);
    const exam = await prisma.exam.findFirstOrThrow({ where: { riderId: w.rider.id } });
    expect(exam.rubricSnapshotJson).toEqual(RUBRIC);

    // Template edited after scheduling: Walk now out of 5.
    await prisma.scoringTemplate.update({
      where: { centreId_levelKey: { centreId: w.centre.id, levelKey: "1" } },
      data: { categoriesJson: [{ name: "Flat", items: [{ name: "Walk", max_score: 5 }] }] },
    });
    await prisma.exam.update({ where: { id: exam.id }, data: { examinerId: w.lead.id, examinerName: w.lead.name } });
    await login(w.lead);
    // 8/10 on Walk is valid under the pinned rubric (would be out of range under the edit).
    const r = await scoreReq(exam.id, { scores: marks(8, 7), final: true });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.max).toBe(20);
    expect(body.totalScore).toBe(15);
  });

  it("an exam created without a snapshot is pinned on its first save", async () => {
    const w = await world();
    const exam = await prisma.exam.create({
      data: { centreId: w.centre.id, riderId: w.rider.id, examinerId: w.lead.id, level: 1, date: new Date(), status: "scheduled" },
    });
    await login(w.lead);
    expect((await scoreReq(exam.id, { scores: marks(5, 5) })).status).toBe(200);
    expect((await prisma.exam.findUniqueOrThrow({ where: { id: exam.id } })).rubricSnapshotJson).toEqual(RUBRIC);
  });
});

describe("co-judge panel completes on the LAST card (gap 2)", () => {
  it("lead submitting first does not complete; the co-judge's submission does, with the mean", async () => {
    const w = await world();
    const exam = await mkExam(w, { withCoJudge: true });

    await login(w.lead);
    const first = await (await scoreReq(exam.id, { scores: marks(10, 10), final: true })).json();
    expect(first.completed).toBe(false);
    expect(first.waitingFor).toEqual(["CoJudge"]);
    let row = await prisma.exam.findUniqueOrThrow({ where: { id: exam.id } });
    expect(row.status).toBe("in_progress");
    expect(row.passed).toBeNull();
    expect(row.leadSubmittedAt).not.toBeNull();

    // The lead's card is locked now.
    const again = await scoreReq(exam.id, { scores: marks(1, 1), final: false });
    expect(again.status).toBe(409);
    expect((await again.json()).error).toBe("CARD_SUBMITTED");

    // A co-judge DRAFT must not complete the exam.
    await login(w.cojudge);
    const draft = await (await scoreReq(exam.id, { scores: marks(6, 6), judgeId: w.cojudge.id })).json();
    expect(draft.completed).toBe(false);

    const last = await (await scoreReq(exam.id, { scores: marks(8, 8), judgeId: w.cojudge.id, final: true })).json();
    expect(last.completed).toBe(true);
    // mean(20, 16) = 18 of 20 → 90% → pass.
    expect(last.totalScore).toBe(18);
    expect(last.passed).toBe(true);
    row = await prisma.exam.findUniqueOrThrow({ where: { id: exam.id } });
    expect(row.status).toBe("completed");
    expect(await prisma.certificate.count({ where: { examId: exam.id } })).toBe(1);
  });

  it("a seated co-judge cannot write the lead's card by leaving out judgeId", async () => {
    const w = await world();
    const exam = await mkExam(w, { withCoJudge: true });
    await login(w.lead);
    await scoreReq(exam.id, { scores: marks(9, 9) });
    await login(w.cojudge);
    const r = await scoreReq(exam.id, { scores: marks(0, 0) });
    expect(r.status).toBe(403);
    expect((await r.json()).error).toBe("NOT_YOUR_CARD");
    expect((await prisma.exam.findUniqueOrThrow({ where: { id: exam.id } })).scoresJson).toEqual(marks(9, 9));
  });

  it("removing a no-show co-judge completes an exam whose other cards are all in", async () => {
    const w = await world();
    const exam = await mkExam(w, { withCoJudge: true });
    await login(w.lead);
    await scoreReq(exam.id, { scores: marks(9, 9), final: true });
    const judgeRow = await prisma.examJudge.findFirstOrThrow({ where: { examId: exam.id } });
    await login(w.manager);
    const r = await removeJudge(req("DELETE", `/api/exams/${exam.id}/judges/${judgeRow.id}`), {
      params: { id: exam.id, judgeRowId: judgeRow.id },
    });
    expect((await r.json()).completed).toBe(true);
    const row = await prisma.exam.findUniqueOrThrow({ where: { id: exam.id } });
    expect(row.status).toBe("completed");
    expect(row.totalScore).toBe(18);
  });

  it("resetting a co-judge's draft clears only that card", async () => {
    const w = await world();
    const exam = await mkExam(w, { withCoJudge: true });
    await login(w.lead);
    await scoreReq(exam.id, { scores: marks(9, 9) });
    await login(w.cojudge);
    await scoreReq(exam.id, { scores: marks(4, 4), judgeId: w.cojudge.id });
    const r = await resetCard(req("DELETE", `/api/exams/${exam.id}/score`, { judgeId: w.cojudge.id }), { params: { id: exam.id } });
    expect(r.status).toBe(200);
    const row = await prisma.exam.findUniqueOrThrow({ where: { id: exam.id }, include: { judges: true } });
    expect(row.scoresJson).toEqual(marks(9, 9));
    expect(row.judges[0].scoresJson).toBeNull();
    expect(row.status).toBe("in_progress");
    // Provisional total is the lead's card alone now.
    expect(row.totalScore).toBe(18);
  });
});

describe("reopen for correction (gap 3)", () => {
  it("a pass re-marked as a fail revokes the certificate and rolls the rider's level back", async () => {
    const w = await world();
    const exam = await mkExam(w);
    await login(w.lead);
    const done = await (await scoreReq(exam.id, { scores: marks(10, 9), final: true })).json();
    expect(done.passed).toBe(true);
    expect((await prisma.rider.findUniqueOrThrow({ where: { id: w.rider.id } })).currentLevel).toBe("Level 1");

    // Examiners can't reopen; a manager can, with a reason.
    const denied = await reopen(req("POST", `/api/exams/${exam.id}/reopen`, { reason: "wrong rider" }), { params: { id: exam.id } });
    expect(denied.status).toBe(403);
    await login(w.manager);
    const short = await reopen(req("POST", `/api/exams/${exam.id}/reopen`, { reason: "x" }), { params: { id: exam.id } });
    expect(short.status).toBe(400);
    const ok = await reopen(req("POST", `/api/exams/${exam.id}/reopen`, { reason: "Marks entered on the wrong card" }), { params: { id: exam.id } });
    expect(ok.status).toBe(200);
    let row = await prisma.exam.findUniqueOrThrow({ where: { id: exam.id } });
    expect(row.status).toBe("in_progress");
    expect(row.leadSubmittedAt).toBeNull();
    expect(row.reopenReason).toBe("Marks entered on the wrong card");
    // Marks are kept for correction; the certificate stands until re-completion.
    expect(row.scoresJson).toEqual(marks(10, 9));
    expect(await prisma.certificate.count({ where: { examId: exam.id, revokedAt: null } })).toBe(1);

    await login(w.lead);
    const redo = await (await scoreReq(exam.id, { scores: marks(5, 5), final: true })).json();
    expect(redo.completed).toBe(true);
    expect(redo.passed).toBe(false);
    row = await prisma.exam.findUniqueOrThrow({ where: { id: exam.id } });
    expect(row.passed).toBe(false);
    expect(await prisma.certificate.count({ where: { examId: exam.id, revokedAt: null } })).toBe(0);
    expect((await prisma.rider.findUniqueOrThrow({ where: { id: w.rider.id } })).currentLevel).toBeNull();
  });

  it("a corrected pass keeps the same certificate rather than minting a second", async () => {
    const w = await world();
    const exam = await mkExam(w);
    await login(w.lead);
    await scoreReq(exam.id, { scores: marks(10, 9), final: true });
    const cert = await prisma.certificate.findFirstOrThrow({ where: { examId: exam.id } });
    await login(w.manager);
    await reopen(req("POST", `/api/exams/${exam.id}/reopen`, { reason: "Trot mark was mistyped" }), { params: { id: exam.id } });
    await login(w.lead);
    const redo = await (await scoreReq(exam.id, { scores: marks(10, 10), final: true })).json();
    expect(redo.passed).toBe(true);
    expect(redo.certificateId).toBe(cert.id);
    expect(await prisma.certificate.count({ where: { riderId: w.rider.id } })).toBe(1);
  });

  it("refuses to reopen an exam that isn't completed", async () => {
    const w = await world();
    const exam = await mkExam(w);
    await login(w.manager);
    const r = await reopen(req("POST", `/api/exams/${exam.id}/reopen`, { reason: "Just checking" }), { params: { id: exam.id } });
    expect(r.status).toBe(409);
  });
});

describe("result and certificate commit together (gap 4)", () => {
  it("with no public URL the pass is NOT recorded, so it can simply be submitted again", async () => {
    const w = await world();
    const exam = await mkExam(w);
    const saved = {
      a: process.env.NEXT_PUBLIC_APP_URL,
      b: process.env.APP_BASE_URL,
      c: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    };
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.APP_BASE_URL;
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    try {
      await login(w.lead);
      const r = await scoreReq(exam.id, { scores: marks(10, 10), final: true });
      expect(r.status).toBe(503);
      expect((await r.json()).error).toBe("NO_PUBLIC_URL");
      const row = await prisma.exam.findUniqueOrThrow({ where: { id: exam.id } });
      expect(row.status).not.toBe("completed");
      expect(row.leadSubmittedAt).toBeNull();
      expect(await prisma.certificate.count()).toBe(0);
    } finally {
      process.env.NEXT_PUBLIC_APP_URL = saved.a ?? "http://localhost:3100";
      if (saved.b) process.env.APP_BASE_URL = saved.b;
      if (saved.c) process.env.VERCEL_PROJECT_PRODUCTION_URL = saved.c;
    }
    const retry = await scoreReq(exam.id, { scores: marks(10, 10), final: true });
    expect((await retry.json()).completed).toBe(true);
    expect(await prisma.certificate.count()).toBe(1);
  });
});

describe("schedule controls (gap 6)", () => {
  it("refuses to book a rider twice for the same open level", async () => {
    const w = await world();
    await login(w.manager);
    const body = { level: 1, date: "2026-10-01", examinerIds: [w.lead.id], riderIds: [w.rider.id] };
    expect((await createSitting(req("POST", "/api/exam-sittings", body))).status).toBe(200);
    const dup = await createSitting(req("POST", "/api/exam-sittings", { ...body, date: "2026-10-08" }));
    expect(dup.status).toBe(409);
    expect((await dup.json()).error).toBe("RIDER_ALREADY_SCHEDULED");
    expect(await prisma.exam.count()).toBe(1);
  });

  it("reschedules a single exam, but sends a sitting exam to its sitting", async () => {
    const w = await world();
    const exam = await mkExam(w);
    await login(w.manager);
    const r = await examPatch(req("PATCH", `/api/exams/${exam.id}`, { date: "2026-10-05", time: "07:30" }), { params: { id: exam.id } });
    expect(r.status).toBe(200);
    const row = await prisma.exam.findUniqueOrThrow({ where: { id: exam.id } });
    expect(row.date.toISOString().slice(0, 10)).toBe("2026-10-05");
    expect(row.time).toBe("07:30");

    const other = await mkRider({ centreId: w.centre.id, firstName: "Other" });
    const s = await (await createSitting(req("POST", "/api/exam-sittings", { level: 1, date: "2026-10-01", examinerIds: [w.lead.id], riderIds: [other.id] }))).json();
    const sittingExam = await prisma.exam.findFirstOrThrow({ where: { sittingId: s.id } });
    const blocked = await examPatch(req("PATCH", `/api/exams/${sittingExam.id}`, { date: "2026-10-09" }), { params: { id: sittingExam.id } });
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error).toBe("IN_SITTING");
  });

  it("removes a rider from a sitting only with explicit consent to discard marks, and never a result", async () => {
    const w = await world();
    const other = await mkRider({ centreId: w.centre.id, firstName: "Other" });
    await login(w.manager);
    const s = await (await createSitting(
      req("POST", "/api/exam-sittings", { level: 1, date: "2026-10-01", examinerIds: [w.lead.id], riderIds: [w.rider.id, other.id] }),
    )).json();
    const [a, b] = await prisma.exam.findMany({ where: { sittingId: s.id }, orderBy: { createdAt: "asc" } });

    // a: marked draft. b: completed.
    await prisma.exam.update({ where: { id: a.id }, data: { examinerId: w.lead.id, scoresJson: marks(3, 3), status: "in_progress" } });
    await prisma.exam.update({ where: { id: b.id }, data: { status: "completed", passed: false, totalScore: 5 } });

    const needsConsent = await examDelete(req("DELETE", `/api/exams/${a.id}`, {}), { params: { id: a.id } });
    expect(needsConsent.status).toBe(409);
    expect((await needsConsent.json()).error).toBe("HAS_MARKS");
    const refused = await examDelete(req("DELETE", `/api/exams/${b.id}`, { discardMarks: true }), { params: { id: b.id } });
    expect(refused.status).toBe(409);
    expect((await refused.json()).error).toBe("HAS_RESULT");

    const ok = await examDelete(req("DELETE", `/api/exams/${a.id}`, { discardMarks: true }), { params: { id: a.id } });
    expect(ok.status).toBe(200);
    expect(await prisma.exam.count({ where: { id: a.id } })).toBe(0);
    // The sitting stays — it still holds b's result.
    expect(await prisma.examSitting.count({ where: { id: s.id } })).toBe(1);
  });

  it("moves a sitting's waiting riders, and cancelling keeps riders with results", async () => {
    const w = await world();
    const other = await mkRider({ centreId: w.centre.id, firstName: "Other" });
    await login(w.manager);
    const s = await (await createSitting(
      req("POST", "/api/exam-sittings", { level: 1, date: "2026-10-01", examinerIds: [w.lead.id], riderIds: [w.rider.id, other.id] }),
    )).json();
    const moved = await sittingPatch(req("PATCH", `/api/exam-sittings/${s.id}`, { date: "2026-10-15", time: "08:00" }), { params: { id: s.id } });
    expect((await moved.json()).examsMoved).toBe(2);
    expect((await prisma.examSitting.findUniqueOrThrow({ where: { id: s.id } })).date.toISOString().slice(0, 10)).toBe("2026-10-15");

    const [a] = await prisma.exam.findMany({ where: { sittingId: s.id }, orderBy: { createdAt: "asc" } });
    await prisma.exam.update({ where: { id: a.id }, data: { status: "completed", passed: true, totalScore: 18 } });
    const frozen = await sittingPatch(req("PATCH", `/api/exam-sittings/${s.id}`, { date: "2026-10-20" }), { params: { id: s.id } });
    expect(frozen.status).toBe(409);

    const cancel = await (await sittingDelete(req("DELETE", `/api/exam-sittings/${s.id}`, {}), { params: { id: s.id } })).json();
    expect(cancel).toMatchObject({ removed: 1, kept: 1, sittingRemoved: false });
    expect(await prisma.exam.count({ where: { sittingId: s.id } })).toBe(1);
  });
});

describe("results export (gap 6)", () => {
  it("exports completed results with the right max, and refuses examiners", async () => {
    const w = await world();
    const exam = await mkExam(w);
    await login(w.lead);
    await scoreReq(exam.id, { scores: marks(9, 8), final: true });

    const denied = await exportGet(req("GET", "/api/export/exams"), { params: { entity: "exams" } });
    expect(denied.status).toBe(403);

    await login(w.manager);
    const res = await exportGet(req("GET", "/api/export/exams?status=completed"), { params: { entity: "exams" } });
    expect(res.status).toBe(200);
    const csv = await res.text();
    const [header, row] = csv.replace(/^﻿/, "").trim().split("\r\n");
    const cols = header.split(",");
    const cells = row.split(",");
    const at = (name: string) => cells[cols.indexOf(name)];
    expect(at("Total")).toBe("17");
    expect(at("Max")).toBe("20");
    expect(at("Percent")).toBe("85");
    expect(at("Result")).toBe("Pass");
    expect(at("Certificate")).toMatch(/^EW-L1-/);
  });
});
