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

async function loginAs(payload: SessionPayload) {
  cookieJar.clear();
  cookieJar.set("ew_session", { value: await signSession(payload) });
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

