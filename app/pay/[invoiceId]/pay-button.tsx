"use client";

// Client-side Pay button for the public /pay/[invoiceId] page. Wraps
// runRazorpayCheckout — on success, refreshes the server component
// so the page re-renders in "paid" state (the webhook may already have
// flipped invoice.status by the time we get back here, but the verify
// endpoint also does it synchronously so the reload is safe either way).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { runRazorpayCheckout } from "@/lib/razorpay-checkout";

export function PayButton({
  invoiceId,
  centreName,
  amountRupees,
}: {
  invoiceId: string;
  centreName: string;
  amountRupees: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function pay() {
    setBusy(true);
    try {
      const ok = await runRazorpayCheckout(invoiceId, centreName);
      if (ok) {
        // Webhook + verify both flip invoice.status to paid; refresh the
        // server component so the page rerenders in the paid state.
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button onClick={pay} disabled={busy} size="lg" className="w-full">
      {busy ? "Processing…" : `Pay ₹${amountRupees.toLocaleString("en-IN")} now`}
    </Button>
  );
}
