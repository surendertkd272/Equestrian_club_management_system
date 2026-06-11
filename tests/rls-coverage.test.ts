import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// ── RLS backstop coverage guard ─────────────────────────────────────────────
// Enforces the one ongoing invariant of the Postgres RLS org-isolation backstop
// (PR #99 + #100, enforced in prod via the app_rls NOBYPASSRLS role): EVERY
// model must have ENABLE+FORCE row-level security AND an org-isolation policy in
// a migration.
//
// Why this matters: Supabase auto-enables RLS on new public tables. A model
// added WITHOUT a policy therefore becomes RLS-enabled-with-no-policy =
// deny-all to the non-bypass app role under RLS_ENFORCE=1 — i.e. the app
// silently returns zero rows for that table in production. This test fails the
// build the moment that happens, pointing at the missing table.
//
// Static check by design: the test DB is built with `prisma db push`, which
// does NOT execute raw-SQL migrations, so we assert against the migration SQL
// files (the source of truth for RLS), not pg_policies.

const ROOT = join(__dirname, "..");

function models(): string[] {
  const schema = readFileSync(join(ROOT, "prisma/schema.prisma"), "utf8");
  return [...schema.matchAll(/^model (\w+) \{/gm)].map((m) => m[1]);
}

function allMigrationSql(): string {
  const dir = join(ROOT, "prisma/migrations");
  let sql = "";
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    try {
      sql += readFileSync(join(dir, d.name, "migration.sql"), "utf8") + "\n";
    } catch {
      /* a migration dir without migration.sql — ignore */
    }
  }
  return sql;
}

describe("RLS org-isolation coverage", () => {
  const sql = allMigrationSql();
  const all = models();

  it("covers every model with at least one model (sanity)", () => {
    expect(all.length).toBeGreaterThan(50);
  });

  it("every model has ENABLE + FORCE row-level security in a migration", () => {
    const missing = all.filter(
      (m) =>
        !sql.includes(`ALTER TABLE "${m}" ENABLE ROW LEVEL SECURITY`) ||
        !sql.includes(`ALTER TABLE "${m}" FORCE ROW LEVEL SECURITY`),
    );
    expect(
      missing,
      `Models missing ENABLE/FORCE ROW LEVEL SECURITY in a migration: ${missing.join(", ")}. ` +
        `Add it (mirror prisma/migrations/*_rls_full_coverage) — Supabase auto-enables RLS, ` +
        `and a table without FORCE+policy is deny-all to the app_rls role under RLS_ENFORCE=1.`,
    ).toEqual([]);
  });

  it("every model has an org-isolation policy in a migration", () => {
    const missing = all.filter(
      (m) => !sql.includes(`CREATE POLICY "${m}_org_isolation" ON "${m}"`),
    );
    expect(
      missing,
      `Models missing an RLS org-isolation policy: ${missing.join(", ")}. ` +
        `Every new model needs a "<Model>_org_isolation" policy in a migration ` +
        `(centreId / via-parent / orgId scope, or permissive for reference/identity tables) — ` +
        `otherwise it is deny-all to the app_rls role under RLS_ENFORCE=1 and the app breaks for that table.`,
    ).toEqual([]);
  });
});
