import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { parseCsv } from "@/lib/csv-parse";

// Bulk horse import. Mirrors the riders import flow.
// Accepts either a CSV string or a structured rows array.
// dryRun=true previews without writing.
//
// Accepted column aliases (case-insensitive, snake / camel both ok):
//   name (required)
//   stable_no / stableNo
//   breed
//   sex / gender — m/male, f/female (mapped to gelding/mare/stallion when sex given verbatim)
//   age_years / age
//   height_in / heightIn (inches) — legacy height_hh / heightHh (hands) accepted + converted
//   ownership — club | private
//   microchip
//   insurer / insurance_policy_no / insurance_valid_from / insurance_valid_to / insurance_premium

const rowSchema = z.object({
  name: z.string().min(1).max(80),
  stable_no: z.string().max(40).optional().transform((v) => v?.trim() || undefined),
  breed: z.string().max(60).optional().transform((v) => v?.trim() || undefined),
  sex: z.string().max(20).optional().transform((v) => {
    const t = (v ?? "").trim().toLowerCase();
    if (!t) return undefined;
    if (["m", "male", "gelding"].includes(t)) return "gelding";
    if (["f", "female", "mare"].includes(t)) return "mare";
    if (["stallion", "s"].includes(t)) return "stallion";
    return t;
  }),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD").optional(),
  age_years: z.coerce.number().int().min(0).max(50).optional(),
  height_in: z.coerce.number().min(30).max(90).optional(),
  // Legacy hands column — old import templates keep working; converted to
  // inches at create time (hand notation is base-4: 15.1 hh = 15h 1in = 61 in).
  height_hh: z.coerce.number().min(8).max(20).optional(),
  ownership: z.string().optional().transform((v) => {
    const t = (v ?? "").trim().toLowerCase();
    if (!t) return undefined;
    return t === "private" ? "private" : "club";
  }),
  microchip: z.string().max(40).optional().transform((v) => v?.trim() || undefined),
  insurer: z.string().max(80).optional().transform((v) => v?.trim() || undefined),
  insurance_policy_no: z.string().max(60).optional().transform((v) => v?.trim() || undefined),
  insurance_premium: z.coerce.number().min(0).optional(),
  insurance_valid_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  insurance_valid_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const payloadSchema = z.object({
  csv: z.string().optional(),
  rows: z.array(z.record(z.string())).optional(),
  dryRun: z.boolean().default(false),
});

// Permissive header aliasing — accept hyphens, spaces, camel, snake.
function normaliseKey(k: string) {
  return k.trim().toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");
}
function aliasRow(row: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    const n = normaliseKey(k);
    // Camel-case → snake_case alternatives.
    out[n] = v;
    if (n === "stableno") out["stable_no"] = v;
    if (n === "ageyears") out["age_years"] = v;
    if (n === "dateofbirth" || n === "dob") out["dob"] = v;
    if (n === "heighthh") out["height_hh"] = v;
    if (n === "heightin") out["height_in"] = v;
    if (n === "policyno") out["insurance_policy_no"] = v;
    if (n === "validfrom") out["insurance_valid_from"] = v;
    if (n === "validto") out["insurance_valid_to"] = v;
    if (n === "premium") out["insurance_premium"] = v;
  }
  return out;
}

// 15.1 hh = 15 hands + 1 inch (hand notation is base-4, one hand = 4 in).
function handsToInches(hh: number): number {
  return Math.floor(hh) * 4 + Math.round((hh - Math.floor(hh)) * 10);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "horse.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnly = await blockIfReadOnly(session);
  if (readOnly) return readOnly;
  if (!session.centreId) return NextResponse.json({ error: "NO_CENTRE" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });

  // Resolve rows from either CSV or the structured array path.
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
  if (rawRows.length > 1000) {
    return NextResponse.json({ error: "TOO_MANY_ROWS", details: "Cap is 1000 rows per import." }, { status: 400 });
  }

  // Per-row validation. We collect failures so the caller can show line-
  // by-line errors instead of bailing on the first bad row.
  const valid: Array<{ idx: number; data: z.infer<typeof rowSchema> }> = [];
  const failures: Array<{ idx: number; errors: string[] }> = [];
  rawRows.forEach((raw, i) => {
    const aliased = aliasRow(raw);
    const r = rowSchema.safeParse(aliased);
    if (r.success) valid.push({ idx: i + 1, data: r.data });
    else failures.push({ idx: i + 1, errors: r.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`) });
  });

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

  // Insert in a transaction so a mid-batch failure doesn't leave the
  // operator with a half-imported list.
  const result = await prisma.$transaction(
    valid.map((v) =>
      prisma.horse.create({
        data: {
          centreId: session.centreId!,
          name: v.data.name,
          stableNo: v.data.stable_no ?? null,
          breed: v.data.breed ?? null,
          sex: v.data.sex ?? null,
          dob: v.data.dob ? new Date(v.data.dob) : null,
          ageYears: v.data.age_years ?? null,
          heightIn: v.data.height_in ?? (v.data.height_hh != null ? handsToInches(v.data.height_hh) : null),
          ownership: v.data.ownership ?? "club",
          microchip: v.data.microchip ?? null,
          insurerName: v.data.insurer ?? null,
          insurancePolicyNo: v.data.insurance_policy_no ?? null,
          insurancePremium: v.data.insurance_premium ?? null,
          insuranceValidFrom: v.data.insurance_valid_from ? new Date(v.data.insurance_valid_from) : null,
          insuranceValidTo: v.data.insurance_valid_to ? new Date(v.data.insurance_valid_to) : null,
        },
        select: { id: true, name: true },
      }),
    ),
  );

  await audit({
    userId: session.userId,
    action: "horses.bulk_imported",
    tableName: "horse",
    rowId: session.centreId,
    after: { count: result.length },
  });

  return NextResponse.json({ ok: true, created: result.length, ids: result.map((r) => r.id) });
}
