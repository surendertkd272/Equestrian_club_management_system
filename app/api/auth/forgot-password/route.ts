import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { issueResetToken } from "@/lib/password-reset";
import { sendEmail, renderEmail } from "@/lib/email";
import { sendSms } from "@/lib/sms";
import { checkRate, clientFingerprint } from "@/lib/rate-limit";
import { verifyChallenge } from "@/lib/captcha";

const schema = z.object({
  email: z.string().email(),
  // CAPTCHA — optional in dev (when captchaToken/captchaAnswer are blank,
  // we still process the request) but required in production. The
  // verify call returns true only when both are present and valid.
  captchaToken: z.string().optional(),
  captchaAnswer: z.string().optional(),
});

// POST /api/auth/forgot-password — public, unauthenticated.
//
// Always returns 200 with the same generic message regardless of whether
// the email is on file. This prevents enumeration: an attacker can't fish
// out which email addresses have accounts on the platform.
//
// If the email DOES match a user, we issue a one-time signed token and
// deliver it via email + SMS (whichever is configured). The plaintext is
// only ever in the email body — never logged, never stored.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: true });
  }

  // CAPTCHA gate in production. Dev runs without to keep manual testing
  // fast. The 200-on-fail behaviour matches the no-enumeration property
  // of the rest of this endpoint.
  if (process.env.NODE_ENV === "production") {
    if (!parsed.data.captchaToken || !parsed.data.captchaAnswer) {
      return NextResponse.json({ ok: true });
    }
    if (!verifyChallenge(parsed.data.captchaToken, parsed.data.captchaAnswer)) {
      return NextResponse.json({ ok: true });
    }
  }

  // Throttle by IP — forgot-password emails are a great vector for SMS/
  // email bombing. We deliberately still return 200 on rate-limit to keep
  // the no-enumeration property, but we skip the actual send.
  const ip = clientFingerprint(req);
  if (!checkRate(`forgot:ip:${ip}`, 5, 15 * 60_000).ok) {
    return NextResponse.json({ ok: true });
  }
  if (!checkRate(`forgot:em:${parsed.data.email.toLowerCase()}`, 3, 60 * 60_000).ok) {
    return NextResponse.json({ ok: true });
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true, email: true, phone: true, name: true, status: true, centre: { select: { name: true } } },
  });
  // Done either way — return 200 even if no user, to avoid enumeration leak.
  if (!user || user.status !== "active") {
    return NextResponse.json({ ok: true });
  }

  const forwardedFor = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? null;
  const token = await issueResetToken(user.id, forwardedFor);
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const link = `${baseUrl}/reset-password/${token}`;

  // Email — preferred channel because it's not character-limited.
  await sendEmail({
    to: user.email,
    subject: "Reset your Equiwings password",
    html: renderEmail({
      centreName: user.centre?.name ?? "Equiwings",
      heading: "Reset your password",
      body: `<p>Hi ${user.name},</p>
<p>Someone (hopefully you) asked to reset the password on your Equiwings account.</p>
<p>Click the link below to choose a new password — it expires in 30 minutes.</p>
<p><a href="${link}" style="display:inline-block;padding:10px 20px;background:#0f172a;color:#fff;border-radius:6px;text-decoration:none">Set new password</a></p>
<p style="font-size:12px;color:#666">If the button doesn't work, paste this URL:<br/><code>${link}</code></p>
<p style="font-size:12px;color:#666">If you didn't request this, ignore the email — the link will expire on its own.</p>`,
    }),
    ref: { type: "password.reset_link", rowId: user.id },
  });

  // Optional SMS short-message — short link makes the round-trip on a phone
  // easier when email is slow to arrive.
  if (user.phone) {
    await sendSms({
      to: user.phone,
      body: `Equiwings password reset link: ${link} (expires 30 min)`,
      ref: { type: "password.reset_link", rowId: user.id },
    });
  }

  return NextResponse.json({ ok: true });
}
