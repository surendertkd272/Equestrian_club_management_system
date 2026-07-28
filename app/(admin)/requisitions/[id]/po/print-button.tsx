"use client";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-md bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground"
    >
      Print / save as PDF
    </button>
  );
}
