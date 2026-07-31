import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { emailIdentity } from "@/lib/email-normalize";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth";
import { peekEmailVerifyCode, consumeEmailVerifyCode } from "@/lib/email-verify";
import { checkRate, clientFingerprint } from "@/lib/rate-limit";
import { twoFactorGate } from "@/lib/sign-in";
import { audit } from "@/lib/audit";

// POST /api/auth/cancel-deletion — public, credential-authenticated.
//
// A user inside the DPDPA grace window cannot hold a session: getSession()
// nulls it (lib/auth.ts) the moment deletionRequestedAt is set. That left
// /api/account/delete/cancel — which needs a live cookie to reach — as the only
// way to withdraw a deletion request, i.e. no way at all. The 30-day
// "you can change your mind" window existed on paper only.
//
// This endpoint re-proves exactly what the sign-in flow demands (password OR a
// current emailed sign-in code, plus any enrolled second factor) and clears the
// flag WITHOUT minting a session. The user then signs in normally.
//
// Accepting the emailed code as well as the password matters: OTP sign-in is
// the path for people who've forgotten their password, and one of them being
// unable to rescue their own account is the exact failure this fixes.
const schema = z
  .object({
    email: emailIdentity(),
    password: z.string().min(1).optional(),
    // 6-digit emailed sign-in code, as issued by /api/auth/otp/request.
    code: z.string().regex(/^\d{6}$/).optional(),
    totpCode: z.string().regex(/^\d{6}$/).optional(),
    recoveryCode: z.string().min(4).max(40).optional(),
  })
  .refine((d) => !!d.password || !!d.code, { message: "CREDENTIAL_REQUIRED" });

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });

  // Keyed on email alone (not ip+email) so spreading across IPs doesn't reset
  // the per-account cap — the mistake the tenant login key still makes.
  const ip = clientFingerprint(req);
  const ipCheck = await checkRate(`cancel-del:ip:${ip}`, 10, 15 * 60_000);
  if (!ipCheck.ok) {
    return NextResponse.json(
      { error: "RATE_LIMITED", retryAfterSec: ipCheck.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(ipCheck.retryAfterSec) } },
    );
  }
  const emCheck = await checkRate(`cancel-del:em:${parsed.data.email}`, 5, 15 * 60_000);
  if (!emCheck.ok) {
    return NextResponse.json(
      { error: "RATE_LIMITED", retryAfterSec: emCheck.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(emCheck.retryAfterSec) } },
    );
  }

  // Resolve the user via whichever credential was supplied. The code path
  // peeks (doesn't consume) so a second-factor challenge below doesn't burn it.
  let userId: string;
  let peekedTokenId: string | null = null;
  if (parsed.data.code) {
    const peek = await peekEmailVerifyCode(parsed.data.email, parsed.data.code);
    if (!peek.ok) {
      const status = peek.error === "CODE_EXPIRED" ? 410 : peek.error === "TOO_MANY_ATTEMPTS" ? 429 : 400;
      return NextResponse.json({ error: peek.error }, { status });
    }
    userId = peek.userId;
    peekedTokenId = peek.tokenId;
  } else {
    // Exact-match lookup, mirroring /api/auth/login — the caller is passing the
    // same address that just authenticated there.
    const byEmail = await prisma.user.findUnique({
      where: { email: parsed.data.email },
      select: { id: true, passwordHash: true, status: true },
    });
    if (!byEmail || byEmail.status !== "active") {
      return NextResponse.json({ error: "INVALID_CREDENTIALS" }, { status: 401 });
    }
    if (!(await verifyPassword(parsed.data.password!, byEmail.passwordHash))) {
      return NextResponse.json({ error: "INVALID_CREDENTIALS" }, { status: 401 });
    }
    userId = byEmail.id;
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.status !== "active") {
    return NextResponse.json({ error: "INVALID_CREDENTIALS" }, { status: 401 });
  }
  if (!user.deletionRequestedAt) {
    return NextResponse.json({ error: "NOT_PENDING" }, { status: 409 });
  }

  // Same second factor the sign-in paths demand — clearing the flag is a
  // full-strength account action, not a lesser one.
  const twoFa = await twoFactorGate(user, {
    totpCode: parsed.data.totpCode,
    recoveryCode: parsed.data.recoveryCode,
  });
  if (twoFa) return twoFa;

  if (peekedTokenId) {
    const consumed = await consumeEmailVerifyCode(peekedTokenId, user.id);
    if (!consumed) return NextResponse.json({ error: "CODE_USED" }, { status: 400 });
  }

  // Bump tokenVersion on the way out: the request endpoint bumped it to kill
  // live sessions, and we do the same so nothing minted in between survives.
  await prisma.user.update({
    where: { id: user.id },
    data: { deletionRequestedAt: null, tokenVersion: { increment: 1 } },
  });
  await audit({
    userId: user.id,
    action: "account.deletion_cancelled",
    tableName: "user",
    rowId: user.id,
    before: { deletionRequestedAt: user.deletionRequestedAt },
  });

  return NextResponse.json({ ok: true });
}
