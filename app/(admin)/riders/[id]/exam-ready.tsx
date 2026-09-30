"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { postJson } from "@/lib/client/post-json";

// A coach nominates the rider for an exam level — shown to whoever books the exam day.
export function ExamReady({
  riderId,
  levels,
  current,
}: {
  riderId: string;
  levels: { rank: number; name: string }[];
  current: { level: number; note: string | null; by: string | null; at: string } | null;
}) {
  const router = useRouter();
  const [level, setLevel] = useState(String(current?.level ?? levels[0]?.rank ?? ""));
  const [note, setNote] = useState(current?.note ?? "");
  const [busy, setBusy] = useState(false);
  async function save(clear = false) {
    setBusy(true);
    const res = await postJson(`/api/riders/${riderId}/exam-ready`, clear ? { level: null } : { level: Number(level), note: note || undefined });
    setBusy(false);
    if (!res.ok) return toast.error(res.message);
    toast.success(clear ? "Nomination withdrawn" : "Nominated — it shows when the next exam day is booked");
    router.refresh();
  }
  return (
    <div className="space-y-2 text-sm">
      {current && (
        <p>
          Ready for <span className="font-semibold">{levels.find((l) => l.rank === current.level)?.name ?? `Level ${current.level}`}</span>
          {current.by ? ` — ${current.by}` : ""}, {new Date(current.at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" })}
          {current.note ? `: ${current.note}` : ""}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="Ready for level" value={level} onChange={(e) => setLevel(e.target.value)} className="w-40">
          {levels.map((l) => (
            <option key={l.rank} value={l.rank}>
              {l.name}
            </option>
          ))}
        </Select>
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" maxLength={300} className="min-w-0 flex-1" aria-label="Nomination note" />
        <Button size="sm" onClick={() => save()} disabled={busy || !level}>
          {current ? "Update" : "Nominate for exam"}
        </Button>
        {current && (
          <Button size="sm" variant="ghost" onClick={() => save(true)} disabled={busy}>
            Withdraw
          </Button>
        )}
      </div>
    </div>
  );
}
