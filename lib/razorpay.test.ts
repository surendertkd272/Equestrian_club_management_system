import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import {
  isConfigured,
  publicKeyId,
  verifyCheckoutSignature,
  verifyWebhookSignature,
} from "./razorpay";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe("isConfigured", () => {
  it("true when both server keys are set", () => {
    process.env.RAZORPAY_KEY_ID = "rzp_test_abc";
    process.env.RAZORPAY_KEY_SECRET = "secret";
    expect(isConfigured()).toBe(true);
  });
  it("false when either is missing", () => {
    delete process.env.RAZORPAY_KEY_ID;
    process.env.RAZORPAY_KEY_SECRET = "secret";
    expect(isConfigured()).toBe(false);
    process.env.RAZORPAY_KEY_ID = "rzp_test_abc";
    delete process.env.RAZORPAY_KEY_SECRET;
    expect(isConfigured()).toBe(false);
  });
});

describe("publicKeyId", () => {
  it("returns the NEXT_PUBLIC key when set", () => {
    process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID = "rzp_test_pub";
    expect(publicKeyId()).toBe("rzp_test_pub");
  });
  it("returns null when unset or empty", () => {
    delete process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
    expect(publicKeyId()).toBeNull();
    process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID = "";
    expect(publicKeyId()).toBeNull();
  });
});

describe("verifyCheckoutSignature", () => {
  const secret = "test-secret-key";
  const orderId = "order_ABCD1234";
  const paymentId = "pay_WXYZ5678";

  beforeEach(() => {
    process.env.RAZORPAY_KEY_SECRET = secret;
  });

  it("accepts a correctly-signed pair", () => {
    const sig = crypto.createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
    expect(verifyCheckoutSignature(orderId, paymentId, sig)).toBe(true);
  });

  it("rejects a signature signed with a different secret", () => {
    const sig = crypto.createHmac("sha256", "wrong-secret").update(`${orderId}|${paymentId}`).digest("hex");
    expect(verifyCheckoutSignature(orderId, paymentId, sig)).toBe(false);
  });

  it("rejects when the payload doesn't match", () => {
    const sig = crypto.createHmac("sha256", secret).update(`${orderId}|tampered`).digest("hex");
    expect(verifyCheckoutSignature(orderId, paymentId, sig)).toBe(false);
  });

  it("rejects empty / malformed signatures without throwing", () => {
    expect(verifyCheckoutSignature(orderId, paymentId, "")).toBe(false);
    expect(verifyCheckoutSignature(orderId, paymentId, "not-hex")).toBe(false);
    expect(verifyCheckoutSignature(orderId, paymentId, "abc123")).toBe(false);
  });

  it("returns false when the secret env is unset", () => {
    delete process.env.RAZORPAY_KEY_SECRET;
    const sig = crypto.createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
    expect(verifyCheckoutSignature(orderId, paymentId, sig)).toBe(false);
  });
});

describe("verifyWebhookSignature", () => {
  const secret = "webhook-secret";
  const body = JSON.stringify({ event: "payment.captured", payload: { id: "pay_1" } });

  beforeEach(() => {
    process.env.RAZORPAY_WEBHOOK_SECRET = secret;
  });

  it("accepts a body signed with the webhook secret", () => {
    const sig = crypto.createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyWebhookSignature(body, sig)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const sig = crypto.createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyWebhookSignature(body + "x", sig)).toBe(false);
  });

  it("returns false when webhook secret unset", () => {
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    const sig = crypto.createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyWebhookSignature(body, sig)).toBe(false);
  });
});
