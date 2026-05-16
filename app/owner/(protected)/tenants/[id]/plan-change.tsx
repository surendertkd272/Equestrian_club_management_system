"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { openConfirm } from "@/components/ui/confirm-dialog";
import { PLAN_REGISTRY, type PlanKey } from "@/lib/plans";

export function PlanChange({
  tenantId,
  currentPlan,
  centreCount,
}: {
  tenantId: string;
  currentPlan: PlanKey;
  centreCount: number;
}) {
  const router = useRouter();
  const [plan, setPlan] = useState<PlanKey>(currentPlan);
  const [busy, setBusy] = useState(false);

  const dirty = plan !== currentPlan;
  const maxCentresForChoice = PLAN_REGISTRY[plan].maxCentres;
  const wouldExceedCap = centreCount > maxCentresForChoice;

  async function save() {
    if (!dirty) return;
    const ok = await openConfirm({
      title: `Change plan from ${currentPlan} to ${plan}?`,
      body: `This will reseed feature toggles to the ${plan} bundle.`,
      confirmLabel: "Change plan",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/owner/tenants/${tenantId}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          data.error === "TOO_MANY_CENTRES"
            ? `Tenant has ${data.details?.centreCount} centres; ${plan} allows ${data.details?.maxCentres}. Move centres first.`
            : data.error === "SAME_PLAN"
              ? "Already on that plan."
              : (data.error ?? "Failed");
        toast.error(msg);
        return;
      }
      toast.success(`Plan changed to ${plan}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="plan-select" className="block text-xs text-slate-400">Plan</label>
          <select
            id="plan-select"
            value={plan}
            onChange={(e) => setPlan(e.target.value as PlanKey)}
            className="mt-1 h-10 rounded-md border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100"
          >
            <option value="starter">Starter (max 1 centre)</option>
            <option value="pro">Pro (max 5 centres)</option>
            <option value="enterprise">Enterprise (unlimited)</option>
          </select>
        </div>
        <Button onClick={save} disabled={!dirty || busy || wouldExceedCap}>
          {busy ? "Changing…" : "Change plan"}
        </Button>
        {dirty && (
          <Button
            variant="outline"
            onClick={() => setPlan(currentPlan)}
            disabled={busy}
            className="border-slate-700 text-slate-200 hover:bg-slate-800"
          >
            Cancel
          </Button>
        )}
      </div>
      {wouldExceedCap && (
        <p className="text-xs text-rose-400">
          {plan} allows {maxCentresForChoice === Infinity ? "unlimited" : maxCentresForChoice} centre(s);
          this tenant has {centreCount}. Downgrade blocked.
        </p>
      )}
      <p className="text-xs text-slate-500">
        Changing the plan rewrites every feature toggle to match the new bundle. Enterprise can
        be customised after the change.
      </p>
    </div>
  );
}
