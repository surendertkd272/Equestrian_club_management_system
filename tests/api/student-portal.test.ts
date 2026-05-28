import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkUser, mkCentre, mkCentreWithManager, mkRider } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { signSession, verifyPassword } from "@/lib/auth";
import { mockReq } from "../helpers/request";
import type { SessionPayload } from "@/lib/auth";

const cookieJar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => cookieJar.get(name),
    set: (name: string, value: string) => cookieJar.set(name, { value }),
    delete: (name: string) => cookieJar.delete(name),
  }),
}));

const { GET: me } = await import("@/app/api/student/me/route");
const { GET: meDetail } = await import("@/app/api/student/me/detail/route");
const { POST: issuePortal, DELETE: revokePortal } = await import(
  "@/app/api/riders/[id]/portal-access/route"
);

async function loginAs(payload: SessionPayload) {
  cookieJar.clear();
  cookieJar.set("ew_session", { value: await signSession(payload) });
}

beforeEach(async () => {
  await resetDb();
});

describe("GET /api/student/me", () => {
  it("returns summary for a rider whose User account is linked", async () => {
    const c = await mkCentre();
    const u = await mkUser({ role: "RIDER", centreId: c.id, name: "Aarav S." });
    const rider = await mkRider({ centreId: c.id, firstName: "Aarav", lastName: "Sharma" });
    await prisma.rider.update({ where: { id: rider.id }, data: { userId: u.id } });
    await loginAs({ userId: u.id, role: "RIDER", centreId: c.id, name: u.name });

    const r = await me(mockReq("http://localhost"));
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.rider.firstName).toBe("Aarav");
    expect(data.attendancePct).toBeNull(); // no attendance yet
    expect(data.unpaidInvoices).toBe(0);
  });

  it("returns 404 NOT_LINKED for a RIDER user without a Rider row", async () => {
    const c = await mkCentre();
    const u = await mkUser({ role: "RIDER", centreId: c.id });
    await loginAs({ userId: u.id, role: "RIDER", centreId: c.id, name: u.name });
    const r = await me(mockReq("http://localhost"));
    expect(r.status).toBe(404);
    expect((await r.json()).error).toBe("NOT_LINKED");
  });

  it("returns 403 when caller isn't a RIDER (e.g. a coach hits the endpoint)", async () => {
    const c = await mkCentre();
    const coach = await mkUser({ role: "COACH", centreId: c.id });
    await loginAs({ userId: coach.id, role: "COACH", centreId: c.id, name: coach.name });
    const r = await me(mockReq("http://localhost"));
    expect(r.status).toBe(403);
  });

  it("rolls up attendance %, unpaid invoices, skills mastered", async () => {
    const c = await mkCentre();
    const u = await mkUser({ role: "RIDER", centreId: c.id });
    const rider = await mkRider({ centreId: c.id });
    await prisma.rider.update({ where: { id: rider.id }, data: { userId: u.id } });

    const batch = await prisma.batch.create({
      data: { centreId: c.id, name: "M", dayOfWeek: "Mon", startTime: "06:00", endTime: "07:00" },
    });
    // 4 sessions: 3 present, 1 absent → 75%
    const statuses = ["present", "present", "absent", "late"];
    for (let i = 0; i < statuses.length; i++) {
      await prisma.attendance.create({
        data: {
          riderId: rider.id,
          batchId: batch.id,
          date: new Date(Date.now() - (i + 1) * 24 * 60 * 60 * 1000),
          status: statuses[i],
        },
      });
    }
    await prisma.invoice.create({
      data: {
        centreId: c.id,
        riderId: rider.id,
        amount: 1000,
        kind: "monthly",
        status: "due",
        dueDate: new Date(Date.now() + 7 * 86400000),
      },
    });

    await loginAs({ userId: u.id, role: "RIDER", centreId: c.id, name: u.name });
    const r = await me(mockReq("http://localhost"));
    const data = await r.json();
    // 3 present-or-late / 4 sessions = 75%
    expect(data.attendancePct).toBe(75);
    expect(data.attendedSessions).toBe(3);
    expect(data.totalSessions).toBe(4);
    expect(data.unpaidInvoices).toBe(1);
  });
});

describe("GET /api/student/me/detail", () => {
  it("returns attendance + skills + exams + certs + notifications", async () => {
    const c = await mkCentre();
    const u = await mkUser({ role: "RIDER", centreId: c.id, name: "Aisha" });
    const rider = await mkRider({ centreId: c.id, firstName: "Aisha" });
    await prisma.rider.update({ where: { id: rider.id }, data: { userId: u.id } });

    // Seed one notification + one cert.
    await prisma.notification.create({
      data: { userId: u.id, type: "test.welcome", title: "Welcome", body: "Hi!" },
    });
    await prisma.certificate.create({
      data: {
        centreId: c.id,
        riderId: rider.id,
        type: "promotion",
        levelName: "L1",
        serialNo: "EW-L1-AAAAAAAA",
        qrCode: "x",
      },
    });

    await loginAs({ userId: u.id, role: "RIDER", centreId: c.id, name: u.name });
    const r = await meDetail(mockReq("http://localhost"));
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.rider.firstName).toBe("Aisha");
    expect(data.notifications).toHaveLength(1);
    expect(data.notifications[0].title).toBe("Welcome");
    expect(data.certificates).toHaveLength(1);
    expect(data.certificates[0].serialNo).toBe("EW-L1-AAAAAAAA");
  });

  it("returns only unread notifications (read ones are filtered out)", async () => {
    const c = await mkCentre();
    const u = await mkUser({ role: "RIDER", centreId: c.id });
    const rider = await mkRider({ centreId: c.id });
    await prisma.rider.update({ where: { id: rider.id }, data: { userId: u.id } });

    await prisma.notification.create({
      data: { userId: u.id, type: "x", title: "Unread", body: "—" },
    });
    await prisma.notification.create({
      data: { userId: u.id, type: "x", title: "Already read", body: "—", readAt: new Date() },
    });

    await loginAs({ userId: u.id, role: "RIDER", centreId: c.id, name: u.name });
    const r = await meDetail(mockReq("http://localhost"));
    const data = await r.json();
    expect(data.notifications.map((n: any) => n.title)).toEqual(["Unread"]);
  });
});

describe("POST /api/riders/[id]/portal-access (issue)", () => {
  it("manager issues access; creates RIDER user + links to rider; returns temp password", async () => {
    const { centre, manager } = await mkCentreWithManager();
    const rider = await mkRider({ centreId: centre.id, firstName: "Ria", lastName: "K." });
    await loginAs({ userId: manager.id, role: "CENTRE_MANAGER", centreId: centre.id, name: manager.name });

    const r = await issuePortal(
      mockReq("http://localhost", {
        method: "POST",
        body: JSON.stringify({ email: "ria@test.local" }),
      }),
      { params: { id: rider.id } },
    );
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.email).toBe("ria@test.local");
    expect(typeof data.tempPassword).toBe("string");
    expect(data.tempPassword.length).toBeGreaterThan(10);

    const newUser = await prisma.user.findUniqueOrThrow({ where: { id: data.userId } });
    expect(newUser.role).toBe("RIDER");
    expect(newUser.centreId).toBe(centre.id);
    expect(newUser.name).toBe("Ria K.");
    expect(await verifyPassword(data.tempPassword, newUser.passwordHash)).toBe(true);

    const linkedRider = await prisma.rider.findUniqueOrThrow({ where: { id: rider.id } });
    expect(linkedRider.userId).toBe(newUser.id);
  });

  it("ALREADY_LINKED: refuses to re-issue when rider already has a portal user", async () => {
    const { centre, manager } = await mkCentreWithManager();
    const rider = await mkRider({ centreId: centre.id });
    const existing = await mkUser({ role: "RIDER", centreId: centre.id });
    await prisma.rider.update({ where: { id: rider.id }, data: { userId: existing.id } });
    await loginAs({ userId: manager.id, role: "CENTRE_MANAGER", centreId: centre.id, name: manager.name });

    const r = await issuePortal(
      mockReq("http://localhost", {
        method: "POST",
        body: JSON.stringify({ email: "duplicate@test.local" }),
      }),
      { params: { id: rider.id } },
    );
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("ALREADY_LINKED");
  });

  it("EMAIL_TAKEN: refuses when the email is in use by another user", async () => {
    const { centre, manager } = await mkCentreWithManager();
    const rider = await mkRider({ centreId: centre.id });
    await mkUser({ role: "COACH", centreId: centre.id, email: "shared@test.local" });
    await loginAs({ userId: manager.id, role: "CENTRE_MANAGER", centreId: centre.id, name: manager.name });

    const r = await issuePortal(
      mockReq("http://localhost", {
        method: "POST",
        body: JSON.stringify({ email: "shared@test.local" }),
      }),
      { params: { id: rider.id } },
    );
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("EMAIL_TAKEN");
  });

  it("403 when caller lacks rider.write (coach)", async () => {
    const { centre } = await mkCentreWithManager();
    const coach = await mkUser({ role: "COACH", centreId: centre.id });
    const rider = await mkRider({ centreId: centre.id });
    await loginAs({ userId: coach.id, role: "COACH", centreId: centre.id, name: coach.name });

    const r = await issuePortal(
      mockReq("http://localhost", {
        method: "POST",
        body: JSON.stringify({ email: "x@test.local" }),
      }),
      { params: { id: rider.id } },
    );
    expect(r.status).toBe(403);
  });

  it("403 cross-centre", async () => {
    const a = await mkCentreWithManager({ name: "A" });
    const b = await mkCentreWithManager({ name: "B" });
    const foreignRider = await mkRider({ centreId: b.centre.id });
    await loginAs({ userId: a.manager.id, role: "CENTRE_MANAGER", centreId: a.centre.id, name: a.manager.name });

    const r = await issuePortal(
      mockReq("http://localhost", {
        method: "POST",
        body: JSON.stringify({ email: "x@test.local" }),
      }),
      { params: { id: foreignRider.id } },
    );
    expect(r.status).toBe(403);
  });
});

describe("DELETE /api/riders/[id]/portal-access (revoke)", () => {
  it("manager revokes; unlinks rider + deletes the user account", async () => {
    const { centre, manager } = await mkCentreWithManager();
    const rider = await mkRider({ centreId: centre.id });
    const u = await mkUser({ role: "RIDER", centreId: centre.id });
    await prisma.rider.update({ where: { id: rider.id }, data: { userId: u.id } });
    await loginAs({ userId: manager.id, role: "CENTRE_MANAGER", centreId: centre.id, name: manager.name });

    const r = await revokePortal(mockReq("http://localhost", { method: "DELETE" }), {
      params: { id: rider.id },
    });
    expect(r.status).toBe(200);

    const fresh = await prisma.rider.findUniqueOrThrow({ where: { id: rider.id } });
    expect(fresh.userId).toBeNull();
    expect(await prisma.user.findUnique({ where: { id: u.id } })).toBeNull();
  });

  it("404 NOT_LINKED when rider has no portal user", async () => {
    const { centre, manager } = await mkCentreWithManager();
    const rider = await mkRider({ centreId: centre.id });
    await loginAs({ userId: manager.id, role: "CENTRE_MANAGER", centreId: centre.id, name: manager.name });

    const r = await revokePortal(mockReq("http://localhost", { method: "DELETE" }), {
      params: { id: rider.id },
    });
    expect(r.status).toBe(404);
  });
});
