"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { openConfirm } from "@/components/ui/confirm-dialog";

type Ext = {
  id: string;
  className: string;
  firstName: string;
  lastName: string;
  email: string;
  mobile: string;
  status: string;
  verifiedAt: string | null;
  filedAt: string;
  accreditationBody: string | null;
  accreditationNumber: string | null;
  horseName: string | null;
  rejectionReason: string | null;
};

// External-entry approval queue. Default tab = pending verified entries
// (those waiting on the organiser). Approving a row creates a synthetic
// Rider + CompetitionEntry server-side; the organiser then sees them in
// the regular start list. Rejecting captures a reason that's emailed to
// the entrant.
export function ExternalEntriesPanel({ competitionId, canManage }: { competitionId: string; canManage: boolean }) {
  const router = useRouter();
  const [rows, setRows] = useState<Ext[]>([]);
  const [filter, setFilter] = useState<"pending" | "approved" | "rejected" | "all">("pending");
  const [busy, setBusy] = useState(false);

  async function load() {
    const q = filter === "all" ? "" : `?status=${filter}`;
    const res = await fetch(`/api/competitions/${competitionId}/external-entries${q}`);
    const data = await res.json().catch(() => ({}));
    if (res.ok && Array.isArray(data.rows)) setRows(data.rows);
  }
  useEffect(() => { void load(); }, [competitionId, filter]);

  async function decide(id: string, decision: "approve" | "reject", reason?: string) {
    setBusy(true);
    const res = await fetch(`/api/competitions/${competitionId}/external-entries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entryId: id, decision, rejectionReason: reason ?? null }),
    });
    setBusy(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(
        data.error === "NOT_YET_VERIFIED" ? "Entrant hasn't confirmed their email yet."
        : data.error === "ALREADY_DECIDED" ? "Already decided."
        : data.error ?? "Failed",
      );
      return;
    }
    toast.success(decision === "approve" ? "Approved and added to start list." : "Rejected.");
    await load();
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-1 text-xs">
        {(["pending", "approved", "rejected", "all"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilter(s)}
            className={`rounded px-2 py-1 ${filter === s ? "bg-primary text-primary-foreground" : "border bg-card hover:bg-accent"}`}
          >
            {s}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No external entries match this filter.</p>
      ) : (
        <ul className="divide-y text-sm">
          {rows.map((r) => (
            <li key={r.id} className="grid gap-2 py-3 sm:grid-cols-[1fr_auto]">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{r.firstName} {r.lastName}</span>
                  <Badge variant="outline" className="text-[10px]">{r.className}</Badge>
                  <Badge
                    variant={r.status === "approved" ? "default" : r.status === "rejected" ? "destructive" : "secondary"}
                    className="text-[10px]"
                  >
                    {r.status}
                  </Badge>
                  {!r.verifiedAt && r.status === "pending" && (
                    <Badge variant="outline" className="text-[10px] text-amber-700">unverified</Badge>
                  )}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {r.email} · {r.mobile}
                  {r.horseName && <> · ride: {r.horseName}</>}
                  {r.accreditationNumber && <> · {r.accreditationBody} #{r.accreditationNumber}</>}
                </div>
                {r.rejectionReason && (
                  <div className="mt-1 text-xs italic text-rose-700">Rejection reason: {r.rejectionReason}</div>
                )}
              </div>
              {canManage && r.status === "pending" && r.verifiedAt && (
                <div className="flex gap-2">
                  <Button
                    variant="default"
                    size="sm"
                    disabled={busy}
                    onClick={async () => {
                      const ok = await openConfirm({
                        title: `Approve ${r.firstName}'s entry?`,
                        body: `Creates a rider row + adds to the start list for "${r.className}". The entrant gets a confirmation email.`,
                        confirmLabel: "Approve",
                      });
                      if (ok) await decide(r.id, "approve");
                    }}
                  >
                    Approve
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={async () => {
                      const reason = window.prompt("Rejection reason (sent to entrant):");
                      if (reason === null) return;
                      await decide(r.id, "reject", reason);
                    }}
                  >
                    Reject
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
