"use client";

// Tiny client wrapper so the server-rendered invoice page can keep its
// data-fetch on the server. The button is hidden by .no-print so the
// PDF output (Cmd/Ctrl+P) excludes it.
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
    >
      Print / Save as PDF
    </button>
  );
}
