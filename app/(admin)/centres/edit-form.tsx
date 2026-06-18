"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";

type Initial = { name: string; address: string; gstNo: string };

export function CentreEditForm({ id, initial }: { id: string; initial: Initial }) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [address, setAddress] = useState(initial.address);
  const [gstNo, setGstNo] = useState(initial.gstNo);
  const [busy, setBusy] = useState(false);

  const dirty =
    name !== initial.name || address !== initial.address || gstNo !== initial.gstNo;
  useUnsavedChanges(dirty && !busy);

  async function save() {
    if (!dirty) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/centres/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name !== initial.name ? name : undefined,
          address: address !== initial.address ? address || null : undefined,
          gstNo: gstNo !== initial.gstNo ? gstNo || null : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Failed");
        return;
      }
      toast.success("Saved");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setName(initial.name);
    setAddress(initial.address);
    setGstNo(initial.gstNo);
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <Label htmlFor={`c-name-${id}`}>Club name</Label>
        <Input id={`c-name-${id}`} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <Label htmlFor={`c-gst-${id}`}>GST number</Label>
        <Input
          id={`c-gst-${id}`}
          value={gstNo}
          onChange={(e) => setGstNo(e.target.value.toUpperCase())}
          placeholder="15-char GST (optional)"
          maxLength={15}
        />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor={`c-addr-${id}`}>Address</Label>
        <Input
          id={`c-addr-${id}`}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Street, city, state"
        />
      </div>
      <div className="sm:col-span-2 flex gap-2">
        <Button onClick={save} disabled={!dirty || busy}>
          {busy ? "Saving…" : "Save changes"}
        </Button>
        {dirty && (
          <Button variant="outline" onClick={reset} disabled={busy}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}
