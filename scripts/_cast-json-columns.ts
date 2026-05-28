// One-shot migration: cast every *Json column from text to jsonb in place.
// We pre-validated 37/37 live rows parse cleanly, so the USING ::jsonb cast
// is lossless. Without this script, Prisma's db push would drop+recreate any
// column with data (it can't guess that text values are valid JSON), wiping
// nullable columns and refusing on required ones.
//
// Idempotent: skips columns already typed as jsonb. Safe to re-run.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// (table, column) tuples — mirror the schema's *Json fields (Vendor.categorySpecificJson
// already migrated in the pilot, so we leave it off this list; re-running won't
// hurt it but there's no need).
const COLUMNS: Array<[string, string]> = [
  ["PlatformUser", "totpRecoveryCodesJson"],
  ["Centre", "emergencyContactsJson"],
  ["User", "totpRecoveryCodesJson"],
  ["User", "notifPrefsJson"],
  ["Rider", "parentalConsentJson"],
  ["Staff", "kycDocsJson"],
  ["InjuryLog", "treatmentJson"],
  ["FeedPlan", "rationsJson"],
  ["Competition", "classesJson"],
  ["CompetitionEntry", "roundsJson"],
  ["DressageTest", "movementsJson"],
  ["DressageTest", "collectiveMarksJson"],
  ["DressageScoresheet", "marksJson"],
  ["DressageScoresheet", "collectiveMarksJson"],
  ["ExamLevel", "defaultRubricJson"],
  ["ScoringTemplate", "categoriesJson"],
  ["Exam", "scoresJson"],
  ["Exam", "supportStaffJson"],
  ["ExamJudge", "scoresJson"],
  ["ShortLink", "paramsJson"],
  ["Requisition", "itemsJson"],
  ["SalaryPayment", "deductionBreakdownJson"],
  ["PayrollConfig", "deductionRulesJson"],
];

async function isAlreadyJsonb(table: string, column: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ data_type: string }>>(
    `SELECT data_type FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    table,
    column,
  );
  return rows[0]?.data_type === "jsonb";
}

async function castColumn(table: string, column: string, defaultJson?: string) {
  if (await isAlreadyJsonb(table, column)) {
    console.log(`[skip] ${table}.${column} already jsonb`);
    return;
  }
  // Columns with a text default ('{}'-style) can't be auto-cast — Postgres
  // can't translate the existing default expression. Drop the default first,
  // cast the type, then re-set the default in jsonb form.
  if (defaultJson) {
    console.log(`[cast] ${table}.${column} (drop default → cast → re-set default) ...`);
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "${table}" ALTER COLUMN "${column}" DROP DEFAULT;`,
    );
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE jsonb USING "${column}"::jsonb;`,
    );
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "${table}" ALTER COLUMN "${column}" SET DEFAULT '${defaultJson}'::jsonb;`,
    );
    console.log(`[cast] ${table}.${column} OK`);
    return;
  }
  const sql = `ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE jsonb USING "${column}"::jsonb;`;
  console.log(`[cast] ${table}.${column} ...`);
  await prisma.$executeRawUnsafe(sql);
  console.log(`[cast] ${table}.${column} OK`);
}

// Columns whose schema declared @default("…"). We pass the default through
// so the cast helper can recreate it in jsonb form.
const DEFAULTS: Record<string, string> = {
  "PayrollConfig.deductionRulesJson": "{}",
};

async function main() {
  for (const [t, c] of COLUMNS) {
    try {
      await castColumn(t, c, DEFAULTS[`${t}.${c}`]);
    } catch (e) {
      console.error(`[fail] ${t}.${c}:`, (e as Error).message);
      throw e;
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
