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

  // --force-reset drops the public schema before re-pushing — equivalent
  // to "delete the SQLite file" in the old setup, but for Postgres.
  execFileSync(
    "npx",
    ["prisma", "db", "push", "--skip-generate", "--accept-data-loss", "--force-reset"],
    { env: process.env, stdio: "inherit" },
  );
}

export async function teardown() {
  // No-op. The next setup() forces a clean schema; no need to clean up here.
}
