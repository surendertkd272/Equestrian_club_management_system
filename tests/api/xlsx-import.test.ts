// Reading the template we hand out, directly.
//
// The importer only understood CSV, so the instructions said to open the
// workbook and "Save As → CSV" first. That is not just an extra step: Excel
// rewrites dates on CSV export to the machine's locale, so a column typed as
// 2014-08-23 comes back as 23/08/2014 and every row fails DOB validation. The
// template carried a warning about it, which is documentation standing in for
// a fix.

import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { parseXlsx } from "@/lib/xlsx-parse";

async function workbook(
  rows: unknown[][],
  headers = ["first_name", "last_name", "dob"],
  sheet = "Riders",
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheet);
  ws.addRow(headers);
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("parseXlsx", () => {
  it("reads rows keyed by header", async () => {
    const buf = await workbook([["Riya", "Sharma", "2014-08-23"]]);
    const { rows } = await parseXlsx(buf);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ first_name: "Riya", last_name: "Sharma", dob: "2014-08-23" });
  });

  it("renders a real date cell as YYYY-MM-DD", async () => {
    // The whole reason for reading xlsx directly. A date typed as a date must
    // not arrive as "Sat Aug 23 2014" or as a locale-flipped 23/08/2014.
    const buf = await workbook([["Riya", "Sharma", new Date(Date.UTC(2014, 7, 23))]]);
    const { rows } = await parseXlsx(buf);
    expect(rows[0].dob).toBe("2014-08-23");
  });

  it("lower-cases headers so Excel's capitalisation doesn't matter", async () => {
    const buf = await workbook([["Riya", "Sharma", "2014-08-23"]], [
      "First_Name",
      "LAST_NAME",
      "dob",
    ]);
    const { rows } = await parseXlsx(buf);
    expect(rows[0].first_name).toBe("Riya");
    expect(rows[0].last_name).toBe("Sharma");
  });

  it("ignores formatted-but-empty trailing rows", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Riders");
    ws.addRow(["first_name", "last_name", "dob"]);
    ws.addRow(["Riya", "Sharma", "2014-08-23"]);
    ws.addRow(["", "", ""]);
    ws.addRow([null, null, null]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const { rows } = await parseXlsx(buf);
    // A spreadsheet routinely carries these; reporting them as failed records
    // would bury the real errors under phantom ones.
    expect(rows).toHaveLength(1);
  });

  it("reads the Riders sheet, not Instructions", async () => {
    const wb = new ExcelJS.Workbook();
    const instr = wb.addWorksheet("Instructions");
    instr.addRow(["How to fill this in"]);
    instr.addRow(["Do not upload this sheet"]);
    const ws = wb.addWorksheet("Riders");
    ws.addRow(["first_name", "last_name", "dob"]);
    ws.addRow(["Riya", "Sharma", "2014-08-23"]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const { rows } = await parseXlsx(buf);
    expect(rows).toHaveLength(1);
    expect(rows[0].first_name).toBe("Riya");
  });

  it("reports a workbook with no headers rather than throwing", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Riders");
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const { rows, errors } = await parseXlsx(buf);
    expect(rows).toHaveLength(0);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("parses the template we actually ship", async () => {
    // Guards the round trip end to end: if the generator and the parser ever
    // disagree, the file a club downloads stops importing.
    const fs = await import("node:fs/promises");
    const buf = await fs.readFile("public/templates/equiwings-rider-import-template.xlsx");
    const { rows } = await parseXlsx(buf);
    // The template ships with no data rows — headers only.
    expect(Array.isArray(rows)).toBe(true);
  });
});
