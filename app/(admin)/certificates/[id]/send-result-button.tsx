"use client";

// Staff-triggered 'Send result to parent' button for the certificate
// page. Shows as primary when the email hasn't been sent yet, and as
// secondary 'Resend' (with the last-sent timestamp) after the first
// send. Confirms before resending to prevent accidental double-clicks.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Mail, MailCheck } from "lucide-react";
import { openConfirm } from "@/components/ui/confirm-dialog";

export function SendResultButton({
  certId,
  alreadySentAt,
  parentEmail,
}: {
  certId: string;
  // ISO string of the previous send (null on first run).
  alreadySentAt: string | null;
  // For showing the recipient in the confirm dialog. Optional — if null,
  // the API still resolves it server-side; we just won't preview here.
  parentEmail: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const sent = !!alreadySentAt;

  async function send() {
    if (sent) {
      const ok = await openConfirm({
        title: "Resend result to parent?",
        body: `The result email was already sent${alreadySentAt ? ` at ${new Date(alreadySentAt).toLocaleString("en-IN")}` : ""}. Sending again will deliver a fresh copy to ${parentEmail ?? "the parent's email on file"}.`,
        confirmLabel: "Resend",
      });
      if (!ok) return;
    } else if (parentEmail) {
      const ok = await openConfirm({
        title: "Send result to parent?",
        body: `An email with the score breakdown will go to ${parentEmail}. Once sent, you'll see the timestamp here.`,
        confirmLabel: "Send",
      });
      if (!ok) return;
    }

    setBusy(true);
    try {
      const res = await fetch(`/api/certificates/${certId}/email-result`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.error === "NO_PARENT_EMAIL") {
          toast.error("No email on file — add one to the rider profile first");
        } else if (data.error === "NO_EXAM_LINKED") {
          toast.error("This certificate isn't tied to an exam");
        } else {
          toast.error(data.message ?? data.error ?? "Send failed");
        }
        return;
      }
      toast.success(`Result emailed to ${data.sentTo}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={send}
      disabled={busy}
      className={
        sent
          ? "inline-flex items-center gap-1.5 rounded-md border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
          : "inline-flex items-center gap-1.5 rounded-md border border-primary bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      }
      title={
        sent
          ? `Last sent ${alreadySentAt ? new Date(alreadySentAt).toLocaleString("en-IN") : ""}`
          : "Email the result breakdown to the parent"
      }
    >
      {sent ? <MailCheck className="h-3.5 w-3.5" /> : <Mail className="h-3.5 w-3.5" />}
      {busy ? "Sending…" : sent ? "Resend to parent" : "Send result to parent"}
    </button>
  );
}
