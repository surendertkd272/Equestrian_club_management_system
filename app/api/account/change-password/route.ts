import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, verifyPassword, hashPassword } from "@/lib/auth";
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
  await prisma.user.update({
    where: { id: session.userId },
    data: { passwordHash: newHash, mustChangePassword: false, tokenVersion: { increment: 1 } },
  });

  await audit({
    userId: session.userId,
    action: "account.password_changed",
    tableName: "user",
    rowId: session.userId,
  });

  return NextResponse.json({ ok: true });
}
