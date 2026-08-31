"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

type Row = { id: string; name: string; email: string | null; pendingSince: string | null };

export function ConsentRequestPanel({
  centreId,
  rows,
  reachable,
  canSend,
}: {
  centreId: string;
  rows: Row[];
  reachable: number;
  canSend: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const unreachable = rows.length - reachable;
  // Everyone with an address who hasn't already got a live link out.
  const toSend = rows.filter((r) => r.email && !r.pendingSince).length;

  async function invitePortal() {
    setBusy(true);
    const pre = await fetch("/api/riders/portal-access/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ centreId, dryRun: true }),
    });
    setBusy(false);
    if (!pre.ok) {
      toast.error("Couldn't check who can be invited");
      return;
    }
    const { wouldCreate, noEmail } = await pre.json();
    if (wouldCreate === 0) {
      toast.info(
        `Nobody can be given a login yet — ${noEmail.length} rider${noEmail.length === 1 ? " has" : "s have"} no email address on file.`,
      );
      return;
    }
    // Names the count AND what it costs, because this creates real accounts.
    if (
      !confirm(
        `Create portal logins for ${wouldCreate} rider${wouldCreate === 1 ? "" : "s"}?\n\n` +
          `${noEmail.length} will be skipped for having no email address.\n\n` +
          `Each gets a temporary password they must change at first sign-in. ` +
          `You can read the passwords afterwards on the Credential Sheet.`,
      )
    ) {
      return;
    }
    setBusy(true);
    const res = await fetch("/api/riders/portal-access/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ centreId }),
    });
    setBusy(false);
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      toast.error(e.message ?? e.error ?? "Couldn't create logins");
      return;
    }
    const data = await res.json();
    const bits = [`${data.created.length} login${data.created.length === 1 ? "" : "s"} created`];
    if (data.noEmail?.length) bits.push(`${data.noEmail.length} without an email`);
    if (data.emailTaken?.length) bits.push(`${data.emailTaken.length} sharing an address already in use`);
    toast.success(bits.join(" · "));
    router.refresh();
  }

  async function send() {
    if (
      !confirm(
        `Email a signing link to ${toSend} rider${toSend === 1 ? "" : "s"}?\n\n` +
          `Riders who already have a link outstanding won't be emailed again.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/riders/consent-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ centreId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Couldn't send");
        return;
      }
      // Report what actually happened rather than a flat "sent". The skipped
      // counts are the interesting part — they are the riders still needing a
      // paper form.
      const bits = [`${data.requested} sent`];
      if (data.skippedNoEmail?.length) bits.push(`${data.skippedNoEmail.length} have no email`);
      if (data.skippedAlreadyPending) bits.push(`${data.skippedAlreadyPending} already pending`);
      if (data.failed?.length) bits.push(`${data.failed.length} failed`);
      toast.success(bits.join(" · "));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">No indemnity on file</CardTitle>
            <CardDescription>
              {rows.length} rider{rows.length === 1 ? "" : "s"} · {reachable} reachable by email
              {unreachable > 0 && ` · ${unreachable} with no address`}
            </CardDescription>
          </div>
          <Button onClick={send} disabled={busy || !canSend || toSend === 0}>
            {busy ? "Sending…" : `Email signing link to ${toSend}`}
          </Button>
          <Button variant="outline" onClick={invitePortal} disabled={busy}>
            Create portal logins
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Every rider at this centre has a signed indemnity on file.
          </p>
        ) : (
          <>
            {unreachable > 0 && (
              <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs dark:border-amber-900 dark:bg-amber-950/40">
                {unreachable} rider{unreachable === 1 ? " has" : "s have"} no email address, on
                their own record or a linked parent&apos;s. They cannot be chased this way — add an
                address, or collect their consent on paper.
              </p>
            )}
            <ul className="divide-y text-sm">
              {rows.slice(0, 100).map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>{r.name}</span>
                  <span className="flex items-center gap-2">
                    {r.pendingSince && (
                      <Badge variant="outline">Sent {formatDate(r.pendingSince)}</Badge>
                    )}
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {r.email ?? "no email"}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            {rows.length > 100 && (
              <p className="mt-2 text-xs text-muted-foreground">
                Showing the first 100 of {rows.length}. Sending covers all of them.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
