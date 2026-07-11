"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Copy, Check, MessageCircle } from "lucide-react";

type LinkDef = { label: string; path: string; blurb: string };

// One shareable public registration link with copy + WhatsApp buttons. The
// absolute URL is built client-side from window.location.origin so it works on
// whatever domain the app is served from.
function LinkRow({ def }: { def: LinkDef }) {
  const [copied, setCopied] = useState(false);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
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
    <div className="rounded-md border bg-card p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">{def.label}</span>
        <div className="flex items-center gap-3 text-xs">
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
      <code className="mt-1 block truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">{def.path}</code>
    </div>
  );
}

export function RegistrationLinks({ slug }: { slug: string }) {
  const links: LinkDef[] = [
    { label: "Students / Riders", path: `/onboarding?centre=${slug}`, blurb: "Parents/riders self-register. Lands in Enrolment Approvals." },
    { label: "Employees / Staff", path: `/onboard/staff?centre=${slug}`, blurb: "Staff apply to join. Lands in Employee Onboarding for approval." },
    { label: "Vendors", path: `/onboard/vendor?centre=${slug}`, blurb: "Suppliers register. Lands in Vendors → Pending Registrations." },
  ];
  return (
    <div className="grid gap-2">
      {links.map((l) => (
        <LinkRow key={l.path} def={l} />
      ))}
    </div>
  );
}
