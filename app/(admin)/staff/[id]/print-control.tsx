"use client";

import { useState } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

// Lets an admin / super-admin pick which parts of the employee's packet to
// print — the registration form and/or any of the uploaded documents — then
// opens a print-optimised view in a new tab.
export function PrintControl({ staffId, docs }: { staffId: string; docs: { key: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  // Everything selected by default.
  const [form, setForm] = useState(true);
  const [picked, setPicked] = useState<Record<string, boolean>>(
    Object.fromEntries(docs.map((d) => [d.key, true])),
  );

  const selectedDocs = docs.filter((d) => picked[d.key]).map((d) => d.key);
  const nothing = !form && selectedDocs.length === 0;
  const allOn = form && docs.every((d) => picked[d.key]);

  function setAll(on: boolean) {
    setForm(on);
    setPicked(Object.fromEntries(docs.map((d) => [d.key, on])));
  }

  function print() {
    const items = [form ? "form" : null, ...selectedDocs].filter(Boolean).join(",");
    window.open(`/staff-print/${staffId}?items=${encodeURIComponent(items)}`, "_blank", "noopener");
  }

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Printer className="h-4 w-4" /> Print form & documents
      </Button>
    );
  }

  return (
    <div className="w-full max-w-md space-y-3 rounded-md border bg-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Choose what to print</p>
        <button
          type="button"
          onClick={() => setAll(!allOn)}
          className="text-xs text-primary underline"
        >
          {allOn ? "Clear all" : "Select all"}
        </button>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form} onChange={(e) => setForm(e.target.checked)} className="h-4 w-4" />
        Registration form
      </label>

      {docs.length === 0 ? (
        <p className="text-xs text-muted-foreground">No documents uploaded yet.</p>
      ) : (
        <div className="space-y-1.5 border-t pt-2">
          {docs.map((d) => (
            <label key={d.key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!!picked[d.key]}
                onChange={(e) => setPicked((p) => ({ ...p, [d.key]: e.target.checked }))}
                className="h-4 w-4"
              />
              {d.label}
            </label>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <Button onClick={print} disabled={nothing}>
          <Printer className="h-4 w-4" /> Print selected
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Opens a print-ready page in a new tab. PDF attachments are embedded; if your browser doesn&apos;t print them
        inline, use the &ldquo;open&rdquo; link on that page to print each one.
      </p>
    </div>
  );
}
