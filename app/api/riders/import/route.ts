import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { resolveWriteCentre } from "@/lib/resolve-centre";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { parseCsv } from "@/lib/csv-parse";
import { parseXlsx } from "@/lib/xlsx-parse";
import { isRealYMD } from "@/lib/utils";
import { indianMobile } from "@/lib/schemas/phone";

// Schema for a single row in the import payload. Accepts a generous set
// of column aliases so CSV authors don't have to use exact field names.
const rowSchema = z.object({
  first_name: z.string().min(1).max(80),
  last_name: z.string().min(1).max(80),
  // Same rule as the public signup form. This was a length-only check, so a
  // spreadsheet cell reading "nine-eight-one" imported as a contact number and
  // every SMS / WhatsApp to that family then failed silently at dispatch —
  // bulk import being the one path where nobody eyeballs each value. Also
  // normalises "+91 98123 45671" and "098123…" to bare digits, which makes the
  // duplicate check below compare like with like instead of treating the same
  // number in two formats as two people.
  mobile: indianMobile("Not a valid Indian mobile number"),
  email: z.string().email().optional().or(z.literal("")).transform((v) => v || undefined),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "DOB must be YYYY-MM-DD").refine(isRealYMD, "DOB isn't a real calendar date"),
  gender: z
    .string()
    .optional()
    .transform((v) => {
      const t = (v ?? "").trim().toLowerCase();
      if (t === "m" || t === "male") return "male";
      if (t === "f" || t === "female") return "female";
      if (t === "o" || t === "other") return "other";
      return undefined;
    }),
  school: z.string().max(120).optional().transform((v) => v || undefined),
  school_class: z.string().max(40).optional().transform((v) => v || undefined),
  school_section: z.string().max(20).optional().transform((v) => v || undefined),
  // A PARENT's address, and for a club of minors the one that matters.
  //
  // 96 riders in 100 have no email of their own, which is unsurprising when
  // two thirds of them are children — so every email feature (consent links,
  // report cards, portal logins) had nobody to write to. The rider's own
  // address stays optional; this is the column that actually gets filled.
  parent_email: z.string().email().optional().or(z.literal("")).transform((v) => v || undefined),
  parent_name: z.string().max(120).optional().transform((v) => v || undefined),
  parent_phone: z.string().max(20).optional().transform((v) => v || undefined),
  joining_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(isRealYMD, "joining_date isn't a real calendar date")
    .optional()
    .transform((v) => v || undefined),
  // Optional — if present, the import also schedules an exam at this level
  // for each created rider. Skips the exam if no level is supplied. The
  // empty-string branch is required because a blank CSV cell arrives as ""
  // (not undefined); without it z.coerce turns "" into 0 and .min(1) rejects
  // the whole row, silently dropping riders who don't sit an exam.
  level: z.coerce.number().int().min(1).max(50).optional().or(z.literal("").transform(() => undefined)),
  // Optional batch NAME (not id — a spreadsheet holds "Tue 5pm Beginners",
  // never a cuid). Resolved against the target centre's batches below.
  //
  // Without this every imported rider arrived with no batch, and batch
  // membership is what the attendance register is built from — so a bulk
  // intake produced a roll of riders who could never be marked present, and
  // the only fix was editing each one by hand afterwards.
  batch: z.string().max(120).optional().transform((v) => v?.trim() || undefined),
});

const payloadSchema = z.object({
  // Either supply a CSV string OR a structured rows array. CSV path is the
  // primary flow; rows[] is for programmatic clients.
  csv: z.string().optional(),
  // The template we hand out, uploaded as-is. Avoids the "Save As → CSV" step
  // that silently rewrites every date to the machine's locale format and fails
  // the whole upload on DOB validation.
  xlsxBase64: z.string().max(20_000_000).optional(),
  rows: z.array(z.record(z.string())).optional(),
  // If true, the response includes what WOULD have been created but does
  // not write anything — used by the preview button before confirm.
  dryRun: z.boolean().default(false),
  // Optional examinerId — if supplied AND the row has a `level`, the import
  // also schedules an exam.
  examinerId: z.string().min(1).optional(),
});

// Header aliasing — CSV authors don't have to nail the exact column name.
// Maps "First Name", "firstname", etc. to the canonical row key.
const ALIASES: Record<string, string> = {
  firstname: "first_name",
  first: "first_name",
  fname: "first_name",
  given_name: "first_name",
  lastname: "last_name",
  last: "last_name",
  lname: "last_name",
  surname: "last_name",
  family_name: "last_name",
  phone: "mobile",
  mobile_number: "mobile",
  phone_number: "mobile",
  contact: "mobile",
  date_of_birth: "dob",
  birthdate: "dob",
  birthday: "dob",
  sex: "gender",
  joined: "joining_date",
  join_date: "joining_date",
  joining: "joining_date",
  level_number: "level",
  exam_level: "level",
};

function normaliseRow(raw: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    const canonical = ALIASES[k] ?? k;
    out[canonical] = (v ?? "").trim();
  }
  return out;
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!["SUPER_ADMIN", "CENTRE_MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  // Resolve target centre through the shared helper rather than by hand.
  //
  // The hand-rolled version read session.centreId, which is NULL for
  // SUPER_ADMIN — so an HQ admin, the person most likely to be loading a new
  // club's roll, got NO_CENTRE_CONTEXT and could not bulk upload at all. It
  // also accepted ?centreId= from a SUPER_ADMIN with no org check, so a
  // hand-crafted request could import riders into ANOTHER TENANT's centre.
  //
  // resolveWriteCentre() fixes both: it honours the top-bar centre picker
  // (via cookie, which rides along with the fetch), and fences the resolved
  // centre to the caller's own organisation. This is the invariant every
  // centre-scoped write route is supposed to use.
  const url = new URL(req.url);
  const resolved = await resolveWriteCentre(session, {
    centreId: url.searchParams.get("centreId") ?? undefined,
  });
  if (resolved.error) return resolved.error;
  const targetCentreId = resolved.centreId;

  // Parse input → rows array.
  let rawRows: Record<string, string>[] = [];
  let parseErrors: { line: number; reason: string }[] = [];
  if (parsed.data.xlsxBase64) {
    try {
      const r = await parseXlsx(Buffer.from(parsed.data.xlsxBase64, "base64"));
      rawRows = r.rows;
      parseErrors = r.errors;
    } catch {
      return NextResponse.json(
        {
          error: "BAD_XLSX",
          message: "That file couldn't be read as an Excel workbook. Re-save it as .xlsx, or export it to CSV and upload that.",
        },
        { status: 400 },
      );
    }
  } else if (parsed.data.csv) {
    const r = parseCsv(parsed.data.csv);
    rawRows = r.rows;
    parseErrors = r.errors;
  } else if (parsed.data.rows) {
    rawRows = parsed.data.rows;
  } else {
    return NextResponse.json({ error: "NO_INPUT", message: "Provide an .xlsx file, csv, or rows." }, { status: 400 });
  }

  // Pre-load existing mobiles + emails for the target centre so dedup is a
  // single round-trip instead of one query per row.
  const existing = await prisma.rider.findMany({
    where: { centreId: targetCentreId },
    select: { mobile: true, email: true, firstName: true, lastName: true, dob: true },
  });
  // Normalise BOTH sides of every comparison. The row's mobile goes through
  // indianMobile() (separators stripped, +91/0 dropped) while this set was
  // built from the raw column, so a stored "98123 45671" never matched an
  // incoming "9812345671" and real duplicates walked straight through.
  const normMobile = (m: string) => m.replace(/[\s()\-.]/g, "").replace(/^(?:\+?91|0)/, "");
  const existingMobile = new Set(existing.map((e) => normMobile(e.mobile)));
  const existingEmail = new Set(existing.filter((e) => e.email).map((e) => e.email!.toLowerCase()));
  // Identity of a PERSON, not of a phone. One household shares one number, so
  // claiming the bare mobile rejected the second sibling in the same sheet —
  // exactly the family a club is most likely to be importing. Matches the
  // public onboarding guard, which keys on centre + name + dob + mobile.
  const identity = (m: string, first: string, last: string, dob: string) =>
    `${normMobile(m)}|${first.trim().toLowerCase()}|${last.trim().toLowerCase()}|${dob}`;
  const existingIdentity = new Set(
    existing.map((e) => identity(e.mobile, e.firstName, e.lastName, e.dob.toISOString().slice(0, 10))),
  );

  const valid: { row: z.infer<typeof rowSchema>; line: number }[] = [];
  const rowErrors: { line: number; reason: string }[] = [];

  rawRows.forEach((raw, idx) => {
    const line = idx + 2; // +1 for 1-index, +1 for header row
    const norm = normaliseRow(raw);
    const r = rowSchema.safeParse(norm);
    if (!r.success) {
      rowErrors.push({ line, reason: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
      return;
    }
    const key = identity(r.data.mobile, r.data.first_name, r.data.last_name, r.data.dob);
    if (existingIdentity.has(key)) {
      rowErrors.push({
        line,
        reason: `Duplicate of an existing rider: ${r.data.first_name} ${r.data.last_name} (${r.data.mobile})`,
      });
      return;
    }
    const email = r.data.email?.toLowerCase();
    if (email && existingEmail.has(email)) {
      rowErrors.push({ line, reason: `Email already used: ${r.data.email}` });
      return;
    }
    // Claim the identity HERE, not just when the row is written. These sets
    // were only added to inside the create transaction, which runs after this
    // whole loop — so two identical lines in one spreadsheet both passed and
    // imported as two riders while the dry run reported "duplicates: 0".
    // Repeated rows are ordinary in a club's Excel sheet, which is exactly
    // what this endpoint exists to ingest.
    existingIdentity.add(key);
    if (email) existingEmail.add(email);
    valid.push({ row: r.data, line });
  });

  const batchNames = [...new Set(valid.map((v) => v.row.batch).filter(Boolean) as string[])];
  let unknownBatches: string[] = [];
  const batchByName = new Map<string, string>();
  if (batchNames.length > 0) {
    const found = await prisma.batch.findMany({
      where: { centreId: targetCentreId },
      select: { id: true, name: true },
    });
    for (const b of found) batchByName.set(b.name.trim().toLowerCase(), b.id);
    unknownBatches = batchNames.filter((n) => !batchByName.has(n.trim().toLowerCase()));
  }

  // An unmatched batch name used to reject the ENTIRE upload — one typo in row
  // 40 and all ninety riders were refused, with the club left to find the
  // offending cell by eye. That is a wildly disproportionate response to a
  // spelling mistake in an optional column.
  //
  // Now those riders import with no batch and the mismatched names are
  // reported, so the fix is assigning a batch to a handful of people (which
  // the Riders page does in bulk) instead of re-running the whole import.
  // Deliberately NOT fuzzy-matched: quietly putting a child in a class nobody
  // chose is worse than leaving them unassigned and saying so.

  if (parsed.data.dryRun) {
    return NextResponse.json({
      dryRun: true,
      wouldCreate: valid.length,
      duplicates: rowErrors.filter((e) => e.reason.startsWith("Duplicate") || e.reason.startsWith("Email")).length,
      errors: [...parseErrors, ...rowErrors],
      // Reported at PREVIEW time, which is the whole point of a preview —
      // finding out after the write that ninety riders have no batch is the
      // situation this is meant to prevent.
      unknownBatches,
      preview: valid.slice(0, 10).map(({ row, line }) => ({ line, ...row })),
    });
  }

  // Resolve batch names once. Matching is case/whitespace-insensitive because
  // the name is typed into a spreadsheet by hand; an unmatched name is reported
  // as a row error rather than silently importing the rider with no batch,
  // which is the failure this column exists to prevent.
  // Create in a single transaction so a mid-batch failure rolls everything
  // back. Schedule a per-rider exam if both `level` and a target examiner
  // are supplied.
  const result = await prisma.$transaction(async (tx) => {
    let created = 0;
    let examsScheduled = 0;
    for (const { row } of valid) {
      const rider = await tx.rider.create({
        data: {
          centreId: targetCentreId,
          firstName: row.first_name,
          lastName: row.last_name,
          mobile: row.mobile,
          email: row.email ?? null,
          dob: new Date(row.dob),
          gender: row.gender ?? null,
          school: row.school ?? null,
          schoolClass: row.school_class ?? null,
          schoolSection: row.school_section ?? null,
          fatherName: row.parent_name ?? null,
          fatherPhone: row.parent_phone ?? null,
          // Parked in the consent blob, which is where consentRecipient() and
          // consentPhone() already look — so an imported parent address is
          // immediately usable for the signing link without a second migration.
          parentalConsentJson: row.parent_email || row.parent_phone || row.parent_name
            ? { parentName: row.parent_name ?? null, parentEmail: row.parent_email ?? null, parentPhone: row.parent_phone ?? null, source: "bulk_import" }
            : undefined,
          joiningDate: row.joining_date ? new Date(row.joining_date) : new Date(),
          batchId: row.batch ? batchByName.get(row.batch.trim().toLowerCase()) ?? null : null,
          status: "active",
        },
      });
      existingMobile.add(row.mobile);
      if (row.email) existingEmail.add(row.email);
      created++;

      if (row.level && parsed.data.examinerId) {
        const examiner = await tx.user.findUnique({ where: { id: parsed.data.examinerId } });
        if (examiner && examiner.status === "active") {
          await tx.exam.create({
            data: {
              centreId: targetCentreId,
              riderId: rider.id,
              examinerId: examiner.id,
              examinerName: examiner.name,
              level: row.level,
              date: new Date(),
              status: "scheduled",
            },
          });
          examsScheduled++;
        }
      }
    }
    return { created, examsScheduled };
  });

  await audit({
    userId: session.userId,
    action: "rider.import",
    tableName: "rider",
    rowId: targetCentreId,
    after: { created: result.created, examsScheduled: result.examsScheduled, errors: rowErrors.length },
  });

  return NextResponse.json({
    created: result.created,
    examsScheduled: result.examsScheduled,
    errors: [...parseErrors, ...rowErrors],
    unknownBatches,
  });
}
