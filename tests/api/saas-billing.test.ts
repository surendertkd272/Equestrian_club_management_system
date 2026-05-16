import { describe, it, expect, beforeEach } from "vitest";
import { resetDb } from "../helpers/db";
import { mkOrg } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { issueSaasInvoice } from "@/lib/saas-billing";

beforeEach(async () => {
  await resetDb();
});

describe("issueSaasInvoice", () => {
  it("computes GST + total and bumps the invoice counter atomically", async () => {
    const org = await mkOrg("Test Academy");
    await prisma.organisation.update({
      where: { id: org.id },
      data: { billingEmail: "bill@test.local", billingGstin: "29ABCDE1234F1Z5", billingState: "Karnataka" },
    });

    const periodStart = new Date("2026-05-01");
    const periodEnd = new Date("2026-05-31");

    const inv = await issueSaasInvoice({
      orgId: org.id,
      plan: "pro",
      periodStart,
      periodEnd,
      subtotal: 5000,
      externalRef: "pay_test123",
    });

    expect(inv.number).toMatch(/^EW-2026-\d{6}$/);
    const persisted = await prisma.saasInvoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(persisted.subtotal).toBe(5000);
    expect(persisted.taxBps).toBe(1800);
    expect(persisted.taxAmount).toBe(900); // 18% of 5000
    expect(persisted.total).toBe(5900);
    expect(persisted.currency).toBe("INR");
    expect(persisted.status).toBe("due");
    expect(persisted.billingName).toBe("Test Academy");
    expect(persisted.billingGstin).toBe("29ABCDE1234F1Z5");
    expect(persisted.externalRef).toBe("pay_test123");

    // Counter bumped to 1.
    const cfg = await prisma.platformBillingConfig.findUniqueOrThrow({ where: { id: "default" } });
    expect(cfg.invoiceCounter).toBe(1);
  });

  it("sequential calls produce sequential invoice numbers", async () => {
    const org = await mkOrg();
    const a = await issueSaasInvoice({
      orgId: org.id,
      plan: "starter",
      periodStart: new Date("2026-01-01"),
      periodEnd: new Date("2026-01-31"),
      subtotal: 3000,
    });
    const b = await issueSaasInvoice({
      orgId: org.id,
      plan: "starter",
      periodStart: new Date("2026-02-01"),
      periodEnd: new Date("2026-02-28"),
      subtotal: 3000,
    });
    // Strict monotonic, padded to 6 digits.
    const numA = Number(a.number.split("-")[2]);
    const numB = Number(b.number.split("-")[2]);
    expect(numB).toBe(numA + 1);
  });

  it("throws ORG_NOT_FOUND when the org is missing", async () => {
    await expect(
      issueSaasInvoice({
        orgId: "no_such_org",
        plan: "pro",
        periodStart: new Date(),
        periodEnd: new Date(Date.now() + 86400000),
        subtotal: 1000,
      }),
    ).rejects.toThrow(/ORG_NOT_FOUND/);
  });

  it("honours a custom defaultTaxBps", async () => {
    const org = await mkOrg();
    // Pre-seed the config with 0% tax for a special case (e.g. export sale).
    await prisma.platformBillingConfig.upsert({
      where: { id: "default" },
      create: { id: "default", defaultTaxBps: 0 },
      update: { defaultTaxBps: 0 },
    });
    const inv = await issueSaasInvoice({
      orgId: org.id,
      plan: "enterprise",
      periodStart: new Date(),
      periodEnd: new Date(Date.now() + 86400000),
      subtotal: 10000,
    });
    const row = await prisma.saasInvoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(row.taxAmount).toBe(0);
    expect(row.total).toBe(10000);
  });
});
