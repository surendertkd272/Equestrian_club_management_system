import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

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
