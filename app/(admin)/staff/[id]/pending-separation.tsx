"use client";

// A pending separation notice, shown on the staff profile with the way to take
// it back.
//
// Without this the page looked identical before and after issuing: the button
// still read "Issue separation", User.status only changes when the EMPLOYEE
// responds, and every click created another notice plus another
// criticality:"critical" alert to someone who has already been told once.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { openConfirm } from "@/components/ui/confirm-dialog";

export function PendingSeparationNotice({
  userId,
  userName,
  noticeId,
  kind,
  issuedBy,
  issuedAt,
  effectiveAt,
  noticeText,
  canWithdraw,
  canFinalise,
}: {
  userId: string;
  userName: string;
  noticeId: string;
  kind: string;
  issuedBy: string;
  issuedAt: string;
  effectiveAt: string | null;
  noticeText: string;
  canWithdraw: boolean;
  /** Effective date has passed and the employee still hasn't responded. */
  canFinalise: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function withdraw() {
    const ok = await openConfirm({
      title: `Withdraw this notice?`,
      body: `${userName} stays on staff and the notice is cancelled. They keep the notification they already received, so tell them.`,
      confirmLabel: "Withdraw notice",
    });
    if (!ok) return;
    setBusy(true);
    const res = await fetch(`/api/users/${userId}/separation`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ noticeId }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      toast.error(data.message ?? data.error ?? "Couldn't withdraw the notice");
      return;
    }
    toast.success("Notice withdrawn");
    router.refresh();
  }

  async function finalise() {
    const ok = await openConfirm({
      title: `Close ${userName}'s separation?`,
      body:
        "The notice period has passed with no response. This ends their employment on the record, signs them out everywhere, and marks their staff record " +
        (kind === "termination" ? "terminated" : "resigned") +
        ". It cannot be undone from here.",
      destructive: true,
      confirmLabel: "Close separation",
    });
    if (!ok) return;
    setBusy(true);
    const res = await fetch(`/api/users/${userId}/separation`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ noticeId, action: "finalise" }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      toast.error(data.message ?? data.error ?? "Couldn't close the separation");
      return;
    }
    toast.success(`${userName} is now ${data.newStatus}`);
    router.refresh();
  }

  const label = kind === "termination" ? "Termination notice" : "Resignation requested";

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 text-sm text-amber-900 dark:text-amber-200">
          <p className="font-medium">
            {label} — awaiting {userName}&apos;s response
          </p>
          <p className="text-xs">
            Issued by {issuedBy} on {new Date(issuedAt).toLocaleDateString("en-IN", { dateStyle: "medium" })}
            {effectiveAt
              ? ` · effective ${new Date(effectiveAt).toLocaleDateString("en-IN", { dateStyle: "medium" })}`
              : ""}
          </p>
          <p className="text-xs opacity-90">&ldquo;{noticeText}&rdquo;</p>
          <p className="text-xs opacity-80">
            {canFinalise
              ? "The notice period has passed and they haven't responded — you can close it without them."
              : "They stay active until they respond at /account/separation."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canWithdraw && (
            <Button size="sm" variant="outline" onClick={withdraw} disabled={busy}>
              Withdraw notice
            </Button>
          )}
          {canFinalise && (
            <Button size="sm" variant="destructive" onClick={finalise} disabled={busy}>
              Close without response
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
