// Regression for the missing server-side state-machine guards:
//   - Event status PATCH must reject illegal transitions (e.g. reopen completed).
//   - Venue-trip status PATCH must reject illegal transitions (e.g. revive cancelled).
//   - Injury status PATCH must NOT wipe recoveredAt on a reopen.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkOrg, mkCentre, mkUser } from "../helpers/fixtures";
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

const { PATCH: eventPatch } = await import("@/app/api/events/[id]/route");
const { PATCH: tripStatus } = await import("@/app/api/venue-trips/[id]/status/route");
const { PATCH: injuryPatch } = await import("@/app/api/injuries/[id]/route");

async function suInOrg() {
  const org = await mkOrg();
  const centre = await mkCentre({ orgId: org.id });
  const su = await mkUser({ role: "SUPER_ADMIN", centreId: null, orgId: org.id, name: "SU" });
  cookieJar.clear();
  const payload: SessionPayload = { userId: su.id, role: "SUPER_ADMIN" as Role, centreId: null, name: "SU", tokenVersion: 0 };
  cookieJar.set("ew_session", { value: await signSession(payload) });
  return { org, centre, su };
}
function patchReq(body: unknown) {
  return mockReq("http://localhost", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
const futureDates = { startDate: new Date(Date.now() + 86400000), endDate: new Date(Date.now() + 2 * 86400000) };

beforeEach(async () => {
  await resetDb();
});

describe("event status transition guard", () => {
  it("rejects reopening a completed event, allows a legal draft→open", async () => {
    const { centre } = await suInOrg();
    const done = await prisma.event.create({ data: { centreId: centre.id, title: "Done", type: "clinic", ...futureDates, status: "completed" } });
    const bad = await eventPatch(patchReq({ status: "open" }), { params: { id: done.id } });
    expect(bad.status).toBe(409);
    expect((await bad.json()).error).toBe("ILLEGAL_TRANSITION");
    expect((await prisma.event.findUniqueOrThrow({ where: { id: done.id } })).status).toBe("completed");

    const draft = await prisma.event.create({ data: { centreId: centre.id, title: "New", type: "clinic", ...futureDates, status: "draft" } });
    const ok = await eventPatch(patchReq({ status: "open" }), { params: { id: draft.id } });
    expect(ok.status).toBe(200);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("open");
  });
});

describe("venue-trip status transition guard", () => {
  it("rejects reviving a cancelled trip, allows planned→departed", async () => {
    const { centre, su } = await suInOrg();
    const cancelled = await prisma.venueTrip.create({ data: { centreId: centre.id, eventName: "X", venue: "V", departureAt: new Date(), createdByUserId: su.id, status: "cancelled" } });
    const bad = await tripStatus(patchReq({ status: "departed" }), { params: { id: cancelled.id } });
    expect(bad.status).toBe(409);

    const planned = await prisma.venueTrip.create({ data: { centreId: centre.id, eventName: "Y", venue: "V", departureAt: new Date(), createdByUserId: su.id, status: "planned" } });
    const ok = await tripStatus(patchReq({ status: "departed" }), { params: { id: planned.id } });
    expect(ok.status).toBe(200);
  });
});

describe("injury reopen preserves recoveredAt", () => {
  it("does not wipe recoveredAt when status changes away from recovered", async () => {
    const { centre } = await suInOrg();
    const recoveredAt = new Date("2026-01-15T00:00:00.000Z");
    const inj = await prisma.injuryLog.create({
      data: { centreId: centre.id, subjectType: "horse", subjectId: "h1", occurredAt: new Date("2026-01-01"), initialNotes: "cut", status: "recovered", recoveredAt },
    });
    const res = await injuryPatch(patchReq({ status: "active" }), { params: { id: inj.id } });
    expect(res.status).toBe(200);
    const after = await prisma.injuryLog.findUniqueOrThrow({ where: { id: inj.id } });
    expect(after.status).toBe("active");
    expect(after.recoveredAt?.toISOString()).toBe(recoveredAt.toISOString()); // preserved, not null
  });
});
