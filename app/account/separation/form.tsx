"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export function SeparationResponseForm({
  noticeId,
  kind,
}: {
  noticeId: string;
  kind: "termination" | "resignation_request";
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function submit() {
    if (text.trim().length < 10) {
      toast.error("Please write at least a sentence.");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/separation/respond", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ noticeId, responseText: text.trim() }),
    });
    setBusy(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Failed");
      return;
    }
    toast.success(
      kind === "termination"
        ? "Acknowledged. You will be signed out shortly."
        : "Resignation submitted. You will be signed out shortly.",
      { duration: 8000 },
    );
    // Brief delay so the toast is visible; then bounce out — the user's
    // session is invalidated server-side already.
    setTimeout(() => {
      router.push("/login");
      router.refresh();
    }, 2000);
  }

  return (
    <div className="space-y-3">
      <div>
        <Label>
          {kind === "termination"
            ? "Your acknowledgement (required)"
            : "Your reason for resignation (required)"}
        </Label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          minLength={10}
          maxLength={2000}
          className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
          placeholder={
            kind === "termination"
              ? "Briefly acknowledge receipt of this notice."
              : "Why are you resigning? Effective date, last-day plans, anything else."
          }
        />
      </div>
      {!confirming ? (
        <Button onClick={() => setConfirming(true)} disabled={text.trim().length < 10}>
          Submit
        </Button>
      ) : (
        <div className="rounded-md border-2 border-destructive bg-destructive/5 p-3 text-sm">
          <p className="mb-2 font-semibold text-destructive">
            Confirm — this signs you out of the system permanently.
          </p>
          <p className="mb-3 text-muted-foreground">
            Your account will be marked {kind === "termination" ? "terminated" : "resigned"} and
            you won't be able to sign back in. The admin can re-activate if needed.
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" onClick={submit} disabled={busy}>
              {busy ? "Submitting…" : "Yes, submit + sign me out"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
