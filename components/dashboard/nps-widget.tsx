"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

// Compact NPS prompt on the dashboard. Shows once per 90 days per user
// (LocalStorage gate + server-side 90-day dedup). The user picks 0–10
// and can add an optional comment. We deliberately don't model "we'd
// like to follow up" — that's a follow-up email from your inbox.

const LS_KEY = "ew-nps-shown-at";
const COOLDOWN_DAYS = 90;

export function NpsWidget() {
  const [open, setOpen] = useState(false);
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    try {
      const lastStr = localStorage.getItem(LS_KEY);
      const last = lastStr ? Number(lastStr) : 0;
      const cooldownMs = COOLDOWN_DAYS * 86400000;
      if (Date.now() - last > cooldownMs) {
        // Wait a few seconds before opening so it doesn't slam the user.
        const t = setTimeout(() => setOpen(true), 3500);
        return () => clearTimeout(t);
      }
    } catch {}
  }, []);

  function dismiss() {
    try { localStorage.setItem(LS_KEY, String(Date.now())); } catch {}
    setOpen(false);
  }

  async function submit() {
    if (score === null) return;
    setBusy(true);
    try {
      const res = await fetch("/api/account/nps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score, comment: comment.trim() || null, context: "dashboard" }),
      });
      if (!res.ok) {
        toast.error("Couldn't save — try again.");
        return;
      }
      setDone(true);
      try { localStorage.setItem(LS_KEY, String(Date.now())); } catch {}
      setTimeout(() => setOpen(false), 1800);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[320px] rounded-lg border bg-card p-4 shadow-lg">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm font-semibold">How likely are you to recommend Equiwings?</div>
          {!done && <div className="mt-1 text-xs text-muted-foreground">0 = not at all · 10 = absolutely</div>}
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ✕
        </button>
      </div>

      {done ? (
        <p className="mt-3 text-sm text-emerald-700">Thanks — noted.</p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {Array.from({ length: 11 }).map((_, n) => (
              <button
                key={n}
                type="button"
                onClick={() => setScore(n)}
                className={`h-7 w-7 rounded text-xs font-medium ${score === n ? "bg-primary text-primary-foreground" : "border bg-card hover:bg-accent"}`}
              >
                {n}
              </button>
            ))}
          </div>
          {score !== null && (
            <>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={score >= 9 ? "What made you a fan?" : score <= 6 ? "What would change your mind?" : "Anything we could improve?"}
                className="mt-3 min-h-[60px] w-full rounded-md border bg-card p-2 text-xs"
              />
              <div className="mt-2 flex justify-end gap-2">
                <button type="button" onClick={dismiss} className="rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
                  Maybe later
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={busy}
                  className="rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
                >
                  {busy ? "Saving…" : "Send"}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
