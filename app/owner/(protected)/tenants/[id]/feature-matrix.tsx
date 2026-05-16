"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FEATURES, type FeatureKey } from "@/lib/features";

type Row = { key: FeatureKey; enabled: boolean };

const GROUP_LABELS: Record<string, string> = {
  operations: "Operations",
  people: "People",
  facility: "Facility",
  finance: "Finance",
  advanced: "Advanced",
};

export function FeatureMatrix({
  tenantId,
  initial,
  allowOverrides,
}: {
  tenantId: string;
  initial: Row[];
  allowOverrides: boolean;
}) {
  const router = useRouter();
  // Local state mirrors the server so toggling feels instant. Server is still
  // the source of truth — on save failure we revert.
  const [state, setState] = useState<Map<FeatureKey, boolean>>(() => new Map(initial.map((r) => [r.key, r.enabled])));
  const [busyKey, setBusyKey] = useState<FeatureKey | null>(null);

  async function toggle(key: FeatureKey) {
    if (!allowOverrides) {
      toast.error("Switch this tenant to Enterprise to toggle features individually.");
      return;
    }
    const current = state.get(key) ?? false;
    const next = !current;
    setBusyKey(key);
    // Optimistic update.
    setState((prev) => new Map(prev).set(key, next));
    try {
      const res = await fetch(`/api/owner/tenants/${tenantId}/features`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ featureKey: key, enabled: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Failed");
        // Revert optimistic update on error.
        setState((prev) => new Map(prev).set(key, current));
        return;
      }
      toast.success(`${key}: ${next ? "ON" : "OFF"}`);
      router.refresh();
    } finally {
      setBusyKey(null);
    }
  }

  // Group rendering: order from FEATURES is the canonical display order.
  const groups: Record<string, typeof FEATURES[number][]> = {};
  for (const f of FEATURES) {
    (groups[f.group] ??= []).push(f);
  }

  return (
    <div className="space-y-5">
      {!allowOverrides && (
        <div className="rounded-md border border-amber-700 bg-amber-950/50 p-3 text-sm text-amber-200">
          <span className="font-semibold">Plan locked.</span> Starter and Pro tenants get exactly
          the bundle their plan dictates. Switch this tenant to <strong>Enterprise</strong> in the
          Plan panel above to enable individual toggles below.
        </div>
      )}

      {Object.entries(groups).map(([group, defs]) => (
        <div key={group}>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            {GROUP_LABELS[group] ?? group}
          </div>
          <ul className="divide-y divide-slate-800 overflow-hidden rounded-md border border-slate-800 bg-slate-950">
            {defs.map((def) => {
              const enabled = state.get(def.key) ?? false;
              const busy = busyKey === def.key;
              return (
                <li
                  key={def.key}
                  className={`flex items-center justify-between gap-4 p-3 ${
                    enabled ? "" : "opacity-80"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-100">{def.label}</span>
                      <code className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                        {def.key}
                      </code>
                      {def.enforcement === "wired" ? (
                        <span
                          className="rounded bg-emerald-900/40 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300"
                          title="Toggle off blocks both UI and API. Safe billable gate."
                        >
                          Wired
                        </span>
                      ) : (
                        <span
                          className="rounded bg-amber-900/40 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300"
                          title="Toggle hides the sidebar but API endpoints are not yet gated. Do not sell as a hard guarantee."
                        >
                          UI-only
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">{def.description}</div>
                  </div>

                  <div className="flex shrink-0 items-center gap-3">
                    <span
                      className={`min-w-[28px] text-right text-[11px] font-semibold uppercase tracking-wider ${
                        enabled ? "text-emerald-400" : "text-slate-500"
                      }`}
                    >
                      {enabled ? "On" : "Off"}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggle(def.key)}
                      disabled={busy || !allowOverrides}
                      aria-pressed={enabled}
                      aria-label={`${def.label} — currently ${enabled ? "on" : "off"}`}
                      title={
                        !allowOverrides
                          ? "Plan doesn't allow individual toggles"
                          : enabled ? "Click to turn off" : "Click to turn on"
                      }
                      className={[
                        "relative inline-flex h-7 w-14 shrink-0 items-center rounded-full border transition-colors",
                        enabled
                          ? "border-emerald-400 bg-emerald-500"
                          : "border-slate-600 bg-slate-700",
                        busy ? "animate-pulse" : "",
                        !allowOverrides ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:brightness-110",
                      ].join(" ")}
                    >
                      <span
                        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform ${
                          enabled ? "translate-x-8" : "translate-x-1"
                        }`}
                      />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
