"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Archive, Trash2, ImagePlus, X } from "lucide-react";
import { openConfirm } from "@/components/ui/confirm-dialog";
import { EQUIPMENT_CATEGORIES, EQUIPMENT_CATEGORY_ORDER } from "@/lib/schemas/equipment";
import { compressForKind } from "@/lib/image-compress";

// Use the canonical category list + order from the schema so the dropdown and
// the grouped list below match the rest of the app:
// tack → grooming → stable → rider → farrier → sports → vet → other.
const CATEGORIES = EQUIPMENT_CATEGORIES;
const UNITS = ["piece", "pair", "set", "metre", "kg", "litre"];

type Item = {
  id: string;
  category: string;
  code: string;
  name: string;
  unit: string;
  defaultThreshold: number;
  notes: string | null;
  photoUrl: string | null;
  active: boolean;
  adoptedBy: number;
};

export function CatalogManager({ initial }: { initial: Item[] }) {
  const router = useRouter();
  const [showInactive, setShowInactive] = useState(false);
  const [form, setForm] = useState({
    category: "tack",
    code: "",
    name: "",
    unit: "piece",
    defaultThreshold: "5",
    notes: "",
  });
  const [busy, setBusy] = useState(false);

  function slugify(s: string) {
    return s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/(^_|_$)/g, "");
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.code) {
      toast.error("Name and code are required");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/equipment/catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: form.category,
          code: form.code,
          name: form.name,
          unit: form.unit,
          defaultThreshold: Number(form.defaultThreshold),
          notes: form.notes || undefined,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(d.error === "DUPLICATE_CODE" ? "Code already used" : d.error ?? "Failed");
        return;
      }
      toast.success("Added");
      setForm({ ...form, code: "", name: "", notes: "" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function patch(id: string, body: Record<string, unknown>, msg?: string) {
    const res = await fetch(`/api/equipment/catalog/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      toast.error("Save failed");
      return;
    }
    if (msg) toast.success(msg);
    router.refresh();
  }

  // Upload an item photo (compressed client-side) then attach it via PATCH.
  async function uploadPhoto(id: string, file: File) {
    setBusy(true);
    try {
      const compressed = await compressForKind(file, "asset_photo");
      const fd = new FormData();
      fd.append("kind", "asset_photo");
      fd.append("file", compressed);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.message ?? err.error ?? "Upload failed");
        return;
      }
      const data = await res.json();
      await patch(id, { photoUrl: data.url as string }, "Photo added");
    } finally {
      setBusy(false);
    }
  }

  async function archive(id: string, adoptedBy: number) {
    const ok = await openConfirm({
      title: "Archive this item?",
      body:
        adoptedBy > 0
          ? `${adoptedBy} centre stock row(s) reference it — they keep their data, but the item won't show in fresh inventory pages.`
          : "It will be hidden from inventory pages.",
      destructive: true,
      confirmLabel: "Archive",
    });
    if (!ok) return;
    const res = await fetch(`/api/equipment/catalog/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Failed");
      return;
    }
    toast.success("Archived");
    router.refresh();
  }

  const visible = initial
    .filter((i) => showInactive || i.active)
    // Group order follows the canonical category order (Map keeps insertion order).
    .sort((a, b) => (EQUIPMENT_CATEGORY_ORDER[a.category] ?? 99) - (EQUIPMENT_CATEGORY_ORDER[b.category] ?? 99));
  const byCategory = new Map<string, Item[]>();
  for (const i of visible) {
    if (!byCategory.has(i.category)) byCategory.set(i.category, []);
    byCategory.get(i.category)!.push(i);
  }

  return (
    <div className="space-y-6">
      <form onSubmit={add} className="grid gap-2 rounded-md border bg-muted/30 p-3 md:grid-cols-12">
        <div className="md:col-span-2">
          <label className="text-[10px] font-semibold text-muted-foreground">Category</label>
          <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
        </div>
        <div className="md:col-span-3">
          <label className="text-[10px] font-semibold text-muted-foreground">Name</label>
          <Input
            value={form.name}
            onChange={(e) => {
              const n = e.target.value;
              setForm((f) => ({
                ...f,
                name: n,
                // Auto-suggest code if user hasn't typed one. Don't override
                // a manual code.
                code: f.code === "" || f.code === slugify(f.name) ? slugify(n) : f.code,
              }));
            }}
            placeholder='e.g. "Dressage saddle"'
          />
        </div>
        <div className="md:col-span-3">
          <label className="text-[10px] font-semibold text-muted-foreground">Code</label>
          <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="dressage_saddle" />
        </div>
        <div>
          <label className="text-[10px] font-semibold text-muted-foreground">Unit</label>
          <Select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
            {UNITS.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </Select>
        </div>
        <div>
          <label className="text-[10px] font-semibold text-muted-foreground">Reorder At</label>
          <Input
            type="number"
            min={0}
            value={form.defaultThreshold}
            onChange={(e) => setForm({ ...form, defaultThreshold: e.target.value })}
          />
        </div>
        <Button type="submit" disabled={busy} className="md:col-span-2">
          <Plus className="h-4 w-4" /> Add
        </Button>
      </form>

      <label className="flex items-center gap-1.5 text-xs">
        <input
          type="checkbox"
          checked={showInactive}
          onChange={(e) => setShowInactive(e.target.checked)}
        />
        Show archived
      </label>

      {Array.from(byCategory.entries()).map(([cat, rows]) => (
        <div key={cat}>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{cat}</h3>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 w-16">Photo</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2 w-32">Code</th>
                  <th className="px-3 py-2 w-20">Unit</th>
                  <th className="px-3 py-2 w-24">Reorder</th>
                  <th className="px-3 py-2 w-32">Adoption</th>
                  <th className="px-3 py-2 w-16"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.id} className={`border-t ${i.active ? "" : "opacity-60"}`}>
                    <td className="px-3 py-1.5">
                      {i.photoUrl ? (
                        <div className="group relative h-9 w-9">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={i.photoUrl} alt={i.name} className="h-9 w-9 rounded object-cover" loading="lazy" />
                          <button
                            type="button"
                            aria-label="Remove photo"
                            onClick={() => patch(i.id, { photoUrl: null }, "Photo removed")}
                            className="absolute -right-1.5 -top-1.5 hidden rounded-full bg-background p-0.5 text-muted-foreground shadow group-hover:block hover:text-destructive"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ) : (
                        <label className="flex h-9 w-9 cursor-pointer items-center justify-center rounded border border-dashed text-muted-foreground hover:bg-muted" title="Add photo">
                          <ImagePlus className="h-4 w-4" />
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            className="hidden"
                            disabled={busy}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) uploadPhoto(i.id, file);
                              e.target.value = "";
                            }}
                          />
                        </label>
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      <Input
                        defaultValue={i.name}
                        onBlur={(e) => {
                          if (e.target.value !== i.name) patch(i.id, { name: e.target.value }, "Renamed");
                        }}
                        className="h-8"
                      />
                    </td>
                    <td className="px-3 py-1.5 font-mono text-xs">{i.code}</td>
                    <td className="px-3 py-1.5 text-xs">{i.unit}</td>
                    <td className="px-3 py-1.5">
                      <Input
                        type="number"
                        defaultValue={i.defaultThreshold}
                        onFocus={(e) => e.target.select()}
                        onBlur={(e) => {
                          const v = Number(e.target.value);
                          if (v !== i.defaultThreshold) patch(i.id, { defaultThreshold: v }, "Threshold updated");
                        }}
                        className="h-8 w-20"
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      {i.adoptedBy > 0 ? (
                        <Badge variant="outline" className="text-[10px]">
                          {i.adoptedBy} centre{i.adoptedBy === 1 ? "" : "s"}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                      {!i.active && <Badge variant="destructive" className="ml-1 text-[10px]">archived</Badge>}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {i.active && (
                        <button
                          type="button"
                          onClick={() => archive(i.id, i.adoptedBy)}
                          className="text-muted-foreground hover:text-destructive"
                          aria-label="archive"
                        >
                          <Archive className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
