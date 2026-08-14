// Monthly SaaS invoicing.
//
// This is money and it is a tax document, so the tests are about the two
// properties that matter: a customer is never billed twice for the same
// period, and only an owner-admin can declare revenue received.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkOrg } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { signOwnerSession, hashOwnerPassword } from "@/lib/owner-auth";
import { sweepSaasBillingRun } from "@/lib/sweeps/saas-billing-run";
import { mockReq } from "../helpers/request";

const cookieJar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (n: string) => cookieJar.get(n),
    set: (n: string, value: string) => cookieJar.set(n, { value }),
    delete: (n: string) => cookieJar.delete(n),
  }),
}));

const { PATCH: settle } = await import("@/app/api/owner/saas-invoices/[id]/route");

async function seedPricing() {
  await prisma.platformPricing.createMany({
    data: [
      { key: "starter", label: "Starter", monthlyInr: 2999, sortOrder: 1 },
      { key: "pro", label: "Pro", monthlyInr: 5999, sortOrder: 2 },
    ],
    skipDuplicates: true,
  });
  await prisma.platformBillingConfig.upsert({
    where: { id: "default" },
    create: { id: "default", invoicePrefix: "EW", defaultTaxBps: 1800 },
    update: {},
  });
}

async function signInOwner(role: "OWNER_ADMIN" | "OWNER_EDITOR" = "OWNER_ADMIN") {
  const owner = await prisma.platformUser.create({
    data: {
      email: `${role.toLowerCase()}@platform.local`,
      name: "Owner",
      role,
      passwordHash: await hashOwnerPassword("GoodPass1!"),
      status: "active",
    },
  });
  cookieJar.clear();
  cookieJar.set("ew_owner_session", {
    value: await signOwnerSession({ ownerId: owner.id, role, name: "Owner", tokenVersion: 0 }),
  });
  return owner;
}

const patch = (id: string, body: unknown) =>
  settle(
    mockReq(`http://localhost/api/owner/saas-invoices/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: { id } },
  );

beforeEach(async () => {
  await resetDb();
  cookieJar.clear();
  await seedPricing();
});

describe("monthly billing run", () => {
  it("issues one invoice per billable org, with GST", async () => {
    const org = await mkOrg("Silverline");
    await prisma.organisation.update({ where: { id: org.id }, data: { status: "active", plan: "starter" } });

    const res = await sweepSaasBillingRun({ force: true });
    expect(res.scanned).toBe(1);

    const inv = await prisma.saasInvoice.findFirstOrThrow({ where: { orgId: org.id } });
    expect(inv.subtotal).toBe(2999);
    expect(inv.taxBps).toBe(1800);
    expect(inv.taxAmount).toBe(540); // 18% of 2999, rounded
    expect(inv.total).toBe(3539);
    expect(inv.status).toBe("due");
    expect(inv.number).toMatch(/^EW-\d{4}-\d{6}$/);
  });

  it("never bills the same period twice, however many times it runs", async () => {
    const org = await mkOrg("Repeat Club");
    await prisma.organisation.update({ where: { id: org.id }, data: { status: "active", plan: "pro" } });

    await sweepSaasBillingRun({ force: true });
    await sweepSaasBillingRun({ force: true });
    const second = await sweepSaasBillingRun({ force: true });

    expect(await prisma.saasInvoice.count({ where: { orgId: org.id } })).toBe(1);
    // The re-runs are reported as skipped, not as failures — the unique index
    // doing its job is the expected path, not an error.
    expect(second.skipped).toBe(1);
  });

  it("bills past_due orgs but never trials or suspended ones", async () => {
    for (const [name, status] of [
      ["Live", "active"],
      ["Owing", "past_due"],
      ["Trialling", "trial"],
      ["Frozen", "suspended"],
    ] as const) {
      const o = await mkOrg(name);
      await prisma.organisation.update({ where: { id: o.id }, data: { status, plan: "starter" } });
    }
    await sweepSaasBillingRun({ force: true });

    const billed = await prisma.saasInvoice.findMany({ include: { org: true } });
    expect(billed.map((i) => i.org.name).sort()).toEqual(["Live", "Owing"]);
  });

  it("skips a plan with no configured price rather than issuing ₹0", async () => {
    const org = await mkOrg("Mystery Plan");
    await prisma.organisation.update({
      where: { id: org.id },
      data: { status: "active", plan: "enterprise" }, // not seeded above
    });
    const res = await sweepSaasBillingRun({ force: true });
    expect(res.skipped).toBe(1);
    expect(await prisma.saasInvoice.count()).toBe(0);
  });

  it("does nothing on a day that isn't the 1st unless forced", async () => {
    const org = await mkOrg("Timing");
    await prisma.organisation.update({ where: { id: org.id }, data: { status: "active", plan: "starter" } });
    const res = await sweepSaasBillingRun();
    if (new Date().getDate() !== 1) {
      expect(res.scanned).toBe(0);
      expect(await prisma.saasInvoice.count()).toBe(0);
    }
  });
});

describe("PATCH /api/owner/saas-invoices/[id]", () => {
  async function anInvoice() {
    const org = await mkOrg("Payer");
    await prisma.organisation.update({ where: { id: org.id }, data: { status: "active", plan: "starter" } });
    await sweepSaasBillingRun({ force: true });
    return prisma.saasInvoice.findFirstOrThrow({ where: { orgId: org.id } });
  }

  it("marks an invoice paid and stamps the reference", async () => {
    await signInOwner();
    const inv = await anInvoice();
    const r = await patch(inv.id, { status: "paid", reference: "UTR12345" });
    expect(r.status).toBe(200);

    const after = await prisma.saasInvoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(after.status).toBe("paid");
    expect(after.paidAt).not.toBeNull();
    expect(after.externalRef).toBe("UTR12345");
  });

  it("refuses a non-admin owner role — declaring revenue is admin-only", async () => {
    await signInOwner("OWNER_EDITOR");
    const inv = await anInvoice();
    expect((await patch(inv.id, { status: "paid" })).status).toBe(403);
    const after = await prisma.saasInvoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(after.status).toBe("due");
  });

  it("refuses an unauthenticated caller", async () => {
    const inv = await anInvoice();
    cookieJar.clear();
    expect((await patch(inv.id, { status: "paid" })).status).toBe(401);
  });

  it("won't re-decide an invoice that is already settled", async () => {
    await signInOwner();
    const inv = await anInvoice();
    await patch(inv.id, { status: "paid" });
    const again = await patch(inv.id, { status: "void" });
    expect(again.status).toBe(409);
    const after = await prisma.saasInvoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(after.status).toBe("paid");
  });
});
