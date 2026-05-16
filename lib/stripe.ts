// Minimal Stripe wiring — webhook signature verification + Customer Portal
// session creation. Both implemented with `fetch` + `node:crypto` so we don't
// pull the whole stripe SDK for two endpoints. If/when we add card collection,
// embedded checkout, etc., swap to the SDK at that point.

import crypto from "node:crypto";

const STRIPE_API = "https://api.stripe.com/v1";
const SIG_VERSION = "v1";
// Tolerance window for replay attacks. Stripe's default in their SDK is 5min.
const SIG_TOLERANCE_SECONDS = 300;

export function stripeKey(): string {
  const k = process.env.STRIPE_SECRET_KEY;
  if (!k) throw new Error("STRIPE_SECRET_KEY is not set");
  return k;
}

export function stripeWebhookSecret(): string {
  const s = process.env.STRIPE_WEBHOOK_SECRET;
  if (!s) throw new Error("STRIPE_WEBHOOK_SECRET is not set");
  return s;
}

// ── Signature verification ────────────────────────────────────────────────
// Stripe-Signature header looks like: `t=<unix>,v1=<hex>,v1=<hex>`
// We HMAC-SHA256 over `${t}.${rawPayload}` with the webhook secret and
// constant-time compare against any v1 entry.

export function verifyStripeSignature(
  payload: string,
  signatureHeader: string | null,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): { ok: true; eventTimestamp: number } | { ok: false; error: string } {
  if (!signatureHeader) return { ok: false, error: "missing_signature" };

  let timestamp: number | null = null;
  const v1Sigs: string[] = [];
  for (const part of signatureHeader.split(",")) {
    const [k, v] = part.trim().split("=");
    if (!k || !v) continue;
    if (k === "t") timestamp = Number(v);
    else if (k === SIG_VERSION) v1Sigs.push(v);
  }
  if (timestamp === null || Number.isNaN(timestamp)) {
    return { ok: false, error: "bad_timestamp" };
  }
  if (v1Sigs.length === 0) return { ok: false, error: "no_v1_signature" };
  if (Math.abs(nowSeconds - timestamp) > SIG_TOLERANCE_SECONDS) {
    return { ok: false, error: "stale_signature" };
  }

  const signed = `${timestamp}.${payload}`;
  const expected = crypto.createHmac("sha256", secret).update(signed).digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");

  for (const sig of v1Sigs) {
    const sigBuf = Buffer.from(sig, "hex");
    if (sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return { ok: true, eventTimestamp: timestamp };
    }
  }
  return { ok: false, error: "signature_mismatch" };
}

// ── Customer Portal session ───────────────────────────────────────────────
// Returns the URL the tenant admin should be redirected to so they can manage
// their billing (update card, change plan, view invoices). Stripe creates a
// short-lived session URL — we never persist it.

export async function createBillingPortalSession(opts: {
  customerId: string;
  returnUrl: string;
}): Promise<{ url: string }> {
  const form = new URLSearchParams();
  form.set("customer", opts.customerId);
  form.set("return_url", opts.returnUrl);

  const res = await fetch(`${STRIPE_API}/billing_portal/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeKey()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`stripe_portal_session_failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { url?: string };
  if (!data.url) throw new Error("stripe_portal_no_url");
  return { url: data.url };
}

// ── Status mapping ────────────────────────────────────────────────────────
// Stripe subscription status → our Organisation.status. The mapping is
// deliberately narrow: trial / active stay writable; past_due and canceled
// flip the tenant into read-only mode.
//
// Reference:
//   incomplete | incomplete_expired | trialing | active | past_due |
//   canceled | unpaid | paused

export type StripeSubStatus =
  | "incomplete"
  | "incomplete_expired"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "paused";

export type OrgStatus = "active" | "trial" | "past_due" | "suspended";

export function orgStatusFromStripe(s: StripeSubStatus | string | null | undefined): OrgStatus {
  switch (s) {
    case "trialing":
      return "trial";
    case "active":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
    case "paused":
      return "suspended";
    case "incomplete":
    default:
      // Brand-new subs sit in "incomplete" until the first invoice succeeds.
      // Treat as trial so the tenant can poke around without being suspended.
      return "trial";
  }
}
