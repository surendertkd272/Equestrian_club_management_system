import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession, hashPassword } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { resolveWriteCentre } from "@/lib/resolve-centre";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { parseCsv } from "@/lib/csv-parse";
import { parseXlsx } from "@/lib/xlsx-parse";
import { isRealYMD } from "@/lib/utils";
import { indianMobile } from "@/lib/schemas/phone";
import { normalizeEmail } from "@/lib/email-normalize";
import { ASSIGNABLE_STAFF_ROLES } from "@/lib/schemas/staff";
import { storeIssuedCredential } from "@/lib/issued-credential";

// Bulk staff intake — the counterpart to /api/riders/import.
//
// Riders have had a bulk upload for a long time; staff never did, so a club
// opening with twenty coaches, grooms and office staff had to be typed in one
// form at a time. That is the moment a centre goes live, which is exactly when
// nobody has an afternoon to spare.
//
// Deliberately NOT a copy of the rider importer in one respect: there is no
// password column. See PASSWORDS below.

const roleAliases: Record<string, string> = {
  centre_manager: "CENTRE_MANAGER",
  center_manager: "CENTRE_MANAGER",
  manager: "CENTRE_MANAGER",
  head_coach: "HEAD_COACH",
  senior_coach: "HEAD_COACH",
  coach: "COACH",
  instructor: "COACH",
  trainer: "COACH",
  stable_manager: "STABLE_MANAGER",
  inventory_manager: "INVENTORY_MANAGER",
  storekeeper: "INVENTORY_MANAGER",
  groom: "GROOM",
  syce: "GROOM",
  farrier: "FARRIER",
  blacksmith: "FARRIER",
  vet: "VET",
  veterinarian: "VET",
  veterinary_doctor: "VET",
  accountant: "ACCOUNTANT",
  accounts: "ACCOUNTANT",
  school_administrator: "SCHOOL_ADMINISTRATOR",
  school_admin: "SCHOOL_ADMINISTRATOR",
};

/**
 * Resolve a spreadsheet role cell to a canonical role.
 *
 * Case and separators are normalised first ("Head Coach", "head-coach" and
 * "HEAD_COACH" are the same answer), then the alias table catches the words
 * clubs actually use — a stable's "syce" is the system's GROOM. Unmatched
 * returns null and the row is rejected by name: silently defaulting an
 * unrecognised job title to COACH would hand somebody a coach's access to
 * children's records.
 */
function resolveRole(raw: string): string | null {
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!key) return null;
  const upper = key.toUpperCase();
  if (ASSIGNABLE_STAFF_ROLES.includes(upper)) return upper;
  const aliased = roleAliases[key];
  if (aliased && ASSIGNABLE_STAFF_ROLES.includes(aliased)) return aliased;
  return null;
}

const rowSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(80),
  // Staff sign in; riders often don't. So unlike the rider sheet this column is
  // required — a staff row with no email creates an account nobody can log into,
  // which is the whole point of creating it.
  email: z
    .string()
    .trim()
    .email("Not a valid email address")
    .max(200)
    .transform(normalizeEmail),
  role: z
    .string()
    .min(1, "Role is required")
    .transform((v, ctx) => {
      const resolved = resolveRole(v);
      if (!resolved) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown role "${v.trim()}". Allowed: ${ASSIGNABLE_STAFF_ROLES.join(", ")}`,
        });
        return z.NEVER;
      }
      return resolved;
    }),
  // Same rule as every other capture path in the app, so a number that imports
  // is a number the SMS password-reset fallback can actually reach.
  phone: indianMobile("Not a valid Indian mobile number")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  salary_band: z.string().max(60).optional().transform((v) => v?.trim() || undefined),
  joining_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "joining_date must be YYYY-MM-DD")
    .refine(isRealYMD, "joining_date isn't a real calendar date")
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

const payloadSchema = z.object({
  csv: z.string().optional(),
  xlsxBase64: z.string().max(20_000_000).optional(),
  rows: z.array(z.record(z.string())).optional(),
  dryRun: z.boolean().default(false),
});

const ALIASES: Record<string, string> = {
  full_name: "name",
  staff_name: "name",
  employee_name: "name",
  fullname: "name",
  email_address: "email",
  mail: "email",
  designation: "role",
  job_title: "role",
  position: "role",
  mobile: "phone",
  mobile_number: "phone",
  phone_number: "phone",
  contact: "phone",
  salary: "salary_band",
  band: "salary_band",
  salary_grade: "salary_band",
  doj: "joining_date",
  date_of_joining: "joining_date",
  joined: "joining_date",
  joining: "joining_date",
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
  // Same permission that guards Add Staff — one gate, so bulk can never be a
  // way around the single-record check.
  if (!can(session.role, "staff.manage")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  // The HQ write-centre invariant: session.centreId is NULL for SUPER_ADMIN /
  // ADMIN, so reading it directly locks out precisely the people who set a new
  // club up. resolveWriteCentre honours the top-bar picker and fences the
  // result to the caller's own organisation.
  const url = new URL(req.url);
  const resolved = await resolveWriteCentre(session, {
    centreId: url.searchParams.get("centreId") ?? undefined,
  });
  if (resolved.error) return resolved.error;
  const targetCentreId = resolved.centreId;

  let rawRows: Record<string, string>[] = [];
  let parseErrors: { line: number; reason: string }[] = [];
  if (parsed.data.xlsxBase64) {
    try {
      const r = await parseXlsx(Buffer.from(parsed.data.xlsxBase64, "base64"), "Staff");
      rawRows = r.rows;
      parseErrors = r.errors;
    } catch {
      return NextResponse.json(
        {
          error: "BAD_XLSX",
          message:
            "That file couldn't be read as an Excel workbook. Re-save it as .xlsx, or export it to CSV and upload that.",
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

  // Email uniqueness on User is GLOBAL, not per-centre — a login identity is
  // one person across the whole platform. So the dedup set has to be global
  // too: scoping it to this centre would let a row sail through validation and
  // then blow up on the unique index halfway through the write, rolling back
  // rows the operator had already been told were fine.
  const emails = [
    ...new Set(
      rawRows
        .map((r) => normaliseRow(r).email)
        .filter(Boolean)
        .map((e) => normalizeEmail(e)),
    ),
  ];
  const taken = emails.length
    ? await prisma.user.findMany({ where: { email: { in: emails } }, select: { email: true } })
    : [];
  const takenEmails = new Set(taken.map((u) => u.email));

  const valid: { row: z.infer<typeof rowSchema>; line: number }[] = [];
  const rowErrors: { line: number; reason: string }[] = [];

  rawRows.forEach((raw, idx) => {
    const line = idx + 2; // +1 for 1-index, +1 for the header row
    const norm = normaliseRow(raw);
    const r = rowSchema.safeParse(norm);
    if (!r.success) {
      rowErrors.push({
        line,
        reason: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      });
      return;
    }
    if (takenEmails.has(r.data.email)) {
      rowErrors.push({ line, reason: `Email already in use: ${r.data.email}` });
      return;
    }
    // Claim it now, not at write time. A spreadsheet listing the same person
    // twice is ordinary; without claiming here both copies pass validation and
    // the second one dies on the unique index mid-transaction.
    takenEmails.add(r.data.email);
    valid.push({ row: r.data, line });
  });

  if (parsed.data.dryRun) {
    return NextResponse.json({
      dryRun: true,
      wouldCreate: valid.length,
      duplicates: rowErrors.filter((e) => e.reason.startsWith("Email already")).length,
      errors: [...parseErrors, ...rowErrors],
      preview: valid.slice(0, 10).map(({ row, line }) => ({
        line,
        name: row.name,
        email: row.email,
        role: row.role,
        phone: row.phone ?? "",
        salary_band: row.salary_band ?? "",
        joining_date: row.joining_date ?? "",
      })),
    });
  }

  // PASSWORDS — generated here, never read from the sheet.
  //
  // A password column would put every new hire's credential in plaintext in a
  // file that gets emailed around and left in Downloads. Instead each row gets
  // an unguessable random string, and it is kept encrypted-at-rest via
  // storeIssuedCredential so the Credential Sheet can reprint it for handover.
  // That is exactly the case issuedPasswordEnc was built for: a system-
  // generated single-use string, not a human-chosen one.
  //
  // Hashed OUTSIDE the transaction, and this is not a style preference. bcrypt
  // at cost 10 is ~100ms; thirty rows is three seconds of pure CPU, which on
  // its own exceeds Prisma's 5s interactive-transaction budget and would roll
  // the whole import back with a timeout that looks like a database fault.
  const withSecrets = await Promise.all(
    valid.map(async ({ row }) => {
      const plain = crypto.randomBytes(12).toString("base64url");
      return { row, plain, passwordHash: await hashPassword(plain) };
    }),
  );

  const result = await prisma.$transaction(async (tx) => {
    let created = 0;
    for (const { row, plain, passwordHash } of withSecrets) {
      const user = await tx.user.create({
        data: {
          email: row.email,
          // Admin-created, so the admin vouches for the address — same stance
          // as Add Staff. Without this they would be stuck at a verification
          // wall for an address the club supplied itself.
          emailVerifiedAt: new Date(),
          name: row.name,
          phone: row.phone ?? null,
          role: row.role,
          centreId: targetCentreId,
          passwordHash,
          status: "active",
        },
      });
      await tx.staff.create({
        data: {
          centreId: targetCentreId,
          userId: user.id,
          role: row.role,
          salaryBand: row.salary_band ?? null,
          ...(row.joining_date ? { joiningDate: new Date(row.joining_date) } : {}),
          status: "active",
        },
      });
      await storeIssuedCredential(tx, user.id, plain, session.userId);
      created++;
    }
    return { created };
  });

  await audit({
    userId: session.userId,
    action: "staff.import",
    tableName: "staff",
    rowId: targetCentreId,
    after: { created: result.created, errors: rowErrors.length },
  });

  return NextResponse.json({
    created: result.created,
    errors: [...parseErrors, ...rowErrors],
  });
}
