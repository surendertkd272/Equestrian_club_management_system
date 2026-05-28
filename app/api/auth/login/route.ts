import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { setSessionCookie, signSession, verifyPassword } from "@/lib/auth";
import { isRole } from "@/lib/roles";
import { checkRate, clientFingerprint } from "@/lib/rate-limit";
import { verifyTotp, hashRecoveryCode } from "@/lib/totp";

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
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }
  const ok = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!ok) return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });

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

  if (!isRole(user.role)) {
    return NextResponse.json({ error: "User role is invalid; contact admin." }, { status: 500 });
  }

  // Tenant 2FA gate. If the user is enrolled, require a valid TOTP
  // code OR a one-shot recovery code. The login form posts the same
  // payload back with the code attached, so this is a single-request
  // ceremony from the user's POV (no separate /2fa POST).
  if (user.twoFactor && user.totpSecret) {
    const supplied = parsed.data.totpCode;
    const recovery = parsed.data.recoveryCode?.trim();
    if (!supplied && !recovery) {
      return NextResponse.json({ error: "TWO_FACTOR_REQUIRED" }, { status: 401 });
    }
    let okFactor = false;
    if (supplied && verifyTotp(user.totpSecret, supplied)) {
      okFactor = true;
    } else if (recovery && user.totpRecoveryCodesJson) {
      // totpRecoveryCodesJson is a jsonb column — Prisma returns the parsed
      // array directly. Narrow before treating as string[]; bad data → bail.
      const stored = user.totpRecoveryCodesJson as unknown;
      const hashes: string[] = Array.isArray(stored)
        ? stored.filter((x): x is string => typeof x === "string")
        : [];
      const matchHash = hashRecoveryCode(recovery);
      if (hashes.includes(matchHash)) {
        // Consume — remove the hash so it can't be re-used. Empty array →
        // Prisma.DbNull to clear the column entirely.
        const remaining = hashes.filter((h) => h !== matchHash);
        await prisma.user.update({
          where: { id: user.id },
          data: { totpRecoveryCodesJson: remaining.length === 0 ? Prisma.DbNull : remaining },
        });
        okFactor = true;
      }
    }
    if (!okFactor) {
      return NextResponse.json({ error: "TWO_FACTOR_INVALID" }, { status: 401 });
    }
  }

  const token = await signSession({
    userId: user.id,
    role: user.role,
    centreId: user.centreId ?? null,
    name: user.name,
    tokenVersion: user.tokenVersion,
  });
  await setSessionCookie(token);

  // Force-rotation: when HQ generated this user's password (create + reset +
  // forgot-password redeem), `mustChangePassword` stays true. Send them
  // straight to /account/rotate; the page is gated and prevents reaching
  // anywhere else until the new password is set.
  if (user.mustChangePassword) {
    return NextResponse.json({ ok: true, redirect: "/account/rotate" });
  }

  // Tell the client where to send the user. Each portal-owning role gets its own
  // landing page; staff fall through to /dashboard. The login form falls back to
  // /dashboard if `redirect` is missing, so older client builds still work.
  const redirect =
    user.role === "PARENT" ? "/parent"
    : user.role === "RIDER" ? "/student"
    : user.role === "SCHOOL_ADMINISTRATOR" ? "/school"
    : "/dashboard";
  return NextResponse.json({ ok: true, redirect });
}
