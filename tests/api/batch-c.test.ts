// Batch C — consumables + competition operations.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkCentre, mkUser, mkRider } from "../helpers/fixtures";
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

const { POST: createConsumable } = await import("@/app/api/consumables/route");
const { POST: moveConsumable } = await import("@/app/api/consumables/[id]/move/route");
const { POST: drawLots, GET: getStartList } = await import("@/app/api/competitions/[id]/draw/route");
const { POST: upsertPrize } = await import("@/app/api/competitions/[id]/prizes/route");
const { POST: addSponsor } = await import("@/app/api/competitions/[id]/sponsors/route");

async function loginAs(payload: SessionPayload) {
  cookieJar.clear();
  cookieJar.set("ew_session", { value: await signSession(payload) });
}

async function mkCompetition(centreId: string, classes: string[] = ["Open"]) {
  return prisma.competition.create({
    data: {
      centreId,
      name: "Test Cup",
      slug: `cup-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      scope: "internal",
      startDate: new Date(Date.now() + 7 * 86400000),
      endDate: new Date(Date.now() + 8 * 86400000),
      classesJson: JSON.stringify(classes.map((n) => ({ name: n, fee: 0 }))),
      status: "open_for_entries",
    },
  });
}

beforeEach(async () => {
  await resetDb();
  cookieJar.clear();
});

describe("Consumables", () => {
  it("creates a line item + records an 'out' movement + low-stock notifies the manager", async () => {
    const centre = await mkCentre();
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id });
    await prisma.centre.update({ where: { id: centre.id }, data: { managerId: mgr.id } });
    await loginAs({ userId: mgr.id, role: "CENTRE_MANAGER", centreId: centre.id, name: mgr.name });

    const create = await createConsumable(
      mockReq("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          name: "Sterile gauze pad",
          category: "bandage",
          unit: "pad",
          qty: 15,
          reorderThreshold: 10,
        }),
      }),
    );
    expect(create.status).toBe(200);
    const { id } = await create.json();

    // Use 8 → 7 (still > 10? no, 15-8=7 ≤ 10, crosses threshold)
    const move = await moveConsumable(
      mockReq("http://localhost", {
        method: "POST",
        body: JSON.stringify({ direction: "out", qty: 8, reason: "refill kit" }),
      }),
      { params: { id } },
    );
    expect(move.status).toBe(200);
    const data = await move.json();
    expect(data.qty).toBe(7);
    expect(data.lowStock).toBe(true);

    const inbox = await prisma.notification.findMany({ where: { userId: mgr.id } });
    expect(inbox).toHaveLength(1);
    expect(inbox[0].type).toBe("consumable.low_stock");

    const moves = await prisma.consumableMovement.findMany({ where: { consumableId: id } });
    expect(moves).toHaveLength(1);
    expect(moves[0].direction).toBe("out");
  });

  it("refuses an 'out' move that would go negative", async () => {
    const centre = await mkCentre();
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id });
    await loginAs({ userId: mgr.id, role: "CENTRE_MANAGER", centreId: centre.id, name: mgr.name });
    const row = await prisma.consumable.create({
      data: { centreId: centre.id, name: "Tape", category: "bandage", unit: "roll", qty: 3, reorderThreshold: 5 },
    });
    const r = await moveConsumable(
      mockReq("http://localhost", {
        method: "POST",
        body: JSON.stringify({ direction: "out", qty: 10 }),
      }),
      { params: { id: row.id } },
    );
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("INSUFFICIENT_STOCK");
  });
});

describe("Competition draw of lots", () => {
  it("shuffles all entries + writes sequential orders", async () => {
    const centre = await mkCentre();
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id });
    await loginAs({ userId: mgr.id, role: "CENTRE_MANAGER", centreId: centre.id, name: mgr.name });
    const comp = await mkCompetition(centre.id, ["Open"]);

    // Five entries
    const riders = await Promise.all(
      [...Array(5)].map(() => mkRider({ centreId: centre.id })),
    );
    await prisma.competitionEntry.createMany({
      data: riders.map((r) => ({ competitionId: comp.id, riderId: r.id, className: "Open" })),
    });

    const r = await drawLots(
      mockReq("http://localhost", {
        method: "POST",
        body: JSON.stringify({ className: "Open" }),
      }),
      { params: { id: comp.id } },
    );
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.count).toBe(5);

    const rows = await prisma.startListEntry.findMany({
      where: { competitionId: comp.id, className: "Open" },
      orderBy: { order: "asc" },
    });
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.order)).toEqual([1, 2, 3, 4, 5]);
  });

  it("409 NO_ENTRIES when nothing to draw", async () => {
    const centre = await mkCentre();
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id });
    await loginAs({ userId: mgr.id, role: "CENTRE_MANAGER", centreId: centre.id, name: mgr.name });
    const comp = await mkCompetition(centre.id);
    const r = await drawLots(
      mockReq("http://localhost", { method: "POST", body: JSON.stringify({ className: "Open" }) }),
      { params: { id: comp.id } },
    );
    expect(r.status).toBe(409);
  });

  it("re-draws wipe the previous start list", async () => {
    const centre = await mkCentre();
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id });
    await loginAs({ userId: mgr.id, role: "CENTRE_MANAGER", centreId: centre.id, name: mgr.name });
    const comp = await mkCompetition(centre.id);
    const r1 = await mkRider({ centreId: centre.id });
    const r2 = await mkRider({ centreId: centre.id });
    await prisma.competitionEntry.createMany({
      data: [
        { competitionId: comp.id, riderId: r1.id, className: "Open" },
        { competitionId: comp.id, riderId: r2.id, className: "Open" },
      ],
    });

    await drawLots(
      mockReq("http://localhost", { method: "POST", body: JSON.stringify({ className: "Open" }) }),
      { params: { id: comp.id } },
    );
    const before = await prisma.startListEntry.count({ where: { competitionId: comp.id } });
    expect(before).toBe(2);

    await drawLots(
      mockReq("http://localhost", { method: "POST", body: JSON.stringify({ className: "Open" }) }),
      { params: { id: comp.id } },
    );
    const after = await prisma.startListEntry.count({ where: { competitionId: comp.id } });
    expect(after).toBe(2); // not doubled
  });

  it("finalise=true flips Competition.drawCompleted", async () => {
    const centre = await mkCentre();
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id });
    await loginAs({ userId: mgr.id, role: "CENTRE_MANAGER", centreId: centre.id, name: mgr.name });
    const comp = await mkCompetition(centre.id);
    await mkRider({ centreId: centre.id }).then((r) =>
      prisma.competitionEntry.create({ data: { competitionId: comp.id, riderId: r.id, className: "Open" } }),
    );

    await drawLots(
      mockReq("http://localhost", {
        method: "POST",
        body: JSON.stringify({ className: "Open", finalise: true }),
      }),
      { params: { id: comp.id } },
    );

    const c = await prisma.competition.findUniqueOrThrow({ where: { id: comp.id } });
    expect(c.drawCompleted).toBe(true);
  });
});

describe("Prizes + Sponsors", () => {
  it("upserts a prize (re-POST with same class+placement updates rather than duplicates)", async () => {
    const centre = await mkCentre();
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id });
    await loginAs({ userId: mgr.id, role: "CENTRE_MANAGER", centreId: centre.id, name: mgr.name });
    const comp = await mkCompetition(centre.id);

    await upsertPrize(
      mockReq("http://localhost", {
        method: "POST",
        body: JSON.stringify({ className: "Open", placement: 1, title: "Winner", cashAmount: 5000 }),
      }),
      { params: { id: comp.id } },
    );
    await upsertPrize(
      mockReq("http://localhost", {
        method: "POST",
        body: JSON.stringify({ className: "Open", placement: 1, title: "Champion", cashAmount: 10000 }),
      }),
      { params: { id: comp.id } },
    );
    const rows = await prisma.prizeAward.findMany({ where: { competitionId: comp.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Champion");
    expect(rows[0].cashAmount).toBe(10000);
  });

  it("sponsors POST creates a row + tier classification", async () => {
    const centre = await mkCentre();
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id });
    await loginAs({ userId: mgr.id, role: "CENTRE_MANAGER", centreId: centre.id, name: mgr.name });
    const comp = await mkCompetition(centre.id);

    const r = await addSponsor(
      mockReq("http://localhost", {
        method: "POST",
        body: JSON.stringify({ name: "Royal Riders", tier: "gold", contribution: 50000 }),
      }),
      { params: { id: comp.id } },
    );
    expect(r.status).toBe(200);
    const rows = await prisma.sponsor.findMany({ where: { competitionId: comp.id } });
    expect(rows[0].tier).toBe("gold");
    expect(rows[0].contribution).toBe(50000);
  });
});
