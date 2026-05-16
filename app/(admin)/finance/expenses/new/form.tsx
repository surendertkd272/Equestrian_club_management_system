"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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
    if (form.paid) {
      payload.paidAt = form.paidAt;
      payload.method = form.method;
    }
    const res = await fetch("/api/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      toast.error(d.error ?? "Failed");
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
          <Select value={form.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                [{c.group}] {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Vendor</Label>
          <Select value={form.vendorId} onChange={(e) => set("vendorId", e.target.value)}>
            <option value="">— None —</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Date of expense *</Label>
          <Input required type="date" value={form.spentAt} onChange={(e) => set("spentAt", e.target.value)} />
        </div>
        <div>
          <Label>Amount (₹) *</Label>
          <Input
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
          <Input
            type="number"
            min={0}
            step="0.01"
            value={form.gstAmount}
            onChange={(e) => set("gstAmount", e.target.value)}
          />
        </div>
        <div>
          <Label>Vendor invoice ref</Label>
          <Input value={form.invoiceRef} onChange={(e) => set("invoiceRef", e.target.value)} placeholder="optional" />
        </div>
        <div className="md:col-span-2">
          <Label>Description *</Label>
          <Textarea
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
                <Label className="!mb-1 !text-[10px]">Paid on</Label>
                <Input type="date" value={form.paidAt} onChange={(e) => set("paidAt", e.target.value)} />
              </div>
              <div>
                <Label className="!mb-1 !text-[10px]">Method</Label>
                <Select value={form.method} onChange={(e) => set("method", e.target.value)}>
                  <option value="cash">Cash</option>
                  <option value="bank">Bank transfer</option>
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
