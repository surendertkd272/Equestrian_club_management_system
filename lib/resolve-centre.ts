import { NextResponse } from "next/server";
import { scopeCentre } from "./tenancy";
import { getOrgIdForSession, getOrgIdForCentre } from "./features-gate";
import type { SessionPayload } from "./auth";

// Resolve which centre a WRITE (create/import) should target, the same way
// every page resolves the centre it renders:
//   • centre-scoped roles  → their own centre (session.centreId).
//   • HQ roles (SUPER_ADMIN / ADMIN, centreId=null) → the top-bar centre
//     picker via scopeCentre() (the `ew_hq_centre` cookie), with an explicit
//     body.centreId as a fallback for forms that carry their own picker.
//
// Why this exists: reading `session.centreId ?? body.centreId` directly is a
// repeated footgun — HQ users always have centreId=null and most forms don't
// send a centreId, so those writes 400'd for HQ even with a centre picked in
// the top bar (hit on Add Staff, Add Horse, Teams, Training, …). Centralising
// it means new write routes get the correct behaviour + cross-org guard for
// free, and the failure message is human instead of a bare code.
//
// Returns { centreId } on success, or { error } (a ready-to-return NextResponse)
// that the caller should return as-is.
export async function resolveWriteCentre(
  session: SessionPayload,
  body: unknown,
): Promise<{ centreId: string; error?: never } | { centreId?: never; error: NextResponse }> {
  let scoped: string | null;
  try {
    scoped = scopeCentre(session);
  } catch {
    // scopeCentre throws for a centre-less non-HQ user — they have no centre
    // to write against.
    return { error: NextResponse.json({ error: "NO_CENTRE" }, { status: 400 }) };
  }

  const fromBody =
    body && typeof body === "object" && typeof (body as { centreId?: unknown }).centreId === "string"
      ? ((body as { centreId?: string }).centreId as string)
      : "";
  const centreId = scoped ?? (fromBody || null);

  if (!centreId) {
    return {
      error: NextResponse.json(
        {
          error: "NO_CENTRE_SELECTED",
          message: "Pick a specific centre from the top-bar centre selector (not “All centres”), then try again.",
        },
        { status: 400 },
      ),
    };
  }

  // Cross-org guard: the resolved centre must belong to the caller's org
  // (covers a stale picker cookie or a hand-crafted body.centreId; a
  // nonexistent centre yields a null org and is rejected).
  const [callerOrg, centreOrg] = await Promise.all([
    getOrgIdForSession(session),
    getOrgIdForCentre(centreId),
  ]);
  if (!callerOrg || !centreOrg || callerOrg !== centreOrg) {
    return { error: NextResponse.json({ error: "FORBIDDEN_CROSS_ORG" }, { status: 403 }) };
  }

  return { centreId };
}
