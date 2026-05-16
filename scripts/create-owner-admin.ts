// scripts/create-owner-admin.ts — bootstrap the first platform owner.
//
// Usage:
//   npm run owner:create-admin -- --email you@equiwings.in --name "Your Name" [--password "$(openssl rand -base64 16)"]
//
// Safe to run in production (the dev seed isn't). Idempotent — refuses
// to overwrite an existing user; pass --reset-password to update an
// existing row's password instead.

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";

const prisma = new PrismaClient();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0 || i === process.argv.length - 1) return undefined;
  return process.argv[i + 1];
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const email = arg("email");
  const name = arg("name");
  const passwordArg = arg("password");
  const resetPassword = flag("reset-password");

  if (!email || !name) {
    console.error("Required: --email <addr> --name <full name> [--password <pw>] [--reset-password]");
    process.exit(2);
  }

  // Generate a strong one if not supplied. Print exactly once to stdout
  // so an ops engineer can capture and rotate it; we never persist
  // plaintext.
  const password = passwordArg ?? crypto.randomBytes(12).toString("base64url");
  const hash = await bcrypt.hash(password, 10);

  const existing = await prisma.platformUser.findUnique({ where: { email } });
  if (existing && !resetPassword) {
    console.error(`User ${email} already exists. Pass --reset-password to rotate the password instead.`);
    process.exit(3);
  }

  if (existing) {
    await prisma.platformUser.update({
      where: { id: existing.id },
      data: { passwordHash: hash, tokenVersion: { increment: 1 } },
    });
    await prisma.platformAuditLog.create({
      data: {
        actorId: null,
        action: "owner.password_admin_reset",
        after: JSON.stringify({ via: "create-owner-admin script", at: new Date().toISOString() }),
      },
    });
    console.log(`\nPassword rotated for ${email}.`);
  } else {
    const u = await prisma.platformUser.create({
      data: { email, name, role: "OWNER_ADMIN", passwordHash: hash, status: "active" },
    });
    await prisma.platformAuditLog.create({
      data: {
        actorId: null,
        action: "owner.platform_user_created",
        after: JSON.stringify({ id: u.id, email, via: "create-owner-admin script" }),
      },
    });
    console.log(`\nCreated OWNER_ADMIN: ${email}`);
  }

  if (!passwordArg) {
    console.log("");
    console.log("Generated password (capture now — won't be shown again):");
    console.log(`  ${password}`);
    console.log("");
    console.log("Sign in at: /owner/login");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
