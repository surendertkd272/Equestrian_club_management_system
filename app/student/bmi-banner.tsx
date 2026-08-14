"use client";

// One-shot BMI heads-up for the rider. Shows when their BMI band is
// outside normal; dismissible — the dismissal is persisted in
// localStorage keyed on riderId so they don't see it again on the
// same browser. Cleared automatically if the BMI value changes
// (the key includes a rounded BMI so a new measurement re-prompts).

import { useEffect, useState } from "react";
import { bmiBand, bmiBandLabel, bmiNeedsAttention, type BmiBand } from "@/lib/bmi";

export function BmiBanner({ riderId, bmi }: { riderId: string; bmi: number | null }) {
  const band: BmiBand = bmiBand(bmi);
  // Key includes the rounded BMI so a new measurement (e.g. 30.2 → 27.8
  // after a year of training) re-triggers the banner once.
  const storageKey = bmi ? `bmi-banner:${riderId}:${Math.round(bmi)}` : null;
  const [dismissed, setDismissed] = useState(true); // start dismissed to dodge SSR flash

  useEffect(() => {
    if (!storageKey) return;
    try {
      setDismissed(window.localStorage.getItem(storageKey) === "1");
    } catch {
      setDismissed(false);
    }
  }, [storageKey]);

  if (!bmiNeedsAttention(band) || dismissed || !storageKey) return null;

  function dismiss() {
    try {
      window.localStorage.setItem(storageKey!, "1");
    } catch {
      // Quota / private-mode — fall back to in-memory.
    }
    setDismissed(true);
  }

  const tone =
    band === "obese"
      ? "border-danger/30 bg-danger-soft text-danger-foreground"
      : "border-warning/30 bg-warning-soft text-warning-foreground";

  return (
    <div className={`flex items-start justify-between gap-3 rounded-md border-2 px-4 py-3 text-sm ${tone}`}>
      <div>
        <div className="font-semibold">Heads up about your BMI ({bmi?.toFixed(1)})</div>
        <p className="mt-1 text-xs">
          {bmiBandLabel(band)}. Talk to your coach or parents about a healthy plan — riding is more fun when
          you're at your healthiest. Note: the band shown uses adult thresholds; the real number for a young
          rider depends on age. Your coach can advise.
        </p>
      </div>
      <button type="button" onClick={dismiss} aria-label="Dismiss" className="ml-2 text-current opacity-70 hover:opacity-100">
        ✕
      </button>
    </div>
  );
}
