"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { MessageCircle } from "lucide-react";

type Row = { id: string; name: string; email: string | null; phone: string | null; pendingSince: string | null };
type Shareable = { id: string; name: string; phone: string; url: string };

// wa.me wants the number with country code and no "+".
const waNumber = (phone: string) => {
  const d = phone.replace(/\D/g, "");
  return d.length === 10 ? `91${d}` : d.length === 11 && d.startsWith("0") ? `91${d.slice(1)}` : d;
};

export function ConsentRequestPanel({
  centreId,
  rows,
  reachable,
  byPhone,
  messaging,
  canSend,
}: {
  centreId: string;
  rows: Row[];
  reachable: number;
  // No email, but a phone number on file.
  byPhone: number;
  // An SMS / WhatsApp provider is configured, so phone links go out by themselves.
  messaging: boolean;
  canSend: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // Links for families with no email and no messaging provider: staff send
  // them from their own WhatsApp. Shown once, after sending.
  const [shareable, setShareable] = useState<Shareable[]>([]);
  const [sentTo, setSentTo] = useState<Set<string>>(new Set());

  const unreachable = rows.length - reachable - byPhone;
  // Everyone reachable who hasn't already got a live link out.
  const toSend = rows.filter((r) => (r.email || r.phone) && !r.pendingSince).length;

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
    const { wouldCreate, noEmail, familyEmail = [] } = await pre.json();
    if (wouldCreate === 0) {
      toast.info(
        `Nobody can be given a student login yet — ${noEmail.length} rider${noEmail.length === 1 ? " has" : "s have"} no email of their own` +
          (familyEmail.length ? `, ${familyEmail.length} only a parent's (use Create parent logins)` : "") +
          ".",
      );
      return;
    }
    // Names the count AND what it costs, because this creates real accounts.
    if (
      !confirm(
        `Create portal logins for ${wouldCreate} rider${wouldCreate === 1 ? "" : "s"}?\n\n` +
          `${noEmail.length} will be skipped for having no email address` +
          (familyEmail.length ? `, and ${familyEmail.length} whose only address is a parent's (that's for the parent login)` : "") +
          `.\n\n` +
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

  async function inviteParents() {
    setBusy(true);
    const pre = await fetch("/api/riders/parent-access/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ centreId, dryRun: true }),
    });
    setBusy(false);
    if (!pre.ok) {
      toast.error("Couldn't check which families can be invited");
      return;
    }
    const p = await pre.json();
    if (p.wouldCreate + p.wouldLinkExisting === 0) {
      toast.info(
        `No family can be given a parent login yet — ${p.noEmail.length} rider${p.noEmail.length === 1 ? " has" : "s have"} no parent email on file.`,
      );
      return;
    }
    if (
      !confirm(
        `Create ${p.wouldCreate} parent login${p.wouldCreate === 1 ? "" : "s"}` +
          (p.wouldLinkExisting ? ` and link ${p.wouldLinkExisting} existing parent account${p.wouldLinkExisting === 1 ? "" : "s"}` : "") +
          ` for ${p.riders} rider${p.riders === 1 ? "" : "s"}?\n\n` +
          `Brothers and sisters sharing an address get one login that shows all of them. ` +
          `${p.noEmail.length} rider${p.noEmail.length === 1 ? " has" : "s have"} no parent email and will be skipped.\n\n` +
          `Each parent gets a temporary password they must change at first sign-in — read them afterwards on the Credential Sheet.`,
      )
    ) {
      return;
    }
    setBusy(true);
    const res = await fetch("/api/riders/parent-access/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ centreId }),
    });
    setBusy(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.message ?? data.error ?? "Couldn't create parent logins");
      return;
    }
    const bits = [`${data.created.length} parent login${data.created.length === 1 ? "" : "s"} created`];
    if (data.linkedExisting?.length) bits.push(`${data.linkedExisting.length} existing linked`);
    if (data.emailTaken?.length) bits.push(`${data.emailTaken.length} address${data.emailTaken.length === 1 ? "" : "es"} already used by another login`);
    toast.success(bits.join(" · "));
    router.refresh();
  }

  async function send() {
    if (
      !confirm(
        `Send a signing link to ${toSend} rider${toSend === 1 ? "" : "s"}?\n\n` +
          `Families with an email get it by email; the rest ` +
          (messaging ? `by SMS / WhatsApp.` : `get a link here for you to send on WhatsApp.`) +
          `\n\nRiders who already have a link outstanding won't be sent another.`,
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
      if (data.requestedByPhone) bits.push(`${data.requestedByPhone} of them by phone`);
      if (data.shareable?.length) bits.push(`${data.shareable.length} to send on WhatsApp below`);
      if (data.skippedNoEmail?.length) bits.push(`${data.skippedNoEmail.length} have no email or phone`);
      if (data.skippedAlreadyPending) bits.push(`${data.skippedAlreadyPending} already pending`);
      if (data.failed?.length) bits.push(`${data.failed.length} failed`);
      toast.success(bits.join(" · "));
      setShareable(data.shareable ?? []);
      setSentTo(new Set());
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
    {shareable.length > 0 && (
      <Card className="border-success/40">
        <CardHeader>
          <CardTitle className="text-base">Send these on WhatsApp</CardTitle>
          <CardDescription>
            {shareable.length} famil{shareable.length === 1 ? "y has" : "ies have"} no email. Tap each one to open
            WhatsApp with the message ready — each link is personal to that rider. Shown once: send them now.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y text-sm">
            {shareable.map((x) => {
              const text = `Please sign the riding indemnity for ${x.name} (takes a minute): ${x.url}`;
              return (
                <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    {x.name} <span className="font-mono text-[11px] text-muted-foreground">{x.phone}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    {sentTo.has(x.id) && <Badge variant="success">opened</Badge>}
                    <Button asChild size="sm" variant="outline">
                      <a
                        href={`https://wa.me/${waNumber(x.phone)}?text=${encodeURIComponent(text)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => setSentTo((prev) => new Set(prev).add(x.id))}
                      >
                        <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                      </a>
                    </Button>
                  </span>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    )}
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">No indemnity on file</CardTitle>
            <CardDescription>
              {rows.length} rider{rows.length === 1 ? "" : "s"} · {reachable} by email · {byPhone} by phone
              {unreachable > 0 && ` · ${unreachable} with no email or phone`}
            </CardDescription>
          </div>
          <Button onClick={send} disabled={busy || !canSend || toSend === 0}>
            {busy ? "Sending…" : `Send signing link to ${toSend}`}
          </Button>
          <Button variant="outline" onClick={invitePortal} disabled={busy}>
            Create student logins
          </Button>
          <Button variant="outline" onClick={inviteParents} disabled={busy}>
            Create parent logins
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
                {unreachable} rider{unreachable === 1 ? " has" : "s have"} no email address or phone
                number on file. They cannot be chased this way — add a contact, or collect their
                consent on paper.
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
                      {r.email ?? (r.phone ? `phone ${r.phone}` : "no contact")}
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
    </>
  );
}
