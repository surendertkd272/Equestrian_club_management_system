import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { clearSessionCookie, getSession } from "@/lib/auth";
import {
  setOwnerSessionCookie,
  signOwnerSession,
  type OwnerRole,
} from "@/lib/owner-auth";
import { auditOwner } from "@/lib/owner-audit";

// POST /api/owner/impersonate/stop — leave an impersonation session and
// restore the original owner cookie. Reads `session.impersonatedBy` to know
// who to mint the owner session back to.
//
// Idempotent: if there's no tenant session or no impersonation marker, returns
// 200 with `notImpersonating: true` so the UI can just navigate to /owner.
export async function POST() {
  const session = await getSession();
  if (!session?.impersonatedBy) {
    return NextResponse.json({ ok: true, notImpersonating: true });
  }

  const owner = await prisma.platformUser.findUnique({
    where: { id: session.impersonatedBy },
    select: { id: true, name: true, role: true, status: true, tokenVersion: true },
  });

  // Clear the tenant session unconditionally — the impersonation is over.
  await clearSessionCookie();

  if (!owner || owner.status !== "active") {
    // Original owner is gone or suspended; force them to log in fresh.
    return NextResponse.json({ ok: true, redirect: "/owner/login" });
  }

  // tokenVersion is NOT optional here. Minting the restored session without it
  // used to make getOwnerSession skip its status/revocation re-check for the
  // whole life of the cookie — so an owner suspended or password-reset while
  // they were impersonating walked back out with a session nobody could revoke.
  const token = await signOwnerSession({
    ownerId: owner.id,
    role: owner.role as OwnerRole,
    name: owner.name,
    tokenVersion: owner.tokenVersion,
  });
  await setOwnerSessionCookie(token);

  await auditOwner({
    actorId: owner.id,
    action: "owner.impersonation_stopped",
    after: { restoredOwnerId: owner.id },
  });

  return NextResponse.json({ ok: true, redirect: "/owner" });
}
