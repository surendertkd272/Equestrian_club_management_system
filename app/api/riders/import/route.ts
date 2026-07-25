import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { parseCsv } from "@/lib/csv-parse";
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
});

const payloadSchema = z.object({
  // Either supply a CSV string OR a structured rows array. CSV path is the
  // primary flow; rows[] is for programmatic clients.
  csv: z.string().optional(),
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

  // Resolve target centre.
  const centreId = session.centreId;
  if (!centreId && session.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "NO_CENTRE_CONTEXT" }, { status: 400 });
  }
  // SUPER_ADMIN can pass ?centreId= as a query param if they want a
  // different target — checked below.
  const url = new URL(req.url);
  const targetCentreId =
    session.role === "SUPER_ADMIN" ? url.searchParams.get("centreId") ?? centreId ?? "" : centreId!;
  if (!targetCentreId) {
    return NextResponse.json({ error: "NO_CENTRE_CONTEXT" }, { status: 400 });
  }

  // Parse input → rows array.
  let rawRows: Record<string, string>[] = [];
  let parseErrors: { line: number; reason: string }[] = [];
  if (parsed.data.csv) {
    const r = parseCsv(parsed.data.csv);
    rawRows = r.rows;
    parseErrors = r.errors;
  } else if (parsed.data.rows) {
    rawRows = parsed.data.rows;
  } else {
    return NextResponse.json({ error: "NO_INPUT", message: "Provide csv or rows." }, { status: 400 });
  }

  // Pre-load existing mobiles + emails for the target centre so dedup is a
  // single round-trip instead of one query per row.
  const existing = await prisma.rider.findMany({
    where: { centreId: targetCentreId },
    select: { mobile: true, email: true },
  });
  const existingMobile = new Set(existing.map((e) => e.mobile));
  const existingEmail = new Set(existing.filter((e) => e.email).map((e) => e.email!));

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
    if (existingMobile.has(r.data.mobile)) {
      rowErrors.push({ line, reason: `Mobile already used: ${r.data.mobile}` });
      return;
    }
    if (r.data.email && existingEmail.has(r.data.email)) {
      rowErrors.push({ line, reason: `Email already used: ${r.data.email}` });
      return;
    }
    // Claim the mobile/email HERE, not just when the row is written. These
    // sets were only added to inside the create transaction, which runs after
    // this whole loop — so two identical lines in one spreadsheet both passed
    // validation and imported as two riders, while the dry run cheerfully
    // reported "duplicates: 0". Repeated rows are ordinary in a club's Excel
    // sheet, which is exactly what this endpoint exists to ingest.
    existingMobile.add(r.data.mobile);
    if (r.data.email) existingEmail.add(r.data.email);
    valid.push({ row: r.data, line });
  });

  if (parsed.data.dryRun) {
    return NextResponse.json({
      dryRun: true,
      wouldCreate: valid.length,
      duplicates: rowErrors.filter((e) => e.reason.startsWith("Mobile") || e.reason.startsWith("Email")).length,
      errors: [...parseErrors, ...rowErrors],
      preview: valid.slice(0, 10).map(({ row, line }) => ({ line, ...row })),
    });
  }

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
          joiningDate: row.joining_date ? new Date(row.joining_date) : new Date(),
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
  });
}
