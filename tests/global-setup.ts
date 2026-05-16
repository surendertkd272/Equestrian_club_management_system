// One-time test-DB bootstrap. Runs in the main vitest process before any worker spawns.
//
// We use a dedicated SQLite file (prisma/test.db) so the dev DB isn't touched. The schema
// gets pushed via the prisma CLI — same as `npm run db:push` — and the file is deleted on
// teardown so each `vitest run` starts clean.

import { execFileSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";

const TEST_DB_RELATIVE = "./test.db"; // resolved relative to prisma/schema.prisma → prisma/test.db
const TEST_DB_ABSOLUTE = path.join(process.cwd(), "prisma", "test.db");

export async function setup() {
  // Always start with a fresh DB so prior leftovers can't mask a test bug.
  if (existsSync(TEST_DB_ABSOLUTE)) unlinkSync(TEST_DB_ABSOLUTE);

  execFileSync("npx", ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"], {
    env: { ...process.env, DATABASE_URL: `file:${TEST_DB_RELATIVE}` },
    stdio: "inherit",
  });
}

export async function teardown() {
  if (existsSync(TEST_DB_ABSOLUTE)) unlinkSync(TEST_DB_ABSOLUTE);
}
