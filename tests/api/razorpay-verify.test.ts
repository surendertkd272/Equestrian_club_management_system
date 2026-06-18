// Regression for the Razorpay /verify double-count red: a prior partial/cash
// payment must NOT be double-counted when the balance is paid online. /verify
// must record only the remaining balance and mark the invoice paid only when
// cumulative payments cover amount+GST.

import { describe, it, expect, beforeEach, vi } from "vitest";
import crypto from "node:crypto";
import { resetDb } from "../helpers/db";
import { mkOrg, mkCentre, mkUser, mkRider } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { mockReq } from "../helpers/request";

// Signature check reads RAZORPAY_KEY_SECRET; set before importing the route.
process.env.RAZORPAY_KEY_ID = "rzp_test_key";
process.env.RAZORPAY_KEY_SECRET = "rzp_test_secret_long_enough_for_hmac";

// No-op the notification side-effects so the test focuses on the money math.
vi.mock("@/lib/sms", () => ({ sendSms: vi.fn(async () => {}) }));
vi.mock("@/lib/whatsapp", () => ({ sendWhatsApp: vi.fn(async () => {}) }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => {}), renderEmail: vi.fn(() => "") }));
vi.mock("@/lib/notify", () => ({ notifyCentreManager: vi.fn(async () => {}) }));

const { POST: verify } = await import("@/app/api/payments/razorpay/verify/route");

function sign(orderId: string, paymentId: string): string {
  return crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET!).update(`${orderId}|${paymentId}`).digest("hex");
}
function verifyReq(invoiceId: string, orderId: string, paymentId: string) {
  return mockReq("http://localhost/api/payments/razorpay/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ invoiceId, razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: sign(orderId, paymentId) }),
  });
}
async function seed(amount: number) {
  const org = await mkOrg();
  const centre = await mkCentre({ orgId: org.id });
  await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id });
  const rider = await mkRider({ centreId: centre.id });
  const invoice = await prisma.invoice.create({
    data: { centreId: centre.id, riderId: rider.id, amount, gstAmount: 0, dueDate: new Date(Date.now() + 7 * 86400000), status: "due", kind: "registration" },
  });
  return { centre, rider, invoice };
}

beforeEach(async () => {
  await resetDb();
});

describe("razorpay /verify — partial payment is not double-counted", () => {
  it("records only the remaining balance and marks the invoice paid", async () => {
    const { invoice } = await seed(10_000);
    // Prior cash payment of 4,000 recorded manually; invoice still "due".
    await prisma.payment.create({ data: { invoiceId: invoice.id, amount: 4_000, method: "cash", clearedAt: new Date() } });

    const res = await verify(verifyReq(invoice.id, "order_abc", "pay_abc"));
    expect(res.status).toBe(200);

    const payments = await prisma.payment.findMany({ where: { invoiceId: invoice.id } });
    const total = payments.reduce((s, p) => s + p.amount, 0);
    expect(total).toBe(10_000); // NOT 14,000
    expect(payments.find((p) => p.txnRef === "pay_abc")?.amount).toBe(6_000); // remaining only
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe("paid");
  });

  it("full payment with no prior records the full amount and marks paid", async () => {
    const { invoice } = await seed(8_000);
    const res = await verify(verifyReq(invoice.id, "order_full", "pay_full"));
    expect(res.status).toBe(200);
    const payments = await prisma.payment.findMany({ where: { invoiceId: invoice.id } });
    expect(payments.reduce((s, p) => s + p.amount, 0)).toBe(8_000);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe("paid");
  });

  it("rejects an invalid signature", async () => {
    const { invoice } = await seed(5_000);
    const bad = mockReq("http://localhost/api/payments/razorpay/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ invoiceId: invoice.id, razorpay_order_id: "o", razorpay_payment_id: "p", razorpay_signature: "deadbeef" }),
    });
    const res = await verify(bad);
    expect(res.status).toBe(403);
    expect(await prisma.payment.count({ where: { invoiceId: invoice.id } })).toBe(0);
  });
});
