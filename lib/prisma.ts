import { PrismaClient } from "@prisma/client";
import { getTenantContext } from "./tenant-context";

// ─── RLS backstop plumbing ──────────────────────────────────────────────────
// When RLS_ENFORCE=1, every query carries three tx-local GUCs that the
// row-level-security policies read:
//   app.rls_enforce = 'on'   — policies are permissive unless this is set, so
//                              the migration is inert until the env flag flips
//                              (scripts/seeds that build their own PrismaClient
//                              stay permissive automatically).
//   app.org_id               — the request's org, from tenant-context (ALS).
//   app.rls_bypass = 'on'    — trusted cross-org paths (cron, owner portal,
//                              public-by-unguessable-id flows).
//
// Mechanics (verified against Prisma 5.22 in a live harness):
//   • set_config(..., true) is transaction-local → safe with pgbouncer.
//   • Singleton queries are wrapped in an array-tx [set_config, query].
//   • Queries already inside a transaction pass through untouched —
//     __internalParams.transaction identifies them — because the GUCs were
//     injected at tx start by the $transaction wrapper below.
//   • A Proxy wraps $transaction itself: fn-style gets set_config as its first
//     statement; array-style gets it prepended (result sliced off so caller
//     indexing is unchanged).
// With the flag off this file exports the plain client — zero overhead.

const rlsEnforced = process.env.RLS_ENFORCE === "1";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const base =
  (globalForPrisma.prisma as PrismaClient | undefined) ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

function gucs(op?: string) {
  const ctx = getTenantContext();
  if (process.env.RLS_DEBUG === "1") {
    console.log(`[rls] op=${op ?? "?"} org=${ctx?.orgId ?? "∅"} bypass=${ctx?.bypass ?? false}`);
  }
  return { org: ctx?.orgId ?? "", bypass: ctx?.bypass ? "on" : "" };
}

function buildRlsClient(client: PrismaClient): PrismaClient {
  const extended = client.$extends({
    query: {
      // Top-level (not $allModels) so $queryRaw/$executeRaw are covered too.
      $allOperations(params: unknown) {
        const p = params as {
          args: unknown;
          query: (args: unknown) => Promise<unknown>;
          __internalParams?: { transaction?: unknown };
        };
        // Inside a transaction the GUCs were set at tx start — pass through.
        if (p.__internalParams?.transaction) return p.query(p.args);
        const { org, bypass } = gucs((params as { model?: string; operation?: string }).model + "." + (params as { operation?: string }).operation);
        return client
          .$transaction([
            client.$executeRaw`SELECT set_config('app.rls_enforce', 'on', true), set_config('app.org_id', ${org}, true), set_config('app.rls_bypass', ${bypass}, true)`,
            p.query(p.args) as never,
          ])
          .then((r) => r[1]);
      },
    },
  });

  // $transaction wrapper: inject the GUC statement at the start of every
  // explicit transaction (both shapes), reading tenant context at call time.
  return new Proxy(extended as unknown as PrismaClient, {
    get(target, prop, receiver) {
      if (prop === "$transaction") {
        return (arg: unknown, opts?: unknown) => {
          const { org, bypass } = gucs();
          const setCfg = (c: { $executeRaw: typeof client.$executeRaw }) =>
            c.$executeRaw`SELECT set_config('app.rls_enforce', 'on', true), set_config('app.org_id', ${org}, true), set_config('app.rls_bypass', ${bypass}, true)`;
          const t = target as unknown as {
            $transaction: (a: unknown, o?: unknown) => Promise<unknown[]>;
          };
          if (typeof arg === "function") {
            return t.$transaction(async (tx: { $executeRaw: typeof client.$executeRaw }) => {
              await setCfg(tx);
              return (arg as (tx: unknown) => Promise<unknown>)(tx);
            }, opts);
          }
          return t
            .$transaction([setCfg(target as unknown as PrismaClient), ...(arg as unknown[])], opts)
            .then((r) => r.slice(1));
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

export const prisma: PrismaClient = rlsEnforced ? buildRlsClient(base) : base;

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = base;

// Production sanity check — serverless deployments MUST use a pooler URL
// or Supabase's 60-connection limit gets blown the moment cold starts
// stack up. We don't crash on misconfig (the app still runs); we log a
// LOUD warning at startup so the operator sees it in the deploy log.
//
// Symptoms when this is wrong: 'Too many connections' errors in prod
// under load, sporadic 500s from API routes, query latency climbing as
// concurrent users join.
if (typeof process !== "undefined" && process.env.NODE_ENV === "production") {
  const url = process.env.DATABASE_URL ?? "";
  // Supabase pooler URLs have 'pooler.supabase.com' in the host and use
  // port 6543. Direct connections hit port 5432 on db.<project>.supabase.co.
  const usesPooler = url.includes("pooler.supabase.com") || url.includes("pgbouncer=true");
  const hasConnectionLimit = url.includes("connection_limit=");
  if (url && !usesPooler) {
    console.warn(
      "[prisma] DATABASE_URL doesn't look like a pooler URL. " +
        "On serverless (Vercel/Lambda) this leaks DB connections and exhausts " +
        "Supabase's 60-connection limit under load. Use the 6543 pooler URL " +
        "with ?pgbouncer=true&connection_limit=1.",
    );
  } else if (url && usesPooler && !hasConnectionLimit) {
    console.warn(
      "[prisma] DATABASE_URL points at the pooler but lacks " +
        "?connection_limit=1. Add it so Prisma opens one connection " +
        "per serverless instance (the pooler handles fan-out).",
    );
  }
}
