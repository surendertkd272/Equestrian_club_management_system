"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScoringEngine } from "@/components/scoring/scoring-engine";
import { openConfirm } from "@/components/ui/confirm-dialog";
import { computeTotal, type RubricCategory } from "@/lib/schemas/exam";

type Card = {
  examId: string;
  card: "lead" | "judge";
  judgeId: string | null;
  order: number | null;
  time: string;
  rider: string;
  rubric: RubricCategory[];
  scores: Record<string, number | string>;
  // local state
  state?: "todo" | "ready" | "sent" | "error";
  error?: string;
};
type Pack = { fetchedAt: string; sitting: { id: string; title: string; passThreshold: number | null }; cards: Card[] };

const key = (sittingId: string, userId: string) => `ew:offline-pack:${sittingId}:${userId}`;
const load = (k: string): Pack | null => {
  try {
    const raw = localStorage.getItem(k);
    return raw ? (JSON.parse(raw) as Pack) : null;
  } catch {
    return null;
  }
};
const store = (k: string, p: Pack) => {
  try {
    localStorage.setItem(k, JSON.stringify(p));
  } catch {
    toast.error("This phone's storage is full — marks can't be kept offline.");
  }
};

// Marks a pack of riders with no connection, then sends every finished card
// (and every draft) when the signal is back.
export function OfflineMarker({ sittingId, userId, inPool }: { sittingId: string; userId: string; inPool: boolean }) {
  const k = key(sittingId, userId);
  const [pack, setPack] = useState<Pack | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPack(load(k));
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, [k]);

  const save = useCallback((p: Pack) => {
    setPack(p);
    store(k, p);
  }, [k]);

  async function fetchPack(take: number) {
    setBusy(true);
    try {
      const res = await fetch(`/api/exam-sittings/${sittingId}/offline-pack`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ take }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return toast.error(data.message ?? data.error ?? "Couldn't get riders");
      // Keep marks already made on this phone for cards still in the pack.
      const mine = new Map((pack?.cards ?? []).map((c) => [c.examId + c.card, c]));
      const cards: Card[] = (data.cards as Card[]).map((c) => {
        const prev = mine.get(c.examId + c.card);
        return prev && prev.state !== "sent" ? { ...c, scores: prev.scores, state: prev.state } : { ...c, state: "todo" };
      });
      save({ fetchedAt: data.fetchedAt, sitting: data.sitting, cards });
      toast.success(`${cards.length} rider${cards.length === 1 ? "" : "s"} on this phone${data.claimed ? ` (${data.claimed} new)` : ""}`);
    } catch {
      toast.error("No connection — get riders while you still have signal.");
    } finally {
      setBusy(false);
    }
  }

  function update(examId: string, card: string, patch: Partial<Card>) {
    if (!pack) return;
    save({ ...pack, cards: pack.cards.map((c) => (c.examId === examId && c.card === card ? { ...c, ...patch } : c)) });
  }

  async function finish(c: Card) {
    const unscored = c.rubric.flatMap((cat) => cat.items).length - Object.keys(c.scores).length;
    if (unscored > 0) {
      const ok = await openConfirm({
        title: `Finish with items unscored?`,
        body: "Unscored items count as zero. The card is sent as final when the signal is back.",
        confirmLabel: "Finish anyway",
        destructive: true,
      });
      if (!ok) return;
    }
    update(c.examId, c.card, { state: "ready" });
    setOpen(null);
  }

  const sync = useCallback(async () => {
    if (!pack || busy) return;
    const due = pack.cards.filter((c) => c.state === "ready" || (c.state !== "sent" && Object.keys(c.scores).length > 0));
    if (due.length === 0) return;
    setBusy(true);
    let next = pack;
    let sent = 0;
    for (const c of due) {
      const final = c.state === "ready";
      try {
        const res = await fetch(`/api/exams/${c.examId}/score`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scores: c.scores, final, ...(final ? { allowIncomplete: true } : {}), ...(c.judgeId ? { judgeId: c.judgeId } : {}) }),
        });
        const data = await res.json().catch(() => ({}));
        next = {
          ...next,
          cards: next.cards.map((x) =>
            x.examId === c.examId && x.card === c.card
              ? res.ok
                ? { ...x, state: final ? "sent" : x.state }
                : { ...x, state: "error", error: data.message ?? data.error ?? "Not accepted" }
              : x,
          ),
        };
        if (res.ok && final) sent++;
      } catch {
        break; // signal gone again — try later
      }
    }
    save(next);
    setBusy(false);
    if (sent) toast.success(`${sent} card${sent === 1 ? "" : "s"} sent`);
  }, [pack, busy, save]);

  useEffect(() => {
    if (online) void sync();
    // Only when the connection comes back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  const current = pack?.cards.find((c) => c.examId + c.card === open) ?? null;
  const count = (s: Card["state"]) => pack?.cards.filter((c) => c.state === s).length ?? 0;

  if (current) {
    const { total, max } = computeTotal(current.rubric, current.scores);
    return (
      <div className="mx-auto max-w-2xl space-y-3">
        <Button variant="ghost" size="sm" onClick={() => setOpen(null)}>
          ← All riders
        </Button>
        <div>
          <h1 className="text-xl font-bold">{current.rider}</h1>
          <p className="text-sm text-muted-foreground">
            {pack?.sitting.title} · {current.order ? `#${current.order} · ` : ""}
            {current.time} · {current.card === "lead" ? "your card (lead)" : "your panel card"}
          </p>
        </div>
        <ScoringEngine
          key={current.examId + current.card}
          rubricConfig={current.rubric}
          initialScores={current.scores}
          readOnly={current.state === "sent"}
          onScoreChange={(s) => update(current.examId, current.card, { scores: s, ...(current.state === "error" ? { state: "todo" } : {}) })}
        />
        <div className="sticky bottom-2 flex items-center justify-between gap-2 rounded-lg border bg-card p-3 shadow-lg">
          <span className="text-sm">
            Total <b>{total}</b> / {max} · <span className="text-muted-foreground">kept on this phone</span>
          </span>
          {current.state !== "sent" && (
            <Button onClick={() => finish(current)} className="bg-emerald-600 hover:bg-emerald-700">
              Finish card
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link href={`/exams/sittings/${sittingId}`} className="text-xs text-muted-foreground hover:underline">
        ← Sitting
      </Link>
      <div>
        <h1 className="text-2xl font-bold">Marking with no signal</h1>
        <p className="text-sm text-muted-foreground">
          {pack ? `${pack.sitting.title} · riders taken ${new Date(pack.fetchedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}` : "Take your riders while you have signal, then mark them here in the arena."}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={online ? "success" : "warning"}>{online ? "Online" : "No signal — marks are kept on this phone"}</Badge>
        {count("ready") > 0 && <Badge variant="warning">{count("ready")} waiting to send</Badge>}
        {count("sent") > 0 && <Badge variant="outline">{count("sent")} sent</Badge>}
      </div>
      <div className="flex flex-wrap gap-2">
        {inPool && (
          <Button onClick={() => fetchPack(5)} disabled={busy || !online}>
            Take my next 5 riders
          </Button>
        )}
        <Button variant="outline" onClick={() => fetchPack(0)} disabled={busy || !online}>
          {inPool ? "Refresh my cards" : "Get my panel cards"}
        </Button>
        <Button variant="outline" onClick={() => void sync()} disabled={busy || !online || (count("ready") === 0)}>
          Send finished cards
        </Button>
      </div>
      <ul className="divide-y rounded-md border bg-card">
        {(!pack || pack.cards.length === 0) && <li className="p-4 text-center text-sm text-muted-foreground">No riders on this phone yet.</li>}
        {pack?.cards.map((c) => (
          <li key={c.examId + c.card}>
            <button type="button" onClick={() => setOpen(c.examId + c.card)} className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-muted/40">
              <span className="w-12 font-mono text-xs text-muted-foreground">{c.order ? `#${c.order}` : ""}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{c.rider}</span>
                <span className="block text-[11px] text-muted-foreground">
                  {c.time} · {c.card === "lead" ? "lead" : "panel"} · {Object.keys(c.scores).length} marks
                </span>
                {c.state === "error" && <span className="block text-[11px] text-destructive">{c.error}</span>}
              </span>
              <Badge variant={c.state === "sent" ? "success" : c.state === "ready" ? "warning" : "outline"}>
                {c.state === "sent" ? "Sent" : c.state === "ready" ? "Finished" : c.state === "error" ? "Not sent" : "To mark"}
              </Badge>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
