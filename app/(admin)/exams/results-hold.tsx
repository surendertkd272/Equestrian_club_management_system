"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { openConfirm } from "@/components/ui/confirm-dialog";
import { postJson } from "@/lib/client/post-json";

// Hold results back from families until checked, then publish them in one go.
export function ResultsHold({
  scope,
  id,
  held,
  published,
  marked,
}: {
  scope: "sitting" | "day";
  id: string;
  held: boolean;
  published: boolean;
  marked: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function act(action: "hold" | "publish") {
    const ok = await openConfirm(
      action === "publish"
        ? {
            title: `Publish ${marked} result${marked === 1 ? "" : "s"}?`,
            body: "Parents, riders and schools see the results, and every family is told now (passes also get an SMS). Results marked after this are shared as they come in.",
            confirmLabel: "Publish results",
          }
        : {
            title: "Hold results until you publish them?",
            body: "Marked results stay off the parent, student and school pages and nobody is messaged until you press Publish.",
            confirmLabel: "Hold results",
          },
    );
    if (!ok) return;
    setBusy(true);
    const res = await postJson<{ announced?: number }>("/api/exam-results", { action, scope, id });
    setBusy(false);
    if (!res.ok) return toast.error(res.message);
    toast.success(action === "publish" ? `Published — ${res.data.announced ?? 0} families told` : "Results will be held");
    router.refresh();
  }
  if (published) return null;
  if (held) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm" role="status">
        <span>
          <span className="font-medium">Results are held.</span> {marked} marked result{marked === 1 ? " isn't" : "s aren't"} shared with
          families yet.
        </span>
        <Button size="sm" onClick={() => act("publish")} disabled={busy}>
          Publish results
        </Button>
      </div>
    );
  }
  return (
    <Button size="sm" variant="outline" onClick={() => act("hold")} disabled={busy}>
      Hold results until published
    </Button>
  );
}
