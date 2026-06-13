import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "tests/**/*.test.ts"],
    globalSetup: ["./tests/global-setup.ts"],
    // Per-file setup: shims React's RSC-only `cache()` so auth-importing
    // integration tests can run under plain vitest (see tests/setup.ts).
    setupFiles: ["./tests/setup.ts"],
    // Each test file gets a fresh fork (and thus a fresh PrismaClient). Running files
    // sequentially keeps the shared Postgres session from contending. Per-file isolation
    // also matters for test ordering — phantom FK errors used to crop up under SQLite
    // when files shared state.
    pool: "forks",
    fileParallelism: false,
    env: {
      // Tests use whichever DATABASE_URL the runner provides:
      //   • CI: a Postgres service container (see .github/workflows/ci.yml).
      //   • Local: set DATABASE_URL + DIRECT_URL in your shell before
      //     running `npm test`. Easiest: `docker run -e POSTGRES_PASSWORD=x
      //     -p 5432:5432 -d postgres:15-alpine` then export
      //     DATABASE_URL=postgresql://postgres:x@localhost:5432/postgres
      //     DIRECT_URL=postgresql://postgres:x@localhost:5432/postgres
      // We deliberately do NOT hard-code a URL here — the previous SQLite
      // default no longer matches the postgresql schema provider.
      JWT_SECRET: "test-jwt-secret",
      OWNER_JWT_SECRET: "test-owner-jwt-secret",
    },
  },
});
