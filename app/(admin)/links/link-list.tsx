"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Copy, MessageCircle, Trash2 } from "lucide-react";
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
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("all");
  const [status, setStatus] = useState("all"); // all | active | expired | used

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return links.filter((l) => {
      if (kind !== "all" && l.kind !== kind) return false;
      const isExpired = l.expiresAt && new Date(l.expiresAt) < new Date();
      const isUsed = l.singleUse && l.redeemCount > 0;
      if (status === "active" && (isExpired || isUsed)) return false;
      if (status === "expired" && !isExpired) return false;
      if (status === "used" && !isUsed) return false;
      if (!needle) return true;
      return (
        (l.label ?? "").toLowerCase().includes(needle) ||
        l.code.toLowerCase().includes(needle) ||
        l.targetPath.toLowerCase().includes(needle)
      );
    });
  }, [links, q, kind, status]);

  if (links.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">No links yet.</p>;
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          placeholder="Search label, code, or target…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="flex-1"
        />
        <Select value={kind} onChange={(e) => setKind(e.target.value)} className="sm:w-44">
          <option value="all">All kinds</option>
          {Object.entries(KIND_LABEL).map(([k, label]) => (
            <option key={k} value={k}>{label}</option>
          ))}
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-36">
          <option value="all">All status</option>
          <option value="active">Active only</option>
          <option value="expired">Expired</option>
          <option value="used">Used (single-use)</option>
        </Select>
      </div>
      {filtered.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">No matches.</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((l) => (
            <LinkRow key={l.id} link={l} />
          ))}
        </div>
      )}
    </div>
  );
}

function LinkRow({ link }: { link: LinkDTO }) {
  const router = useRouter();
  // Use the current host so the URL is correct in dev (localhost:3000) and prod (vercel).
  const [origin] = useState(() => (typeof window !== "undefined" ? window.location.origin : ""));
  const [deleting, setDeleting] = useState(false);
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

  async function onDelete() {
    // Confirm before delete — these are one-click hard deletes server-side.
    // Phrase the prompt so the user knows what stops working: the URL itself.
    if (!window.confirm(
      `Delete this link?\n\n${url}\n\nAnyone who already has this URL will get an "expired" page.`,
    )) {
      return;
    }
    setDeleting(true);
    try {
      const res = await fetch(`/api/short-links/${encodeURIComponent(link.code)}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Delete failed");
        return;
      }
      toast.success("Link deleted");
      router.refresh();
    } finally {
      setDeleting(false);
    }
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
          <Button
            size="sm"
            variant="outline"
            onClick={onDelete}
            disabled={deleting}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            aria-label="Delete link"
            title="Delete link"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}
