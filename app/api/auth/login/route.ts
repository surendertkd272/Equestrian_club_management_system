import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { emailIdentity } from "@/lib/email-normalize";
import { prisma } from "@/lib/prisma";
import { verifyPassword, equalizePasswordTiming } from "@/lib/auth";
import { peekRate, recordFailure, clearRate, clientFingerprint } from "@/lib/rate-limit";
import { twoFactorGate, finishSignIn, accountStateGate, auditSignIn } from "@/lib/sign-in";

const schema = z.object({
  email: emailIdentity(),
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
  const data = parsed.data;

  // Two-axis throttle: per-IP AND per-ACCOUNT. The IP cap stops one source
  // hammering many accounts; the account cap stops many sources hammering one.
  //
  // The account key used to be `${ip}:${email}`, which meant credential
  // stuffing spread across IPs got a fresh allowance per IP and the account
  // axis caught nothing. It is keyed on the address alone now.
  //
  // Only FAILURES count, and a success clears the account counter — otherwise a
  // busy centre signing in all morning throttles itself while costing a guesser
  // nothing.
  const WINDOW_MS = 15 * 60_000;
  const ipKey = `login:ip:${clientFingerprint(req)}`;
  const emailKey = `login:em:${data.email}`;

  // Bypass when NEXT_PUBLIC_SHOW_TEST_DROPDOWN=1 (UAT/demo deployments) —
  // testers click "Sign in" against the same seeded account dozens of
  // times in a row. The same env var that exposes the dropdown signals
  // "this isn't a production install" — flipping both together avoids drift.
  const skipRateLimit = process.env.NEXT_PUBLIC_SHOW_TEST_DROPDOWN === "1";

  // Charge a failed attempt against both axes and answer with the shared
  // "wrong credentials" body — every caller below funnels through here so no
  // failure path can forget to count.
  async function failCredentials(reason: string, userId?: string) {
    if (!skipRateLimit) {
      await Promise.all([recordFailure(ipKey, WINDOW_MS), recordFailure(emailKey, WINDOW_MS)]);
    }
    await auditSignIn("failed", { userId, email: data.email, reason, req });
    return NextResponse.json({ error: "INVALID_CREDENTIALS" }, { status: 401 });
  }

  if (!skipRateLimit) {
    for (const [key, limit] of [[ipKey, 20], [emailKey, 10]] as const) {
      const check = await peekRate(key, limit, WINDOW_MS);
      if (!check.ok) {
        return NextResponse.json(
          { error: "RATE_LIMITED", retryAfterSec: check.retryAfterSec },
          { status: 429, headers: { "Retry-After": String(check.retryAfterSec) } },
        );
      }
    }
  }

  const user = await prisma.user.findUnique({
    where: { email: data.email },
    include: {
      centre: { select: { org: { select: { status: true, name: true } } } },
      org: { select: { status: true, name: true } },
    },
  });
  if (!user || user.status !== "active") {
    // Spend the same bcrypt round a real comparison costs before answering, so
    // the response time doesn't distinguish "no such account" from "wrong
    // password" the way the identical response bodies already refuse to.
    await equalizePasswordTiming();
    return failCredentials(user ? "inactive" : "unknown_email");
  }
  const ok = await verifyPassword(data.password, user.passwordHash);
  if (!ok) return failCredentials("bad_password", user.id);

  // Account-state block (pending deletion) — credentials are right but a
  // session can't exist for this user. Shared with the OTP path.
  const state = accountStateGate(user);
  if (state) return state;

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
  const twoFa = await twoFactorGate(user, { totpCode: data.totpCode, recoveryCode: data.recoveryCode });
  if (twoFa) {
    // A wrong second factor is a failed attempt and has to cost something —
    // otherwise a stolen password buys unlimited guesses at the 6-digit code.
    // The challenge itself (no code supplied yet) is not a failure.
    const body = (await twoFa.clone().json().catch(() => null)) as { error?: string } | null;
    if (body?.error === "TWO_FACTOR_INVALID" || body?.error === "TWO_FACTOR_REPLAY") {
      if (!skipRateLimit) {
        await Promise.all([recordFailure(ipKey, WINDOW_MS), recordFailure(emailKey, WINDOW_MS)]);
      }
      await auditSignIn("failed", {
        userId: user.id,
        email: data.email,
        reason: body.error === "TWO_FACTOR_REPLAY" ? "totp_replay" : "bad_totp",
        req,
      });
    }
    return twoFa;
  }

  // Signed in — forgive the account's earlier fumbles so a user who mistypes
  // and then succeeds isn't left one slip from a lockout. The IP counter
  // stands: on a shared NAT it isn't this user's to clear.
  if (!skipRateLimit) await clearRate(emailKey);
  return finishSignIn(user, req);
}
