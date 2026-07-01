"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, ExternalLink, Pencil } from "lucide-react";
import { openConfirm } from "@/components/ui/confirm-dialog";
import { formatEnum } from "@/lib/labels";
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
  const [editingId, setEditingId] = useState<string | null>(null);

  const blank = { body: "", title: "", discipline: "", level: "", serialNo: "", issuedAt: today, expiresAt: "", fileUrl: "" };
  function startEdit(a: Accred) {
    setEditingId(a.id);
    setForm({
      body: a.body,
      title: a.title,
      discipline: a.discipline ?? "",
      level: a.level ?? "",
      serialNo: a.serialNo ?? "",
      issuedAt: a.issuedAt.slice(0, 10),
      expiresAt: a.expiresAt ? a.expiresAt.slice(0, 10) : "",
      fileUrl: a.fileUrl ?? "",
    });
    if (typeof window !== "undefined") window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  }
  function cancelEdit() {
    setEditingId(null);
    setForm(blank);
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!form.body || !form.title) {
      toast.error("Body and title are required.");
      return;
    }
    setBusy(true);
    try {
      // On edit, send every field (null for cleared optionals) so the PATCH
      // reflects exactly what's on screen; on add, omit blanks.
      const payload: any = editingId
        ? {
            body: form.body,
            title: form.title,
            issuedAt: form.issuedAt,
            discipline: form.discipline || null,
            level: form.level || null,
            serialNo: form.serialNo || null,
            expiresAt: form.expiresAt || null,
            fileUrl: form.fileUrl || null,
          }
        : { riderId, body: form.body, title: form.title, issuedAt: form.issuedAt };
      if (!editingId) {
        if (form.discipline) payload.discipline = form.discipline;
        if (form.level) payload.level = form.level;
        if (form.serialNo) payload.serialNo = form.serialNo;
        if (form.expiresAt) payload.expiresAt = form.expiresAt;
        if (form.fileUrl) payload.fileUrl = form.fileUrl;
      }
      const res = await fetch(editingId ? `/api/accreditations/${editingId}` : "/api/accreditations", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(d.error ?? "Failed");
        return;
      }
      toast.success(editingId ? "Updated" : "Added");
      setEditingId(null);
      setForm(blank);
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
                        {formatEnum(a.status)}
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
                      onClick={() => startEdit(a)}
                      className="text-muted-foreground hover:text-primary"
                      aria-label="edit"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
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
              <Input aria-label="Body"
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
                placeholder="EFI / BHS / FEI / state federation"
              />
            </div>
            <div className="md:col-span-2">
              <Label>Title *</Label>
              <Input aria-label="Title"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder='e.g. "Junior Membership"'
              />
            </div>
            <div>
              <Label>Discipline</Label>
              <Input aria-label="Discipline"
                value={form.discipline}
                onChange={(e) => setForm({ ...form, discipline: e.target.value })}
                placeholder="dressage / jumping / …"
              />
            </div>
            <div>
              <Label>Level</Label>
              <Input aria-label="Level"
                value={form.level}
                onChange={(e) => setForm({ ...form, level: e.target.value })}
                placeholder="Stage 2 / Cat B"
              />
            </div>
            <div>
              <Label>Serial No</Label>
              <Input aria-label="Serial no"
                value={form.serialNo}
                onChange={(e) => setForm({ ...form, serialNo: e.target.value })}
              />
            </div>
            <div>
              <Label>Issued On</Label>
              <Input aria-label="Issued on"
                type="date"
                value={form.issuedAt}
                onChange={(e) => setForm({ ...form, issuedAt: e.target.value })}
              />
            </div>
            <div>
              <Label>Expires</Label>
              <Input aria-label="Expires"
                type="date"
                value={form.expiresAt}
                onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
              />
            </div>
            <div className="md:col-span-3">
              <Label>Scan URL</Label>
              <Input aria-label="Scan URL"
                value={form.fileUrl}
                onChange={(e) => setForm({ ...form, fileUrl: e.target.value })}
                placeholder="https://… (optional)"
              />
            </div>
            <div className="flex gap-2 md:col-span-6">
              <Button type="submit" disabled={busy}>
                {editingId ? <><Pencil className="h-4 w-4" /> Save changes</> : <><Plus className="h-4 w-4" /> Add accreditation</>}
              </Button>
              {editingId && (
                <Button type="button" variant="outline" onClick={cancelEdit}>Cancel</Button>
              )}
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
