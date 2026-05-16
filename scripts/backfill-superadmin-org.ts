// Backfill User.orgId for SUPER_ADMIN rows that pre-date the explicit
// HQ-user → organisation binding. For each SUPER_ADMIN with orgId=null,
// infer the org by joining through any centre that shares an orgId. If
// exactly one org is found, set it; otherwise log and skip so we don't
// silently mis-bind a multi-org SUPER_ADMIN.
//
// Idempotent: re-running over already-backfilled rows is a no-op.
// Safe in dev; SQLite-only guard mirrors the other one-shot scripts.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.startsWith("file:") && process.env.ALLOW_NON_SQLITE !== "1") {
    throw new Error(
      `Refusing to run against non-SQLite DATABASE_URL. Set ALLOW_NON_SQLITE=1 to bypass.`,
    );
  }

  const candidates = await prisma.user.findMany({
    where: { role: "SUPER_ADMIN", orgId: null },
    select: { id: true, email: true },
  });
  console.log(`Found ${candidates.length} SUPER_ADMIN row(s) needing backfill.`);

  let updated = 0;
  let ambiguous = 0;
  let none = 0;

  for (const u of candidates) {
    // Heuristic: find orgs whose centres the user might "own". We have no
    // direct link, so we look for orgs whose creation predates the user
    // (or vice-versa) — but the simplest pragmatic rule that matches the
    // existing single-org-per-SUPER_ADMIN deployment is "if there is
    // exactly one Organisation in the table, use that". Anything more
    // complex risks mis-binding.
    const orgs = await prisma.organisation.findMany({ select: { id: true, name: true } });
    if (orgs.length === 0) {
      none += 1;
      console.log(`  · ${u.email}: no Organisations to bind to. Skipped.`);
      continue;
    }
    if (orgs.length > 1) {
      ambiguous += 1;
      console.log(
        `  · ${u.email}: ${orgs.length} orgs in DB — ambiguous, refusing to guess. Set orgId manually.`,
      );
      continue;
    }
    await prisma.user.update({ where: { id: u.id }, data: { orgId: orgs[0]!.id } });
    updated += 1;
    console.log(`  · ${u.email} → org ${orgs[0]!.name} (${orgs[0]!.id})`);
  }

  console.log(`\nDone. updated=${updated}, ambiguous=${ambiguous}, none=${none}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
