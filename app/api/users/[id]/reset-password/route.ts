import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getSession, hashPassword } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { callerSharesOrgWithUser } from "@/lib/authz-org";

// POST /api/users/[id]/reset-password — HQ generates a fresh temporary password
// for a user (typical scenario: parent lost their first-login password).
// The plaintext temp is returned ONCE in the response. After this call it's not
// retrievable — the user is expected to sign in and rotate it from /account.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (session.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const target = await prisma.user.findUnique({ where: { id: params.id }, select: { id: true, email: true } });
  if (!target) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (!(await callerSharesOrgWithUser(session, target.id))) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_ORG" }, { status: 403 });
  }

  // 12 bytes base64url ≈ 16 chars; safe to copy/paste in WhatsApp/email.
  const tempPassword = crypto.randomBytes(12).toString("base64url");
  const passwordHash = await hashPassword(tempPassword);

  await prisma.user.update({
    where: { id: target.id },
    data: { passwordHash, mustChangePassword: true },
  });

  await audit({
    userId: session.userId,
    action: "user.reset_password",
    tableName: "user",
    rowId: target.id,
    after: { email: target.email },
  });

  return NextResponse.json({ ok: true, tempPassword });
}
