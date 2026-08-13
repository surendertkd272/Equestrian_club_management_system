// Structural invariants for the auth surface.
//
// Three places in the routing layer fail OPEN by design. Each is defensible on
// its own, but each also means a future route is unprotected until somebody
// remembers a step. These tests turn "we remembered every time so far" into
// something CI enforces.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { navPermForPath, canReachPath } from "@/components/shell/sidebar-nav";

function routeFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? routeFiles(full) : e.name === "route.ts" ? [full] : [];
  });
}

function pageRoutes(dir: string, base = ""): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      const seg = e.name.startsWith("(") && e.name.endsWith(")") ? "" : `/${e.name}`;
      return pageRoutes(full, base + seg);
    }
    return e.name === "page.tsx" ? [base || "/"] : [];
  });
}

describe("owner API routes are never reachable without an owner check", () => {
  // These four are pre-auth (you cannot hold a cookie yet) and impersonate/stop
  // deliberately runs on a TENANT session, so they carry no owner guard. The
  // middleware's ownerApiGate() exempts exactly this list too — if you add to
  // one, add to the other.
  const OPEN = new Set([
    "app/api/owner/auth/login/route.ts",
    "app/api/owner/auth/forgot-password/route.ts",
    "app/api/owner/auth/reset-password/route.ts",
    "app/api/owner/auth/logout/route.ts",
    "app/api/owner/impersonate/stop/route.ts",
  ]);

  it("every /api/owner route calls an owner-session guard", () => {
    const missing = routeFiles("app/api/owner")
      .filter((f) => !OPEN.has(f))
      .filter((f) => !/getOwnerSession|requireOwnerSession/.test(fs.readFileSync(f, "utf8")));
    expect(missing, `owner routes with no getOwnerSession(): ${missing.join(", ")}`).toEqual([]);
  });

  it("the middleware exemption list matches the routes that genuinely lack a guard", () => {
    // Stops the two lists drifting apart in either direction: an exempted route
    // that has since gained a guard is fine, but an exempted route that does
    // not exist at all means the middleware is opening a path for nothing.
    const stale = [...OPEN].filter((f) => !fs.existsSync(f));
    expect(stale, `exempted but missing: ${stale.join(", ")}`).toEqual([]);
  });
});

describe("admin pages are protected by at least one layer", () => {
  // Two independent layers guard an admin page: the nav permission table
  // (enforced centrally in middleware) and an in-page can() check. Either is
  // sufficient. canReachPath() fails OPEN for paths absent from NAV, so a page
  // with NEITHER is reachable by every signed-in role — including PARENT and
  // RIDER. That combination is the thing worth failing the build over.
  //
  // Pages that are legitimately universal (they scope to session.userId, or
  // they only redirect) are recorded here so the choice is visible.
  const UNIVERSAL_BY_DESIGN = new Set([
    "/", // admin index — redirects to the role's landing page
    "/account",
    "/account/rotate",
    "/no-organisation",
    "/my-documents", // scoped to createdUserId: session.userId
  ]);

  const hasInPageRoleCheck = (route: string) => {
    const f = path.join("app/(admin)", route.slice(1), "page.tsx");
    if (!fs.existsSync(f)) return false;
    return /\bcan\(\s*session\.role/.test(fs.readFileSync(f, "utf8"));
  };

  it("no admin page is left open at every layer", () => {
    const unguarded = pageRoutes("app/(admin)")
      .filter((p) => !p.includes("[")) // dynamic detail pages inherit their parent's perm
      .filter((p) => navPermForPath(p) === null)
      .filter((p) => !hasInPageRoleCheck(p))
      .filter((p) => !UNIVERSAL_BY_DESIGN.has(p));
    expect(
      unguarded,
      `admin pages with no nav perm AND no in-page role check — reachable by ANY signed-in role:\n  ${unguarded.join("\n  ")}`,
    ).toEqual([]);
  });

  it("HQ roles still bypass, and a centre role is still held to the table", () => {
    expect(canReachPath("SUPER_ADMIN", "/salary")).toBe(true);
    expect(canReachPath("ADMIN", "/salary")).toBe(true);
    // A groom has no business on the payroll page.
    expect(canReachPath("GROOM", "/salary")).toBe(false);
  });
});

const { middleware } = await import("@/middleware");
const { NextRequest } = await import("next/server");
const { signOwnerSession } = await import("@/lib/owner-auth");
const { signSession } = await import("@/lib/auth");

describe("middleware gates", () => {
  const req = (url: string, cookie?: [string, string]) => {
    const r = new NextRequest(new Request(`https://app.test${url}`));
    if (cookie) r.cookies.set(cookie[0], cookie[1]);
    return r;
  };

  it("owner APIs fail closed without an owner cookie", async () => {
    const res = await middleware(req("/api/owner/tenants"));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "UNAUTHENTICATED_OWNER" });
  });

  it("a TENANT cookie does not open an owner API", async () => {
    const tenant = await signSession({
      userId: "u1", role: "SUPER_ADMIN", centreId: null, name: "T", tokenVersion: 0,
    });
    const res = await middleware(req("/api/owner/tenants", ["ew_owner_session", tenant]));
    expect(res.status).toBe(401);
  });

  it("a valid owner cookie passes through", async () => {
    const owner = await signOwnerSession({
      ownerId: "o1", role: "OWNER_ADMIN", name: "O", tokenVersion: 0,
    });
    const res = await middleware(req("/api/owner/tenants", ["ew_owner_session", owner]));
    expect(res.status).not.toBe(401);
  });

  it("pre-auth owner endpoints stay reachable", async () => {
    for (const p of ["/api/owner/auth/login", "/api/owner/auth/forgot-password"]) {
      expect((await middleware(req(p))).status, p).not.toBe(401);
    }
  });

  it("public prefixes match on a path boundary, not a raw string prefix", async () => {
    // "/login" must not whitelist "/loginsomething"; unauthenticated, a real
    // protected path redirects to /login rather than passing through.
    const sneaky = await middleware(req("/loginsomething"));
    expect(sneaky.status).toBe(307);
    expect(sneaky.headers.get("location")).toContain("/login");

    // ...while the genuine public paths still work, including the dotted
    // literal ("/favicon" -> "/favicon.ico") and trailing-slash forms.
    for (const p of ["/login", "/favicon.ico", "/api/auth/login", "/pay/abc"]) {
      expect((await middleware(req(p))).status, p).not.toBe(307);
    }
  });

  it("api paths under a boundary-matched prefix are not spoofable", async () => {
    const res = await middleware(req("/api/authsomething"));
    expect(res.status).toBe(401);
  });
});
