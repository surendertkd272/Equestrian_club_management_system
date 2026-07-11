import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth";
import { checkRate, clientFingerprint } from "@/lib/rate-limit";
import { twoFactorGate, finishSignIn } from "@/lib/sign-in";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  // Optional second factor for 2FA-enrolled users. The client posts it
  // alongside email+password; we surface a 401/TWO_FACTOR_REQUIRED if
  // a 2FA-enrolled user omits it.
  totpCode: z.string().regex(/^\d{6}$/).optional(),
  recoveryCode: z.string().min(4).max(40).optional(),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });

  // Two-axis throttle: per-IP AND per-(IP,email). The IP cap stops broad
  // distributed brute force; the email cap protects a single account
  // from credential stuffing.
  //
  // Bypass when NEXT_PUBLIC_SHOW_TEST_DROPDOWN=1 (UAT/demo deployments) —
  // testers click "Sign in" against the same seeded account dozens of
  // times in a row and the per-(IP,email) cap of 5/15min hits very fast.
  // The same env var that exposes the dropdown signals "this isn't a
  // production install" — flipping both together avoids drift.
  const skipRateLimit = process.env.NEXT_PUBLIC_SHOW_TEST_DROPDOWN === "1";
  if (!skipRateLimit) {
    const ip = clientFingerprint(req);
    const ipCheck = checkRate(`login:ip:${ip}`, 20, 15 * 60_000);
    if (!ipCheck.ok) {
      return NextResponse.json(
        { error: "RATE_LIMITED", retryAfterSec: ipCheck.retryAfterSec },
        { status: 429, headers: { "Retry-After": String(ipCheck.retryAfterSec) } },
      );
    }
    const emailCheck = checkRate(`login:em:${ip}:${parsed.data.email.toLowerCase()}`, 5, 15 * 60_000);
    if (!emailCheck.ok) {
      return NextResponse.json(
        { error: "RATE_LIMITED", retryAfterSec: emailCheck.retryAfterSec },
        { status: 429, headers: { "Retry-After": String(emailCheck.retryAfterSec) } },
      );
    }
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    include: {
      centre: { select: { org: { select: { status: true, name: true } } } },
      org: { select: { status: true, name: true } },
    },
  });
  if (!user || user.status !== "active") {
    return NextResponse.json({ error: "INVALID_CREDENTIALS" }, { status: 401 });
  }
  const ok = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!ok) return NextResponse.json({ error: "INVALID_CREDENTIALS" }, { status: 401 });

  // Org-suspended block — credentials are valid but the tenant has been
  // suspended by the platform team (overdue billing, terms violation, etc).
  // We return a distinct error so the login UI can render an explanatory
  // banner instead of "wrong password". Centre-scoped users derive the
  // org via centre.org; HQ users (SUPER_ADMIN) use the new User.org
  // direct link. Legacy SUPER_ADMINs without either still sign in.
  const orgRef = user.centre?.org ?? user.org;
  if (orgRef?.status === "suspended") {
    return NextResponse.json(
      { error: "ACCOUNT_SUSPENDED", message: `${orgRef.name} is currently suspended. Please contact your administrator.` },
      { status: 403 },
    );
  }

  // 2FA gate + session mint are shared with the passwordless OTP login path
  // (lib/sign-in.ts) so the two can't drift.
  const twoFa = await twoFactorGate(user, { totpCode: parsed.data.totpCode, recoveryCode: parsed.data.recoveryCode });
  if (twoFa) return twoFa;
  return finishSignIn(user);
}
