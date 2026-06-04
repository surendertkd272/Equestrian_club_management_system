"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { openConfirm } from "@/components/ui/confirm-dialog";

type Rider = { id: string; firstName: string; lastName: string };

export function TeamsClient({ canManage, riders }: { canManage: boolean; riders: Rider[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", season: "", discipline: "" });
  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function create() {
    if (!form.name) return toast.error("Team name required.");
    setBusy(true);
    try {
      const res = await fetch("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          season: form.season || undefined,
          discipline: form.discipline || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.message ?? data.error ?? "Failed");
        return;
      }
      toast.success("Team created");
      setForm({ name: "", season: "", discipline: "" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!canManage) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">New team</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2 sm:grid-cols-4">
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Senior Show Jumping 2026" />
          <Input value={form.season} onChange={(e) => set("season", e.target.value)} placeholder="Season (2026)" />
          <Input value={form.discipline} onChange={(e) => set("discipline", e.target.value)} placeholder="Discipline (jumping, dressage…)" />
          <Button onClick={create} disabled={busy}>{busy ? "Creating…" : "+ Create"}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

// Edit a team's name / season / discipline (PATCH /api/teams/[id]).
export function EditTeam({ team }: { team: { id: string; name: string; season: string | null; discipline: string | null } }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: team.name, season: team.season ?? "", discipline: team.discipline ?? "" });

  async function save() {
    if (!form.name.trim()) return toast.error("Team name required.");
    setBusy(true);
    try {
      const res = await fetch(`/api/teams/${team.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.name.trim(), season: form.season || undefined, discipline: form.discipline || undefined }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast.error(d.error ?? "Failed");
        return;
      }
      toast.success("Team updated");
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="ml-2 text-xs text-primary hover:underline">
        Edit
      </button>
    );
  }
  return (
    <span className="ml-2 inline-flex flex-wrap items-center gap-1 align-middle">
      <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="h-7 w-44 text-xs" />
      <Input value={form.season} onChange={(e) => setForm((f) => ({ ...f, season: e.target.value }))} placeholder="Season" className="h-7 w-24 text-xs" />
      <Input value={form.discipline} onChange={(e) => setForm((f) => ({ ...f, discipline: e.target.value }))} placeholder="Discipline" className="h-7 w-28 text-xs" />
      <Button size="sm" className="h-7" disabled={busy} onClick={save}>{busy ? "…" : "Save"}</Button>
      <Button size="sm" variant="ghost" className="h-7" onClick={() => setOpen(false)}>Cancel</Button>
    </span>
  );
}

export function TeamRosterControls({
  teamId,
  riders,
  existingRiderIds,
}: {
  teamId: string;
  riders: Rider[];
  existingRiderIds: string[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [riderId, setRiderId] = useState("");
  const [position, setPosition] = useState("");

  const available = riders.filter((r) => !existingRiderIds.includes(r.id));

  async function add() {
    if (!riderId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/teams/${teamId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ riderId, position: position || undefined }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.message ?? data.error ?? "Failed");
        return;
      }
      toast.success("Member added");
      setRiderId("");
      setPosition("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(rid: string) {
    const ok = await openConfirm({
      title: "Remove this rider from the team?",
      destructive: true,
      confirmLabel: "Remove",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/teams/${teamId}/members?riderId=${rid}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.message ?? data.error ?? "Failed");
        return;
      }
      toast.success("Removed");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 border-t pt-3">
      <div className="grid gap-2 sm:grid-cols-4">
        <div className="sm:col-span-2">
          <Label className="text-xs">Add rider</Label>
          <Select value={riderId} onChange={(e) => setRiderId(e.target.value)}>
            <option value="">— Pick a rider —</option>
            {available.map((r) => (
              <option key={r.id} value={r.id}>{r.firstName} {r.lastName}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label className="text-xs">Position (optional)</Label>
          <Input value={position} onChange={(e) => setPosition(e.target.value)} placeholder="Captain, Reserve…" />
        </div>
        <div className="self-end">
          <Button size="sm" disabled={busy || !riderId} onClick={add}>+ Add</Button>
        </div>
      </div>
      {existingRiderIds.length > 0 && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-muted-foreground">Remove a member…</summary>
          <ul className="mt-1 space-y-0.5">
            {existingRiderIds.map((rid) => {
              const r = riders.find((x) => x.id === rid);
              if (!r) return null;
              return (
                <li key={rid} className="flex items-center justify-between">
                  <span>{r.firstName} {r.lastName}</span>
                  <button
                    type="button"
                    onClick={() => remove(rid)}
                    disabled={busy}
                    className="rounded border border-rose-300 px-1.5 py-0.5 text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </div>
  );
}
