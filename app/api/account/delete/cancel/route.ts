import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";

// POST /api/account/delete/cancel — withdraw a pending deletion. The
// session resolver rejects users with deletionRequestedAt set, so the
// usual getSession() flow won't reach here for an already-marked user.
// We use a separate query that ignores the deletion gate, then verify
// the JWT belongs to a marked user before clearing the flag.
export async function POST() {
  const session = await getSession();
  if (session) {
    // Already in active state — nothing to cancel.
    return NextResponse.json({ ok: true, already: "active" });
  }

  // The cookie may still be valid for a user whose row is marked for
  // deletion — getSession() returned null because of the deletion gate.
  // We re-read the cookie + verify the JWT signature ourselves and check
  // the row.
  const { cookies } = await import("next/headers");
  const token = cookies().get("ew_session")?.value;
  if (!token) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const { verifySession } = await import("@/lib/auth");
  const payload = await verifySession(token);
  if (!payload) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, deletionRequestedAt: true, status: true },
  });
  if (!user) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (!user.deletionRequestedAt) {
    return NextResponse.json({ error: "NOT_PENDING" }, { status: 409 });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { deletionRequestedAt: null, tokenVersion: { increment: 1 } },
  });
  await audit({
    userId: user.id,
    action: "account.deletion_cancelled",
    tableName: "user",
    rowId: user.id,
  });

  return NextResponse.json({ ok: true });
}
