// Smoke tests for POST /api/webhooks/razorpay.
//
// The webhook handler reads RAZORPAY_WEBHOOK_SECRET from process.env and
// rejects requests whose x-razorpay-signature doesn't match
// HMAC_SHA256(rawBody, secret). We set the env var BEFORE importing the
// route handler so the imported module sees it; signPayload() recreates
// the same HMAC the handler will check against.
//
// Scope is the tenant-side payment.captured path (the most-trafficked
// branch) plus the security and idempotency guards. The SaaS subscription
// branch (handleSubscriptionEvent) is left for a separate test focused
// on subscription lifecycle.

import { describe, it, expect, beforeEach, vi } from "vitest";
import crypto from "node:crypto";
import { resetDb } from "../helpers/db";
import { mkOrg, mkCentre, mkUser, mkRider } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { mockReq } from "../helpers/request";

// Env must be set before the route handler import below — the handler's
// signature-verification path reads RAZORPAY_WEBHOOK_SECRET on each call,
// but late-importing is the safe pattern (matches stripe-webhook.test.ts).
const TEST_SECRET = "rzp_test_webhook_secret_long_enough_for_smoke";
process.env.RAZORPAY_WEBHOOK_SECRET = TEST_SECRET;

const cookieJar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => cookieJar.get(name),
    set: (name: string, value: string) => cookieJar.set(name, { value }),
    delete: (name: string) => cookieJar.delete(name),
  }),
}));

const { POST: razorpayWebhook } = await import("@/app/api/webhooks/razorpay/route");

function sign(rawBody: string): string {
  return crypto.createHmac("sha256", TEST_SECRET).update(rawBody).digest("hex");
}

function postWebhook(event: object, opts: { badSignature?: boolean } = {}) {
  const rawBody = JSON.stringify(event);
  const signature = opts.badSignature ? "deadbeef".repeat(8) : sign(rawBody);
  return razorpayWebhook(
    mockReq("http://localhost/api/webhooks/razorpay", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-razorpay-signature": signature,
      },
      body: rawBody,
    }),
  );
}

// Fixture: a rider with an open registration invoice in INR — the shape
// the webhook expects to find when payment.captured arrives.
async function seedInvoice(opts: { amount?: number } = {}) {
  const org = await mkOrg();
  const centre = await mkCentre({ orgId: org.id });
  await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id });
  const rider = await mkRider({ centreId: centre.id, email: "parent@example.com" });
  const invoice = await prisma.invoice.create({
    data: {
      centreId: centre.id,
      riderId: rider.id,
      amount: opts.amount ?? 5_000,
      gstAmount: 0,
      dueDate: new Date(Date.now() + 7 * 86400000),
      status: "due",
      kind: "registration",
    },
  });
  return { org, centre, rider, invoice };
}

// Mint a Razorpay payment.captured event referencing the given invoice id.
// `notes.invoiceId` is how the webhook handler joins the captured payment
// back to our Invoice row (Razorpay carries it through from order create).
function captureEvent(opts: { invoiceId: string; paymentId: string; orderId?: string; amountPaise: number }) {
  return {
    event: "payment.captured",
    payload: {
      payment: {
        entity: {
          id: opts.paymentId,
          order_id: opts.orderId ?? `order_${opts.paymentId}`,
          amount: opts.amountPaise,
          notes: { invoiceId: opts.invoiceId },
        },
      },
    },
  };
}

beforeEach(async () => {
  await resetDb();
});

describe("POST /api/webhooks/razorpay", () => {
  it("rejects an invalid signature with 403", async () => {
    const res = await postWebhook(
      { event: "payment.captured", payload: {} },
      { badSignature: true },
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("INVALID_SIGNATURE");
  });

  it("rejects a missing signature with 403", async () => {
    const res = await razorpayWebhook(
      mockReq("http://localhost/api/webhooks/razorpay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event: "payment.captured", payload: {} }),
      }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("INVALID_SIGNATURE");
  });

  it("returns 400 BAD_JSON when the body isn't parseable", async () => {
    const rawBody = "not-json";
    const res = await razorpayWebhook(
      mockReq("http://localhost/api/webhooks/razorpay", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-razorpay-signature": sign(rawBody),
        },
        body: rawBody,
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("BAD_JSON");
  });

  it("logs and skips events we don't handle", async () => {
    const res = await postWebhook({
      event: "refund.processed",
      payload: { payment: { entity: { id: "pay_refund_1" } } },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skipped).toBe("refund.processed");
  });

  it("marks an invoice paid and creates a Payment row on payment.captured", async () => {
    const { invoice, rider } = await seedInvoice({ amount: 5_000 });

    const res = await postWebhook(
      captureEvent({
        invoiceId: invoice.id,
        paymentId: "pay_test_1",
        amountPaise: 500_000, // ₹5000 in paise
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);

    const updated = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(updated.status).toBe("paid");

    const payments = await prisma.payment.findMany({ where: { invoiceId: invoice.id } });
    expect(payments).toHaveLength(1);
    expect(payments[0]!.txnRef).toBe("pay_test_1");
    expect(payments[0]!.amount).toBe(5_000); // converted from paise
    expect(payments[0]!.method).toBe("razorpay");

    // Registration kind → rider promoted to active and registrationPaid=true.
    const updatedRider = await prisma.rider.findUniqueOrThrow({ where: { id: rider.id } });
    expect(updatedRider.registrationPaid).toBe(true);
    expect(updatedRider.status).toBe("active");
  });

  it("is idempotent — re-delivering the same payment_id doesn't double-apply", async () => {
    const { invoice } = await seedInvoice();

    const first = await postWebhook(
      captureEvent({ invoiceId: invoice.id, paymentId: "pay_test_dup", amountPaise: 500_000 }),
    );
    expect(first.status).toBe(200);

    const second = await postWebhook(
      captureEvent({ invoiceId: invoice.id, paymentId: "pay_test_dup", amountPaise: 500_000 }),
    );
    expect(second.status).toBe(200);
    expect((await second.json()).alreadyApplied).toBe(true);

    // Exactly one Payment row should exist for this txnRef.
    const payments = await prisma.payment.findMany({ where: { txnRef: "pay_test_dup" } });
    expect(payments).toHaveLength(1);
  });

  it("returns MISSING_NOTES when payment.notes.invoiceId is absent", async () => {
    const res = await postWebhook({
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: "pay_test_missing",
            order_id: "order_missing",
            amount: 500_000,
            notes: {}, // no invoiceId
          },
        },
      },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("MISSING_NOTES");
  });

  it("returns INVOICE_NOT_FOUND when the referenced invoice doesn't exist", async () => {
    const res = await postWebhook(
      captureEvent({
        invoiceId: "invoice-does-not-exist",
        paymentId: "pay_test_ghost",
        amountPaise: 500_000,
      }),
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("INVOICE_NOT_FOUND");
  });
});
