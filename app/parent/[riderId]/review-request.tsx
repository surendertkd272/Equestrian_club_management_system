"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { postJson } from "@/lib/client/post-json";

type Req = { status: string; response: string | null };

// Ask the club to look at an exam result again, or see what they said.
export function ReviewRequest({ examId, latest }: { examId: string; latest: Req | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  if (latest?.status === "open") return <Badge variant="outline">Review asked for — waiting for the club</Badge>;
  if (latest?.status === "reopened") return <Badge variant="warning">Being reviewed by the judges</Badge>;

  async function send() {
    setBusy(true);
    const res = await postJson(`/api/parent/exams/${examId}/review`, { reason });
    setBusy(false);
    if (!res.ok) return toast.error(res.message);
    toast.success("Sent to the club — you'll see their answer here");
    setOpen(false);
    router.refresh();
  }

  return (
    <div className="space-y-1.5">
      {latest?.status === "declined" && (
        <p className="text-xs text-muted-foreground">
          The club reviewed this: <span className="text-foreground">{latest.response}</span>
        </p>
      )}
      {open ? (
        <div className="space-y-2">
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={1000}
            placeholder="What would you like the club to look at? e.g. a mark that seems wrong"
            aria-label="What you'd like reviewed"
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={send} disabled={busy || reason.trim().length < 10}>
              {busy ? "Sending…" : "Send to the club"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        !latest && (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            Ask for a review
          </Button>
        )
      )}
    </div>
  );
}
