// Minimal RFC-4180-ish CSV parser. Supports:
//   • commas, tabs, and semicolons as delimiters (auto-detected)
//   • double-quoted fields with embedded commas, newlines, and "" escapes
//   • Windows (\r\n), Mac (\r), and Unix (\n) line endings
//   • a leading UTF-8 BOM
// No npm dependency — we control input shape and stay deterministic.

export type CsvParseResult = {
  headers: string[];
  rows: Record<string, string>[];
  // Lines (1-indexed in the source file) that couldn't be parsed.
  errors: { line: number; reason: string }[];
};

function detectDelimiter(headerLine: string): string {
  // Pick whichever separator appears most in the first line.
  const counts = {
    ",": (headerLine.match(/,/g) ?? []).length,
    "\t": (headerLine.match(/\t/g) ?? []).length,
    ";": (headerLine.match(/;/g) ?? []).length,
  };
  let best = ",";
  let bestN = -1;
  for (const [d, n] of Object.entries(counts)) {
    if (n > bestN) {
      best = d;
      bestN = n;
    }
  }
  return best;
}

function splitLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let buf = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"') {
        // Doubled quote → literal quote
        if (line[i + 1] === '"') {
          buf += '"';
          i++;
        } else {
          inQuote = false;
        }
      } else {
        buf += ch;
      }
    } else {
      if (ch === '"') {
        inQuote = true;
      } else if (ch === delim) {
        out.push(buf);
        buf = "";
      } else {
        buf += ch;
      }
    }
  }
  out.push(buf);
  return out;
}

export function parseCsv(input: string): CsvParseResult {
  // Strip BOM if present.
  if (input.charCodeAt(0) === 0xfeff) input = input.slice(1);
  // Normalise line endings; keep field-internal newlines if they were quoted
  // (the quote-aware splitter below handles those).
  const normalised = input.replace(/\r\n?/g, "\n");

  // Reassemble physical lines into logical records by tracking quote balance
  // across newlines.
  const records: string[] = [];
  let current = "";
  let inQuote = false;
  for (const ch of normalised) {
    if (ch === '"') inQuote = !inQuote;
    if (ch === "\n" && !inQuote) {
      records.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.length > 0) records.push(current);

  const nonEmpty = records.map((r, i) => ({ raw: r, line: i + 1 })).filter((r) => r.raw.trim().length > 0);
  if (nonEmpty.length === 0) return { headers: [], rows: [], errors: [] };

  const delim = detectDelimiter(nonEmpty[0]!.raw);
  const headers = splitLine(nonEmpty[0]!.raw, delim).map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));

  const rows: Record<string, string>[] = [];
  const errors: { line: number; reason: string }[] = [];
  for (let i = 1; i < nonEmpty.length; i++) {
    const { raw, line } = nonEmpty[i]!;
    const cells = splitLine(raw, delim).map((c) => c.trim());
    if (cells.length === 1 && cells[0] === "") continue;
    if (cells.length !== headers.length) {
      errors.push({
        line,
        reason: `Expected ${headers.length} columns, got ${cells.length}`,
      });
      continue;
    }
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = cells[idx] ?? "";
    });
    rows.push(row);
  }

  return { headers, rows, errors };
}
