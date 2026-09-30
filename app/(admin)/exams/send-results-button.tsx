"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { openConfirm } from "@/components/ui/confirm-dialog";
import { postJson, type JsonResult } from "@/lib/client/post-json";
import { Mail } from "lucide-react";

type Batch = { sent: number; noEmail: string[]; remaining: number; cursor: string | null };

// Email every marked result in a sitting or exam day to the families — passes
// and not — a batch at a time. Once all are sent it offers a resend.
export function SendResultsButton({ scope, id, unsent, marked }: { scope: "sitting" | "day"; id: string; unsent: number; marked: number }) {
  const router = useRouter();
  const [progress, setProgress] = useState<string | null>(null);
  const [noEmail, setNoEmail] = useState<string[]>([]);
  const resend = unsent === 0;

  async function go() {
    const n = resend ? marked : unsent;
    const ok = await openConfirm({
      title: resend ? `Email all ${n} results again?` : `Email ${n} result${n === 1 ? "" : "s"} to families?`,
      body:
        "Each family gets the rider's result with the mark breakdown — passes with their certificate number, and riders who didn't pass with an encouraging note." +
        (resend ? " Everyone who already had theirs gets it again." : " Results already emailed aren't sent again."),
      confirmLabel: resend ? "Send again" : "Send",
    });
    if (!ok) return;
    const before = new Date().toISOString();
    let cursor: string | null = null;
    let sent = 0;
    const missing: string[] = [];
    for (let guard = 0; guard < 100; guard++) {
      setProgress(`${sent} sent…`);
      const res: JsonResult<Batch> = await postJson<Batch>("/api/exams/send-results", {
        scope,
        id,
        ...(resend ? { resend: true, before } : {}),
        ...(cursor ? { after: cursor } : {}),
      });
      if (!res.ok) {
        toast.error(res.message);
        break;
      }
      sent += res.data.sent;
      missing.push(...res.data.noEmail);
      cursor = res.data.cursor;
      if (res.data.remaining === 0 || !cursor) break;
    }
    setProgress(null);
    setNoEmail(missing);
    toast.success(`${sent} result${sent === 1 ? "" : "s"} emailed${missing.length ? ` · ${missing.length} with no email on file` : ""}`);
    router.refresh();
  }

  if (marked === 0) return null;
  return (
    <span className="inline-flex flex-col gap-1">
      <Button type="button" size="sm" variant="outline" onClick={go} disabled={!!progress}>
        <Mail className="h-4 w-4" />
        {progress ?? (resend ? "Email results again" : `Email results to families (${unsent})`)}
      </Button>
      {noEmail.length > 0 && (
        <span className="max-w-xs text-[11px] text-muted-foreground">
          No email on file for: {noEmail.slice(0, 8).join(", ")}
          {noEmail.length > 8 ? ` and ${noEmail.length - 8} more` : ""}.
        </span>
      )}
    </span>
  );
}
