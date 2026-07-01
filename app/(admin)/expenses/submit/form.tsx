"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { compressForKind } from "@/lib/image-compress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export function SubmitExpenseForm({
  categories,
}: {
  categories: { id: string; name: string; group: string }[];
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);

  const [form, setForm] = useState({
    amount: "",
    gstAmount: "0",
    spentAt: today,
    description: "",
    vendorName: "",
    invoiceRef: "",
    categoryId: "",
    attachmentUrl: "",
  });
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function onPickFile(file: File) {
    setUploading(true);
    try {
      const compressed = await compressForKind(file, "expense_invoice");
      const fd = new FormData();
      fd.append("kind", "expense_invoice");
      fd.append("file", compressed);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.message ?? err.error ?? "Upload failed");
        return;
      }
      const data = await res.json();
      set("attachmentUrl", data.url as string);
      toast.success("Invoice uploaded");
    } finally {
      setUploading(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.attachmentUrl) {
      toast.error("Please upload the invoice first.");
      return;
    }
    if (!form.amount || !form.description) {
      toast.error("Amount and description are required.");
      return;
    }
    setSaving(true);
    const res = await fetch("/api/expenses/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: Number(form.amount),
        gstAmount: Number(form.gstAmount) || 0,
        spentAt: form.spentAt,
        description: form.description,
        vendorName: form.vendorName || undefined,
        invoiceRef: form.invoiceRef || undefined,
        categoryId: form.categoryId || undefined,
        attachmentUrl: form.attachmentUrl,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Failed to submit");
      return;
    }
    toast.success("Invoice submitted");
    setForm({
      amount: "",
      gstAmount: "0",
      spentAt: today,
      description: "",
      vendorName: "",
      invoiceRef: "",
      categoryId: "",
      attachmentUrl: "",
    });
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label>Invoice File *</Label>
        {form.attachmentUrl ? (
          <div className="flex items-center gap-2 text-sm">
            <a
              href={form.attachmentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline"
            >
              View uploaded invoice
            </a>
            <button
              type="button"
              onClick={() => set("attachmentUrl", "")}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Replace
            </button>
          </div>
        ) : (
          <Input
            type="file"
            accept="image/jpeg,image/png,application/pdf"
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onPickFile(file);
              e.target.value = "";
            }}
          />
        )}
        {uploading && <div className="text-xs text-muted-foreground">Uploading…</div>}
        <div className="text-xs text-muted-foreground">JPG, PNG, or PDF. Max 10 MB.</div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <Label>Amount (₹) *</Label>
          <Input aria-label="Amount (₹)"
            required
            type="number"
            min={0}
            step="0.01"
            value={form.amount}
            onChange={(e) => set("amount", e.target.value)}
          />
        </div>
        <div>
          <Label>GST (₹)</Label>
          <Input aria-label="GST (₹)"
            type="number"
            min={0}
            step="0.01"
            value={form.gstAmount}
            onChange={(e) => set("gstAmount", e.target.value)}
          />
        </div>
        <div>
          <Label>Date of Purchase *</Label>
          <Input aria-label="Date of purchase"
            required
            type="date"
            value={form.spentAt}
            onChange={(e) => set("spentAt", e.target.value)}
          />
        </div>
        <div>
          <Label>Vendor / Shop Name</Label>
          <Input aria-label="Vendor / shop name"
            value={form.vendorName}
            onChange={(e) => set("vendorName", e.target.value)}
            placeholder="e.g. Krishna Feeds, Apollo Pharmacy"
          />
        </div>
        <div>
          <Label>Invoice Number</Label>
          <Input aria-label="Invoice number"
            value={form.invoiceRef}
            onChange={(e) => set("invoiceRef", e.target.value)}
            placeholder="optional"
          />
        </div>
        <div>
          <Label>Category</Label>
          <Select aria-label="Category" value={form.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
            <option value="">— pick if you know —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                [{c.group}] {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="md:col-span-2">
          <Label>What Did You Buy? *</Label>
          <Textarea aria-label="What did you buy?"
            required
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            rows={2}
            placeholder='e.g. "2 boxes of hoof oil + farrier nails for Bijli"'
          />
        </div>
      </div>

      <Button type="submit" disabled={saving || uploading || !form.attachmentUrl} className="w-full">
        {saving ? "Submitting…" : "Submit invoice"}
      </Button>
    </form>
  );
}
