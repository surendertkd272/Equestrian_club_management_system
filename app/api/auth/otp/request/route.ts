// Passwordless sign-in — step 1: request a 6-digit code by email. For users
// who forgot their password (their "user id" is their email). Always returns
// 200 so the endpoint can't be used to probe which emails exist. Rate-limited
// per IP + per email to stop code-spam to an inbox.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { issueEmailVerifyCode } from "@/lib/email-verify";
import { sendEmail, renderEmail } from "@/lib/email";
import { checkRate, clientFingerprint } from "@/lib/rate-limit";

const schema = z.object({ email: z.string().email() });

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: true }); // no enumeration

  const ip = clientFingerprint(req);
  const email = parsed.data.email.toLowerCase();
  // Both caps fail SILENTLY to 200 — never reveal existence via a 429 either.
  if (!checkRate(`otp-login:ip:${ip}`, 15, 60 * 60_000).ok) return NextResponse.json({ ok: true });
  if (!checkRate(`otp-login:em:${email}`, 5, 60 * 60_000).ok) return NextResponse.json({ ok: true });

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, status: true },
  });
  if (!user || user.status !== "active") return NextResponse.json({ ok: true });

  const code = await issueEmailVerifyCode(user.id, user.email);
  await sendEmail({
    to: user.email,
    subject: "Your Equiwings sign-in code",
    html: renderEmail({
      centreName: "Equiwings",
      heading: "Your sign-in code",
      body: `<p>Hi ${user.name},</p>
<p>Use this code to sign in. It expires in 10 minutes.</p>
<p style="font-size:32px;font-weight:700;letter-spacing:0.15em;margin:20px 0;">${code}</p>
<p style="font-size:12px;color:#666">If you didn't request this, you can ignore this email — your account is safe.</p>`,
    }),
    ref: { type: "auth.login_otp", rowId: user.id },
  });

  return NextResponse.json({ ok: true });
}
