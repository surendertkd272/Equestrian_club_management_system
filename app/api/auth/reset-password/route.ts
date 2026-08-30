import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { CLEAR_ISSUED_CREDENTIAL } from "@/lib/issued-credential";
import { redeemResetToken } from "@/lib/password-reset";
import { audit } from "@/lib/audit";
import { checkPasswordPolicy } from "@/lib/password-policy";

const schema = z.object({
  token: z.string().min(10),
  newPassword: z.string().min(8).max(200),
});

// POST /api/auth/reset-password — public.
// Redeems a forgot-password token: validates + single-uses it, writes the
// new hash, clears mustChangePassword. The route does NOT log the user in —
// we want them to consciously sign in with their new credentials so a
// stolen-phone attacker can't ride straight in via the email link.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const policy = checkPasswordPolicy(parsed.data.newPassword);
  if (!policy.ok) {
    return NextResponse.json({ error: "WEAK_PASSWORD", message: policy.reason }, { status: 400 });
  }

  const claim = await redeemResetToken(parsed.data.token);
  if (!claim.ok) {
    const status = claim.error === "TOKEN_EXPIRED" ? 410 : 400;
    return NextResponse.json({ error: claim.error }, { status });
  }

  const newHash = await hashPassword(parsed.data.newPassword);
  // Bump tokenVersion so any active JWT (e.g. a stolen cookie) is
  // immediately rejected by getSession(). The user has to sign in fresh
  // with the new password.
  await prisma.user.update({
    where: { id: claim.userId },
    data: {
      passwordHash: newHash,
      mustChangePassword: false,
      tokenVersion: { increment: 1 },
      // Self-chosen via the reset link — drop the issued temp.
      ...CLEAR_ISSUED_CREDENTIAL,
    },
  });

  await audit({
    userId: claim.userId,
    action: "auth.forgot_password_redeemed",
    tableName: "user",
    rowId: claim.userId,
  });

  return NextResponse.json({ ok: true });
}
