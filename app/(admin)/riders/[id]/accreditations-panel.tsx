"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, ExternalLink } from "lucide-react";
import { openConfirm } from "@/components/ui/confirm-dialog";

type Accred = {
  id: string;
  body: string;
  title: string;
  discipline: string | null;
  level: string | null;
  serialNo: string | null;
  issuedAt: string;
  expiresAt: string | null;
  fileUrl: string | null;
  status: string;
};

export function AccreditationsPanel({
  riderId,
  canManage,
  initial,
}: {
  riderId: string;
  canManage: boolean;
  initial: Accred[];
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    body: "",
    title: "",
    discipline: "",
    level: "",
    serialNo: "",
    issuedAt: today,
    expiresAt: "",
    fileUrl: "",
  });
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!form.body || !form.title) {
      toast.error("Body and title are required.");
      return;
    }
    setBusy(true);
    try {
      const payload: any = {
        riderId,
        body: form.body,
        title: form.title,
        issuedAt: form.issuedAt,
      };
      if (form.discipline) payload.discipline = form.discipline;
      if (form.level) payload.level = form.level;
      if (form.serialNo) payload.serialNo = form.serialNo;
      if (form.expiresAt) payload.expiresAt = form.expiresAt;
      if (form.fileUrl) payload.fileUrl = form.fileUrl;
      const res = await fetch("/api/accreditations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(d.error ?? "Failed");
        return;
      }
      toast.success("Added");
      setForm({ ...form, body: "", title: "", level: "", serialNo: "", fileUrl: "" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    const ok = await openConfirm({
      title: "Delete this accreditation record?",
      destructive: true,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    const res = await fetch(`/api/accreditations/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Failed");
      return;
    }
    toast.success("Removed");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Accreditations ({initial.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {initial.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No external accreditations on file. Add the rider&apos;s federation memberships,
            coaching credentials, etc. so HQ can verify eligibility for national-scope events.
          </p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {initial.map((a) => (
              <li key={a.id} className="flex items-start justify-between rounded border bg-muted/30 px-3 py-2">
                <div>
                  <div className="font-medium">
                    {a.title}
                    <Badge variant="outline" className="ml-2 text-[10px] uppercase">{a.body}</Badge>
                    {a.status !== "active" && (
                      <Badge variant={a.status === "expired" ? "warning" : "destructive"} className="ml-1">
                        {a.status}
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {[a.discipline, a.level, a.serialNo && `#${a.serialNo}`].filter(Boolean).join(" · ")}
                    {a.discipline || a.level || a.serialNo ? " · " : ""}
                    issued {a.issuedAt.slice(0, 10)}
                    {a.expiresAt ? ` · expires ${a.expiresAt.slice(0, 10)}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {a.fileUrl && (
                    <a
                      href={a.fileUrl}
                      target="_blank"
                      rel="noopener"
                      className="text-xs text-primary hover:underline"
                    >
                      Scan <ExternalLink className="inline h-3 w-3" />
                    </a>
                  )}
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => remove(a.id)}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="remove"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {canManage && (
          <form onSubmit={add} className="grid gap-2 border-t pt-3 md:grid-cols-6">
            <div className="md:col-span-2">
              <Label>Body *</Label>
              <Input
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
                placeholder="EFI / BHS / FEI / state federation"
              />
            </div>
            <div className="md:col-span-2">
              <Label>Title *</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder='e.g. "Junior Membership"'
              />
            </div>
            <div>
              <Label>Discipline</Label>
              <Input
                value={form.discipline}
                onChange={(e) => setForm({ ...form, discipline: e.target.value })}
                placeholder="dressage / jumping / …"
              />
            </div>
            <div>
              <Label>Level</Label>
              <Input
                value={form.level}
                onChange={(e) => setForm({ ...form, level: e.target.value })}
                placeholder="Stage 2 / Cat B"
              />
            </div>
            <div>
              <Label>Serial no</Label>
              <Input
                value={form.serialNo}
                onChange={(e) => setForm({ ...form, serialNo: e.target.value })}
              />
            </div>
            <div>
              <Label>Issued on</Label>
              <Input
                type="date"
                value={form.issuedAt}
                onChange={(e) => setForm({ ...form, issuedAt: e.target.value })}
              />
            </div>
            <div>
              <Label>Expires</Label>
              <Input
                type="date"
                value={form.expiresAt}
                onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
              />
            </div>
            <div className="md:col-span-3">
              <Label>Scan URL</Label>
              <Input
                value={form.fileUrl}
                onChange={(e) => setForm({ ...form, fileUrl: e.target.value })}
                placeholder="https://… (optional)"
              />
            </div>
            <Button type="submit" disabled={busy} className="md:col-span-6">
              <Plus className="h-4 w-4" /> Add accreditation
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
