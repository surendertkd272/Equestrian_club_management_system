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
}: {
  centreId: string;
  catalogId: string;
  name: string;
  code: string;
  unit: string;
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
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const total = qtyUnused + qtyInUse + qtyForRepair + qtyDamaged;
  // Available stock = Unused + In-Use. Damaged + For-Repair don't count.
  const available = qtyUnused + qtyInUse;
  const isLow = available < threshold;
  const isWatch = !isLow && available < threshold * 1.5;

  async function patch(body: Record<string, unknown>) {
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
        toast.error(data.error ?? "Failed");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function onBlurNumber(field: string, current: number) {
    return (e: React.FocusEvent<HTMLInputElement>) => {
      const v = Number(e.target.value);
      if (Number.isFinite(v) && v >= 0 && v !== current) {
        patch({ [field]: v, reason: "adjustment" });
      }
    };
  }

  function onBlurText(field: string, current: string | null) {
    return (e: React.FocusEvent<HTMLInputElement>) => {
      const v = e.target.value.trim();
      if (v !== (current ?? "")) patch({ [field]: v || null });
    };
  }

  const qtyInput = (field: string, value: number) => (
    canEdit ? (
      <Input
        type="number"
        min={0}
        defaultValue={value}
        onBlur={onBlurNumber(field, value)}
        className="h-7 w-14 text-center"
        disabled={busy}
        key={value /* re-mount on server-side change so the visible value matches */}
      />
    ) : (
      <span className="font-mono text-xs">{value}</span>
    )
  );

  return (
    <tr className={`border-t ${isLow ? "bg-rose-50/40" : ""}`}>
      <td className="py-2">
        <div className="font-medium">{name}</div>
        <div className="text-[10px] font-mono text-muted-foreground">{code} · {unit}</div>
      </td>
      <td className="py-2">{qtyInput("qtyUnused", qtyUnused)}</td>
      <td className="py-2">{qtyInput("qtyInUse", qtyInUse)}</td>
      <td className="py-2">{qtyInput("qtyForRepair", qtyForRepair)}</td>
      <td className="py-2">{qtyInput("qtyDamaged", qtyDamaged)}</td>
      <td className="py-2 text-center font-mono font-semibold">{total}</td>
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
            className="h-7 w-16"
            disabled={busy}
            title={`Catalog default: ${defaultThreshold}`}
          />
        ) : (
          <span className="font-mono text-xs">{threshold}</span>
        )}
      </td>
      <td className="py-2">
        {isLow ? (
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
