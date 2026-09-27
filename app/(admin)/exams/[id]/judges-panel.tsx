"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Crown } from "lucide-react";
import { openConfirm } from "@/components/ui/confirm-dialog";
import { roleLabel } from "@/lib/labels";
type Judge = {
  id: string;
  judgeId: string;
  judgeName: string;
  position: number;
  submittedAt: string | null;
  subTotal: number | null;
};

type UserOption = { id: string; name: string; role: string };

export function JudgesPanel({
  examId,
  leadExaminerId,
  leadExaminerName,
  leadSubmitted,
  completed,
  canManage,
  judges,
}: {
  examId: string;
  leadExaminerId: string;
  leadExaminerName: string;
  // Each judge locks their own card; the exam completes when every card is in.
  leadSubmitted: boolean;
  completed: boolean;
  canManage: boolean;
  judges: Judge[];
}) {
  const router = useRouter();
  const [candidates, setCandidates] = useState<UserOption[]>([]);
  const [pick, setPick] = useState<string>("");
  const [busy, setBusy] = useState(false);

  // Lead is always position #1 (synthetic). Co-judges are persisted rows
  // with position ≥ 2.
  const coJudges = judges.filter((j) => j.judgeId !== leadExaminerId);

  useEffect(() => {
    // JURY role listed first — they're the primary judging-panel members.
    fetch("/api/users/lookup?role=EXAMINER,HEAD_COACH,SUPER_ADMIN,CENTRE_MANAGER")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.users)) {
          setCandidates(d.users.filter((u: UserOption) => u.id !== leadExaminerId));
        }
      })
      .catch(() => {});
  }, [leadExaminerId]);

  async function addJudge() {
    if (!pick) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/exams/${examId}/judges`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ judgeId: pick }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Failed");
        return;
      }
      toast.success("Jury member added");
      setPick("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function removeJudge(judgeRowId: string) {
    const ok = await openConfirm({
      title: "Remove jury member?",
      body:
        "Their card (if any) is discarded from the average. If every remaining judge has already submitted, " +
        "the exam completes now and the result is sent to the rider and their parents.",
      destructive: true,
      confirmLabel: "Remove",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/exams/${examId}/judges/${judgeRowId}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? "Failed");
        return;
      }
      toast.success(data.completed ? "Removed — every card was in, so the exam is now complete" : "Removed");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Jury Panel</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="space-y-1 text-sm">
          <li className="flex items-center gap-2 rounded border bg-muted/40 px-2 py-1.5">
            <Crown className="h-4 w-4 text-amber-600" />
            <span className="font-medium">{leadExaminerName}</span>
            <Badge variant="outline" className="ml-1 text-[10px] uppercase">Lead</Badge>
            <CardState submitted={leadSubmitted} completed={completed} />
          </li>
          {coJudges.map((j) => (
            <li key={j.id} className="flex items-center justify-between rounded border px-2 py-1.5">
              <div className="flex items-center gap-2">
                <span className="font-medium">{j.judgeName}</span>
                <Badge variant="outline" className="text-[10px] uppercase">jury</Badge>
                <CardState submitted={!!j.submittedAt} completed={completed} subTotal={j.subTotal} />
              </div>
              {canManage && !completed && (
                <button
                  type="button"
                  onClick={() => removeJudge(j.id)}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label="remove"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>

        {canManage && !completed && candidates.length > 0 && (
          <div className="flex items-end gap-2">
            <Select value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Add a jury member…</option>
              {candidates
                .filter((u) => !coJudges.some((j) => j.judgeId === u.id))
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} · {roleLabel(u.role)}
                  </option>
                ))}
            </Select>
            <Button onClick={addJudge} disabled={!pick || busy} size="sm">
              <Plus className="h-3.5 w-3.5" /> Add
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Whether this judge's card is in. The exam only completes when every card
// on the panel is submitted.
function CardState({
  submitted,
  completed,
  subTotal,
}: {
  submitted: boolean;
  completed: boolean;
  subTotal?: number | null;
}) {
  if (submitted) {
    return (
      <Badge variant="success" className="text-[10px]">
        submitted {typeof subTotal === "number" ? `· ${subTotal}` : ""}
      </Badge>
    );
  }
  if (completed) return null;
  return (
    <Badge variant="warning" className="text-[10px]">
      card open
    </Badge>
  );
}
