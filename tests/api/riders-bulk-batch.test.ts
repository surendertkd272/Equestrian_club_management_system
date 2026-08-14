// Bulk rider→batch assignment. A bulk endpoint takes ids straight from the
// request body, so it is exactly where a cross-centre id would slip past a
// fence that only checks the session — these assert it doesn't.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkUser, mkCentre, mkRider, mkBatch } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { signSession, COOKIE_NAME } from "@/lib/auth";
import { mockReq } from "../helpers/request";
import type { Role } from "@/lib/roles";

const cookieJar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (n: string) => cookieJar.get(n),
    set: (n: string, value: string) => cookieJar.set(n, { value }),
    delete: (n: string) => cookieJar.delete(n),
  }),
}));

const { POST: bulkBatch } = await import("@/app/api/riders/bulk-batch/route");

async function signIn(userId: string, role: Role, centreId: string | null) {
  cookieJar.clear();
  cookieJar.set(COOKIE_NAME, {
    value: await signSession({ userId, role, centreId, name: "T", tokenVersion: 0 }),
  });
}

const call = (body: unknown) =>
  bulkBatch(
    mockReq("http://localhost/api/riders/bulk-batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

beforeEach(async () => {
  await resetDb();
  cookieJar.clear();
});

describe("POST /api/riders/bulk-batch", () => {
  it("assigns many riders in one call", async () => {
    const centre = await mkCentre();
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id });
    const batch = await mkBatch({ centreId: centre.id, name: "Tue 5pm" });
    const a = await mkRider({ centreId: centre.id });
    const b = await mkRider({ centreId: centre.id });
    await signIn(mgr.id, "CENTRE_MANAGER", centre.id);

    const r = await call({ riderIds: [a.id, b.id], batchId: batch.id });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, count: 2 });

    const after = await prisma.rider.findMany({ where: { id: { in: [a.id, b.id] } } });
    expect(after.every((x) => x.batchId === batch.id)).toBe(true);
  });

  it("clears the batch when batchId is null", async () => {
    const centre = await mkCentre();
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id });
    const batch = await mkBatch({ centreId: centre.id });
    const rider = await mkRider({ centreId: centre.id });
    await prisma.rider.update({ where: { id: rider.id }, data: { batchId: batch.id } });
    await signIn(mgr.id, "CENTRE_MANAGER", centre.id);

    expect((await call({ riderIds: [rider.id], batchId: null })).status).toBe(200);
    const after = await prisma.rider.findUniqueOrThrow({ where: { id: rider.id } });
    expect(after.batchId).toBeNull();
  });

  it("refuses riders from another centre", async () => {
    const mine = await mkCentre({ name: "Mine" });
    const theirs = await mkCentre({ name: "Theirs" });
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: mine.id });
    const batch = await mkBatch({ centreId: mine.id });
    const foreign = await mkRider({ centreId: theirs.id });
    await signIn(mgr.id, "CENTRE_MANAGER", mine.id);

    const r = await call({ riderIds: [foreign.id], batchId: batch.id });
    expect(r.status).toBe(403);
    const after = await prisma.rider.findUniqueOrThrow({ where: { id: foreign.id } });
    expect(after.batchId).toBeNull();
  });

  it("refuses a batch belonging to another centre", async () => {
    const mine = await mkCentre({ name: "Mine" });
    const theirs = await mkCentre({ name: "Theirs" });
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: mine.id });
    const foreignBatch = await mkBatch({ centreId: theirs.id });
    const rider = await mkRider({ centreId: mine.id });
    await signIn(mgr.id, "CENTRE_MANAGER", mine.id);

    const r = await call({ riderIds: [rider.id], batchId: foreignBatch.id });
    expect([400, 403]).toContain(r.status);
    const after = await prisma.rider.findUniqueOrThrow({ where: { id: rider.id } });
    expect(after.batchId).toBeNull();
  });

  it("refuses a role without rider.write", async () => {
    const centre = await mkCentre();
    const groom = await mkUser({ role: "GROOM", centreId: centre.id });
    const batch = await mkBatch({ centreId: centre.id });
    const rider = await mkRider({ centreId: centre.id });
    await signIn(groom.id, "GROOM", centre.id);

    expect((await call({ riderIds: [rider.id], batchId: batch.id })).status).toBe(403);
  });

  it("rejects an empty or oversized selection", async () => {
    const centre = await mkCentre();
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id });
    await signIn(mgr.id, "CENTRE_MANAGER", centre.id);
    expect((await call({ riderIds: [], batchId: null })).status).toBe(400);
    expect((await call({ riderIds: Array(501).fill("x"), batchId: null })).status).toBe(400);
  });
});
