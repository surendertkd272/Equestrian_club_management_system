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

export function HqExpenseForm({
  categories,
  centres,
}: {
  categories: { id: string; name: string; group: string }[];
  centres: { id: string; name: string }[];
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
    paid: false,
    paidAt: today,
    method: "bank",
    attachmentUrl: "",
  });
  const [taggedCentreIds, setTaggedCentreIds] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  function set<K extends keyof typeof form>(k: K, v: any) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function toggleCentre(id: string) {
    setTaggedCentreIds((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    );
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
    const res = await fetch("/api/hq-expenses", {
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
        taggedCentreIds,
        paid: form.paid,
        paidAt: form.paid ? form.paidAt : undefined,
        method: form.paid ? form.method : undefined,
        attachmentUrl: form.attachmentUrl,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Failed");
      return;
    }
    toast.success("HQ expense recorded");
    setForm({
      amount: "",
      gstAmount: "0",
      spentAt: today,
      description: "",
      vendorName: "",
      invoiceRef: "",
      categoryId: "",
      paid: false,
      paidAt: today,
      method: "bank",
      attachmentUrl: "",
    });
    setTaggedCentreIds([]);
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
          <Label>Date of Expense *</Label>
          <Input aria-label="Date of expense"
            required
            type="date"
            value={form.spentAt}
            onChange={(e) => set("spentAt", e.target.value)}
          />
        </div>
        <div>
          <Label>Vendor Name</Label>
          <Input aria-label="Vendor name"
            value={form.vendorName}
            onChange={(e) => set("vendorName", e.target.value)}
            placeholder="e.g. ICICI Lombard, Microsoft"
          />
        </div>
        <div>
          <Label>Invoice Ref</Label>
          <Input aria-label="Invoice ref"
            value={form.invoiceRef}
            onChange={(e) => set("invoiceRef", e.target.value)}
            placeholder="optional"
          />
        </div>
        <div>
          <Label>Category</Label>
          <Select aria-label="Category" value={form.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
            <option value="">— pick if applicable —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                [{c.group}] {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="md:col-span-2">
          <Label>Description *</Label>
          <Textarea aria-label="Description"
            required
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            rows={2}
            placeholder='e.g. "Annual fleet insurance renewal — Equiwings Group"'
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Allocate to Clubs (optional)</Label>
        <div className="text-xs text-muted-foreground">
          Leave all unchecked if this is a pure HQ overhead (insurance, software). Tick clubs the
          expense should be split across for cost-allocation reports.
        </div>
        <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
          {centres.map((c) => (
            <label key={c.id} className="flex items-center gap-2 rounded-md border p-2 text-sm">
              <input
                type="checkbox"
                checked={taggedCentreIds.includes(c.id)}
                onChange={() => toggleCentre(c.id)}
              />
              <span>{c.name}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Label className="!mb-0">
          <input
            type="checkbox"
            checked={form.paid}
            onChange={(e) => set("paid", e.target.checked)}
            className="mr-1.5"
          />
          Paid
        </Label>
        {form.paid && (
          <>
            <div>
              <Label className="!mb-1 !text-[10px]">Paid On</Label>
              <Input aria-label="Paid on" type="date" value={form.paidAt} onChange={(e) => set("paidAt", e.target.value)} />
            </div>
            <div>
              <Label className="!mb-1 !text-[10px]">Method</Label>
              <Select aria-label="Method" value={form.method} onChange={(e) => set("method", e.target.value)}>
                <option value="bank">Bank Transfer</option>
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
                <option value="cheque">Cheque</option>
                <option value="card">Card</option>
              </Select>
            </div>
          </>
        )}
      </div>

      <Button type="submit" disabled={saving || uploading || !form.attachmentUrl}>
        {saving ? "Saving…" : "Record HQ expense"}
      </Button>
    </form>
  );
}
