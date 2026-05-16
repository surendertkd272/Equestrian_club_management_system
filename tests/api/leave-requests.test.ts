import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkUser, mkCentreWithManager } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { signSession } from "@/lib/auth";
import type { SessionPayload } from "@/lib/auth";

const cookieJar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => cookieJar.get(name),
    set: (name: string, value: string) => cookieJar.set(name, { value }),
    delete: (name: string) => cookieJar.delete(name),
  }),
}));

const { POST, GET } = await import("@/app/api/leave-requests/route");
const { PATCH } = await import("@/app/api/leave-requests/[id]/route");

async function loginAs(payload: SessionPayload) {
  cookieJar.clear();
  cookieJar.set("ew_session", { value: await signSession(payload) });
}

function postReq(body: unknown) {
  return POST(
    new Request("http://localhost/api/leave-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }) as any,
  );
}

function patchReq(id: string, body: unknown) {
  return PATCH(
    new Request(`http://localhost/api/leave-requests/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }) as any,
    { params: { id } },
  );
}

beforeEach(async () => {
  await resetDb();
});

describe("POST /api/leave-requests", () => {
  it("a coach can submit their own leave request", async () => {
    const { centre } = await mkCentreWithManager();
    const coach = await mkUser({ role: "COACH", centreId: centre.id });
    await loginAs({ userId: coach.id, role: "COACH", centreId: centre.id, name: coach.name });

    const r = await postReq({ startDate: "2026-06-01", endDate: "2026-06-03", reason: "Family event" });
    expect(r.status).toBe(200);

    const rows = await prisma.leaveRequest.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(coach.id);
    expect(rows[0].status).toBe("pending");
  });

  it("RIDER role lacks leave.request → 403", async () => {
    const { centre } = await mkCentreWithManager();
    const rider = await mkUser({ role: "RIDER", centreId: centre.id });
    await loginAs({ userId: rider.id, role: "RIDER", centreId: centre.id, name: rider.name });

    const r = await postReq({ startDate: "2026-06-01", endDate: "2026-06-03", reason: "x" });
    expect(r.status).toBe(403);
  });

  it("validation: endDate before startDate → 400", async () => {
    const { centre } = await mkCentreWithManager();
    const coach = await mkUser({ role: "COACH", centreId: centre.id });
    await loginAs({ userId: coach.id, role: "COACH", centreId: centre.id, name: coach.name });

    const r = await postReq({ startDate: "2026-06-05", endDate: "2026-06-01", reason: "oops" });
    expect(r.status).toBe(400);
  });

  it("validation: reason too short → 400", async () => {
    const { centre } = await mkCentreWithManager();
    const coach = await mkUser({ role: "COACH", centreId: centre.id });
    await loginAs({ userId: coach.id, role: "COACH", centreId: centre.id, name: coach.name });

    const r = await postReq({ startDate: "2026-06-01", endDate: "2026-06-01", reason: "x" });
    expect(r.status).toBe(400);
  });
});

describe("PATCH /api/leave-requests/[id]", () => {
  it("manager approves a pending request and the requester gets notified", async () => {
    const { centre, manager } = await mkCentreWithManager();
    const coach = await mkUser({ role: "COACH", centreId: centre.id });

    await loginAs({ userId: coach.id, role: "COACH", centreId: centre.id, name: coach.name });
    await postReq({ startDate: "2026-06-01", endDate: "2026-06-03", reason: "Family event" });
    const req = (await prisma.leaveRequest.findFirst())!;

    await loginAs({ userId: manager.id, role: "CENTRE_MANAGER", centreId: centre.id, name: manager.name });
    const r = await patchReq(req.id, { decision: "approved", reviewNotes: "Enjoy!" });
    expect(r.status).toBe(200);

    const updated = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: req.id } });
    expect(updated.status).toBe("approved");
    expect(updated.reviewedBy).toBe(manager.id);
    expect(updated.reviewNotes).toBe("Enjoy!");

    // Requester gets the outcome notification.
    const notifs = await prisma.notification.findMany({ where: { type: "leave.approved", userId: coach.id } });
    expect(notifs).toHaveLength(1);
  });

  it("non-approver cannot approve someone else's request", async () => {
    const { centre } = await mkCentreWithManager();
    const coachA = await mkUser({ role: "COACH", centreId: centre.id });
    const coachB = await mkUser({ role: "COACH", centreId: centre.id });

    await loginAs({ userId: coachA.id, role: "COACH", centreId: centre.id, name: coachA.name });
    await postReq({ startDate: "2026-06-01", endDate: "2026-06-03", reason: "Family event" });
    const req = (await prisma.leaveRequest.findFirst())!;

    await loginAs({ userId: coachB.id, role: "COACH", centreId: centre.id, name: coachB.name });
    const r = await patchReq(req.id, { decision: "approved" });
    expect(r.status).toBe(403);

    const after = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: req.id } });
    expect(after.status).toBe("pending");
  });

  it("requester can self-cancel a pending request", async () => {
    const { centre } = await mkCentreWithManager();
    const coach = await mkUser({ role: "COACH", centreId: centre.id });

    await loginAs({ userId: coach.id, role: "COACH", centreId: centre.id, name: coach.name });
    await postReq({ startDate: "2026-06-01", endDate: "2026-06-03", reason: "Family event" });
    const req = (await prisma.leaveRequest.findFirst())!;

    const r = await patchReq(req.id, { decision: "cancelled" });
    expect(r.status).toBe(200);

    const after = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: req.id } });
    expect(after.status).toBe("cancelled");
  });

  it("can't approve a non-pending request (already approved → 409)", async () => {
    const { centre, manager } = await mkCentreWithManager();
    const coach = await mkUser({ role: "COACH", centreId: centre.id });

    await loginAs({ userId: coach.id, role: "COACH", centreId: centre.id, name: coach.name });
    await postReq({ startDate: "2026-06-01", endDate: "2026-06-03", reason: "Family event" });
    const req = (await prisma.leaveRequest.findFirst())!;

    await loginAs({ userId: manager.id, role: "CENTRE_MANAGER", centreId: centre.id, name: manager.name });
    await patchReq(req.id, { decision: "approved" });
    const r = await patchReq(req.id, { decision: "rejected" });
    expect(r.status).toBe(409);
  });

  it("cross-centre review is rejected", async () => {
    const { centre, manager: managerA } = await mkCentreWithManager();
    const { centre: centreB, manager: managerB } = await mkCentreWithManager({ name: "Other" });
    const coach = await mkUser({ role: "COACH", centreId: centre.id });

    await loginAs({ userId: coach.id, role: "COACH", centreId: centre.id, name: coach.name });
    await postReq({ startDate: "2026-06-01", endDate: "2026-06-03", reason: "Family event" });
    const req = (await prisma.leaveRequest.findFirst())!;

    await loginAs({ userId: managerB.id, role: "CENTRE_MANAGER", centreId: centreB.id, name: managerB.name });
    const r = await patchReq(req.id, { decision: "approved" });
    expect(r.status).toBe(403);
    expect((await r.json()).error).toBe("FORBIDDEN_CROSS_CENTRE");
    // Sanity: managerA could approve — just confirming the test fixture.
    expect(managerA.id).not.toBe(managerB.id);
  });
});

describe("GET /api/leave-requests", () => {
  it("non-approver sees only their own rows; approver sees all in their centre", async () => {
    const { centre, manager } = await mkCentreWithManager();
    const coachA = await mkUser({ role: "COACH", centreId: centre.id });
    const coachB = await mkUser({ role: "COACH", centreId: centre.id });

    // Two requests, by different coaches
    await loginAs({ userId: coachA.id, role: "COACH", centreId: centre.id, name: coachA.name });
    await postReq({ startDate: "2026-06-01", endDate: "2026-06-01", reason: "A's leave" });
    await loginAs({ userId: coachB.id, role: "COACH", centreId: centre.id, name: coachB.name });
    await postReq({ startDate: "2026-06-02", endDate: "2026-06-02", reason: "B's leave" });

    // Coach A: should only see their own
    await loginAs({ userId: coachA.id, role: "COACH", centreId: centre.id, name: coachA.name });
    const r1 = await GET(new Request("http://localhost/api/leave-requests") as any);
    const d1 = await r1.json();
    expect(d1.rows).toHaveLength(1);
    expect(d1.rows[0].userId).toBe(coachA.id);

    // Manager: sees both
    await loginAs({ userId: manager.id, role: "CENTRE_MANAGER", centreId: centre.id, name: manager.name });
    const r2 = await GET(new Request("http://localhost/api/leave-requests") as any);
    const d2 = await r2.json();
    expect(d2.rows).toHaveLength(2);
  });
});
