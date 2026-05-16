"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Paperclip, Trash2, ExternalLink } from "lucide-react";
import { openConfirm } from "@/components/ui/confirm-dialog";

type Attachment = {
  id: string;
  kind: string;
  url: string;
  caption: string | null;
  uploadedAt: string;
};

export function AttachmentsPanel({
  examId,
  canManage,
  initial,
}: {
  examId: string;
  canManage: boolean;
  initial: Attachment[];
}) {
  const router = useRouter();
  const [kind, setKind] = useState("video");
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);

  async function onFile(file: File | null) {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      // Reuse the generic kind so the existing upload route accepts any
      // image/pdf or video MIME. Per-exam metadata is set in our POST below.
      fd.set("kind", "generic");
      fd.set("file", file);
      const up = await fetch("/api/upload", { method: "POST", body: fd });
      const d = await up.json().catch(() => ({}));
      if (!up.ok) {
        toast.error(d.error ?? "Upload failed");
        return;
      }
      const res = await fetch(`/api/exams/${examId}/attachments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: d.url, kind, caption: caption || undefined }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        toast.error(e.error ?? "Failed");
        return;
      }
      toast.success("Attached");
      setCaption("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    const ok = await openConfirm({ title: "Remove attachment?", destructive: true, confirmLabel: "Remove" });
    if (!ok) return;
    const res = await fetch(`/api/exams/${examId}/attachments/${id}`, { method: "DELETE" });
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
        <CardTitle className="text-base">Attachments</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {initial.length === 0 ? (
          <p className="text-sm text-muted-foreground">No attachments yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {initial.map((a) => (
              <li key={a.id} className="flex items-center justify-between rounded border px-2 py-1.5">
                <div className="flex min-w-0 items-center gap-2">
                  <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
                  <a href={a.url} target="_blank" rel="noopener" className="truncate text-primary hover:underline">
                    {a.caption || a.url.split("/").pop()}
                  </a>
                  <span className="text-[10px] uppercase text-muted-foreground">{a.kind}</span>
                  <ExternalLink className="h-3 w-3 text-muted-foreground" />
                </div>
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
              </li>
            ))}
          </ul>
        )}
        {canManage && (
          <div className="grid gap-2 md:grid-cols-4">
            <Select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="video">Video</option>
              <option value="photo">Photo</option>
              <option value="sheet">Sealed sheet</option>
              <option value="other">Other</option>
            </Select>
            <Input
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Caption (optional)"
              className="md:col-span-2"
            />
            <label className="inline-flex h-10 cursor-pointer items-center justify-center rounded-md border bg-card px-3 text-sm hover:bg-muted">
              {busy ? "Uploading…" : "Upload"}
              <input
                type="file"
                className="hidden"
                disabled={busy}
                onChange={(e) => onFile(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
