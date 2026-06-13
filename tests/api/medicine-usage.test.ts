import { describe, it, expect, beforeEach, vi } from "vitest";
import crypto from "node:crypto";
import { resetDb } from "../helpers/db";
import { mkCentre, mkUser } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { signSession, type SessionPayload } from "@/lib/auth";
import { mockReq } from "../helpers/request";

// Locks the medicine-stock integrity fixes:
//   C5a — guarded atomic decrement (can't drive stock below zero under a race)
//   #98 — requestKey idempotency (a double-submit can't double-decrement)
// plus the cross-centre and expiry guards on the prescribe path.

const cookieJar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (n: string) => cookieJar.get(n),
    set: (n: string, v: string) => cookieJar.set(n, { value: v }),
    delete: (n: string) => cookieJar.delete(n),
  }),
}));

const { POST: useMedicine } = await import("@/app/api/medicines/[id]/usage/route");

async function login(p: SessionPayload) {
  cookieJar.clear();
  cookieJar.set("ew_session", { value: await signSession(p) });
}

function mkMedicine(centreId: string, qty: number, expDate?: Date) {
  return prisma.medicine.create({
    data: {
      centreId,
      name: "Phenylbutazone",
      category: "nsaid",
      batchNo: "B-" + Math.random().toString(36).slice(2, 8),
      expDate: expDate ?? new Date(Date.now() + 365 * 86400000),
      qty,
    },
  });
}
function mkHorse(centreId: string) {
  return prisma.horse.create({
    data: { centreId, name: "Bullet", breed: "Marwari", sex: "gelding", ageYears: 8, heightHh: 15.2, stableNo: "A1", ownership: "club" },
  });
}
const usageReq = (medId: string, body: object) =>
  useMedicine(mockReq("http://localhost", { method: "POST", body: JSON.stringify(body) }), { params: { id: medId } });

async function vetInCentre() {
  const centre = await mkCentre();
  const vet = await mkUser({ role: "VET", centreId: centre.id });
  await login({ userId: vet.id, role: "VET", centreId: centre.id, name: vet.name });
  return centre;
}
const qtyOf = async (id: string) => (await prisma.medicine.findUniqueOrThrow({ where: { id } })).qty;

beforeEach(async () => {
  await resetDb();
  cookieJar.clear();
});

describe("medicine usage stock integrity", () => {
  it("guarded decrement cannot drive stock below zero (C5a)", async () => {
    const centre = await vetInCentre();
    const med = await mkMedicine(centre.id, 1);
    const horse = await mkHorse(centre.id);

    const r1 = await usageReq(med.id, { horseId: horse.id, dose: "1g", route: "oral", qtyConsumed: 1 });
    expect(r1.status).toBe(200);
    expect(await qtyOf(med.id)).toBe(0);

    const r2 = await usageReq(med.id, { horseId: horse.id, dose: "1g", route: "oral", qtyConsumed: 1 });
    expect(r2.status).toBe(409);
    expect((await r2.json()).error).toBe("OUT_OF_STOCK");
    expect(await qtyOf(med.id)).toBe(0); // not -1
  });

  it("same requestKey decrements exactly once — replay (#98)", async () => {
    const centre = await vetInCentre();
    const med = await mkMedicine(centre.id, 5);
    const horse = await mkHorse(centre.id);
    const key = crypto.randomUUID();
    const body = { horseId: horse.id, dose: "1g", route: "oral", qtyConsumed: 1, requestKey: key };

    const r1 = await usageReq(med.id, body);
    expect(r1.status).toBe(200);
    expect((await r1.json()).newQty).toBe(4);

    const r2 = await usageReq(med.id, body); // identical submit (double-click)
    expect(r2.status).toBe(200);
    const b2 = await r2.json();
    expect(b2.replayed).toBe(true);
    expect(b2.newQty).toBe(4); // not 3

    expect(await qtyOf(med.id)).toBe(4);
    expect(await prisma.medicineUsage.count({ where: { medicineId: med.id } })).toBe(1);
  });

  it("a fresh requestKey on the same medicine decrements again", async () => {
    const centre = await vetInCentre();
    const med = await mkMedicine(centre.id, 5);
    const horse = await mkHorse(centre.id);
    await usageReq(med.id, { horseId: horse.id, dose: "1g", route: "oral", qtyConsumed: 1, requestKey: crypto.randomUUID() });
    await usageReq(med.id, { horseId: horse.id, dose: "1g", route: "oral", qtyConsumed: 1, requestKey: crypto.randomUUID() });
    expect(await qtyOf(med.id)).toBe(3);
    expect(await prisma.medicineUsage.count({ where: { medicineId: med.id } })).toBe(2);
  });

  it("rejects a horse from another centre", async () => {
    const centre = await vetInCentre();
    const med = await mkMedicine(centre.id, 5);
    const otherCentre = await mkCentre();
    const otherHorse = await mkHorse(otherCentre.id);
    const r = await usageReq(med.id, { horseId: otherHorse.id, dose: "1g", route: "oral", qtyConsumed: 1 });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("HORSE_CROSS_CENTRE");
  });

  it("rejects an expired medicine", async () => {
    const centre = await vetInCentre();
    const med = await mkMedicine(centre.id, 5, new Date(Date.now() - 86400000));
    const horse = await mkHorse(centre.id);
    const r = await usageReq(med.id, { horseId: horse.id, dose: "1g", route: "oral", qtyConsumed: 1 });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("EXPIRED");
  });
});
