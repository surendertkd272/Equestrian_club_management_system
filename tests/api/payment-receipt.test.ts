// Recording fees that settle no invoice.
//
// The client's objection, verbatim: "koi ₹1000 fees pay karta hai, koi ₹2 lakh
// ... main apne dashboard pe kaise dekhunga ki is mahine mere paas itna
// revenue aaya hai?" He was right, and the answer was that he could not.
// Payment.invoiceId was required and invoices are only created by the billing
// flow, so a club with rider billing off could record nothing at all and its
// revenue read zero forever — while the feature description claimed staff
// bookkeeping was unaffected.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkOrg, mkCentre, mkRider, mkUser } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { mockReq } from "../helpers/request";
import { signSession } from "@/lib/auth";

const cookieJar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (n: string) => cookieJar.get(n),
    set: (n: string, value: string) => cookieJar.set(n, { value }),
    delete: (n: string) => cookieJar.delete(n),
  }),
}));

const { POST: receipt } = await import("@/app/api/payments/receipt/route");

let org: Awaited<ReturnType<typeof mkOrg>>;
let centre: Awaited<ReturnType<typeof mkCentre>>;
let hq: Awaited<ReturnType<typeof mkUser>>;
let rider: Awaited<ReturnType<typeof mkRider>>;

async function signIn(u: { id: string; role: string; centreId: string | null; orgId?: string | null }) {
  cookieJar.clear();
  cookieJar.set("ew_session", {
    value: await signSession({
      userId: u.id, role: u.role as never, centreId: u.centreId,
      orgId: u.orgId ?? null, tokenVersion: 0, name: "T",
    } as never),
  });
}

const call = (body: unknown) =>
  receipt(mockReq("http://localhost/api/payments/receipt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));

beforeEach(async () => {
  await resetDb();
  cookieJar.clear();
  org = await mkOrg("Receipt Club");
  centre = await mkCentre({ orgId: org.id, name: "Receipt Centre" });
  hq = await mkUser({ role: "SUPER_ADMIN", centreId: null, orgId: org.id, email: "hq@r.in" });
  rider = await mkRider({ centreId: centre.id });
});

describe("recording a receipt", () => {
  it("accepts any amount, with no invoice behind it", async () => {
    await signIn(hq);
    // The exact spread the client described.
    for (const amount of [1000, 100000, 200000]) {
      const res = await call({ riderId: rider.id, amount, method: "cash" });
      expect(res.status).toBe(200);
    }
    const rows = await prisma.payment.findMany();
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.invoiceId === null)).toBe(true);
    // Carries its own centre, which is what makes it countable.
    expect(rows.every((r) => r.centreId === centre.id)).toBe(true);
  });

  it("shows up in this month's revenue", async () => {
    await signIn(hq);
    await call({ riderId: rider.id, amount: 200000, method: "bank" });

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const agg = await prisma.payment.aggregate({
      where: { centreId: centre.id, paidAt: { gte: monthStart } },
      _sum: { amount: true },
    });
    // The whole point. Scoped through the invoice this was zero.
    expect(agg._sum.amount).toBe(200000);
  });

  it("does not count a cheque as cleared on the day it was written", async () => {
    await signIn(hq);
    await call({ riderId: rider.id, amount: 5000, method: "cheque" });
    const row = await prisma.payment.findFirstOrThrow();
    // A bounced cheque counted as cleared quietly overstates a month.
    expect(row.clearedAt).toBeNull();
  });

  it("takes the centre from the RIDER, not the caller", async () => {
    // A centreId from the client would let a receipt be filed against a club
    // the caller cannot see.
    await signIn(hq);
    await call({ riderId: rider.id, amount: 1000, method: "cash", centreId: "someone-elses" });
    const row = await prisma.payment.findFirstOrThrow();
    expect(row.centreId).toBe(centre.id);
  });

  it("refuses a rider from another tenant", async () => {
    const other = await mkOrg("Rival Receipt");
    const oc = await mkCentre({ orgId: other.id, name: "Rival Centre" });
    const victim = await mkRider({ centreId: oc.id });
    await signIn(hq);
    expect((await call({ riderId: victim.id, amount: 1000, method: "cash" })).status).toBe(404);
    expect(await prisma.payment.count()).toBe(0);
  });

  it("pins a centre manager to their own centre's riders", async () => {
    const other = await mkCentre({ orgId: org.id, name: "Other Centre" });
    const elsewhere = await mkRider({ centreId: other.id });
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id, email: "m@r.in" });
    await signIn({ id: mgr.id, role: "CENTRE_MANAGER", centreId: centre.id, orgId: org.id });
    expect((await call({ riderId: elsewhere.id, amount: 1000, method: "cash" })).status).toBe(404);
  });

  it("refuses a coach", async () => {
    const coach = await mkUser({ role: "COACH", centreId: centre.id, email: "c@r.in" });
    await signIn({ id: coach.id, role: "COACH", centreId: centre.id, orgId: org.id });
    expect((await call({ riderId: rider.id, amount: 1000, method: "cash" })).status).toBe(403);
  });

  it("rejects a zero or negative amount", async () => {
    await signIn(hq);
    expect((await call({ riderId: rider.id, amount: 0, method: "cash" })).status).toBe(400);
    // Negatives are reversals, which have their own endpoint and audit trail.
    expect((await call({ riderId: rider.id, amount: -5000, method: "cash" })).status).toBe(400);
  });

  it("attaches proof of the money arriving", async () => {
    await signIn(hq);
    const res = await call({
      riderId: rider.id, amount: 150000, method: "upi",
      proofUrl: "/uploads/upi-screenshot-abc123.png",
    });
    expect(res.status).toBe(200);
    const row = await prisma.payment.findFirstOrThrow();
    // For a club collecting privately this is the ONLY evidence the payment
    // happened — there is no gateway record behind the figure.
    expect(row.proofUrl).toBe("/uploads/upi-screenshot-abc123.png");
  });

  it("refuses an external link as proof", async () => {
    await signIn(hq);
    // Pointing the club's own records at a host somebody else controls means
    // the evidence can be swapped or removed after the fact.
    const res = await call({
      riderId: rider.id, amount: 1000, method: "upi",
      proofUrl: "https://evil.example.com/fake-receipt.png",
    });
    expect(res.status).toBe(400);
    expect(await prisma.payment.count()).toBe(0);
  });

  it("records fine with no proof — it is optional", async () => {
    await signIn(hq);
    expect((await call({ riderId: rider.id, amount: 1000, method: "cash" })).status).toBe(200);
    expect((await prisma.payment.findFirstOrThrow()).proofUrl).toBeNull();
  });

  it("works with fee-collection switched OFF", async () => {
    // The clubs this exists for are exactly the ones with billing off.
    await prisma.orgFeature.updateMany({
      where: { orgId: org.id, featureKey: "fee-collection" },
      data: { enabled: false },
    });
    await signIn(hq);
    expect((await call({ riderId: rider.id, amount: 150000, method: "upi" })).status).toBe(200);
  });
});
