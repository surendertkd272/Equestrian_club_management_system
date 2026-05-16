// Custom-domain → tenant resolution. Used by server components (layouts,
// pages) and API routes to map an inbound Host header to the right
// Organisation when a tenant has set up a vanity hostname.
//
// Important: this can't live in middleware because middleware runs on the
// edge runtime where Prisma can't open a connection. Layouts and route
// handlers run on Node and can call this freely.
//
// Pattern: layout reads `headers().get("host")`, calls resolveCustomDomain(),
// and either renders normally (if the request came in via the app's primary
// domain) or sets a tenant-specific context if a custom-domain match is found.

import { headers } from "next/headers";
import { prisma } from "./prisma";

export type ResolvedDomain = {
  // The Host header value, lowercased.
  host: string;
  // Whether this host matched an Organisation.customDomain entry.
  isCustomDomain: boolean;
  org?: { id: string; slug: string; name: string };
};

// In-process memo. Vercel and most runtimes reuse a Node process across
// requests on the same instance, so this saves us a DB round-trip per page
// view for the warm-function case. On a cold start the cache is empty and
// the first request pays a single Prisma lookup — acceptable.
//
// Bounded at 1k entries so a hostile flood of unknown hosts can't grow the
// map unchecked. On overflow we evict the oldest entry (insertion-order is
// preserved by Map).
const cache = new Map<string, { resolvedAt: number; value: ResolvedDomain }>();
const TTL_MS = 60_000;
const MAX_ENTRIES = 1000;

function cacheSet(key: string, value: ResolvedDomain) {
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { resolvedAt: Date.now(), value });
}

// Test helper: clear the in-process cache. Hidden behind a function name so
// production code can't accidentally call it.
export function __resetCustomDomainCache() {
  cache.clear();
}

// Call from any owner-side mutation that changes Organisation.customDomain
// (set, clear, swap). Without this, the in-process cache will keep serving
// the stale resolution for up to TTL_MS — a user who points DNS at the new
// host will see their old tenant or vice-versa for the cache lifetime.
// Pass both the previous and the next value so we evict both keys.
export function invalidateDomainCache(hosts: Array<string | null | undefined>) {
  for (const h of hosts) {
    if (!h) continue;
    cache.delete(h.toLowerCase());
  }
}

function appHosts(): string[] {
  const env = process.env.APP_HOSTS ?? process.env.NEXT_PUBLIC_APP_URL ?? "";
  const list = env
    .split(/[\s,]+/)
    .map((s) => {
      try {
        return new URL(s.startsWith("http") ? s : `http://${s}`).hostname.toLowerCase();
      } catch {
        return s.trim().toLowerCase();
      }
    })
    .filter(Boolean);
  return list.length > 0 ? list : ["localhost"];
}

export async function resolveCustomDomain(host: string | null): Promise<ResolvedDomain | null> {
  if (!host) return null;
  const h = host.split(":")[0]!.toLowerCase();

  // App primary host(s) — never look these up; they're just the canonical
  // app and don't carry a tenant identity by themselves.
  if (appHosts().includes(h)) {
    return { host: h, isCustomDomain: false };
  }

  const cached = cache.get(h);
  if (cached && Date.now() - cached.resolvedAt < TTL_MS) return cached.value;

  const org = await prisma.organisation.findFirst({
    where: { customDomain: h },
    select: { id: true, slug: true, name: true },
  });

  const value: ResolvedDomain = org
    ? { host: h, isCustomDomain: true, org }
    : { host: h, isCustomDomain: false };

  cacheSet(h, value);
  return value;
}

// Server-component convenience: reads the request Host header from next's
// `headers()` API and returns the resolution.
export async function currentDomain(): Promise<ResolvedDomain | null> {
  const h = headers().get("host");
  return resolveCustomDomain(h);
}
