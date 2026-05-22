import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const PUBLIC_PREFIXES = [
  "/login",
  "/onboarding",
  "/verify-email",
  "/verify",
  "/privacy",
  "/terms",
  "/pricing",
  "/help",
  // WhatsApp deep-link redirects — public so coaches can open from the
  // chat without first signing in. The /r/[code] route enforces validity
  // (not-expired, code exists) on its own.
  "/r/",
  "/api/short-links/resolve",
  // Public scoreboard (competition results, no auth required).
  "/scoreboard",
  "/compete",                      // public competition portal: entries, tickets
  "/tickets",                      // public ticket QR view (URL is the bearer)
  "/uploads",                      // public — dev local-fs uploads served from /public/uploads
  "/api/auth",
  "/api/auth/verify-email",
  "/api/captcha",
  "/api/onboarding",
  "/api/public",                   // public competition + ticket APIs
  "/_next",
  "/favicon",
  // PWA assets
  "/manifest.json",
  "/sw.js",
  "/icons/",
  // Brand asset served from the login page (pre-auth) — without this, the
  // middleware redirects /equiwings-logo.png → /login, breaking the logo.
  "/equiwings-logo.png",
  "/equiwings-logo.svg",
  "/api/payments/razorpay/mock",
  "/api/payments/razorpay/order",  // public — onboarding wizard calls this pre-auth
  "/api/payments/razorpay/verify", // public — Razorpay handler returns through the browser
  "/api/webhooks/razorpay",        // public — server-to-server, HMAC-verified
  "/api/webhooks/stripe",          // public — server-to-server, signature-verified
  "/api/cron/sweep",               // public — shared-secret-verified inside the handler
  "/api/health",                   // public — uptime monitor probe (no auth)
  "/api/upload",                   // public — called pre-auth from the onboarding wizard
  // Forgot-password public surfaces (Phase 3) — token-authed, not session-authed.
  "/forgot-password",
  "/reset-password",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
  // Owner portal — separate auth domain (cookie: ew_owner_session). Tenant
  // middleware deliberately ignores these; each /owner/* route and the
  // /owner/(protected) layout enforce ownership via getOwnerSession().
  "/owner",
  "/api/owner",
];

function isPublic(pathname: string) {
  if (pathname === "/") return true;
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

// V2 slug-prefix routing: `/t/<slug>/whatever` is an alternative entry point
// to `/whatever`. The file-system route tree stays flat — we rewrite here so
// `/t/equiwings/dashboard` still resolves to `app/(admin)/dashboard/page.tsx`.
// The browser URL bar keeps the slug, which is the point: brandable links,
// bookmarkable per-tenant entry points.
const SLUG_PREFIX_RE = /^\/t\/([a-z][a-z0-9-]*[a-z0-9])(\/.*)?$/;

function stripSlugPrefix(pathname: string): { slug: string | null; logical: string } {
  const m = pathname.match(SLUG_PREFIX_RE);
  if (!m) return { slug: null, logical: pathname };
  return { slug: m[1], logical: m[2] ?? "/" };
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const { slug, logical } = stripSlugPrefix(pathname);

  if (isPublic(logical)) {
    if (slug) {
      const url = req.nextUrl.clone();
      url.pathname = logical;
      return NextResponse.rewrite(url);
    }
    return NextResponse.next();
  }

  const isApi = logical.startsWith("/api/");
  const token = req.cookies.get("ew_session")?.value;

  if (!token) {
    if (isApi) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    // Preserve the slug-prefixed path so post-login the user lands back where
    // they tried to go.
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  try {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET);
    await jwtVerify(token, secret);
    if (slug) {
      const url = req.nextUrl.clone();
      url.pathname = logical;
      return NextResponse.rewrite(url);
    }
    return NextResponse.next();
  } catch {
    if (isApi) {
      const res = NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
      res.cookies.delete("ew_session");
      return res;
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", pathname);
    const res = NextResponse.redirect(url);
    res.cookies.delete("ew_session");
    return res;
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
