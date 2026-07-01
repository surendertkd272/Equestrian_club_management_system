"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { toast } from "sonner";
import { postJson } from "@/lib/client/post-json";

type Log = {
  id: string;
  recordedAt: string;
  tempC: number | null;
  heartRateBpm: number | null;
  respirationRpm: number | null;
  weightKg: number | null;
  appetite: string | null;
  manure: string | null;
  notes: string | null;
};

export function HealthLogPanel({
  horseId,
  initial,
}: {
  horseId: string;
  initial: Log[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [logs, setLogs] = useState<Log[]>(initial);
  const [form, setForm] = useState({
    tempC: "",
    heartRateBpm: "",
    respirationRpm: "",
    weightKg: "",
    appetite: "",
    manure: "",
    notes: "",
  });
  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function add() {
    const payload: any = {};
    if (form.tempC) payload.tempC = Number(form.tempC);
    if (form.heartRateBpm) payload.heartRateBpm = Number(form.heartRateBpm);
    if (form.respirationRpm) payload.respirationRpm = Number(form.respirationRpm);
    if (form.weightKg) payload.weightKg = Number(form.weightKg);
    if (form.appetite) payload.appetite = form.appetite;
    if (form.manure) payload.manure = form.manure;
    if (form.notes) payload.notes = form.notes;
    if (Object.keys(payload).length === 0) {
      toast.error("Fill in at least one reading.");
      return;
    }

    const res = await postJson(`/api/horses/${horseId}/health`, payload);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    toast.success("Reading saved");
    setForm({ tempC: "", heartRateBpm: "", respirationRpm: "", weightKg: "", appetite: "", manure: "", notes: "" });
    startTransition(() => router.refresh());

    // Re-fetch logs (avoid a full page round-trip for the chart)
    const r2 = await fetch(`/api/horses/${horseId}/health`);
    if (r2.ok) {
      const d2 = await r2.json();
      setLogs(d2.logs);
    }
  }

  return (
    <div className="space-y-4">
      <TempChart logs={logs} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <Label className="text-xs">Temp (°C)</Label>
          <Input aria-label="Temp (°C)"
            type="number"
            step="0.1"
            value={form.tempC}
            onChange={(e) => set("tempC", e.target.value)}
            placeholder="37.8"
          />
        </div>
        <div>
          <Label className="text-xs">Heart Rate (bpm)</Label>
          <Input aria-label="Heart rate (bpm)"
            type="number"
            value={form.heartRateBpm}
            onChange={(e) => set("heartRateBpm", e.target.value)}
            placeholder="36"
          />
        </div>
        <div>
          <Label className="text-xs">Respiration (rpm)</Label>
          <Input aria-label="Respiration (rpm)"
            type="number"
            value={form.respirationRpm}
            onChange={(e) => set("respirationRpm", e.target.value)}
            placeholder="12"
          />
        </div>
        <div>
          <Label className="text-xs">Weight (kg)</Label>
          <Input aria-label="Weight (kg)"
            type="number"
            value={form.weightKg}
            onChange={(e) => set("weightKg", e.target.value)}
            placeholder="450"
          />
        </div>
        <div>
          <Label className="text-xs">Appetite</Label>
          <Select aria-label="Appetite" value={form.appetite} onChange={(e) => set("appetite", e.target.value)}>
            <option value="">—</option>
            <option value="good">Good</option>
            <option value="reduced">Reduced</option>
            <option value="none">None</option>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Manure</Label>
          <Select aria-label="Manure" value={form.manure} onChange={(e) => set("manure", e.target.value)}>
            <option value="">—</option>
            <option value="normal">Normal</option>
            <option value="dry">Dry</option>
            <option value="loose">Loose</option>
            <option value="watery">Watery</option>
            <option value="none">None</option>
          </Select>
        </div>
        <div className="col-span-2">
          <Label className="text-xs">Notes</Label>
          <Input aria-label="Notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="lethargic this morning" />
        </div>
      </div>

      <Button onClick={add} disabled={pending} size="sm">
        Log reading
      </Button>

      {logs.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">Recent readings ({logs.length})</summary>
          <table className="mt-2 w-full text-xs">
            <thead className="text-[10px] text-muted-foreground">
              <tr>
                <th className="px-1 py-1 text-left">When</th>
                <th className="px-1 py-1 text-right">Temp</th>
                <th className="px-1 py-1 text-right">HR</th>
                <th className="px-1 py-1 text-right">RPM</th>
                <th className="px-1 py-1">Appetite</th>
                <th className="px-1 py-1">Manure</th>
                <th className="px-1 py-1 text-left">Notes</th>
              </tr>
            </thead>
            <tbody>
              {logs.slice(0, 15).map((l) => (
                <tr key={l.id} className="border-t">
                  <td className="px-1 py-1">{new Date(l.recordedAt).toLocaleString()}</td>
                  <td className={`px-1 py-1 text-right ${tempCls(l.tempC)}`}>{l.tempC ?? "—"}</td>
                  <td className="px-1 py-1 text-right">{l.heartRateBpm ?? "—"}</td>
                  <td className="px-1 py-1 text-right">{l.respirationRpm ?? "—"}</td>
                  <td className="px-1 py-1 text-xs">{l.appetite ?? "—"}</td>
                  <td className="px-1 py-1 text-xs">{l.manure ?? "—"}</td>
                  <td className="px-1 py-1 text-xs text-muted-foreground">{l.notes ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}

function tempCls(t: number | null): string {
  if (t == null) return "";
  if (t < 36.5) return "text-sky-600 font-semibold";
  if (t > 39) return "text-rose-600 font-semibold";
  if (t > 38.5) return "text-amber-600";
  return "";
}

// Inline SVG sparkline for the last 30 temperature readings. Easier than
// pulling in a chart lib for a 200-pixel-wide display.
function TempChart({ logs }: { logs: Log[] }) {
  const data = logs
    .slice(0, 30)
    .filter((l) => l.tempC != null)
    .reverse() as { tempC: number; recordedAt: string }[];
  if (data.length < 2) {
    return (
      <div className="rounded-md border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground">
        Add 2+ temperature readings to see a chart. Normal range 37.2 – 38.3 °C.
      </div>
    );
  }
  const W = 360;
  const H = 60;
  const TOP = 36, BOT = 40; // y-axis range
  const xStep = W / (data.length - 1);
  const points = data
    .map((d, i) => {
      const y = H - ((d.tempC - TOP) / (BOT - TOP)) * H;
      return `${i * xStep},${Math.max(2, Math.min(H - 2, y))}`;
    })
    .join(" ");
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="font-semibold">Temperature trend</span>
        <span className="text-muted-foreground">
          {data.length} readings · normal 37.2 – 38.3 °C
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-16 w-full">
        <line x1="0" x2={W} y1={H - ((37.2 - TOP) / (BOT - TOP)) * H} y2={H - ((37.2 - TOP) / (BOT - TOP)) * H} stroke="currentColor" strokeOpacity="0.15" strokeDasharray="2 2" />
        <line x1="0" x2={W} y1={H - ((38.3 - TOP) / (BOT - TOP)) * H} y2={H - ((38.3 - TOP) / (BOT - TOP)) * H} stroke="currentColor" strokeOpacity="0.15" strokeDasharray="2 2" />
        <polyline fill="none" stroke="#0ea5e9" strokeWidth="1.5" points={points} />
      </svg>
    </div>
  );
}
