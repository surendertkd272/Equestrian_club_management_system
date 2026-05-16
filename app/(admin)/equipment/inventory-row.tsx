"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Minus, Plus } from "lucide-react";

export function InventoryRow({
  centreId,
  catalogId,
  name,
  code,
  unit,
  qty,
  threshold,
  defaultThreshold,
  canEdit,
  canSetThreshold,
  isLow,
}: {
  centreId: string;
  catalogId: string;
  name: string;
  code: string;
  unit: string;
  qty: number;
  threshold: number;
  defaultThreshold: number;
  canEdit: boolean;
  canSetThreshold: boolean;
  isLow: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

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

  return (
    <tr className={`border-t ${isLow ? "bg-rose-50/40" : ""}`}>
      <td className="py-2">
        <div className="font-medium">{name}</div>
        <div className="text-[11px] font-mono text-muted-foreground">{code}</div>
      </td>
      <td className="py-2 text-xs text-muted-foreground">{unit}</td>
      <td className="py-2">
        {canEdit ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => patch({ delta: -1, reason: "consumed" })}
              disabled={busy || qty <= 0}
              className="h-7 w-7 rounded border bg-card text-xs hover:bg-muted disabled:opacity-40"
              aria-label="decrement"
            >
              <Minus className="m-auto h-3 w-3" />
            </button>
            <Input
              type="number"
              min={0}
              defaultValue={qty}
              onBlur={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && v !== qty) patch({ qty: v, reason: "adjustment" });
              }}
              className="h-7 w-16 text-center"
              disabled={busy}
            />
            <button
              type="button"
              onClick={() => patch({ delta: 1, reason: "restock" })}
              disabled={busy}
              className="h-7 w-7 rounded border bg-card text-xs hover:bg-muted disabled:opacity-40"
              aria-label="increment"
            >
              <Plus className="m-auto h-3 w-3" />
            </button>
          </div>
        ) : (
          <span className="font-mono">{qty}</span>
        )}
      </td>
      <td className="py-2">
        {canSetThreshold ? (
          <Input
            type="number"
            min={0}
            defaultValue={threshold}
            onBlur={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v !== threshold) {
                patch({ threshold: v });
              }
            }}
            className="h-7 w-20"
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
        ) : qty < threshold * 1.5 ? (
          <Badge variant="warning">watch</Badge>
        ) : (
          <Badge variant="success">ok</Badge>
        )}
      </td>
    </tr>
  );
}
