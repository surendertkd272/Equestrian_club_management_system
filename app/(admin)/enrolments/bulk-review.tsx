"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { openConfirm } from "@/components/ui/confirm-dialog";
import { postJson } from "@/lib/client/post-json";

type Row = {
  id: string;
  name: string;
  school: string;
  schoolClass: string;
  verified: boolean;
  hasPhoto: boolean;
  hasAadhaar: boolean;
  signed: boolean;
};

const CHUNK = 25;

// Decide many pending enrolments at once — a school drive puts a hundred
// families in the queue in an afternoon. Sends the batch in chunks so each
// request stays short, and reports who was skipped and why.
export function BulkEnrolmentReview({ rows, canVerify }: { rows: Row[]; canVerify: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [school, setSchool] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<{ name: string; reason: string }[]>([]);

  const schools = useMemo(() => Array.from(new Set(rows.map((r) => r.school).filter(Boolean))).sort(), [rows]);
  const needle = q.trim().toLowerCase();
  const shown = rows.filter((r) => (!needle || r.name.toLowerCase().includes(needle)) && (!school || r.school === school));
  const allShown = shown.length > 0 && shown.every((r) => selected.has(r.id));
  const picked = rows.filter((r) => selected.has(r.id));
  const unverified = picked.filter((r) => !r.verified).length;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleShown = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of shown) {
        if (allShown) next.delete(r.id);
        else next.add(r.id);
      }
      return next;
    });

  async function run(action: "verify_approve" | "approve" | "reject") {
    const ids = picked.filter((r) => action !== "approve" || r.verified).map((r) => r.id);
    if (ids.length === 0) return;
    const n = ids.length;
    const ok = await openConfirm(
      action === "verify_approve"
        ? {
            title: `Verify and approve ${n} rider${n === 1 ? "" : "s"}?`,
            body: `You're confirming you checked the documents of all ${n} — photo, Aadhaar and signed indemnity. Each rider's verification is recorded against your name as a bulk review.`,
            confirmLabel: "I checked them — approve",
          }
        : action === "approve"
          ? { title: `Approve ${n} verified rider${n === 1 ? "" : "s"}?`, body: "Each family is told, as when approving one by one.", confirmLabel: "Approve" }
          : {
              title: `Reject ${n} enrolment${n === 1 ? "" : "s"}?`,
              body: "These riders won't be registered. This can't be undone from here.",
              confirmLabel: "Reject",
              destructive: true,
            },
    );
    if (!ok) return;
    let done = 0;
    const skips: { name: string; reason: string }[] = [];
    for (let i = 0; i < ids.length; i += CHUNK) {
      setProgress(`${Math.min(i + CHUNK, n)} of ${n}…`);
      const res = await postJson<{ done: number; skipped: { name: string; reason: string }[] }>("/api/enrolments/bulk", {
        riderIds: ids.slice(i, i + CHUNK),
        action,
        ...(action === "verify_approve" ? { attested: true } : {}),
      });
      if (!res.ok) {
        toast.error(res.message);
        break;
      }
      done += res.data.done;
      skips.push(...res.data.skipped);
    }
    setProgress(null);
    setSkipped(skips);
    setSelected(new Set());
    toast.success(`${done} ${action === "reject" ? "rejected" : "approved"}${skips.length ? ` · ${skips.length} skipped` : ""}`);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Input className="min-w-0 flex-1" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" aria-label="Search pending riders" />
        {schools.length > 0 && (
          <Select aria-label="School" value={school} onChange={(e) => setSchool(e.target.value)} className="max-w-full sm:max-w-[14rem]">
            <option value="">All schools</option>
            {schools.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        )}
      </div>
      <div className="max-h-80 overflow-y-auto rounded-md border">
        <label className="flex items-center gap-2 border-b bg-muted/40 px-3 py-1.5 text-xs font-medium">
          <input type="checkbox" checked={allShown} onChange={toggleShown} aria-label="Select all shown" />
          Select all shown ({shown.length})
        </label>
        {shown.map((r) => (
          <label key={r.id} className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-1.5 text-sm last:border-b-0">
            <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.name}`} />
            <span className="min-w-0 flex-1">
              <span className="font-medium">{r.name}</span>
              <span className="block text-xs text-muted-foreground">
                {[r.school, r.schoolClass && `Class ${r.schoolClass}`].filter(Boolean).join(" · ") || "—"}
              </span>
            </span>
            {r.verified ? <Badge variant="success">verified</Badge> : <Badge variant="outline">not verified</Badge>}
            {!r.hasPhoto && <Badge variant="warning">no photo</Badge>}
            {!r.hasAadhaar && <Badge variant="warning">no Aadhaar</Badge>}
            {!r.signed && <Badge variant="warning">not signed</Badge>}
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm">{picked.length} selected</span>
        {canVerify && (
          <Button size="sm" onClick={() => run("verify_approve")} disabled={!!progress || picked.length === 0}>
            Verify &amp; approve {picked.length || ""}
          </Button>
        )}
        <Button
          size="sm"
          variant={canVerify ? "outline" : "default"}
          onClick={() => run("approve")}
          disabled={!!progress || picked.length - unverified === 0}
          title={unverified ? `${unverified} selected aren't verified yet and will be left out` : undefined}
        >
          Approve verified {picked.length - unverified || ""}
        </Button>
        <Button size="sm" variant="outline" className="border-destructive/40 text-destructive" onClick={() => run("reject")} disabled={!!progress || picked.length === 0}>
          Reject {picked.length || ""}
        </Button>
        {progress && <span className="text-xs text-muted-foreground">Working… {progress}</span>}
      </div>
      {skipped.length > 0 && (
        <div className="rounded-md border border-warning/40 bg-warning-soft p-2 text-xs">
          <div className="mb-1 font-medium">{skipped.length} skipped:</div>
          <ul className="max-h-40 space-y-0.5 overflow-y-auto">
            {skipped.map((s, i) => (
              <li key={i}>
                {s.name} — {s.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
