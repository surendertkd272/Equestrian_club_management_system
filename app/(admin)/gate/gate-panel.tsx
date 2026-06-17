"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { postJson } from "@/lib/client/post-json";

type Staff = { id: string; name: string; role: string };
type Event = {
  id: string;
  staffUserId: string;
  staffName: string;
  staffRole: string;
  direction: "in" | "out";
  occurredAt: string;
};

export function GatePanel({
  centreId,
  staff,
  initial,
}: {
  centreId: string;
  staff: Staff[];
  initial: Event[];
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [events, setEvents] = useState<Event[]>(initial);
  const [busy, setBusy] = useState<string | null>(null); // staff id being recorded

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return staff;
    return staff.filter((s) => s.name.toLowerCase().includes(needle) || s.role.toLowerCase().includes(needle));
  }, [q, staff]);

  // For each staff, infer their current presence from the latest event today
  // (or null if no events). Drives the suggested next action — if they're
  // last seen as "in", the In/Out toggle highlights "Out".
  const latestByStaff = useMemo(() => {
    const map = new Map<string, Event>();
    for (const e of events) {
      if (!map.has(e.staffUserId)) map.set(e.staffUserId, e);
    }
    return map;
  }, [events]);

  async function record(staffUserId: string, direction: "in" | "out") {
    setBusy(staffUserId);
    const res = await postJson("/api/gate-log", { staffUserId, direction, centreId });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    // Optimistically prepend so the row updates instantly without a refetch.
    const s = staff.find((x) => x.id === staffUserId)!;
    setEvents((es) => [
      {
        id: `local-${Date.now()}`,
        staffUserId,
        staffName: s.name,
        staffRole: s.role,
        direction,
        occurredAt: new Date().toISOString(),
      },
      ...es,
    ]);
    toast.success(`Recorded ${s.name} — ${direction.toUpperCase()}`);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div>
        <Input
          placeholder="Search staff by name or role…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((s) => {
          const latest = latestByStaff.get(s.id);
          const lastDir = latest?.direction;
          return (
            <div key={s.id} className="rounded-md border bg-card p-3">
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <div className="font-medium">{s.name}</div>
                  <div className="text-xs text-muted-foreground">{s.role.replaceAll("_", " ")}</div>
                </div>
                {lastDir && (
                  <Badge variant={lastDir === "in" ? "success" : "outline"}>
                    {lastDir === "in" ? "In" : "Out"}
                  </Badge>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="flex-1"
                  variant={lastDir === "in" ? "outline" : "default"}
                  disabled={busy === s.id}
                  onClick={() => record(s.id, "in")}
                >
                  <ArrowDownToLine className="mr-1 h-3 w-3" /> In
                </Button>
                <Button
                  size="sm"
                  className="flex-1"
                  variant={lastDir === "in" ? "default" : "outline"}
                  disabled={busy === s.id}
                  onClick={() => record(s.id, "out")}
                >
                  <ArrowUpFromLine className="mr-1 h-3 w-3" /> Out
                </Button>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <p className="col-span-full py-6 text-center text-sm text-muted-foreground">
            No staff matching "{q}".
          </p>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">Last 24 hours</h3>
        {events.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No gate events yet today.</p>
        ) : (
          <ol className="space-y-1">
            {events.map((e) => (
              <li
                key={e.id}
                className="flex items-center justify-between rounded-md border px-3 py-1.5 text-sm"
              >
                <div className="flex items-center gap-2">
                  <Badge variant={e.direction === "in" ? "success" : "outline"}>
                    {e.direction === "in" ? "IN" : "OUT"}
                  </Badge>
                  <span className="font-medium">{e.staffName}</span>
                  <span className="text-xs text-muted-foreground">
                    {e.staffRole.replaceAll("_", " ")}
                  </span>
                </div>
                <time className="font-mono text-xs text-muted-foreground">
                  {new Date(e.occurredAt).toLocaleTimeString("en-IN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
