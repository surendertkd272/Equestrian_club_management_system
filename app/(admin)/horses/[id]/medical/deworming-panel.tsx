"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { COMMON_DEWORMERS } from "@/lib/schemas/deworming";
import { formatDate } from "@/lib/utils";

type Entry = {
  id: string;
  product: string;
  scheduledAt: string;
  givenAt: string | null;
  nextDueAt: string | null;
  notes: string | null;
};

type Props = {
  horseId: string;
  canWrite: boolean;
  entries: Entry[];
};

export function DewormingPanel({ horseId, canWrite, entries }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState<{
    product: string;
    customProduct: string;
    scheduledAt: string;
    notes: string;
  }>({
    product: COMMON_DEWORMERS[0],
    customProduct: "",
    scheduledAt: new Date().toISOString().slice(0, 10),
    notes: "",
  });

  async function add() {
    const product = form.product === "custom" ? form.customProduct.trim() : form.product;
    if (!product || product.length < 2) {
      toast.error("Pick or enter a product.");
      return;
    }
    setBusy("__new__");
    try {
      const res = await fetch(`/api/horses/${horseId}/deworming`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product,
          scheduledAt: form.scheduledAt,
          notes: form.notes.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Failed");
        return;
      }
      toast.success("Scheduled");
      setForm((f) => ({ ...f, notes: "", customProduct: "" }));
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function markGiven(id: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/horses/${horseId}/deworming/${id}/given`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Failed");
        return;
      }
      toast.success("Marked given · next dose in 60 days");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const now = new Date();

  return (
    <div className="space-y-4">
      {canWrite && (
        <div className="grid gap-2 rounded-md border bg-muted/30 p-3 md:grid-cols-4">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Product</label>
            <Select
              value={form.product}
              onChange={(e) => setForm((f) => ({ ...f, product: e.target.value }))}
            >
              {COMMON_DEWORMERS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
              <option value="custom">Other…</option>
            </Select>
          </div>
          {form.product === "custom" && (
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Custom name</label>
              <Input
                value={form.customProduct}
                onChange={(e) => setForm((f) => ({ ...f, customProduct: e.target.value }))}
                maxLength={120}
              />
            </div>
          )}
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Scheduled</label>
            <Input
              type="date"
              value={form.scheduledAt}
              onChange={(e) => setForm((f) => ({ ...f, scheduledAt: e.target.value }))}
            />
          </div>
          <div className="md:col-span-1">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Notes</label>
            <Input
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              maxLength={300}
              placeholder="optional"
            />
          </div>
          <div className="md:col-span-4 flex justify-end">
            <Button onClick={add} disabled={busy === "__new__"}>
              {busy === "__new__" ? "Scheduling…" : "Schedule dose"}
            </Button>
          </div>
        </div>
      )}

      {entries.length === 0 ? (
        <div className="rounded-md border border-dashed py-6 text-center text-sm text-muted-foreground">
          No deworming entries yet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="pb-2">Product</th>
                <th className="pb-2">Scheduled</th>
                <th className="pb-2">Given</th>
                <th className="pb-2">Next due</th>
                <th className="pb-2">Notes</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const next = e.nextDueAt ? new Date(e.nextDueAt) : null;
                const overdue = next && next < now && !e.givenAt;
                return (
                  <tr key={e.id} className="border-t">
                    <td className="py-2 font-medium">{e.product}</td>
                    <td className="py-2">{formatDate(new Date(e.scheduledAt))}</td>
                    <td className="py-2">
                      {e.givenAt ? (
                        <Badge variant="success">{formatDate(new Date(e.givenAt))}</Badge>
                      ) : overdue ? (
                        <Badge variant="warning">overdue</Badge>
                      ) : (
                        <Badge variant="outline">pending</Badge>
                      )}
                    </td>
                    <td className="py-2">{next ? formatDate(next) : "—"}</td>
                    <td className="py-2 text-xs text-muted-foreground">{e.notes ?? "—"}</td>
                    <td className="py-2 text-right">
                      {!e.givenAt && canWrite && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => markGiven(e.id)}
                          disabled={busy === e.id}
                        >
                          {busy === e.id ? "…" : "Mark given"}
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
