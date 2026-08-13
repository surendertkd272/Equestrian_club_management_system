"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

// Sprint 3.5: row now shows 4 condition-state qty inputs (Unused, In-Use,
// For Repair, Damaged) + an auto-computed Total, plus comments / new-
// required / owner. Low-stock alert uses (qtyUnused + qtyInUse) vs
// threshold so damaged + for-repair items don't get double-counted.

export function InventoryRow({
  centreId,
  catalogId,
  name,
  code,
  unit,
  photoUrl,
  qtyUnused,
  qtyInUse,
  qtyForRepair,
  qtyDamaged,
  newRequired,
  owner,
  notes,
  threshold,
  defaultThreshold,
  canEdit,
  canSetThreshold,
  hasRecord,
}: {
  centreId: string;
  catalogId: string;
  name: string;
  code: string;
  unit: string;
  photoUrl?: string | null;
  qtyUnused: number;
  qtyInUse: number;
  qtyForRepair: number;
  qtyDamaged: number;
  newRequired: number;
  owner: string | null;
  notes: string | null;
  threshold: number;
  defaultThreshold: number;
  canEdit: boolean;
  canSetThreshold: boolean;
  // False when this centre has NO stock row for the item — i.e. nobody has ever
  // counted it here. Previously indistinguishable from a real count of zero:
  // both rendered "0" and both tripped the red "low" badge, so most of the
  // reorder alerts on this page were for gear nobody had looked at yet.
  hasRecord: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // Which field just saved, so it can flash. Saving happens on blur with no
  // dialog and no button, so without this the UI is completely silent about
  // whether the number landed — the reason a clipped "143" read as data loss.
  const [savedField, setSavedField] = useState<string | null>(null);

  const total = qtyUnused + qtyInUse + qtyForRepair + qtyDamaged;
  // Available stock = Unused + In-Use. Damaged + For-Repair don't count.
  const available = qtyUnused + qtyInUse;
  const isLow = hasRecord && available < threshold;
  const isWatch = hasRecord && !isLow && available < threshold * 1.5;

  async function patch(field: string, body: Record<string, unknown>) {
    setBusy(true);
    try {
      const url = `/api/equipment/stock/${catalogId}${centreId ? `?centreId=${centreId}` : ""}`;
      const res = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Failed");
        return;
      }
      // Deliberately a flash on the field rather than a toast: these are
      // high-frequency edits and a toast per cell would bury the screen.
      setSavedField(field);
      setTimeout(() => setSavedField((f) => (f === field ? null : f)), 1600);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function onBlurNumber(field: string, current: number) {
    return (e: React.FocusEvent<HTMLInputElement>) => {
      const raw = e.target.value.trim();
      // Tabbing through an uncounted (empty) field is not a count of zero —
      // it must not create a stock record.
      if (raw === "") return;
      const v = Number(raw);
      if (!Number.isFinite(v) || v < 0) return;
      // On an uncounted row an explicit 0 IS meaningful ("checked, we have
      // none"), so it has to save even though it equals the displayed default.
      if (v === current && hasRecord) return;
      patch(field, { [field]: v, reason: "adjustment" });
    };
  }

  function onBlurText(field: string, current: string | null) {
    return (e: React.FocusEvent<HTMLInputElement>) => {
      const v = e.target.value.trim();
      if (v !== (current ?? "")) patch(field, { [field]: v || null });
    };
  }

  const qtyInput = (field: string, value: number) => (
    canEdit ? (
      <Input
        type="number"
        min={0}
        // Blank, not 0, when nothing has ever been counted here — so the field
        // invites a number instead of asserting one.
        defaultValue={hasRecord ? value : ""}
        placeholder={hasRecord ? undefined : "—"}
        onBlur={onBlurNumber(field, value)}
        // Select-all on focus: without this, clicking a field showing "0" and
        // typing "6" can produce "60" (cursor lands beside the existing digit)
        // — the source of the "Total shows 60" field report. Selecting the
        // current value means typing always REPLACES it.
        onFocus={(e) => e.target.select()}
        // Scrolling a long inventory table with the cursor over a focused
        // number input makes the wheel change the value — silently editing a
        // stock count nobody meant to touch. Dropping focus on wheel stops it.
        onWheel={(e) => e.currentTarget.blur()}
        // w-14 (56px) minus the native spinner left room for two digits, so a
        // real count of 143 rendered as "14" — the value was stored correctly
        // the whole time, it was only ever clipped. Wider field, no spinner.
        className={`no-spinner h-7 w-20 text-center transition-shadow ${
          savedField === field ? "ring-2 ring-emerald-500" : ""
        }`}
        disabled={busy}
        // Re-mount on server-side change so the visible value matches. hasRecord
        // is in the key too: the first save flips a blank field to a real value.
        key={`${hasRecord}:${value}`}
      />
    ) : (
      <span className="font-mono text-xs">{value}</span>
    )
  );

  return (
    <tr className={`border-t ${isLow ? "bg-rose-50/40" : ""}`}>
      <td className="py-2">
        {/* Screen-reader confirmation for the save, which is otherwise purely
            visual (a ring flash on the field). Lives inside the name cell so
            the row keeps its 11 columns. */}
        <span className="sr-only" aria-live="polite">
          {savedField ? `${name} saved` : ""}
        </span>
        <div className="flex items-center gap-2">
          {photoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photoUrl}
              alt={name}
              className="h-8 w-8 shrink-0 rounded object-cover"
              loading="lazy"
            />
          )}
          <div>
            <div className="font-medium">{name}</div>
            <div className="text-[10px] text-muted-foreground">{unit}</div>
          </div>
        </div>
      </td>
      <td className="py-2">{qtyInput("qtyUnused", qtyUnused)}</td>
      <td className="py-2">{qtyInput("qtyInUse", qtyInUse)}</td>
      <td className="py-2">{qtyInput("qtyForRepair", qtyForRepair)}</td>
      <td className="py-2">{qtyInput("qtyDamaged", qtyDamaged)}</td>
      <td className="py-2 text-center font-mono font-semibold">
        {hasRecord ? total : <span className="text-muted-foreground">—</span>}
      </td>
      <td className="py-2">{qtyInput("newRequired", newRequired)}</td>
      <td className="py-2">
        {canEdit ? (
          <Input
            defaultValue={owner ?? ""}
            onBlur={onBlurText("owner", owner)}
            className="h-7 w-24 text-xs"
            disabled={busy}
            placeholder="—"
          />
        ) : (
          <span className="text-xs">{owner ?? "—"}</span>
        )}
      </td>
      <td className="py-2">
        {canEdit ? (
          <Input
            defaultValue={notes ?? ""}
            onBlur={onBlurText("notes", notes)}
            className="h-7 w-32 text-xs"
            disabled={busy}
            placeholder="—"
          />
        ) : (
          <span className="text-xs text-muted-foreground">{notes ?? "—"}</span>
        )}
      </td>
      <td className="py-2">
        {canSetThreshold ? (
          <Input
            type="number"
            min={0}
            defaultValue={threshold}
            onBlur={onBlurNumber("threshold", threshold)}
            onWheel={(e) => e.currentTarget.blur()}
            className="no-spinner h-7 w-20 text-center"
            disabled={busy}
            title={`Catalog default: ${defaultThreshold}`}
          />
        ) : (
          <span className="font-mono text-xs">{threshold}</span>
        )}
      </td>
      <td className="py-2">
        {/* "not counted" is a distinct state from "ok" — claiming stock is
            fine when nobody has looked is how a shortage goes unnoticed. */}
        {!hasRecord ? (
          <Badge variant="outline" title="No one has counted this item at this centre yet">
            not counted
          </Badge>
        ) : isLow ? (
          <Badge variant="destructive">low</Badge>
        ) : isWatch ? (
          <Badge variant="warning">watch</Badge>
        ) : (
          <Badge variant="success">ok</Badge>
        )}
      </td>
    </tr>
  );
}
