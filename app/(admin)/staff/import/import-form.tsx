"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

type PreviewRow = {
  line: number;
  name: string;
  email: string;
  role: string;
  phone: string;
  salary_band: string;
  joining_date: string;
};

type Preview = {
  dryRun: true;
  wouldCreate: number;
  duplicates: number;
  errors: { line: number; reason: string }[];
  preview: PreviewRow[];
};

type ImportResult = {
  created: number;
  errors: { line: number; reason: string }[];
};

export function StaffImportForm() {
  const router = useRouter();
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState<null | "preview" | "import">(null);
  const [xlsx, setXlsx] = useState<{ name: string; base64: string } | null>(null);

  async function readFile(file: File | null) {
    if (!file) return;
    setPreview(null);
    setResult(null);

    if (/\.xlsx?$/i.test(file.name)) {
      const buf = await file.arrayBuffer();
      let binary = "";
      const bytes = new Uint8Array(buf);
      // Chunked — String.fromCharCode(...bytes) blows the argument limit on a
      // workbook of any size.
      for (let i = 0; i < bytes.length; i += 8192) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      }
      setXlsx({ name: file.name, base64: btoa(binary) });
      setCsv("");
      return;
    }

    const text = await file.text();
    setCsv(text);
    setXlsx(null);
  }

  async function call(dryRun: boolean) {
    if (!csv.trim() && !xlsx) {
      toast.error("Upload the filled-in template, or paste CSV.");
      return;
    }
    setBusy(dryRun ? "preview" : "import");
    try {
      const res = await fetch("/api/staff/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(xlsx ? { xlsxBase64: xlsx.base64 } : { csv }),
          dryRun,
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
        toast.success(`Created ${data.created} staff account${data.created === 1 ? "" : "s"}`);
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <Label>Filled-in template (.xlsx or .csv)</Label>
        <input
          type="file"
          accept=".xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => readFile(e.target.files?.[0] ?? null)}
          className="mt-1 block w-full text-sm"
        />
        <p className="mt-1.5 text-xs text-muted-foreground">
          Upload the Excel file directly — no need to convert it.{" "}
          <a
            href="/templates/equiwings-staff-import-template.xlsx"
            className="text-primary underline"
            download
          >
            Download the Excel template
          </a>
          {xlsx && <span className="ml-1 font-medium text-foreground">· {xlsx.name} loaded</span>}
        </p>
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
          rows={7}
          spellCheck={false}
          placeholder={
            "name,email,role,phone,salary_band,joining_date\nRavi Kumar,ravi@club.in,COACH,9876543210,C2,2026-04-01"
          }
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
          {busy === "import" ? "Creating…" : `Create${preview ? ` ${preview.wouldCreate}` : ""}`}
        </Button>
      </div>

      {preview && (
        <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="success">{preview.wouldCreate} ready to create</Badge>
            {preview.duplicates > 0 && (
              <Badge variant="warning">{preview.duplicates} email(s) already in use</Badge>
            )}
            {preview.errors.length > 0 && (
              <Badge variant="destructive">{preview.errors.length} error(s)</Badge>
            )}
          </div>
          {preview.preview.length > 0 && (
            <div>
              <div className="mt-2 text-xs font-semibold uppercase text-muted-foreground">
                First {preview.preview.length} rows
              </div>
              <ul className="mt-1 space-y-0.5 text-xs">
                {preview.preview.map((r) => (
                  <li key={r.line} className="font-mono">
                    {r.name} · {r.email} · {r.role}
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
            Created {result.created} staff account{result.created === 1 ? "" : "s"}.
          </div>
          {result.created > 0 && (
            // The sheet carries no password, so the only place those logins
            // exist is the Credential Sheet. Saying it here, at the moment the
            // accounts land, is what stops "so how do they log in?" an hour later.
            <p className="mt-2">
              Each account got its own generated password — nothing was read from the
              spreadsheet.{" "}
              <a href="/users/credentials" className="font-medium underline">
                Open the Credential Sheet
              </a>{" "}
              to print or hand them over.
            </p>
          )}
          {result.errors.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-warning-foreground">
                Skipped {result.errors.length} row(s)
              </summary>
              <ul className="mt-1 space-y-0.5 text-xs">
                {result.errors.slice(0, 50).map((e, i) => (
                  <li key={i}>
                    Line {e.line}: {e.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
