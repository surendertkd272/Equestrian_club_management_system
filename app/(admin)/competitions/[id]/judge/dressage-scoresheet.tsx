"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

type Movement = { no: number; letter: string; description: string; coefficient: number };
type Collective = { name: string; coefficient: number };
type Mark = { no: number; mark: number | null; comment?: string };

const JUDGE_POSITIONS = ["C", "E", "B", "M", "H"] as const;

// Per-judge dressage scoresheet. The current user's marks live in
// `myMarks` + `myCollectives`; the right column shows what other judges
// have submitted so officials can sanity-check before the final tally.
export function DressageScoresheet({
  competitionId,
  roundId,
  entryId,
  entryLabel,
}: {
  competitionId: string;
  roundId: string;
  entryId: string;
  entryLabel: string;
}) {
  const [test, setTest] = useState<{
    id: string;
    name: string;
    movements: Movement[];
    collectives: Collective[];
    maxScore: number;
  } | null>(null);
  const [myMarks, setMyMarks] = useState<Mark[]>([]);
  const [myCollectives, setMyCollectives] = useState<Mark[]>([]);
  const [judgePosition, setJudgePosition] = useState<string>("C");
  const [notes, setNotes] = useState("");
  const [otherSheets, setOtherSheets] = useState<Array<{ judgeUserId: string; judgePosition: string | null; percentage: number | null; submittedAt: string | null }>>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/competitions/${competitionId}/dressage-scoresheet?roundId=${roundId}&entryId=${entryId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.test) {
          const t = data.test;
          const movements = JSON.parse(t.movementsJson) as Movement[];
          const collectives = t.collectiveMarksJson ? (JSON.parse(t.collectiveMarksJson) as Collective[]) : [];
          setTest({ id: t.id, name: t.name, movements, collectives, maxScore: t.maxScore });
          // Hydrate from my draft (if any) or start fresh.
          if (data.mySheet) {
            setMyMarks(JSON.parse(data.mySheet.marksJson));
            setMyCollectives(data.mySheet.collectiveMarksJson ? JSON.parse(data.mySheet.collectiveMarksJson) : []);
            setJudgePosition(data.mySheet.judgePosition ?? "C");
            setNotes(data.mySheet.notes ?? "");
          } else {
            setMyMarks(movements.map((m) => ({ no: m.no, mark: null })));
            setMyCollectives(collectives.map((_, i) => ({ no: i + 1, mark: null })));
          }
        }
        if (Array.isArray(data.sheets)) {
          setOtherSheets(
            data.sheets.map((s: any) => ({
              judgeUserId: s.judgeUserId,
              judgePosition: s.judgePosition,
              percentage: s.percentage,
              submittedAt: s.submittedAt,
            })),
          );
        }
      })
      .catch(() => {});
  }, [competitionId, roundId, entryId]);

  // Local percentage preview as the judge marks. Same math as the server,
  // duplicated here so the user sees live feedback instead of waiting.
  const livePercentage = useMemo(() => {
    if (!test) return null;
    let total = 0;
    let counted = 0;
    for (const m of test.movements) {
      const found = myMarks.find((x) => x.no === m.no);
      if (found?.mark === null || found?.mark === undefined) continue;
      total += found.mark * m.coefficient;
      counted++;
    }
    test.collectives.forEach((c, i) => {
      const found = myCollectives.find((x) => x.no === i + 1);
      if (found?.mark === null || found?.mark === undefined) return;
      total += found.mark * c.coefficient;
      counted++;
    });
    if (counted < Math.ceil(test.movements.length / 2)) return null;
    return Math.round((total / test.maxScore) * 1000) / 10;
  }, [test, myMarks, myCollectives]);

  function setMark(no: number, mark: number | null, kind: "movement" | "collective") {
    if (kind === "movement") setMyMarks((rows) => rows.map((r) => (r.no === no ? { ...r, mark } : r)));
    else setMyCollectives((rows) => rows.map((r) => (r.no === no ? { ...r, mark } : r)));
  }
  function setComment(no: number, comment: string, kind: "movement" | "collective") {
    if (kind === "movement") setMyMarks((rows) => rows.map((r) => (r.no === no ? { ...r, comment } : r)));
    else setMyCollectives((rows) => rows.map((r) => (r.no === no ? { ...r, comment } : r)));
  }

  async function save(finalSubmit: boolean) {
    if (!test) return;
    setBusy(true);
    const res = await fetch(`/api/competitions/${competitionId}/dressage-scoresheet`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roundId,
        entryId,
        testId: test.id,
        judgePosition,
        marks: myMarks,
        collectives: myCollectives,
        notes: notes.trim() || null,
        finalSubmit,
      }),
    });
    setBusy(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error ?? "Failed");
      return;
    }
    toast.success(finalSubmit ? `Submitted · ${data.percentage}%` : "Draft saved.");
  }

  if (!test) {
    return (
      <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        Loading test… If this round has no dressage test attached, set one in the round settings first.
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-lg border bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold">{test.name} · {entryLabel}</h3>
          <p className="text-xs text-muted-foreground">
            {test.movements.length} movements + {test.collectives.length} collective marks · max {test.maxScore}
          </p>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Live %</div>
          <div className="text-2xl font-bold">{livePercentage === null ? "—" : `${livePercentage}%`}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label className="text-xs">Judge position</Label>
          <select
            value={judgePosition}
            onChange={(e) => setJudgePosition(e.target.value)}
            className="h-9 rounded border bg-card px-2 text-sm"
          >
            {JUDGE_POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        {otherSheets.length > 0 && (
          <div className="text-xs text-muted-foreground">
            Other judges:{" "}
            {otherSheets.map((s) => (
              <Badge key={s.judgeUserId} variant="outline" className="ml-1 text-[10px]">
                {s.judgePosition ?? "?"}: {s.percentage !== null ? `${s.percentage}%` : "—"}{s.submittedAt ? " ✓" : " draft"}
              </Badge>
            ))}
          </div>
        )}
      </div>

      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="pb-1 w-12">#</th>
            <th className="pb-1 w-16">Letter</th>
            <th className="pb-1">Movement</th>
            <th className="pb-1 w-12 text-center">Coeff</th>
            <th className="pb-1 w-24 text-center">Mark</th>
            <th className="pb-1">Comment</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {test.movements.map((m) => {
            const myMark = myMarks.find((x) => x.no === m.no);
            return (
              <tr key={m.no}>
                <td className="py-1 text-xs text-muted-foreground">{m.no}</td>
                <td className="py-1 font-mono text-xs">{m.letter}</td>
                <td className="py-1">{m.description}</td>
                <td className="py-1 text-center text-xs">{m.coefficient}</td>
                <td className="py-1 text-center">
                  <Input
                    type="number"
                    min={0}
                    max={10}
                    step={0.5}
                    value={myMark?.mark ?? ""}
                    onChange={(e) => setMark(m.no, e.target.value === "" ? null : Number(e.target.value), "movement")}
                    className="h-8 text-center"
                  />
                </td>
                <td className="py-1">
                  <Input
                    value={myMark?.comment ?? ""}
                    onChange={(e) => setComment(m.no, e.target.value, "movement")}
                    className="h-8"
                    placeholder="Comment"
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {test.collectives.length > 0 && (
        <>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Collective marks</div>
          <table className="w-full text-sm">
            <tbody className="divide-y">
              {test.collectives.map((c, i) => {
                const m = myCollectives.find((x) => x.no === i + 1);
                return (
                  <tr key={i}>
                    <td className="py-1 pr-2 w-1/3">{c.name}</td>
                    <td className="py-1 text-center text-xs w-12">{c.coefficient}</td>
                    <td className="py-1 text-center w-24">
                      <Input
                        type="number"
                        min={0}
                        max={10}
                        step={0.5}
                        value={m?.mark ?? ""}
                        onChange={(e) => setMark(i + 1, e.target.value === "" ? null : Number(e.target.value), "collective")}
                        className="h-8 text-center"
                      />
                    </td>
                    <td className="py-1">
                      <Input
                        value={m?.comment ?? ""}
                        onChange={(e) => setComment(i + 1, e.target.value, "collective")}
                        className="h-8"
                        placeholder="Comment"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      <div>
        <Label className="text-xs">Judge's overall remarks</Label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="min-h-[60px] w-full rounded-md border bg-card p-2 text-sm"
          placeholder="Optional summary remarks visible to the organiser."
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => save(false)} disabled={busy}>Save draft</Button>
        <Button onClick={() => save(true)} disabled={busy}>{busy ? "…" : "Submit final"}</Button>
      </div>
    </div>
  );
}
