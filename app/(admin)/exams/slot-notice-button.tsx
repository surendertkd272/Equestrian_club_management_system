"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { postJson, type JsonResult } from "@/lib/client/post-json";
import { Send } from "lucide-react";

type Batch = { sent: number; changed: number; remaining: number; cursor: string | null };

// Send each family their child's slot — only new and changed ones.
export function SlotNoticeButton({ scope, id, fresh, changed }: { scope: "sitting" | "day"; id: string; fresh: number; changed: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const due = fresh + changed;
  if (due === 0) return null;
  async function go() {
    setBusy(true);
    let cursor: string | null = null;
    let sent = 0;
    for (let guard = 0; guard < 100; guard++) {
      const res: JsonResult<Batch> = await postJson<Batch>("/api/exam-slots/notify", { scope, id, ...(cursor ? { after: cursor } : {}) });
      if (!res.ok) {
        toast.error(res.message);
        break;
      }
      sent += res.data.sent;
      cursor = res.data.cursor;
      if (res.data.remaining === 0 || !cursor) break;
    }
    setBusy(false);
    toast.success(`${sent} famil${sent === 1 ? "y" : "ies"} told their time`);
    router.refresh();
  }
  return (
    <Button size="sm" variant="outline" onClick={go} disabled={busy}>
      <Send className="h-4 w-4" />
      {busy ? "Sending…" : changed ? `Send ${changed} changed + ${fresh} new times` : `Send times to ${fresh} families`}
    </Button>
  );
}
