import { describe, it, expect, beforeEach, vi } from "vitest";
import crypto from "node:crypto";
import { resetDb } from "../helpers/db";
import { mkOrg } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import {
  verifyStripeSignature,
  orgStatusFromStripe,
} from "@/lib/stripe";

// We have to set the webhook secret before importing the route handler — the
// handler reads it from env on each call but a few internal helpers cache.
const TEST_WEBHOOK_SECRET = "whsec_test_dummy_signing_secret_long_enough";
process.env.STRIPE_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;

const cookieJar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => cookieJar.get(name),
    set: (name: string, value: string) => cookieJar.set(name, { value }),
    delete: (name: string) => cookieJar.delete(name),
  }),
}));

const { POST: stripeWebhook } = await import("@/app/api/webhooks/stripe/route");

function signPayload(payload: string, timestamp: number = Math.floor(Date.now() / 1000)): string {
  const sig = crypto.createHmac("sha256", TEST_WEBHOOK_SECRET).update(`${timestamp}.${payload}`).digest("hex");
  return `t=${timestamp},v1=${sig}`;
}

function postEvent(event: object, opts: { signature?: string; timestamp?: number } = {}) {
  const payload = JSON.stringify(event);
  const headers = new Headers({ "content-type": "application/json" });
  const ts = opts.timestamp ?? Math.floor(Date.now() / 1000);
  const sig = opts.signature ?? signPayload(payload, ts);
  headers.set("stripe-signature", sig);
  return stripeWebhook(new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers,
    body: payload,
  }) as any);
}

beforeEach(async () => {
  await resetDb();
  cookieJar.clear();
});

describe("verifyStripeSignature (pure)", () => {
  it("accepts a freshly-signed payload", () => {
    const ts = Math.floor(Date.now() / 1000);
    const r = verifyStripeSignature("hello", `t=${ts},v1=${crypto.createHmac("sha256", "secret").update(`${ts}.hello`).digest("hex")}`, "secret", ts);
    expect(r.ok).toBe(true);
  });
  it("rejects a stale signature", () => {
    const ts = Math.floor(Date.now() / 1000) - 1000;
    const r = verifyStripeSignature("hello", `t=${ts},v1=00`, "secret", Math.floor(Date.now() / 1000));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("stale_signature");
  });
  it("rejects a tampered payload", () => {
    const ts = Math.floor(Date.now() / 1000);
    const sig = crypto.createHmac("sha256", "secret").update(`${ts}.original`).digest("hex");
    const r = verifyStripeSignature("tampered", `t=${ts},v1=${sig}`, "secret", ts);
    expect(r.ok).toBe(false);
  });
  it("rejects missing header", () => {
    expect(verifyStripeSignature("x", null, "secret").ok).toBe(false);
  });
});

describe("orgStatusFromStripe", () => {
  it("maps trialing → trial", () => expect(orgStatusFromStripe("trialing")).toBe("trial"));
  it("maps active → active", () => expect(orgStatusFromStripe("active")).toBe("active"));
  it("maps past_due / unpaid → past_due", () => {
    expect(orgStatusFromStripe("past_due")).toBe("past_due");
    expect(orgStatusFromStripe("unpaid")).toBe("past_due");
  });
  it("maps canceled / incomplete_expired / paused → suspended", () => {
    expect(orgStatusFromStripe("canceled")).toBe("suspended");
    expect(orgStatusFromStripe("incomplete_expired")).toBe("suspended");
    expect(orgStatusFromStripe("paused")).toBe("suspended");
  });
});

describe("POST /api/webhooks/stripe", () => {
  it("400 BAD_SIGNATURE without a valid header", async () => {
    const r = await postEvent({ type: "invoice.payment_failed", data: { object: {} } }, {
      signature: "t=0,v1=deadbeef",
    });
    expect(r.status).toBe(400);
  });

  it("200 + skipped for unknown customer", async () => {
    const r = await postEvent({
      type: "invoice.payment_failed",
      data: { object: { customer: "cus_unknown" } },
    });
    expect(r.status).toBe(200);
    expect((await r.json()).skipped).toBe("unknown_customer");
  });

  it("invoice.payment_failed → past_due + audit row", async () => {
    const org = await mkOrg();
    await prisma.organisation.update({
      where: { id: org.id },
      data: { stripeCustomerId: "cus_PAYFAIL", status: "active" },
    });

    const r = await postEvent({
      type: "invoice.payment_failed",
      data: { object: { customer: "cus_PAYFAIL" } },
    });
    expect(r.status).toBe(200);

    const after = await prisma.organisation.findUniqueOrThrow({ where: { id: org.id } });
    expect(after.status).toBe("past_due");
    expect(after.subscriptionStatus).toBe("past_due");

    const log = await prisma.platformAuditLog.findFirstOrThrow({
      where: { orgId: org.id, action: "owner.stripe_payment_failed" },
    });
    expect(log.actorId).toBeNull();
  });

  it("invoice.payment_succeeded clears past_due → active", async () => {
    const org = await mkOrg();
    await prisma.organisation.update({
      where: { id: org.id },
      data: { stripeCustomerId: "cus_PAYOK", status: "past_due" },
    });

    const r = await postEvent({
      type: "invoice.payment_succeeded",
      data: { object: { customer: "cus_PAYOK" } },
    });
    expect(r.status).toBe(200);

    const after = await prisma.organisation.findUniqueOrThrow({ where: { id: org.id } });
    expect(after.status).toBe("active");
  });

  it("invoice.payment_succeeded does NOT override a manual suspension", async () => {
    const org = await mkOrg();
    await prisma.organisation.update({
      where: { id: org.id },
      data: { stripeCustomerId: "cus_MANUAL", status: "suspended" },
    });

    await postEvent({
      type: "invoice.payment_succeeded",
      data: { object: { customer: "cus_MANUAL" } },
    });

    const after = await prisma.organisation.findUniqueOrThrow({ where: { id: org.id } });
    expect(after.status).toBe("suspended");
  });

  it("customer.subscription.deleted → suspended + currentPeriodEnd preserved", async () => {
    const org = await mkOrg();
    await prisma.organisation.update({
      where: { id: org.id },
      data: { stripeCustomerId: "cus_DEL", status: "active" },
    });

    const periodEnd = Math.floor(Date.now() / 1000) + 86400 * 7;
    const r = await postEvent({
      type: "customer.subscription.deleted",
      data: {
        object: {
          customer: "cus_DEL",
          status: "canceled",
          current_period_end: periodEnd,
        },
      },
    });
    expect(r.status).toBe(200);

    const after = await prisma.organisation.findUniqueOrThrow({ where: { id: org.id } });
    expect(after.status).toBe("suspended");
    expect(after.subscriptionStatus).toBe("canceled");
    expect(after.currentPeriodEnd?.getTime()).toBe(periodEnd * 1000);
  });

  it("customer.subscription.updated → trialing maps to trial", async () => {
    const org = await mkOrg();
    await prisma.organisation.update({
      where: { id: org.id },
      data: { stripeCustomerId: "cus_TRIAL", status: "active" },
    });

    await postEvent({
      type: "customer.subscription.updated",
      data: {
        object: {
          customer: "cus_TRIAL",
          status: "trialing",
          current_period_end: Math.floor(Date.now() / 1000) + 86400 * 14,
        },
      },
    });

    const after = await prisma.organisation.findUniqueOrThrow({ where: { id: org.id } });
    expect(after.status).toBe("trial");
    expect(after.subscriptionStatus).toBe("trialing");
  });

  it("unknown event type returns 200 + ignored", async () => {
    const org = await mkOrg();
    await prisma.organisation.update({
      where: { id: org.id },
      data: { stripeCustomerId: "cus_OTHER" },
    });

    const r = await postEvent({
      type: "customer.created",
      data: { object: { customer: "cus_OTHER" } },
    });
    expect(r.status).toBe(200);
    expect((await r.json()).ignored).toBe("customer.created");
  });
});
