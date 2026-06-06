"use client";

import Script from "next/script";
import { useEffect, useState } from "react";

type Tier = { id: string; name: string; priceInr: number; description: string | null };

// Public ticket-buy form. Free-tier path issues instantly; paid path
// pops the Razorpay checkout. Razorpay SDK is loaded via next/script
// on demand — we don't ship 30KB to visitors who never reach this page.
export function TicketsForm({ slug, tiers }: { slug: string; tiers: Tier[] }) {
  const [tierId, setTierId] = useState(tiers[0]?.id ?? "");
  const [quantity, setQuantity] = useState(1);
  const [buyerName, setBuyerName] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [buyerPhone, setBuyerPhone] = useState("");
  const [captchaQuestion, setCaptchaQuestion] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaAnswer, setCaptchaAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch("/api/captcha")
      .then((r) => r.json())
      .then((d) => { setCaptchaQuestion(d.question); setCaptchaToken(d.token); });
  }, []);

  const tier = tiers.find((t) => t.id === tierId);
  const totalInr = tier ? tier.priceInr * quantity : 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await fetch(`/api/public/competitions/${slug}/tickets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tierId,
        quantity,
        buyerName,
        buyerEmail,
        buyerPhone: buyerPhone || undefined,
        captchaToken,
        captchaAnswer,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBusy(false);
      setError(
        data.error === "SOLD_OUT" ? `Sold out — only ${data.remaining} left.`
        : data.error === "CAPTCHA_FAILED" ? "CAPTCHA answer was wrong."
        : data.error ?? "Failed",
      );
      return;
    }
    if (data.free) {
      setBusy(false);
      setDone(true);
      return;
    }
    // Paid — open Razorpay
    const w = window as any;
    if (!w.Razorpay) {
      setBusy(false);
      setError("Razorpay SDK didn't load. Refresh and try again.");
      return;
    }
    const rzp = new w.Razorpay({
      key: data.keyId,
      order_id: data.orderId,
      amount: data.amountPaise,
      currency: data.currency,
      name: data.name,
      description: data.description,
      prefill: data.prefill,
      handler: () => {
        // Webhook will email QR; we just confirm UI here.
        setBusy(false);
        setDone(true);
      },
      modal: { ondismiss: () => setBusy(false) },
    });
    rzp.open();
  }

  if (done) {
    return (
      <div className="mt-6 rounded-md border border-emerald-300 bg-emerald-50 p-5 text-sm">
        <h2 className="font-semibold text-emerald-900">Tickets on the way</h2>
        <p className="mt-2 text-emerald-800">
          Check <strong>{buyerEmail}</strong> for an email with your tickets. Each ticket has its own QR code — open them on your phone at the gate.
        </p>
      </div>
    );
  }

  return (
    <>
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="lazyOnload" />
      <form onSubmit={submit} className="mt-6 space-y-5">
        <section className="rounded-lg border bg-card p-5">
          <h3 className="text-sm font-semibold">Choose your tier</h3>
          <div className="mt-3 space-y-2">
            {tiers.map((t) => (
              <label key={t.id} className={`flex cursor-pointer items-start gap-3 rounded border p-3 ${tierId === t.id ? "border-primary bg-primary/5" : ""}`}>
                <input
                  type="radio"
                  name="tier"
                  checked={tierId === t.id}
                  onChange={() => setTierId(t.id)}
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{t.name}</span>
                    <span className="font-semibold">{t.priceInr === 0 ? "Free" : `₹${t.priceInr.toLocaleString("en-IN")}`}</span>
                  </div>
                  {t.description && <p className="mt-1 text-xs text-muted-foreground">{t.description}</p>}
                </div>
              </label>
            ))}
          </div>
        </section>

        <section className="rounded-lg border bg-card p-5">
          <h3 className="text-sm font-semibold">Quantity + your details</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium">Quantity</label>
              <input
                type="number"
                min={1}
                max={20}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, Math.min(20, Number(e.target.value))))}
                className="mt-1 h-10 w-full rounded border bg-card px-2 text-sm"
              />
            </div>
            <div className="text-right text-sm">
              <div className="text-xs text-muted-foreground">Total</div>
              <div className="text-2xl font-bold">{totalInr === 0 ? "Free" : `₹${totalInr.toLocaleString("en-IN")}`}</div>
            </div>
            <div>
              <label className="text-xs font-medium">Name *</label>
              <input value={buyerName} onChange={(e) => setBuyerName(e.target.value)} required className="mt-1 h-10 w-full rounded border bg-card px-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium">Email *</label>
              <input type="email" value={buyerEmail} onChange={(e) => setBuyerEmail(e.target.value)} required className="mt-1 h-10 w-full rounded border bg-card px-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium">Phone</label>
              <input value={buyerPhone} onChange={(e) => setBuyerPhone(e.target.value)} className="mt-1 h-10 w-full rounded border bg-card px-2 text-sm" />
            </div>
          </div>
        </section>

        <section className="rounded-lg border bg-card p-5">
          <h3 className="text-sm font-semibold">Quick check</h3>
          <p className="mt-2 text-sm">What is <strong>{captchaQuestion}</strong>?</p>
          <input value={captchaAnswer} onChange={(e) => setCaptchaAnswer(e.target.value)} className="mt-2 h-10 w-32 rounded border bg-card px-2 text-sm" required />
        </section>

        {error && (
          <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{error}</div>
        )}

        <button
          type="submit"
          disabled={busy || !tierId || !buyerName || !buyerEmail}
          className="w-full rounded-md bg-primary px-5 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {busy ? "Processing…" : totalInr === 0 ? "Get free tickets" : `Pay ₹${totalInr.toLocaleString("en-IN")}`}
        </button>
      </form>
    </>
  );
}
