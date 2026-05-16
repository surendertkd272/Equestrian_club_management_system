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
    // Each test file gets a fresh fork (and thus a fresh PrismaClient). Running files
    // sequentially keeps the shared SQLite file from hitting SQLITE_BUSY. Without per-file
    // isolation, Prisma + SQLite produces phantom FK errors across files (a row created in
    // one test becomes invisible to FK checks in the next, even though direct reads return
    // it). Sequential separate forks side-step the issue cleanly.
    pool: "forks",
    fileParallelism: false,
    env: {
      // Resolved relative to prisma/schema.prisma → prisma/test.db.
      DATABASE_URL: "file:./test.db",
      // Stable JWT secret so auth tests don't depend on env outside the suite.
      JWT_SECRET: "test-jwt-secret",
    },
  },
});
