"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { roleLabel } from "@/lib/labels";
type Preview = {
  dryRun: true;
  wouldCreate: number;
  duplicates: number;
  errors: { line: number; reason: string }[];
  preview: Record<string, string>[];
};

type ImportResult = {
  created: number;
  examsScheduled: number;
  errors: { line: number; reason: string }[];
};

export function ImportForm({
  examiners,
}: {
  examiners: { id: string; name: string; role: string }[];
}) {
  const router = useRouter();
  const [csv, setCsv] = useState("");
  const [examinerId, setExaminerId] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState<null | "preview" | "import">(null);

  async function readFile(file: File | null) {
    if (!file) return;
    const text = await file.text();
    setCsv(text);
    setPreview(null);
    setResult(null);
  }

  async function call(dryRun: boolean) {
    if (!csv.trim()) {
      toast.error("Paste CSV or upload a file first.");
      return;
    }
    setBusy(dryRun ? "preview" : "import");
    try {
      const res = await fetch("/api/riders/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          csv,
          dryRun,
          examinerId: examinerId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Failed");
        return;
      }
      if (dryRun) {
        setPreview(data);
        setResult(null);
      } else {
        setResult(data);
        setPreview(null);
        toast.success(`Imported ${data.created} riders${data.examsScheduled ? ` · ${data.examsScheduled} exams scheduled` : ""}`);
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>CSV File</Label>
          <input
            type="file"
            accept=".csv,.txt,text/csv"
            onChange={(e) => readFile(e.target.files?.[0] ?? null)}
            className="mt-1 block w-full text-sm"
          />
        </div>
        <div>
          <Label>Schedule Exam at Level (optional)</Label>
          <Select aria-label="Schedule exam at level (optional)" value={examinerId} onChange={(e) => setExaminerId(e.target.value)}>
            <option value="">— Don&apos;t schedule exams —</option>
            {examiners.map((u) => (
              <option key={u.id} value={u.id}>
                Examiner: {u.name} · {roleLabel(u.role)}
              </option>
            ))}
          </Select>
          <p className="mt-1 text-[11px] text-muted-foreground">
            When set, rows with a <code>level</code> column also get a scheduled exam.
          </p>
        </div>
      </div>

      <div>
        <Label>Or Paste CSV</Label>
        <textarea
          value={csv}
          onChange={(e) => {
            setCsv(e.target.value);
            setPreview(null);
            setResult(null);
          }}
          rows={8}
          spellCheck={false}
          placeholder={"first_name,last_name,mobile,email,dob,gender,school,level\nRiya,Sharma,9876543210,riya@example.in,2012-04-12,F,DPS Bangalore,1"}
          className="mt-1 block w-full rounded-md border bg-card p-2 font-mono text-xs"
        />
      </div>

      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={() => call(true)} disabled={busy !== null}>
          {busy === "preview" ? "Checking…" : "Preview"}
        </Button>
        <Button
          type="button"
          onClick={() => call(false)}
          disabled={busy !== null || !preview || preview.wouldCreate === 0}
        >
          {busy === "import" ? "Importing…" : `Import${preview ? ` ${preview.wouldCreate}` : ""}`}
        </Button>
      </div>

      {preview && (
        <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="success">{preview.wouldCreate} ready to create</Badge>
            {preview.duplicates > 0 && (
              <Badge variant="warning">{preview.duplicates} duplicate(s)</Badge>
            )}
            {preview.errors.length > 0 && (
              <Badge variant="destructive">{preview.errors.length} error(s)</Badge>
            )}
          </div>
          {preview.preview.length > 0 && (
            <div>
              <div className="mt-2 text-xs font-semibold uppercase text-muted-foreground">First {preview.preview.length} rows</div>
              <ul className="mt-1 space-y-0.5 text-xs">
                {preview.preview.map((r, i) => (
                  <li key={i} className="font-mono">
                    {(r as any).first_name} {(r as any).last_name} · {(r as any).mobile}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {preview.errors.length > 0 && (
            <details>
              <summary className="cursor-pointer text-xs font-medium text-danger-foreground">
                Errors ({preview.errors.length})
              </summary>
              <ul className="mt-1 space-y-0.5 text-xs">
                {preview.errors.slice(0, 50).map((e, i) => (
                  <li key={i} className="font-mono text-danger-foreground">
                    Line {e.line}: {e.reason}
                  </li>
                ))}
                {preview.errors.length > 50 && (
                  <li className="text-muted-foreground">…and {preview.errors.length - 50} more</li>
                )}
              </ul>
            </details>
          )}
        </div>
      )}

      {result && (
        <div className="rounded-md border border-success/30 bg-success-soft p-3 text-sm text-success-foreground">
          <div className="font-semibold">
            Imported {result.created} rider{result.created === 1 ? "" : "s"}.
            {result.examsScheduled > 0 && ` Scheduled ${result.examsScheduled} exam(s).`}
          </div>
          {result.errors.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-warning-foreground">
                Skipped {result.errors.length} row(s)
              </summary>
              <ul className="mt-1 space-y-0.5 text-xs">
                {result.errors.slice(0, 50).map((e, i) => (
                  <li key={i}>Line {e.line}: {e.reason}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
