"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { openConfirm } from "@/components/ui/confirm-dialog";

type Initial = {
  stripeCustomerId: string | null;
  subscriptionStatus: string | null;
  currentPeriodEnd: string | null;
};

export function BillingPanel({
  tenantId,
  initial,
  canManage,
}: {
  tenantId: string;
  initial: Initial;
  canManage: boolean;
}) {
  const router = useRouter();
  const [customerInput, setCustomerInput] = useState(initial.stripeCustomerId ?? "");
  const [busy, setBusy] = useState(false);

  async function openPortal() {
    if (!initial.stripeCustomerId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/owner/tenants/${tenantId}/billing-portal`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) {
        const msg =
          data.error === "STRIPE_PORTAL_FAILED" ? "Stripe rejected the portal request — check the customer ID."
          : data.error === "NOT_LINKED" ? "Link a Stripe customer first."
          : (data.error ?? "Failed");
        toast.error(msg);
        return;
      }
      window.open(data.url, "_blank", "noopener");
    } finally {
      setBusy(false);
    }
  }

  async function saveCustomer(next: string | null) {
    setBusy(true);
    try {
      const res = await fetch(`/api/owner/tenants/${tenantId}/stripe`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stripeCustomerId: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          data.error === "CUSTOMER_ALREADY_LINKED"
            ? `That customer is already linked to ${data.details?.orgSlug ?? "another tenant"}.`
            : data.error === "VALIDATION" ? "Customer IDs look like cus_xxx."
            : (data.error ?? "Failed");
        toast.error(msg);
        return;
      }
      toast.success(next ? "Linked" : "Unlinked");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-md border border-border bg-background p-3 text-sm">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Stripe customer</div>
          <div className="mt-0.5 font-mono text-foreground">
            {initial.stripeCustomerId ?? <span className="text-muted-foreground">not linked</span>}
          </div>
          {initial.subscriptionStatus && (
            <div className="mt-1 text-xs text-muted-foreground">
              Subscription: <code className="rounded bg-muted px-1.5 py-0.5 text-foreground">{initial.subscriptionStatus}</code>
              {initial.currentPeriodEnd && (
                <span className="ml-2 text-muted-foreground">
                  · renews {new Date(initial.currentPeriodEnd).toLocaleDateString()}
                </span>
              )}
            </div>
          )}
        </div>
        <Button
          onClick={openPortal}
          disabled={!initial.stripeCustomerId || busy || !canManage}
          title={
            !canManage ? "Requires tenant.edit_billing"
            : !initial.stripeCustomerId ? "Link a Stripe customer first"
            : "Open Stripe Customer Portal"
          }
        >
          Manage billing →
        </Button>
      </div>

      {canManage && (
        <div className="rounded-md border border-border p-3">
          <Label htmlFor="cus" className="text-foreground">
            {initial.stripeCustomerId ? "Re-link Stripe customer" : "Link Stripe customer"}
          </Label>
          <div className="mt-2 flex gap-2">
            <Input
              id="cus"
              value={customerInput}
              onChange={(e) => setCustomerInput(e.target.value.trim())}
              placeholder="cus_xxxxxxxxxxxx"
              className="border-border bg-background font-mono text-foreground"
            />
            <Button
              onClick={() => saveCustomer(customerInput || null)}
              disabled={busy || customerInput === (initial.stripeCustomerId ?? "")}
            >
              Save
            </Button>
            {initial.stripeCustomerId && (
              <Button
                variant="outline"
                onClick={async () => {
                  const ok = await openConfirm({
                    title: "Unlink the Stripe customer?",
                    body: "Webhook events for this customer will stop updating this tenant's status.",
                    destructive: true,
                    confirmLabel: "Unlink",
                  });
                  if (!ok) return;
                  setCustomerInput("");
                  void saveCustomer(null);
                }}
                disabled={busy}
                className="border-border text-foreground hover:bg-muted"
              >
                Unlink
              </Button>
            )}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Create the customer in Stripe first (Dashboard → Customers), then paste the ID here.
            Once linked, the webhook flips this tenant's status as Stripe events arrive.
          </p>
        </div>
      )}
    </div>
  );
}
