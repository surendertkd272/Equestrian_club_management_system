// Batch E — task.kind, exam support staff, teams + medal rollup, horse
// workload guard (already in place; verified here for completeness).

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkCentre, mkUser, mkRider } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { signSession, type SessionPayload } from "@/lib/auth";
import { medalsForRider, medalsForTeam } from "@/lib/medals";
import { mockReq } from "../helpers/request";

const cookieJar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => cookieJar.get(name),
    set: (name: string, value: string) => cookieJar.set(name, { value }),
    delete: (name: string) => cookieJar.delete(name),
  }),
}));

const { POST: createTask } = await import("@/app/api/tasks/route");
const { POST: createTeam } = await import("@/app/api/teams/route");
const { POST: addMember, DELETE: removeMember } = await import("@/app/api/teams/[id]/members/route");
const { PATCH: setSupportStaff } = await import("@/app/api/exams/[id]/support-staff/route");
const { POST: createAllocation } = await import("@/app/api/horses/[id]/allocations/route");

async function loginAs(payload: SessionPayload) {
  cookieJar.clear();
  cookieJar.set("ew_session", { value: await signSession(payload) });
}

beforeEach(async () => {
  await resetDb();
  cookieJar.clear();
});

describe("Task.kind — dress rehearsals", () => {
  it("accepts the dress_rehearsal kind and stores it", async () => {
    const centre = await mkCentre();
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id });
    await loginAs({ userId: mgr.id, role: "CENTRE_MANAGER", centreId: centre.id, name: mgr.name });

    const r = await createTask(
      mockReq("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          title: "Dress rehearsal: Royal Cup",
          description: "Full show kit. 18:00 in main arena.",
          kind: "dress_rehearsal",
        }),
      }),
    );
    expect(r.status).toBe(200);

    const rows = await prisma.task.findMany({ where: { centreId: centre.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("dress_rehearsal");
  });
});

describe("Exam.supportStaffJson — test-day grooms", () => {
  it("sets, refuses bad IDs, clears on empty", async () => {
    const centre = await mkCentre();
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id });
    const examiner = await mkUser({ role: "EXAMINER", centreId: centre.id });
    const groomA = await mkUser({ role: "GROOM", centreId: centre.id });
    const groomB = await mkUser({ role: "GROOM", centreId: centre.id });
    const rider = await mkRider({ centreId: centre.id });
    const exam = await prisma.exam.create({
      data: {
        centreId: centre.id,
        riderId: rider.id,
        examinerId: examiner.id,
        examinerName: examiner.name,
        level: 1,
        date: new Date(),
      },
    });
    await loginAs({ userId: mgr.id, role: "CENTRE_MANAGER", centreId: centre.id, name: mgr.name });

    const ok = await setSupportStaff(
      mockReq("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ supportStaffIds: [groomA.id, groomB.id] }),
      }),
      { params: { id: exam.id } },
    );
    expect(ok.status).toBe(200);
    let row = await prisma.exam.findUniqueOrThrow({ where: { id: exam.id } });
    // supportStaffJson is now a jsonb column — Prisma returns the parsed array.
    expect(row.supportStaffJson as unknown[]).toHaveLength(2);

    // Bogus ID
    const bad = await setSupportStaff(
      mockReq("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ supportStaffIds: ["nope"] }),
      }),
      { params: { id: exam.id } },
    );
    expect(bad.status).toBe(400);

    // Clear
    const clear = await setSupportStaff(
      mockReq("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ supportStaffIds: [] }),
      }),
      { params: { id: exam.id } },
    );
    expect(clear.status).toBe(200);
    row = await prisma.exam.findUniqueOrThrow({ where: { id: exam.id } });
    expect(row.supportStaffJson).toBeNull();
  });
});

describe("Teams + members", () => {
  it("creates a team, adds + removes members, idempotent re-add", async () => {
    const centre = await mkCentre();
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id });
    const r1 = await mkRider({ centreId: centre.id });
    const r2 = await mkRider({ centreId: centre.id });
    await loginAs({ userId: mgr.id, role: "CENTRE_MANAGER", centreId: centre.id, name: mgr.name });

    const create = await createTeam(
      mockReq("http://localhost", {
        method: "POST",
        body: JSON.stringify({ name: "Senior Show Jumping 2026", season: "2026" }),
      }),
    );
    expect(create.status).toBe(200);
    const { id: teamId } = await create.json();

    await addMember(
      mockReq("http://localhost", { method: "POST", body: JSON.stringify({ riderId: r1.id }) }),
      { params: { id: teamId } },
    );
    await addMember(
      mockReq("http://localhost", { method: "POST", body: JSON.stringify({ riderId: r2.id, position: "Reserve" }) }),
      { params: { id: teamId } },
    );
    // Re-add (idempotent)
    await addMember(
      mockReq("http://localhost", { method: "POST", body: JSON.stringify({ riderId: r1.id, position: "Captain" }) }),
      { params: { id: teamId } },
    );

    const members = await prisma.teamMember.findMany({ where: { teamId } });
    expect(members).toHaveLength(2);
    expect(members.find((m) => m.riderId === r1.id)?.position).toBe("Captain");

    const remove = await removeMember(
      mockReq(`http://localhost?riderId=${r1.id}`, { method: "DELETE" }),
      { params: { id: teamId } },
    );
    expect(remove.status).toBe(200);
    const after = await prisma.teamMember.findMany({ where: { teamId } });
    expect(after).toHaveLength(1);
  });

  it("refuses to add a rider from a different centre", async () => {
    const a = await mkCentre();
    const b = await mkCentre();
    const mgrA = await mkUser({ role: "CENTRE_MANAGER", centreId: a.id });
    const riderB = await mkRider({ centreId: b.id });
    await loginAs({ userId: mgrA.id, role: "CENTRE_MANAGER", centreId: a.id, name: mgrA.name });

    const c = await createTeam(
      mockReq("http://localhost", { method: "POST", body: JSON.stringify({ name: "A team" }) }),
    );
    const { id: teamId } = await c.json();
    const r = await addMember(
      mockReq("http://localhost", { method: "POST", body: JSON.stringify({ riderId: riderB.id }) }),
      { params: { id: teamId } },
    );
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("RIDER_CROSS_CENTRE");
  });
});

describe("Medal rollup (lib/medals)", () => {
  it("counts gold / silver / bronze + total placements per rider", async () => {
    const centre = await mkCentre();
    const rider = await mkRider({ centreId: centre.id });
    const comp = await prisma.competition.create({
      data: {
        centreId: centre.id,
        name: "Test",
        slug: `t-${Date.now()}`,
        scope: "internal",
        startDate: new Date(),
        endDate: new Date(),
        classesJson: JSON.stringify([{ name: "Open", fee: 0 }]),
      },
    });
    // 1×gold, 1×silver, 1×bronze, 1×placed-4th
    for (const placement of [1, 2, 3, 4]) {
      await prisma.competitionEntry.create({
        data: {
          competitionId: comp.id,
          riderId: rider.id,
          className: `C${placement}`,
          placement,
        },
      });
    }
    // One un-placed entry
    await prisma.competitionEntry.create({
      data: { competitionId: comp.id, riderId: rider.id, className: "C5" },
    });

    const t = await medalsForRider(rider.id);
    expect(t.gold).toBe(1);
    expect(t.silver).toBe(1);
    expect(t.bronze).toBe(1);
    expect(t.placed).toBe(4); // includes the 4th-place finish
    expect(t.entries).toBe(5); // all entered (incl. unplaced)
  });

  it("rolls medals up across a team", async () => {
    const centre = await mkCentre();
    const r1 = await mkRider({ centreId: centre.id });
    const r2 = await mkRider({ centreId: centre.id });
    const team = await prisma.team.create({ data: { centreId: centre.id, name: "T" } });
    await prisma.teamMember.create({ data: { teamId: team.id, riderId: r1.id } });
    await prisma.teamMember.create({ data: { teamId: team.id, riderId: r2.id } });

    const comp = await prisma.competition.create({
      data: {
        centreId: centre.id,
        name: "X",
        slug: `x-${Date.now()}`,
        scope: "internal",
        startDate: new Date(),
        endDate: new Date(),
        classesJson: JSON.stringify([{ name: "Open", fee: 0 }]),
      },
    });
    await prisma.competitionEntry.create({ data: { competitionId: comp.id, riderId: r1.id, className: "Open", placement: 1 } });
    await prisma.competitionEntry.create({ data: { competitionId: comp.id, riderId: r2.id, className: "Open", placement: 3 } });

    const t = await medalsForTeam(team.id);
    expect(t.gold).toBe(1);
    expect(t.bronze).toBe(1);
    expect(t.entries).toBe(2);
  });
});

describe("Horse workload guard (existing — sanity check)", () => {
  it("refuses an allocation that would push the horse past the daily cap", async () => {
    const centre = await mkCentre();
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id });
    const horse = await prisma.horse.create({ data: { centreId: centre.id, name: "Bijli" } });
    await loginAs({ userId: mgr.id, role: "CENTRE_MANAGER", centreId: centre.id, name: mgr.name });

    // Three 90-min allocations = 270 min (under cap of 240?). Cap is 240, so
    // two 120-min slots already hits the limit; a third should fail.
    const day = "2026-06-01";
    const slot = (h: number) => `${day}T${String(h).padStart(2, "0")}:00`;
    const ok = await createAllocation(
      mockReq("http://localhost", {
        method: "POST",
        body: JSON.stringify({ purpose: "lesson", startAt: slot(7), endAt: slot(9) }),
      }),
      { params: { id: horse.id } },
    );
    expect(ok.status).toBe(200);
    const ok2 = await createAllocation(
      mockReq("http://localhost", {
        method: "POST",
        body: JSON.stringify({ purpose: "lesson", startAt: slot(10), endAt: slot(12) }),
      }),
      { params: { id: horse.id } },
    );
    expect(ok2.status).toBe(200);
    const fail = await createAllocation(
      mockReq("http://localhost", {
        method: "POST",
        body: JSON.stringify({ purpose: "lesson", startAt: slot(14), endAt: slot(15) }),
      }),
      { params: { id: horse.id } },
    );
    expect(fail.status).toBe(409);
    expect((await fail.json()).error).toBe("WORKLOAD_EXCEEDED");
  });
});
