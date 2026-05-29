"use client";

// Razorpay checkout.js client helper. The SDK is loaded via a <script>
// tag at runtime — it doesn't ship in the bundle — and lives on
// window.Razorpay once the script lands. This module:
//
//   - Declares the narrow Razorpay types we touch (full SDK has dozens of
//     fields we never read).
//   - loadRazorpayScript()  → idempotent script-tag injector.
//   - runRazorpayCheckout() → end-to-end flow: order create → open modal
//     → verify signature server-side → resolve true/false.
//
// Called from the public /pay/[invoiceId] page (parent's payment surface)
// and previously from the onboarding wizard. Centralising means the
// modal styling, theme colour, and verify endpoint URL stay in one place.

import { toast } from "sonner";

type RazorpayResponse = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};
type RazorpayOptions = {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description?: string;
  order_id: string;
  prefill?: { name?: string; email?: string; contact?: string };
  theme?: { color?: string };
  handler: (response: RazorpayResponse) => void | Promise<void>;
  modal?: { ondismiss?: () => void };
};
type RazorpayInstance = { open: () => void };
type RazorpayConstructor = new (opts: RazorpayOptions) => RazorpayInstance;

declare global {
  interface Window {
    Razorpay?: RazorpayConstructor;
  }
}

let razorpayScriptPromise: Promise<void> | null = null;

export function loadRazorpayScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.Razorpay) return Promise.resolve();
  if (razorpayScriptPromise) return razorpayScriptPromise;
  razorpayScriptPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Razorpay script failed to load"));
    document.body.appendChild(s);
  });
  return razorpayScriptPromise;
}

// Run the full payment flow against an invoice id. Returns true on
// verified successful payment, false on user-cancel / network / verify
// failure. Toast errors are surfaced inside; the caller only needs to
// react to the boolean.
export async function runRazorpayCheckout(
  invoiceId: string,
  contextName: string,
): Promise<boolean> {
  const orderRes = await fetch("/api/payments/razorpay/order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ invoiceId }),
  });
  if (!orderRes.ok) {
    const err = await orderRes.json().catch(() => ({}));
    toast.error(err.message ?? err.error ?? "Could not start payment");
    return false;
  }
  const order = await orderRes.json();

  await loadRazorpayScript();
  const RP = window.Razorpay;
  if (!RP) {
    toast.error("Razorpay SDK failed to load");
    return false;
  }

  return new Promise<boolean>((resolve) => {
    const rzp = new RP({
      key: order.keyId,
      amount: order.amountPaise,
      currency: order.currency,
      name: order.name,
      description: order.description ?? `Registration · ${contextName}`,
      order_id: order.orderId,
      prefill: order.prefill,
      theme: { color: "#177434" },
      handler: async (response) => {
        const v = await fetch("/api/payments/razorpay/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            invoiceId,
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature,
          }),
        });
        if (!v.ok) {
          toast.error("Payment captured but verification failed — please contact the centre.");
          resolve(false);
          return;
        }
        resolve(true);
      },
      modal: {
        ondismiss: () => resolve(false),
      },
    });
    rzp.open();
  });
}
