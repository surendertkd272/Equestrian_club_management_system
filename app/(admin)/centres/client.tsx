"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { openConfirm } from "@/components/ui/confirm-dialog";
import { Copy, Check } from "lucide-react";

// The centre's public signup link. The slug stays lowercase (it's a URL), but
// we present it as the actual shareable link with a copy button rather than a
// bare "slug:" token, so it reads as a URL and is genuinely useful.
export function SignupLink({ slug, baseUrl }: { slug: string; baseUrl: string }) {
  const [copied, setCopied] = useState(false);
  const path = `/onboarding?centre=${slug}`;
  const url = (baseUrl || (typeof window !== "undefined" ? window.location.origin : "")) + path;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Signup link copied");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy — select and copy it manually");
    }
  }

  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground">
      <span>Public signup:</span>
      <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{path}</code>
      <button
        type="button"
        onClick={copy}
        className="inline-flex items-center gap-1 text-primary hover:underline"
        aria-label="Copy public signup link"
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        {copied ? "Copied" : "Copy link"}
      </button>
    </div>
  );
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}

export function NewCentreCard() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [address, setAddress] = useState("");
  const [gstNo, setGstNo] = useState("");
  const [busy, setBusy] = useState(false);

  function setNameAndAutoslug(v: string) {
    setName(v);
    // Only auto-fill slug while the user hasn't manually edited it.
    if (!slug || slug === slugify(name)) setSlug(slugify(v));
  }

  async function submit() {
    if (!name.trim() || !slug.trim()) {
      toast.error("Name and slug are required");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/centres", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim(),
          address: address.trim() || undefined,
          gstNo: gstNo.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error === "SLUG_TAKEN" ? "That slug is already in use" : data.error ?? "Failed");
        return;
      }
      toast.success("Club created");
      setName("");
      setSlug("");
      setAddress("");
      setGstNo("");
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} variant="outline">
        <Plus className="h-4 w-4" /> New club
      </Button>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>New Club</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="nc-name">Club Name *</Label>
            <Input
              id="nc-name"
              value={name}
              onChange={(e) => setNameAndAutoslug(e.target.value)}
              placeholder="Equiwings Pune"
            />
          </div>
          <div>
            <Label htmlFor="nc-slug">Slug *</Label>
            <Input
              id="nc-slug"
              value={slug}
              onChange={(e) => setSlug(slugify(e.target.value))}
              placeholder="pune"
              maxLength={30}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Used in <code>/onboarding?centre={slug || "…"}</code>. Cannot be changed later.
            </p>
          </div>
          <div>
            <Label htmlFor="nc-gst">GST Number</Label>
            <Input
              id="nc-gst"
              value={gstNo}
              onChange={(e) => setGstNo(e.target.value.toUpperCase())}
              placeholder="Optional"
              maxLength={15}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="nc-addr">Address</Label>
            <Input id="nc-addr" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="sm:col-span-2 flex gap-2">
            <Button onClick={submit} disabled={busy}>
              {busy ? "Creating…" : "Create club"}
            </Button>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function CentreDeleteButton({
  id,
  name,
  isEmpty,
}: {
  id: string;
  name: string;
  isEmpty: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function remove() {
    const ok = await openConfirm({
      title: `Permanently delete "${name}"?`,
      body: "This can't be undone. The club's catalog data (fee plans, progress levels, scoring templates) will also be removed.",
      destructive: true,
      confirmLabel: "Delete club",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/centres/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.error === "NOT_EMPTY") {
          toast.error("Club still has data — clear users/riders/horses first.");
        } else {
          toast.error(data.message ?? data.error ?? "Failed");
        }
        return;
      }
      toast.success(`${name} deleted`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-between">
      <div className="text-xs text-muted-foreground">
        {isEmpty ? (
          <>This club has no data — it can be safely deleted.</>
        ) : (
          <>Delete is only available once all users / riders / horses / etc. have been removed.</>
        )}
      </div>
      <Button variant="outline" size="sm" disabled={!isEmpty || busy} onClick={remove}>
        {busy ? "Deleting…" : "Delete club"}
      </Button>
    </div>
  );
}
