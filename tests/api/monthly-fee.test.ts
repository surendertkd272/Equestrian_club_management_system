// A rider's monthly fee, recorded for the club's own books — usually by the
// coach who collected it. The owner's complaint: ₹5,000 paid against a ₹3,000
// registration invoice was filed as a ₹2,000 "advance", when the ₹2,000 was the
// month's fee. A fee now says which month it is for, coaches can record one
// (and nothing else with money), and an existing advance can be relabelled.

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
const { POST: recordReceipt } = await import("@/app/api/payments/receipt/route");
const { POST: setFeeMonth } = await import("@/app/api/payments/[id]/fee-month/route");
const { PATCH: editFee, DELETE: deleteFee } = await import("@/app/api/payments/[id]/route");

async function loginAs(u: { id: string; role: string; centreId: string | null; name: string }) {
  const payload: SessionPayload = { userId: u.id, role: u.role as Role, centreId: u.centreId, name: u.name };
  cookieJar.clear();
  cookieJar.set("ew_session", { value: await signSession(payload) });
}
const json = (body: unknown) => mockReq("http://localhost", { method: "POST", body: JSON.stringify(body) });

async function setup() {
  const { centre, manager } = await mkCentreWithManager();
  const coach = await mkUser({ role: "COACH", centreId: centre.id, name: "Ritu Coach" });
  const groom = await mkUser({ role: "GROOM", centreId: centre.id });
  const rider = await mkRider({ centreId: centre.id });
  const other = await mkCentreWithManager({ name: "Other Club" });
  const otherRider = await mkRider({ centreId: other.centre.id });
  const invoice = await prisma.invoice.create({
    data: { centreId: centre.id, riderId: rider.id, amount: 3000, kind: "registration", dueDate: new Date() },
  });
  return { centre, manager, coach, groom, rider, other, otherRider, invoice };
}

beforeEach(async () => {
  await resetDb();
  cookieJar.clear();
});

describe("paying the registration and the month together", () => {
  it("files the extra as that month's fee, not an advance", async () => {
    const f = await setup();
    await loginAs(f.manager);
    const r = await recordPayment(
      json({ invoiceId: f.invoice.id, amount: 5000, method: "upi", excessAsAdvance: true, excessFeeMonth: "2026-09" }),
    );
    expect(r.status).toBe(200);
    expect((await r.json()).excessFeeMonth).toBe("2026-09");
    const extra = await prisma.payment.findFirstOrThrow({ where: { riderId: f.rider.id, invoiceId: null } });
    expect(extra.amount).toBe(2000);
    expect(extra.feeMonth).toBe("2026-09");
    expect(extra.reason).toMatch(/^Monthly fee — Sep 2026/);
    expect(extra.recordedByUserId).toBe(f.manager.id);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: f.invoice.id } })).status).toBe("paid");
  });

  it("no longer creates an advance: extra money with no month is refused", async () => {
    const f = await setup();
    await loginAs(f.manager);
    const r = await recordPayment(json({ invoiceId: f.invoice.id, amount: 5000, method: "cash", excessAsAdvance: true }));
    expect(r.status).toBe(409);
    expect(await prisma.payment.count()).toBe(0);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: f.invoice.id } })).status).toBe("due");
  });
});

describe("a coach recording a monthly fee", () => {
  it("records it, with no cap, the month, and who recorded it", async () => {
    const f = await setup();
    await loginAs(f.coach);
    const r = await recordReceipt(json({ riderId: f.rider.id, amount: 7500, method: "cash", feeMonth: "2026-09" }));
    expect(r.status).toBe(200);
    const p = await prisma.payment.findFirstOrThrow({ where: { riderId: f.rider.id } });
    expect(p).toMatchObject({ amount: 7500, feeMonth: "2026-09", invoiceId: null, recordedByUserId: f.coach.id });
    expect(p.reason).toBe("Monthly fee — Sep 2026");
  });

  it("Super Admin, Admin and Centre Manager can record one too", async () => {
    const f = await setup();
    const org = (await prisma.centre.findUniqueOrThrow({ where: { id: f.centre.id } })).orgId;
    // HQ roles have no centre of their own: the recurring bug class here.
    const superAdmin = await mkUser({ role: "SUPER_ADMIN", centreId: null, orgId: org });
    const admin = await mkUser({ role: "ADMIN", centreId: null, orgId: org });
    for (const [u, amt] of [[superAdmin, 1100], [admin, 1200], [f.manager, 1300]] as const) {
      await loginAs(u);
      const r = await recordReceipt(json({ riderId: f.rider.id, amount: amt, method: "upi", feeMonth: "2026-09" }));
      expect(r.status, u.role).toBe(200);
      const p = await prisma.payment.findFirstOrThrow({ where: { amount: amt } });
      expect(p).toMatchObject({ feeMonth: "2026-09", recordedByUserId: u.id, centreId: f.centre.id });
    }
  });

  it("cannot record money that is not a monthly fee", async () => {
    const f = await setup();
    await loginAs(f.coach);
    const r = await recordReceipt(json({ riderId: f.rider.id, amount: 1000, method: "cash" }));
    expect(r.status).toBe(403);
    expect(await prisma.payment.count()).toBe(0);
  });

  it("cannot record a fee for another club's rider", async () => {
    const f = await setup();
    await loginAs(f.coach);
    const r = await recordReceipt(json({ riderId: f.otherRider.id, amount: 1000, method: "cash", feeMonth: "2026-09" }));
    expect(r.status).toBe(404);
    expect(await prisma.payment.count()).toBe(0);
  });

  it("is a coach's power only — a groom cannot", async () => {
    const f = await setup();
    await loginAs(f.groom);
    const r = await recordReceipt(json({ riderId: f.rider.id, amount: 1000, method: "cash", feeMonth: "2026-09" }));
    expect(r.status).toBe(403);
  });

  it("rejects a malformed month", async () => {
    const f = await setup();
    await loginAs(f.coach);
    const r = await recordReceipt(json({ riderId: f.rider.id, amount: 1000, method: "cash", feeMonth: "2026-13" }));
    expect(r.status).toBe(400);
  });
});

describe("marking an existing advance as a monthly fee", () => {
  // An advance recorded before advances were removed: the legacy row a
  // club may still have (the owner's own ₹2,000).
  async function withAdvance() {
    const f = await setup();
    await loginAs(f.manager);
    await recordPayment(json({ invoiceId: f.invoice.id, amount: 3000, method: "cash", txnRef: "UPI123" }));
    const adv = await prisma.payment.create({
      data: {
        invoiceId: null,
        centreId: f.centre.id,
        riderId: f.rider.id,
        amount: 2000,
        method: "cash",
        reason: "Advance — paid ₹5000.00 against a ₹3000.00 registration invoice · ref UPI123",
      },
    });
    return { ...f, adv };
  }
  const call = (id: string, feeMonth: string) =>
    setFeeMonth(json({ feeMonth }), { params: { id } });

  it("relabels it, keeping the amount and the bank reference", async () => {
    const f = await withAdvance();
    const r = await call(f.adv.id, "2026-09");
    expect(r.status).toBe(200);
    const after = await prisma.payment.findUniqueOrThrow({ where: { id: f.adv.id } });
    expect(after.amount).toBe(2000);
    expect(after.feeMonth).toBe("2026-09");
    expect(after.reason).toMatch(/^Monthly fee — Sep 2026 · paid ₹5000\.00 against a ₹3000\.00 registration invoice · ref UPI123$/);
  });

  it("can move a fee to a different month without stacking labels", async () => {
    const f = await withAdvance();
    await call(f.adv.id, "2026-09");
    await call(f.adv.id, "2026-10");
    const after = await prisma.payment.findUniqueOrThrow({ where: { id: f.adv.id } });
    expect(after.feeMonth).toBe("2026-10");
    expect(after.reason).toMatch(/^Monthly fee — Oct 2026 · paid ₹5000/);
    expect(after.reason).not.toContain("Sep 2026");
  });

  it("refuses an invoice payment — it already says what it was for", async () => {
    const f = await withAdvance();
    const inv = await prisma.payment.findFirstOrThrow({ where: { invoiceId: f.invoice.id } });
    expect((await call(inv.id, "2026-09")).status).toBe(409);
  });

  it("is not something a coach can do, nor another club's manager", async () => {
    const f = await withAdvance();
    await loginAs(f.coach);
    expect((await call(f.adv.id, "2026-09")).status).toBe(403);
    await loginAs(f.other.manager);
    expect((await call(f.adv.id, "2026-09")).status).toBe(403);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: f.adv.id } })).feeMonth).toBeNull();
  });
});

describe("editing and deleting a recorded fee", () => {
  async function withFee() {
    const f = await setup();
    await loginAs(f.coach);
    await recordReceipt(json({ riderId: f.rider.id, amount: 4000, method: "cash", feeMonth: "2026-09", note: "paid by father" }));
    const fee = await prisma.payment.findFirstOrThrow({ where: { riderId: f.rider.id } });
    await loginAs(f.manager);
    return { ...f, fee };
  }
  const edit = (id: string, body: unknown) =>
    editFee(mockReq("http://localhost", { method: "PATCH", body: JSON.stringify(body) }), { params: { id } });
  const del = (id: string) => deleteFee(mockReq("http://localhost", { method: "DELETE" }), { params: { id } });
  const good = { amount: 3500, feeMonth: "2026-10", method: "upi", paidAt: "2026-10-02", note: "fee revised" };

  it("a manager can change the amount, month, method, date and note — and it is audited", async () => {
    const f = await withFee();
    const r = await edit(f.fee.id, good);
    expect(r.status).toBe(200);
    const after = await prisma.payment.findUniqueOrThrow({ where: { id: f.fee.id } });
    expect(after).toMatchObject({ amount: 3500, feeMonth: "2026-10", method: "upi", reason: "Monthly fee — Oct 2026 · fee revised" });
    expect(after.paidAt.toISOString().slice(0, 10)).toBe("2026-10-02");
    // Who recorded it originally is kept; the edit is attributed in the log.
    expect(after.recordedByUserId).toBe(f.coach.id);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "payment.fee_edited", rowId: f.fee.id } });
    expect(log.userId).toBe(f.manager.id);
    expect(JSON.stringify(log.before)).toContain("4000");
  });

  it("a manager can delete it; the audit log keeps the whole row", async () => {
    const f = await withFee();
    const r = await del(f.fee.id);
    expect(r.status).toBe(200);
    expect(await prisma.payment.findUnique({ where: { id: f.fee.id } })).toBeNull();
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "payment.fee_deleted", rowId: f.fee.id } });
    expect(JSON.stringify(log.before)).toContain("paid by father");
  });

  it("a coach can record a fee but not change or delete one", async () => {
    const f = await withFee();
    await loginAs(f.coach);
    expect((await edit(f.fee.id, good)).status).toBe(403);
    expect((await del(f.fee.id)).status).toBe(403);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: f.fee.id } })).amount).toBe(4000);
  });

  it("another club's manager can't touch it", async () => {
    const f = await withFee();
    await loginAs(f.other.manager);
    expect((await edit(f.fee.id, good)).status).toBe(403);
    expect((await del(f.fee.id)).status).toBe(403);
  });

  it("an invoice payment is not editable or deletable — it keeps Reverse", async () => {
    const f = await withFee();
    await recordPayment(json({ invoiceId: f.invoice.id, amount: 3000, method: "cash" }));
    const invPay = await prisma.payment.findFirstOrThrow({ where: { invoiceId: f.invoice.id } });
    expect((await edit(invPay.id, good)).status).toBe(409);
    expect((await del(invPay.id)).status).toBe(409);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: f.invoice.id } })).status).toBe("paid");
  });

  it("a reversed fee can't be edited or deleted — that would orphan its reversal", async () => {
    const f = await withFee();
    await prisma.payment.create({
      data: { centreId: f.centre.id, riderId: f.rider.id, amount: -4000, method: "cash", reversalOfId: f.fee.id },
    });
    expect((await edit(f.fee.id, good)).status).toBe(409);
    expect((await del(f.fee.id)).status).toBe(409);
  });

  it("rejects a bad edit", async () => {
    const f = await withFee();
    expect((await edit(f.fee.id, { ...good, amount: 0 })).status).toBe(400);
    expect((await edit(f.fee.id, { ...good, feeMonth: "Oct" })).status).toBe(400);
  });
});
