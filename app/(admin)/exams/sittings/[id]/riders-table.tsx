"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { postJson } from "@/lib/client/post-json";
import { openConfirm } from "@/components/ui/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ClaimButton } from "./claim-button";
import { RemoveExamButton } from "../../exam-actions";

export type SittingRiderRow = {
  id: string;
  name: string;
  school: string;
  state: "completed" | "unassigned" | "marking" | "absent";
  // Slot from the running order (null when there is none).
  time: string | null;
  runOrder: number | null;
  horse: string | null;
  arrived: boolean;
  examinerName: string | null;
  mine: boolean;
  // This viewer's co-judge card on the exam, if they sit on its panel.
  myCard: "todo" | "done" | null;
  passed: boolean | null;
  canRemove: boolean;
  // May mark this rider absent / undo it (managers and the sitting's examiners).
  canMarkAbsent: boolean;
};

const FILTERS = [
  ["all", "All"],
  ["unassigned", "Waiting"],
  ["marking", "Being marked"],
  ["completed", "Marked"],
  ["absent", "Absent"],
] as const;

function AbsentButton({ row }: { row: SittingRiderRow }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const undo = row.state === "absent";
  async function go() {
    if (!undo) {
      const ok = await openConfirm({
        title: `Mark ${row.name} absent?`,
        body: "They come off the queue and the sitting can finish without them. You can undo this if they arrive, and they can be booked onto another exam.",
        confirmLabel: "Mark absent",
      });
      if (!ok) return;
    }
    setBusy(true);
    const res = await postJson(`/api/exams/${row.id}/absent`, { absent: !undo });
    setBusy(false);
    if (!res.ok) return toast.error(res.message);
    toast.success(undo ? `${row.name} is back in the queue` : `${row.name} marked absent`);
    router.refresh();
  }
  return (
    <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={go} disabled={busy}>
      {undo ? "Undo absent" : "Absent"}
    </Button>
  );
}

// One tap for an examiner: take the next rider in the running order.
export function PickNextButton({ sittingId }: { sittingId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    const res = await postJson<{ id: string }>(`/api/exam-sittings/${sittingId}/claim-next`, {});
    setBusy(false);
    if (!res.ok) {
      toast.error(res.message);
      router.refresh();
      return;
    }
    router.push(`/exams/${res.data.id}`);
  }
  return (
    <Button onClick={go} disabled={busy}>
      {busy ? "Picking…" : "Pick next rider"}
    </Button>
  );
}

// The sitting's rider list with search and a status filter. A 200-rider
// sitting was one long unsearchable table: a judge looking for the child in
// front of them scrolled for it.
export function SittingRidersTable({
  rows,
  inPool,
  isManager,
}: {
  rows: SittingRiderRow[];
  inPool: boolean;
  isManager: boolean;
}) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>("all");
  const counts = useMemo(() => {
    const c = { all: rows.length, unassigned: 0, marking: 0, completed: 0, absent: 0 };
    for (const r of rows) c[r.state]++;
    return c;
  }, [rows]);
  const needle = q.trim().toLowerCase();
  const shown = rows.filter(
    (r) =>
      (filter === "all" || r.state === filter) &&
      (!needle ||
        r.name.toLowerCase().includes(needle) ||
        r.school.toLowerCase().includes(needle) ||
        (r.horse ?? "").toLowerCase().includes(needle) ||
        String(r.runOrder ?? "") === needle),
  );
  const timed = rows.some((r) => r.time);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={timed ? "Search rider, school, horse or #…" : "Search rider or school…"}
          aria-label="Search riders in this sitting"
          className="min-w-0 flex-1 sm:max-w-xs"
        />
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by status">
          {FILTERS.map(([key, label]) => (
            <Button
              key={key}
              type="button"
              size="sm"
              variant={filter === key ? "default" : "outline"}
              onClick={() => setFilter(key)}
              aria-pressed={filter === key}
            >
              {label} ({counts[key]})
            </Button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              {timed && <th className="pb-2 pr-2">Slot</th>}
              <th className="pb-2">Rider</th>
              <th className="pb-2">Status</th>
              <th className="pb-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr className="border-t">
                <td colSpan={timed ? 4 : 3} className="py-4 text-center text-sm text-muted-foreground">
                  No riders match.
                </td>
              </tr>
            )}
            {shown.map((e) => (
              <tr key={e.id} className={`border-t ${e.state === "absent" ? "text-muted-foreground" : ""}`}>
                {timed && (
                  <td className="py-2 pr-2 align-top font-mono text-xs">
                    {e.runOrder ? <div className="text-muted-foreground">#{e.runOrder}</div> : null}
                    {e.time ?? "—"}
                  </td>
                )}
                <td className="py-2">
                  <div className="font-medium">{e.name}</div>
                  {(e.school || e.horse) && (
                    <div className="text-[11px] text-muted-foreground">
                      {[e.school, e.horse && `on ${e.horse}`].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </td>
                <td className="py-2">
                  {e.state === "completed" ? (
                    <Badge variant="success">
                      Marked{e.passed === true ? " · passed" : e.passed === false ? " · not passed" : ""}
                    </Badge>
                  ) : e.state === "absent" ? (
                    <Badge variant="outline">Absent</Badge>
                  ) : e.state === "unassigned" ? (
                    <Badge variant={e.arrived ? "success" : "outline"}>{e.arrived ? "Here · waiting" : "Waiting"}</Badge>
                  ) : (
                    <Badge variant="warning">Marking · {e.examinerName}</Badge>
                  )}
                </td>
                <td className="py-2 text-right">
                  <div className="flex items-center justify-end gap-2">
                    {e.state === "completed" ? (
                      <Link href={`/exams/${e.id}`} className="text-xs text-primary underline">
                        View
                      </Link>
                    ) : e.state === "absent" ? (
                      e.canMarkAbsent ? <AbsentButton row={e} /> : <span className="text-xs">—</span>
                    ) : e.myCard === "todo" ? (
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/exams/${e.id}`}>Mark my card</Link>
                      </Button>
                    ) : e.myCard === "done" ? (
                      <span className="text-xs text-muted-foreground">Your card is in</span>
                    ) : e.state === "unassigned" ? (
                      inPool ? <ClaimButton examId={e.id} /> : <span className="text-xs text-muted-foreground">—</span>
                    ) : e.mine ? (
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/exams/${e.id}`}>Continue marking</Link>
                      </Button>
                    ) : isManager ? (
                      <Link href={`/exams/${e.id}`} className="text-xs text-primary underline">
                        Open
                      </Link>
                    ) : (
                      <span className="text-xs text-muted-foreground">Locked · {e.examinerName}</span>
                    )}
                    {e.state === "unassigned" && e.canMarkAbsent && <AbsentButton row={e} />}
                    {e.canRemove && <RemoveExamButton examId={e.id} riderName={e.name} inSitting compact />}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
