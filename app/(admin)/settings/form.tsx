"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export function PublicContactForm({
  initial,
  defaultEmail,
}: {
  initial: { supportEmail: string; supportPhone: string };
  defaultEmail: string;
}) {
  const router = useRouter();
  const [supportEmail, setSupportEmail] = useState(initial.supportEmail);
  const [supportPhone, setSupportPhone] = useState(initial.supportPhone);
  const [busy, setBusy] = useState(false);

  const dirty = supportEmail.trim() !== initial.supportEmail || supportPhone.trim() !== initial.supportPhone;

  async function save() {
    setBusy(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supportEmail: supportEmail.trim(), supportPhone: supportPhone.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.details?.fieldErrors?.supportEmail?.[0] ?? data.error ?? "Couldn't save");
        return;
      }
      toast.success("Contact details saved");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid max-w-lg gap-3">
      <div>
        <Label htmlFor="s-email">Support / Contact Email</Label>
        <Input
          id="s-email"
          type="email"
          value={supportEmail}
          onChange={(e) => setSupportEmail(e.target.value)}
          placeholder={defaultEmail}
        />
      </div>
      <div>
        <Label htmlFor="s-phone">Contact Phone</Label>
        <Input
          id="s-phone"
          value={supportPhone}
          onChange={(e) => setSupportPhone(e.target.value)}
          placeholder="Optional"
        />
      </div>
      <div>
        <Button onClick={save} disabled={busy || !dirty}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
