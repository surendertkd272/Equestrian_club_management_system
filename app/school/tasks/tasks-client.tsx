"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

export type SchoolTask = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  dueAt: string | null;
  createdAt: string;
  raisedByMe: boolean;
  overdue: boolean;
};

export function TasksClient({ tasks }: { tasks: SchoolTask[] }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function raise() {
    if (title.trim().length < 3) return toast.error("Say what you need in a few words");
    setBusy("new");
    try {
      const res = await fetch("/api/school/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), description: description.trim(), dueAt }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Failed");
        return;
      }
      setTitle("");
      setDescription("");
      setDueAt("");
      toast.success("Sent to the club's head office");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function setStatus(id: string, status: string) {
    setBusy(id);
    try {
      const res = await fetch("/api/school/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Failed");
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const open = tasks.filter((t) => t.status !== "done");
  const done = tasks.filter((t) => t.status === "done");

  return (
    <div className="space-y-6">
      <div className="rounded-lg border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold">Raise Something With the Club</h2>
        <div className="space-y-3">
          <div>
            <Label>What Do You Need?</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Reschedule the Class 6 batch to Thursdays"
            />
          </div>
          <div>
            <Label>Detail (Optional)</Label>
            <Textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Exam week clashes with the Tuesday slot for three weeks from the 20th."
            />
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label>Needed By (Optional)</Label>
              <Input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
            </div>
            <Button onClick={raise} disabled={busy !== null}>
              {busy === "new" ? "Sending…" : "Send to head office"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            This reaches the club&apos;s Super Admin and Admin, who are notified straight away. It
            does not go to coaches or stable staff.
          </p>
        </div>
      </div>

      <TaskList
        heading={`Open (${open.length})`}
        empty="Nothing open. Anything you raise, and anything head office sends you, appears here."
        tasks={open}
        busy={busy}
        onStatus={setStatus}
      />
      {done.length > 0 && (
        <TaskList heading={`Closed (${done.length})`} empty="" tasks={done} busy={busy} onStatus={setStatus} />
      )}
    </div>
  );
}

function TaskList({
  heading,
  empty,
  tasks,
  busy,
  onStatus,
}: {
  heading: string;
  empty: string;
  tasks: SchoolTask[];
  busy: string | null;
  onStatus: (id: string, status: string) => void;
}) {
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {heading}
      </h2>
      {tasks.length === 0 ? (
        <p className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {tasks.map((t) => (
            <li key={t.id} className="flex flex-wrap items-start justify-between gap-3 p-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{t.title}</span>
                  <Badge variant="outline">{t.raisedByMe ? "You asked" : "From head office"}</Badge>
                  {t.overdue && <Badge variant="destructive">Overdue</Badge>}
                </div>
                {t.description && (
                  <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
                    {t.description}
                  </p>
                )}
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Raised {t.createdAt}
                  {t.dueAt ? ` · needed by ${t.dueAt}` : ""}
                </p>
              </div>
              <Select
                aria-label={`Status of ${t.title}`}
                value={t.status}
                disabled={busy !== null}
                onChange={(e) => onStatus(t.id, e.target.value)}
                className="w-40"
              >
                <option value="open">Open</option>
                <option value="in_progress">In progress</option>
                <option value="done">Done</option>
              </Select>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
