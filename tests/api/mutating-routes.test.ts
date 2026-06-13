// Smoke tests for three mutating POST routes that previously had zero
// test coverage. Each covers a happy-path POST + the most-likely 4xx
// guard (auth, conflict, scoping) for the route. Not exhaustive — just
// enough to fail loudly if someone breaks the request/response contract.
//
// Salary (POST /api/salary) and Razorpay webhook (/api/webhooks/razorpay)
// are deliberately deferred — both need real fixture setup (SalaryStructure
// + PayrollConfig + EmployeeAdvance fanout for salary; HMAC signature
// computation for razorpay-webhook) that's too heavy for a smoke pass.
// Add them once an incident makes the gap concrete.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkCentre, mkUser, mkOrg } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { signSession, type SessionPayload } from "@/lib/auth";
import type { Role } from "@/lib/roles";
import { mockReq } from "../helpers/request";

// Minimal cookie-jar mock — every test in here just needs to seed a
// session cookie before hitting the route handlers.
const cookieJar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => cookieJar.get(name),
    set: (name: string, value: string) => cookieJar.set(name, { value }),
    delete: (name: string) => cookieJar.delete(name),
  }),
}));

// Late imports — the next/headers mock must be registered before the route
// handlers (which transitively pull lib/auth → cookies()).
const { POST: postConsumable } = await import("@/app/api/consumables/route");
const { POST: postBooking } = await import("@/app/api/facility-bookings/route");
const { POST: postRequisition } = await import("@/app/api/requisitions/route");

async function signInAs(user: { id: string; role: string; centreId: string | null; name: string }) {
  const payload: SessionPayload = {
    userId: user.id,
    role: user.role as Role,
    centreId: user.centreId,
    name: user.name,
  };
  cookieJar.clear();
  cookieJar.set("ew_session", { value: await signSession(payload) });
}

function jsonReq(url: string, body: unknown) {
  return mockReq(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  await resetDb();
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/consumables

describe("POST /api/consumables", () => {
  it("creates a consumable row scoped to the caller's centre", async () => {
    const org = await mkOrg();
    const centre = await mkCentre({ orgId: org.id });
    const manager = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id });
    await signInAs(manager);

    const res = await postConsumable(
      jsonReq("http://localhost/api/consumables", {
        name: "Bandage roll",
        category: "bandage",
        unit: "roll",
        qty: 24,
        reorderThreshold: 6,
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    const row = await prisma.consumable.findUniqueOrThrow({ where: { id: body.id } });
    expect(row.centreId).toBe(centre.id);
    expect(row.name).toBe("Bandage roll");
    expect(row.category).toBe("bandage");
    expect(row.qty).toBe(24);
  });

  it("refuses when the caller has the wrong role", async () => {
    const org = await mkOrg();
    const centre = await mkCentre({ orgId: org.id });
    // GROOM lacks medicine.manage — the policy gate this route uses.
    const groom = await mkUser({ role: "GROOM", centreId: centre.id });
    await signInAs(groom);

    const res = await postConsumable(
      jsonReq("http://localhost/api/consumables", {
        name: "Bandage roll",
        category: "bandage",
        unit: "roll",
        qty: 24,
      }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("FORBIDDEN");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/facility-bookings

describe("POST /api/facility-bookings", () => {
  it("creates a booking and rejects overlapping ones on the same facility", async () => {
    const org = await mkOrg();
    const centre = await mkCentre({ orgId: org.id });
    const manager = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id });
    const facility = await prisma.facility.create({
      data: { centreId: centre.id, name: "Arena A", type: "indoor_arena" },
    });
    await signInAs(manager);

    const first = await postBooking(
      jsonReq("http://localhost/api/facility-bookings", {
        facilityId: facility.id,
        purpose: "lesson",
        title: "Morning lesson",
        startAt: "2026-06-01T09:00:00Z",
        endAt: "2026-06-01T10:00:00Z",
      }),
    );
    expect(first.status).toBe(200);

    // Overlap: 09:30–10:30 should conflict with 09:00–10:00.
    const overlap = await postBooking(
      jsonReq("http://localhost/api/facility-bookings", {
        facilityId: facility.id,
        purpose: "exam",
        title: "Clashing exam",
        startAt: "2026-06-01T09:30:00Z",
        endAt: "2026-06-01T10:30:00Z",
      }),
    );
    expect(overlap.status).toBe(409);
    expect((await overlap.json()).error).toBe("FACILITY_CONFLICT");

    // Back-to-back: 10:00–11:00 starts when the first ends — should NOT collide.
    const adjacent = await postBooking(
      jsonReq("http://localhost/api/facility-bookings", {
        facilityId: facility.id,
        purpose: "lesson",
        title: "Adjacent lesson",
        startAt: "2026-06-01T10:00:00Z",
        endAt: "2026-06-01T11:00:00Z",
      }),
    );
    expect(adjacent.status).toBe(200);
  });

  it("rejects an inverted time range (end <= start)", async () => {
    const org = await mkOrg();
    const centre = await mkCentre({ orgId: org.id });
    const manager = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id });
    const facility = await prisma.facility.create({
      data: { centreId: centre.id, name: "Arena A", type: "indoor_arena" },
    });
    await signInAs(manager);

    const res = await postBooking(
      jsonReq("http://localhost/api/facility-bookings", {
        facilityId: facility.id,
        purpose: "lesson",
        title: "Backwards",
        startAt: "2026-06-01T11:00:00Z",
        endAt: "2026-06-01T10:00:00Z",
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("INVALID_TIME_RANGE");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/requisitions

describe("POST /api/requisitions", () => {
  it("creates a requisition and stores itemsJson as parsed jsonb", async () => {
    const org = await mkOrg();
    const centre = await mkCentre({ orgId: org.id });
    const coach = await mkUser({ role: "HEAD_COACH", centreId: centre.id });
    await signInAs(coach);

    const res = await postRequisition(
      jsonReq("http://localhost/api/requisitions", {
        items: [
          { name: "Saddle pad", qty: 5, estimatedUnitCost: 800, unit: "piece" },
          { name: "Helmet", qty: 2, estimatedUnitCost: 3500, unit: "piece" },
        ],
        reason: "Q1 replenishment",
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    const row = await prisma.requisition.findUniqueOrThrow({ where: { id: body.id } });
    expect(row.totalEstimatedCost).toBe(5 * 800 + 2 * 3500);
    expect(row.stage).toBe("pending_manager");
    // Regression guard for the JSON.stringify-into-jsonb bug we just fixed:
    // itemsJson must be the parsed array, NOT a string that looks like JSON.
    expect(Array.isArray(row.itemsJson)).toBe(true);
    expect((row.itemsJson as unknown as Array<{ name: string }>)[0].name).toBe("Saddle pad");
  });

  it("rejects a caller without requisition.submit", async () => {
    const org = await mkOrg();
    const centre = await mkCentre({ orgId: org.id });
    // RIDER lacks requisition.submit (GROOM was granted it).
    const rider = await mkUser({ role: "RIDER", centreId: centre.id });
    await signInAs(rider);

    const res = await postRequisition(
      jsonReq("http://localhost/api/requisitions", {
        items: [{ name: "Saddle pad", qty: 1, estimatedUnitCost: 800, unit: "piece" }],
      }),
    );
    expect(res.status).toBe(403);
  });
});
