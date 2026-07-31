import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify, SignJWT } from "jose";
import { canReachPath, landingPathFor } from "@/components/shell/sidebar-nav";
import type { Role } from "@/lib/roles";

// Idle session window. The token lives this long; we re-issue it on activity
// (sliding renewal below), so an active user is never logged out — only after
// this many minutes of NO requests does the session lapse. Env can override.
const SESSION_TTL_MIN = Number(process.env.JWT_ACCESS_TTL_MIN ?? 480); // 8h default

// Owner sessions get their OWN ttl knob. Both used to read JWT_ACCESS_TTL_MIN
// with different defaults (480 vs 60), so tuning the tenant idle window
// silently retuned the highest-value session on the platform too.
const OWNER_TTL_MIN = Number(process.env.OWNER_JWT_TTL_MIN ?? 60);

const TENANT_AUDIENCE = "tenant";
const OWNER_AUDIENCE = "owner";

// Ceiling on how long one sign-in can be stretched by renewal. Mirrors
// absoluteMaxMs() in lib/auth.ts — keep the two in step.
const ABSOLUTE_MAX_MS = Number(process.env.SESSION_ABSOLUTE_MAX_DAYS ?? 30) * 86_400_000;

// Re-mint the cookie when the token is past the halfway mark, carrying the
// same claims forward with a fresh expiry. Keeps active sessions alive without
// setting a cookie on every single request.
//
// `jti` and `sst` ride along in ...claims, which matters twice over: a renewed
// session keeps its identity (so a sign-out revocation still applies to it) and
// keeps its original start time (so renewal can't outrun the absolute cap).
async function slideRenewal(
  res: NextResponse,
  payload: Record<string, unknown>,
  secret: Uint8Array,
  opts: { cookie: string; ttlMin: number; audience: string; sameSite: "lax" | "strict" },
) {
  const exp = typeof payload.exp === "number" ? payload.exp : 0;
  const now = Math.floor(Date.now() / 1000);
  const remaining = exp - now;
  if (remaining > (opts.ttlMin * 60) / 2) return; // still fresh — skip

  // Don't renew past the absolute lifetime. getSession() rejects the session at
  // that point anyway; renewing would just hand out a cookie already dead on
  // arrival.
  const sst = typeof payload.sst === "number" ? payload.sst : null;
  if (sst !== null && Date.now() > sst + ABSOLUTE_MAX_MS) return;

  const { exp: _e, iat: _i, ...claims } = payload as Record<string, unknown>;
  const fresh = await new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setAudience(opts.audience)
    .setExpirationTime(`${opts.ttlMin}m`)
    .sign(secret);
  res.cookies.set(opts.cookie, fresh, {
    httpOnly: true,
    sameSite: opts.sameSite,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: opts.ttlMin * 60,
  });
}

// Owner sessions never passed through the renewal above, because /owner is in
// PUBLIC_PREFIXES and the middleware returns before reaching it — so an owner
// hard-dropped at 60 minutes mid-task with no warning. Renew here, but never
// gate on it: /owner/* pages and /api/owner/* routes do their own enforcement
// via getOwnerSession().
async function slideOwnerRenewal(res: NextResponse, req: NextRequest) {
  const token = req.cookies.get("ew_owner_session")?.value;
  if (!token) return;
  try {
    const secret = new TextEncoder().encode(process.env.OWNER_JWT_SECRET ?? process.env.JWT_SECRET);
    const { payload } = await jwtVerify(token, secret, { audience: OWNER_AUDIENCE });
    await slideRenewal(res, payload as Record<string, unknown>, secret, {
      cookie: "ew_owner_session",
      ttlMin: OWNER_TTL_MIN,
      audience: OWNER_AUDIENCE,
      sameSite: "strict",
    });
  } catch {
    // Expired or invalid — leave it alone; the portal's own guard bounces them.
  }
}

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
  // Employee self-registration link — public form + its submit endpoints only.
  // (Link generation + approval under /api/staff-onboarding stay auth-gated.)
  // /onboard/staff covers BOTH the tokenised page and the reusable ?centre=
  // page; self-register is the reusable-link submit.
  "/onboard/staff",
  "/api/staff-onboarding/submit",
  "/api/staff-onboarding/self-register",
  // Vendor self-registration — reusable per-club link + its submit endpoint.
  "/onboard/vendor",
  "/api/vendor-registration",
  // Parent payment surface. /api/enrolments/[id] SMSes, WhatsApps and emails
  // `${baseUrl}/pay/${invoice.id}` to the parent the moment an enrolment is
  // approved, and app/pay/[invoiceId]/page.tsx is written as a public page
  // ("no auth required" — it bindRlsBypass()es and looks the invoice up by
  // unguessable cuid). Without this prefix the middleware bounced every one
  // of those links to /login, where a parent has no account: the club could
  // not collect a single registration fee online.
  "/pay/",
  // Venue booking confirmation — public, read-only. Renter sees their
  // booking details from URL params; the underlying FacilityBooking row
  // still requires auth to mutate.
  "/booking-confirmation",
  "/uploads",                      // public — dev local-fs uploads served from /public/uploads
  "/api/auth",
  "/api/auth/verify-email",
  "/api/captcha",
  "/api/onboarding",
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
    const res = slug
      ? NextResponse.rewrite((() => { const u = req.nextUrl.clone(); u.pathname = logical; return u; })())
      : NextResponse.next();
    // Owner paths are "public" to THIS middleware (they guard themselves), but
    // they still need their cookie kept alive while the owner is working.
    if (logical.startsWith("/owner") || logical.startsWith("/api/owner")) {
      await slideOwnerRenewal(res, req);
    }
    return res;
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
    const { payload } = await jwtVerify(token, secret, { audience: TENANT_AUDIENCE });

    // Central RBAC for admin PAGE routes: the sidebar only HIDES links; without
    // this a signed-in staff member could reach a page outside their role by
    // typing the URL (audit finding — VET/ACCOUNTANT reading rider PII, etc.).
    // HQ roles bypass (canReachPath), unknown routes fail open, and API routes
    // keep their own per-handler guards. Denied → the role's own landing page.
    if (!isApi) {
      const role = (payload as { role?: string }).role as Role | undefined;
      if (role && !canReachPath(role, logical)) {
        // Send them to a page they can actually open. Redirecting everyone to
        // /dashboard looped for the four roles that can't reach /dashboard.
        const landing = landingPathFor(role);
        if (landing === logical) {
          // Belt and braces: never redirect a path to itself.
          return new NextResponse("Forbidden", { status: 403 });
        }
        const url = req.nextUrl.clone();
        url.pathname = landing;
        url.search = "";
        return NextResponse.redirect(url);
      }
    }

    const res = slug
      ? NextResponse.rewrite((() => { const u = req.nextUrl.clone(); u.pathname = logical; return u; })())
      : NextResponse.next();
    // Sliding renewal — extend the session while the user is active.
    await slideRenewal(res, payload as Record<string, unknown>, secret, {
      cookie: "ew_session",
      ttlMin: SESSION_TTL_MIN,
      audience: TENANT_AUDIENCE,
      sameSite: "lax",
    });
    return res;
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
