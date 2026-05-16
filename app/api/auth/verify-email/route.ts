import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { redeemEmailVerifyToken } from "@/lib/email-verify";
import { audit } from "@/lib/audit";

// Public endpoint. Browser hits this with the token from the welcome
// email; we flip emailVerifiedAt on success. Idempotent within the
// single-use guard — once consumed, the token can't be re-used, but a
// user who lost the link can re-issue via /api/auth/verify-email/resend.
const schema = z.object({ token: z.string().min(8).max(120) });

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
  }
  const result = await redeemEmailVerifyToken(parsed.data.token);
  if (!result.ok) {
    const status = result.error === "TOKEN_EXPIRED" ? 410 : 400;
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
