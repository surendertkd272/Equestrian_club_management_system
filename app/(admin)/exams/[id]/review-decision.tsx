"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { postJson } from "@/lib/client/post-json";

// A manager answers a family's review request: reopen the exam for the judges
// to correct, or decline with a reply the family sees.
export function ReviewDecision({ examId, requestId }: { examId: string; requestId: string }) {
  const router = useRouter();
  const [response, setResponse] = useState("");
  const [busy, setBusy] = useState(false);

  async function decide(action: "reopen" | "decline") {
    setBusy(true);
    const res = await postJson(`/api/exams/${examId}/reviews/${requestId}`, { action, response: response || undefined });
    setBusy(false);
    if (!res.ok) return toast.error(res.message);
    toast.success(action === "reopen" ? "Exam reopened — the judges have been told" : "Reply sent to the family");
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <Textarea
        value={response}
        onChange={(e) => setResponse(e.target.value)}
        rows={2}
        maxLength={1000}
        placeholder="Reply to the family (needed to decline)"
        aria-label="Reply to the family"
      />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => decide("reopen")} disabled={busy}>
          Reopen for correction
        </Button>
        <Button size="sm" variant="outline" onClick={() => decide("decline")} disabled={busy || !response.trim()}>
          Decline with reply
        </Button>
      </div>
    </div>
  );
}
