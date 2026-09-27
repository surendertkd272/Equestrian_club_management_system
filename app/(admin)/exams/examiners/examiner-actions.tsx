"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { openConfirm } from "@/components/ui/confirm-dialog";
import { postJson, patchJson } from "@/lib/client/post-json";
import { Copy, KeyRound, MessageCircle, UserPlus } from "lucide-react";

type Handover = { name: string; email: string; password: string };

// Shown once after registering a judge (or issuing a new password): the
// sign-in details to hand over, with copy + WhatsApp share. The password is
// temporary — they set their own on first sign-in, and can't mark until then.
function CredentialsCard({ h, onDone }: { h: Handover; onDone: () => void }) {
  const loginUrl = typeof window !== "undefined" ? `${window.location.origin}/login` : "/login";
  const message =
    `Hello ${h.name}, your examiner login for Equiwings:\n${loginUrl}\nEmail: ${h.email}\nTemporary password: ${h.password}\n` +
    `Please sign in before the exam day and set your own password.`;
  return (
    <div className="space-y-2 rounded-md border border-success/30 bg-success-soft p-3 text-sm">
      <div className="font-medium">Sign-in details for {h.name}</div>
      <div className="grid gap-1 font-mono text-xs">
        <span>Email: {h.email}</span>
        <span>Temporary password: {h.password}</span>
      </div>
      <p className="text-xs text-muted-foreground">
        Shown once — copy or share it now. They&rsquo;ll set their own password when they first sign in.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => navigator.clipboard?.writeText(message).then(() => toast.success("Copied"))}
        >
          <Copy className="h-3.5 w-3.5" /> Copy
        </Button>
        <Button asChild size="sm" variant="outline">
          <a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer">
            <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
          </a>
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

export function AddVisitingExaminer({ defaultUntil }: { defaultUntil: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [until, setUntil] = useState(defaultUntil);
  const [busy, setBusy] = useState(false);
  const [handover, setHandover] = useState<Handover | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await postJson<{ tempPassword?: string; reactivated?: boolean }>("/api/examiners", {
      name,
      email,
      phone: phone || undefined,
      accessUntil: until,
    });
    setBusy(false);
    if (!res.ok) return toast.error(res.message);
    if (res.data.reactivated) {
      toast.success(`${name} already had an examiner login — access extended. They sign in with their own password.`);
    } else if (res.data.tempPassword) {
      setHandover({ name, email, password: res.data.tempPassword });
    }
    setName("");
    setEmail("");
    setPhone("");
    router.refresh();
  }

  if (handover) return <CredentialsCard h={handover} onDone={() => setHandover(null)} />;
  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
      <div>
        <Label htmlFor="ve-name">Name</Label>
        <Input id="ve-name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={80} />
      </div>
      <div>
        <Label htmlFor="ve-email">Email</Label>
        <Input id="ve-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <div>
        <Label htmlFor="ve-phone">Mobile (optional)</Label>
        <Input id="ve-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10-digit mobile" />
      </div>
      <div>
        <Label htmlFor="ve-until">Access until</Label>
        <Input id="ve-until" type="date" value={until} onChange={(e) => setUntil(e.target.value)} required />
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={busy}>
          <UserPlus className="h-4 w-4" /> {busy ? "Registering…" : "Register examiner"}
        </Button>
      </div>
    </form>
  );
}

export function ExaminerRowActions({
  id,
  name,
  email,
  visiting,
  ended,
  until,
}: {
  id: string;
  name: string;
  email: string;
  visiting: boolean;
  ended: boolean;
  until: string;
}) {
  const router = useRouter();
  const [date, setDate] = useState(until);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [handover, setHandover] = useState<Handover | null>(null);

  async function send(body: Record<string, unknown>, done: string) {
    setBusy(true);
    const res = await patchJson<{ tempPassword?: string }>(`/api/examiners/${id}`, body);
    setBusy(false);
    if (!res.ok) return toast.error(res.message);
    if (res.data.tempPassword) setHandover({ name, email, password: res.data.tempPassword });
    else toast.success(done);
    setEditing(false);
    router.refresh();
  }

  if (handover) return <CredentialsCard h={handover} onDone={() => setHandover(null)} />;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {editing ? (
        <>
          <Input type="date" aria-label={`New end date for ${name}`} value={date} onChange={(e) => setDate(e.target.value)} className="h-9 w-40" />
          <Button size="sm" disabled={busy} onClick={() => send({ accessUntil: date }, "Access updated")}>
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
          {ended ? "Give access again" : visiting ? "Change end date" : "Set end date"}
        </Button>
      )}
      {!ended && (
        <Button
          size="sm"
          variant="outline"
          className="border-destructive/40 text-destructive"
          disabled={busy}
          onClick={async () => {
            const ok = await openConfirm({
              title: `End ${name}'s access now?`,
              body: "They are signed out everywhere and can't sign in again unless you give access again.",
              destructive: true,
              confirmLabel: "End access",
            });
            if (ok) await send({ endNow: true }, "Access ended");
          }}
        >
          End access now
        </Button>
      )}
      {!ended && (
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={async () => {
            const ok = await openConfirm({
              title: `New temporary password for ${name}?`,
              body: "Their current password stops working and they're signed out everywhere.",
              confirmLabel: "Issue new password",
            });
            if (ok) await send({ resetPassword: true }, "New password issued");
          }}
        >
          <KeyRound className="h-3.5 w-3.5" /> New password
        </Button>
      )}
    </div>
  );
}
