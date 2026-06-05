"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { openConfirm } from "@/components/ui/confirm-dialog";

type Initial = {
  razorpaySubscriptionId: string | null;
  razorpaySubscriptionStatus: string | null;
  plan: string;
};

const ACTIVE_STATES = new Set(["created", "authenticated", "active", "pending", "halted"]);

// Razorpay Subscription management. Mirrors BillingPanel's Stripe pattern
// but talks to /api/owner/tenants/[id]/razorpay-subscription. Used for
// the Indian-market autopay flow (UPI mandate, card recurring).
export function RazorpayPanel({
  tenantId,
  initial,
  canManage,
}: {
  tenantId: string;
  initial: Initial;
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [authLink, setAuthLink] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    try {
      const res = await fetch(`/api/owner/tenants/${tenantId}/razorpay-subscription`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          data.error === "RAZORPAY_NOT_CONFIGURED" ? "Set RAZORPAY_KEY_ID/SECRET first."
          : data.error === "PLAN_ID_NOT_CONFIGURED" ? data.message
          : data.error === "SUBSCRIPTION_EXISTS" ? "A subscription is already active. Cancel it first."
          : (data.error ?? "Failed");
        toast.error(msg);
        return;
      }
      toast.success(`Subscription created · ${data.subscriptionId}`);
      if (data.shortUrl) setAuthLink(data.shortUrl);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function cancel(atCycleEnd: boolean) {
    const ok = await openConfirm({
      title: atCycleEnd ? "Cancel at cycle end?" : "Cancel immediately?",
      body: atCycleEnd
        ? "The current paid period continues; renewal stops. The tenant won't be billed again."
        : "Razorpay stops charging now. The tenant remains active until you change their status here.",
      destructive: true,
      confirmLabel: atCycleEnd ? "Cancel at cycle end" : "Cancel now",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/owner/tenants/${tenantId}/razorpay-subscription${atCycleEnd ? "?atCycleEnd=1" : ""}`,
        { method: "DELETE" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Failed");
        return;
      }
      toast.success(`Subscription ${data.status}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const hasActive = !!initial.razorpaySubscriptionId && ACTIVE_STATES.has(initial.razorpaySubscriptionStatus ?? "");

  return (
    <div className="space-y-3 rounded-md border border-border bg-background p-3 text-sm">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Razorpay subscription</div>
          <div className="mt-0.5 font-mono text-foreground">
            {initial.razorpaySubscriptionId ?? <span className="text-muted-foreground">not created</span>}
          </div>
          {initial.razorpaySubscriptionStatus && (
            <div className="mt-1 text-xs text-muted-foreground">
              Status: <code className="rounded bg-muted px-1.5 py-0.5 text-foreground">{initial.razorpaySubscriptionStatus}</code>
            </div>
          )}
        </div>
        {!hasActive && canManage && (
          <Button onClick={create} disabled={busy}>
            {busy ? "Creating…" : `Create on ${initial.plan} plan`}
          </Button>
        )}
        {hasActive && canManage && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => cancel(true)} disabled={busy} className="border-border text-foreground hover:bg-muted">
              Cancel at cycle end
            </Button>
            <Button variant="destructive" onClick={() => cancel(false)} disabled={busy}>
              Cancel now
            </Button>
          </div>
        )}
      </div>
      {authLink && (
        <div className="rounded border border-emerald-300 dark:border-emerald-700 bg-emerald-100 dark:bg-emerald-100 dark:bg-emerald-900/30 p-2 text-xs text-emerald-800 dark:text-emerald-200">
          <strong>Mandate authorisation link sent to billing email.</strong> Direct link:{" "}
          <a href={authLink} target="_blank" rel="noreferrer" className="underline">{authLink}</a>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Razorpay Subscriptions = UPI mandate or card autopay. After creation, the customer must
        click the authorisation link emailed to their billing address. Webhooks then drive status
        changes (authenticated → active → halted/cancelled).
      </p>
    </div>
  );
}
