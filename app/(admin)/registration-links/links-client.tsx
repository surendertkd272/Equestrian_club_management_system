"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Copy, Check, MessageCircle } from "lucide-react";
import { postJson } from "@/lib/client/post-json";

type LinkDef = { label: string; path: string; blurb: string };

// One shareable public registration link with copy + WhatsApp buttons. The
// absolute URL is built from the server-provided base (falling back to
// window.location.origin) so both the DISPLAYED link and the copied/shared link
// are always a full https://… URL that opens on a phone — never a bare path.
function LinkRow({ def, baseUrl }: { def: LinkDef; baseUrl: string }) {
  const [copied, setCopied] = useState(false);
  const origin = baseUrl || (typeof window !== "undefined" ? window.location.origin : "");
  const url = origin + def.path;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success(`${def.label} link copied`);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy — select and copy it manually");
    }
  }

  const wa = `https://wa.me/?text=${encodeURIComponent(`${def.label} — register here: ${url}`)}`;

  return (
    <div className="min-w-0 rounded-md border bg-card p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">{def.label}</span>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <button type="button" onClick={copy} className="inline-flex items-center gap-1 text-primary hover:underline">
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy link"}
          </button>
          <a href={wa} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-emerald-600 hover:underline">
            <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
          </a>
        </div>
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{def.blurb}</p>
      <code className="mt-1 block truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">{url}</code>
    </div>
  );
}

export function RegistrationLinks({ slug, baseUrl }: { slug: string; baseUrl: string }) {
  const links: LinkDef[] = [
    { label: "Students / Riders", path: `/onboarding?centre=${slug}`, blurb: "Parents/riders self-register. Lands in Enrolment Approvals." },
    { label: "Employees / Staff", path: `/onboard/staff?centre=${slug}`, blurb: "Staff apply to join. Lands in Employee Onboarding for approval." },
    { label: "Vendors", path: `/onboard/vendor?centre=${slug}`, blurb: "Suppliers register. Lands in Vendors → Pending Registrations." },
  ];
  return (
    <div className="grid gap-2">
      {links.map((l) => (
        <LinkRow key={l.path} def={l} baseUrl={baseUrl} />
      ))}
    </div>
  );
}

// A sign-up drive link: the student registration link plus a signed,
// short-lived token, for a school drive where many families register on one
// connection (the plain link allows 10 an hour per connection). The school is
// filled in for every family who uses it.
export function DriveLinkCreator({ centreId, schools }: { centreId: string; schools: string[] }) {
  const [school, setSchool] = useState("");
  const [days, setDays] = useState("3");
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);

  async function create() {
    setBusy(true);
    const res = await postJson<{ url: string; expiresAt: string }>("/api/signup-drives", {
      centreId,
      school: school.trim() || undefined,
      days: Number(days),
    });
    setBusy(false);
    if (!res.ok) return toast.error(res.message);
    setLink(res.data);
  }

  const until = link ? new Date(link.expiresAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" }) : "";
  const wa = link
    ? `https://wa.me/?text=${encodeURIComponent(`Register your child${school ? ` (${school})` : ""} for riding — ${link.url}`)}`
    : "";

  return (
    <div className="mt-3 rounded-md border border-dashed bg-card p-3">
      <div className="text-sm font-semibold">School sign-up drive</div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        For a drive where many families register on one Wi-Fi or one laptop — the ordinary link stops at 10 an hour per
        connection. This link lifts that for a few days, and fills in the school.
      </p>
      {link ? (
        <div className="mt-2 space-y-1.5">
          <code className="block truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">{link.url}</code>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <button
              type="button"
              className="inline-flex items-center gap-1 text-primary hover:underline"
              onClick={() => navigator.clipboard?.writeText(link.url).then(() => toast.success("Drive link copied"))}
            >
              <Copy className="h-3.5 w-3.5" /> Copy link
            </button>
            <a href={wa} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-emerald-600 hover:underline">
              <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
            </a>
            <span className="text-muted-foreground">Works until {until}</span>
            <button type="button" className="text-muted-foreground hover:underline" onClick={() => setLink(null)}>
              New drive link
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1 text-xs">
            School (optional)
            <input
              list={`drive-schools-${centreId}`}
              value={school}
              onChange={(e) => setSchool(e.target.value)}
              maxLength={150}
              placeholder="e.g. The Hyderabad Public School"
              className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            />
            <datalist id={`drive-schools-${centreId}`}>
              {schools.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </label>
          <label className="text-xs">
            Valid for
            <select
              value={days}
              onChange={(e) => setDays(e.target.value)}
              className="mt-1 block h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              {["1", "3", "7", "14"].map((d) => (
                <option key={d} value={d}>
                  {d} day{d === "1" ? "" : "s"}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={create}
            disabled={busy}
            className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create drive link"}
          </button>
        </div>
      )}
    </div>
  );
}
