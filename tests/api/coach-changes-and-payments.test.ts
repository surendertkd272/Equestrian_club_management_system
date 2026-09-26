// Two requests from the owner, tested together because both are about money
// and records ending up where the club thinks they are.
//
//   1. A family pays ₹5,000 against a ₹3,000 invoice. That used to be refused
//      outright ("must be ≤ 3000"). Now ₹3,000 settles the invoice and ₹2,000
//      is kept as an advance on the rider's account — never an over-paid
//      invoice.
//
//   2. Coaches don't change stock or horse records on their own say-so. Their
//      edit becomes an approval request carrying the change; a manager
//      approving it is what writes it. These tests are mostly about what does
//      NOT happen: the stock row that isn't touched, the approval that can't
//      be given by the wrong person, the change that isn't applied twice.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkUser, mkRider, mkCentreWithManager } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { signSession, type SessionPayload } from "@/lib/auth";
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

const { POST: recordPayment } = await import("@/app/api/payments/manual/route");
const { PATCH: patchStock } = await import("@/app/api/equipment/stock/[catalogId]/route");
const { POST: createHorse } = await import("@/app/api/horses/route");
const { PATCH: patchHorse } = await import("@/app/api/horses/[id]/route");
const { POST: review } = await import("@/app/api/approvals/[id]/review/route");

async function loginAs(u: { id: string; role: Role; centreId: string | null; name: string }) {
  const payload: SessionPayload = { userId: u.id, role: u.role, centreId: u.centreId, name: u.name };
  cookieJar.clear();
  cookieJar.set("ew_session", { value: await signSession(payload) });
}

async function enableApprovals(centreId: string) {
  const c = await prisma.centre.findUniqueOrThrow({ where: { id: centreId } });
  await prisma.orgFeature.upsert({
    where: { orgId_featureKey: { orgId: c.orgId, featureKey: "approvals" } },
    create: { orgId: c.orgId, featureKey: "approvals", enabled: true },
    update: { enabled: true },
  });
}

const json = (body: unknown, method = "POST") =>
  mockReq("http://localhost", { method, body: JSON.stringify(body) });

beforeEach(async () => {
  await resetDb();
  cookieJar.clear();
});

describe("recording more than the invoice", () => {
  async function setup() {
    const { centre, manager } = await mkCentreWithManager();
    const rider = await mkRider({ centreId: centre.id });
    const invoice = await prisma.invoice.create({
      data: {
        centreId: centre.id,
        riderId: rider.id,
        amount: 3000,
        kind: "registration",
        dueDate: new Date(),
      },
    });
    await loginAs({ id: manager.id, role: "CENTRE_MANAGER", centreId: centre.id, name: manager.name });
    return { centre, rider, invoice };
  }

  it("settles the invoice and keeps the rest as an advance", async () => {
    const { rider, invoice } = await setup();
    const r = await recordPayment(
      json({ invoiceId: invoice.id, amount: 5000, method: "upi", txnRef: "626950923335", excessAsAdvance: true }),
    );
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.invoiceStatus).toBe("paid");
    expect(body.advanceAmount).toBe(2000);

    const pays = await prisma.payment.findMany({ where: { riderId: rider.id }, orderBy: { amount: "desc" } });
    expect(pays).toHaveLength(2);
    // The invoice is paid exactly, never over.
    expect(pays.find((p) => p.invoiceId === invoice.id)!.amount).toBe(3000);
    const adv = pays.find((p) => p.invoiceId === null)!;
    expect(adv.amount).toBe(2000);
    expect(adv.method).toBe("upi");
    // txnRef is UNIQUE (duplicate-recording guard), so the reference stays on
    // the invoice half and the advance names it — this is the exact ref from
    // the owner's screenshot, which crashed the first version of this.
    expect(pays.find((p) => p.invoiceId === invoice.id)!.txnRef).toBe("626950923335");
    expect(adv.txnRef).toBeNull();
    expect(adv.reason).toContain("626950923335");
  });

  it("the same UPI reference still can't be recorded twice", async () => {
    const { invoice } = await setup();
    const second = await prisma.invoice.create({
      data: { centreId: invoice.centreId, riderId: invoice.riderId, amount: 1000, kind: "monthly", dueDate: new Date() },
    });
    await recordPayment(json({ invoiceId: invoice.id, amount: 5000, method: "upi", txnRef: "UPI-1", excessAsAdvance: true }));
    const r = await recordPayment(json({ invoiceId: second.id, amount: 1000, method: "upi", txnRef: "UPI-1" }));
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("DUPLICATE_REF");
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: second.id } })).status).toBe("due");
  });

  it("still refuses an overpayment nobody opted into — a typo must not become an advance", async () => {
    const { invoice } = await setup();
    const r = await recordPayment(json({ invoiceId: invoice.id, amount: 30000, method: "cash" }));
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("OVERPAY");
    expect(await prisma.payment.count()).toBe(0);
  });

  it("a payment within the invoice is unchanged", async () => {
    const { invoice } = await setup();
    const r = await recordPayment(json({ invoiceId: invoice.id, amount: 1000, method: "cash", excessAsAdvance: true }));
    expect(r.status).toBe(200);
    expect((await r.json()).advanceAmount).toBe(0);
    expect(await prisma.payment.count()).toBe(1);
  });
});

describe("a coach's stock change needs a manager", () => {
  async function setup() {
    const { centre, manager } = await mkCentreWithManager();
    await enableApprovals(centre.id);
    const coach = await mkUser({ role: "COACH", centreId: centre.id });
    const catalog = await prisma.equipmentCatalog.create({
      data: { category: "saddlery", name: "Saddle pads", code: `SP-${Date.now()}` },
    });
    await prisma.equipmentStock.create({
      data: { centreId: centre.id, catalogId: catalog.id, qty: 10, qtyUnused: 10 },
    });
    return { centre, manager, coach, catalog };
  }
  const qtyOf = async (centreId: string, catalogId: string) =>
    (await prisma.equipmentStock.findUniqueOrThrow({ where: { centreId_catalogId: { centreId, catalogId } } })).qty;

  it("is held as a request and changes nothing", async () => {
    const { centre, coach, catalog } = await setup();
    await loginAs({ id: coach.id, role: "COACH", centreId: centre.id, name: coach.name });

    const r = await patchStock(json({ qty: 4, reason: "consumed" }, "PATCH"), { params: { catalogId: catalog.id } });
    expect(r.status).toBe(202);
    expect((await r.json()).pending).toBe(true);

    expect(await qtyOf(centre.id, catalog.id)).toBe(10);
    const req = await prisma.approvalRequest.findFirstOrThrow();
    expect(req.entityType).toBe("equipment_stock_change");
    expect(req.status).toBe("pending");
    expect(req.body).toContain("Saddle pads");
  });

  it("is applied when a manager approves it — once", async () => {
    const { centre, manager, coach, catalog } = await setup();
    await loginAs({ id: coach.id, role: "COACH", centreId: centre.id, name: coach.name });
    await patchStock(json({ qty: 4, reason: "consumed" }, "PATCH"), { params: { catalogId: catalog.id } });
    const req = await prisma.approvalRequest.findFirstOrThrow();

    await loginAs({ id: manager.id, role: "CENTRE_MANAGER", centreId: centre.id, name: manager.name });
    const ok = await review(json({ decision: "approved" }), { params: { id: req.id } });
    expect(ok.status).toBe(200);
    expect(await qtyOf(centre.id, catalog.id)).toBe(4);
    expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: req.id } })).appliedAt).not.toBeNull();
    // The movement is attributed to the coach who asked for it.
    const mv = await prisma.equipmentStockMovement.findFirstOrThrow();
    expect(mv.actorId).toBe(coach.id);

    // A second approve — a double-click, a second manager — must not apply it again.
    const again = await review(json({ decision: "approved" }), { params: { id: req.id } });
    expect(again.status).toBe(409);
    expect(await prisma.equipmentStockMovement.count()).toBe(1);
  });

  it("is not applied when rejected", async () => {
    const { centre, manager, coach, catalog } = await setup();
    await loginAs({ id: coach.id, role: "COACH", centreId: centre.id, name: coach.name });
    await patchStock(json({ qty: 4 }, "PATCH"), { params: { catalogId: catalog.id } });
    const req = await prisma.approvalRequest.findFirstOrThrow();

    await loginAs({ id: manager.id, role: "CENTRE_MANAGER", centreId: centre.id, name: manager.name });
    const r = await review(json({ decision: "rejected", reviewNotes: "Count again" }), { params: { id: req.id } });
    expect(r.status).toBe(200);
    expect(await qtyOf(centre.id, catalog.id)).toBe(10);
  });

  it("cannot be approved by a head coach — one coach signing off another's change is no control", async () => {
    const { centre, coach, catalog } = await setup();
    await loginAs({ id: coach.id, role: "COACH", centreId: centre.id, name: coach.name });
    await patchStock(json({ qty: 4 }, "PATCH"), { params: { catalogId: catalog.id } });
    const req = await prisma.approvalRequest.findFirstOrThrow();

    const hc = await mkUser({ role: "HEAD_COACH", centreId: centre.id });
    await loginAs({ id: hc.id, role: "HEAD_COACH", centreId: centre.id, name: hc.name });
    const r = await review(json({ decision: "approved" }), { params: { id: req.id } });
    expect(r.status).toBe(403);
    expect(await qtyOf(centre.id, catalog.id)).toBe(10);
  });

  it("a manager's own stock edit still saves directly", async () => {
    const { centre, manager, catalog } = await setup();
    await loginAs({ id: manager.id, role: "CENTRE_MANAGER", centreId: centre.id, name: manager.name });
    const r = await patchStock(json({ qty: 7 }, "PATCH"), { params: { catalogId: catalog.id } });
    expect(r.status).toBe(200);
    expect(await qtyOf(centre.id, catalog.id)).toBe(7);
    expect(await prisma.approvalRequest.count()).toBe(0);
  });
});

describe("a head coach's horse changes need a manager", () => {
  async function setup() {
    const { centre, manager } = await mkCentreWithManager();
    await enableApprovals(centre.id);
    await prisma.orgFeature.upsert({
      where: { orgId_featureKey: { orgId: centre.orgId, featureKey: "horse-management" } },
      create: { orgId: centre.orgId, featureKey: "horse-management", enabled: true },
      update: { enabled: true },
    });
    const hc = await mkUser({ role: "HEAD_COACH", centreId: centre.id });
    const horse = await prisma.horse.create({
      data: { centreId: centre.id, name: "Blaze", stableNo: "A1", status: "active" },
    });
    return { centre, manager, hc, horse };
  }

  it("an edit is held, then applied on approval", async () => {
    const { centre, manager, hc, horse } = await setup();
    await loginAs({ id: hc.id, role: "HEAD_COACH", centreId: centre.id, name: hc.name });
    const r = await patchHorse(json({ status: "retired", stableNo: "B2" }, "PATCH"), { params: { id: horse.id } });
    expect(r.status).toBe(202);
    expect((await prisma.horse.findUniqueOrThrow({ where: { id: horse.id } })).status).toBe("active");
    const req = await prisma.approvalRequest.findFirstOrThrow();
    expect(req.body).toContain("status active → retired");

    await loginAs({ id: manager.id, role: "CENTRE_MANAGER", centreId: centre.id, name: manager.name });
    expect((await review(json({ decision: "approved" }), { params: { id: req.id } })).status).toBe(200);
    const after = await prisma.horse.findUniqueOrThrow({ where: { id: horse.id } });
    expect(after.status).toBe("retired");
    expect(after.stableNo).toBe("B2");
  });

  it("a new horse only exists once approved", async () => {
    const { centre, manager, hc } = await setup();
    await loginAs({ id: hc.id, role: "HEAD_COACH", centreId: centre.id, name: hc.name });
    const r = await createHorse(json({ name: "Sultan", identificationMarks: "Star on forehead" }));
    expect(r.status).toBe(202);
    expect(await prisma.horse.count({ where: { name: "Sultan" } })).toBe(0);

    const req = await prisma.approvalRequest.findFirstOrThrow();
    await loginAs({ id: manager.id, role: "CENTRE_MANAGER", centreId: centre.id, name: manager.name });
    expect((await review(json({ decision: "approved" }), { params: { id: req.id } })).status).toBe(200);
    const h = await prisma.horse.findFirstOrThrow({ where: { name: "Sultan" } });
    expect(h.identificationMarks).toBe("Star on forehead");
    expect(h.centreId).toBe(centre.id);
  });

  it("nobody approves their own change, whatever their role", async () => {
    // A manager raises nothing through this flow, so construct the case
    // directly: a pending change whose requester is the would-be approver.
    const { centre, manager, horse } = await setup();
    const req = await prisma.approvalRequest.create({
      data: {
        centreId: centre.id,
        entityType: "horse_update",
        entityId: horse.id,
        title: "Horse change: Blaze",
        requestedBy: manager.id,
        payloadJson: { data: { status: "rest" } },
      },
    });
    await loginAs({ id: manager.id, role: "CENTRE_MANAGER", centreId: centre.id, name: manager.name });
    const r = await review(json({ decision: "approved" }), { params: { id: req.id } });
    expect(r.status).toBe(403);
    expect((await prisma.horse.findUniqueOrThrow({ where: { id: horse.id } })).status).toBe("active");
  });
});
