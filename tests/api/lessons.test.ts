import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkUser, mkCentre, mkRider } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { signSession, type SessionPayload } from "@/lib/auth";
import { mockReq } from "../helpers/request";

const cookieJar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => cookieJar.get(name),
    set: (name: string, value: string) => cookieJar.set(name, { value }),
    delete: (name: string) => cookieJar.delete(name),
  }),
}));

const { POST: createLesson, GET: listLessons } = await import("@/app/api/lessons/route");
const { POST: allocate } = await import("@/app/api/lessons/[id]/allocations/route");

async function login(payload: SessionPayload) {
  cookieJar.clear();
  cookieJar.set("ew_session", { value: await signSession(payload) });
}

async function mkHorse(centreId: string, name = "Bullet") {
  return prisma.horse.create({
    data: {
      centreId,
      name,
      breed: "Marwari",
      sex: "gelding",
      ageYears: 8,
      heightIn: 62,
      stableNo: "A1",
      ownership: "club",
    },
  });
}

beforeEach(async () => {
  await resetDb();
  cookieJar.clear();
});

describe("POST /api/lessons", () => {
  it("401 without session", async () => {
    const r = await createLesson(mockReq("http://localhost/api/lessons", { method: "POST", body: "{}" }));
    expect(r.status).toBe(401);
  });

  it("creates an ad-hoc lesson without a batch", async () => {
    const centre = await mkCentre();
    const u = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id });
    await login({ userId: u.id, role: "CENTRE_MANAGER", centreId: centre.id, name: u.name });

    const r = await createLesson(
      mockReq("http://localhost/api/lessons", {
        method: "POST",
        body: JSON.stringify({
          date: "2026-06-01T06:00:00Z",
          endAt: "2026-06-01T07:00:00Z",
          notes: "make-up class",
        }),
      }),
    );
    expect(r.status).toBe(200);
    const { id } = await r.json();
    const lesson = await prisma.lesson.findUniqueOrThrow({ where: { id } });
    expect(lesson.batchId).toBeNull();
    expect(lesson.status).toBe("scheduled");
    expect(lesson.notes).toBe("make-up class");
  });

  it("rejects endAt <= start", async () => {
    const centre = await mkCentre();
    const u = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id });
    await login({ userId: u.id, role: "CENTRE_MANAGER", centreId: centre.id, name: u.name });

    const r = await createLesson(
      mockReq("http://localhost/api/lessons", {
        method: "POST",
        body: JSON.stringify({ date: "2026-06-01T07:00:00Z", endAt: "2026-06-01T06:00:00Z" }),
      }),
    );
    expect(r.status).toBe(400);
  });
});

describe("POST /api/lessons/[id]/allocations", () => {
  it("rejects duplicate horse in the same lesson", async () => {
    const centre = await mkCentre();
    const u = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id });
    await login({ userId: u.id, role: "CENTRE_MANAGER", centreId: centre.id, name: u.name });

    const r1 = await mkRider({ centreId: centre.id, firstName: "Aanya" });
    const r2 = await mkRider({ centreId: centre.id, firstName: "Bina" });
    const h1 = await mkHorse(centre.id, "Bullet");

    const lesson = await prisma.lesson.create({
      data: {
        centreId: centre.id,
        date: new Date("2026-06-01T06:00:00Z"),
        endAt: new Date("2026-06-01T07:00:00Z"),
      },
    });

    const r = await allocate(
      mockReq("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          pairings: [
            { riderId: r1.id, horseId: h1.id },
            { riderId: r2.id, horseId: h1.id }, // dupe horse
          ],
        }),
      }),
      { params: { id: lesson.id } },
    );
    expect(r.status).toBe(409);
    const body = await r.json();
    expect(body.error).toBe("DUPLICATE_HORSE");
  });

  it("rejects horse double-booked across overlapping lessons", async () => {
    const centre = await mkCentre();
    const u = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id });
    await login({ userId: u.id, role: "CENTRE_MANAGER", centreId: centre.id, name: u.name });

    const rider = await mkRider({ centreId: centre.id });
    const horse = await mkHorse(centre.id);

    const start = new Date("2026-06-01T06:00:00Z");
    const end = new Date("2026-06-01T07:00:00Z");

    const lessonA = await prisma.lesson.create({ data: { centreId: centre.id, date: start, endAt: end } });
    const lessonB = await prisma.lesson.create({ data: { centreId: centre.id, date: start, endAt: end } });

    // First allocation goes through.
    const ok = await allocate(
      mockReq("http://localhost", {
        method: "POST",
        body: JSON.stringify({ pairings: [{ riderId: rider.id, horseId: horse.id }] }),
      }),
      { params: { id: lessonA.id } },
    );
    expect(ok.status).toBe(200);

    // Second lesson at the same window can't book the same horse.
    const clash = await allocate(
      mockReq("http://localhost", {
        method: "POST",
        body: JSON.stringify({ pairings: [{ riderId: rider.id, horseId: horse.id }] }),
      }),
      { params: { id: lessonB.id } },
    );
    expect(clash.status).toBe(409);
    expect((await clash.json()).error).toBe("HORSE_DOUBLE_BOOKED");
  });

  it("rejects horse/rider from a different centre", async () => {
    const centreA = await mkCentre();
    const centreB = await mkCentre();
    const u = await mkUser({ role: "CENTRE_MANAGER", centreId: centreA.id });
    await login({ userId: u.id, role: "CENTRE_MANAGER", centreId: centreA.id, name: u.name });

    const otherRider = await mkRider({ centreId: centreB.id });
    const homeHorse = await mkHorse(centreA.id);
    const lesson = await prisma.lesson.create({
      data: {
        centreId: centreA.id,
        date: new Date("2026-06-01T06:00:00Z"),
        endAt: new Date("2026-06-01T07:00:00Z"),
      },
    });

    const r = await allocate(
      mockReq("http://localhost", {
        method: "POST",
        body: JSON.stringify({ pairings: [{ riderId: otherRider.id, horseId: homeHorse.id }] }),
      }),
      { params: { id: lesson.id } },
    );
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("RIDER_NOT_IN_CENTRE");
  });
});

describe("GET /api/lessons", () => {
  it("only returns lessons for the requested date", async () => {
    const centre = await mkCentre();
    const u = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id });
    await login({ userId: u.id, role: "CENTRE_MANAGER", centreId: centre.id, name: u.name });

    await prisma.lesson.createMany({
      data: [
        { centreId: centre.id, date: new Date("2026-06-01T06:00:00Z"), endAt: new Date("2026-06-01T07:00:00Z") },
        { centreId: centre.id, date: new Date("2026-06-02T06:00:00Z"), endAt: new Date("2026-06-02T07:00:00Z") },
      ],
    });

    const r = await listLessons(mockReq("http://localhost/api/lessons?date=2026-06-01"));
    expect(r.status).toBe(200);
    const { lessons } = await r.json();
    expect(lessons.length).toBe(1);
  });
});
