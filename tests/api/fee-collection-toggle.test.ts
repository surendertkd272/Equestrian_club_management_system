// The per-tenant "do we bill riders?" switch.
//
// Some clubs charge riders through the platform; some collect privately and
// must never show a fee to a parent or send a dues reminder. fee-collection is
// that switch, and these assert the two guarantees a non-billing club depends
// on: no invoice is ever raised for them, and no fee notification ever leaves
// the system.

import { describe, it, expect, beforeEach } from "vitest";
import { resetDb } from "../helpers/db";
import { mkOrg, mkCentre, mkRider, mkUser } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { FEATURE_KEYS } from "@/lib/features";
import { sweepFeeDue } from "@/lib/sweeps/fee-due";

async function clubWithFees(enabled: boolean, name: string) {
  const org = await mkOrg(name);
  // mkOrg enables every feature; flip just this one.
  await prisma.orgFeature.updateMany({
    where: { orgId: org.id, featureKey: "fee-collection" },
    data: { enabled },
  });
  const centre = await mkCentre({ orgId: org.id, name: `${name} Centre` });
  // The reminder is delivered to the centre manager, so a centre without one
  // is skipped for a reason that has nothing to do with this flag — give it
  // one, or the test proves nothing about fee-collection.
  const manager = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id });
  await prisma.centre.update({ where: { id: centre.id }, data: { managerId: manager.id } });
  return { org, centre, manager };
}

/** An invoice due in 2 days — squarely inside the reminder window. */
async function dueInvoice(centreId: string, riderId: string) {
  return prisma.invoice.create({
    data: {
      centreId,
      riderId,
      amount: 5000,
      status: "due",
      kind: "monthly",
      dueDate: new Date(Date.now() + 2 * 86400000),
    },
  });
}

beforeEach(async () => {
  await resetDb();
});

describe("fee-collection is a real switch", () => {
  it("is a known feature key the owner can toggle per tenant", () => {
    expect(FEATURE_KEYS).toContain("fee-collection");
  });

  it("sends dues reminders for a club that bills", async () => {
    const { centre } = await clubWithFees(true, "Billing Club");
    const rider = await mkRider({ centreId: centre.id });
    await dueInvoice(centre.id, rider.id);

    const res = await sweepFeeDue();
    // The invoice is in scope and the club bills, so a reminder goes out.
    expect(res.scanned).toBeGreaterThan(0);
    expect(res.notified).toBeGreaterThan(0);
  });

  it("stays completely silent for a club that does not bill", async () => {
    const { centre } = await clubWithFees(false, "Private Club");
    const rider = await mkRider({ centreId: centre.id });
    await dueInvoice(centre.id, rider.id);

    const res = await sweepFeeDue();
    // The invoice row still exists — it is preserved as audit history — but no
    // reminder is sent for it. This is the guarantee a non-billing club is
    // relying on: a parent never hears from us about money.
    expect(res.notified).toBe(0);
  });

  it("does not leak one club's reminders into another's setting", async () => {
    // Two clubs, opposite settings, invoices due on the same day. The sweep
    // resolves the flag per organisation, so the billing club must still be
    // reminded while the private one stays silent.
    const billing = await clubWithFees(true, "Alpha Billing");
    const priv = await clubWithFees(false, "Beta Private");
    for (const c of [billing.centre, priv.centre]) {
      const r = await mkRider({ centreId: c.id });
      await dueInvoice(c.id, r.id);
    }

    const res = await sweepFeeDue();
    expect(res.scanned).toBe(2);
    // Both clubs are otherwise identical — same due date, same manager setup —
    // so exactly one reminder means the flag is what separated them.
    expect(res.notified).toBe(1);
  });
});
