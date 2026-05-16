import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getSession, hashPassword } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { isRole } from "@/lib/roles";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { parseCsv } from "@/lib/csv-parse";

// Bulk staff import. Creates a User per row + a linked Staff row.
// Each user gets a temp password (printed in the response) and
// mustChangePassword=true so first sign-in forces a rotation.
//
// Accepted columns (case-insensitive):
//   name (required)
//   email (required, unique across users)
//   phone
//   role — see lib/roles.ts (COACH/HEAD_COACH/VET/GROOM/ACCOUNTANT/STABLE_MANAGER/etc.)
//   joining_date (YYYY-MM-DD)
//   salary_band

const rowSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  phone: z.string().max(20).optional().transform((v) => v?.trim() || undefined),
  role: z.string().transform((v) => v.trim().toUpperCase()),
  joining_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  salary_band: z.string().max(40).optional().transform((v) => v?.trim() || undefined),
});

const payloadSchema = z.object({
  csv: z.string().optional(),
  rows: z.array(z.record(z.string())).optional(),
  dryRun: z.boolean().default(false),
});

function normaliseKey(k: string) {
  return k.trim().toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");
}
function aliasRow(row: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    const n = normaliseKey(k);
    out[n] = v;
    if (n === "joiningdate") out["joining_date"] = v;
    if (n === "salaryband") out["salary_band"] = v;
  }
  return out;
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "staff.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnly = await blockIfReadOnly(session);
  if (readOnly) return readOnly;
  if (!session.centreId) return NextResponse.json({ error: "NO_CENTRE" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });

  let rawRows: Record<string, string>[] = parsed.data.rows ?? [];
  const parseErrors: { line: number; reason: string }[] = [];
  if (parsed.data.csv) {
    const r = parseCsv(parsed.data.csv);
    rawRows = r.rows;
    parseErrors.push(...r.errors);
  }
  if (rawRows.length === 0) {
    return NextResponse.json({ error: "EMPTY_PAYLOAD", parseErrors }, { status: 400 });
  }
  if (rawRows.length > 500) {
    return NextResponse.json({ error: "TOO_MANY_ROWS", details: "Cap is 500 staff per import." }, { status: 400 });
  }

  const valid: Array<{ idx: number; data: z.infer<typeof rowSchema> }> = [];
  const failures: Array<{ idx: number; errors: string[] }> = [];

  rawRows.forEach((raw, i) => {
    const aliased = aliasRow(raw);
    const r = rowSchema.safeParse(aliased);
    if (!r.success) {
      failures.push({ idx: i + 1, errors: r.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`) });
      return;
    }
    if (!isRole(r.data.role) || r.data.role === "SUPER_ADMIN" || r.data.role === "PARENT" || r.data.role === "RIDER") {
      failures.push({ idx: i + 1, errors: [`role: invalid or non-staff role "${r.data.role}"`] });
      return;
    }
    valid.push({ idx: i + 1, data: r.data });
  });

  // Cross-row dedup + DB email uniqueness check.
  const emails = valid.map((v) => v.data.email.toLowerCase());
  const dupes = emails.filter((e, i) => emails.indexOf(e) !== i);
  if (dupes.length > 0) {
    return NextResponse.json({ error: "DUPLICATE_EMAILS_IN_PAYLOAD", details: [...new Set(dupes)] }, { status: 400 });
  }
  if (emails.length > 0) {
    const existing = await prisma.user.findMany({
      where: { email: { in: emails } },
      select: { email: true },
    });
    if (existing.length > 0) {
      return NextResponse.json(
        { error: "EMAILS_ALREADY_REGISTERED", details: existing.map((e) => e.email) },
        { status: 409 },
      );
    }
  }

  if (parsed.data.dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      validCount: valid.length,
      failureCount: failures.length,
      failures,
      parseErrors,
    });
  }
  if (failures.length > 0) {
    return NextResponse.json({ error: "VALIDATION_ROWS", failures, parseErrors }, { status: 400 });
  }

  // Create user + staff in pairs. Each user gets a one-shot temp
  // password — the operator gets these back to share once and never
  // again (we hash + never store plaintext).
  const created: Array<{ id: string; email: string; tempPassword: string }> = [];
  for (const v of valid) {
    const tempPassword = crypto.randomBytes(12).toString("base64url");
    const passwordHash = await hashPassword(tempPassword);
    const user = await prisma.user.create({
      data: {
        name: v.data.name,
        email: v.data.email,
        phone: v.data.phone ?? null,
        role: v.data.role,
        centreId: session.centreId,
        passwordHash,
        mustChangePassword: true,
        status: "active",
      },
    });
    await prisma.staff.create({
      data: {
        centreId: session.centreId,
        userId: user.id,
        role: v.data.role,
        joiningDate: v.data.joining_date ? new Date(v.data.joining_date) : new Date(),
        salaryBand: v.data.salary_band ?? null,
      },
    });
    created.push({ id: user.id, email: user.email, tempPassword });
  }

  await audit({
    userId: session.userId,
    action: "staff.bulk_imported",
    tableName: "staff",
    rowId: session.centreId,
    after: { count: created.length, emails: created.map((c) => c.email) },
  });

  return NextResponse.json({ ok: true, created });
}
