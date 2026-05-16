// Server-side feature lookup helpers. Phase 4 ships the engine; Phase 5 wires
// these into tenant routes + the sidebar so disabled features hide.
//
// Lookup is per request (small, indexed query) so toggling a feature in the
// owner portal is visible to live tenants on their next navigation — no
// session re-issue, no logout/login dance.

import { NextResponse } from "next/server";
import { notFound } from "next/navigation";
import { prisma } from "./prisma";
import { getSession } from "./auth";
import type { FeatureKey } from "./features";
import type { SessionPayload } from "./auth";

// Per-request lookup. Phase 5 will layer React.cache() at the call site for
// SSR pages that hit this multiple times; we keep this function dependency-free
// so it's safe to call from tests, scripts, and route handlers alike.
export async function getOrgFeatures(orgId: string): Promise<Set<FeatureKey>> {
  const rows = await prisma.orgFeature.findMany({
    where: { orgId, enabled: true },
    select: { featureKey: true },
  });
  return new Set(rows.map((r) => r.featureKey as FeatureKey));
}

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
export async function getOrgIdForCentre(centreId: string | null | undefined): Promise<string | null> {
  if (!centreId) return null;
  const c = await prisma.centre.findUnique({ where: { id: centreId }, select: { orgId: true } });
  return c?.orgId ?? null;
}

// Resolve the tenant orgId for a session. SUPER_ADMIN (centreId=null) falls
// back to the first centre under any organisation — this is fine because today
// every SUPER_ADMIN runs exactly one tenant; multi-tenant super admins don't
// exist (PLATFORM_OWNER does that job).
export async function getOrgIdForSession(session: SessionPayload | null): Promise<string | null> {
  if (!session) return null;
  if (session.centreId) return getOrgIdForCentre(session.centreId);
  if (session.role === "SUPER_ADMIN") {
    const first = await prisma.centre.findFirst({ select: { orgId: true } });
    return first?.orgId ?? null;
  }
  // PARENT has no centreId but is linked to riders via ParentLink → centre → org.
  if (session.role === "PARENT") {
    const link = await prisma.parentLink.findFirst({
      where: { parentUserId: session.userId },
      select: { rider: { select: { centre: { select: { orgId: true } } } } },
    });
    return link?.rider.centre.orgId ?? null;
  }
  // RIDER has no centreId on the session, but Rider.userId points to them.
  if (session.role === "RIDER") {
    const rider = await prisma.rider.findFirst({
      where: { userId: session.userId },
      select: { centre: { select: { orgId: true } } },
    });
    return rider?.centre.orgId ?? null;
  }
  return null;
}

// Convenience for layouts/pages/components that need the active feature set.
// Returns an empty set if the session can't resolve to an org (e.g. orphaned
// PARENT user); callers should treat that as "no features available".
export async function getFeaturesForSession(session: SessionPayload | null): Promise<Set<FeatureKey>> {
  const orgId = await getOrgIdForSession(session);
  if (!orgId) return new Set();
  return getOrgFeatures(orgId);
}

// Uniform 403 for routes that have to refuse because a feature is off. Wraps
// the response so the client can render a "this isn't on your plan" surface
// rather than a generic error.
export function featureDeniedResponse(key: FeatureKey) {
  return NextResponse.json(
    { error: "FEATURE_DISABLED", featureKey: key },
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
