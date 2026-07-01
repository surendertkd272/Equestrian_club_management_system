"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { AlertTriangle, ArrowRight, Check, RotateCcw, Trash2 } from "lucide-react";
import { openConfirm } from "@/components/ui/confirm-dialog";
import { patchJson, deleteJson } from "@/lib/client/post-json";
import { formatEnum, roleLabel } from "@/lib/labels";
type TaskWithMeta = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  dueAt: Date | null;
  recurrence: string | null;
  overdue: boolean;
  escalated: boolean;
  assignee: { id: string; name: string; role: string } | null;
};

export function TaskCard({
  task,
  myUserId,
  canAssign,
}: {
  task: TaskWithMeta;
  myUserId: string;
  canAssign: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const mine = task.assignee?.id === myUserId;

  async function patch(status: "open" | "in_progress" | "done") {
    setBusy(true);
    const res = await patchJson(`/api/tasks/${task.id}`, { status });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    toast.success(`Task → ${status.replace("_", " ")}`);
    router.refresh();
  }

  async function del() {
    const ok = await openConfirm({ title: "Delete this task?", destructive: true, confirmLabel: "Delete" });
    if (!ok) return;
    setBusy(true);
    const res = await deleteJson(`/api/tasks/${task.id}`);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    toast.success("Deleted");
    router.refresh();
  }

  const borderCls = task.escalated
    ? "border-destructive bg-destructive/5"
    : task.overdue
    ? "border-amber-500 bg-amber-50"
    : "border-border bg-card";

  return (
    <div className={cn("group rounded-md border p-3 text-sm transition-colors", borderCls)}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="font-medium leading-tight">{task.title}</div>
          {task.description && (
            <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{task.description}</div>
          )}
        </div>
        {task.escalated && (
          <Badge variant="destructive" className="gap-1">
            <AlertTriangle className="h-3 w-3" /> escalated
          </Badge>
        )}
        {!task.escalated && task.overdue && <Badge variant="warning">overdue</Badge>}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {task.dueAt && (
          <span>
            due{" "}
            {task.dueAt.toLocaleString("en-IN", {
              day: "2-digit",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        )}
        {task.recurrence && task.recurrence !== "once" && <span>· {formatEnum(task.recurrence)}</span>}
        {task.assignee ? (
          <span>
            · {mine ? <b>you</b> : task.assignee.name}{" "}
            <span className="opacity-60">({roleLabel(task.assignee.role)})</span>
          </span>
        ) : (
          <span>· unassigned</span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-1">
        {task.status === "open" && (
          <button
            type="button"
            onClick={() => patch("in_progress")}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md border bg-card px-2 py-1 text-xs hover:bg-muted"
          >
            <ArrowRight className="h-3 w-3" /> Start
          </button>
        )}
        {task.status === "in_progress" && (
          <button
            type="button"
            onClick={() => patch("done")}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-700"
          >
            <Check className="h-3 w-3" /> Complete
          </button>
        )}
        {task.status !== "open" && (
          <button
            type="button"
            onClick={() => patch("open")}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md border bg-card px-2 py-1 text-xs hover:bg-muted"
          >
            <RotateCcw className="h-3 w-3" /> Reopen
          </button>
        )}
        {canAssign && (
          <button
            type="button"
            onClick={del}
            disabled={busy}
            className="ml-auto text-xs text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
            aria-label="delete"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}
