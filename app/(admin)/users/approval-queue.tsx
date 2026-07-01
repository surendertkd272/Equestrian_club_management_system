"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { roleLabel } from "@/lib/labels";
export type PendingUserDTO = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  createdAt: string;
  centre: { name: string; slug: string } | null;
};

// Approve or reject a pending_approval user. Approve = flip status to active
// + email them a temp password (currently a no-op email; the admin sees the
// temp pwd in the success toast). Reject = flip to suspended with a note.

export function ApprovalQueue({ pending }: { pending: PendingUserDTO[] }) {
  if (pending.length === 0) return null;
  return (
    <div className="rounded-md border-2 border-amber-300 bg-amber-50 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold text-amber-900">
          Pending approvals ({pending.length})
        </h3>
        <p className="text-xs text-amber-800">
          Staff who registered via an invite link and are waiting for you to activate.
        </p>
      </div>
      <ul className="space-y-2">
        {pending.map((u) => (
          <PendingRow key={u.id} user={u} />
        ))}
      </ul>
    </div>
  );
}

function PendingRow({ user }: { user: PendingUserDTO }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);

  async function decide(action: "approve" | "reject") {
    setBusy(action);
    try {
      const res = await fetch(`/api/users/${user.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Failed");
        return;
      }
      if (action === "approve" && data.tempPassword) {
        toast.success(`Approved. Temp password: ${data.tempPassword}`, { duration: 15_000 });
      } else {
        toast.success(action === "approve" ? "Approved" : "Rejected");
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-card px-3 py-2 text-sm">
      <div className="min-w-0">
        <div className="font-medium">
          {user.name}{" "}
          <Badge variant="outline">{roleLabel(user.role)}</Badge>
        </div>
        <div className="text-xs text-muted-foreground">
          <span className="font-mono">{user.email}</span>
          {user.phone && <span> · {user.phone}</span>}
          {user.centre && <span> · {user.centre.name}</span>}
          <span> · applied {formatDate(new Date(user.createdAt))}</span>
        </div>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null}
          onClick={() => decide("reject")}
        >
          {busy === "reject" ? "…" : "Reject"}
        </Button>
        <Button size="sm" disabled={busy !== null} onClick={() => decide("approve")}>
          {busy === "approve" ? "…" : "Approve"}
        </Button>
      </div>
    </li>
  );
}
