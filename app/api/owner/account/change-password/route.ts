import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getOwnerSession,
  hashOwnerPassword,
  verifyOwnerPassword,
  signOwnerSession,
  setOwnerSessionCookie,
} from "@/lib/owner-auth";
import { auditOwner } from "@/lib/owner-audit";
import { changePasswordSchema } from "@/lib/schemas/account";
import { checkPasswordPolicy } from "@/lib/password-policy";

export async function POST(req: NextRequest) {
  const session = await getOwnerSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = changePasswordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const me = await prisma.platformUser.findUnique({
    where: { id: session.ownerId },
    select: { passwordHash: true },
  });
  if (!me) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const ok = await verifyOwnerPassword(parsed.data.currentPassword, me.passwordHash);
  if (!ok) return NextResponse.json({ error: "BAD_CURRENT_PASSWORD" }, { status: 401 });

  const policy = checkPasswordPolicy(parsed.data.newPassword);
  if (!policy.ok) {
    return NextResponse.json({ error: "WEAK_PASSWORD", message: policy.reason }, { status: 400 });
  }

  const newHash = await hashOwnerPassword(parsed.data.newPassword);
  const updated = await prisma.platformUser.update({
    where: { id: session.ownerId },
    data: { passwordHash: newHash, tokenVersion: { increment: 1 } },
    select: { tokenVersion: true, name: true },
  });

  // Same reasoning as the tenant route: the tokenVersion bump that signs out
  // the owner's other devices also invalidates the cookie in front of us, so
  // re-mint it or the owner is dumped on /owner/login the moment they navigate.
  await setOwnerSessionCookie(
    await signOwnerSession({
      ownerId: session.ownerId,
      role: session.role,
      name: updated.name,
      tokenVersion: updated.tokenVersion,
    }),
  );

  await auditOwner({
    actorId: session.ownerId,
    action: "owner.account_password_changed",
    orgId: null,
  });

  return NextResponse.json({ ok: true });
}
