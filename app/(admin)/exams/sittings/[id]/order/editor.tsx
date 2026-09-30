"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { openConfirm } from "@/components/ui/confirm-dialog";
import { postJson, sendJson } from "@/lib/client/post-json";
import { Copy, Printer } from "lucide-react";

type Row = { id: string; order: number | null; time: string; name: string; school: string; status: string; horseId: string | null };
type Horse = { id: string; name: string; held: boolean; minutes: number; rides: number };

export function RunningOrderEditor({
  sittingId,
  title,
  date,
  canEdit,
  canHorses,
  hasOrder,
  defaults,
  capMinutes,
  horses,
  rows,
}: {
  sittingId: string;
  title: string;
  date: string;
  canEdit: boolean;
  canHorses: boolean;
  hasOrder: boolean;
  defaults: { start: string; slotMinutes: number };
  capMinutes: number;
  horses: Horse[];
  rows: Row[];
}) {
  const router = useRouter();
  const [start, setStart] = useState(defaults.start);
  const [slot, setSlot] = useState(String(defaults.slotMinutes));
  const [breakEvery, setBreakEvery] = useState("20");
  const [breakMinutes, setBreakMinutes] = useState("15");
  const [sort, setSort] = useState("current");
  const [busy, setBusy] = useState(false);
  const horseName = new Map(horses.map((h) => [h.id, h.name]));

  async function generate() {
    if (hasOrder) {
      const ok = await openConfirm({
        title: "Re-do the running order?",
        body: "Riders still waiting get new places and times. Riders already riding, marked or absent keep theirs. Booked horses move with their rider, or are released if the horse isn't free at the new time.",
        confirmLabel: "Re-do order",
      });
      if (!ok) return;
    }
    setBusy(true);
    const res = await postJson<{ ordered: number; first: string | null; last: string | null; horsesReleased: { horse: string }[] }>(
      `/api/exam-sittings/${sittingId}/running-order`,
      {
        start,
        slotMinutes: Number(slot),
        breakEvery: Number(breakEvery) || null,
        breakMinutes: Number(breakMinutes) || null,
        sort,
      },
    );
    setBusy(false);
    if (!res.ok) return toast.error(res.message);
    toast.success(
      `${res.data.ordered} riders from ${res.data.first ?? "—"} to ${res.data.last ?? "—"}` +
        (res.data.horsesReleased.length ? ` · ${res.data.horsesReleased.length} horse booking(s) released — pick again` : ""),
    );
    router.refresh();
  }

  async function setHorse(examId: string, horseId: string) {
    const res = await sendJson("PUT", `/api/exams/${examId}/horse`, { horseId: horseId || null });
    if (!res.ok) {
      toast.error(res.message);
      router.refresh();
      return;
    }
    router.refresh();
  }

  function copyList() {
    const lines = rows
      .filter((r) => r.status !== "absent")
      .map((r) => `${r.order ? `#${r.order} ` : ""}${r.time} — ${r.name}${r.school ? ` (${r.school})` : ""}${r.horseId ? ` · ${horseName.get(r.horseId)}` : ""}`);
    const text = `${title} · ${date}\n${lines.join("\n")}`;
    navigator.clipboard?.writeText(text).then(
      () => toast.success("Running order copied — paste it into WhatsApp"),
      () => toast.error("Couldn't copy"),
    );
  }

  const busyHorses = horses.filter((h) => h.rides > 0).sort((a, b) => b.minutes - a.minutes);

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="grid gap-3 rounded-md border bg-card p-3 sm:grid-cols-5 print:hidden">
          <div>
            <Label htmlFor="ro-start">First rider at</Label>
            <Input id="ro-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="ro-slot">Minutes per rider</Label>
            <Input id="ro-slot" type="number" min={2} max={60} value={slot} onChange={(e) => setSlot(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="ro-every">Break after every</Label>
            <Input id="ro-every" type="number" min={0} value={breakEvery} onChange={(e) => setBreakEvery(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="ro-break">Break minutes</Label>
            <Input id="ro-break" type="number" min={0} value={breakMinutes} onChange={(e) => setBreakMinutes(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="ro-sort">Order</Label>
            <Select id="ro-sort" value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="current">{hasOrder ? "Keep current order" : "By name"}</option>
              <option value="name">By name</option>
              <option value="school">By school &amp; class</option>
              <option value="random">Random draw</option>
            </Select>
          </div>
          <div className="sm:col-span-5">
            <Button onClick={generate} disabled={busy}>
              {busy ? "Working…" : hasOrder ? "Re-do running order" : "Make running order"}
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 print:hidden">
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Printer className="h-4 w-4" /> Print
        </Button>
        <Button variant="outline" size="sm" onClick={copyList} disabled={!hasOrder}>
          <Copy className="h-4 w-4" /> Copy for WhatsApp
        </Button>
      </div>

      {canHorses && hasOrder && busyHorses.length > 0 && (
        <div className="rounded-md border bg-card p-3 text-sm print:hidden">
          <div className="mb-2 font-medium">Horses working this day</div>
          <div className="flex flex-wrap gap-1.5">
            {busyHorses.map((h) => (
              <Badge key={h.id} variant={h.minutes > capMinutes * 0.85 ? "warning" : "outline"}>
                {h.name} · {h.rides} ride{h.rides === 1 ? "" : "s"} · {h.minutes}/{capMinutes} min
              </Badge>
            ))}
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-md border bg-card">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Time</th>
              <th className="px-3 py-2">Rider</th>
              <th className="px-3 py-2">Horse</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const open = r.status === "scheduled" || r.status === "in_progress";
              return (
                <tr key={r.id} className={`border-b last:border-b-0 ${r.status === "absent" ? "text-muted-foreground line-through" : ""}`}>
                  <td className="px-3 py-1.5 font-mono text-xs">{r.order ?? "—"}</td>
                  <td className="px-3 py-1.5 font-mono text-xs">{hasOrder ? r.time : "—"}</td>
                  <td className="px-3 py-1.5">
                    <div className="font-medium">{r.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {r.school}
                      {r.status !== "scheduled" ? ` · ${r.status.replaceAll("_", " ")}` : ""}
                    </div>
                  </td>
                  <td className="px-3 py-1.5">
                    {canHorses && hasOrder && open ? (
                      <Select
                        aria-label={`Horse for ${r.name}`}
                        value={r.horseId ?? ""}
                        onChange={(e) => setHorse(r.id, e.target.value)}
                        className="h-8 w-44 print:hidden"
                      >
                        <option value="">— no horse —</option>
                        {horses.map((h) => (
                          <option key={h.id} value={h.id} disabled={h.held}>
                            {h.name}
                            {h.held ? " (withdrawal)" : ` · ${h.minutes} min`}
                          </option>
                        ))}
                      </Select>
                    ) : null}
                    <span className={canHorses && hasOrder && open ? "hidden print:inline" : ""}>
                      {r.horseId ? horseName.get(r.horseId) ?? "—" : "—"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!hasOrder && canHorses && (
        <p className="text-xs text-muted-foreground print:hidden">
          Horses are booked for each rider&rsquo;s time slot — make the running order first.
        </p>
      )}
    </div>
  );
}
