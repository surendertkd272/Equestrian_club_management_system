"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { openConfirm } from "@/components/ui/confirm-dialog";

type Sponsor = { id: string; name: string; tier: string };
type Prize = {
  id: string;
  className: string;
  placement: number;
  title: string;
  cashAmount: number | null;
  trophyLabel: string | null;
  sponsoredById: string | null;
};
type StartListRow = {
  id: string;
  order: number;
  entry: { id: string; rider: { firstName: string; lastName: string } };
};

export function OpsPanel({
  competitionId,
  classNames,
  drawCompleted,
  initialSponsors,
  initialPrizes,
  canManage,
}: {
  competitionId: string;
  classNames: string[];
  drawCompleted: boolean;
  initialSponsors: Sponsor[];
  initialPrizes: Prize[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [activeClass, setActiveClass] = useState(classNames[0] ?? "");
  const [startList, setStartList] = useState<StartListRow[]>([]);
  const [loadingDraw, setLoadingDraw] = useState(false);

  async function loadStartList(className: string) {
    if (!className) return;
    const res = await fetch(`/api/competitions/${competitionId}/draw?className=${encodeURIComponent(className)}`);
    const data = await res.json().catch(() => ({}));
    if (res.ok) setStartList(data.rows ?? []);
  }

  async function runDraw(finalise: boolean) {
    if (!activeClass) return toast.error("Pick a class first.");
    if (drawCompleted) {
      const ok = await openConfirm({
        title: "Re-run draw?",
        body: "Draw is already finalised. Re-running will overwrite the existing start order.",
        destructive: true,
        confirmLabel: "Overwrite draw",
      });
      if (!ok) return;
    }
    setLoadingDraw(true);
    try {
      const res = await fetch(`/api/competitions/${competitionId}/draw`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ className: activeClass, finalise }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data.error === "NO_ENTRIES" ? "No entries in this class yet." : (data.error ?? "Failed");
        toast.error(msg);
        return;
      }
      toast.success(`${data.count} riders drawn${data.finalised ? " · finalised" : ""}`);
      await loadStartList(activeClass);
      router.refresh();
    } finally {
      setLoadingDraw(false);
    }
  }

  return (
    <div className="space-y-4">
      <SponsorsPanel competitionId={competitionId} initial={initialSponsors} canManage={canManage} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Draw of Lots / Start List</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <Label className="text-xs">Class</Label>
              <Select
                value={activeClass}
                onChange={(e) => {
                  setActiveClass(e.target.value);
                  loadStartList(e.target.value);
                }}
              >
                {classNames.map((n) => <option key={n} value={n}>{n}</option>)}
              </Select>
            </div>
            {canManage && (
              <>
                <Button onClick={() => runDraw(false)} disabled={loadingDraw}>
                  Draw / re-draw
                </Button>
                <Button onClick={() => runDraw(true)} variant="outline" disabled={loadingDraw}>
                  Draw + finalise
                </Button>
              </>
            )}
            <Button variant="outline" size="sm" onClick={() => loadStartList(activeClass)}>
              Refresh
            </Button>
            {drawCompleted && <Badge variant="success">Finalised</Badge>}
          </div>
          {startList.length === 0 ? (
            <p className="text-sm text-muted-foreground">No start list yet. Run a draw to generate one.</p>
          ) : (
            <ol className="space-y-1 text-sm">
              {startList.map((r) => (
                <li key={r.id} className="flex items-center gap-2 rounded border bg-muted/30 px-2 py-1">
                  <span className="w-6 text-right font-mono text-xs text-muted-foreground">#{r.order}</span>
                  <span>{r.entry.rider.firstName} {r.entry.rider.lastName}</span>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      <PrizesPanel
        competitionId={competitionId}
        classNames={classNames}
        sponsors={initialSponsors}
        initial={initialPrizes}
        canManage={canManage}
      />
    </div>
  );
}

function SponsorsPanel({
  competitionId,
  initial,
  canManage,
}: {
  competitionId: string;
  initial: Sponsor[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", tier: "partner", contribution: "" });
  const [busy, setBusy] = useState(false);
  async function add() {
    if (!form.name) return toast.error("Sponsor name required.");
    setBusy(true);
    try {
      const res = await fetch(`/api/competitions/${competitionId}/sponsors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          tier: form.tier,
          contribution: form.contribution ? Number(form.contribution) : undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.message ?? data.error ?? "Failed");
        return;
      }
      toast.success("Added");
      setForm({ name: "", tier: "partner", contribution: "" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Sponsors</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {initial.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sponsors yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {initial.map((s) => (
              <li key={s.id} className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px] uppercase">{s.tier}</Badge>
                <span className="font-medium">{s.name}</span>
              </li>
            ))}
          </ul>
        )}
        {canManage && (
          <div className="grid gap-2 sm:grid-cols-4">
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Sponsor name" />
            <Select value={form.tier} onChange={(e) => setForm((f) => ({ ...f, tier: e.target.value }))}>
              <option value="title">Title</option>
              <option value="platinum">Platinum</option>
              <option value="gold">Gold</option>
              <option value="silver">Silver</option>
              <option value="bronze">Bronze</option>
              <option value="partner">Partner</option>
            </Select>
            <Input type="number" value={form.contribution} onChange={(e) => setForm((f) => ({ ...f, contribution: e.target.value }))} placeholder="₹ contribution" />
            <Button onClick={add} disabled={busy}>Add</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PrizesPanel({
  competitionId,
  classNames,
  sponsors,
  initial,
  canManage,
}: {
  competitionId: string;
  classNames: string[];
  sponsors: Sponsor[];
  initial: Prize[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    className: classNames[0] ?? "",
    placement: "1",
    title: "Winner",
    cashAmount: "",
    trophyLabel: "",
    sponsoredById: "",
  });
  const [busy, setBusy] = useState(false);

  async function upsert() {
    setBusy(true);
    try {
      const res = await fetch(`/api/competitions/${competitionId}/prizes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          className: form.className,
          placement: Number(form.placement),
          title: form.title,
          cashAmount: form.cashAmount ? Number(form.cashAmount) : undefined,
          trophyLabel: form.trophyLabel || undefined,
          sponsoredById: form.sponsoredById || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.message ?? data.error ?? "Failed");
        return;
      }
      toast.success("Prize saved");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Prizes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {initial.length === 0 ? (
          <p className="text-sm text-muted-foreground">No prizes configured yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-2 py-1">Class</th>
                <th className="px-2 py-1">Pos.</th>
                <th className="px-2 py-1">Title</th>
                <th className="px-2 py-1">Cash</th>
                <th className="px-2 py-1">Trophy</th>
                <th className="px-2 py-1">Sponsor</th>
              </tr>
            </thead>
            <tbody>
              {initial.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="px-2 py-1">{p.className}</td>
                  <td className="px-2 py-1">{p.placement}</td>
                  <td className="px-2 py-1">{p.title}</td>
                  <td className="px-2 py-1">{p.cashAmount ? `₹${p.cashAmount.toLocaleString("en-IN")}` : "—"}</td>
                  <td className="px-2 py-1">{p.trophyLabel ?? "—"}</td>
                  <td className="px-2 py-1">{sponsors.find((s) => s.id === p.sponsoredById)?.name ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {canManage && (
          <div className="grid gap-2 md:grid-cols-6">
            <Select value={form.className} onChange={(e) => setForm((f) => ({ ...f, className: e.target.value }))}>
              {classNames.map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
            <Input type="number" min={1} value={form.placement} onChange={(e) => setForm((f) => ({ ...f, placement: e.target.value }))} placeholder="Pos." />
            <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Title" />
            <Input type="number" value={form.cashAmount} onChange={(e) => setForm((f) => ({ ...f, cashAmount: e.target.value }))} placeholder="₹ cash" />
            <Input value={form.trophyLabel} onChange={(e) => setForm((f) => ({ ...f, trophyLabel: e.target.value }))} placeholder="Trophy" />
            <Select value={form.sponsoredById} onChange={(e) => setForm((f) => ({ ...f, sponsoredById: e.target.value }))}>
              <option value="">No sponsor</option>
              {sponsors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
            <Button onClick={upsert} disabled={busy} className="md:col-span-6">Save prize</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
