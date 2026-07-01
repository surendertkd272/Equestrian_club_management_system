"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import type { AttendanceStatus } from "@/lib/schemas/attendance";
import { Check, X, Clock, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { postJson } from "@/lib/client/post-json";

type Rider = { id: string; firstName: string; lastName: string };
type Existing = { riderId: string; status: string; reason: string | null };

const NEXT_STATE: Record<AttendanceStatus, AttendanceStatus> = {
  present: "absent",
  absent: "late",
  late: "excused",
  excused: "present",
};

const STATUS_META: Record<AttendanceStatus, { label: string; short: string; cls: string; icon: any }> = {
  present: { label: "Present", short: "P", cls: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30", icon: Check },
  absent: { label: "Absent", short: "A", cls: "bg-red-100 text-red-800 border-red-300 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/30", icon: X },
  late: { label: "Late", short: "L", cls: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30", icon: Clock },
  excused: { label: "Excused", short: "E", cls: "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30", icon: ShieldAlert },
};

export function AttendanceMarker({
  batchId,
  date,
  roster,
  existing,
  canEdit,
}: {
  batchId: string;
  date: string;
  roster: Rider[];
  existing: Existing[];
  canEdit: boolean;
}) {
  const initial = useMemo(() => {
    const map: Record<string, AttendanceStatus | undefined> = {};
    for (const e of existing) {
      if ((["present", "absent", "late", "excused"] as const).includes(e.status as AttendanceStatus)) {
        map[e.riderId] = e.status as AttendanceStatus;
      }
    }
    return map;
  }, [existing]);

  const initialReasons = useMemo(() => {
    const map: Record<string, string> = {};
    for (const e of existing) {
      if (e.reason) map[e.riderId] = e.reason;
    }
    return map;
  }, [existing]);

  const [state, setState] = useState<Record<string, AttendanceStatus | undefined>>(initial);
  const [reasons, setReasons] = useState<Record<string, string>>(initialReasons);
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  const stats = useMemo(() => {
    const out = { present: 0, absent: 0, late: 0, excused: 0, untouched: 0 };
    for (const r of roster) {
      const s = state[r.id];
      if (!s) out.untouched++;
      else out[s]++;
    }
    return out;
  }, [state, roster]);

  function cycle(riderId: string) {
    setState((s) => ({ ...s, [riderId]: s[riderId] ? NEXT_STATE[s[riderId] as AttendanceStatus] : "present" }));
  }

  function setAll(status: AttendanceStatus) {
    const next: Record<string, AttendanceStatus> = {};
    for (const r of roster) next[r.id] = status;
    setState(next);
  }

  async function save() {
    const entries = roster
      .map((r) => ({
        riderId: r.id,
        status: state[r.id],
        reason: reasons[r.id]?.trim() || undefined,
      }))
      .filter(
        (e): e is { riderId: string; status: AttendanceStatus; reason: string | undefined } =>
          !!e.status,
      );
    if (entries.length === 0) {
      toast.error("Nothing to save — tap names or use 'Mark all present'.");
      return;
    }
    setSaving(true);
    const res = await postJson<{ count: number }>("/api/attendance/mark", { batchId, date, entries });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    toast.success(`Saved ${res.data.count} record${res.data.count === 1 ? "" : "s"}.`);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="success">P {stats.present}</Badge>
          <Badge variant="destructive">A {stats.absent}</Badge>
          <Badge variant="warning">L {stats.late}</Badge>
          <Badge variant="outline">E {stats.excused}</Badge>
          {stats.untouched > 0 && <Badge variant="outline">Untouched {stats.untouched}</Badge>}
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setAll("present")} className="border-emerald-400 text-emerald-700 hover:bg-emerald-50">
              All P
            </Button>
            <Button variant="outline" size="sm" onClick={() => setAll("absent")} className="border-rose-400 text-rose-700 hover:bg-rose-50">
              All A
            </Button>
            <Button variant="outline" size="sm" onClick={() => setAll("late")} className="border-amber-400 text-amber-700 hover:bg-amber-50">
              All L
            </Button>
            <Button variant="outline" size="sm" onClick={() => setAll("excused")} className="border-blue-400 text-blue-700 hover:bg-blue-50">
              All E
            </Button>
            <Button variant="outline" size="sm" onClick={() => setState({})}>
              Clear
            </Button>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        )}
      </div>

      <ul className="divide-y rounded-md border">
        {roster.map((r) => {
          const s = state[r.id];
          const meta = s ? STATUS_META[s] : null;
          // Remarks field shows for absent/late/excused — reason is rarely
          // needed for "present" so we keep the row compact in the happy path.
          const needsReason = s === "absent" || s === "late" || s === "excused";
          return (
            <li key={r.id} className="px-4 py-2.5">
              <div className="flex items-center justify-between">
                <div className="font-medium">
                  {r.firstName} {r.lastName}
                </div>
                <button
                  type="button"
                  onClick={() => canEdit && cycle(r.id)}
                  disabled={!canEdit}
                  className={cn(
                    "flex h-9 min-w-32 items-center justify-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors",
                    meta ? meta.cls : "border-dashed text-muted-foreground hover:bg-muted",
                    !canEdit && "cursor-not-allowed opacity-60",
                  )}
                  title="Tap to cycle: P → A → L → E"
                >
                  {meta ? (
                    <>
                      <meta.icon className="h-4 w-4" /> {meta.label}
                    </>
                  ) : (
                    <>Tap to Mark</>
                  )}
                </button>
              </div>
              {needsReason && canEdit && (
                <Input
                  className="mt-2 max-w-md"
                  placeholder={
                    s === "absent"
                      ? "Reason for absence (optional)"
                      : s === "late"
                        ? "How late / reason (optional)"
                        : "Excuse reason (optional)"
                  }
                  value={reasons[r.id] ?? ""}
                  onChange={(e) =>
                    setReasons((prev) => ({ ...prev, [r.id]: e.target.value }))
                  }
                  maxLength={300}
                />
              )}
              {needsReason && !canEdit && reasons[r.id] && (
                <div className="mt-1 text-xs text-muted-foreground">
                  Reason: {reasons[r.id]}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground">
        Tip: tap a rider's button to cycle Present → Absent → Late → Excused. The roster status saves with your user ID
        for the audit trail.
      </p>
    </div>
  );
}
