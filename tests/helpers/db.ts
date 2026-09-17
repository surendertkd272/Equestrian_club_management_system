// Test-DB helpers. Use these in beforeEach for any suite that touches Prisma.
//
// `resetDb()` wipes every row via a single TRUNCATE ... CASCADE over all public
// tables. This is order-independent (CASCADE follows FKs) and future-proof — a
// newly-added model is cleaned automatically, with no maintenance here. The old
// hand-ordered deleteMany() list silently rotted: it was missing ~40 newer
// tables (SalaryPayment, Event, Expense, Checklist*, …), so once the auth-
// importing integration tests could actually load (see tests/setup.ts), their
// beforeEach hit "Foreign key constraint violated" deleting Users still
// referenced by the un-deleted tables.

import { prisma } from "@/lib/prisma";

export async function resetDb(): Promise<void> {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE '\\_prisma%'`;
  if (rows.length === 0) return;

  const list = rows.map((r) => `"${r.tablename}"`).join(", ");
  // RESTART IDENTITY resets any sequences; CASCADE handles every FK order.
  //
  // Naming every table explicitly rather than truncating only the non-empty
  // ones. That was tried, on the theory that TRUNCATE cost scales with table
  // count — but truncating the few tables that hold rows CASCADEs to almost
  // every other one anyway (everything hangs off Organisation and Centre), and
  // benchmarking the two put them within noise of each other at ~0.3s. The
  // 30s+ reset that prompted the idea was machine load, not table count, so
  // the fix belongs in hookTimeout (see vitest.config.ts) and this stays the
  // simpler statement.
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}
