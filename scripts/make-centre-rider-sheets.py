#!/usr/bin/env python3
"""One rider data-collection workbook per centre, for a school to fill in.

    python3 scripts/make-centre-rider-sheets.py

Why per-centre rather than one shared file: the bulk importer has no centre
column — rows land in whichever centre the admin has selected when uploading.
A single sheet passed between four schools is therefore one mis-click away
from ninety children being filed under the wrong club, which is not undoable.
Naming the centre on the sheet, in the header AND in the filename, makes the
destination something you can see rather than something you must remember.

Columns are imported from the master template generator so the two cannot
drift; a sheet that disagrees with the importer is worse than no sheet.
"""
import re
import subprocess
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.utils import get_column_letter

# Reuse the master column list verbatim — see the note above.
_src = open("scripts/make-rider-import-template.py").read()
_ns: dict = {}
exec(_src[_src.index("COLUMNS = ["):_src.index("\n]", _src.index("COLUMNS = [")) + 2], _ns)
COLUMNS = _ns["COLUMNS"]

OUT_DIR = "/private/tmp/claude-501/-Users-surenderyadav-Equiwings-CMS/0923d4df-df41-41bf-9dff-bb259ecbc81a/scratchpad/centre-sheets"

HEAD_REQ = PatternFill("solid", fgColor="1F3A8A")
HEAD_OPT = PatternFill("solid", fgColor="475569")
TITLE = PatternFill("solid", fgColor="FDE68A")
THIN = Side(style="thin", color="CBD5E1")


def centres():
    """Live centre list, so a sheet is never produced for a club that closed."""
    url = subprocess.run(
        ["bash", "-lc", 'set -a; source .env >/dev/null 2>&1; set +a; echo "$DIRECT_URL"'],
        capture_output=True, text=True).stdout.strip()
    out = subprocess.run(
        ["psql", url, "-At", "-F", "|", "-c",
         'SELECT name, slug FROM "Centre" ORDER BY name;'],
        capture_output=True, text=True).stdout.strip()
    return [line.split("|", 1) for line in out.split("\n") if "|" in line]


def build(centre_name: str, centre_slug: str) -> str:
    wb = Workbook()
    ws = wb.active
    ws.title = "Riders"

    # Row 1 is the centre, spanning the sheet. The single most common way this
    # goes wrong is a school filling in the wrong club's file, so the answer is
    # on screen before any data is typed — not buried in a filename that gets
    # renamed the moment somebody forwards it.
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=len(COLUMNS))
    t = ws.cell(row=1, column=1, value=f"RIDER DATA — {centre_name}   (do not use this file for any other centre)")
    t.font = Font(bold=True, size=12)
    t.fill = TITLE
    t.alignment = Alignment(vertical="center")
    ws.row_dimensions[1].height = 26

    for i, (name, required, width, _help) in enumerate(COLUMNS, start=1):
        c = ws.cell(row=2, column=i, value=name)
        c.font = Font(bold=True, color="FFFFFF", size=10)
        c.fill = HEAD_REQ if required else HEAD_OPT
        c.alignment = Alignment(vertical="center", wrap_text=True)
        c.border = Border(bottom=THIN)
        ws.column_dimensions[get_column_letter(i)].width = width
    ws.row_dimensions[2].height = 28
    ws.freeze_panes = "A3"

    # Every column TEXT. Excel turns 2015-04-09 into a date serial and re-emits
    # 09-04-2015, and strips the leading zero off a mobile — both fail the
    # whole upload on data that was typed correctly.
    for i in range(1, len(COLUMNS) + 1):
        col = get_column_letter(i)
        for r in range(3, 600):
            ws[f"{col}{r}"].number_format = "@"

    gender_col = get_column_letter([c[0] for c in COLUMNS].index("gender") + 1)
    dv = DataValidation(type="list", formula1='"male,female,other"', allow_blank=True)
    ws.add_data_validation(dv)
    dv.add(f"{gender_col}3:{gender_col}599")

    # ── Instructions
    info = wb.create_sheet("How to fill this in")
    info.column_dimensions["A"].width = 3
    info.column_dimensions["B"].width = 104
    LINES = [
        ("h", f"Rider data for {centre_name}"),
        ("", ""),
        ("p", "Please fill in one row per rider on the 'Riders' sheet, starting at row 3."),
        ("p", "Send the file back as-is — do not convert it, and do not rename the columns."),
        ("", ""),
        ("b", "This file is for ONE centre only"),
        ("p", f"Everything in it will be added to {centre_name}. If you have riders at another"),
        ("p", "centre, please use that centre's own file — there is no centre column, so rows"),
        ("p", "cannot be split afterwards without editing every rider by hand."),
        ("", ""),
        ("b", "Required for every rider"),
        ("p", "first_name, last_name, mobile, dob"),
        ("p", "dob must be typed exactly as YYYY-MM-DD, e.g. 2014-08-23."),
        ("", ""),
        ("b", "parent_email — please fill this in wherever you can"),
        ("p", "It is where the riding indemnity is sent for signature, and where the signed"),
        ("p", "copy, progress reports and login details go afterwards. A rider with no email"),
        ("p", "on file cannot be sent the consent form at all, and cannot start riding until"),
        ("p", "consent is collected another way."),
        ("", ""),
        ("b", "Every column"),
    ]
    for name, required, _w, help_text in COLUMNS:
        LINES.append(("c", f"{name}{'  (required)' if required else ''}"))
        for line in help_text.split("\n"):
            LINES.append(("p", f"    {line}"))
    LINES += [
        ("", ""),
        ("b", "Example"),
        ("m", "first_name  last_name  mobile      dob         parent_email      gender  school_class"),
        ("m", "Aarav       Sharma     9876543210  2014-08-23  priya@family.in   male    7"),
        ("m", "Diya        Kapoor     9812345678  2016-01-09  raj@family.in     female  5"),
    ]
    r = 2
    for kind, text in LINES:
        cell = info.cell(row=r, column=2, value=text)
        if kind == "h":
            cell.font = Font(bold=True, size=14)
        elif kind == "b":
            cell.font = Font(bold=True, size=11)
        elif kind == "c":
            cell.font = Font(bold=True, size=10, color="1F3A8A")
        elif kind == "m":
            cell.font = Font(name="Menlo", size=9)
        else:
            cell.font = Font(size=11)
        r += 1

    safe = re.sub(r"[^a-z0-9]+", "-", centre_name.lower()).strip("-")
    path = f"{OUT_DIR}/equiwings-riders-{safe}.xlsx"
    wb.save(path)
    return path


if __name__ == "__main__":
    import os
    os.makedirs(OUT_DIR, exist_ok=True)
    for name, slug in centres():
        print(build(name, slug))
