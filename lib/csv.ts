// Tiny CSV serialiser. We don't need a full RFC-4180 library — quoting fields
// with embedded "," | "\n" | quotes is enough for the spreadsheet apps users
// open exports in. Excel and Google Sheets both auto-detect UTF-8 when the
// file starts with a BOM, which we prepend.

function escapeField(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = typeof v === "string" ? v : v instanceof Date ? v.toISOString() : String(v);
  // CSV-injection guard. Excel, LibreOffice and Sheets treat a cell beginning
  // = + - @ (or a leading tab / carriage return) as a FORMULA, so a value that
  // arrived from an untrusted place executes on the machine of whoever opens
  // the export. Rider and horse names come straight off the public onboarding
  // form, and a name of `=1+1+cmd|calc` was exported verbatim — the admin who
  // opens the roster in Excel is the target.
  //
  // Prefixing a single quote is the standard neutralisation: spreadsheets treat
  // the rest of the cell as literal text and don't display the quote itself.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(escapeField).join(",")];
  for (const r of rows) lines.push(r.map(escapeField).join(","));
  // BOM so Excel reads Indian names / accents / ₹ correctly.
  return "﻿" + lines.join("\r\n") + "\r\n";
}

export function csvResponse(
  filename: string,
  csv: string,
  meta?: { total?: number; returned?: number; truncated?: boolean },
): Response {
  const headers: Record<string, string> = {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
  };
  // Expose the dataset shape via response headers — the browser ignores
  // them on a normal save, but the UI (and any programmatic caller) can
  // surface a "Your export was capped at N of M rows" warning before
  // serving the file as a download.
  if (typeof meta?.total === "number") headers["X-Total-Count"] = String(meta.total);
  if (typeof meta?.returned === "number") headers["X-Returned-Count"] = String(meta.returned);
  if (meta?.truncated) headers["X-Truncated"] = "1";
  return new Response(csv, { headers });
}
