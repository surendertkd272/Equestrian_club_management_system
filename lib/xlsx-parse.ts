import ExcelJS from "exceljs";

// Reading the .xlsx we hand out, directly.
//
// The importer only understood CSV, so the instructions told people to open
// the template in Excel and "Save As → CSV" first. That step is not just
// friction: Excel rewrites dates on CSV export according to the machine's
// locale, so a column typed as 2014-08-23 comes back as 23/08/2014 and every
// row fails DOB validation. The template even carries a warning about it,
// which is a documentation fix for a code problem.
//
// Reading the workbook directly removes the conversion, the warning, and the
// entire class of failure — and dates arrive as real Date objects rather than
// as whatever the spreadsheet decided to print.

export type ParsedSheet = {
  rows: Record<string, string>[];
  errors: { line: number; reason: string }[];
};

/** Excel serial → ISO date. Cells typed as dates come back as Date already. */
function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    // ISO date only. The importer's dob/joining_date want YYYY-MM-DD, and a
    // spreadsheet date carries a spurious midnight-UTC time we must not let
    // shift the day.
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "object") {
    // Rich text, hyperlinks and formula results all arrive as objects.
    const v = value as { text?: unknown; result?: unknown; richText?: { text: string }[] };
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join("");
    if (typeof v.text === "string") return v.text;
    if (v.result !== undefined && v.result !== null) return String(v.result);
    return "";
  }
  return String(value).trim();
}

export async function parseXlsx(buffer: Buffer, sheetName?: string): Promise<ParsedSheet> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);

  // Prefer the named sheet, else the first with content. Our template's first
  // sheet is "Riders"; Instructions and Batch names must never be read as data.
  const ws =
    (sheetName && wb.getWorksheet(sheetName)) ||
    wb.getWorksheet("Riders") ||
    wb.worksheets[0];
  if (!ws) return { rows: [], errors: [{ line: 0, reason: "The workbook has no sheets." }] };

  const headerRow = ws.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col - 1] = cellToString(cell.value).trim().toLowerCase();
  });
  if (headers.filter(Boolean).length === 0) {
    return { rows: [], errors: [{ line: 1, reason: "No column headers found in the first row." }] };
  }

  const rows: Record<string, string>[] = [];
  const errors: { line: number; reason: string }[] = [];

  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const rec: Record<string, string> = {};
    let hasAny = false;
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      const key = headers[col - 1];
      if (!key) return;
      const val = cellToString(cell.value);
      rec[key] = val;
      if (val !== "") hasAny = true;
    });
    // A spreadsheet routinely carries formatted-but-empty trailing rows;
    // treating those as failed records would report dozens of phantom errors.
    if (!hasAny) return;
    rows.push(rec);
  });

  return { rows, errors };
}
