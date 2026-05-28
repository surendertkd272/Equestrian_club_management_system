import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkUser, mkCentreWithManager } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { signSession } from "@/lib/auth";
import { mockReq } from "../helpers/request";
import type { SessionPayload } from "@/lib/auth";

// next/headers' cookies() throws outside a request scope. Back it with a jar that
// we control per test so we can swap which user is "logged in".
const cookieJar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => cookieJar.get(name),
    set: (name: string, value: string) => cookieJar.set(name, { value }),
    delete: (name: string) => cookieJar.delete(name),
  }),
}));

const { POST } = await import("@/app/api/staff-attendance/mark/route");
const { GET } = await import("@/app/api/staff-attendance/route");

async function loginAs(payload: SessionPayload) {
  cookieJar.clear();
  cookieJar.set("ew_session", { value: await signSession(payload) });
}

function postMark(body: unknown) {
  return POST(
    mockReq("http://localhost/api/staff-attendance/mark", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(async () => {
  await resetDb();
});

describe("POST /api/staff-attendance/mark", () => {
  it("403 when role lacks staff.attendance (e.g. COACH)", async () => {
    const { centre } = await mkCentreWithManager();
    const coach = await mkUser({ role: "COACH", centreId: centre.id });
    await loginAs({ userId: coach.id, role: "COACH", centreId: centre.id, name: coach.name });

    const target = await mkUser({ role: "GROOM", centreId: centre.id });
    const r = await postMark({ userId: target.id, date: "2026-05-14", status: "present" });
    expect(r.status).toBe(403);
  });

  it("happy path: manager marks present + records check-in/out + OT", async () => {
    const { centre, manager } = await mkCentreWithManager();
    await loginAs({ userId: manager.id, role: "CENTRE_MANAGER", centreId: centre.id, name: manager.name });

    const groom = await mkUser({ role: "GROOM", centreId: centre.id });
    const r = await postMark({
      userId: groom.id,
      date: "2026-05-14",
      status: "late",
      checkInAt: "07:15",
      checkOutAt: "17:00",
      overtimeHours: 1.5,
      notes: "Traffic",
    });
    expect(r.status).toBe(200);

    const rows = await prisma.staffAttendance.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(groom.id);
    expect(rows[0].centreId).toBe(centre.id);
    expect(rows[0].status).toBe("late");
    expect(rows[0].overtimeHours).toBe(1.5);
    expect(rows[0].notes).toBe("Traffic");
    expect(rows[0].markedBy).toBe(manager.id);
  });

  it("upserts: re-submitting the same (userId, date) overwrites", async () => {
    const { centre, manager } = await mkCentreWithManager();
    await loginAs({ userId: manager.id, role: "CENTRE_MANAGER", centreId: centre.id, name: manager.name });
    const groom = await mkUser({ role: "GROOM", centreId: centre.id });

    await postMark({ userId: groom.id, date: "2026-05-14", status: "absent" });
    await postMark({ userId: groom.id, date: "2026-05-14", status: "present" });

    const rows = await prisma.staffAttendance.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("present");
  });

  it("rejects marking a RIDER (they use the batch attendance flow)", async () => {
    const { centre, manager } = await mkCentreWithManager();
    await loginAs({ userId: manager.id, role: "CENTRE_MANAGER", centreId: centre.id, name: manager.name });
    const rider = await mkUser({ role: "RIDER", centreId: centre.id });
    const r = await postMark({ userId: rider.id, date: "2026-05-14", status: "present" });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("NOT_A_STAFF_USER");
  });

  it("blocks cross-centre marking (non-admin)", async () => {
    const { centre, manager } = await mkCentreWithManager();
    const other = await mkCentreWithManager({ name: "Other" });
    await loginAs({ userId: manager.id, role: "CENTRE_MANAGER", centreId: centre.id, name: manager.name });
    const foreignGroom = await mkUser({ role: "GROOM", centreId: other.centre.id });
    const r = await postMark({ userId: foreignGroom.id, date: "2026-05-14", status: "present" });
    expect(r.status).toBe(403);
    expect((await r.json()).error).toBe("FORBIDDEN_CROSS_CENTRE");
  });

  it("rejects checkout-before-checkin", async () => {
    const { centre, manager } = await mkCentreWithManager();
    await loginAs({ userId: manager.id, role: "CENTRE_MANAGER", centreId: centre.id, name: manager.name });
    const groom = await mkUser({ role: "GROOM", centreId: centre.id });
    const r = await postMark({
      userId: groom.id,
      date: "2026-05-14",
      status: "present",
      checkInAt: "10:00",
      checkOutAt: "09:00",
    });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("CHECKOUT_BEFORE_CHECKIN");
  });

  it("validates: bad time format → 400", async () => {
    const { centre, manager } = await mkCentreWithManager();
    await loginAs({ userId: manager.id, role: "CENTRE_MANAGER", centreId: centre.id, name: manager.name });
    const groom = await mkUser({ role: "GROOM", centreId: centre.id });
    const r = await postMark({ userId: groom.id, date: "2026-05-14", status: "present", checkInAt: "7:5" });
    expect(r.status).toBe(400);
  });
});

describe("GET /api/staff-attendance", () => {
  it("returns rows scoped to caller's centre", async () => {
    const { centre, manager } = await mkCentreWithManager();
    const other = await mkCentreWithManager({ name: "Other" });
    await loginAs({ userId: manager.id, role: "CENTRE_MANAGER", centreId: centre.id, name: manager.name });

    const homeGroom = await mkUser({ role: "GROOM", centreId: centre.id });
    const foreignGroom = await mkUser({ role: "GROOM", centreId: other.centre.id });
    await postMark({ userId: homeGroom.id, date: "2026-05-14", status: "present" });
    // Direct seed of a foreign row — wouldn't be possible through the API guard.
    await prisma.staffAttendance.create({
      data: { userId: foreignGroom.id, centreId: other.centre.id, date: new Date("2026-05-14"), status: "present" },
    });

    const r = await GET(mockReq("http://localhost/api/staff-attendance"));
    const data = await r.json();
    expect(r.status).toBe(200);
    expect(data.rows).toHaveLength(1);
    expect(data.rows[0].userId).toBe(homeGroom.id);
  });
});
