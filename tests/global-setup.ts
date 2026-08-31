// One-time test-DB bootstrap. Runs in the main vitest process before any worker spawns.
//
// Tests run against whatever DATABASE_URL the caller provides:
//   • CI: a Postgres service container (see .github/workflows/ci.yml).
//   • Local: a docker Postgres at localhost:5432, exported in your shell
//     before invoking `npm test`. Example:
//       docker run --rm -e POSTGRES_PASSWORD=x -p 5432:5432 postgres:15-alpine
//       export DATABASE_URL=postgresql://postgres:x@localhost:5432/postgres
//       export DIRECT_URL=postgresql://postgres:x@localhost:5432/postgres
//       npm test
//
// On setup we `prisma db push --force-reset` so the suite starts from a
// known-clean schema regardless of what state the DB was in. teardown
// is a no-op — the next run will reset again.

import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

let lockHolder: PrismaClient | null = null;

export async function setup() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set. Tests need a Postgres URL — see tests/global-setup.ts header for the docker recipe.",
    );
  }
  // Mirror DATABASE_URL → DIRECT_URL when only one is set; Prisma needs
  // both because of the schema's directUrl declaration.
  if (!process.env.DIRECT_URL) {
    process.env.DIRECT_URL = process.env.DATABASE_URL;
  }

  // Refuse to start if another suite is already using this database.
  //
  // setup() runs `db push --force-reset`, which DROPS THE PUBLIC SCHEMA, and
  // every test calls resetDb() (TRUNCATE) between cases. Two runs pointed at
  // one database therefore wipe each other's rows mid-test, and the symptom is
  // a handful of unrelated tests failing with "expected null not to be null"
  // or "expected [] to have length 1" — a scatter that reads like flakiness
  // and sends you hunting for a race in application code that isn't there.
  //
  // A session-scoped advisory lock is exactly right for this: Postgres frees
  // it automatically when the connection dies, so a crashed run leaves nothing
  // to clean up by hand.
  const lockClient = new PrismaClient();
  const [{ locked }] = await lockClient.$queryRaw<{ locked: boolean }[]>`
    SELECT pg_try_advisory_lock(hashtext('equiwings_test_suite')) AS locked`;
  if (!locked) {
    await lockClient.$disconnect();
    throw new Error(
      "Another test run is already using this database. Wait for it to finish, " +
        "or point DATABASE_URL at a different one — concurrent runs silently " +
        "corrupt each other because setup drops the schema.",
    );
  }
  // Held for the life of the process; released when the connection closes.
  lockHolder = lockClient;

  // --force-reset drops the public schema before re-pushing — equivalent
  // to "delete the SQLite file" in the old setup, but for Postgres.
  execFileSync(
    "npx",
    ["prisma", "db", "push", "--skip-generate", "--accept-data-loss", "--force-reset"],
    { env: process.env, stdio: "inherit" },
  );
}

export async function teardown() {
  // Release the advisory lock so the next run can start immediately. Postgres
  // would drop it on disconnect anyway; doing it explicitly keeps a watch-mode
  // session from holding the database hostage.
  await lockHolder?.$disconnect();
  lockHolder = null;
}
