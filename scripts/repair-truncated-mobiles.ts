// Repair mobile numbers cut to 8 digits by the old indianMobile() normaliser.
//
// Until 2026-09-29 a bare 10-digit mobile starting with "91" (a real series,
// e.g. 9100014662) had its first two digits stripped as if they were the
// country code, so "9100014662" was stored as "00014662". A valid Indian
// mobile is 10 digits starting 6-9, so an 8-digit value in these columns is
// almost certainly one of those — restoring it means putting "91" back.
//
// "Almost": parent phone columns filled by bulk import accept free text, so an
// 8-digit LANDLINE typed there would look the same. That is why this script
// only LISTS by default. Review the list, then run with --apply.
//
//   npx tsx scripts/repair-truncated-mobiles.ts            # dry run: list
//   npx tsx scripts/repair-truncated-mobiles.ts --apply    # restore "91"
//
// It targets whatever DATABASE_URL points at — check it before --apply.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");
const EIGHT = "^[0-9]{8}$";

async function main() {
  const host = (process.env.DATABASE_URL ?? "").replace(/\/\/[^@]*@/, "//***@");
  console.log(`${apply ? "APPLYING to" : "Dry run against"} ${host}\n`);

  const riderCols = ["mobile", "fatherPhone", "motherPhone"] as const;
  let total = 0;
  for (const col of riderCols) {
    const rows = await prisma.$queryRawUnsafe<{ id: string; name: string; v: string }[]>(
      `SELECT id, "firstName" || ' ' || "lastName" AS name, "${col}" AS v FROM "Rider" WHERE "${col}" ~ '${EIGHT}' ORDER BY name`,
    );
    total += rows.length;
    for (const r of rows) console.log(`Rider.${col.padEnd(11)} ${r.name.padEnd(28)} ${r.v} → 91${r.v}`);
    if (apply && rows.length) {
      await prisma.$executeRawUnsafe(`UPDATE "Rider" SET "${col}" = '91' || "${col}" WHERE "${col}" ~ '${EIGHT}'`);
    }
  }
  const consent = await prisma.$queryRawUnsafe<{ id: string; name: string; v: string }[]>(
    `SELECT id, "firstName" || ' ' || "lastName" AS name, "parentalConsentJson"->>'parentPhone' AS v FROM "Rider" WHERE "parentalConsentJson"->>'parentPhone' ~ '${EIGHT}'`,
  );
  total += consent.length;
  for (const r of consent) console.log(`Rider.parentalConsent.parentPhone ${r.name.padEnd(28)} ${r.v} → 91${r.v}`);
  if (apply && consent.length) {
    await prisma.$executeRawUnsafe(
      `UPDATE "Rider" SET "parentalConsentJson" = jsonb_set("parentalConsentJson", '{parentPhone}', to_jsonb('91' || ("parentalConsentJson"->>'parentPhone'))) WHERE "parentalConsentJson"->>'parentPhone' ~ '${EIGHT}'`,
    );
  }
  const users = await prisma.$queryRawUnsafe<{ id: string; name: string; v: string; role: string }[]>(
    `SELECT id, name, phone AS v, role FROM "User" WHERE phone ~ '${EIGHT}' ORDER BY name`,
  );
  total += users.length;
  for (const u of users) console.log(`User.phone        ${`${u.name} (${u.role})`.padEnd(28)} ${u.v} → 91${u.v}`);
  if (apply && users.length) {
    await prisma.$executeRawUnsafe(`UPDATE "User" SET phone = '91' || phone WHERE phone ~ '${EIGHT}'`);
  }
  console.log(`\n${total} value(s) ${apply ? "restored" : "would be restored — re-run with --apply after reviewing"}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
