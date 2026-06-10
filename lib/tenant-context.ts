import { AsyncLocalStorage } from "node:async_hooks";

// Per-request tenant context for the Postgres RLS backstop (defense-in-depth
// under the app-code tenantWhere filters). lib/prisma.ts reads this on every
// query and pins the org via tx-local GUCs; the RLS policies fail CLOSED when
// no org is bound and no bypass is active.
//
// WHY TWO STORAGE LAYERS — AsyncLocalStorage.enterWith() cannot propagate a
// bind UPWARD across an await boundary: the caller's continuation restores
// the context snapshot taken BEFORE the callee ran, so a bind made inside
// `await getOrgIdForSession()` (after its own DB lookups) is invisible to the
// caller's subsequent queries. Verified empirically. Inside a Next request we
// therefore key the context on the request's `headers()` object instead —
// identity-stable across awaits and arbitrarily deep frames (verified), and
// readable from inside the Prisma extension. The WeakMap entry is GC'd with
// the request. Outside a request (scripts, vitest, seeds) headers() throws
// and we fall back to plain ALS, where binds happen at top level and
// propagate fine.
//
// Three bind modes:
//   bindTenantOrg(orgId)   — normal request path. Called by getOrgIdForSession
//                            on every call, so every C1-hardened page/route is
//                            covered without further changes.
//   bindRlsBypass()        — trusted cross-org entry points: cron sweeps, the
//                            platform-owner portal, signature-verified
//                            webhooks, and public-by-unguessable-id flows.
//   runWithRlsBypass(fn)   — SCOPED bypass for narrow infrastructure lookups
//                            (e.g. resolving WHICH org a session belongs to,
//                            which must read Rider/ParentLink before any org
//                            is bound). ALS-scoped; the read path prefers an
//                            ALS bypass over the request-level context so the
//                            scope can't leak past the callback.

export type TenantContext = { orgId: string | null; bypass: boolean };

const als = new AsyncLocalStorage<TenantContext>();
const requestCtx = new WeakMap<object, TenantContext>();

// The per-request identity key, or null outside a request scope.
function requestKey(): object | null {
  try {
    // Lazy require so non-Next runtimes (plain tsx scripts) don't need the
    // Next request machinery loaded at import time.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { headers } = require("next/headers") as typeof import("next/headers");
    return headers() as unknown as object;
  } catch {
    return null;
  }
}

export function getTenantContext(): TenantContext | undefined {
  const scoped = als.getStore();
  if (scoped?.bypass) return scoped; // runWithRlsBypass wins inside its scope
  const k = requestKey();
  if (k) {
    const ctx = requestCtx.get(k);
    if (ctx) return ctx;
  }
  return scoped;
}

// Bind the org for the remainder of this request (or async context, outside
// requests). An existing bypass is preserved — e.g. a cron-entered context
// that resolves org ids mid-run must not downgrade itself.
export function bindTenantOrg(orgId: string | null): void {
  const k = requestKey();
  if (k) {
    const existing = requestCtx.get(k);
    requestCtx.set(k, { orgId, bypass: existing?.bypass ?? false });
    return;
  }
  const existing = als.getStore();
  als.enterWith({ orgId, bypass: existing?.bypass ?? false });
}

export function bindRlsBypass(): void {
  const k = requestKey();
  if (k) {
    requestCtx.set(k, { orgId: null, bypass: true });
    return;
  }
  als.enterWith({ orgId: null, bypass: true });
}

export function runWithRlsBypass<T>(fn: () => Promise<T>): Promise<T> {
  // The await must happen INSIDE the run scope: PrismaPromises are lazy and
  // dispatch (where the client reads this context) on their first .then().
  // `als.run(store, fn)` alone exits scope when fn RETURNS the promise —
  // before dispatch — so the query would run under the caller's context.
  return als.run({ orgId: null, bypass: true }, async () => await fn());
}
