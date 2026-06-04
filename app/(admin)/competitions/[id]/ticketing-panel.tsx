"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

type Tier = {
  id: string;
  name: string;
  priceInr: number;
  capacity: number | null;
  description: string | null;
  active: boolean;
  sortOrder: number;
  _count: { tickets: number };
};

// Owner-side tier management + check-in scanner. Two tabs:
//   "Tiers" — create + view current tiers, ticket counts.
//   "Check-in" — scan a ticket QR (or paste the URL) to mark it scanned.
export function TicketingPanel({ competitionId, canManage }: { competitionId: string; canManage: boolean }) {
  const [tab, setTab] = useState<"tiers" | "scan">("tiers");
  return (
    <div className="space-y-3">
      <div className="flex gap-1 text-xs">
        <button
          type="button"
          onClick={() => setTab("tiers")}
          className={`rounded px-2 py-1 ${tab === "tiers" ? "bg-primary text-primary-foreground" : "border bg-card hover:bg-accent"}`}
        >
          Tiers
        </button>
        <button
          type="button"
          onClick={() => setTab("scan")}
          className={`rounded px-2 py-1 ${tab === "scan" ? "bg-primary text-primary-foreground" : "border bg-card hover:bg-accent"}`}
        >
          Check-in
        </button>
      </div>
      {tab === "tiers" ? <TiersTab competitionId={competitionId} canManage={canManage} /> : <CheckInTab />}
    </div>
  );
}

function TiersTab({ competitionId, canManage }: { competitionId: string; canManage: boolean }) {
  const [rows, setRows] = useState<Tier[]>([]);
  const [form, setForm] = useState({ name: "", priceInr: "0", capacity: "", description: "", sortOrder: "0" });
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch(`/api/competitions/${competitionId}/ticket-tiers`);
    const data = await res.json().catch(() => ({}));
    if (res.ok && Array.isArray(data.tiers)) setRows(data.tiers);
  }
  useEffect(() => { void load(); }, [competitionId]);

  async function create() {
    if (!form.name) return toast.error("Name required.");
    setBusy(true);
    const res = await fetch(`/api/competitions/${competitionId}/ticket-tiers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        priceInr: Number(form.priceInr) || 0,
        capacity: form.capacity ? Number(form.capacity) : null,
        description: form.description || null,
        sortOrder: Number(form.sortOrder) || 0,
      }),
    });
    setBusy(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error === "DUPLICATE_NAME" ? "A tier with that name already exists." : data.error ?? "Failed");
      return;
    }
    toast.success("Tier created.");
    setForm({ name: "", priceInr: "0", capacity: "", description: "", sortOrder: "0" });
    await load();
  }

  return (
    <div className="space-y-3">
      {canManage && (
        <div className="grid gap-2 md:grid-cols-5 rounded border p-3">
          <Input placeholder="Tier name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input placeholder="Price ₹ (0 = free)" type="number" value={form.priceInr} onChange={(e) => setForm({ ...form, priceInr: e.target.value })} />
          <Input placeholder="Capacity (blank = ∞)" type="number" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} />
          <Input placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <Button onClick={create} disabled={busy}>Add tier</Button>
        </div>
      )}
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tiers yet — visitors can't buy tickets.</p>
      ) : (
        <ul className="divide-y text-sm">
          {rows.map((t) => (
            <li key={t.id} className="flex items-center justify-between py-2">
              <div>
                <span className="font-medium">{t.name}</span>
                <Badge variant="outline" className="ml-2 text-[10px]">{t.priceInr === 0 ? "Free" : `₹${t.priceInr.toLocaleString("en-IN")}`}</Badge>
                {!t.active && <Badge variant="outline" className="ml-1 text-[10px] text-amber-700">paused</Badge>}
                {t.description && <span className="ml-2 text-xs text-muted-foreground">{t.description}</span>}
              </div>
              <div className="text-xs text-muted-foreground">
                {t._count.tickets} sold{t.capacity !== null && ` / ${t.capacity}`}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CheckInTab() {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function scan(raw: string) {
    // Accept either a raw ID or a /tickets/<id> URL.
    let id = raw.trim();
    if (id.includes("/tickets/")) id = id.split("/tickets/")[1].split(/[?#]/)[0];
    if (!id) return;
    setBusy(true);
    const res = await fetch("/api/tickets/check-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticketId: id }),
    });
    setBusy(false);
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setResult({ ok: true, message: `✓ ${data.buyerName} · ${data.tierName} checked in.` });
    } else {
      setResult({
        ok: false,
        message:
          data.error === "ALREADY_CHECKED_IN" ? `Already checked in (${data.buyerName} · ${new Date(data.at).toLocaleString("en-IN")}).`
          : data.error === "VOIDED" ? `Voided ticket — refuse entry. (${data.buyerName})`
          : data.error === "NOT_PAID" ? `Payment not confirmed yet — ask buyer to refresh their email.`
          : data.error === "TICKET_NOT_FOUND" ? "Ticket not found — bad ID."
          : data.error ?? "Failed",
      });
    }
    setInput("");
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Paste the ticket QR contents or the <code>/tickets/...</code> URL. A real QR scanner posts the same payload.
      </p>
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && scan(input)}
          placeholder="Ticket ID or URL"
          autoFocus
        />
        <Button onClick={() => scan(input)} disabled={busy || !input}>Check in</Button>
      </div>
      {result && (
        <div className={`rounded-md border p-3 text-sm ${result.ok ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-amber-300 bg-amber-50 text-amber-900"}`}>
          {result.message}
        </div>
      )}
    </div>
  );
}
