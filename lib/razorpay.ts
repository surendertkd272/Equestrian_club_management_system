import crypto from "node:crypto";

// Razorpay client without the npm SDK — keeps the dep tree small.
// All we need is one POST to /v1/orders and two HMAC checks.

export type RazorpayOrder = {
  id: string;
  amount: number; // paise
  currency: string;
  receipt?: string;
  status: string;
};

export function isConfigured(): boolean {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

export function publicKeyId(): string | null {
  // NEXT_PUBLIC_* is the only safe form to ship to the client.
  return process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || null;
}

function basicAuthHeader(): string {
  const id = process.env.RAZORPAY_KEY_ID!;
  const secret = process.env.RAZORPAY_KEY_SECRET!;
  return "Basic " + Buffer.from(`${id}:${secret}`).toString("base64");
}

// Create an order on Razorpay. amount is in paise (₹3,000 → 300000).
export async function createOrder(opts: {
  amountPaise: number;
  receipt: string;
  notes?: Record<string, string>;
}): Promise<RazorpayOrder> {
  if (!isConfigured()) throw new Error("RAZORPAY_NOT_CONFIGURED");
  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: basicAuthHeader(),
    },
    body: JSON.stringify({
      amount: opts.amountPaise,
      currency: "INR",
      receipt: opts.receipt,
      notes: opts.notes ?? {},
      payment_capture: 1,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Razorpay order create failed (${res.status}): ${text}`);
  }
  return (await res.json()) as RazorpayOrder;
}

// Razorpay returns `razorpay_signature = HMAC_SHA256(`${order_id}|${payment_id}`, key_secret)`.
export function verifyCheckoutSignature(orderId: string, paymentId: string, signature: string): boolean {
  if (!process.env.RAZORPAY_KEY_SECRET) return false;
  const expected = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  return timingSafeEqualHex(expected, signature);
}

// Razorpay webhook signature: HMAC_SHA256(rawBody, webhook_secret)
export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return timingSafeEqualHex(expected, signature);
}

function timingSafeEqualHex(a: string, b: string): boolean {
  // crypto.timingSafeEqual requires equal-length buffers — bail early if mismatched.
  if (a.length !== b.length) return false;
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// ─────────────────────────────────────────────────────────────────────────
// Razorpay Subscriptions API — used to bill tenants for the SaaS plan
// itself (monthly recurring on UPI mandate / card). Each plan needs a
// matching Razorpay Plan id created via the dashboard or one-off setup
// script; we accept those as env vars rather than auto-creating, so
// pricing changes don't accidentally fork live plans.
//
// Env vars to set after creating plans in the Razorpay dashboard:
//   RAZORPAY_PLAN_STARTER  = plan_xxx
//   RAZORPAY_PLAN_PRO      = plan_yyy
//   RAZORPAY_PLAN_ENTERPRISE = plan_zzz
//   RAZORPAY_WEBHOOK_SECRET = the secret used to sign webhook deliveries

export type RazorpaySubscription = {
  id: string;
  entity: "subscription";
  plan_id: string;
  status: string; // created | authenticated | active | pending | halted | cancelled | completed | expired
  current_start: number | null;
  current_end: number | null;
  notes?: Record<string, string>;
  short_url?: string; // the URL the customer visits to authorise
};

export function planIdFor(plan: "starter" | "pro" | "enterprise"): string | null {
  const map = {
    starter: process.env.RAZORPAY_PLAN_STARTER,
    pro: process.env.RAZORPAY_PLAN_PRO,
    enterprise: process.env.RAZORPAY_PLAN_ENTERPRISE,
  };
  return map[plan] || null;
}

// Create a subscription. `totalCount` = number of billing cycles before
// the subscription auto-completes; pass a high number (120 = 10 yrs) for
// "until cancelled". `customerNotify` controls whether Razorpay emails
// the payer — we keep it on so they get the mandate authorisation link.
//
// Caller passes either a resolved `planId` (preferred — comes from
// lib/pricing.ts:resolveRazorpayPlanId which checks DB then env), or a
// tier name and we look up env directly as a fallback for code paths
// that pre-date the DB pricing table.
export async function createSubscription(opts: {
  plan: "starter" | "pro" | "enterprise";
  planId?: string;
  totalCount?: number;
  notes?: Record<string, string>;
}): Promise<RazorpaySubscription> {
  if (!isConfigured()) throw new Error("RAZORPAY_NOT_CONFIGURED");
  const planId = opts.planId ?? planIdFor(opts.plan);
  if (!planId) throw new Error(`RAZORPAY_PLAN_NOT_SET:${opts.plan}`);
  const res = await fetch("https://api.razorpay.com/v1/subscriptions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: basicAuthHeader() },
    body: JSON.stringify({
      plan_id: planId,
      total_count: opts.totalCount ?? 120,
      customer_notify: 1,
      notes: opts.notes ?? {},
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Razorpay subscription create failed (${res.status}): ${text}`);
  }
  return (await res.json()) as RazorpaySubscription;
}

export async function fetchSubscription(id: string): Promise<RazorpaySubscription> {
  if (!isConfigured()) throw new Error("RAZORPAY_NOT_CONFIGURED");
  const res = await fetch(`https://api.razorpay.com/v1/subscriptions/${id}`, {
    headers: { Authorization: basicAuthHeader() },
  });
  if (!res.ok) {
    throw new Error(`Razorpay fetch subscription failed (${res.status})`);
  }
  return (await res.json()) as RazorpaySubscription;
}

// Cancel — defaults to immediate. Pass cancelAtCycleEnd=true to let the
// current paid period run out (kinder UX; Razorpay still records the cancel).
export async function cancelSubscription(id: string, cancelAtCycleEnd = false): Promise<RazorpaySubscription> {
  if (!isConfigured()) throw new Error("RAZORPAY_NOT_CONFIGURED");
  const res = await fetch(`https://api.razorpay.com/v1/subscriptions/${id}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: basicAuthHeader() },
    body: JSON.stringify({ cancel_at_cycle_end: cancelAtCycleEnd ? 1 : 0 }),
  });
  if (!res.ok) {
    throw new Error(`Razorpay cancel subscription failed (${res.status})`);
  }
  return (await res.json()) as RazorpaySubscription;
}
