"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { postJson } from "@/lib/client/post-json";

// Drop-down on a user row for HQ admins to issue a termination /
// resignation_request notice. The user receives it on /account/separation
// and writes their reason; on submit their User.status flips.

export function SeparationTrigger({
  userId,
  userName,
  disabled,
}: {
  userId: string;
  userName: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"termination" | "resignation_request">("resignation_request");
  const [noticeText, setNoticeText] = useState("");
  const [effectiveAt, setEffectiveAt] = useState("");
  const [busy, setBusy] = useState(false);

  async function issue() {
    if (noticeText.trim().length < 10) {
      toast.error("Please write a sentence or two of context.");
      return;
    }
    setBusy(true);
    const res = await postJson(`/api/users/${userId}/separation`, {
      kind,
      noticeText: noticeText.trim(),
      effectiveAt: effectiveAt ? new Date(effectiveAt).toISOString() : undefined,
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    toast.success(`Notice issued to ${userName}`);
    setOpen(false);
    setNoticeText("");
    setEffectiveAt("");
    router.refresh();
  }

  if (disabled) return null;

  if (!open) {
    return (
      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setOpen(true)}>
        Issue separation
      </Button>
    );
  }

  return (
    <div className="space-y-2 rounded-md border bg-card p-3 text-sm">
      <div className="space-y-1.5">
        <Label>Kind</Label>
        <Select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="resignation_request">Ask for resignation</option>
          <option value="termination">Termination notice</option>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label>Notice text *</Label>
        <textarea
          value={noticeText}
          onChange={(e) => setNoticeText(e.target.value)}
          rows={3}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          placeholder={
            kind === "termination"
              ? "Reason for termination + notice-period details."
              : "Reason for asking for resignation."
          }
        />
      </div>
      <div className="space-y-1.5">
        <Label>Effective date (defaults to 30 days)</Label>
        <Input aria-label="Effective date (defaults to 30 days)" type="date" value={effectiveAt} onChange={(e) => setEffectiveAt(e.target.value)} />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </Button>
        <Button size="sm" variant="destructive" onClick={issue} disabled={busy}>
          {busy ? "Issuing…" : "Issue notice"}
        </Button>
      </div>
    </div>
  );
}
