import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, verifyPassword, hashPassword, signSession, setSessionCookie } from "@/lib/auth";
import { CLEAR_ISSUED_CREDENTIAL } from "@/lib/issued-credential";
import { audit } from "@/lib/audit";
import { changePasswordSchema } from "@/lib/schemas/account";
import { checkPasswordPolicy } from "@/lib/password-policy";

// POST /api/account/change-password — self-service password rotation.
// Verifies the current password before writing the new hash; returns
// BAD_CURRENT_PASSWORD (401) on mismatch so the client can highlight the right
// field. Audit row records the change without storing either password.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = changePasswordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const me = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { passwordHash: true },
  });
  if (!me) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const ok = await verifyPassword(parsed.data.currentPassword, me.passwordHash);
  if (!ok) return NextResponse.json({ error: "BAD_CURRENT_PASSWORD" }, { status: 401 });

  const policy = checkPasswordPolicy(parsed.data.newPassword);
  if (!policy.ok) {
    return NextResponse.json({ error: "WEAK_PASSWORD", message: policy.reason }, { status: 400 });
  }

  const newHash = await hashPassword(parsed.data.newPassword);
  const updated = await prisma.user.update({
    where: { id: session.userId },
    // The user has chosen their own password, so the issued temp is no
    // longer on this account — forget it, or the handover sheet would show
    // a password that no longer works AND outlive its one legitimate use.
    data: {
      passwordHash: newHash,
      mustChangePassword: false,
      tokenVersion: { increment: 1 },
      ...CLEAR_ISSUED_CREDENTIAL,
    },
    select: { tokenVersion: true, centreId: true, name: true },
  });

  // Bumping tokenVersion signs out every other device — that's the point of a
  // password change. But it also kills THIS session, because getSession()
  // compares the cookie's tokenVersion against the row. Without re-minting
  // here, the very next request resolved to a null session and every layout
  // bounced the user to /login?ended=1: on the forced-rotation path a brand-new
  // staff member set their password, saw "welcome", and was thrown straight
  // back to the sign-in screen. Re-issue with the same claims and the new
  // version so the device that did the change stays signed in.
  await setSessionCookie(
    await signSession({
      userId: session.userId,
      role: session.role,
      centreId: updated.centreId,
      name: updated.name,
      tokenVersion: updated.tokenVersion,
      // Carry impersonation markers forward — an owner who rotates a password
      // mid-impersonation must keep the marker (and its expiry), not shed it.
      ...(session.impersonatedBy ? { impersonatedBy: session.impersonatedBy } : {}),
      ...(session.impersonationExpiresAt
        ? { impersonationExpiresAt: session.impersonationExpiresAt }
        : {}),
    }),
  );

  await audit({
    userId: session.userId,
    action: "account.password_changed",
    tableName: "user",
    rowId: session.userId,
  });

  return NextResponse.json({ ok: true });
}
