import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashOwnerPassword } from "@/lib/owner-auth";
import { redeemOwnerResetToken } from "@/lib/owner-password-reset";
import { checkPasswordPolicy } from "@/lib/password-policy";

const schema = z.object({
  token: z.string().min(10),
  newPassword: z.string().min(8).max(200),
});

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

  const claim = await redeemOwnerResetToken(parsed.data.token);
  if (!claim.ok) {
    const status = claim.error === "TOKEN_EXPIRED" ? 410 : 400;
    return NextResponse.json({ error: claim.error }, { status });
  }

  const newHash = await hashOwnerPassword(parsed.data.newPassword);
  await prisma.platformUser.update({
    where: { id: claim.ownerId },
    data: { passwordHash: newHash, tokenVersion: { increment: 1 } },
  });

  await prisma.platformAuditLog.create({
    data: {
      actorId: claim.ownerId,
      action: "owner.password_reset_redeemed",
      after: JSON.stringify({ at: new Date().toISOString() }),
    },
  });

  return NextResponse.json({ ok: true });
}
