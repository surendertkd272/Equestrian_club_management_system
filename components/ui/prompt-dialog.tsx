"use client";

// Standardised text/number prompt — replaces window.prompt() (which is tiny,
// unstyled, can't multiline, fires the wrong mobile keyboard, and is suppressed
// by some browsers). Imperative API via openPrompt() mirrors openConfirm().
//
//   const note = await openPrompt({ title: "Add treatment", label: "Care notes", multiline: true, required: true });
//   if (note == null) return;            // cancelled
//
// Returns the entered string, or null if cancelled.

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useFocusTrap } from "@/lib/use-focus-trap";

type PromptOptions = {
  title: string;
  body?: string;
  label?: string;
  placeholder?: string;
  initialValue?: string;
  multiline?: boolean;
  inputMode?: "numeric" | "tel" | "text";
  required?: boolean; // when true, submit is disabled until non-empty
  confirmLabel?: string;
  cancelLabel?: string;
};

let openFn: ((opts: PromptOptions) => Promise<string | null>) | null = null;

export function openPrompt(opts: PromptOptions): Promise<string | null> {
  if (!openFn) {
    // Fallback if the host isn't mounted (keeps the helper safe to call anywhere).
    const v = window.prompt(opts.title + (opts.label ? `\n${opts.label}` : ""), opts.initialValue ?? "");
    return Promise.resolve(v);
  }
  return openFn(opts);
}

// Mount once per layout (alongside ConfirmHost).
export function PromptHost() {
  const [state, setState] = useState<{ opts: PromptOptions; resolve: (v: string | null) => void } | null>(null);
  const [val, setVal] = useState("");
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, !!state);

  useEffect(() => {
    openFn = (opts) =>
      new Promise<string | null>((resolve) => {
        setVal(opts.initialValue ?? "");
        setState({ opts, resolve });
        setTimeout(() => inputRef.current?.focus(), 30);
      });
    return () => {
      openFn = null;
    };
  }, []);

  if (!state) return null;
  const { opts } = state;
  const trimmed = val.trim();
  const canSubmit = !opts.required || trimmed.length > 0;

  function close(result: string | null) {
    state!.resolve(result);
    setState(null);
  }
  function submit() {
    if (!canSubmit) return;
    close(val);
  }
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      close(null);
    } else if (e.key === "Enter" && (!opts.multiline || e.metaKey || e.ctrlKey)) {
      // Single-line: Enter submits. Multiline: Enter = newline, Cmd/Ctrl+Enter submits.
      e.preventDefault();
      submit();
    }
  }

  const fieldClass =
    "mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={() => close(null)} aria-hidden />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={opts.title}
        className="fixed left-1/2 top-1/4 z-50 w-full max-w-md -translate-x-1/2 rounded-lg border bg-card p-5 shadow-2xl"
      >
        <h2 className="text-base font-semibold">{opts.title}</h2>
        {opts.body && <p className="mt-1 text-sm text-muted-foreground">{opts.body}</p>}
        <label className="mt-3 block text-xs font-medium text-muted-foreground">
          {opts.label ?? "Value"} {opts.required && <span className="text-destructive">*</span>}
        </label>
        {opts.multiline ? (
          <textarea
            ref={(el) => { inputRef.current = el; }}
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={opts.placeholder}
            rows={4}
            className={fieldClass}
          />
        ) : (
          <input
            ref={(el) => { inputRef.current = el; }}
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={opts.placeholder}
            inputMode={opts.inputMode}
            className={fieldClass}
          />
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => close(null)}>
            {opts.cancelLabel ?? "Cancel"}
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {opts.confirmLabel ?? "Save"}
          </Button>
        </div>
        <div className="mt-3 text-[10px] text-muted-foreground">
          <span className="font-mono">{opts.multiline ? "⌘/Ctrl+Enter" : "Enter"}</span> save ·{" "}
          <span className="font-mono">Esc</span> cancel
        </div>
      </div>
    </>
  );
}
