// Exam-day operations (2026-09-30):
//   1. A rider who doesn't turn up is marked absent — the sitting can finish.
//   2. The examiner pool can change after booking.
//   4. A running order gives each rider a slot; moving the day keeps the spacing.
//   7. A horse is booked per rider slot, under the lesson workload rules.
// (3, the scorer's phone copy + autosave, is client-side — checked in the browser.)

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkOrg, mkCentre, mkUser } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { signSession } from "@/lib/auth";
import { mockReq } from "../helpers/request";
import type { SessionPayload } from "@/lib/auth";
import type { Role } from "@/lib/roles";
import { slotTimes, shiftTime } from "@/lib/exam-running-order";

const cookieJar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (n: string) => cookieJar.get(n),
    set: (n: string, v: string) => cookieJar.set(n, { value: v }),
    delete: (n: string) => cookieJar.delete(n),
  }),
}));

const { POST: bookDay } = await import("@/app/api/exam-days/route");
const { PATCH: moveDay } = await import("@/app/api/exam-days/[id]/route");
const { POST: absent } = await import("@/app/api/exams/[id]/absent/route");
const { POST: claim } = await import("@/app/api/exams/[id]/claim/route");
const { POST: addPool, DELETE: removePool } = await import("@/app/api/exam-sittings/[id]/examiners/route");
const { POST: addPanel } = await import("@/app/api/exam-sittings/[id]/panel/route");
const { POST: runningOrder } = await import("@/app/api/exam-sittings/[id]/running-order/route");
const { POST: claimNext } = await import("@/app/api/exam-sittings/[id]/claim-next/route");
const { POST: addSittingRiders } = await import("@/app/api/exam-sittings/[id]/riders/route");
const { PUT: setHorse } = await import("@/app/api/exams/[id]/horse/route");
const { DELETE: removeExam } = await import("@/app/api/exams/[id]/route");

type U = { id: string; role: string; centreId: string | null; name: string };
async function login(u: U) {
  cookieJar.clear();
  const payload: SessionPayload = { userId: u.id, role: u.role as Role, centreId: u.centreId, name: u.name, tokenVersion: 0 };
  cookieJar.set("ew_session", { value: await signSession(payload) });
}
const req = (body: unknown, method = "POST") =>
  mockReq("http://localhost/x", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: { id } });
const ymd = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const RUBRIC = [{ name: "Flat", items: [{ name: "Walk", max_score: 10 }] }];

beforeEach(async () => {
  await resetDb();
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3100";
});

async function world(n = 4) {
  const org = await mkOrg();
  const centre = await mkCentre({ orgId: org.id, name: "HPS" });
  await prisma.centre.update({ where: { id: centre.id }, data: { timezone: "Asia/Kolkata" } });
  const manager = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id, name: "Anita" });
  await prisma.centre.update({ where: { id: centre.id }, data: { managerId: manager.id } });
  await prisma.scoringTemplate.create({
    data: { centreId: centre.id, levelKey: "1", levelName: "Level 1", passThreshold: 70, categoriesJson: RUBRIC },
  });
  const [a, b, c] = await Promise.all(["Judge A", "Judge B", "Judge C"].map((name) => mkUser({ role: "EXAMINER", centreId: centre.id, name })));
  await prisma.rider.createMany({
    data: Array.from({ length: n }, (_, i) => ({
      centreId: centre.id, firstName: `Rider${i}`, lastName: "Test", dob: new Date("2012-01-01"), mobile: "9876543210", status: "active",
    })),
  });
  const riders = (await prisma.rider.findMany({ where: { centreId: centre.id }, orderBy: { firstName: "asc" } })).map((r) => r.id);
  await login(manager);
  const res = await bookDay(
    req({ name: "Exam day", date: ymd(7), time: "09:00", entries: riders.map((riderId) => ({ riderId, level: 1 })), pools: { "1": [a.id] } }),
  );
  const body = await res.json();
  const sittingId = body.sittings[0].id as string;
  const exams = await prisma.exam.findMany({ where: { sittingId }, include: { rider: true }, orderBy: { rider: { firstName: "asc" } } });
  return { org, centre, manager, a, b, c, riders, dayId: body.id as string, sittingId, exams };
}

describe("absent riders (1)", () => {
  it("a pool examiner marks a no-show absent; the sitting then finishes and the manager hears once", async () => {
    const w = await world(2);
    // The other rider has been marked.
    await prisma.exam.update({ where: { id: w.exams[1].id }, data: { status: "completed", passed: true, totalScore: 9, examinerId: w.a.id } });
    await login(w.a);
    const res = await absent(req({ absent: true, reason: "unwell" }), ctx(w.exams[0].id));
    expect(res.status).toBe(200);
    const e = await prisma.exam.findUniqueOrThrow({ where: { id: w.exams[0].id } });
    expect(e).toMatchObject({ status: "absent", absentReason: "unwell", examinerId: null });
    const notes = await prisma.notification.findMany({ where: { userId: w.manager.id, type: "exam.sitting_complete" } });
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toContain("1 of 1 passed");
    expect(notes[0].body).toContain("1 absent");
    // An absent rider can't be picked or marked.
    expect((await (await claim(req({}), ctx(e.id))).json()).error).toBe("RIDER_ABSENT");
  });

  it("undo puts them back in the queue and re-arms the summary", async () => {
    const w = await world(2);
    await login(w.manager);
    await absent(req({ absent: true }), ctx(w.exams[0].id));
    await prisma.examSitting.update({ where: { id: w.sittingId }, data: { completedNotifiedAt: new Date() } });
    const res = await absent(req({ absent: false }), ctx(w.exams[0].id));
    expect(res.status).toBe(200);
    expect((await prisma.exam.findUniqueOrThrow({ where: { id: w.exams[0].id } })).status).toBe("scheduled");
    expect((await prisma.examSitting.findUniqueOrThrow({ where: { id: w.sittingId } })).completedNotifiedAt).toBeNull();
  });

  it("won't mark absent once marks are on the card, and an absent rider can be rebooked", async () => {
    const w = await world(2);
    await prisma.exam.update({ where: { id: w.exams[0].id }, data: { examinerId: w.a.id, status: "in_progress", scoresJson: { Flat_Walk: 5 } } });
    await login(w.manager);
    expect((await (await absent(req({ absent: true }), ctx(w.exams[0].id))).json()).error).toBe("HAS_MARKS");

    await absent(req({ absent: true }), ctx(w.exams[1].id));
    // Booked again onto another day — then "undo absent" on the first is refused.
    const again = await bookDay(
      req({ name: "Retake day", date: ymd(20), entries: [{ riderId: w.exams[1].riderId, level: 1 }], pools: { "1": [w.a.id] } }),
    );
    expect(again.status).toBe(200);
    expect((await (await absent(req({ absent: false }), ctx(w.exams[1].id))).json()).error).toBe("ALREADY_REBOOKED");
  });

  it("a coach who isn't on the exam can't", async () => {
    const w = await world(1);
    await login(await mkUser({ role: "COACH", centreId: w.centre.id }));
    expect((await absent(req({ absent: true }), ctx(w.exams[0].id))).status).toBe(403);
  });
});

describe("changing the examiner pool (2)", () => {
  it("adds a replacement; refuses a panel judge", async () => {
    const w = await world(2);
    await addPanel(req({ judgeIds: [w.c.id] }), ctx(w.sittingId));
    expect((await (await addPool(req({ examinerIds: [w.c.id] }), ctx(w.sittingId))).json()).error).toBe("JUDGE_ON_PANEL");
    const res = await addPool(req({ examinerIds: [w.b.id] }), ctx(w.sittingId));
    expect(res.status).toBe(200);
    expect((await prisma.examSittingExaminer.findMany({ where: { sittingId: w.sittingId } })).map((x) => x.examinerId).sort()).toEqual(
      [w.a.id, w.b.id].sort(),
    );
  });

  it("taking an examiner out returns their unstarted riders to the queue, but not ones they've marked", async () => {
    const w = await world(3);
    await addPool(req({ examinerIds: [w.b.id] }), ctx(w.sittingId));
    await prisma.exam.update({ where: { id: w.exams[0].id }, data: { examinerId: w.a.id, examinerName: "Judge A", status: "in_progress" } });
    await prisma.exam.update({
      where: { id: w.exams[1].id },
      data: { examinerId: w.a.id, examinerName: "Judge A", status: "in_progress", scoresJson: { Flat_Walk: 7 } },
    });
    const refused = await removePool(req({ examinerId: w.a.id }, "DELETE"), ctx(w.sittingId));
    expect((await refused.json()).error).toBe("HAS_STARTED_CARDS");

    await prisma.exam.update({ where: { id: w.exams[1].id }, data: { examinerId: w.b.id, examinerName: "Judge B" } });
    const ok = await removePool(req({ examinerId: w.a.id }, "DELETE"), ctx(w.sittingId));
    expect(await ok.json()).toMatchObject({ ridersReleased: 1 });
    expect(await prisma.exam.findUniqueOrThrow({ where: { id: w.exams[0].id } })).toMatchObject({ examinerId: null, status: "scheduled" });
  });

  it("won't remove the last examiner while riders wait", async () => {
    const w = await world(1);
    expect((await (await removePool(req({ examinerId: w.a.id }, "DELETE"), ctx(w.sittingId))).json()).error).toBe("LAST_EXAMINER");
  });
});

describe("running order (4)", () => {
  it("works out slots with breaks, and refuses to run past midnight", () => {
    expect(slotTimes(5, { start: "09:00", slotMinutes: 10, breakEvery: 2, breakMinutes: 15 })).toEqual([
      "09:00", "09:10", "09:35", "09:45", "10:10",
    ]);
    expect(slotTimes(10, { start: "23:30", slotMinutes: 10 })).toBeNull();
    expect(shiftTime("09:10", 60)).toBe("10:10");
  });

  it("gives every rider a place and a slot; the next pick follows the order", async () => {
    const w = await world(4);
    const res = await runningOrder(req({ start: "09:00", slotMinutes: 8, sort: "name" }), ctx(w.sittingId));
    expect(await res.json()).toMatchObject({ ordered: 4, first: "09:00", last: "09:24" });
    const ordered = await prisma.exam.findMany({ where: { sittingId: w.sittingId }, orderBy: { runOrder: "asc" }, include: { rider: true } });
    expect(ordered.map((e) => [e.runOrder, e.time, e.rider.firstName])).toEqual([
      [1, "09:00", "Rider0"], [2, "09:08", "Rider1"], [3, "09:16", "Rider2"], [4, "09:24", "Rider3"],
    ]);
    await login(w.a);
    const first = await (await claimNext(req({}), ctx(w.sittingId))).json();
    const second = await (await claimNext(req({}), ctx(w.sittingId))).json();
    expect([first.id, second.id]).toEqual([ordered[0].id, ordered[1].id]);
  });

  it("re-doing the order leaves riders already riding where they are; late riders go on the end", async () => {
    const w = await world(3);
    await runningOrder(req({ start: "09:00", slotMinutes: 10 }), ctx(w.sittingId));
    await prisma.exam.update({ where: { id: w.exams[0].id }, data: { examinerId: w.a.id, status: "in_progress" } });
    await runningOrder(req({ start: "10:00", slotMinutes: 10 }), ctx(w.sittingId));
    const riding = await prisma.exam.findUniqueOrThrow({ where: { id: w.exams[0].id } });
    expect([riding.runOrder, riding.time]).toEqual([1, "09:00"]);
    const rest = await prisma.exam.findMany({ where: { sittingId: w.sittingId, id: { not: w.exams[0].id } }, orderBy: { runOrder: "asc" } });
    expect(rest.map((e) => [e.runOrder, e.time])).toEqual([[2, "10:00"], [3, "10:10"]]);

    // An absent rider gives up their place; numbering doesn't skip over them.
    await absent(req({ absent: true }), ctx(rest[1].id));
    await runningOrder(req({ start: "10:00", slotMinutes: 10 }), ctx(w.sittingId));
    const after = await prisma.exam.findMany({ where: { sittingId: w.sittingId }, orderBy: { id: "asc" } });
    expect(after.find((e) => e.id === rest[1].id)!.runOrder).toBeNull();
    expect(after.find((e) => e.id === rest[0].id)!.runOrder).toBe(2);
    await absent(req({ absent: false }), ctx(rest[1].id));

    const late = await prisma.rider.create({
      data: { centreId: w.centre.id, firstName: "Late", lastName: "Rider", dob: new Date("2012-01-01"), mobile: "9876543210", status: "active" },
    });
    await addSittingRiders(req({ riderIds: [late.id] }), ctx(w.sittingId));
    const lateExam = await prisma.exam.findFirstOrThrow({ where: { riderId: late.id } });
    expect([lateExam.runOrder, lateExam.time]).toEqual([4, "10:20"]);
  });

  it("moving the day's start shifts every slot by the same amount", async () => {
    const w = await world(2);
    await runningOrder(req({ start: "09:00", slotMinutes: 15 }), ctx(w.sittingId));
    const res = await moveDay(req({ time: "10:30" }, "PATCH"), ctx(w.dayId));
    expect(res.status).toBe(200);
    const times = (await prisma.exam.findMany({ where: { sittingId: w.sittingId }, orderBy: { runOrder: "asc" } })).map((e) => e.time);
    expect(times).toEqual(["10:30", "10:45"]);
  });
});

describe("a horse per rider (7)", () => {
  async function horses(centreId: string) {
    const [bella, storm, old] = await Promise.all(
      ["Bella", "Storm", "Old Tom"].map((name) => prisma.horse.create({ data: { centreId, name } })),
    );
    await prisma.horse.update({ where: { id: old.id }, data: { status: "retired" } });
    return { bella, storm, old };
  }

  it("needs a running order, then books the horse for the rider's slot", async () => {
    const w = await world(2);
    const h = await horses(w.centre.id);
    const put = (examId: string, horseId: string | null) => setHorse(req({ horseId }, "PUT"), ctx(examId));
    expect((await (await put(w.exams[0].id, h.bella.id)).json()).error).toBe("NO_RUNNING_ORDER");

    await runningOrder(req({ start: "09:00", slotMinutes: 10, sort: "name" }), ctx(w.sittingId));
    expect((await put(w.exams[0].id, h.bella.id)).status).toBe(200);
    // The same horse can take the next slot — they don't overlap.
    expect((await put(w.exams[1].id, h.bella.id)).status).toBe(200);
    const allocs = await prisma.horseAllocation.findMany({ where: { horseId: h.bella.id }, orderBy: { startAt: "asc" } });
    expect(allocs.map((a) => a.purpose)).toEqual(["exam", "exam"]);
    // 09:00 IST = 03:30 UTC.
    expect(allocs[0].startAt.toISOString().slice(11, 16)).toBe("03:30");
    expect((allocs[0].endAt.getTime() - allocs[0].startAt.getTime()) / 60000).toBe(10);

    expect((await (await put(w.exams[0].id, h.old.id)).json()).error).toBe("HORSE_NOT_AVAILABLE");
  });

  it("refuses a horse under drug withdrawal, or already booked at that time", async () => {
    const w = await world(1);
    const h = await horses(w.centre.id);
    await runningOrder(req({ start: "09:00", slotMinutes: 10 }), ctx(w.sittingId));
    const vet = await mkUser({ role: "VET", centreId: w.centre.id });
    const med = await prisma.medicine.create({
      data: { centreId: w.centre.id, name: "Bute", category: "nsaid", batchNo: "B1", expDate: new Date("2030-01-01") },
    });
    await prisma.medicineUsage.create({
      data: { medicineId: med.id, horseId: h.storm.id, vetUserId: vet.id, dose: "1g", route: "oral", withdrawalUntil: new Date(Date.now() + 30 * 86400000) },
    });
    expect((await (await setHorse(req({ horseId: h.storm.id }, "PUT"), ctx(w.exams[0].id))).json()).error).toBe("WITHDRAWAL_ACTIVE");

    const slot = await prisma.horseAllocation.create({
      data: {
        horseId: h.bella.id, purpose: "lesson",
        startAt: new Date(`${ymd(7)}T03:30:00Z`), endAt: new Date(`${ymd(7)}T04:30:00Z`),
      },
    });
    expect((await (await setHorse(req({ horseId: h.bella.id }, "PUT"), ctx(w.exams[0].id))).json()).error).toBe("OVERLAP");
    await prisma.horseAllocation.delete({ where: { id: slot.id } });
  });

  it("the horse is freed when the rider is absent or taken off", async () => {
    const w = await world(2);
    const h = await horses(w.centre.id);
    await runningOrder(req({ start: "09:00", slotMinutes: 10 }), ctx(w.sittingId));
    await setHorse(req({ horseId: h.bella.id }, "PUT"), ctx(w.exams[0].id));
    await setHorse(req({ horseId: h.storm.id }, "PUT"), ctx(w.exams[1].id));
    await absent(req({ absent: true }), ctx(w.exams[0].id));
    expect(await prisma.horseAllocation.count({ where: { horseId: h.bella.id } })).toBe(0);
    await removeExam(req(null, "DELETE"), ctx(w.exams[1].id));
    expect(await prisma.horseAllocation.count({ where: { horseId: h.storm.id } })).toBe(0);
  });

  it("one horse on back-to-back riders keeps every booking when the day moves", async () => {
    const w = await world(3);
    const h = await horses(w.centre.id);
    await runningOrder(req({ start: "09:00", slotMinutes: 10, sort: "name" }), ctx(w.sittingId));
    for (const e of w.exams) expect((await setHorse(req({ horseId: h.bella.id }, "PUT"), ctx(e.id))).status).toBe(200);
    const res = await moveDay(req({ time: "09:10" }, "PATCH"), ctx(w.dayId));
    expect((await res.json()).horsesReleased).toEqual([]);
    const starts = (await prisma.horseAllocation.findMany({ where: { horseId: h.bella.id }, orderBy: { startAt: "asc" } })).map((a) =>
      a.startAt.toISOString().slice(11, 16),
    );
    expect(starts).toEqual(["03:40", "03:50", "04:00"]);
  });

  it("booked horses move with the day", async () => {
    const w = await world(1);
    const h = await horses(w.centre.id);
    await runningOrder(req({ start: "09:00", slotMinutes: 10 }), ctx(w.sittingId));
    await setHorse(req({ horseId: h.bella.id }, "PUT"), ctx(w.exams[0].id));
    await moveDay(req({ time: "11:00" }, "PATCH"), ctx(w.dayId));
    const a = await prisma.horseAllocation.findFirstOrThrow({ where: { examId: w.exams[0].id } });
    expect(a.startAt.toISOString().slice(11, 16)).toBe("05:30");
  });
});
