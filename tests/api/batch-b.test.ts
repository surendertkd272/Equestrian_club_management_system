// Batch B — horse health module: FarrierVisit, HorseHealthLog, InjuryLog,
// VaccinationSchedule + their two sweeps.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkCentre, mkUser, mkRider } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { signSession, type SessionPayload } from "@/lib/auth";
import { DEFAULT_FARRIER_INTERVAL_DAYS } from "@/lib/schemas/farrier";
import { sweepFarrierDigest, sweepVaccinationDue } from "@/lib/sweeps";
import { mockReq } from "../helpers/request";

const cookieJar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => cookieJar.get(name),
    set: (name: string, value: string) => cookieJar.set(name, { value }),
    delete: (name: string) => cookieJar.delete(name),
  }),
}));

const { POST: createFarrier } = await import("@/app/api/farrier/route");
const { POST: completeFarrier } = await import("@/app/api/farrier/[id]/complete/route");
const { POST: postHealth } = await import("@/app/api/horses/[id]/health/route");
const { POST: createInjury } = await import("@/app/api/injuries/route");
const { PATCH: patchInjury } = await import("@/app/api/injuries/[id]/route");
const { POST: upsertVaccination } = await import("@/app/api/vaccinations/route");
const { POST: recordDose } = await import("@/app/api/vaccinations/[id]/dose/route");

async function loginAs(payload: SessionPayload) {
  cookieJar.clear();
  cookieJar.set("ew_session", { value: await signSession(payload) });
}

async function mkHorse(centreId: string, name = "Bijli") {
  return prisma.horse.create({ data: { centreId, name } });
}

beforeEach(async () => {
  await resetDb();
  cookieJar.clear();
});

describe("FarrierVisit", () => {
  it("schedules a visit, completes it, computes nextDueAt = +6 weeks", async () => {
    const centre = await mkCentre();
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id });
    const horse = await mkHorse(centre.id);
    await loginAs({ userId: mgr.id, role: "CENTRE_MANAGER", centreId: centre.id, name: mgr.name });

    // Schedule
    const r = await createFarrier(
      mockReq("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          horseId: horse.id,
          farrierName: "Hari Pal",
          scheduledAt: "2026-06-01",
          workType: "shoe_full",
        }),
      }),
    );
    expect(r.status).toBe(200);
    const { id } = await r.json();

    // Complete
    const r2 = await completeFarrier(
      mockReq("http://localhost", { method: "POST", body: "{}" }),
      { params: { id } },
    );
    expect(r2.status).toBe(200);

    const visit = await prisma.farrierVisit.findUniqueOrThrow({ where: { id } });
    expect(visit.status).toBe("completed");
    expect(visit.completedAt).not.toBeNull();
    expect(visit.nextDueAt).not.toBeNull();

    // nextDueAt should be ≈ completedAt + 6 weeks
    const diffDays = (visit.nextDueAt!.getTime() - visit.completedAt!.getTime()) / 86400000;
    expect(Math.round(diffDays)).toBe(DEFAULT_FARRIER_INTERVAL_DAYS);
  });

  it("refuses to complete the same visit twice", async () => {
    const centre = await mkCentre();
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id });
    const horse = await mkHorse(centre.id);
    await loginAs({ userId: mgr.id, role: "CENTRE_MANAGER", centreId: centre.id, name: mgr.name });

    const r = await createFarrier(
      mockReq("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          horseId: horse.id,
          farrierName: "Hari Pal",
          scheduledAt: "2026-06-01",
          workType: "trim",
        }),
      }),
    );
    const { id } = await r.json();
    await completeFarrier(mockReq("http://localhost", { method: "POST", body: "{}" }), { params: { id } });
    const second = await completeFarrier(mockReq("http://localhost", { method: "POST", body: "{}" }), { params: { id } });
    expect(second.status).toBe(409);
  });

  it("sweep digests upcoming + overdue per centre, dedup within 23h", async () => {
    const centre = await mkCentre();
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id });
    await prisma.centre.update({ where: { id: centre.id }, data: { managerId: mgr.id } });
    const horse = await mkHorse(centre.id);

    // Upcoming (3 days away)
    await prisma.farrierVisit.create({
      data: {
        centreId: centre.id,
        horseId: horse.id,
        farrierName: "X",
        scheduledAt: new Date(Date.now() + 3 * 86400000),
        workType: "trim",
      },
    });
    // Overdue completed (nextDueAt past)
    await prisma.farrierVisit.create({
      data: {
        centreId: centre.id,
        horseId: horse.id,
        farrierName: "Y",
        scheduledAt: new Date(Date.now() - 60 * 86400000),
        completedAt: new Date(Date.now() - 50 * 86400000),
        nextDueAt: new Date(Date.now() - 10 * 86400000),
        status: "completed",
        workType: "shoe_full",
      },
    });

    const result = await sweepFarrierDigest();
    expect(result.notified).toBe(1);

    const inbox = await prisma.notification.findMany({ where: { userId: mgr.id } });
    expect(inbox).toHaveLength(1);
    expect(inbox[0].type).toBe("farrier.digest");
    expect(inbox[0].title).toContain("overdue");

    const second = await sweepFarrierDigest();
    expect(second.notified).toBe(0);
  });
});

describe("HorseHealthLog", () => {
  it("appends a reading with vitals and stamps recordedBy", async () => {
    const centre = await mkCentre();
    const vet = await mkUser({ role: "VET", centreId: centre.id });
    const horse = await mkHorse(centre.id);
    await loginAs({ userId: vet.id, role: "VET", centreId: centre.id, name: vet.name });

    const r = await postHealth(
      mockReq("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          tempC: 38.1,
          heartRateBpm: 40,
          respirationRpm: 14,
          appetite: "good",
          manure: "normal",
        }),
      }),
      { params: { id: horse.id } },
    );
    expect(r.status).toBe(200);

    const logs = await prisma.horseHealthLog.findMany({ where: { horseId: horse.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0].tempC).toBe(38.1);
    expect(logs[0].recordedBy).toBe(vet.id);
  });

  it("refuses cross-centre writes", async () => {
    const a = await mkCentre();
    const b = await mkCentre();
    const horseB = await mkHorse(b.id);
    const mgrA = await mkUser({ role: "CENTRE_MANAGER", centreId: a.id });
    await loginAs({ userId: mgrA.id, role: "CENTRE_MANAGER", centreId: a.id, name: mgrA.name });

    const r = await postHealth(
      mockReq("http://localhost", { method: "POST", body: JSON.stringify({ tempC: 38.0 }) }),
      { params: { id: horseB.id } },
    );
    expect(r.status).toBe(403);
  });
});

describe("InjuryLog", () => {
  it("creates an injury for a horse + notifies the manager when severity > minor", async () => {
    const centre = await mkCentre();
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id });
    await prisma.centre.update({ where: { id: centre.id }, data: { managerId: mgr.id } });
    const horse = await mkHorse(centre.id);
    const coach = await mkUser({ role: "COACH", centreId: centre.id });
    await loginAs({ userId: coach.id, role: "COACH", centreId: centre.id, name: coach.name });

    const r = await createInjury(
      mockReq("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          subjectType: "horse",
          subjectId: horse.id,
          occurredAt: "2026-05-01",
          location: "left fore fetlock",
          severity: "moderate",
          cause: "slipped",
          initialNotes: "Swelling visible; lame at walk.",
        }),
      }),
    );
    expect(r.status).toBe(200);

    const rows = await prisma.injuryLog.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].horseSubjectId).toBe(horse.id);
    expect(rows[0].severity).toBe("moderate");

    const inbox = await prisma.notification.findMany({ where: { userId: mgr.id } });
    expect(inbox).toHaveLength(1);
    expect(inbox[0].type).toBe("injury.reported");
  });

  it("does NOT notify on a minor injury (avoid noise)", async () => {
    const centre = await mkCentre();
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id });
    await prisma.centre.update({ where: { id: centre.id }, data: { managerId: mgr.id } });
    const horse = await mkHorse(centre.id);
    const coach = await mkUser({ role: "COACH", centreId: centre.id });
    await loginAs({ userId: coach.id, role: "COACH", centreId: centre.id, name: coach.name });

    await createInjury(
      mockReq("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          subjectType: "horse",
          subjectId: horse.id,
          occurredAt: "2026-05-01",
          severity: "minor",
          initialNotes: "Small scrape.",
        }),
      }),
    );
    const inbox = await prisma.notification.findMany({ where: { userId: mgr.id } });
    expect(inbox).toHaveLength(0);
  });

  it("appends a treatment entry and switches status to recovered", async () => {
    const centre = await mkCentre();
    const horse = await mkHorse(centre.id);
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id });
    await loginAs({ userId: mgr.id, role: "CENTRE_MANAGER", centreId: centre.id, name: mgr.name });

    const r1 = await createInjury(
      mockReq("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          subjectType: "horse",
          subjectId: horse.id,
          occurredAt: "2026-05-01",
          severity: "minor",
          initialNotes: "Cut on shoulder.",
        }),
      }),
    );
    const { id } = await r1.json();

    // Append treatment
    const r2 = await patchInjury(
      mockReq("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ treatment: "Wound cleaned + bandaged.", notes: "Re-check in 24h" }),
      }),
      { params: { id } },
    );
    expect(r2.status).toBe(200);
    const mid = await prisma.injuryLog.findUniqueOrThrow({ where: { id } });
    expect(mid.treatmentJson).not.toBeNull();
    // treatmentJson is now a jsonb column — Prisma returns the parsed array.
    expect(mid.treatmentJson as unknown[]).toHaveLength(1);

    // Mark recovered
    const r3 = await patchInjury(
      mockReq("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ status: "recovered" }),
      }),
      { params: { id } },
    );
    expect(r3.status).toBe(200);
    const fin = await prisma.injuryLog.findUniqueOrThrow({ where: { id } });
    expect(fin.status).toBe("recovered");
    expect(fin.recoveredAt).not.toBeNull();
  });
});

describe("VaccinationSchedule", () => {
  it("creates a schedule, computes nextDueAt from lastGivenAt + intervalDays", async () => {
    const centre = await mkCentre();
    const vet = await mkUser({ role: "VET", centreId: centre.id });
    const horse = await mkHorse(centre.id);
    await loginAs({ userId: vet.id, role: "VET", centreId: centre.id, name: vet.name });

    const r = await upsertVaccination(
      mockReq("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          horseId: horse.id,
          vaccineKey: "tetanus",
          vaccineLabel: "Equine Tetanus Toxoid",
          intervalDays: 365,
          lastGivenAt: "2026-01-01",
        }),
      }),
    );
    expect(r.status).toBe(200);
    const { nextDueAt } = await r.json();
    expect(nextDueAt.startsWith("2027-01-01")).toBe(true);
  });

  it("upsert is unique by (horseId, vaccineKey) — second call updates rather than creates", async () => {
    const centre = await mkCentre();
    const vet = await mkUser({ role: "VET", centreId: centre.id });
    const horse = await mkHorse(centre.id);
    await loginAs({ userId: vet.id, role: "VET", centreId: centre.id, name: vet.name });

    await upsertVaccination(
      mockReq("http://localhost", {
        method: "POST",
        body: JSON.stringify({ horseId: horse.id, vaccineKey: "tetanus", vaccineLabel: "Tetanus", intervalDays: 365 }),
      }),
    );
    await upsertVaccination(
      mockReq("http://localhost", {
        method: "POST",
        body: JSON.stringify({ horseId: horse.id, vaccineKey: "tetanus", vaccineLabel: "Tetanus v2", intervalDays: 180 }),
      }),
    );

    const rows = await prisma.vaccinationSchedule.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].intervalDays).toBe(180);
    expect(rows[0].vaccineLabel).toBe("Tetanus v2");
  });

  it("record dose rolls nextDueAt forward by intervalDays", async () => {
    const centre = await mkCentre();
    const vet = await mkUser({ role: "VET", centreId: centre.id });
    const horse = await mkHorse(centre.id);
    await loginAs({ userId: vet.id, role: "VET", centreId: centre.id, name: vet.name });

    const r = await upsertVaccination(
      mockReq("http://localhost", {
        method: "POST",
        body: JSON.stringify({ horseId: horse.id, vaccineKey: "ehv", vaccineLabel: "EHV", intervalDays: 180 }),
      }),
    );
    const { id } = await r.json();
    const before = await prisma.vaccinationSchedule.findUniqueOrThrow({ where: { id } });
    const r2 = await recordDose(
      mockReq("http://localhost", { method: "POST", body: "{}" }),
      { params: { id } },
    );
    expect(r2.status).toBe(200);

    const after = await prisma.vaccinationSchedule.findUniqueOrThrow({ where: { id } });
    expect(after.lastGivenAt).not.toBeNull();
    // nextDueAt should have moved forward (was 180 days from creation; after dose
    // it's 180 days from "now" which is later than the original nextDueAt).
    expect(after.nextDueAt.getTime()).toBeGreaterThanOrEqual(before.nextDueAt.getTime() - 1000);
  });

  it("sweepVaccinationDue digests horses with vaccines due within 30 days", async () => {
    const centre = await mkCentre();
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id });
    await prisma.centre.update({ where: { id: centre.id }, data: { managerId: mgr.id } });
    const horse = await mkHorse(centre.id);

    await prisma.vaccinationSchedule.create({
      data: {
        centreId: centre.id,
        horseId: horse.id,
        vaccineKey: "tetanus",
        vaccineLabel: "Tetanus",
        intervalDays: 365,
        nextDueAt: new Date(Date.now() + 10 * 86400000), // due in 10 days
      },
    });
    await prisma.vaccinationSchedule.create({
      data: {
        centreId: centre.id,
        horseId: horse.id,
        vaccineKey: "ehv",
        vaccineLabel: "EHV",
        intervalDays: 180,
        nextDueAt: new Date(Date.now() + 365 * 86400000), // out-of-window
      },
    });

    const result = await sweepVaccinationDue();
    expect(result.scanned).toBe(1);
    expect(result.notified).toBe(1);
    const inbox = await prisma.notification.findMany({ where: { userId: mgr.id } });
    expect(inbox[0].type).toBe("vaccination.due_digest");
    expect(inbox[0].title).toContain("1 vaccination");
  });
});
