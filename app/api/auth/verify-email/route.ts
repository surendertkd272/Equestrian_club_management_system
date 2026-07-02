import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { redeemEmailVerifyCode } from "@/lib/email-verify";
import { audit } from "@/lib/audit";
import { checkRate, clientFingerprint } from "@/lib/rate-limit";

// Public endpoint. Browser submits the email + 6-digit code from the
// verification email; we flip emailVerifiedAt on success. Idempotent within
// the single-use guard — once consumed, the code can't be re-used, but a
// user who lost/expired theirs can re-issue via /api/auth/verify-email/resend.
//
// Rate-limited in addition to the per-code attempt cap in redeemEmailVerifyCode
// (5 tries per issued code) — this bounds how many DISTINCT codes an attacker
// can burn through against one email/IP before backing off.
const schema = z.object({ email: z.string().email(), code: z.string().regex(/^\d{6}$/, "6 digits") });

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
  }

  const ip = clientFingerprint(req);
  if (!checkRate(`verify-code:ip:${ip}`, 20, 60 * 60_000).ok) {
    return NextResponse.json({ error: "TOO_MANY_ATTEMPTS" }, { status: 429 });
  }
  if (!checkRate(`verify-code:em:${parsed.data.email.toLowerCase()}`, 10, 60 * 60_000).ok) {
    return NextResponse.json({ error: "TOO_MANY_ATTEMPTS" }, { status: 429 });
  }

  const result = await redeemEmailVerifyCode(parsed.data.email, parsed.data.code);
  if (!result.ok) {
    const status = result.error === "CODE_EXPIRED" ? 410 : result.error === "TOO_MANY_ATTEMPTS" ? 429 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  await audit({
    userId: result.userId,
    action: "auth.email_verified",
    tableName: "user",
    rowId: result.userId,
    after: { email: result.email },
  });
  return NextResponse.json({ ok: true });
}
