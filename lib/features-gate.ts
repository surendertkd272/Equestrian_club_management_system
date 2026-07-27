// Server-side feature lookup helpers. Phase 4 ships the engine; Phase 5 wires
// these into tenant routes + the sidebar so disabled features hide.
//
// Lookup is per request (small, indexed query) so toggling a feature in the
// owner portal is visible to live tenants on their next navigation — no
// session re-issue, no logout/login dance.

import { cache } from "react";
import { NextResponse } from "next/server";
import { notFound } from "next/navigation";
import { prisma } from "./prisma";
import { getSession } from "./auth";
import { bindTenantOrg, runWithRlsBypass } from "./tenant-context";
import type { FeatureKey } from "./features";
import type { SessionPayload } from "./auth";
import { orgOfHqUser } from "./authz-centre";

// Per-request, per-orgId memoised feature lookup. React.cache() deduplicates
// concurrent + sequential calls within a single server request — so a page
// that asks for features from layout.tsx + the page itself + 3 components
// downstream still results in exactly ONE DB query per orgId.
//
// Cache scope: ONE server request. No risk of cross-user data leak because
// React allocates a new cache per request. Safe to use anywhere.
export const getOrgFeatures = cache(async (orgId: string): Promise<Set<FeatureKey>> => {
  const rows = await prisma.orgFeature.findMany({
    where: { orgId, enabled: true },
    select: { featureKey: true },
  });
  return new Set(rows.map((r) => r.featureKey as FeatureKey));
});

export async function hasFeature(orgId: string, key: FeatureKey): Promise<boolean> {
  const set = await getOrgFeatures(orgId);
  return set.has(key);
}

// Throws if the feature is off. API routes catch and return 403 FEATURE_DISABLED.
export async function requireFeature(orgId: string, key: FeatureKey): Promise<void> {
  if (!(await hasFeature(orgId, key))) {
    const err = new Error("FEATURE_DISABLED");
    (err as Error & { code?: string }).code = "FEATURE_DISABLED";
    throw err;
  }
}

// Resolve a tenant session's orgId. Centre-scoped users come straight from
// session.centreId; SUPER_ADMIN (centreId=null) falls back to any centre under
// the same Organisation via the first staff/rider/etc. record. We accept a
// pre-resolved orgId override for hot paths that already know it.
//
// Designed to swallow nulls quietly: callers that need a hard guarantee should
// check the return value and 401/403 themselves.
// Memoised per-request: many components on the same page ask for the
// caller's orgId; without dedup, that's N round-trips to find the same
// orgId we already have.
export const getOrgIdForCentre = cache(async (centreId: string | null | undefined): Promise<string | null> => {
  if (!centreId) return null;
  const c = await prisma.centre.findUnique({ where: { id: centreId }, select: { orgId: true } });
  return c?.orgId ?? null;
});

// Resolve the tenant orgId for a session. Memoised per-request via
// React.cache() — getSession() is also cached, so multiple components
// asking for the same session object hit dedup-by-identity here and
// short-circuit straight to the cached orgId. Saves the 'find first
// centre's org' fallback DB call from running N times per render.
const resolveOrgIdForSession = cache(async (session: SessionPayload | null): Promise<string | null> => {
  if (!session) return null;
  if (session.centreId) return getOrgIdForCentre(session.centreId);
  // HQ-tier users (SUPER_ADMIN, ADMIN) have no centreId. Prefer the explicit
  // User.orgId; fall back to "first centre's org" for legacy rows that pre-
  // date the User.orgId column. Without ADMIN here, every feature-gated
  // module (medicines, horses, exams, …) silently 404s for Admin.
  if (session.role === "SUPER_ADMIN" || session.role === "ADMIN") {
    // Shared with the centre fence — see orgOfHqUser in lib/authz-centre.ts for
    // why the old "first centre's org" fallback was unsafe. This is the value
    // that gets stamped into app.org_id for RLS, so guessing it wrong doesn't
    // just mis-authorise at the app layer, it mis-binds the database backstop.
    return orgOfHqUser(session.userId);
  }
  // PARENT has no centreId but is linked to riders via ParentLink → centre → org.
  // Resolution reads RLS-guarded tables BEFORE any org is bound, so it runs
  // under a scoped bypass — it's a by-session-key infrastructure lookup.
  if (session.role === "PARENT") {
    const link = await runWithRlsBypass(() =>
      prisma.parentLink.findFirst({
        where: { parentUserId: session.userId },
        select: { rider: { select: { centre: { select: { orgId: true } } } } },
      }),
    );
    return link?.rider.centre.orgId ?? null;
  }
  // RIDER has no centreId on the session, but Rider.userId points to them.
  if (session.role === "RIDER") {
    const rider = await runWithRlsBypass(() =>
      prisma.rider.findFirst({
        where: { userId: session.userId },
        select: { centre: { select: { orgId: true } } },
      }),
    );
    return rider?.centre.orgId ?? null;
  }
  return null;
});

// Resolve AND bind. The resolver above is React-cached (one lookup per
// request), but the RLS tenant-context bind must run on EVERY call — App
// Router renders layouts/pages/components as sibling async branches, and a
// bind made in one branch is invisible to the others. Each call site
// re-binding into its own branch is what makes the backstop stick.
export async function getOrgIdForSession(session: SessionPayload | null): Promise<string | null> {
  const orgId = await resolveOrgIdForSession(session);
  bindTenantOrg(orgId);
  return orgId;
}

// Convenience for layouts/pages/components that need the active feature set.
// Memoised too — the most common 'how slow is this' culprit was the sidebar
// + page both calling this independently. Now: one query per request.
export const getFeaturesForSession = cache(async (session: SessionPayload | null): Promise<Set<FeatureKey>> => {
  const orgId = await getOrgIdForSession(session);
  if (!orgId) return new Set();
  return getOrgFeatures(orgId);
});

// Uniform 403 for routes that have to refuse because a feature is off. Wraps
// the response so the client can render a "this isn't on your plan" surface
// rather than a generic error.
export function featureDeniedResponse(key: FeatureKey) {
  return NextResponse.json(
    {
      error: "FEATURE_DISABLED",
      featureKey: key,
      // Human message so client callsites that read `data.message` directly
      // (bypassing humanizeError) show a sentence rather than "FEATURE_DISABLED".
      message: "That feature isn't enabled for your plan.",
    },
    { status: 403 },
  );
}

// Single-shot guard for API routes. Resolves the session's org, checks the
// feature, and either returns null (allowed) or a NextResponse to return
// immediately. Usage:
//
//   const block = await blockIfFeatureOff(session, "competitions");
//   if (block) return block;
//
export async function blockIfFeatureOff(
  session: SessionPayload | null,
  key: FeatureKey,
): Promise<NextResponse | null> {
  const orgId = await getOrgIdForSession(session);
  if (!orgId) return featureDeniedResponse(key);
  if (!(await hasFeature(orgId, key))) return featureDeniedResponse(key);
  return null;
}

// Server-component / layout guard. Resolves the *current* session's features
// and throws Next.js' notFound() if the feature is off — the user gets a 404
// rather than a permission-denied screen, which is consistent with how we want
// hidden features to behave (as if they don't exist on this plan).
export async function assertSessionFeature(key: FeatureKey): Promise<void> {
  const session = await getSession();
  const features = await getFeaturesForSession(session);
  if (!features.has(key)) notFound();
}

// Centre → org → feature lookup. Public endpoints (the /pay page, Razorpay
// webhook + verify) have no session — they only know the invoice's centre.
// This resolves the org behind the centre and checks the flag in one call.
// Memoised through getOrgIdForCentre + getOrgFeatures.
export async function isFeatureEnabledForCentre(
  centreId: string,
  key: FeatureKey,
): Promise<boolean> {
  const orgId = await getOrgIdForCentre(centreId);
  if (!orgId) return false;
  return hasFeature(orgId, key);
}
