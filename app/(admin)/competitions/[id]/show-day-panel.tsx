"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

type Resource = "vet_checks" | "stables" | "drug_tests" | "protests";

// Show-day operations panel — federation-specific logs that don't fit
// elsewhere: vet checks, stable allocations, drug tests, protests.
// Tabs share one umbrella endpoint (/show-day?resource=...) so adding
// more log types later is one schema + one switch arm.
export function ShowDayPanel({
  competitionId,
  canManage,
}: {
  competitionId: string;
  canManage: boolean;
}) {
  const [tab, setTab] = useState<Resource>("vet_checks");

  return (
    <div className="rounded-lg border bg-card">
      <div className="border-b px-4 py-3">
        <h3 className="text-sm font-semibold">Show day operations</h3>
        <p className="text-xs text-muted-foreground">Vet checks · stable boxes · drug control · protests</p>
      </div>
      <div className="flex gap-1 border-b px-3 pt-3 text-xs">
        {(
          [
            { k: "vet_checks", label: "Vet checks" },
            { k: "stables", label: "Stables" },
            { k: "drug_tests", label: "Drug control" },
            { k: "protests", label: "Protests" },
          ] as const
        ).map((t) => (
          <button
            key={t.k}
            type="button"
            onClick={() => setTab(t.k)}
            className={`-mb-px rounded-t-md border-b-2 px-3 py-2 font-medium ${
              tab === t.k ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="p-4">
        {tab === "vet_checks" && <VetChecksTab competitionId={competitionId} canManage={canManage} />}
        {tab === "stables" && <StablesTab competitionId={competitionId} canManage={canManage} />}
        {tab === "drug_tests" && <DrugTestsTab competitionId={competitionId} canManage={canManage} />}
        {tab === "protests" && <ProtestsTab competitionId={competitionId} canManage={canManage} />}
      </div>
    </div>
  );
}

function useResource(resource: Resource, competitionId: string) {
  const [rows, setRows] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);

  async function reload() {
    const res = await fetch(`/api/competitions/${competitionId}/show-day?resource=${resource}`);
    const data = await res.json().catch(() => ({}));
    if (res.ok && Array.isArray(data.rows)) setRows(data.rows);
  }
  useEffect(() => { void reload(); }, [resource, competitionId]);

  async function add(body: Record<string, unknown>) {
    setBusy(true);
    const res = await fetch(`/api/competitions/${competitionId}/show-day?resource=${resource}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.message ?? data.error ?? "Failed");
      return false;
    }
    toast.success("Saved.");
    await reload();
    return true;
  }
  return { rows, add, busy };
}

function VetChecksTab({ competitionId, canManage }: { competitionId: string; canManage: boolean }) {
  const { rows, add, busy } = useResource("vet_checks", competitionId);
  const [form, setForm] = useState({ horseName: "", riderName: "", phase: "pre_event", status: "pass", notes: "" });

  return (
    <div className="space-y-3">
      {canManage && (
        <div className="grid gap-2 md:grid-cols-5">
          <Input placeholder="Horse name" value={form.horseName} onChange={(e) => setForm({ ...form, horseName: e.target.value })} />
          <Input placeholder="Rider" value={form.riderName} onChange={(e) => setForm({ ...form, riderName: e.target.value })} />
          <select value={form.phase} onChange={(e) => setForm({ ...form, phase: e.target.value })} className="h-9 rounded border bg-card px-2 text-sm">
            {["pre_event", "first_horse_inspection", "hold_reinspect", "second_horse_inspection", "post_event", "trot_up"].map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="h-9 rounded border bg-card px-2 text-sm">
            {["pass", "hold", "fail", "not_presented"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <Button
            disabled={busy || !form.horseName}
            onClick={async () => {
              const ok = await add({
                horseName: form.horseName,
                riderName: form.riderName || null,
                phase: form.phase,
                status: form.status,
                notes: form.notes || null,
              });
              if (ok) setForm({ horseName: "", riderName: "", phase: "pre_event", status: "pass", notes: "" });
            }}
          >
            Record
          </Button>
        </div>
      )}
      <Rows rows={rows} render={(r: any) => (
        <>
          <span className="font-medium">{r.horseName}</span>
          {r.riderName && <span className="ml-2 text-muted-foreground">{r.riderName}</span>}
          <Badge variant="outline" className="ml-2 text-[10px]">{r.phase}</Badge>
          <Badge variant={r.status === "pass" ? "default" : r.status === "hold" ? "secondary" : "destructive"} className="ml-1 text-[10px]">
            {r.status}
          </Badge>
        </>
      )} dateField="performedAt" />
    </div>
  );
}

function StablesTab({ competitionId, canManage }: { competitionId: string; canManage: boolean }) {
  const { rows, add, busy } = useResource("stables", competitionId);
  const [form, setForm] = useState({ boxNo: "", horseName: "", riderName: "" });
  return (
    <div className="space-y-3">
      {canManage && (
        <div className="grid gap-2 md:grid-cols-4">
          <Input placeholder="Box no (e.g. A12)" value={form.boxNo} onChange={(e) => setForm({ ...form, boxNo: e.target.value })} />
          <Input placeholder="Horse" value={form.horseName} onChange={(e) => setForm({ ...form, horseName: e.target.value })} />
          <Input placeholder="Rider" value={form.riderName} onChange={(e) => setForm({ ...form, riderName: e.target.value })} />
          <Button
            disabled={busy || !form.boxNo || !form.horseName || !form.riderName}
            onClick={async () => {
              const ok = await add(form);
              if (ok) setForm({ boxNo: "", horseName: "", riderName: "" });
            }}
          >
            Allocate
          </Button>
        </div>
      )}
      <Rows rows={rows} render={(r: any) => (
        <>
          <span className="font-mono font-semibold">{r.boxNo}</span>
          <span className="ml-2">{r.horseName}</span>
          <span className="ml-2 text-muted-foreground">{r.riderName}</span>
        </>
      )} dateField="createdAt" />
    </div>
  );
}

function DrugTestsTab({ competitionId, canManage }: { competitionId: string; canManage: boolean }) {
  const { rows, add, busy } = useResource("drug_tests", competitionId);
  const [form, setForm] = useState({ horseName: "", riderName: "", sampleType: "urine", sampleId: "" });
  return (
    <div className="space-y-3">
      {canManage && (
        <div className="grid gap-2 md:grid-cols-5">
          <Input placeholder="Horse" value={form.horseName} onChange={(e) => setForm({ ...form, horseName: e.target.value })} />
          <Input placeholder="Rider" value={form.riderName} onChange={(e) => setForm({ ...form, riderName: e.target.value })} />
          <select value={form.sampleType} onChange={(e) => setForm({ ...form, sampleType: e.target.value })} className="h-9 rounded border bg-card px-2 text-sm">
            {["urine", "blood", "hair"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <Input placeholder="Sample barcode" value={form.sampleId} onChange={(e) => setForm({ ...form, sampleId: e.target.value })} />
          <Button
            disabled={busy || !form.horseName || !form.riderName || !form.sampleId}
            onClick={async () => {
              const ok = await add(form);
              if (ok) setForm({ horseName: "", riderName: "", sampleType: "urine", sampleId: "" });
            }}
          >
            Log sample
          </Button>
        </div>
      )}
      <Rows rows={rows} render={(r: any) => (
        <>
          <span className="font-mono text-xs">{r.sampleId}</span>
          <Badge variant="outline" className="ml-2 text-[10px]">{r.sampleType}</Badge>
          <span className="ml-2">{r.horseName}</span>
          <span className="ml-2 text-muted-foreground">{r.riderName}</span>
          <Badge variant={r.resultStatus === "negative" ? "default" : r.resultStatus === "positive" ? "destructive" : "secondary"} className="ml-2 text-[10px]">
            {r.resultStatus}
          </Badge>
        </>
      )} dateField="collectedAt" />
    </div>
  );
}

function ProtestsTab({ competitionId, canManage }: { competitionId: string; canManage: boolean }) {
  const { rows, add, busy } = useResource("protests", competitionId);
  const [form, setForm] = useState({ filedByName: "", subject: "", body: "", feeAmount: "" });
  return (
    <div className="space-y-3">
      {canManage && (
        <div className="grid gap-2 md:grid-cols-4">
          <Input placeholder="Filed by" value={form.filedByName} onChange={(e) => setForm({ ...form, filedByName: e.target.value })} />
          <Input placeholder="Subject" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} className="md:col-span-2" />
          <Input placeholder="Fee ₹" value={form.feeAmount} onChange={(e) => setForm({ ...form, feeAmount: e.target.value })} type="number" />
          <textarea
            placeholder="Protest contents"
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
            className="md:col-span-4 min-h-[60px] w-full rounded-md border bg-card p-2 text-sm"
          />
          <Button
            disabled={busy || !form.filedByName || !form.subject || !form.body}
            onClick={async () => {
              const ok = await add({
                filedByName: form.filedByName,
                subject: form.subject,
                body: form.body,
                feeAmount: form.feeAmount ? Number(form.feeAmount) : null,
              });
              if (ok) setForm({ filedByName: "", subject: "", body: "", feeAmount: "" });
            }}
            className="md:col-span-4"
          >
            File protest
          </Button>
        </div>
      )}
      <Rows rows={rows} render={(r: any) => (
        <div className="min-w-0 flex-1">
          <div className="font-medium">{r.subject}</div>
          <div className="text-xs text-muted-foreground">{r.filedByName} · {r.body.slice(0, 80)}{r.body.length > 80 ? "…" : ""}</div>
          <Badge variant={r.status === "upheld" ? "default" : r.status === "dismissed" ? "destructive" : "secondary"} className="mt-1 text-[10px]">
            {r.status}
          </Badge>
        </div>
      )} dateField="filedAt" />
    </div>
  );
}

function Rows({ rows, render, dateField }: { rows: any[]; render: (r: any) => React.ReactNode; dateField: string }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No entries yet.</p>;
  return (
    <ul className="divide-y text-sm">
      {rows.map((r) => (
        <li key={r.id} className="flex items-center justify-between gap-2 py-2">
          <div className="min-w-0 flex-1">{render(r)}</div>
          <span className="whitespace-nowrap text-[10px] text-muted-foreground">
            {new Date(r[dateField]).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
          </span>
        </li>
      ))}
    </ul>
  );
}
