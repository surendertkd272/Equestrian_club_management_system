/**
 * Seed (or reset) the Platform Owner account in production.
 *
 * Usage:
 *   npx tsx scripts/seed-owner.ts
 *
 * This connects to whatever DATABASE_URL is in .env and upserts
 * the owner@platform.local PlatformUser with password "password".
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

async function main() {
  const prisma = new PrismaClient();
  try {
    const passwordHash = await bcrypt.hash("password", 10);

    const user = await prisma.platformUser.upsert({
      where: { email: "owner@platform.local" },
      create: {
        email: "owner@platform.local",
        name: "Platform Owner",
        role: "OWNER_ADMIN",
        passwordHash,
        status: "active",
      },
      update: {
        passwordHash,
        status: "active",
      },
    });

    console.log("✅ Platform Owner seeded/reset successfully!");
    console.log(`   ID:    ${user.id}`);
    console.log(`   Email: ${user.email}`);
    console.log(`   Role:  ${user.role}`);
    console.log(`   Pass:  password`);
    console.log("");
    console.log("Login at: <your-vercel-url>/owner/login");
  } catch (err) {
    console.error("❌ Failed to seed owner:", err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
