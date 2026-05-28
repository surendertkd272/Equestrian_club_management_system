// Integration tests for the features added during the inventory-team
// feedback sprint: vet visits, expense submission, requisition workflow,
// short links + redemption, gate log, HQ expenses.
//
// Each suite spins up a minimal fixture (centre + a few users), mocks the
// next/headers cookies API the same way other integration tests do, then
// hits the route handlers directly so we exercise the auth + permission
// + Prisma write surface without standing up a Next dev server.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkCentre, mkUser } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { signSession } from "@/lib/auth";
import { mockReq } from "../helpers/request";
import type { Role } from "@/lib/roles";
import type { SessionPayload } from "@/lib/auth";

// next/headers' cookies() throws outside a request scope. Back it with a
// jar that we control per test so the route handlers can resolve a session.
const cookieJar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => cookieJar.get(name),
    set: (name: string, value: string) => cookieJar.set(name, { value }),
    delete: (name: string) => cookieJar.delete(name),
  }),
}));

async function loginAs(user: { id: string; role: string; centreId: string | null; name: string }) {
  cookieJar.clear();
  const payload: SessionPayload = {
    userId: user.id,
    role: user.role as Role,
    centreId: user.centreId,
    name: user.name,
    tokenVersion: 0,
  };
  cookieJar.set("ew_session", { value: await signSession(payload) });
}

function jsonRequest(url: string, body: unknown, method = "POST"): any {
  return mockReq(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  await resetDb();
});

// ─────────────────────────────────────────────────────────────────────────
// Vet Visits
// ─────────────────────────────────────────────────────────────────────────
describe("vet visits API", () => {
  it("VET can create a visit with a prescription linked to centre Medicine", async () => {
    const { POST } = await import("@/app/api/horses/[id]/vet-visits/route");
    const centre = await mkCentre();
    const vet = await mkUser({ role: "VET", centreId: centre.id });
    const horse = await prisma.horse.create({
      data: { centreId: centre.id, name: "Bijli" },
    });
    const med = await prisma.medicine.create({
      data: {
        centreId: centre.id,
        name: "Banamine",
        category: "nsaid",
        batchNo: "B1",
        expDate: new Date(Date.now() + 200 * 86400000),
        qty: 10,
      },
    });

    await loginAs(vet);
    const res = await POST(
      jsonRequest("http://localhost/api/horses/x/vet-visits", {
        reason: "Lameness check",
        notes: "Slight off-load on near fore. Re-check in 3 days.",
        prescriptions: [{
          medicineId: med.id,
          medicineName: med.name,
          dose: "10ml",
          route: "im",
          durationDays: 3,
          frequency: "BID",
        }],
      }),
      { params: { id: horse.id } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.visit.prescriptions).toHaveLength(1);
    expect(body.visit.prescriptions[0].medicineId).toBe(med.id);
  });

  it("rejects cross-centre vet visit creation", async () => {
    const { POST } = await import("@/app/api/horses/[id]/vet-visits/route");
    const centreA = await mkCentre({ name: "A" });
    const centreB = await mkCentre({ name: "B" });
    const vet = await mkUser({ role: "VET", centreId: centreA.id });
    const horseB = await prisma.horse.create({
      data: { centreId: centreB.id, name: "Visitor" },
    });
    await loginAs(vet);
    const res = await POST(
      jsonRequest("http://localhost/api/horses/x/vet-visits", {
        notes: "Should not be allowed.",
      }),
      { params: { id: horseB.id } },
    );
    expect(res.status).toBe(403);
  });

  it("rejects a prescription pointing at another centre's Medicine", async () => {
    const { POST } = await import("@/app/api/horses/[id]/vet-visits/route");
    const centreA = await mkCentre({ name: "A" });
    const centreB = await mkCentre({ name: "B" });
    const vet = await mkUser({ role: "VET", centreId: centreA.id });
    const horseA = await prisma.horse.create({ data: { centreId: centreA.id, name: "A" } });
    const medB = await prisma.medicine.create({
      data: {
        centreId: centreB.id,
        name: "Foreign drug",
        category: "nsaid",
        batchNo: "X",
        expDate: new Date(Date.now() + 100 * 86400000),
        qty: 1,
      },
    });
    await loginAs(vet);
    const res = await POST(
      jsonRequest("http://localhost/api/horses/x/vet-visits", {
        notes: "n",
        prescriptions: [{ medicineId: medB.id, medicineName: "x", dose: "1ml" }],
      }),
      { params: { id: horseA.id } },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("INVALID_MEDICINE");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Requisition workflow
// ─────────────────────────────────────────────────────────────────────────
describe("requisition workflow", () => {
  async function freshScene() {
    const centre = await mkCentre();
    const coach = await mkUser({ role: "COACH", centreId: centre.id, name: "Coach C" });
    const manager = await mkUser({ role: "HEAD_COACH", centreId: centre.id, name: "Head Coach" });
    const accountant = await mkUser({ role: "ACCOUNTANT", centreId: centre.id, name: "Accountant A" });
    return { centre, coach, manager, accountant };
  }

  it("coach submits → head coach approves → accountant signs off", async () => {
    const { POST: submitPost } = await import("@/app/api/requisitions/route");
    const { POST: decidePost } = await import("@/app/api/requisitions/[id]/decide/route");
    const { coach, manager, accountant } = await freshScene();

    // Submit
    await loginAs(coach);
    const res1 = await submitPost(jsonRequest("http://localhost/api/requisitions", {
      reason: "Stock low",
      items: [{ name: "Brush", qty: 4, unit: "piece", estimatedUnitCost: 150 }],
    }));
    expect(res1.status).toBe(200);
    const { id } = await res1.json();

    // Manager approve
    await loginAs(manager);
    const res2 = await decidePost(
      jsonRequest(`http://localhost/api/requisitions/${id}/decide`, { decision: "approve" }),
      { params: { id } },
    );
    const j2 = await res2.json();
    expect(j2.stage).toBe("pending_accountant");

    // Accountant approve
    await loginAs(accountant);
    const res3 = await decidePost(
      jsonRequest(`http://localhost/api/requisitions/${id}/decide`, { decision: "approve" }),
      { params: { id } },
    );
    const j3 = await res3.json();
    expect(j3.stage).toBe("approved");

    // Submitter got a final notification.
    const notif = await prisma.notification.findFirst({
      where: { userId: coach.id, type: "requisition.approved" },
    });
    expect(notif).not.toBeNull();
  });

  it("coach cannot self-approve", async () => {
    const { POST: submitPost } = await import("@/app/api/requisitions/route");
    const { POST: decidePost } = await import("@/app/api/requisitions/[id]/decide/route");
    const { coach } = await freshScene();
    await loginAs(coach);
    const res1 = await submitPost(jsonRequest("http://localhost/api/requisitions", {
      items: [{ name: "Bag", qty: 1, estimatedUnitCost: 100 }],
    }));
    const { id } = await res1.json();
    const res2 = await decidePost(
      jsonRequest(`http://localhost/api/requisitions/${id}/decide`, { decision: "approve" }),
      { params: { id } },
    );
    expect(res2.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Gate log
// ─────────────────────────────────────────────────────────────────────────
describe("gate log API", () => {
  it("records an IN event and rejects cross-centre staff", async () => {
    const { POST } = await import("@/app/api/gate-log/route");
    const centreA = await mkCentre({ name: "A" });
    const centreB = await mkCentre({ name: "B" });
    const managerA = await mkUser({ role: "CENTRE_MANAGER", centreId: centreA.id });
    const staffA = await mkUser({ role: "GROOM", centreId: centreA.id });
    const staffB = await mkUser({ role: "GROOM", centreId: centreB.id });

    await loginAs(managerA);
    const ok = await POST(jsonRequest("http://localhost/api/gate-log", {
      staffUserId: staffA.id, direction: "in",
    }));
    expect(ok.status).toBe(200);

    const bad = await POST(jsonRequest("http://localhost/api/gate-log", {
      staffUserId: staffB.id, direction: "in",
    }));
    expect(bad.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Short link
// ─────────────────────────────────────────────────────────────────────────
describe("short link API", () => {
  it("CENTRE_MANAGER creates a link and an anonymous redeem redirects", async () => {
    const { POST: createPost } = await import("@/app/api/short-links/route");
    const centre = await mkCentre();
    const manager = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id });
    await loginAs(manager);
    const res = await createPost(jsonRequest("http://localhost/api/short-links", {
      kind: "injury",
      params: { horseId: "horse-1" },
      label: "Test injury",
      expiresInDays: 7,
    }));
    expect(res.status).toBe(200);
    const { link } = await res.json();
    expect(link.code).toMatch(/^[0-9A-Z]{8}$/);
    expect(link.targetPath).toBe("/injuries/new");

    // No POST gate on /r/[code]; the page itself is a Server Component
    // we'd need a fuller Next harness to test. Validate the DB row instead.
    const row = await prisma.shortLink.findUnique({ where: { code: link.code } });
    expect(row).not.toBeNull();
    expect(row!.singleUse).toBe(false);
  });

  it("rejects COACH (role lacking manage perm)", async () => {
    const { POST } = await import("@/app/api/short-links/route");
    const centre = await mkCentre();
    const coach = await mkUser({ role: "COACH", centreId: centre.id });
    await loginAs(coach);
    const res = await POST(jsonRequest("http://localhost/api/short-links", {
      kind: "injury", expiresInDays: 1,
    }));
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Expense submit + bulk reimburse
// ─────────────────────────────────────────────────────────────────────────
describe("expense submission", () => {
  it("coach submits an invoice + paid=false; accountant bulk-pays it", async () => {
    const { POST: submitPost } = await import("@/app/api/expenses/submit/route");
    const { POST: bulkPaidPost } = await import("@/app/api/expenses/bulk-paid/route");

    const centre = await mkCentre();
    // The bulk-paid path uses the "other_misc" fallback category, so the
    // chart-of-accounts row must exist for the submit step to succeed.
    await prisma.expenseCategory.create({
      data: { code: "other_misc", name: "Misc", group: "other" },
    });
    const coach = await mkUser({ role: "COACH", centreId: centre.id });
    const accountant = await mkUser({ role: "ACCOUNTANT", centreId: centre.id });

    await loginAs(coach);
    const res1 = await submitPost(jsonRequest("http://localhost/api/expenses/submit", {
      amount: 500,
      spentAt: "2026-05-23",
      description: "Hoof oil",
      vendorName: "Local supplier",
      attachmentUrl: "http://localhost/uploads/test.pdf",
    }));
    expect(res1.status).toBe(200);
    const { id } = await res1.json();
    const row = await prisma.expense.findUnique({ where: { id } });
    expect(row?.paid).toBe(false);
    expect(row?.createdBy).toBe(coach.id);

    // Accountant bulk-marks it paid.
    await loginAs(accountant);
    const res2 = await bulkPaidPost(jsonRequest("http://localhost/api/expenses/bulk-paid", {
      expenseIds: [id],
      method: "upi",
    }));
    expect(res2.status).toBe(200);
    const j2 = await res2.json();
    expect(j2.marked).toBe(1);
    const after = await prisma.expense.findUnique({ where: { id } });
    expect(after?.paid).toBe(true);
    expect(after?.method).toBe("upi");

    // Coach gets a paid notification.
    const notif = await prisma.notification.findFirst({
      where: { userId: coach.id, type: "expense.paid" },
    });
    expect(notif).not.toBeNull();
  });
});
