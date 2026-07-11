// Passwordless sign-in — step 2: verify the emailed code and mint a session.
// Reuses the shared 2FA gate + session ceremony (lib/sign-in.ts), so a
// 2FA-enrolled account STILL needs its authenticator code — email possession
// alone can't bypass 2FA. The code is peeked (not consumed) until 2FA passes,
// so a 2FA user's code survives the TWO_FACTOR_REQUIRED round-trip.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { peekEmailVerifyCode, consumeEmailVerifyCode } from "@/lib/email-verify";
import { checkRate, clientFingerprint } from "@/lib/rate-limit";
import { twoFactorGate, finishSignIn } from "@/lib/sign-in";

const schema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/, "6 digits"),
  totpCode: z.string().regex(/^\d{6}$/).optional(),
  recoveryCode: z.string().min(4).max(40).optional(),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });

  const ip = clientFingerprint(req);
  const email = parsed.data.email.toLowerCase();
  // Defence-in-depth on top of the per-code 5-attempt cap: bound how many codes
  // an attacker can burn through against one email/IP.
  if (!checkRate(`otp-verify:ip:${ip}`, 20, 15 * 60_000).ok) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }
  if (!checkRate(`otp-verify:em:${ip}:${email}`, 10, 15 * 60_000).ok) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }

  // Peek — validates + increments attempts on a wrong code, but does NOT
  // consume, so a 2FA challenge below doesn't burn the code.
  const peek = await peekEmailVerifyCode(email, parsed.data.code);
  if (!peek.ok) {
    const status = peek.error === "CODE_EXPIRED" ? 410 : peek.error === "TOO_MANY_ATTEMPTS" ? 429 : 400;
    return NextResponse.json({ error: peek.error }, { status });
  }

  const user = await prisma.user.findUnique({
    where: { id: peek.userId },
    include: {
      centre: { select: { org: { select: { status: true, name: true } } } },
      org: { select: { status: true, name: true } },
    },
  });
  if (!user || user.status !== "active") return NextResponse.json({ error: "INVALID_CODE" }, { status: 400 });

  // Suspended-tenant block (same as password login).
  const orgRef = user.centre?.org ?? user.org;
  if (orgRef?.status === "suspended") {
    return NextResponse.json(
      { error: "ACCOUNT_SUSPENDED", message: `${orgRef.name} is currently suspended. Please contact your administrator.` },
      { status: 403 },
    );
  }

  // 2FA gate BEFORE consuming the code (so the code survives a TOTP round-trip).
  const twoFa = await twoFactorGate(user, { totpCode: parsed.data.totpCode, recoveryCode: parsed.data.recoveryCode });
  if (twoFa) return twoFa;

  const consumed = await consumeEmailVerifyCode(peek.tokenId, user.id);
  if (!consumed) return NextResponse.json({ error: "CODE_USED" }, { status: 400 });

  return finishSignIn(user);
}
