import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getOwnerSession } from "@/lib/owner-auth";
import { generateRecoveryCodes, hashRecoveryCode, verifyTotp } from "@/lib/totp";

// POST /api/owner/account/totp/recovery-codes — regenerate the 8 one-shot
// recovery codes for the signed-in owner. Used when the user has consumed
// most of the existing codes (or believes the printout was exposed). A
// fresh 6-digit TOTP code is required so a passive cookie thief can't
// silently rotate codes without the authenticator. The plaintext set is
// returned once; only hashes are persisted, mirroring the enrollment flow.
const schema = z.object({ code: z.string().regex(/^\d{6}$/) });

export async function POST(req: NextRequest) {
  const session = await getOwnerSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });

  const owner = await prisma.platformUser.findUnique({
    where: { id: session.ownerId },
    select: { twoFactor: true, totpSecret: true },
  });
  if (!owner?.twoFactor || !owner.totpSecret) {
    return NextResponse.json({ error: "NOT_ENROLLED" }, { status: 409 });
  }
  if (!verifyTotp(owner.totpSecret, parsed.data.code)) {
    return NextResponse.json({ error: "BAD_CODE" }, { status: 400 });
  }

  const recoveryPlain = generateRecoveryCodes(8);
  const recoveryHashes = recoveryPlain.map(hashRecoveryCode);
  await prisma.platformUser.update({
    where: { id: session.ownerId },
    data: { totpRecoveryCodesJson: JSON.stringify(recoveryHashes) },
  });
  await prisma.platformAuditLog.create({
    data: { actorId: session.ownerId, action: "owner.2fa_recovery_regenerated" },
  });

  return NextResponse.json({ ok: true, recoveryCodes: recoveryPlain });
}
