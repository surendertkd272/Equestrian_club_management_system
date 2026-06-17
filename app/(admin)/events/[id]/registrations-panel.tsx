"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { postJson, patchJson, deleteJson } from "@/lib/client/post-json";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2 } from "lucide-react";
import { openConfirm } from "@/components/ui/confirm-dialog";

type Reg = {
  id: string;
  riderId: string;
  riderName: string;
  status: string;
  paid: boolean;
  notes: string | null;
};

export function RegistrationsPanel({
  eventId,
  eventStatus,
  fee,
  canManage,
  registrations,
  riders,
}: {
  eventId: string;
  eventStatus: string;
  fee: number;
  canManage: boolean;
  registrations: Reg[];
  riders: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [newRiderId, setNewRiderId] = useState(riders[0]?.id ?? "");

  const accepting = eventStatus !== "completed" && eventStatus !== "cancelled";

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!newRiderId) return;
    setAdding(true);
    const res = await postJson(`/api/events/${eventId}/registrations`, { riderId: newRiderId });
    setAdding(false);
    if (!res.ok) {
      toast.error(
        res.code === "ALREADY_REGISTERED"
          ? "Rider already registered."
          : res.code === "FULL"
            ? "Event is full."
            : res.message,
      );
      return;
    }
    toast.success(fee > 0 ? `Registered · invoice raised (₹${fee})` : "Registered");
    router.refresh();
  }

  async function patch(regId: string, body: Record<string, unknown>, msg?: string) {
    const res = await patchJson(`/api/events/${eventId}/registrations/${regId}`, body);
    if (!res.ok) {
      toast.error("Save failed");
      return;
    }
    if (msg) toast.success(msg);
    router.refresh();
  }

  async function remove(regId: string) {
    const ok = await openConfirm({
      title: "Cancel this registration?",
      destructive: true,
      confirmLabel: "Cancel",
    });
    if (!ok) return;
    const res = await deleteJson(`/api/events/${eventId}/registrations/${regId}`);
    if (!res.ok) {
      toast.error("Failed");
      return;
    }
    toast.success("Removed");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Registrations ({registrations.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {registrations.length === 0 ? (
          <p className="text-sm text-muted-foreground">No registrations yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="pb-2">Rider</th>
                <th className="pb-2 w-32">Status</th>
                <th className="pb-2 w-24">Paid</th>
                <th className="pb-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {registrations.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="py-2 font-medium">{r.riderName}</td>
                  <td className="py-2">
                    {canManage ? (
                      <Select
                        value={r.status}
                        onChange={(e) => patch(r.id, { status: e.target.value }, "Status updated")}
                        className="h-8 text-xs"
                      >
                        <option value="registered">registered</option>
                        <option value="attended">attended</option>
                        <option value="no_show">no-show</option>
                        <option value="cancelled">cancelled</option>
                      </Select>
                    ) : (
                      <Badge variant="outline">{r.status}</Badge>
                    )}
                  </td>
                  <td className="py-2">
                    {canManage && fee > 0 ? (
                      <button
                        type="button"
                        onClick={() => patch(r.id, { paid: !r.paid }, r.paid ? "Marked unpaid" : "Marked paid")}
                        className="rounded-md border px-2 py-0.5 text-xs hover:bg-muted"
                      >
                        {r.paid ? "Paid" : "Unpaid"}
                      </button>
                    ) : (
                      <Badge variant={r.paid ? "success" : "outline"}>{r.paid ? "paid" : "—"}</Badge>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    {canManage && (
                      <button
                        type="button"
                        onClick={() => remove(r.id)}
                        className="text-muted-foreground hover:text-destructive"
                        aria-label="remove"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {canManage && accepting && riders.length > 0 && (
          <form onSubmit={add} className="flex items-end gap-2 border-t pt-3">
            <div className="flex-1">
              <label className="text-xs uppercase text-muted-foreground">Add rider</label>
              <Select value={newRiderId} onChange={(e) => setNewRiderId(e.target.value)}>
                {riders.map((r) => (
                  <option key={r.id} value={r.id}>{r.label}</option>
                ))}
              </Select>
            </div>
            <Button type="submit" disabled={adding} size="sm">
              <Plus className="h-3.5 w-3.5" /> {adding ? "Adding…" : "Register"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
