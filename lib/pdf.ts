// Lightweight PDF/print pipeline. We return print-ready HTML with @page CSS
// rather than a binary PDF — every modern browser prints to PDF in two clicks,
// and this keeps us off heavy deps (pdfkit, pdf-lib, puppeteer) for the
// initial cut. The endpoints set Content-Type: text/html so the browser
// renders + the Ctrl+P → "Save as PDF" path works immediately.
//
// If a customer later needs server-side rasterisation (for emailing the file
// or attaching to a record), swap renderPrintable() for a puppeteer-based
// pipeline at the route layer.

export type PrintableDoc = {
  title: string;
  // Free-form HTML body (the route composes the real content).
  bodyHtml: string;
  // Pinned to portrait A4 by default — overridable per call.
  pageSize?: "A4" | "Letter";
  orientation?: "portrait" | "landscape";
  // Auto-trigger the browser print dialog on load so the user sees PDF/print
  // immediately without an extra click.
  autoPrint?: boolean;
};

export function renderPrintable(doc: PrintableDoc): string {
  const pageSize = doc.pageSize ?? "A4";
  const orientation = doc.orientation ?? "portrait";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(doc.title)}</title>
  <style>
    @page { size: ${pageSize} ${orientation}; margin: 18mm; }
    * { box-sizing: border-box; }
    body {
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      color: #1a1a1a;
      font-size: 11pt;
      line-height: 1.45;
      margin: 0;
      padding: 0;
    }
    h1, h2, h3 { margin: 0 0 6mm; }
    h1 { font-size: 20pt; letter-spacing: -0.01em; }
    h2 { font-size: 14pt; }
    h3 { font-size: 11pt; text-transform: uppercase; letter-spacing: 0.08em; color: #444; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 6mm; }
    th, td { padding: 4pt 6pt; border-bottom: 0.5pt solid #ccc; text-align: left; vertical-align: top; }
    th { background: #f5f5f5; font-size: 9pt; text-transform: uppercase; letter-spacing: 0.05em; color: #444; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10mm; padding-bottom: 4mm; border-bottom: 1pt solid #ddd; }
    .brand { font-weight: 700; letter-spacing: -0.01em; }
    .meta { font-size: 9pt; color: #555; }
    .signature-block { display: flex; justify-content: space-between; gap: 20mm; margin-top: 18mm; }
    .signature-block > div { flex: 1; border-top: 0.75pt solid #000; padding-top: 3mm; font-size: 9pt; color: #555; text-align: center; }
    .footer { position: fixed; bottom: 8mm; left: 18mm; right: 18mm; font-size: 8pt; color: #888; display: flex; justify-content: space-between; }
    .pill { display: inline-block; padding: 1pt 6pt; border-radius: 999px; font-size: 8pt; letter-spacing: 0.06em; background: #eee; color: #333; }
    .score-grid { display: grid; grid-template-columns: 3fr 1fr 1fr; gap: 0; }
    .score-grid > div { padding: 2mm 3mm; border-bottom: 0.5pt solid #ccc; }
    .score-grid .head { background: #f5f5f5; font-size: 9pt; text-transform: uppercase; }
    .totals { font-size: 13pt; font-weight: 700; }
    .no-print { display: block; padding: 6mm; background: #fffbe6; border: 1px solid #f1c40f; margin-bottom: 6mm; }
    @media print { .no-print { display: none !important; } }
  </style>
</head>
<body>
  <div class="no-print">
    📄 Print this page to save as PDF (Ctrl/⌘ + P → "Save as PDF").
  </div>
  ${doc.bodyHtml}
  ${doc.autoPrint ? "<script>window.addEventListener('load', () => setTimeout(() => window.print(), 200));</script>" : ""}
</body>
</html>`;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Common header block used by certificates / test sheets / judge sheets.
export function pdfHeader(opts: { centreName: string; subtitle?: string; serial?: string; date?: Date }): string {
  const date = (opts.date ?? new Date()).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" });
  return `
    <div class="header">
      <div>
        <div class="brand">${escapeHtml(opts.centreName)}</div>
        ${opts.subtitle ? `<div class="meta">${escapeHtml(opts.subtitle)}</div>` : ""}
      </div>
      <div class="meta" style="text-align:right">
        ${opts.serial ? `<div class="pill">${escapeHtml(opts.serial)}</div><br/>` : ""}
        <span>${date}</span>
      </div>
    </div>
  `;
}
