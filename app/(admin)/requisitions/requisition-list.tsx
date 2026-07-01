"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { formatDate } from "@/lib/utils";
import { postJson } from "@/lib/client/post-json";
import { roleLabel } from "@/lib/labels";
export type RequisitionDTO = {
  id: string;
  stage: string;
  items: { name: string; qty: number; unit?: string; estimatedUnitCost: number; notes?: string }[];
  totalEstimatedCost: number;
  reason: string | null;
  managerNotes: string | null;
  accountantNotes: string | null;
  rejectedReason: string | null;
  requestedBy: { id: string; name: string; role: string };
  createdAt: string;
  managerDecidedAt: string | null;
  accountantDecidedAt: string | null;
};

const STAGE_BADGE: Record<string, { label: string; variant: "warning" | "success" | "destructive" | "outline" }> = {
  pending_manager: { label: "Pending Manager", variant: "warning" },
  pending_accountant: { label: "Pending Accountant", variant: "warning" },
  approved: { label: "Approved", variant: "success" },
  rejected: { label: "Rejected", variant: "destructive" },
};

export function RequisitionList({
  rows,
  mode,
}: {
  rows: RequisitionDTO[];
  // "manager" / "accountant" — show decide controls; "readonly" — no controls.
  mode: "manager" | "accountant" | "readonly";
}) {
  const [q, setQ] = useState("");
  const [stage, setStage] = useState<string>("all");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (stage !== "all" && r.stage !== stage) return false;
      if (!needle) return true;
      const hay = [
        r.requestedBy.name,
        r.reason ?? "",
        ...r.items.map((i) => i.name),
      ].join(" ").toLowerCase();
      return hay.includes(needle);
    });
  }, [rows, q, stage]);

  if (rows.length === 0) {
    return <p className="py-4 text-center text-sm text-muted-foreground">Nothing to show.</p>;
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          placeholder="Search submitter, item, or reason…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="flex-1"
        />
        <Select value={stage} onChange={(e) => setStage(e.target.value)} className="sm:w-48">
          <option value="all">All Stages</option>
          <option value="pending_manager">Pending Manager</option>
          <option value="pending_accountant">Pending Accountant</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </Select>
      </div>
      {filtered.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">
          No matches for "{q}"{stage !== "all" ? ` in stage ${stage.replaceAll("_", " ")}` : ""}.
        </p>
      ) : (
        <ol className="space-y-3">
          {filtered.map((r) => (
            <RequisitionRow key={r.id} row={r} mode={mode} />
          ))}
        </ol>
      )}
    </div>
  );
}

function RequisitionRow({ row, mode }: { row: RequisitionDTO; mode: "manager" | "accountant" | "readonly" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [decisionNotes, setDecisionNotes] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const badge = STAGE_BADGE[row.stage] ?? { label: row.stage, variant: "outline" as const };

  async function decide(decision: "approve" | "reject") {
    setBusy(decision);
    const res = await postJson(`/api/requisitions/${row.id}/decide`, {
      decision,
      notes: decisionNotes.trim() || undefined,
    });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    toast.success(decision === "approve" ? "Approved" : "Rejected");
    router.refresh();
  }

  return (
    <li className="rounded-md border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <Badge variant={badge.variant}>{badge.label}</Badge>
          <span className="text-sm font-semibold">
            ₹{row.totalEstimatedCost.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
          </span>
          <span className="text-xs text-muted-foreground">
            · {row.items.length} item{row.items.length === 1 ? "" : "s"} · {formatDate(new Date(row.createdAt))}
          </span>
        </div>
        <div className="text-xs text-muted-foreground">
          {row.requestedBy.name} <span className="opacity-60">({roleLabel(row.requestedBy.role)})</span>
        </div>
      </div>

      {row.reason && (
        <p className="mt-2 text-sm text-muted-foreground">{row.reason}</p>
      )}

      <div className="mt-2 flex items-center gap-3 text-xs">
        <button
          type="button"
          className="text-primary underline"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Hide items" : "Show items"}
        </button>
        {row.stage === "approved" && (
          <Link href={`/requisitions/${row.id}/po`} className="text-primary underline">
            Open PO →
          </Link>
        )}
      </div>

      {open && (
        <div className="mt-2 overflow-x-auto rounded-md border bg-muted/40">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">Unit ₹</th>
                <th className="px-3 py-2 text-right">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {row.items.map((it, idx) => (
                <tr key={idx} className="border-t">
                  <td className="px-3 py-2">
                    <div className="font-medium">{it.name}</div>
                    {it.notes && <div className="text-xs text-muted-foreground">{it.notes}</div>}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {it.qty} {it.unit ?? ""}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {it.estimatedUnitCost.toLocaleString("en-IN")}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {(it.qty * it.estimatedUnitCost).toLocaleString("en-IN")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {row.managerNotes && row.managerDecidedAt && (
        <div className="mt-2 rounded-md bg-muted/30 p-2 text-xs">
          <span className="font-semibold">Manager:</span> {row.managerNotes}
        </div>
      )}
      {row.accountantNotes && row.accountantDecidedAt && (
        <div className="mt-2 rounded-md bg-muted/30 p-2 text-xs">
          <span className="font-semibold">Accountant:</span> {row.accountantNotes}
        </div>
      )}
      {row.rejectedReason && (
        <div className="mt-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
          <span className="font-semibold">Rejected:</span> {row.rejectedReason}
        </div>
      )}

      {mode !== "readonly" && (
        <div className="mt-3 space-y-2 border-t pt-3">
          <Input
            placeholder="Optional note for the requester"
            value={decisionNotes}
            onChange={(e) => setDecisionNotes(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={busy !== null}
              onClick={() => decide("reject")}
            >
              {busy === "reject" ? "Rejecting…" : "Reject"}
            </Button>
            <Button
              size="sm"
              disabled={busy !== null}
              onClick={() => decide("approve")}
            >
              {busy === "approve"
                ? "Approving…"
                : mode === "manager"
                  ? "Approve → send to accountant"
                  : "Approve & finalise"}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
