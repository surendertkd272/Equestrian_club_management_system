"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { openConfirm } from "@/components/ui/confirm-dialog";

type Item = {
  id: string;
  label: string;
  section: string | null;
  orderIndex: number;
  active: boolean;
};

type Props = {
  templateId: string;
  scope: "general" | "per_horse";
  items: Item[];
};

// Section bucket order for the "general" template (Section A then B). Items
// without a section sit at the bottom — that's fine for "per_horse" which
// doesn't bucket.
const SECTION_ORDER = ["A", "B"];

export function TemplateEditor({ templateId, scope, items }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ label: string; section: string }>({
    label: "",
    section: scope === "general" ? "A" : "",
  });
  // showInactive lets the admin recover a soft-deleted item.
  const [showInactive, setShowInactive] = useState(false);

  const buckets = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const it of items) {
      if (!it.active && !showInactive) continue;
      const key = it.section ?? "—";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(it);
    }
    for (const list of map.values()) list.sort((a, b) => a.orderIndex - b.orderIndex);
    // Stable section ordering: A, B, then anything else alphabetically.
    return Array.from(map.entries()).sort(([a], [b]) => {
      const ai = SECTION_ORDER.indexOf(a);
      const bi = SECTION_ORDER.indexOf(b);
      if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      return a.localeCompare(b);
    });
  }, [items, showInactive]);

  async function patch(itemId: string, body: Record<string, unknown>) {
    setBusy(itemId);
    try {
      const res = await fetch(`/api/checklists/${templateId}/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Failed");
        return false;
      }
      router.refresh();
      return true;
    } finally {
      setBusy(null);
    }
  }

  async function addItem() {
    if (draft.label.trim().length < 2) {
      toast.error("Label is too short.");
      return;
    }
    setBusy("__new__");
    try {
      const res = await fetch(`/api/checklists/${templateId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: draft.label.trim(),
          section: draft.section.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Failed");
        return;
      }
      toast.success("Item added");
      setDraft({ label: "", section: scope === "general" ? draft.section || "A" : "" });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function softDelete(item: Item) {
    const ok = await openConfirm({
      title: "Deactivate this item?",
      body: `"${item.label}" will be hidden from new submissions. Past submissions keep their record.`,
      confirmLabel: "Deactivate",
    });
    if (!ok) return;
    if (await patch(item.id, { active: false })) toast.success("Deactivated");
  }

  async function reactivate(item: Item) {
    if (await patch(item.id, { active: true })) toast.success("Reactivated");
  }

  async function rename(item: Item, label: string) {
    const trimmed = label.trim();
    if (trimmed.length < 2 || trimmed === item.label) return;
    if (await patch(item.id, { label: trimmed })) toast.success("Saved");
  }

  async function move(item: Item, direction: -1 | 1) {
    // Within the same section, swap orderIndex with neighbour.
    const peers = items
      .filter((p) => (p.section ?? null) === (item.section ?? null) && p.active)
      .sort((a, b) => a.orderIndex - b.orderIndex);
    const idx = peers.findIndex((p) => p.id === item.id);
    const target = peers[idx + direction];
    if (!target) return;
    await Promise.all([
      patch(item.id, { orderIndex: target.orderIndex }),
      patch(target.id, { orderIndex: item.orderIndex }),
    ]);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2 rounded-md border bg-muted/30 p-3">
        {scope === "general" && (
          <div className="w-20">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Section
            </label>
            <Input
              value={draft.section}
              onChange={(e) => setDraft((d) => ({ ...d, section: e.target.value }))}
              placeholder="A"
              maxLength={20}
            />
          </div>
        )}
        <div className="flex-1 min-w-[200px]">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            New item label
          </label>
          <Input
            value={draft.label}
            onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
            placeholder="e.g. Stable lighting checked"
            maxLength={200}
            onKeyDown={(e) => {
              if (e.key === "Enter") addItem();
            }}
          />
        </div>
        <Button onClick={addItem} disabled={busy === "__new__"}>
          {busy === "__new__" ? "Adding…" : "Add item"}
        </Button>
        <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Show deactivated
        </label>
      </div>

      {buckets.length === 0 && (
        <div className="rounded-md border border-dashed py-6 text-center text-sm text-muted-foreground">
          No items yet. Add one above.
        </div>
      )}

      {buckets.map(([section, rows]) => (
        <div key={section} className="space-y-2">
          {scope === "general" && (
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Section {section === "—" ? "Other" : section}
            </div>
          )}
          <ul className="divide-y rounded-md border">
            {rows.map((item, i) => (
              <li
                key={item.id}
                className={`flex items-center gap-2 px-3 py-2 ${item.active ? "" : "opacity-60"}`}
              >
                <div className="flex flex-col">
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-30"
                    onClick={() => move(item, -1)}
                    disabled={i === 0 || busy !== null}
                    aria-label="Move up"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-30"
                    onClick={() => move(item, 1)}
                    disabled={i === rows.length - 1 || busy !== null}
                    aria-label="Move down"
                  >
                    ▼
                  </button>
                </div>
                <EditableLabel
                  initial={item.label}
                  disabled={busy === item.id}
                  onSave={(v) => rename(item, v)}
                />
                {!item.active && <Badge variant="outline">deactivated</Badge>}
                {item.active ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => softDelete(item)}
                    disabled={busy === item.id}
                  >
                    Remove
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => reactivate(item)}
                    disabled={busy === item.id}
                  >
                    Restore
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function EditableLabel({
  initial,
  onSave,
  disabled,
}: {
  initial: string;
  onSave: (value: string) => void | Promise<void>;
  disabled?: boolean;
}) {
  const [val, setVal] = useState(initial);
  const [focused, setFocused] = useState(false);
  // After a save, the parent re-renders with the new initial value. Sync the
  // input only when it isn't being typed into (otherwise we'd clobber the user).
  useEffect(() => {
    if (!focused) setVal(initial);
  }, [initial, focused]);
  return (
    <Input
      className="flex-1 border-transparent bg-transparent shadow-none focus:border-input focus:bg-background"
      onFocus={() => setFocused(true)}
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onBlur={() => {
        setFocused(false);
        if (val.trim() !== initial) onSave(val);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          (e.target as HTMLInputElement).blur();
        } else if (e.key === "Escape") {
          setVal(initial);
          (e.target as HTMLInputElement).blur();
        }
      }}
      disabled={disabled}
      maxLength={200}
    />
  );
}
