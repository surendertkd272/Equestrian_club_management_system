"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Copy, MessageCircle } from "lucide-react";
import { formatDate } from "@/lib/utils";

export type LinkDTO = {
  id: string;
  code: string;
  kind: string;
  label: string | null;
  targetPath: string;
  expiresAt: string | null;
  singleUse: boolean;
  redeemCount: number;
  createdAt: string;
};

const KIND_LABEL: Record<string, string> = {
  injury: "Injury report",
  rider_onboard: "Rider onboarding",
  expense_submit: "Invoice submission",
  requisition: "Requisition",
  vet_visit_horse: "Vet visit",
  generic: "Custom",
};

export function LinkList({ links }: { links: LinkDTO[] }) {
  if (links.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">No links yet.</p>;
  }
  return (
    <div className="space-y-2">
      {links.map((l) => (
        <LinkRow key={l.id} link={l} />
      ))}
    </div>
  );
}

function LinkRow({ link }: { link: LinkDTO }) {
  // Use the current host so the URL is correct in dev (localhost:3000) and prod (vercel).
  const [origin] = useState(() => (typeof window !== "undefined" ? window.location.origin : ""));
  const url = `${origin}/r/${link.code}`;
  const expired = link.expiresAt && new Date(link.expiresAt) < new Date();
  const exhausted = link.singleUse && link.redeemCount > 0;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Couldn't copy — select & copy manually");
    }
  }

  function openWhatsApp() {
    const msg = encodeURIComponent(
      `${link.label ?? KIND_LABEL[link.kind] ?? "Equiwings link"}\n${url}`,
    );
    window.open(`https://wa.me/?text=${msg}`, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{KIND_LABEL[link.kind] ?? link.kind}</Badge>
            {link.singleUse && <Badge variant="warning">Single-use</Badge>}
            {expired && <Badge variant="destructive">Expired</Badge>}
            {exhausted && !expired && <Badge variant="destructive">Used</Badge>}
            <span className="text-sm font-medium">{link.label ?? "—"}</span>
          </div>
          <code className="block text-xs text-muted-foreground">{url}</code>
          <div className="text-xs text-muted-foreground">
            Opens <code>{link.targetPath}</code> · {link.redeemCount} open
            {link.redeemCount === 1 ? "" : "s"}
            {link.expiresAt && (
              <>
                {" "}· expires {formatDate(new Date(link.expiresAt))}
              </>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={copy}>
            <Copy className="mr-1 h-3 w-3" /> Copy
          </Button>
          <Button size="sm" onClick={openWhatsApp}>
            <MessageCircle className="mr-1 h-3 w-3" /> WhatsApp
          </Button>
        </div>
      </div>
    </div>
  );
}
