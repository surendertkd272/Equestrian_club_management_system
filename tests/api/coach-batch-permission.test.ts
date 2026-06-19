// Regression: a COACH (and HEAD_COACH) must be able to create + delete batches.
//
// Bug: POST/DELETE /api/batches gated on "staff.manage", which coaches don't
// have — so the sidebar showed them Batches + an enabled form, but the API
// returned 403. Fix: a dedicated "batch.manage" permission granted to
// SUPER_ADMIN / ADMIN / CENTRE_MANAGER / HEAD_COACH / COACH. Crucially the fix
// must NOT hand coaches "staff.manage" (that gate guards staff USER-ACCOUNT
// creation — granting it would be a privilege-escalation hole), so this suite
// also pins that coaches still cannot create staff.

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

const { POST: createBatch } = await import("@/app/api/batches/route");
const { DELETE: deleteBatch } = await import("@/app/api/batches/[id]/route");
const { POST: createStaff } = await import("@/app/api/staff/route");

async function loginAs(payload: SessionPayload) {
  cookieJar.clear();
  cookieJar.set("ew_session", { value: await signSession(payload) });
}

function batchBody() {
  return JSON.stringify({ name: "Evening Pony", dayOfWeek: "Tue,Thu", startTime: "16:00", endTime: "17:00" });
}

beforeEach(async () => {
  await resetDb();
  cookieJar.clear();
});

describe("POST /api/batches — coach batch creation", () => {
  it("lets a COACH create a batch in their own centre (the reported bug)", async () => {
    const centre = await mkCentre();
    const coach = await mkUser({ role: "COACH", centreId: centre.id });
    await loginAs({ userId: coach.id, role: "COACH", centreId: centre.id, name: coach.name });

    const r = await createBatch(mockReq("http://localhost", { method: "POST", body: batchBody() }));
    expect(r.status).toBe(200);

    const { id } = (await r.json()) as { id: string };
    const saved = await prisma.batch.findUniqueOrThrow({ where: { id } });
    expect(saved.centreId).toBe(centre.id);
    expect(saved.name).toBe("Evening Pony");
  });

  it("lets a HEAD_COACH create a batch", async () => {
    const centre = await mkCentre();
    const hc = await mkUser({ role: "HEAD_COACH", centreId: centre.id });
    await loginAs({ userId: hc.id, role: "HEAD_COACH", centreId: centre.id, name: hc.name });

    const r = await createBatch(mockReq("http://localhost", { method: "POST", body: batchBody() }));
    expect(r.status).toBe(200);
  });

  it("still refuses a role without batch.manage (VET) with 403", async () => {
    const centre = await mkCentre();
    const vet = await mkUser({ role: "VET", centreId: centre.id });
    await loginAs({ userId: vet.id, role: "VET", centreId: centre.id, name: vet.name });

    const r = await createBatch(mockReq("http://localhost", { method: "POST", body: batchBody() }));
    expect(r.status).toBe(403);
    expect((await r.json()).error).toBe("FORBIDDEN");
  });
});

describe("DELETE /api/batches/[id] — coach can delete an empty batch", () => {
  it("lets a COACH delete a batch with no riders in their centre", async () => {
    const centre = await mkCentre();
    const coach = await mkUser({ role: "COACH", centreId: centre.id });
    await loginAs({ userId: coach.id, role: "COACH", centreId: centre.id, name: coach.name });
    const batch = await prisma.batch.create({
      data: { centreId: centre.id, name: "X", dayOfWeek: "Mon", startTime: "06:00", endTime: "07:00" },
    });

    const r = await deleteBatch(mockReq(`http://localhost`, { method: "DELETE" }), { params: { id: batch.id } });
    expect(r.status).toBe(200);
    expect(await prisma.batch.findUnique({ where: { id: batch.id } })).toBeNull();
  });

  it("returns a clean 409 (not a 500) when a batch has attendance history but no current riders", async () => {
    const centre = await mkCentre();
    const coach = await mkUser({ role: "COACH", centreId: centre.id });
    await loginAs({ userId: coach.id, role: "COACH", centreId: centre.id, name: coach.name });
    const batch = await prisma.batch.create({
      data: { centreId: centre.id, name: "Historical", dayOfWeek: "Mon", startTime: "06:00", endTime: "07:00" },
    });
    // Rider is NOT assigned to this batch (batchId stays null), so the riders
    // guard passes — but there's an attendance row pointing at it, which is an
    // ON DELETE RESTRICT FK. The delete must fail closed with 409, not 500.
    const rider = await mkRider({ centreId: centre.id });
    await prisma.attendance.create({
      data: { riderId: rider.id, batchId: batch.id, date: new Date("2026-01-01T00:00:00Z"), status: "present" },
    });

    const r = await deleteBatch(mockReq(`http://localhost`, { method: "DELETE" }), { params: { id: batch.id } });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("BATCH_HAS_LINKED_RECORDS");
    expect(await prisma.batch.findUnique({ where: { id: batch.id } })).not.toBeNull();
  });
});

describe("escalation guard — batch.manage must not leak staff.manage", () => {
  it("a COACH still cannot create staff accounts (403)", async () => {
    const centre = await mkCentre();
    const coach = await mkUser({ role: "COACH", centreId: centre.id });
    await loginAs({ userId: coach.id, role: "COACH", centreId: centre.id, name: coach.name });

    const r = await createStaff(
      mockReq("http://localhost", {
        method: "POST",
        body: JSON.stringify({ name: "Mole", email: "mole@test.local", role: "CENTRE_MANAGER", password: "secret123" }),
      }),
    );
    expect(r.status).toBe(403);
    expect((await r.json()).error).toBe("FORBIDDEN");
  });
});
