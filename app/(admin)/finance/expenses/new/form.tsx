"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { postJson } from "@/lib/client/post-json";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export function NewExpenseForm({
  categories,
  vendors,
}: {
  categories: { id: string; name: string; group: string }[];
  vendors: { id: string; name: string }[];
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    categoryId: categories[0]?.id ?? "",
    vendorId: "",
    qty: "",
    unitRate: "",
    amount: "",
    gstAmount: "0",
    spentAt: today,
    description: "",
    invoiceRef: "",
    paid: false,
    paidAt: today,
    method: "cash",
  });
  const [saving, setSaving] = useState(false);

  function set<K extends keyof typeof form>(k: K, v: any) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  // Qty + unit rate are optional; when both are present we auto-fill the
  // total amount (qty × rate). The amount field stays editable for overrides.
  function setQtyOrRate(k: "qty" | "unitRate", v: string) {
    setForm((f) => {
      const next = { ...f, [k]: v };
      const q = parseFloat(next.qty);
      const r = parseFloat(next.unitRate);
      if (!Number.isNaN(q) && !Number.isNaN(r)) next.amount = String(Number((q * r).toFixed(2)));
      return next;
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.categoryId || !form.amount || !form.description) {
      toast.error("Category, amount, and description are required.");
      return;
    }
    setSaving(true);
    const payload: any = {
      categoryId: form.categoryId,
      vendorId: form.vendorId || undefined,
      amount: Number(form.amount),
      gstAmount: Number(form.gstAmount) || 0,
      spentAt: form.spentAt,
      description: form.description,
      paid: form.paid,
    };
    if (form.invoiceRef) payload.invoiceRef = form.invoiceRef;
    if (form.qty) payload.qty = Number(form.qty);
    if (form.unitRate) payload.unitRate = Number(form.unitRate);
    if (form.paid) {
      payload.paidAt = form.paidAt;
      payload.method = form.method;
    }
    const res = await postJson("/api/expenses", payload);
    setSaving(false);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    toast.success("Expense booked");
    router.push("/finance/expenses");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <Label>Category *</Label>
          <Select aria-label="Category" value={form.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                [{c.group}] {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Vendor</Label>
          <Select aria-label="Vendor" value={form.vendorId} onChange={(e) => set("vendorId", e.target.value)}>
            <option value="">— None —</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Date of Expense *</Label>
          <Input aria-label="Date of expense" required type="date" value={form.spentAt} onChange={(e) => set("spentAt", e.target.value)} />
        </div>
        <div>
          <Label>Qty</Label>
          <Input aria-label="Qty"
            type="number"
            min={0}
            step="any"
            value={form.qty}
            onChange={(e) => setQtyOrRate("qty", e.target.value)}
            placeholder="e.g. 30 (optional)"
          />
        </div>
        <div>
          <Label>Unit Rate (₹)</Label>
          <Input aria-label="Unit rate (₹)"
            type="number"
            min={0}
            step="any"
            value={form.unitRate}
            onChange={(e) => setQtyOrRate("unitRate", e.target.value)}
            placeholder="per unit (optional)"
          />
        </div>
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
          {form.qty && form.unitRate && (
            <p className="mt-1 text-[11px] text-muted-foreground">Auto-filled from Qty × Unit rate (editable).</p>
          )}
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
          <Label>Vendor Invoice Ref</Label>
          <Input aria-label="Vendor invoice ref" value={form.invoiceRef} onChange={(e) => set("invoiceRef", e.target.value)} placeholder="optional" />
        </div>
        <div className="md:col-span-2">
          <Label>Description *</Label>
          <Textarea aria-label="Description"
            required
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            rows={2}
            placeholder='e.g. "August hay bales — 30 × 50kg"'
          />
        </div>
        <div className="md:col-span-2 flex items-center gap-3">
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
                  <option value="cash">Cash</option>
                  <option value="bank">Bank Transfer</option>
                  <option value="upi">UPI</option>
                  <option value="cheque">Cheque</option>
                  <option value="card">Card</option>
                </Select>
              </div>
            </>
          )}
        </div>
      </div>
      <Button type="submit" disabled={saving}>
        {saving ? "Saving…" : "Book expense"}
      </Button>
    </form>
  );
}
