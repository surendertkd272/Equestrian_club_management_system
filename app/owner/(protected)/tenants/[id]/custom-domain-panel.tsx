"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { openConfirm } from "@/components/ui/confirm-dialog";

type Initial = {
  customDomain: string | null;
  customDomainVerifiedAt: string | null;
};

export function CustomDomainPanel({
  tenantId,
  tenantSlug,
  initial,
  canManage,
}: {
  tenantId: string;
  tenantSlug: string;
  initial: Initial;
  canManage: boolean;
}) {
  const router = useRouter();
  const [domain, setDomain] = useState(initial.customDomain ?? "");
  const [busy, setBusy] = useState(false);

  const dirty = (domain || null) !== initial.customDomain;
  const verified = !!initial.customDomainVerifiedAt;

  async function patch(payload: { customDomain: string | null; verified?: boolean }) {
    setBusy(true);
    try {
      const res = await fetch(`/api/owner/tenants/${tenantId}/custom-domain`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          data.error === "DOMAIN_ALREADY_CLAIMED" ? `Already claimed by ${data.details?.orgSlug}.`
          : data.error === "VALIDATION" ? "That's not a valid hostname."
          : (data.error ?? "Failed");
        toast.error(msg);
        return;
      }
      toast.success("Saved");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-slate-800 bg-slate-950 p-3 text-sm">
        <div className="text-xs uppercase tracking-wide text-slate-500">Current</div>
        <div className="mt-0.5 font-mono text-slate-100">
          {initial.customDomain ? initial.customDomain : <span className="text-slate-500">none — using platform host</span>}
        </div>
        {initial.customDomain && (
          <div className="mt-1 text-xs">
            {verified ? (
              <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-emerald-300">
                Verified · {new Date(initial.customDomainVerifiedAt!).toLocaleDateString()}
              </span>
            ) : (
              <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-amber-300">
                Awaiting verification
              </span>
            )}
          </div>
        )}
        <div className="mt-2 text-xs text-slate-500">
          Fallback slug URL still works:{" "}
          <code className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300">/t/{tenantSlug}/…</code>
        </div>
      </div>

      {canManage && (
        <div className="rounded-md border border-slate-800 p-3">
          <Label htmlFor="cd" className="text-slate-300">
            {initial.customDomain ? "Update domain" : "Set custom domain"}
          </Label>
          <div className="mt-2 flex gap-2">
            <Input
              id="cd"
              value={domain}
              onChange={(e) => setDomain(e.target.value.trim().toLowerCase())}
              placeholder="app.example.com"
              className="border-slate-700 bg-slate-950 font-mono text-slate-100"
            />
            <Button onClick={() => patch({ customDomain: domain || null })} disabled={!dirty || busy}>
              Save
            </Button>
            {initial.customDomain && (
              <Button
                variant="outline"
                onClick={async () => {
                  const ok = await openConfirm({
                    title: "Unlink the custom domain?",
                    body: "Tenants will lose access via this hostname until a new one is verified.",
                    destructive: true,
                    confirmLabel: "Unlink",
                  });
                  if (!ok) return;
                  setDomain("");
                  void patch({ customDomain: null });
                }}
                disabled={busy}
                className="border-slate-700 text-slate-200 hover:bg-slate-800"
              >
                Unlink
              </Button>
            )}
          </div>

          {initial.customDomain && (
            <div className="mt-3 flex gap-2">
              <Button
                onClick={() => patch({ customDomain: initial.customDomain, verified: !verified })}
                disabled={busy}
                variant={verified ? "outline" : "default"}
                className={verified ? "border-slate-700 text-slate-200 hover:bg-slate-800" : ""}
              >
                {verified ? "Mark unverified" : "Mark verified"}
              </Button>
            </div>
          )}

          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-slate-400 hover:text-slate-200">
              DNS &amp; SSL setup steps
            </summary>
            <ol className="mt-2 space-y-1 pl-4 text-xs text-slate-400">
              <li>
                1. In the tenant's DNS provider, add a CNAME from{" "}
                <code className="rounded bg-slate-800 px-1 text-slate-300">{domain || "app.example.com"}</code>{" "}
                to your platform's hosted address.
              </li>
              <li>2. Wait for DNS propagation (5–60 minutes typical).</li>
              <li>3. Your hosting provider provisions an SSL certificate for that hostname.</li>
              <li>
                4. Verify by visiting{" "}
                <code className="rounded bg-slate-800 px-1 text-slate-300">https://{domain || "app.example.com"}/login</code>{" "}
                — if it loads cleanly, click <b>Mark verified</b>.
              </li>
            </ol>
          </details>
        </div>
      )}
    </div>
  );
}
