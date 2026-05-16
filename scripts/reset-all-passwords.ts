// One-shot dev helper: reset every tenant User + PlatformUser (owner team)
// to a known password. Convenient for local testing across many seeded
// accounts; never run this against a production database.

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const TARGET = process.argv[2] ?? "1234";
const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run with NODE_ENV=production");
  }
  // Belt-and-braces: also refuse if DATABASE_URL isn't a local SQLite
  // file. NODE_ENV could be unset; the URL is the hard truth.
  const url = process.env.DATABASE_URL ?? "";
  if (!url.startsWith("file:")) {
    throw new Error(
      `Refusing to run against non-SQLite DATABASE_URL (${url.slice(0, 30)}…).`,
    );
  }
  const hash = await bcrypt.hash(TARGET, 10);

  // Tenant users — clear mustChangePassword so the rotation gate doesn't
  // redirect users straight to /account/rotate on first sign-in.
  const u = await prisma.user.updateMany({
    data: { passwordHash: hash, mustChangePassword: false },
  });

  // Platform owner team — separate auth domain, separate table.
  const p = await prisma.platformUser.updateMany({
    data: { passwordHash: hash },
  });

  console.log(`Password reset to "${TARGET}" for:`);
  console.log(`  • ${u.count} tenant users`);
  console.log(`  • ${p.count} platform-owner users`);
  console.log(`  • mustChangePassword cleared on all tenant users`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
