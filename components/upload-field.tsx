"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { compressForKind } from "@/lib/image-compress";
import { Button } from "@/components/ui/button";

// One file-picker bound to one stored URL.
//
// Four forms had already grown their own copy of pick → compress → POST
// /api/upload → keep the returned path, and the rider EDIT form had none of
// it: it asked staff to type "/uploads/<file>" into a plain text box. Nobody
// does that, so a rider who registered without a photo (it's optional) simply
// never got one — the data was uncollectable through the only screen built for
// correcting it.
//
// Compression runs client-side first, so the original never leaves the device.
// The `kind` is both the compression preset and the storage policy key; pass
// `compressAs` when a field needs different treatment from its storage policy
// (see the staff self-onboarding form for why those two can differ).

export function UploadField({
  value,
  onChange,
  kind,
  compressAs,
  accept = "image/jpeg,image/png,image/webp,application/pdf",
  disabled,
  hint,
}: {
  value: string;
  onChange: (url: string) => void;
  kind: string;
  compressAs?: string;
  accept?: string;
  disabled?: boolean;
  hint?: string;
}) {
  const [busy, setBusy] = useState(false);
  // Resetting the input's value after each pick is what lets someone re-pick
  // the SAME file after a failed upload — without it onChange never fires a
  // second time and the retry looks like a dead button.
  const inputRef = useRef<HTMLInputElement>(null);

  async function pick(file: File) {
    setBusy(true);
    try {
      const compressed = await compressForKind(file, compressAs ?? kind);
      const fd = new FormData();
      fd.append("kind", kind);
      fd.append("file", compressed);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Upload failed");
        return;
      }
      onChange(data.url as string);
      toast.success("Uploaded — remember to Save");
    } catch {
      toast.error("Upload failed. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const isPdf = /\.pdf($|\?)/i.test(value);

  return (
    <div className="space-y-2">
      {value ? (
        <div className="flex items-center gap-3 rounded-md border bg-muted/30 p-2">
          {isPdf ? (
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded border bg-background text-[10px] font-medium text-muted-foreground">
              PDF
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={value}
              alt=""
              className="h-12 w-12 shrink-0 rounded border object-cover"
            />
          )}
          <div className="min-w-0 flex-1">
            <a
              href={value}
              target="_blank"
              rel="noopener noreferrer"
              className="block truncate text-xs text-primary underline"
            >
              View file
            </a>
            <p className="truncate text-[11px] text-muted-foreground">{value}</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled || busy}
            // Clearing to "" is what the form turns into an explicit NULL, so
            // this genuinely removes the document rather than orphaning it.
            onClick={() => onChange("")}
          >
            Remove
          </Button>
        </div>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        disabled={disabled || busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void pick(file);
        }}
        className="block w-full text-xs file:mr-2 file:rounded-md file:border file:bg-muted file:px-2 file:py-1 file:text-xs disabled:opacity-50"
      />
      {busy ? (
        <p className="text-[11px] text-muted-foreground">Uploading…</p>
      ) : hint ? (
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
