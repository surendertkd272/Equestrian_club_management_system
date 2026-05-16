import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkUser, mkCentreWithManager, mkRider, linkParent } from "../helpers/fixtures";
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

const { GET: listChildren } = await import("@/app/api/parent/children/route");
const { GET: getChild } = await import("@/app/api/parent/children/[riderId]/route");
const { POST: createLink } = await import("@/app/api/riders/[id]/parent-links/route");
const { DELETE: deleteLink } = await import("@/app/api/riders/[id]/parent-links/[linkId]/route");

async function loginAs(payload: SessionPayload) {
  cookieJar.clear();
  cookieJar.set("ew_session", { value: await signSession(payload) });
}

beforeEach(async () => {
  await resetDb();
});

describe("GET /api/parent/children", () => {
  it("returns only riders linked to the signed-in parent", async () => {
    const { centre } = await mkCentreWithManager();
    const parent = await mkUser({ role: "PARENT", centreId: null });
    const myKid = await mkRider({ centreId: centre.id, firstName: "Mine" });
    const otherKid = await mkRider({ centreId: centre.id, firstName: "NotMine" });
    await linkParent({ parentUserId: parent.id, riderId: myKid.id });

    await loginAs({ userId: parent.id, role: "PARENT", centreId: null, name: parent.name });
    const r = await listChildren(new Request("http://localhost/api/parent/children") as any);
    const data = await r.json();
    expect(r.status).toBe(200);
    expect(data.children).toHaveLength(1);
    expect(data.children[0].riderId).toBe(myKid.id);
    expect(data.children[0].firstName).toBe("Mine");
    // Sanity — the other rider exists but isn't returned.
    expect(await prisma.rider.count()).toBe(2);
    expect(otherKid.id).not.toBe(myKid.id);
  });

  it("non-PARENT (e.g. a coach) gets 403", async () => {
    const { centre } = await mkCentreWithManager();
    const coach = await mkUser({ role: "COACH", centreId: centre.id });
    await loginAs({ userId: coach.id, role: "COACH", centreId: centre.id, name: coach.name });
    const r = await listChildren(new Request("http://localhost/api/parent/children") as any);
    expect(r.status).toBe(403);
  });

  it("rolls up attendance %, upcoming exam, latest cert, unpaid invoices per child", async () => {
    const { centre } = await mkCentreWithManager();
    const parent = await mkUser({ role: "PARENT", centreId: null });
    const kid = await mkRider({ centreId: centre.id });
    await linkParent({ parentUserId: parent.id, riderId: kid.id });

    const batch = await prisma.batch.create({
      data: {
        centreId: centre.id,
        name: "Morning",
        dayOfWeek: "Mon",
        startTime: "06:00",
        endTime: "07:00",
      },
    });
    // 3 sessions: 2 present, 1 absent → 67%.
    for (let i = 0; i < 3; i++) {
      await prisma.attendance.create({
        data: {
          riderId: kid.id,
          batchId: batch.id,
          date: new Date(Date.now() - (i + 1) * 24 * 60 * 60 * 1000),
          status: i === 0 ? "absent" : "present",
        },
      });
    }
    // Upcoming exam in 7 days
    await prisma.exam.create({
      data: {
        centreId: centre.id,
        riderId: kid.id,
        examinerId: parent.id, // doesn't matter for the rollup
        examinerName: "E.",
        level: 1,
        date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        status: "scheduled",
      },
    });
    // Unpaid invoice
    await prisma.invoice.create({
      data: {
        centreId: centre.id,
        riderId: kid.id,
        amount: 3000,
        kind: "monthly",
        status: "due",
        dueDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      },
    });
    // One cert (most recent)
    await prisma.certificate.create({
      data: {
        centreId: centre.id,
        riderId: kid.id,
        type: "promotion",
        levelName: "L1",
        serialNo: "EW-L1-TESTAAAA",
        qrCode: "x",
      },
    });

    await loginAs({ userId: parent.id, role: "PARENT", centreId: null, name: parent.name });
    const r = await listChildren(new Request("http://localhost/api/parent/children") as any);
    const data = await r.json();
    expect(r.status).toBe(200);
    const c = data.children[0];
    expect(c.attendancePct).toBe(67);
    expect(c.attendedSessions).toBe(2);
    expect(c.totalSessions).toBe(3);
    expect(c.upcomingExamAt).toBeTruthy();
    expect(c.latestCertificateSerial).toBe("EW-L1-TESTAAAA");
    expect(c.unpaidInvoiceCount).toBe(1);
  });
});

describe("GET /api/parent/children/[riderId]", () => {
  it("returns detail for a linked rider", async () => {
    const { centre } = await mkCentreWithManager();
    const parent = await mkUser({ role: "PARENT", centreId: null });
    const kid = await mkRider({ centreId: centre.id, firstName: "Linked" });
    await linkParent({ parentUserId: parent.id, riderId: kid.id, relationship: "mother" });

    await loginAs({ userId: parent.id, role: "PARENT", centreId: null, name: parent.name });
    const r = await getChild(new Request("http://localhost") as any, { params: { riderId: kid.id } });
    const data = await r.json();
    expect(r.status).toBe(200);
    expect(data.rider.firstName).toBe("Linked");
    expect(data.relationship).toBe("mother");
  });

  it("404 when the rider exists but isn't linked to this parent (no leakage)", async () => {
    const { centre } = await mkCentreWithManager();
    const parentA = await mkUser({ role: "PARENT", centreId: null });
    const parentB = await mkUser({ role: "PARENT", centreId: null });
    const aKid = await mkRider({ centreId: centre.id, firstName: "AKid" });
    const bKid = await mkRider({ centreId: centre.id, firstName: "BKid" });
    await linkParent({ parentUserId: parentA.id, riderId: aKid.id });
    await linkParent({ parentUserId: parentB.id, riderId: bKid.id });

    await loginAs({ userId: parentA.id, role: "PARENT", centreId: null, name: parentA.name });
    const r = await getChild(new Request("http://localhost") as any, { params: { riderId: bKid.id } });
    expect(r.status).toBe(404);
  });

  it("404 for a non-existent rider id", async () => {
    const { centre } = await mkCentreWithManager();
    const parent = await mkUser({ role: "PARENT", centreId: null });
    const kid = await mkRider({ centreId: centre.id });
    await linkParent({ parentUserId: parent.id, riderId: kid.id });
    await loginAs({ userId: parent.id, role: "PARENT", centreId: null, name: parent.name });
    const r = await getChild(new Request("http://localhost") as any, { params: { riderId: "ghost" } });
    expect(r.status).toBe(404);
  });
});

describe("POST /api/riders/[id]/parent-links", () => {
  it("manager creates a parent user inline and links them; returns a one-time temp password", async () => {
    const { centre, manager } = await mkCentreWithManager();
    const kid = await mkRider({ centreId: centre.id });
    await loginAs({ userId: manager.id, role: "CENTRE_MANAGER", centreId: centre.id, name: manager.name });

    const r = await createLink(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          relationship: "father",
          parent: { name: "Dad D.", email: "dad@test.local", phone: "9876543210" },
        }),
      }) as any,
      { params: { id: kid.id } },
    );
    const data = await r.json();
    expect(r.status).toBe(200);
    expect(typeof data.tempPassword).toBe("string");
    expect(data.tempPassword.length).toBeGreaterThan(6);

    const parent = await prisma.user.findUniqueOrThrow({ where: { email: "dad@test.local" } });
    expect(parent.role).toBe("PARENT");

    const links = await prisma.parentLink.findMany();
    expect(links).toHaveLength(1);
    expect(links[0].parentUserId).toBe(parent.id);
    expect(links[0].relationship).toBe("father");
  });

  it("linking an existing parent user (by parentUserId) skips creating a new account", async () => {
    const { centre, manager } = await mkCentreWithManager();
    const existing = await mkUser({ role: "PARENT", centreId: null, email: "p@test.local" });
    const kid = await mkRider({ centreId: centre.id });
    await loginAs({ userId: manager.id, role: "CENTRE_MANAGER", centreId: centre.id, name: manager.name });

    const r = await createLink(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ relationship: "mother", parentUserId: existing.id }),
      }) as any,
      { params: { id: kid.id } },
    );
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.parentUserId).toBe(existing.id);
    expect(data.tempPassword).toBeUndefined();
  });

  it("409 ALREADY_LINKED when trying to attach the same parent twice", async () => {
    const { centre, manager } = await mkCentreWithManager();
    const parent = await mkUser({ role: "PARENT", centreId: null });
    const kid = await mkRider({ centreId: centre.id });
    await linkParent({ parentUserId: parent.id, riderId: kid.id });

    await loginAs({ userId: manager.id, role: "CENTRE_MANAGER", centreId: centre.id, name: manager.name });
    const r = await createLink(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ relationship: "father", parentUserId: parent.id }),
      }) as any,
      { params: { id: kid.id } },
    );
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("ALREADY_LINKED");
  });

  it("409 EMAIL_TAKEN when inline-creating with an email that belongs to a non-parent user", async () => {
    const { centre, manager } = await mkCentreWithManager();
    const kid = await mkRider({ centreId: centre.id });
    await mkUser({ role: "COACH", centreId: centre.id, email: "shared@test.local" });

    await loginAs({ userId: manager.id, role: "CENTRE_MANAGER", centreId: centre.id, name: manager.name });
    const r = await createLink(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          relationship: "father",
          parent: { name: "Dad", email: "shared@test.local" },
        }),
      }) as any,
      { params: { id: kid.id } },
    );
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("EMAIL_TAKEN");
  });

  it("400 NOT_PARENT_ROLE when passing a parentUserId whose role isn't PARENT", async () => {
    const { centre, manager } = await mkCentreWithManager();
    const coach = await mkUser({ role: "COACH", centreId: centre.id });
    const kid = await mkRider({ centreId: centre.id });
    await loginAs({ userId: manager.id, role: "CENTRE_MANAGER", centreId: centre.id, name: manager.name });

    const r = await createLink(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ relationship: "father", parentUserId: coach.id }),
      }) as any,
      { params: { id: kid.id } },
    );
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("NOT_PARENT_ROLE");
  });

  it("403 cross-centre when manager tries to link in a centre they don't own", async () => {
    const { manager } = await mkCentreWithManager();
    const other = await mkCentreWithManager({ name: "Other" });
    const foreignKid = await mkRider({ centreId: other.centre.id });
    await loginAs({
      userId: manager.id,
      role: "CENTRE_MANAGER",
      centreId: manager.centreId,
      name: manager.name,
    });

    const r = await createLink(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          relationship: "father",
          parent: { name: "X", email: "x@test.local" },
        }),
      }) as any,
      { params: { id: foreignKid.id } },
    );
    expect(r.status).toBe(403);
  });

  it("403 when caller lacks rider.write (e.g. a coach)", async () => {
    const { centre } = await mkCentreWithManager();
    const coach = await mkUser({ role: "COACH", centreId: centre.id });
    const kid = await mkRider({ centreId: centre.id });
    await loginAs({ userId: coach.id, role: "COACH", centreId: centre.id, name: coach.name });

    const r = await createLink(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          relationship: "father",
          parent: { name: "X", email: "x@test.local" },
        }),
      }) as any,
      { params: { id: kid.id } },
    );
    expect(r.status).toBe(403);
  });

  it("validation: provide parent OR parentUserId, not both", async () => {
    const { centre, manager } = await mkCentreWithManager();
    const existing = await mkUser({ role: "PARENT" });
    const kid = await mkRider({ centreId: centre.id });
    await loginAs({ userId: manager.id, role: "CENTRE_MANAGER", centreId: centre.id, name: manager.name });

    const r = await createLink(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          relationship: "father",
          parentUserId: existing.id,
          parent: { name: "X", email: "x@test.local" },
        }),
      }) as any,
      { params: { id: kid.id } },
    );
    expect(r.status).toBe(400);
  });
});

describe("DELETE /api/riders/[id]/parent-links/[linkId]", () => {
  it("manager can unlink a parent (the user account stays)", async () => {
    const { centre, manager } = await mkCentreWithManager();
    const parent = await mkUser({ role: "PARENT", centreId: null });
    const kid = await mkRider({ centreId: centre.id });
    const link = await linkParent({ parentUserId: parent.id, riderId: kid.id });

    await loginAs({ userId: manager.id, role: "CENTRE_MANAGER", centreId: centre.id, name: manager.name });
    const r = await deleteLink(
      new Request("http://localhost", { method: "DELETE" }) as any,
      { params: { id: kid.id, linkId: link.id } },
    );
    expect(r.status).toBe(200);

    expect(await prisma.parentLink.count()).toBe(0);
    // User itself isn't deleted.
    expect(await prisma.user.findUnique({ where: { id: parent.id } })).not.toBeNull();
  });

  it("404 if the linkId doesn't belong to that rider", async () => {
    const { centre, manager } = await mkCentreWithManager();
    const parent = await mkUser({ role: "PARENT", centreId: null });
    const kidA = await mkRider({ centreId: centre.id, firstName: "A" });
    const kidB = await mkRider({ centreId: centre.id, firstName: "B" });
    const link = await linkParent({ parentUserId: parent.id, riderId: kidA.id });

    await loginAs({ userId: manager.id, role: "CENTRE_MANAGER", centreId: centre.id, name: manager.name });
    const r = await deleteLink(
      new Request("http://localhost", { method: "DELETE" }) as any,
      { params: { id: kidB.id, linkId: link.id } },
    );
    expect(r.status).toBe(404);
  });
});
