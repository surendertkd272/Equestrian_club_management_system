"use client";

// Standardised confirm dialog. Replace window.confirm() calls with this for
// nicer keyboard UX (Esc cancels, Enter confirms) and destructive-action
// styling. Imperative API via openConfirm() avoids prop-drilling state.

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type ConfirmOptions = {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  // For irreversible operations (delete club, drop tenant, force-suspend),
  // require the user to type a specific string before the confirm button
  // unlocks. Stops muscle-memory mis-clicks on destructive actions.
  typeToConfirm?: string;
};

let openFn: ((opts: ConfirmOptions) => Promise<boolean>) | null = null;

export function openConfirm(opts: ConfirmOptions): Promise<boolean> {
  if (!openFn) {
    // Fallback to window.confirm if the host page hasn't mounted ConfirmHost
    // (e.g. server-rendered pages that don't include the layout). Keeps the
    // helper safe to call from anywhere.
    return Promise.resolve(window.confirm(opts.title + (opts.body ? `\n\n${opts.body}` : "")));
  }
  return openFn(opts);
}

// Mount once per layout. The admin layout already wraps every page; mounting
// here means every admin page can call openConfirm() and get a real dialog.
export function ConfirmHost() {
  const [state, setState] = useState<
    { opts: ConfirmOptions; resolve: (v: boolean) => void } | null
  >(null);
  const [typed, setTyped] = useState("");

  useEffect(() => {
    openFn = (opts) =>
      new Promise<boolean>((resolve) => {
        setTyped("");
        setState({ opts, resolve });
      });
    return () => {
      openFn = null;
    };
  }, []);

  useEffect(() => {
    if (!state) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        state!.resolve(false);
        setState(null);
      }
      // Enter only confirms if no type-to-confirm phrase is set or it
      // matches — prevents accidental destruction by hitting Enter.
      if (e.key === "Enter" && (!state!.opts.typeToConfirm || typed === state!.opts.typeToConfirm)) {
        state!.resolve(true);
        setState(null);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [state, typed]);

  if (!state) return null;
  const { opts } = state;
  const needsType = !!opts.typeToConfirm;
  const typeOk = !needsType || typed === opts.typeToConfirm;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={() => { state.resolve(false); setState(null); }} />
      <div role="alertdialog" aria-modal="true" className="fixed left-1/2 top-1/3 z-50 w-full max-w-sm -translate-x-1/2 rounded-lg border bg-card p-5 shadow-2xl">
        <h2 className="text-base font-semibold">{opts.title}</h2>
        {opts.body && <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{opts.body}</p>}
        {needsType && (
          <div className="mt-3">
            <label className="text-xs text-muted-foreground">
              Type <code className="rounded bg-muted px-1 font-mono">{opts.typeToConfirm}</code> to confirm:
            </label>
            <input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => { state.resolve(false); setState(null); }}>
            {opts.cancelLabel ?? "Cancel"}
          </Button>
          <Button
            onClick={() => { state.resolve(true); setState(null); }}
            disabled={!typeOk}
            className={opts.destructive ? "bg-rose-600 hover:bg-rose-700 text-white" : ""}
          >
            {opts.confirmLabel ?? (opts.destructive ? "Delete" : "Confirm")}
          </Button>
        </div>
        <div className="mt-3 text-[10px] text-muted-foreground">
          <span className="font-mono">Enter</span> confirm · <span className="font-mono">Esc</span> cancel
        </div>
      </div>
    </>
  );
}
