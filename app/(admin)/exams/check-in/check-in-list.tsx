"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { postJson } from "@/lib/client/post-json";

type Row = { id: string; group: string; time: string | null; order: number | null; name: string; school: string; state: "expected" | "here" | "riding" | "absent" };

export function CheckInList({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [only, setOnly] = useState<"all" | "expected">("expected");
  const [busy, setBusy] = useState<string | null>(null);
  const needle = q.trim().toLowerCase();
  const shown = rows.filter(
    (r) => (only === "all" || r.state === "expected") && (!needle || r.name.toLowerCase().includes(needle) || String(r.order ?? "") === needle),
  );
  const count = (s: Row["state"]) => rows.filter((r) => r.state === s).length;

  async function toggle(r: Row, arrived: boolean) {
    setBusy(r.id);
    const res = await postJson(`/api/exams/${r.id}/check-in`, { arrived });
    setBusy(null);
    if (!res.ok) return toast.error(res.message);
    if (arrived) toast.success(`${r.name} is here`);
    router.refresh();
  }
  async function absent(r: Row) {
    setBusy(r.id);
    const res = await postJson(`/api/exams/${r.id}/absent`, { absent: true });
    setBusy(null);
    if (!res.ok) return toast.error(res.message);
    toast.success(`${r.name} marked absent`);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5 text-xs">
        <Badge variant="outline">{count("expected")} expected</Badge>
        <Badge variant="success">{count("here")} here</Badge>
        <Badge variant="warning">{count("riding")} riding</Badge>
        <Badge variant="outline">{count("absent")} absent</Badge>
      </div>
      <div className="flex flex-wrap gap-2">
        <Input className="min-w-0 flex-1" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or #…" aria-label="Find a rider" />
        <Button size="sm" variant={only === "expected" ? "default" : "outline"} onClick={() => setOnly("expected")}>
          Not arrived
        </Button>
        <Button size="sm" variant={only === "all" ? "default" : "outline"} onClick={() => setOnly("all")}>
          Everyone
        </Button>
      </div>
      <ul className="divide-y rounded-md border bg-card">
        {shown.length === 0 && <li className="p-4 text-center text-sm text-muted-foreground">No one here.</li>}
        {shown.map((r) => (
          <li key={r.id} className="flex items-center gap-3 px-3 py-2">
            <div className="w-14 shrink-0 font-mono text-xs text-muted-foreground">
              {r.order ? `#${r.order}` : ""}
              <div>{r.time ?? ""}</div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{r.name}</div>
              <div className="truncate text-[11px] text-muted-foreground">{[r.group, r.school].filter(Boolean).join(" · ")}</div>
            </div>
            {r.state === "expected" && (
              <>
                <Button size="sm" variant="ghost" className="h-10 px-2 text-xs" disabled={busy === r.id} onClick={() => absent(r)}>
                  Absent
                </Button>
                <Button size="sm" className="h-10 min-w-20" disabled={busy === r.id} onClick={() => toggle(r, true)}>
                  Arrived
                </Button>
              </>
            )}
            {r.state === "here" && (
              <Button size="sm" variant="outline" className="h-10" disabled={busy === r.id} onClick={() => toggle(r, false)}>
                ✓ Here · undo
              </Button>
            )}
            {r.state === "riding" && <Badge variant="warning">Riding</Badge>}
            {r.state === "absent" && <Badge variant="outline">Absent</Badge>}
          </li>
        ))}
      </ul>
    </div>
  );
}
